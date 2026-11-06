import React, { useMemo } from 'react';
import Editor, { OnMount } from '@monaco-editor/react';
import '../services/monaco'; // Ensures offline config, theme, and GraphQL tokenizer are loaded

export interface CodeEditorProps {
  value: string;
  onChange?: (value: string) => void;
  language?: string;
  readOnly?: boolean;
  height?: string | number;
  className?: string;
  lineNumbers?: 'on' | 'off';
  minimap?: boolean;
  wordWrap?: 'on' | 'off';
  /** Unique model URI so multiple editors don't share/clobber state */
  path?: string;
  onMount?: OnMount;
}

export const CodeEditor: React.FC<CodeEditorProps> = ({
  value,
  onChange,
  language = 'json',
  readOnly = false,
  height = '100%',
  className = '',
  lineNumbers = 'on',
  minimap = false,
  wordWrap = 'on',
  path,
  onMount,
}) => {
  const handleEditorMount: OnMount = (editor, monacoInstance) => {
    const model = editor.getModel();
    // Large-file mode is permanent on a model. Recreate it once optimizations are off.
    const tooLarge = (
      model as { isTooLargeForTokenization?: () => boolean } | null
    )?.isTooLargeForTokenization?.();
    if (model && tooLarge) {
      const value = model.getValue();
      const languageId = model.getLanguageId();
      const uri = model.uri;
      model.dispose();
      editor.setModel(monacoInstance.editor.createModel(value, languageId, uri));
    }
    editor.updateOptions({
      folding: true,
      foldingStrategy: 'indentation',
      showFoldingControls: 'always',
      largeFileOptimizations: false,
    });
    if (onMount) {
      onMount(editor, monacoInstance);
    }
  };

  const options = useMemo(
    () => ({
      readOnly,
      domReadOnly: false,
      lineNumbers,
      lineNumbersMinChars: 3,
      minimap: { enabled: minimap },
      wordWrap,
      folding: true,
      foldingStrategy: 'indentation' as const,
      foldingMaximumRegions: 50000,
      showFoldingControls: 'always' as const,
      largeFileOptimizations: false,
      foldingHighlight: true,
      unfoldOnClickAfterEndOfLine: true,
      glyphMargin: true,
      lineDecorationsWidth: 20,
      matchBrackets: 'always' as const,
      find: {
        addExtraSpaceOnTop: false,
        autoFindInSelection: 'never' as const,
        seedSearchStringFromSelection: 'always' as const,
      },
      fontSize: 12,
      fontFamily:
        'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
      fontLigatures: true,
      tabSize: 2,
      insertSpaces: true,
      detectIndentation: false,
      scrollBeyondLastLine: false,
      automaticLayout: true,
      overviewRulerBorder: false,
      renderLineHighlight: readOnly ? ('none' as const) : ('line' as const),
      contextmenu: true,
      cursorBlinking: 'smooth' as const,
      cursorSmoothCaretAnimation: 'on' as const,
      smoothScrolling: true,
      scrollbar: {
        verticalScrollbarSize: 8,
        horizontalScrollbarSize: 8,
      },
      padding: { top: 8, bottom: 8 },
    }),
    [readOnly, lineNumbers, minimap, wordWrap]
  );

  return (
    <div
      className={`w-full h-full overflow-hidden rounded border border-gray-800/80 bg-[#121418] select-text ${className}`}
    >
      <Editor
        height={height}
        language={language}
        value={value}
        path={path}
        theme="ezman-dark"
        onChange={(val) => {
          if (onChange && !readOnly) {
            onChange(val ?? '');
          }
        }}
        onMount={handleEditorMount}
        loading={
          <div className="flex items-center justify-center h-full text-xs text-gray-500 font-mono">
            Loading editor...
          </div>
        }
        options={options}
      />
    </div>
  );
};
