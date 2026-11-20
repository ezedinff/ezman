import React, { useEffect, useState } from 'react';
import { X, FileText, Download } from 'lucide-react';
import { Cell, DiffKind, DiffOptions, DiffResult } from '../types/textDiff';
import { api, saveTextFile } from '../services/api';

interface CompareModalProps {
  isOpen: boolean;
  onClose: () => void;
}

interface LoadedFile {
  name: string;
  text: string;
}

const MAX_ROWS = 2000;

const FilePicker: React.FC<{
  label: string;
  file: LoadedFile | null;
  onLoad: (f: LoadedFile) => void;
}> = ({ label, file, onLoad }) => (
  <label className="flex-1 flex items-center space-x-2 bg-[#1e2129] border border-gray-700/60 hover:border-gray-500 rounded-md px-3 py-2 text-xs cursor-pointer min-w-0">
    <FileText className="w-4 h-4 text-blue-400 flex-shrink-0" />
    <span className="text-gray-400 flex-shrink-0">{label}:</span>
    <span className="text-gray-200 truncate">{file ? file.name : 'Choose file…'}</span>
    <input
      type="file"
      className="hidden"
      onChange={async (e) => {
        const f = e.target.files?.[0];
        if (f) onLoad({ name: f.name, text: await f.text() });
        e.target.value = '';
      }}
    />
  </label>
);

export const CompareModal: React.FC<CompareModalProps> = ({ isOpen, onClose }) => {
  const [fileA, setFileA] = useState<LoadedFile | null>(null);
  const [fileB, setFileB] = useState<LoadedFile | null>(null);
  const [opts, setOpts] = useState<DiffOptions>({
    ignore_case: false,
    trim_whitespace: true,
    ignore_empty: true,
    delimiter: null,
    ignore_columns: [],
    trim_fields: true,
  });
  const [columnsText, setColumnsText] = useState('');
  const [showUnchanged, setShowUnchanged] = useState(false);
  const [limit, setLimit] = useState(MAX_ROWS);
  const [status, setStatus] = useState('');

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, onClose]);

  const [result, setResult] = useState<DiffResult | null>(null);

  useEffect(() => {
    if (!fileA || !fileB) {
      setResult(null);
      return;
    }
    let cancelled = false;
    api
      .compareTexts(fileA.text, fileB.text, opts)
      .then((r) => !cancelled && setResult(r))
      .catch((e) => !cancelled && setStatus(`Compare failed: ${e}`));
    return () => {
      cancelled = true;
    };
  }, [fileA, fileB, opts]);

  useEffect(() => {
    setLimit(MAX_ROWS);
    setStatus('');
  }, [result, showUnchanged]);

  if (!isOpen) return null;

  const rows = result
    ? showUnchanged
      ? result.rows
      : result.rows.filter((r) => r.left?.kind === 'removed' || r.right?.kind === 'added')
    : [];
  const changeCount = result ? result.removed + result.added : 0;

  const handleExport = async () => {
    if (!result) return;
    try {
      const saved = await saveTextFile('changes.txt', result.changes_text);
      if (saved) setStatus(`Saved to ${saved}`);
    } catch (e) {
      setStatus(`Export failed: ${e}`);
    }
  };

  const toggle = (key: 'ignore_case' | 'trim_whitespace' | 'ignore_empty' | 'trim_fields', label: string) => (
    <label className="flex items-center space-x-1.5 text-xs text-gray-300 cursor-pointer">
      <input type="checkbox" checked={opts[key]} onChange={(e) => setOpts({ ...opts, [key]: e.target.checked })} />
      <span>{label}</span>
    </label>
  );

  const style: Record<DiffKind, string> = {
    removed: 'bg-rose-500/15 text-rose-200',
    added: 'bg-emerald-500/15 text-emerald-200',
    unchanged: 'text-gray-500',
  };
  const sign: Record<DiffKind, string> = { removed: '-', added: '+', unchanged: ' ' };

  const renderCell = (c: Cell | null | undefined) => (
    <div className={`flex min-w-0 px-2 py-0.5 whitespace-pre-wrap break-all ${c ? style[c.kind] : 'bg-gray-800/20'}`}>
      {c && (
        <>
          <span className="w-10 flex-shrink-0 text-right pr-2 text-gray-600 select-none">{c.line}</span>
          <span className="w-4 flex-shrink-0 select-none">{sign[c.kind]}</span>
          <span className="flex-1 min-w-0">{c.text}</span>
        </>
      )}
    </div>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
      <div className="w-full h-full flex flex-col bg-[#181a20] overflow-hidden">
        <div className="flex items-center justify-between p-4 border-b border-gray-800/80">
          <h3 className="text-sm font-semibold text-gray-100">Compare text files (entry-based, order-independent)</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-200 p-1 rounded hover:bg-gray-800">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-4 space-y-3 border-b border-gray-800/80">
          <div className="flex space-x-3">
            <FilePicker label="Original" file={fileA} onLoad={setFileA} />
            <FilePicker label="Modified" file={fileB} onLoad={setFileB} />
          </div>
          <div className="flex items-center space-x-4">
            {toggle('trim_whitespace', 'Trim whitespace')}
            {toggle('ignore_case', 'Ignore case')}
            {toggle('ignore_empty', 'Ignore empty lines')}
            <label className="flex items-center space-x-1.5 text-xs text-gray-300 cursor-pointer">
              <input type="checkbox" checked={showUnchanged} onChange={(e) => setShowUnchanged(e.target.checked)} />
              <span>Show unchanged</span>
            </label>
          </div>
          <div className="flex items-center space-x-4 text-xs text-gray-300">
            <label className="flex items-center space-x-1.5">
              <span>Delimiter</span>
              <select
                className="bg-[#1e2129] border border-gray-700/60 rounded px-1.5 py-0.5"
                value={opts.delimiter ?? ''}
                onChange={(e) => setOpts({ ...opts, delimiter: e.target.value || null })}
              >
                <option value="">None (whole line)</option>
                <option value="|">| (pipe)</option>
                <option value=",">, (comma)</option>
              </select>
            </label>
            {opts.delimiter && (
              <>
                <label className="flex items-center space-x-1.5">
                  <span>Ignore columns (0-based)</span>
                  <input
                    className="w-24 bg-[#1e2129] border border-gray-700/60 rounded px-1.5 py-0.5"
                    placeholder="0,3"
                    value={columnsText}
                    onChange={(e) => {
                      setColumnsText(e.target.value);
                      setOpts({
                        ...opts,
                        ignore_columns: e.target.value
                          .split(',')
                          .map((v) => v.trim())
                          .filter((v) => /^\d+$/.test(v))
                          .map(Number),
                      });
                    }}
                  />
                </label>
                {toggle('trim_fields', 'Trim fields')}
              </>
            )}
          </div>
        </div>

        <div className="flex-1 overflow-auto font-mono text-xs bg-[#14161b]">
          {!result ? (
            <div className="p-6 text-gray-500 text-center">Choose two files to compare.</div>
          ) : rows.length === 0 ? (
            <div className="p-6 text-gray-500 text-center">No changed entries.</div>
          ) : (
            <>
              <div className="sticky top-0 grid grid-cols-2 gap-px bg-gray-800 text-gray-400 z-10">
                <div className="bg-[#1e2129] px-3 py-1 truncate">{fileA?.name} (original)</div>
                <div className="bg-[#1e2129] px-3 py-1 truncate">{fileB?.name} (modified)</div>
              </div>
              {rows.slice(0, limit).map((r, i) => (
                <div key={i} className="grid grid-cols-2 gap-px bg-gray-800/60">
                  {renderCell(r.left)}
                  {renderCell(r.right)}
                </div>
              ))}
              {rows.length > limit && (
                <button
                  onClick={() => setLimit(limit + MAX_ROWS)}
                  className="w-full py-2 text-blue-400 hover:bg-gray-800/60"
                >
                  Show more ({rows.length - limit} remaining)
                </button>
              )}
            </>
          )}
        </div>

        <div className="flex items-center justify-between p-3 px-4 bg-[#14161b] border-t border-gray-800/80">
          <div className="text-xs text-gray-400">
            {result && (
              <>
                <span className="text-rose-400">−{result.removed}</span>{' '}
                <span className="text-emerald-400">+{result.added}</span>{' '}
                <span>· {result.unchanged} unchanged</span>
              </>
            )}
            {status && <span className="ml-3 text-gray-300">{status}</span>}
          </div>
          <button
            onClick={handleExport}
            disabled={!result || changeCount === 0}
            className="flex items-center space-x-1.5 px-3.5 py-1.5 rounded text-xs font-medium text-white bg-blue-600 hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Export changes</span>
          </button>
        </div>
      </div>
    </div>
  );
};
