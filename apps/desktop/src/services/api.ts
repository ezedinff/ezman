import { Collection, Environment, HttpResponse, ImportResult, RequestItem, AppPreferences } from '../types';

declare global {
  interface Window {
    __TAURI_INTERNALS__?: unknown;
  }
}

const isTauri = (): boolean => {
  return typeof window !== 'undefined' && (Boolean(window.__TAURI_INTERNALS__) || Boolean((window as unknown as { __TAURI__?: unknown }).__TAURI__));
};

let tauriInvoke: (<T>(cmd: string, args?: Record<string, unknown>) => Promise<T>) | null = null;

const getInvoke = async () => {
  if (tauriInvoke) return tauriInvoke;
  if (isTauri()) {
    try {
      const core = await import('@tauri-apps/api/core');
      tauriInvoke = core.invoke;
      return tauriInvoke;
    } catch (e) {
      console.warn('Failed to load @tauri-apps/api/core, using fallback:', e);
    }
  }
  return null;
};

// Fallback in-memory/localStorage store for development or testing
const STORAGE_KEY_COLLECTIONS = 'ezman_dev_collections';
const STORAGE_KEY_ENVIRONMENTS = 'ezman_dev_environments';
const STORAGE_KEY_PREFS = 'ezman_dev_prefs';

const getLocalCollections = (): Collection[] => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_COLLECTIONS);
    if (raw) return JSON.parse(raw);
  } catch (e) {
    console.error(e);
  }
  return [];
};

const setLocalCollections = (cols: Collection[]) => {
  localStorage.setItem(STORAGE_KEY_COLLECTIONS, JSON.stringify(cols));
};

const getLocalEnvironments = (): Environment[] => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_ENVIRONMENTS);
    if (raw) return JSON.parse(raw);
  } catch (e) {
    console.error(e);
  }
  return [];
};

const setLocalEnvironments = (envs: Environment[]) => {
  localStorage.setItem(STORAGE_KEY_ENVIRONMENTS, JSON.stringify(envs));
};

export const api = {
  async getMcpInfo(): Promise<{ path: string; exists: boolean } | null> {
    const invoke = await getInvoke();
    return invoke ? await invoke<{ path: string; exists: boolean }>('get_mcp_info') : null;
  },

  async listCollections(): Promise<Collection[]> {
    const invoke = await getInvoke();
    if (invoke) {
      return await invoke<Collection[]>('list_collections');
    }
    return getLocalCollections();
  },

  async getCollection(id: string): Promise<Collection | null> {
    const invoke = await getInvoke();
    if (invoke) {
      return await invoke<Collection | null>('get_collection', { id });
    }
    const cols = getLocalCollections();
    return cols.find((c) => c.id === id) || null;
  },

  async saveCollection(collection: Collection): Promise<void> {
    const invoke = await getInvoke();
    if (invoke) {
      return await invoke<void>('save_collection', { collection });
    }
    const cols = getLocalCollections();
    const idx = cols.findIndex((c) => c.id === collection.id);
    if (idx >= 0) {
      cols[idx] = collection;
    } else {
      cols.push(collection);
    }
    setLocalCollections(cols);
  },

  async deleteCollection(id: string): Promise<boolean> {
    const invoke = await getInvoke();
    if (invoke) {
      return await invoke<boolean>('delete_collection', { id });
    }
    const cols = getLocalCollections();
    const filtered = cols.filter((c) => c.id !== id);
    setLocalCollections(filtered);
    return filtered.length < cols.length;
  },

  async listEnvironments(): Promise<Environment[]> {
    const invoke = await getInvoke();
    if (invoke) {
      return await invoke<Environment[]>('list_environments');
    }
    return getLocalEnvironments();
  },

  async saveEnvironment(environment: Environment): Promise<void> {
    const invoke = await getInvoke();
    if (invoke) {
      return await invoke<void>('save_environment', { environment });
    }
    const envs = getLocalEnvironments();
    const idx = envs.findIndex((e) => e.id === environment.id);
    if (idx >= 0) {
      envs[idx] = environment;
    } else {
      envs.push(environment);
    }
    setLocalEnvironments(envs);
  },

  async deleteEnvironment(id: string): Promise<boolean> {
    const invoke = await getInvoke();
    if (invoke) {
      return await invoke<boolean>('delete_environment', { id });
    }
    const envs = getLocalEnvironments();
    const filtered = envs.filter((e) => e.id !== id);
    setLocalEnvironments(filtered);
    return filtered.length < envs.length;
  },

  async getPreferences(): Promise<AppPreferences> {
    const invoke = await getInvoke();
    if (invoke) {
      return await invoke<AppPreferences>('get_preferences');
    }
    try {
      const raw = localStorage.getItem(STORAGE_KEY_PREFS);
      if (raw) return JSON.parse(raw);
    } catch {}
    return { open_tabs: [], theme: 'dark' };
  },

  async savePreferences(preferences: AppPreferences): Promise<void> {
    const invoke = await getInvoke();
    if (invoke) {
      return await invoke<void>('save_preferences', { preferences });
    }
    localStorage.setItem(STORAGE_KEY_PREFS, JSON.stringify(preferences));
  },

  async importPostmanCollection(jsonContent: string): Promise<ImportResult> {
    const invoke = await getInvoke();
    if (invoke) {
      return await invoke<ImportResult>('import_postman_collection', { jsonContent });
    }
    // Simple client fallback for browser preview
    const parsed = JSON.parse(jsonContent);
    const col: Collection = {
      id: parsed.info?._postman_id || String(Date.now()),
      name: parsed.info?.name || 'Imported Collection',
      mcp_allow_secrets: false,
      description: parsed.info?.description,
      variables: [],
      folders: [],
      requests: [],
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    const cols = getLocalCollections();
    cols.push(col);
    setLocalCollections(cols);
    return { collection: col, warnings: [] };
  },

  async executeRequest(
    request: RequestItem,
    collectionId?: string,
    environmentId?: string
  ): Promise<HttpResponse> {
    const invoke = await getInvoke();
    if (invoke) {
      return await invoke<HttpResponse>('execute_request', {
        request,
        collectionId: collectionId || null,
        environmentId: environmentId || null,
      });
    }

    // Browser fallback execution via fetch
    const startTime = performance.now();
    try {
      let finalUrl = request.url;
      const qp = request.params
        .filter((p) => p.enabled && p.key.trim())
        .map((p) => `${encodeURIComponent(p.key)}=${encodeURIComponent(p.value)}`)
        .join('&');
      if (qp) {
        finalUrl += (finalUrl.includes('?') ? '&' : '?') + qp;
      }

      const headers: Record<string, string> = {};
      request.headers.filter((h) => h.enabled && h.key.trim()).forEach((h) => {
        headers[h.key] = h.value;
      });

      if (request.auth?.auth_type === 'bearer' && request.auth.bearer_token) {
        headers['Authorization'] = `Bearer ${request.auth.bearer_token}`;
      } else if (request.auth?.auth_type === 'basic') {
        const creds = btoa(`${request.auth.basic_username || ''}:${request.auth.basic_password || ''}`);
        headers['Authorization'] = `Basic ${creds}`;
      }

      let body: string | undefined = undefined;
      if (request.method !== 'GET' && request.method !== 'HEAD') {
        if (request.body.body_type === 'json' && request.body.raw) {
          headers['Content-Type'] = 'application/json';
          body = request.body.raw;
        } else if (request.body.body_type === 'text' && request.body.raw) {
          headers['Content-Type'] = 'text/plain';
          body = request.body.raw;
        } else if (request.body.body_type === 'urlencoded' && request.body.url_encoded) {
          headers['Content-Type'] = 'application/x-www-form-urlencoded';
          body = request.body.url_encoded
            .filter((p) => p.enabled && p.key.trim())
            .map((p) => `${encodeURIComponent(p.key)}=${encodeURIComponent(p.value)}`)
            .join('&');
        }
      }

      const resp = await fetch(finalUrl, {
        method: request.method,
        headers,
        body,
      });

      const text = await resp.text();
      const duration_ms = Math.round(performance.now() - startTime);

      const responseHeaders: [string, string][] = [];
      resp.headers.forEach((v, k) => {
        responseHeaders.push([k, v]);
      });

      return {
        status: resp.status,
        status_text: resp.statusText || 'OK',
        headers: responseHeaders,
        body: text,
        duration_ms,
        size_bytes: new Blob([text]).size,
      };
    } catch (e: unknown) {
      const duration_ms = Math.round(performance.now() - startTime);
      return {
        status: 0,
        status_text: 'Error',
        headers: [],
        body: '',
        duration_ms,
        size_bytes: 0,
        error: e instanceof Error ? e.message : String(e),
      };
    }
  },
};
