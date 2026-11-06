import * as monaco from 'monaco-editor';
import { json as monacoJson, typescript as monacoTs } from 'monaco-editor';
import { loader } from '@monaco-editor/react';

// Monaco 0.57 creates workers via import.meta.url. Keep monaco-editor out of
// Vite optimizeDeps (see vite.config.ts) so those worker URLs resolve.
loader.config({ monaco });

// Folding is skipped entirely when a model is created with large-file mode
// (over ~300k lines or 20MB). Pretty-printed API bodies around 5MB hit that.
// The flag is fixed at model creation, so set it before any editor mounts.
if (typeof document !== 'undefined') {
  const bootstrapHost = document.createElement('div');
  const bootstrapEditor = monaco.editor.create(bootstrapHost, {
    value: '',
    language: 'plaintext',
    largeFileOptimizations: false,
  });
  bootstrapEditor.dispose();
}

monacoJson.jsonDefaults.setDiagnosticsOptions({
  validate: true,
  allowComments: true,
  trailingCommas: 'ignore',
  schemaValidation: 'ignore',
});

monacoJson.jsonDefaults.setModeConfiguration({
  documentFormattingEdits: true,
  documentRangeFormattingEdits: true,
  completionItems: true,
  hovers: true,
  documentSymbols: true,
  tokens: true,
  colors: true,
  foldingRanges: true,
  diagnostics: true,
  selectionRanges: true,
});

if (!monaco.languages.getLanguages().some((lang) => lang.id === 'graphql')) {
  monaco.languages.register({ id: 'graphql' });

  monaco.languages.setMonarchTokensProvider('graphql', {
    keywords: [
      'type',
      'schema',
      'query',
      'mutation',
      'subscription',
      'fragment',
      'interface',
      'union',
      'scalar',
      'enum',
      'input',
      'extend',
      'null',
      'true',
      'false',
      'on',
      'directive',
    ],
    typeKeywords: ['Int', 'Float', 'String', 'Boolean', 'ID'],
    tokenizer: {
      root: [
        [
          /[a-zA-Z_]\w*/,
          {
            cases: {
              '@keywords': 'keyword',
              '@typeKeywords': 'type',
              '@default': 'identifier',
            },
          },
        ],
        [/\$[a-zA-Z_]\w*/, 'variable'],
        [/#.*$/, 'comment'],
        [/"([^"\\]|\\.)*"/, 'string'],
        [/:\s*[a-zA-Z_]\w*!?/, 'type'],
        [/[{}()[\]]/, '@brackets'],
        [/[0-9]+(\.[0-9]+)?/, 'number'],
      ],
    },
  });

  monaco.languages.setLanguageConfiguration('graphql', {
    brackets: [
      ['{', '}'],
      ['[', ']'],
      ['(', ')'],
    ],
    autoClosingPairs: [
      { open: '{', close: '}' },
      { open: '[', close: ']' },
      { open: '(', close: ')' },
      { open: '"', close: '"' },
    ],
    surroundingPairs: [
      { open: '{', close: '}' },
      { open: '[', close: ']' },
      { open: '(', close: ')' },
      { open: '"', close: '"' },
    ],
  });
}

monaco.editor.defineTheme('ezman-dark', {
  base: 'vs-dark',
  inherit: true,
  rules: [
    { token: 'comment', foreground: '64748b', fontStyle: 'italic' },
    { token: 'keyword', foreground: '38bdf8' },
    { token: 'variable', foreground: 'f472b6' },
    { token: 'type', foreground: 'a78bfa' },
    { token: 'string', foreground: '34d399' },
    { token: 'number', foreground: 'fb923c' },
  ],
  colors: {
    'editor.background': '#121418',
    'editor.foreground': '#e2e8f0',
    'editorLineNumber.foreground': '#475569',
    'editorLineNumber.activeForeground': '#94a3b8',
    'editor.selectionBackground': '#1e3a5f',
    'editor.inactiveSelectionBackground': '#172554',
    'editorCursor.foreground': '#38bdf8',
    'editorWhitespace.foreground': '#334155',
    'editorIndentGuide.background': '#1e293b',
    'editorIndentGuide.activeBackground': '#334155',
  },
});

export { monaco };

// Autocomplete and no false "pm is not defined" errors in the script editors.
monacoTs.javascriptDefaults.setDiagnosticsOptions({
  noSemanticValidation: true,
  noSyntaxValidation: false,
});
monacoTs.javascriptDefaults.setCompilerOptions({
  target: monacoTs.ScriptTarget.ES2020,
  allowNonTsExtensions: true,
});
monacoTs.javascriptDefaults.addExtraLib(
  `
interface PmVariables {
  get(key: string): string | undefined;
  set(key: string, value: any): void;
  unset(key: string): void;
  has(key: string): boolean;
}
declare const pm: {
  environment: PmVariables & { name?: string };
  collectionVariables: PmVariables;
  variables: PmVariables;
  info: { requestName: string; requestId: string; eventName: string };
  request: { url: string; method: string; headers: { get(name: string): string | undefined } };
  /** Only available in post-response scripts */
  response: {
    code: number;
    status: string;
    responseTime: number;
    responseSize: number;
    headers: { get(name: string): string | undefined };
    json(): any;
    text(): string;
  };
  test(name: string, fn: () => void | Promise<void>): void;
  expect(value: any): any;
};
`,
  'ezman-pm.d.ts'
);
