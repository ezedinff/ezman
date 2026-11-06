import {
  Collection,
  Environment,
  HttpResponse,
  KeyValueItem,
  RequestItem,
  ScriptLogEntry,
} from '../types';

export type ScriptStage = 'pre-request' | 'post-response';

export interface ScriptRunInput {
  stage: ScriptStage;
  code: string;
  request: RequestItem;
  environment?: Environment;
  collection?: Collection;
  response?: HttpResponse;
  /** Run-scoped variables shared between the pre-request and post-response scripts */
  locals: Map<string, string>;
}

export interface ScriptRunResult {
  logs: ScriptLogEntry[];
  error?: string;
  environment?: Environment;
  collection?: Collection;
  environmentChanged: boolean;
  collectionChanged: boolean;
}

const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor as new (
  ...args: string[]
) => (...args: unknown[]) => Promise<unknown>;

const fmt = (v: unknown): string => {
  if (typeof v === 'string') return v;
  if (v instanceof Error) return v.message;
  try {
    return JSON.stringify(v, null, 2) ?? String(v);
  } catch {
    return String(v);
  }
};

const deepEqual = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

// Small chai-like subset so common Postman assertions keep working.
const makeExpect = (actual: unknown) => {
  const assert = (ok: boolean, msg: string) => {
    if (!ok) throw new Error(msg);
  };
  const build = (negate: boolean): Record<string, unknown> => {
    const check = (ok: boolean, msg: string) => assert(negate ? !ok : ok, negate ? `not ${msg}` : msg);
    const chain: Record<string, unknown> = {
      equal: (e: unknown) => check(actual === e, `expected ${fmt(actual)} to equal ${fmt(e)}`),
      eql: (e: unknown) => check(deepEqual(actual, e), `expected ${fmt(actual)} to deeply equal ${fmt(e)}`),
      include: (e: unknown) =>
        check(
          typeof actual === 'string'
            ? actual.includes(String(e))
            : Array.isArray(actual) && actual.some((x) => deepEqual(x, e)),
          `expected ${fmt(actual)} to include ${fmt(e)}`
        ),
      property: (k: string) =>
        check(actual != null && typeof actual === 'object' && k in (actual as object), `expected object to have property ${k}`),
      above: (n: number) => check((actual as number) > n, `expected ${fmt(actual)} to be above ${n}`),
      below: (n: number) => check((actual as number) < n, `expected ${fmt(actual)} to be below ${n}`),
      a: (t: string) =>
        check((Array.isArray(actual) ? 'array' : actual === null ? 'null' : typeof actual) === t, `expected ${fmt(actual)} to be a ${t}`),
    };
    chain.an = chain.a;
    chain.contain = chain.include;
    chain.equals = chain.equal;
    chain.eq = chain.equal;
    const flags: Record<string, () => void> = {
      ok: () => check(!!actual, `expected ${fmt(actual)} to be truthy`),
      true: () => check(actual === true, `expected ${fmt(actual)} to be true`),
      false: () => check(actual === false, `expected ${fmt(actual)} to be false`),
      null: () => check(actual === null, `expected ${fmt(actual)} to be null`),
      undefined: () => check(actual === undefined, `expected ${fmt(actual)} to be undefined`),
      empty: () =>
        check(
          typeof actual === 'string' || Array.isArray(actual)
            ? actual.length === 0
            : actual != null && Object.keys(actual as object).length === 0,
          `expected ${fmt(actual)} to be empty`
        ),
    };
    for (const [name, fn] of Object.entries(flags)) {
      Object.defineProperty(chain, name, { get: () => (fn(), chain) });
    }
    for (const word of ['to', 'be', 'been', 'is', 'that', 'which', 'have', 'has', 'and', 'with', 'at', 'of']) {
      Object.defineProperty(chain, word, { get: () => chain });
    }
    Object.defineProperty(chain, 'not', { get: () => build(!negate) });
    return chain;
  };
  return build(false);
};

const upsert = <T extends KeyValueItem>(list: T[], key: string, value: string, make: () => T): T[] => {
  const i = list.findIndex((v) => v.key === key);
  if (i >= 0) return list.map((v, idx) => (idx === i ? { ...v, value, enabled: true } : v));
  return [...list, { ...make(), key, value, enabled: true }];
};

export async function runScript(input: ScriptRunInput): Promise<ScriptRunResult> {
  const { stage, code, request, response, locals } = input;
  const logs: ScriptLogEntry[] = [];
  let environment = input.environment;
  let collection = input.collection;
  let environmentChanged = false;
  let collectionChanged = false;

  const push = (level: ScriptLogEntry['level'], message: string) => logs.push({ level, stage, message });
  const out = (level: 'log' | 'info' | 'warn' | 'error') => (...args: unknown[]) =>
    push(level, args.map(fmt).join(' '));
  const consoleProxy = { log: out('log'), info: out('info'), warn: out('warn'), error: out('error') };

  const envLookup = (k: string) =>
    environment?.variables.find((v) => v.key === k && v.enabled)?.value;
  const colLookup = (k: string) =>
    collection?.variables.find((v) => v.key === k && v.enabled)?.value;

  const requireEnv = () => {
    if (!environment) {
      throw new Error('No active environment selected. Select an environment or use pm.collectionVariables.');
    }
    return environment;
  };

  const pending: Promise<unknown>[] = [];

  const pm = {
    info: { requestName: request.name, requestId: request.id, eventName: stage === 'pre-request' ? 'prerequest' : 'test' },
    environment: {
      get name() {
        return environment?.name;
      },
      get: (k: string) => envLookup(k),
      has: (k: string) => envLookup(k) !== undefined,
      set: (k: string, v: unknown) => {
        const env = requireEnv();
        environment = {
          ...env,
          variables: upsert(env.variables, k, fmt(v), () => ({ key: k, value: '', enabled: true, secret: false })),
        };
        environmentChanged = true;
      },
      unset: (k: string) => {
        const env = requireEnv();
        environment = { ...env, variables: env.variables.filter((v) => v.key !== k) };
        environmentChanged = true;
      },
    },
    collectionVariables: {
      get: (k: string) => colLookup(k),
      has: (k: string) => colLookup(k) !== undefined,
      set: (k: string, v: unknown) => {
        if (!collection) throw new Error('This request is not in a collection.');
        collection = {
          ...collection,
          variables: upsert(collection.variables, k, fmt(v), () => ({ key: k, value: '', enabled: true })),
        };
        collectionChanged = true;
      },
      unset: (k: string) => {
        if (!collection) throw new Error('This request is not in a collection.');
        collection = { ...collection, variables: collection.variables.filter((v) => v.key !== k) };
        collectionChanged = true;
      },
    },
    variables: {
      get: (k: string) => locals.get(k) ?? colLookup(k) ?? envLookup(k),
      has: (k: string) => (locals.get(k) ?? colLookup(k) ?? envLookup(k)) !== undefined,
      set: (k: string, v: unknown) => void locals.set(k, fmt(v)),
      unset: (k: string) => void locals.delete(k),
    },
    request: {
      url: request.url,
      method: request.method,
      headers: {
        get: (k: string) =>
          request.headers.find((h) => h.enabled && h.key.toLowerCase() === k.toLowerCase())?.value,
      },
    },
    response: response
      ? {
          code: response.status,
          status: response.status_text,
          responseTime: response.duration_ms,
          responseSize: response.size_bytes,
          headers: {
            get: (k: string) =>
              response.headers.find(([name]) => name.toLowerCase() === k.toLowerCase())?.[1],
          },
          text: () => response.body,
          json: () => JSON.parse(response.body),
        }
      : undefined,
    test: (name: string, fn: () => unknown) => {
      try {
        const r = fn();
        if (r instanceof Promise) {
          pending.push(
            r.then(
              () => push('pass', name),
              (e) => push('fail', `${name} — ${fmt(e)}`)
            )
          );
        } else {
          push('pass', name);
        }
      } catch (e) {
        push('fail', `${name} — ${fmt(e)}`);
      }
    },
    expect: makeExpect,
  };

  let error: string | undefined;
  try {
    const fn = new AsyncFunction('pm', 'console', code);
    await fn(pm, consoleProxy);
    await Promise.all(pending);
  } catch (e) {
    error = fmt(e);
    push('error', error);
  }

  return { logs, error, environment, collection, environmentChanged, collectionChanged };
}
