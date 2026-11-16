import React, { useEffect, useState, useRef } from 'react';
import {
  Copy,
  Check,
  Clock,
  Database,
  AlertTriangle,
  Search,
  FileText,
  Maximize2,
  Minimize2,
  PanelRightClose,
  X,
  BookmarkPlus,
  Trash2,
} from 'lucide-react';
import type * as monaco from 'monaco-editor';
import { HttpResponse, SavedResponse, ScriptLogEntry } from '../types';
import { CodeEditor } from './CodeEditor';

export interface ResponseViewerProps {
  response?: HttpResponse;
  savedResponses?: SavedResponse[];
  scriptLogs?: ScriptLogEntry[];
  loading?: boolean;
  layoutMode?: 'split' | 'maximized' | 'collapsed';
  onToggleMaximize?: () => void;
  onToggleCollapse?: () => void;
  onSaveResponse?: (name: string) => void;
  onDeleteResponse?: (id: string) => void;
}

type ViewSource = 'live' | string; // 'live' or saved response id

function savedToHttp(saved: SavedResponse): HttpResponse {
  return {
    status: saved.status,
    status_text: saved.status_text,
    headers: saved.headers,
    body: saved.body,
    duration_ms: 0,
    size_bytes: new TextEncoder().encode(saved.body).length,
  };
}

export const ResponseViewer: React.FC<ResponseViewerProps> = ({
  response,
  savedResponses = [],
  scriptLogs = [],
  loading,
  layoutMode = 'split',
  onToggleMaximize,
  onToggleCollapse,
  onSaveResponse,
  onDeleteResponse,
}) => {
  const [activeTab, setActiveTab] = useState<'body' | 'headers' | 'console'>('body');
  const [viewMode, setViewMode] = useState<'pretty' | 'raw'>('pretty');
  const [copied, setCopied] = useState(false);
  const [headerSearchOpen, setHeaderSearchOpen] = useState(false);
  const [headerSearchQuery, setHeaderSearchQuery] = useState('');
  const [viewSource, setViewSource] = useState<ViewSource>('live');
  const [naming, setNaming] = useState(false);
  const [exampleName, setExampleName] = useState('');

  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const nameInputRef = useRef<HTMLInputElement | null>(null);

  // Prefer live response when a new one arrives.
  useEffect(() => {
    if (response) setViewSource('live');
  }, [response]);

  // With no live response, default to the first saved example.
  useEffect(() => {
    if (response || savedResponses.length === 0) return;
    setViewSource((prev) =>
      prev !== 'live' && savedResponses.some((r) => r.id === prev)
        ? prev
        : savedResponses[0].id
    );
  }, [response, savedResponses]);

  // Drop selection if the saved example was deleted.
  useEffect(() => {
    if (viewSource === 'live') return;
    if (!savedResponses.some((r) => r.id === viewSource)) {
      setViewSource(response ? 'live' : savedResponses[0]?.id ?? 'live');
    }
  }, [savedResponses, viewSource, response]);

  useEffect(() => {
    if (naming) {
      nameInputRef.current?.focus();
      nameInputRef.current?.select();
    }
  }, [naming]);

  const selectedSaved =
    viewSource !== 'live' ? savedResponses.find((r) => r.id === viewSource) : undefined;
  const displayResponse: HttpResponse | undefined = selectedSaved
    ? savedToHttp(selectedSaved)
    : response;
  const viewingExample = !!selectedSaved;

  const handleCopyBody = () => {
    if (!displayResponse?.body) return;
    navigator.clipboard.writeText(displayResponse.body);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleTriggerFind = () => {
    if (activeTab === 'body') {
      editorRef.current?.focus();
      editorRef.current?.getAction('actions.find')?.run();
    } else {
      setHeaderSearchOpen((prev) => !prev);
    }
  };

  const startSave = () => {
    if (!response || response.error || !onSaveResponse) return;
    const defaultName = `${response.status} ${response.status_text || 'Response'}`.trim();
    setExampleName(defaultName);
    setNaming(true);
  };

  const confirmSave = () => {
    const name = exampleName.trim();
    if (!name || !onSaveResponse) return;
    onSaveResponse(name);
    setNaming(false);
    setExampleName('');
  };

  const formatSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  };

  const getStatusColor = (status: number): string => {
    if (status >= 200 && status < 300) return 'text-emerald-400 bg-emerald-950/60 border-emerald-800/60';
    if (status >= 300 && status < 400) return 'text-blue-400 bg-blue-950/60 border-blue-800/60';
    if (status >= 400 && status < 500) return 'text-amber-400 bg-amber-950/60 border-amber-800/60';
    if (status >= 500) return 'text-rose-400 bg-rose-950/60 border-rose-800/60';
    return 'text-rose-400 bg-rose-950/60 border-rose-800/60';
  };

  const formatBody = (body: string): { formatted: string; isJson: boolean } => {
    if (!body) return { formatted: '', isJson: false };
    try {
      const parsed = JSON.parse(body);
      return { formatted: JSON.stringify(parsed, null, 2), isJson: true };
    } catch {
      return { formatted: body, isJson: false };
    }
  };

  const detectLanguage = (headers: [string, string][], body: string): string => {
    const contentTypeHeader = headers.find(([k]) => k.toLowerCase() === 'content-type');
    const ct = (contentTypeHeader ? contentTypeHeader[1] : '').toLowerCase();
    if (ct.includes('application/json') || ct.includes('+json')) return 'json';
    if (ct.includes('text/html')) return 'html';
    if (ct.includes('application/xml') || ct.includes('text/xml')) return 'xml';
    if (ct.includes('text/css')) return 'css';
    if (ct.includes('javascript')) return 'javascript';
    if (ct.includes('markdown')) return 'markdown';

    const trimmed = body.trim();
    if (
      (trimmed.startsWith('{') && trimmed.endsWith('}')) ||
      (trimmed.startsWith('[') && trimmed.endsWith(']'))
    ) {
      return 'json';
    }
    if (trimmed.startsWith('<!DOCTYPE html>') || (trimmed.startsWith('<html') && trimmed.endsWith('</html>'))) {
      return 'html';
    }
    if (trimmed.startsWith('<?xml') || (trimmed.startsWith('<') && trimmed.endsWith('>'))) {
      return 'xml';
    }
    return 'plaintext';
  };

  if (loading) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center bg-[#15171d] text-gray-400 p-8 select-none">
        <div className="w-8 h-8 border-3 border-blue-500/30 border-t-blue-500 rounded-full animate-spin mb-3" />
        <span className="text-xs font-medium text-gray-300">Sending request...</span>
        <span className="text-[11px] text-gray-500 mt-1">Waiting for response</span>
      </div>
    );
  }

  if (!displayResponse) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center bg-[#15171d] text-gray-500 p-8 select-none">
        <div className="w-12 h-12 rounded-xl bg-gray-800/40 border border-gray-700/50 flex items-center justify-center mb-3">
          <FileText className="w-6 h-6 text-gray-500" />
        </div>
        <p className="text-xs font-medium text-gray-300">No response yet</p>
        <p className="text-[11px] text-gray-500 mt-1 max-w-xs text-center">
          Click 'Send' or press <span className="font-mono text-gray-400 bg-gray-800 px-1 py-0.5 rounded">⌘ Enter</span> to execute the request.
        </p>
        {savedResponses.length > 0 && (
          <div className="mt-4 flex flex-col items-center gap-2">
            <span className="text-[11px] text-gray-400">Saved examples</span>
            <div className="flex flex-wrap justify-center gap-1.5 max-w-sm">
              {savedResponses.map((ex) => (
                <button
                  key={ex.id}
                  onClick={() => setViewSource(ex.id)}
                  className="px-2 py-1 rounded border border-gray-700 bg-gray-800/80 text-[11px] text-gray-300 hover:text-white hover:border-gray-500"
                >
                  {ex.name}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  }

  const { formatted: prettyBody, isJson } = formatBody(displayResponse.body || '');
  const displayBody = viewMode === 'pretty' && isJson ? prettyBody : displayResponse.body || '';
  const detectedLanguage =
    viewMode === 'raw'
      ? 'plaintext'
      : isJson
        ? 'json'
        : detectLanguage(displayResponse.headers || [], displayResponse.body || '');

  const filteredHeaders = displayResponse.headers.filter(([k, v]) => {
    if (!headerSearchQuery.trim()) return true;
    const q = headerSearchQuery.toLowerCase();
    return k.toLowerCase().includes(q) || v.toLowerCase().includes(q);
  });

  return (
    <div
      id="response-viewer-container"
      className="flex-1 flex flex-col bg-[#15171d] border-l border-gray-800 overflow-hidden select-none h-full"
    >
      {/* Top Response Info Bar */}
      <div className="p-2.5 border-b border-gray-800 flex items-center justify-between bg-[#16181e] gap-2">
        <div className="flex items-center space-x-3 text-xs min-w-0">
          <span
            className={`font-mono text-xs font-bold px-2 py-0.5 rounded border flex-shrink-0 ${getStatusColor(
              displayResponse.status
            )}`}
          >
            {displayResponse.status} {displayResponse.status_text}
          </span>

          {viewingExample ? (
            <span className="flex items-center space-x-1 text-amber-400/90 text-[11px] font-medium flex-shrink-0">
              Example
            </span>
          ) : (
            <>
              <span className="flex items-center space-x-1 text-gray-400 text-[11px] font-mono flex-shrink-0">
                <Clock className="w-3 h-3 text-gray-500" />
                <span>{displayResponse.duration_ms} ms</span>
              </span>
              <span className="flex items-center space-x-1 text-gray-400 text-[11px] font-mono flex-shrink-0">
                <Database className="w-3 h-3 text-gray-500" />
                <span>{formatSize(displayResponse.size_bytes)}</span>
              </span>
            </>
          )}

          {(response || savedResponses.length > 0) && (
            <select
              value={viewSource}
              onChange={(e) => setViewSource(e.target.value as ViewSource)}
              className="max-w-[160px] bg-[#1e2129] border border-gray-700/60 text-gray-300 text-[11px] rounded px-1.5 py-1 outline-none hover:border-gray-600"
              title="View live or saved response"
            >
              <option value="live" disabled={!response}>
                {response ? 'Latest response' : 'Latest (none)'}
              </option>
              {savedResponses.map((ex) => (
                <option key={ex.id} value={ex.id}>
                  {ex.name}
                </option>
              ))}
            </select>
          )}
        </div>

        <div className="flex items-center space-x-1.5 flex-shrink-0">
          {naming ? (
            <form
              className="flex items-center gap-1"
              onSubmit={(e) => {
                e.preventDefault();
                confirmSave();
              }}
            >
              <input
                ref={nameInputRef}
                value={exampleName}
                onChange={(e) => setExampleName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') {
                    setNaming(false);
                    setExampleName('');
                  }
                }}
                placeholder="Example name"
                className="w-36 bg-[#1e2129] border border-gray-700 rounded px-2 py-1 text-[11px] text-gray-200 outline-none focus:border-blue-500"
              />
              <button
                type="submit"
                disabled={!exampleName.trim()}
                className="px-2 py-1 rounded bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white text-[11px]"
              >
                Save
              </button>
              <button
                type="button"
                onClick={() => {
                  setNaming(false);
                  setExampleName('');
                }}
                className="p-1 text-gray-400 hover:text-gray-200"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </form>
          ) : (
            <>
              {!viewingExample && response && !response.error && onSaveResponse && (
                <button
                  onClick={startSave}
                  title="Save response as example"
                  className="flex items-center space-x-1 bg-gray-800/80 hover:bg-gray-700 text-gray-300 px-2 py-1 rounded border border-gray-700 text-[11px] transition-colors"
                >
                  <BookmarkPlus className="w-3 h-3" />
                  <span>Save</span>
                </button>
              )}
              {viewingExample && onDeleteResponse && selectedSaved && (
                <button
                  onClick={() => onDeleteResponse(selectedSaved.id)}
                  title="Delete saved example"
                  className="flex items-center space-x-1 bg-gray-800/80 hover:bg-rose-950/60 text-gray-300 hover:text-rose-300 px-2 py-1 rounded border border-gray-700 hover:border-rose-800 text-[11px] transition-colors"
                >
                  <Trash2 className="w-3 h-3" />
                  <span>Delete</span>
                </button>
              )}
            </>
          )}

          <button
            onClick={handleTriggerFind}
            title={activeTab === 'body' ? 'Find in response (⌘F / Ctrl+F)' : 'Filter headers'}
            className="p-1.5 rounded border bg-gray-800/80 hover:bg-gray-700 text-gray-400 hover:text-gray-200 border-gray-700 transition-colors"
          >
            <Search className="w-3.5 h-3.5" />
          </button>

          <span className="px-1.5 py-0.5 rounded bg-gray-800/90 border border-gray-700/60 text-[10px] font-mono font-medium text-gray-400 uppercase">
            {detectedLanguage}
          </span>

          {isJson && (
            <div className="flex items-center bg-[#1e2129] border border-gray-700/60 rounded p-0.5 text-[11px]">
              <button
                onClick={() => setViewMode('pretty')}
                className={`px-2 py-0.5 rounded transition-colors ${
                  viewMode === 'pretty' ? 'bg-blue-600 text-white font-medium' : 'text-gray-400 hover:text-gray-200'
                }`}
              >
                Pretty
              </button>
              <button
                onClick={() => setViewMode('raw')}
                className={`px-2 py-0.5 rounded transition-colors ${
                  viewMode === 'raw' ? 'bg-blue-600 text-white font-medium' : 'text-gray-400 hover:text-gray-200'
                }`}
              >
                Raw
              </button>
            </div>
          )}

          <button
            onClick={handleCopyBody}
            title="Copy Response Body"
            className="flex items-center space-x-1 bg-gray-800/80 hover:bg-gray-700 text-gray-300 px-2 py-1 rounded border border-gray-700 text-[11px] transition-colors"
          >
            {copied ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
            <span>{copied ? 'Copied' : 'Copy'}</span>
          </button>

          {onToggleMaximize && (
            <button
              onClick={onToggleMaximize}
              title={layoutMode === 'maximized' ? 'Restore Split View' : 'Maximize Response (Full Width)'}
              className={`p-1.5 rounded border transition-colors ${
                layoutMode === 'maximized'
                  ? 'bg-blue-600/30 text-blue-300 border-blue-500'
                  : 'bg-gray-800/80 hover:bg-gray-700 text-gray-400 hover:text-gray-200 border-gray-700'
              }`}
            >
              {layoutMode === 'maximized' ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
            </button>
          )}

          {onToggleCollapse && (
            <button
              onClick={onToggleCollapse}
              title="Collapse Response Panel"
              className="p-1.5 rounded border bg-gray-800/80 hover:bg-gray-700 text-gray-400 hover:text-gray-200 border-gray-700 transition-colors"
            >
              <PanelRightClose className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {displayResponse.error && (
        <div className="m-3 p-3 bg-rose-950/40 border border-rose-800 text-rose-300 rounded text-xs flex items-start space-x-2">
          <AlertTriangle className="w-4 h-4 text-rose-400 flex-shrink-0 mt-0.5" />
          <div className="flex-1">
            <p className="font-semibold text-rose-200">Execution Error</p>
            <p className="text-[11px] font-mono mt-0.5 leading-relaxed">{displayResponse.error}</p>
          </div>
        </div>
      )}

      <div className="flex items-center justify-between border-b border-gray-800 bg-[#13151a] px-3 pt-1 text-xs">
        <div className="flex items-center space-x-1">
          <button
            onClick={() => setActiveTab('body')}
            className={`px-3 py-1.5 font-medium border-b-2 transition-colors ${
              activeTab === 'body'
                ? 'border-blue-500 text-blue-400'
                : 'border-transparent text-gray-400 hover:text-gray-200'
            }`}
          >
            Response Body
          </button>

          <button
            onClick={() => setActiveTab('headers')}
            className={`px-3 py-1.5 font-medium border-b-2 transition-colors flex items-center space-x-1.5 ${
              activeTab === 'headers'
                ? 'border-blue-500 text-blue-400'
                : 'border-transparent text-gray-400 hover:text-gray-200'
            }`}
          >
            <span>Headers</span>
            <span className="px-1.5 py-0.2 rounded-full bg-gray-800 text-[10px] text-gray-400 font-mono">
              {displayResponse.headers.length}
            </span>
          </button>

          {!viewingExample && scriptLogs.length > 0 && (
            <button
              onClick={() => setActiveTab('console')}
              className={`px-3 py-1.5 font-medium border-b-2 transition-colors flex items-center space-x-1.5 ${
                activeTab === 'console'
                  ? 'border-blue-500 text-blue-400'
                  : 'border-transparent text-gray-400 hover:text-gray-200'
              }`}
            >
              <span>Console</span>
              <span
                className={`px-1.5 rounded-full text-[10px] font-mono ${
                  scriptLogs.some((l) => l.level === 'error' || l.level === 'fail')
                    ? 'bg-rose-950 text-rose-300'
                    : 'bg-gray-800 text-gray-400'
                }`}
              >
                {scriptLogs.length}
              </span>
            </button>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-hidden p-3 text-xs flex flex-col min-h-0 select-text">
        {(activeTab === 'body' || (activeTab === 'console' && (viewingExample || scriptLogs.length === 0))) && (
          <div className="h-full flex-1 min-h-0">
            {displayResponse.body ? (
              <CodeEditor
                key={`response-body-${viewSource}-${viewMode}-${detectedLanguage}`}
                value={displayBody}
                language={detectedLanguage}
                path={`ezman-response.${detectedLanguage === 'json' ? 'json' : detectedLanguage}`}
                readOnly={true}
                wordWrap="off"
                minimap={false}
                onMount={(editor) => {
                  editorRef.current = editor;
                }}
              />
            ) : (
              <div className="h-full flex items-center justify-center text-gray-500 text-xs">
                Response body is empty.
              </div>
            )}
          </div>
        )}

        {activeTab === 'console' && !viewingExample && (
          <div className="h-full overflow-y-auto font-mono text-[11px] space-y-0.5">
            {scriptLogs.map((l, i) => (
              <div
                key={i}
                className={`flex gap-2 px-2 py-1 rounded whitespace-pre-wrap break-all ${
                  l.level === 'error' || l.level === 'fail'
                    ? 'bg-rose-950/40 text-rose-300'
                    : l.level === 'pass'
                    ? 'text-emerald-400'
                    : l.level === 'warn'
                    ? 'text-amber-300'
                    : 'text-gray-300'
                }`}
              >
                <span className="text-gray-600 flex-shrink-0 w-16">
                  {l.stage === 'pre-request' ? 'pre' : 'post'}
                </span>
                <span className="flex-shrink-0">
                  {l.level === 'pass' ? '✓' : l.level === 'fail' || l.level === 'error' ? '✗' : '›'}
                </span>
                <span>{l.message}</span>
              </div>
            ))}
          </div>
        )}

        {activeTab === 'headers' && (
          <div className="space-y-3 overflow-y-auto h-full flex flex-col">
            {headerSearchOpen && (
              <div className="flex items-center space-x-2 bg-[#181a22] p-1.5 px-2.5 rounded border border-gray-700/80 mb-1">
                <Search className="w-3.5 h-3.5 text-gray-400 pointer-events-none" />
                <input
                  type="text"
                  value={headerSearchQuery}
                  onChange={(e) => setHeaderSearchQuery(e.target.value)}
                  placeholder="Filter headers by key or value..."
                  className="flex-1 bg-transparent text-xs text-gray-200 placeholder-gray-500 outline-none font-mono"
                  autoFocus
                />
                {headerSearchQuery && (
                  <button
                    onClick={() => setHeaderSearchQuery('')}
                    className="p-0.5 text-gray-400 hover:text-gray-200"
                  >
                    <X className="w-3 h-3" />
                  </button>
                )}
              </div>
            )}

            <div className="border border-gray-800 rounded-md overflow-hidden bg-[#121418] flex-1">
              <table className="w-full text-left border-collapse text-xs font-mono">
                <thead>
                  <tr className="border-b border-gray-800 bg-gray-900/60 text-gray-400 font-sans text-[11px]">
                    <th className="py-1.5 px-3 w-1/3">Header Name</th>
                    <th className="py-1.5 px-3">Header Value</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-800/60">
                  {filteredHeaders.map(([k, v], idx) => (
                    <tr key={idx} className="hover:bg-gray-800/20 group">
                      <td className="py-1.5 px-3 font-semibold text-gray-300 break-all">{k}</td>
                      <td className="py-1.5 px-3 text-gray-400 break-all">{v}</td>
                    </tr>
                  ))}
                  {filteredHeaders.length === 0 && (
                    <tr>
                      <td colSpan={2} className="py-4 text-center text-gray-500 font-sans text-xs">
                        {headerSearchQuery ? `No headers matching '${headerSearchQuery}'.` : 'No headers found.'}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
