import React from 'react';
import { Plus, X } from 'lucide-react';
import { TabItem } from '../types';
import { getMethodBadgeClass } from './Sidebar';

interface TabBarProps {
  tabs: TabItem[];
  activeTabId?: string;
  onSelectTab: (tabId: string) => void;
  onCloseTab: (tabId: string, e: React.MouseEvent) => void;
  onNewTab: () => void;
}

export const TabBar: React.FC<TabBarProps> = ({
  tabs,
  activeTabId,
  onSelectTab,
  onCloseTab,
  onNewTab,
}) => {
  return (
    <div className="h-9 border-b border-gray-800 bg-[#14161b] flex items-center px-1 overflow-x-auto select-none no-scrollbar">
      <div className="flex items-center space-x-1 flex-1 overflow-x-auto">
        {tabs.map((tab) => {
          const isActive = tab.id === activeTabId;
          return (
            <div
              key={tab.id}
              onClick={() => onSelectTab(tab.id)}
              className={`group flex items-center space-x-2 px-3 py-1.5 text-xs rounded-t-md cursor-pointer border-t-2 transition-all max-w-[200px] flex-shrink-0 ${
                isActive
                  ? 'bg-[#181a20] border-blue-500 text-white font-medium shadow-sm'
                  : 'bg-transparent border-transparent text-gray-400 hover:bg-gray-800/40 hover:text-gray-200'
              }`}
            >
              <span
                className={`font-mono text-[9px] px-1 py-0.2 rounded font-semibold border ${getMethodBadgeClass(
                  tab.request.method
                )}`}
              >
                {tab.request.method}
              </span>

              <span className="truncate flex-1 text-[11px]">{tab.request.name || 'Untitled Request'}</span>

              {tab.is_dirty && (
                <span className="w-1.5 h-1.5 rounded-full bg-blue-400 flex-shrink-0" title="Unsaved changes" />
              )}

              <button
                onClick={(e) => onCloseTab(tab.id, e)}
                className="opacity-60 hover:opacity-100 p-0.5 rounded hover:bg-gray-700/60 text-gray-400 hover:text-gray-200 transition-opacity"
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          );
        })}

        <button
          onClick={onNewTab}
          title="New Request Tab (⌘T)"
          className="p-1.5 hover:bg-gray-800 rounded text-gray-400 hover:text-gray-200 transition-colors ml-1"
        >
          <Plus className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
};
