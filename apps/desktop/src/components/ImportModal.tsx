import React, { useState, useRef } from 'react';
import { X, Upload, AlertTriangle, CheckCircle, FileCode, ArrowRight } from 'lucide-react';
import { ImportResult } from '../types';
import { api } from '../services/api';
import { CodeEditor } from './CodeEditor';

interface ImportModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (result: ImportResult) => void;
}

export const ImportModal: React.FC<ImportModalProps> = ({
  isOpen,
  onClose,
  onSuccess,
}) => {
  const [jsonText, setJsonText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<ImportResult | null>(null);
  const [loading, setLoading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  if (!isOpen) return null;

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const content = event.target?.result as string;
      setJsonText(content);
      parsePreview(content);
    };
    reader.readAsText(file);
  };

  const parsePreview = async (content: string) => {
    setError(null);
    setPreview(null);
    if (!content.trim()) return;

    try {
      // Validate json syntax first
      JSON.parse(content);
      // Run import through backend Rust engine
      const res = await api.importPostmanCollection(content);
      setPreview(res);
    } catch (e: any) {
      setError(e.message || 'Failed to parse Postman collection JSON');
    }
  };

  const handleImport = async () => {
    if (!preview) return;
    setLoading(true);
    try {
      // Finalize import
      onSuccess(preview);
      onClose();
    } catch (e: any) {
      setError(e.message || 'Import failed');
    } finally {
      setLoading(false);
    }
  };

  const countTotalRequests = (col: ImportResult['collection']): number => {
    let count = col.requests.length;
    const countFolder = (folders: typeof col.folders) => {
      for (const f of folders) {
        count += f.requests.length;
        countFolder(f.folders);
      }
    };
    countFolder(col.folders);
    return count;
  };

  const countTotalFolders = (col: ImportResult['collection']): number => {
    let count = col.folders.length;
    const countFolder = (folders: typeof col.folders) => {
      for (const f of folders) {
        count += f.folders.length;
        countFolder(f.folders);
      }
    };
    countFolder(col.folders);
    return count;
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-[#181a20] border border-gray-800 rounded-xl w-full max-w-2xl max-h-[90vh] flex flex-col shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="p-3 border-b border-gray-800 flex items-center justify-between bg-[#15171d]">
          <div className="flex items-center space-x-2">
            <Upload className="w-4 h-4 text-blue-400" />
            <span className="font-semibold text-sm text-gray-200">
              Import Postman Collection (v2.1)
            </span>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded hover:bg-gray-800 text-gray-400 hover:text-gray-200"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4 text-xs">
          {/* File Picker / Drag Area */}
          <div
            onClick={() => fileInputRef.current?.click()}
            className="border-2 border-dashed border-gray-700/80 hover:border-blue-500/80 bg-[#14161b] rounded-lg p-5 flex flex-col items-center justify-center cursor-pointer transition-colors"
          >
            <input
              type="file"
              ref={fileInputRef}
              onChange={handleFileChange}
              accept=".json,application/json"
              className="hidden"
            />
            <FileCode className="w-8 h-8 text-blue-400 mb-2" />
            <p className="text-xs font-medium text-gray-200">
              Choose a Postman Collection JSON file
            </p>
            <p className="text-[11px] text-gray-500 mt-1">
              Supports Postman Collection format v2.1.0
            </p>
          </div>

          {/* Paste JSON */}
          <div className="space-y-1">
            <label className="text-gray-400 font-medium text-[11px]">Or paste JSON here</label>
            <div className="h-44">
              <CodeEditor
                value={jsonText}
                language="json"
                onChange={(val) => {
                  setJsonText(val);
                  parsePreview(val);
                }}
              />
            </div>
          </div>

          {/* Error Banner */}
          {error && (
            <div className="p-3 bg-rose-950/40 border border-rose-800 text-rose-300 rounded text-xs flex items-start space-x-2">
              <AlertTriangle className="w-4 h-4 text-rose-400 flex-shrink-0 mt-0.5" />
              <div>
                <p className="font-semibold text-rose-200">Import Error</p>
                <p className="text-[11px] font-mono mt-0.5">{error}</p>
              </div>
            </div>
          )}

          {/* Preview Box */}
          {preview && (
            <div className="space-y-3 border border-gray-800 rounded-lg p-3 bg-[#14161b]">
              <div className="flex items-center justify-between border-b border-gray-800 pb-2">
                <div className="flex items-center space-x-2">
                  <CheckCircle className="w-4 h-4 text-emerald-400" />
                  <span className="font-bold text-gray-200">{preview.collection.name}</span>
                </div>
                <div className="flex items-center space-x-3 text-[11px] text-gray-400 font-mono">
                  <span>{countTotalFolders(preview.collection)} folders</span>
                  <span>{countTotalRequests(preview.collection)} requests</span>
                  <span>{preview.collection.variables.length} variables</span>
                </div>
              </div>

              {/* Warnings List */}
              {preview.warnings.length > 0 && (
                <div className="space-y-1.5 pt-1">
                  <p className="text-[11px] font-semibold text-amber-400 flex items-center space-x-1">
                    <AlertTriangle className="w-3.5 h-3.5" />
                    <span>{preview.warnings.length} Unsupported Feature(s) Detected</span>
                  </p>
                  <div className="max-h-28 overflow-y-auto space-y-1 pr-1 font-mono text-[11px]">
                    {preview.warnings.map((w, idx) => (
                      <div
                        key={idx}
                        className="bg-amber-950/30 border border-amber-900/40 text-amber-200/90 px-2 py-1 rounded"
                      >
                        {w.message}
                      </div>
                    ))}
                  </div>
                  <p className="text-[10px] text-gray-500">
                    Note: Pre-request/test scripts, unsupported authentication schemes, and runner metadata are omitted. All requests, URLs, headers, bodies, and variables are preserved.
                  </p>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-3 border-t border-gray-800 flex justify-end space-x-2 bg-[#15171d]">
          <button
            onClick={onClose}
            className="px-3 py-1.5 rounded text-xs text-gray-400 hover:text-gray-200 hover:bg-gray-800 transition-colors"
          >
            Cancel
          </button>
          <button
            disabled={!preview || loading}
            onClick={handleImport}
            className={`flex items-center space-x-1.5 px-4 py-1.5 rounded text-xs font-semibold text-white shadow-md transition-all ${
              preview && !loading
                ? 'bg-blue-600 hover:bg-blue-500 shadow-blue-500/20'
                : 'bg-gray-800 text-gray-500 cursor-not-allowed border border-gray-700'
            }`}
          >
            <span>Import Collection</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
};
