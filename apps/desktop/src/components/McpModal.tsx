import React, { useEffect, useState } from 'react';
import { Check, Copy, Plug, X } from 'lucide-react';
import { api } from '../services/api';

interface McpModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const CopyBlock: React.FC<{ label: string; text: string }> = ({ label, text }) => {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-gray-300">{label}</span>
        <button
          onClick={copy}
          className="flex items-center gap-1 text-[11px] text-gray-400 hover:text-gray-100 transition-colors"
        >
          {copied ? <Check className="w-3 h-3 text-green-400" /> : <Copy className="w-3 h-3" />}
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <pre className="bg-[#0f1115] border border-gray-800 rounded-md p-3 text-[11px] text-gray-300 font-mono overflow-x-auto whitespace-pre-wrap break-all">
        {text}
      </pre>
    </div>
  );
};

export const McpModal: React.FC<McpModalProps> = ({ isOpen, onClose }) => {
  const [path, setPath] = useState<string | null>(null);
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    api.getMcpInfo().then((info) => {
      setPath(info?.path ?? null);
      setMissing(info ? !info.exists : true);
    });
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const json = JSON.stringify({ mcpServers: { ezman: { command: path } } }, null, 2);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
      <div
        className="w-[560px] max-w-[92vw] max-h-[88vh] overflow-y-auto bg-[#16181d] border border-gray-700 rounded-xl shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-800">
          <div className="flex items-center gap-2 text-gray-100 font-semibold text-sm">
            <Plug className="w-4 h-4 text-green-400" />
            Connect AI agents (MCP)
          </div>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-200">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-5">
          <p className="text-xs text-gray-400 leading-relaxed">
            EZMan ships with a built-in MCP server. Agents can browse your collections and run saved requests,
            with per-call overrides, using your environments. Secrets are never exposed.
          </p>

          {!path || missing ? (
            <p className="text-xs text-amber-400">
              {path
                ? 'The bundled MCP binary was not found next to the app. Reinstall EZMan.'
                : 'MCP info is only available in the desktop app.'}
            </p>
          ) : (
            <>
              <CopyBlock label="Claude Code" text={`claude mcp add ezman -- "${path}"`} />
              <CopyBlock label="Claude Desktop / Cursor / other clients (JSON config)" text={json} />
              <CopyBlock label="Binary path" text={path} />
              <p className="text-[11px] text-gray-500">
                Restart your AI client after adding it. Agents must pass an <code>environment_id</code> (or
                "none") when running requests. The path changes if you move the app.
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
};
