import React, { useState, useRef } from 'react';
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
} from 'lucide-react';
import type * as monaco from 'monaco-editor';
import { HttpResponse, ScriptLogEntry } from '../types';
import { CodeEditor } from './CodeEditor';

export interface ResponseViewerProps {
  response?: HttpResponse;
  scriptLogs?: ScriptLogEntry[];
  loading?: boolean;
  layoutMode?: 'split' | 'maximized' | 'collapsed';
  onToggleMaximize?: () => void;
  onToggleCollapse?: () => void;
}

export const ResponseViewer: React.FC<ResponseViewerProps> = ({
  response,
  scriptLogs = [],
  loading,
  layoutMode = 'split',
  onToggleMaximize,
  onToggleCollapse,
}) => {
  const [activeTab, setActiveTab] = useState<'body' | 'headers' | 'console'>('body');
  const [viewMode, setViewMode] = useState<'pretty' | 'raw'>('pretty');
  const [copied, setCopied] = useState(false);
  const [headerSearchOpen, setHeaderSearchOpen] = useState(false);
  const [headerSearchQuery, setHeaderSearchQuery] = useState('');

  // Editor reference for native Monaco actions (like Find)
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);

  const handleCopyBody = () => {
    if (!response?.body) return;
    navigator.clipboard.writeText(response.body);
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

  const { formatted: prettyBody, isJson } = formatBody(response?.body || '');
  const displayBody = viewMode === 'pretty' && isJson ? prettyBody : (response?.body || '');
  const detectedLanguage =
    viewMode === 'raw'
      ? 'plaintext'
      : isJson
        ? 'json'
        : detectLanguage(response?.headers || [], response?.body || '');

  if (loading) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center bg-[#15171d] text-gray-400 p-8 select-none">
        <div className="w-8 h-8 border-3 border-blue-500/30 border-t-blue-500 rounded-full animate-spin mb-3" />
        <span className="text-xs font-medium text-gray-300">Sending request...</span>
        <span className="text-[11px] text-gray-500 mt-1">Waiting for response</span>
      </div>
    );
  }

  if (!response) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center bg-[#15171d] text-gray-500 p-8 select-none">
        <div className="w-12 h-12 rounded-xl bg-gray-800/40 border border-gray-700/50 flex items-center justify-center mb-3">
          <FileText className="w-6 h-6 text-gray-500" />
        </div>
        <p className="text-xs font-medium text-gray-300">No response yet</p>
        <p className="text-[11px] text-gray-500 mt-1 max-w-xs text-center">
          Click 'Send' or press <span className="font-mono text-gray-400 bg-gray-800 px-1 py-0.5 rounded">⌘ Enter</span> to execute the request.
        </p>
      </div>
    );
  }

  const filteredHeaders = response.headers.filter(([k, v]) => {
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
      <div className="p-2.5 border-b border-gray-800 flex items-center justify-between bg-[#16181e]">
        <div className="flex items-center space-x-3 text-xs">
          {/* Status Badge */}
          <span
            className={`font-mono text-xs font-bold px-2 py-0.5 rounded border ${getStatusColor(
              response.status
            )}`}
          >
            {response.status} {response.status_text}
          </span>

          {/* Time Badge */}
          <span className="flex items-center space-x-1 text-gray-400 text-[11px] font-mono">
            <Clock className="w-3 h-3 text-gray-500" />
            <span>{response.duration_ms} ms</span>
          </span>

          {/* Size Badge */}
          <span className="flex items-center space-x-1 text-gray-400 text-[11px] font-mono">
            <Database className="w-3 h-3 text-gray-500" />
            <span>{formatSize(response.size_bytes)}</span>
          </span>
        </div>

        {/* Action Controls */}
        <div className="flex items-center space-x-1.5">
          {/* Native Search Trigger */}
          <button
            onClick={handleTriggerFind}
            title={activeTab === 'body' ? 'Find in response (⌘F / Ctrl+F)' : 'Filter headers'}
            className="p-1.5 rounded border bg-gray-800/80 hover:bg-gray-700 text-gray-400 hover:text-gray-200 border-gray-700 transition-colors"
          >
            <Search className="w-3.5 h-3.5" />
          </button>

          {/* Language Badge */}
          <span className="px-1.5 py-0.5 rounded bg-gray-800/90 border border-gray-700/60 text-[10px] font-mono font-medium text-gray-400 uppercase">
            {detectedLanguage}
          </span>

          {/* Pretty / Raw toggle (if JSON) */}
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


          {/* Copy Button */}
          <button
            onClick={handleCopyBody}
            title="Copy Response Body"
            className="flex items-center space-x-1 bg-gray-800/80 hover:bg-gray-700 text-gray-300 px-2 py-1 rounded border border-gray-700 text-[11px] transition-colors"
          >
            {copied ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
            <span>{copied ? 'Copied' : 'Copy'}</span>
          </button>

          {/* Panel Layout Controls: Maximize / Restore / Collapse */}
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

      {/* Error banner if network error */}
      {response.error && (
        <div className="m-3 p-3 bg-rose-950/40 border border-rose-800 text-rose-300 rounded text-xs flex items-start space-x-2">
          <AlertTriangle className="w-4 h-4 text-rose-400 flex-shrink-0 mt-0.5" />
          <div className="flex-1">
            <p className="font-semibold text-rose-200">Execution Error</p>
            <p className="text-[11px] font-mono mt-0.5 leading-relaxed">{response.error}</p>
          </div>
        </div>
      )}

      {/* Subtabs Bar */}
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
              {response.headers.length}
            </span>
          </button>

          {scriptLogs.length > 0 && (
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

      {/* Content Area — avoid select-none here so Monaco fold gutters stay clickable */}
      <div className="flex-1 overflow-hidden p-3 text-xs flex flex-col min-h-0 select-text">
        {(activeTab === 'body' || (activeTab === 'console' && scriptLogs.length === 0)) && (
          <div className="h-full flex-1 min-h-0">
            {response.body ? (
              <CodeEditor
                key={`response-body-${viewMode}-${detectedLanguage}`}
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

        {activeTab === 'console' && (
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
