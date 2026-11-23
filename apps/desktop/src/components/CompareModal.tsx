import React, { useEffect, useMemo, useRef, useState } from 'react';
import { X, FileText, Download, Filter } from 'lucide-react';
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
  const [split, setSplit] = useState(50);
  const panesRef = useRef<HTMLDivElement>(null);
  const [columnsOpen, setColumnsOpen] = useState(false);
  const [showUnchanged, setShowUnchanged] = useState(false);
  const [limit, setLimit] = useState(MAX_ROWS);
  const [status, setStatus] = useState('');

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, onClose]);

  // The first non-empty line of each file is treated as the header for column names.
  const columns = useMemo(() => {
    if (!opts.delimiter) return [];
    const header = (f: LoadedFile | null) =>
      (f?.text.split(/\r?\n/).find((l) => l.trim() !== '') ?? '').split(opts.delimiter!).map((c) => c.trim());
    const a = header(fileA);
    const b = header(fileB);
    const n = Math.max(a.length, b.length);
    return Array.from({ length: n }, (_, i) => a[i] || b[i] || `Column ${i}`);
  }, [fileA, fileB, opts.delimiter]);

  const startDrag = (e: React.MouseEvent) => {
    e.preventDefault();
    const onMove = (ev: MouseEvent) => {
      const rect = panesRef.current?.getBoundingClientRect();
      if (!rect) return;
      setSplit(Math.min(90, Math.max(10, ((ev.clientX - rect.left) / rect.width) * 100)));
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      document.body.style.userSelect = '';
    };
    document.body.style.userSelect = 'none';
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };
  const gridStyle = { gridTemplateColumns: `minmax(0, ${split}fr) minmax(0, ${100 - split}fr)` };

  const toggleColumn = (i: number, included: boolean) =>
    setOpts({
      ...opts,
      ignore_columns: included ? opts.ignore_columns.filter((c) => c !== i) : [...opts.ignore_columns, i],
    });

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

  // Fixed per-column widths (in ch) so delimited rows line up like a table.
  const colWidths = useMemo(() => {
    const d = opts.delimiter;
    if (!d || !result) return null;
    const widths: number[] = [];
    for (const r of result.rows) {
      for (const c of [r.left, r.right]) {
        if (!c) continue;
        c.text.split(d).forEach((f, i) => {
          const len = (opts.trim_fields ? f.trim() : f).length;
          widths[i] = Math.min(Math.max(widths[i] ?? 0, len), 40);
        });
      }
    }
    return widths;
  }, [result, opts.delimiter, opts.trim_fields]);

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

  const renderText = (c: Cell) => {
    const d = opts.delimiter;
    if (!d || !colWidths) return <span className="flex-1 min-w-0 whitespace-pre-wrap break-all">{c.text}</span>;
    return (
      <span className="flex-1 min-w-0 flex overflow-hidden">
        {c.text.split(d).map((f, i) => (
          <span
            key={i}
            title={f.trim()}
            className={`flex-shrink-0 truncate pr-3 whitespace-pre ${opts.ignore_columns.includes(i) ? 'opacity-40' : ''}`}
            style={{ width: `${(colWidths[i] ?? 0) + 3}ch` }}
          >
            {opts.trim_fields ? f.trim() : f}
          </span>
        ))}
      </span>
    );
  };

  const renderCell = (c: Cell | null | undefined) => (
    <div className={`flex min-w-0 px-2 py-0.5 ${c ? style[c.kind] : 'bg-gray-800/20'}`}>
      {c && (
        <>
          <span className="w-10 flex-shrink-0 text-right pr-2 text-gray-600 select-none">{c.line}</span>
          <span className="w-4 flex-shrink-0 select-none">{sign[c.kind]}</span>
          {renderText(c)}
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
                onChange={(e) => setOpts({ ...opts, delimiter: e.target.value || null, ignore_columns: [] })}
              >
                <option value="">None (whole line)</option>
                <option value="|">| (pipe)</option>
                <option value=",">, (comma)</option>
              </select>
            </label>
            {opts.delimiter && (
              <>
                <div className="relative">
                  <button
                    type="button"
                    onClick={() => setColumnsOpen((o) => !o)}
                    className="flex items-center space-x-1.5 bg-[#1e2129] hover:bg-gray-700/70 border border-gray-700/60 rounded px-2 py-0.5"
                  >
                    <Filter className="w-3.5 h-3.5 text-blue-400" />
                    <span>
                      Key columns ({Math.max(columns.length - opts.ignore_columns.filter((c) => c < columns.length).length, 0)}/
                      {columns.length})
                    </span>
                  </button>
                  {columnsOpen && (
                    <div className="absolute left-0 top-full mt-1 z-20 w-72 max-h-80 flex flex-col bg-[#1e2129] border border-gray-700 rounded-md shadow-2xl">
                      <div className="flex items-center justify-between px-3 py-2 border-b border-gray-700/60">
                        <span className="text-gray-400">Columns in uniqueness key</span>
                        <div className="space-x-2">
                          <button className="text-blue-400 hover:underline" onClick={() => setOpts({ ...opts, ignore_columns: [] })}>
                            All
                          </button>
                          <button
                            className="text-blue-400 hover:underline"
                            onClick={() => setOpts({ ...opts, ignore_columns: columns.map((_, i) => i) })}
                          >
                            None
                          </button>
                        </div>
                      </div>
                      <div className="overflow-auto py-1">
                        {columns.map((name, i) => (
                          <label key={i} className="flex items-center space-x-2 px-3 py-1 hover:bg-gray-700/40 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={!opts.ignore_columns.includes(i)}
                              onChange={(e) => toggleColumn(i, e.target.checked)}
                            />
                            <span className="text-gray-500 w-6 text-right">{i}</span>
                            <span className="truncate">{name}</span>
                          </label>
                        ))}
                        {columns.length === 0 && <div className="px-3 py-2 text-gray-500">Load a file to list columns.</div>}
                      </div>
                    </div>
                  )}
                </div>
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
            <div ref={panesRef} className="relative">
              <div
                onMouseDown={startDrag}
                onDoubleClick={() => setSplit(50)}
                title="Drag to resize (double-click to reset)"
                className="absolute top-0 bottom-0 w-2 -ml-1 z-20 cursor-col-resize hover:bg-blue-500/40"
                style={{ left: `${split}%` }}
              />
              <div className="sticky top-0 grid gap-px bg-gray-800 text-gray-400 z-10" style={gridStyle}>
                <div className="bg-[#1e2129] px-3 py-1 truncate">{fileA?.name} (original)</div>
                <div className="bg-[#1e2129] px-3 py-1 truncate">{fileB?.name} (modified)</div>
              </div>
              {rows.slice(0, limit).map((r, i) => (
                <div key={i} className="grid gap-px bg-gray-800/60" style={gridStyle}>
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
            </div>
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
