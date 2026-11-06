import React from 'react';
import { Send, Upload, Settings, Layers } from 'lucide-react';
import { Environment } from '../types';

interface HeaderProps {
  environments: Environment[];
  activeEnvironmentId: string | undefined;
  onSelectEnvironment: (id: string | undefined) => void;
  onOpenEnvironmentModal: () => void;
  onOpenImportModal: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  environments,
  activeEnvironmentId,
  onSelectEnvironment,
  onOpenEnvironmentModal,
  onOpenImportModal,
}) => {
  return (
    <header className="h-12 border-b border-gray-800 bg-[#16181d] px-4 flex items-center justify-between select-none">
      <div className="flex items-center space-x-3">
        <div className="flex items-center space-x-2">
          <div className="w-7 h-7 rounded-lg bg-blue-600 flex items-center justify-center font-bold text-white shadow-md shadow-blue-500/20">
            <Send className="w-4 h-4" />
          </div>
          <span className="font-semibold text-gray-100 tracking-wide text-sm flex items-center gap-1.5">
            EZMan
            <span className="text-[10px] uppercase font-mono px-1.5 py-0.5 rounded bg-blue-900/50 text-blue-300 border border-blue-700/50">
              Desktop & MCP
            </span>
          </span>
        </div>
      </div>

      <div className="flex items-center space-x-3">
        {/* Environment Selector */}
        <div className="flex items-center space-x-1.5 bg-[#1e2129] border border-gray-700/60 rounded-md px-2 py-1 text-xs">
          <Layers className="w-3.5 h-3.5 text-gray-400" />
          <select
            className="bg-transparent text-gray-200 outline-none cursor-pointer pr-2 text-xs"
            value={activeEnvironmentId || ''}
            onChange={(e) => onSelectEnvironment(e.target.value || undefined)}
          >
            <option value="" className="bg-[#1e2129] text-gray-400">
              No Environment
            </option>
            {environments.map((env) => (
              <option key={env.id} value={env.id} className="bg-[#1e2129] text-gray-200">
                {env.name}
              </option>
            ))}
          </select>

          <button
            title="Manage Environments"
            onClick={onOpenEnvironmentModal}
            className="p-1 hover:bg-gray-700/60 rounded text-gray-400 hover:text-gray-200 transition-colors"
          >
            <Settings className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Import Collection */}
        <button
          onClick={onOpenImportModal}
          className="flex items-center space-x-1.5 bg-[#1e2129] hover:bg-gray-700/70 border border-gray-700/60 text-gray-200 px-2.5 py-1.5 rounded-md text-xs font-medium transition-colors"
        >
          <Upload className="w-3.5 h-3.5 text-blue-400" />
          <span>Import Postman</span>
        </button>

        {/* Shortcut Hint */}
        <div className="hidden lg:flex items-center space-x-1 text-[11px] text-gray-500 font-mono">
          <span className="px-1.5 py-0.5 rounded bg-gray-800 border border-gray-700 text-gray-400">⌘/Ctrl Enter</span>
          <span>Send</span>
        </div>
      </div>
    </header>
  );
};
