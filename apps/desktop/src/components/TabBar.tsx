import React, { useEffect, useRef, useState } from 'react';
import {
  Plus,
  X,
  Pin,
  PinOff,
  PanelRightClose,
  PanelLeftClose,
  Layers,
  CopyX,
} from 'lucide-react';
import { TabItem } from '../types';
import { getMethodBadgeClass } from './Sidebar';

interface TabBarProps {
  tabs: TabItem[];
  activeTabId?: string;
  onSelectTab: (tabId: string) => void;
  onCloseTab: (tabId: string) => void;
  onNewTab: () => void;
  onTogglePin: (tabId: string) => void;
  onCloseOthers: (tabId: string) => void;
  onCloseToRight: (tabId: string) => void;
  onCloseToLeft: (tabId: string) => void;
  onCloseAll: () => void;
}

type MenuItem =
  | { separator: true }
  | {
      label: string;
      icon: React.ComponentType<{ className?: string }>;
      disabled?: boolean;
      danger?: boolean;
      onClick: () => void;
    };

interface MenuState {
  x: number;
  y: number;
  tabId: string;
  items: MenuItem[];
}

const TabContextMenu: React.FC<{ menu: MenuState; onClose: () => void }> = ({ menu, onClose }) => {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x: menu.x, y: menu.y });

  useEffect(() => {
    const el = ref.current;
    if (el) {
      const r = el.getBoundingClientRect();
      setPos({
        x: Math.max(4, Math.min(menu.x, window.innerWidth - r.width - 4)),
        y: Math.max(4, Math.min(menu.y, window.innerHeight - r.height - 4)),
      });
    }
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    window.addEventListener('blur', onClose);
    window.addEventListener('resize', onClose);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('blur', onClose);
      window.removeEventListener('resize', onClose);
    };
  }, [menu, onClose]);

  return (
    <div
      ref={ref}
      style={{ left: pos.x, top: pos.y }}
      onContextMenu={(e) => e.preventDefault()}
      className="fixed z-50 min-w-[188px] py-1 rounded-md border border-gray-700 bg-[#1e2129] shadow-xl shadow-black/50 text-xs"
    >
      {menu.items.map((item, i) =>
        'separator' in item && item.separator ? (
          <div key={i} className="my-1 border-t border-gray-700/70" />
        ) : (
          <button
            key={i}
            disabled={'disabled' in item && item.disabled}
            onClick={(e) => {
              e.stopPropagation();
              if ('disabled' in item && item.disabled) return;
              onClose();
              if ('onClick' in item) item.onClick();
            }}
            className={`w-full flex items-center gap-2 px-3 py-1.5 text-left transition-colors disabled:opacity-40 disabled:pointer-events-none ${
              'danger' in item && item.danger
                ? 'text-rose-400 hover:bg-rose-900/40'
                : 'text-gray-200 hover:bg-gray-700/60'
            }`}
          >
            {'icon' in item && item.icon ? <item.icon className="w-3.5 h-3.5 flex-shrink-0" /> : null}
            {'label' in item ? item.label : null}
          </button>
        )
      )}
    </div>
  );
};

export const TabBar: React.FC<TabBarProps> = ({
  tabs,
  activeTabId,
  onSelectTab,
  onCloseTab,
  onNewTab,
  onTogglePin,
  onCloseOthers,
  onCloseToRight,
  onCloseToLeft,
  onCloseAll,
}) => {
  const [menu, setMenu] = useState<MenuState | null>(null);

  const openMenu = (e: React.MouseEvent, tab: TabItem) => {
    e.preventDefault();
    e.stopPropagation();
    const idx = tabs.findIndex((t) => t.id === tab.id);
    const leftCloseable = tabs.slice(0, idx).some((t) => !t.pinned);
    const rightCloseable = tabs.slice(idx + 1).some((t) => !t.pinned);
    const othersCloseable = tabs.some((t) => t.id !== tab.id && !t.pinned);
    const anyCloseable = tabs.some((t) => !t.pinned);

    setMenu({
      x: e.clientX,
      y: e.clientY,
      tabId: tab.id,
      items: [
        {
          label: tab.pinned ? 'Unpin Tab' : 'Pin Tab',
          icon: tab.pinned ? PinOff : Pin,
          onClick: () => onTogglePin(tab.id),
        },
        { separator: true },
        {
          label: 'Close',
          icon: X,
          onClick: () => onCloseTab(tab.id),
        },
        {
          label: 'Close Others',
          icon: CopyX,
          disabled: !othersCloseable,
          onClick: () => onCloseOthers(tab.id),
        },
        {
          label: 'Close to the Left',
          icon: PanelLeftClose,
          disabled: !leftCloseable,
          onClick: () => onCloseToLeft(tab.id),
        },
        {
          label: 'Close to the Right',
          icon: PanelRightClose,
          disabled: !rightCloseable,
          onClick: () => onCloseToRight(tab.id),
        },
        {
          label: 'Close All',
          icon: Layers,
          disabled: !anyCloseable,
          danger: true,
          onClick: () => onCloseAll(),
        },
      ],
    });
  };

  return (
    <div className="h-9 border-b border-gray-800 bg-[#14161b] flex items-center px-1 overflow-x-auto select-none no-scrollbar">
      <div className="flex items-center space-x-1 flex-1 overflow-x-auto">
        {tabs.map((tab) => {
          const isActive = tab.id === activeTabId;
          return (
            <div
              key={tab.id}
              onClick={() => onSelectTab(tab.id)}
              onContextMenu={(e) => openMenu(e, tab)}
              onAuxClick={(e) => {
                // Middle-click closes (unless pinned — unpin first via menu).
                if (e.button === 1 && !tab.pinned) {
                  e.preventDefault();
                  onCloseTab(tab.id);
                }
              }}
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

              {tab.pinned ? (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onTogglePin(tab.id);
                  }}
                  title="Unpin tab"
                  className="opacity-70 hover:opacity-100 p-0.5 rounded hover:bg-gray-700/60 text-amber-400/90 hover:text-amber-300 transition-opacity"
                >
                  <Pin className="w-3 h-3 fill-current" />
                </button>
              ) : (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onCloseTab(tab.id);
                  }}
                  title="Close tab"
                  className="opacity-0 group-hover:opacity-60 hover:!opacity-100 p-0.5 rounded hover:bg-gray-700/60 text-gray-400 hover:text-gray-200 transition-opacity"
                >
                  <X className="w-3 h-3" />
                </button>
              )}
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

      {menu && <TabContextMenu menu={menu} onClose={() => setMenu(null)} />}
    </div>
  );
};
