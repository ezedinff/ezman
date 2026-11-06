import React, { useState, useRef, useEffect } from 'react';
import {
  Folder as FolderIcon,
  FolderOpen,
  ChevronRight,
  ChevronDown,
  Plus,
  Trash2,
  Copy,
  Variable,
  Search,
  FilePlus,
  FolderPlus,
  Pencil,
  MoreHorizontal,
  ChevronsDownUp,
  X,
  Pin,
  PinOff,
} from 'lucide-react';
import { Collection, Folder, HttpMethod, RequestItem } from '../types';

interface SidebarProps {
  width: number;
  collections: Collection[];
  activeRequestId?: string;
  onSelectRequest: (request: RequestItem, collectionId?: string) => void;
  onCreateCollection: () => void;
  onCreateRequest: (collectionId?: string, folderId?: string) => void;
  onCreateFolder: (collectionId: string, parentFolderId?: string) => void;
  onDeleteCollection: (collectionId: string) => void;
  onDeleteFolder: (collectionId: string, folderId: string) => void;
  onDeleteRequest: (requestId: string, collectionId: string) => void;
  onDuplicateRequest: (request: RequestItem, collectionId: string) => void;
  onRenameCollection: (collectionId: string, newName: string) => void;
  onRenameFolder: (collectionId: string, folderId: string, newName: string) => void;
  onRenameRequest: (collectionId: string, requestId: string, newName: string) => void;
  onOpenCollectionVariables: (collection: Collection) => void;
  onMoveItem: (
    source: { type: 'request' | 'folder'; id: string; colId: string },
    target: { colId: string; folderId?: string; beforeRequestId?: string }
  ) => void;
}

export const getMethodBadgeClass = (method: HttpMethod): string => {
  switch (method) {
    case 'GET':
      return 'text-emerald-400 bg-emerald-950/60 border-emerald-800/50';
    case 'POST':
      return 'text-blue-400 bg-blue-950/60 border-blue-800/50';
    case 'PUT':
      return 'text-amber-400 bg-amber-950/60 border-amber-800/50';
    case 'PATCH':
      return 'text-purple-400 bg-purple-950/60 border-purple-800/50';
    case 'DELETE':
      return 'text-rose-400 bg-rose-950/60 border-rose-800/50';
    case 'HEAD':
      return 'text-indigo-400 bg-indigo-950/60 border-indigo-800/50';
    case 'OPTIONS':
      return 'text-gray-400 bg-gray-800/60 border-gray-700/50';
    default:
      return 'text-gray-400 bg-gray-800 border-gray-700';
  }
};

type MenuItem =
  | { separator: true }
  | {
      separator?: false;
      label: string;
      icon: React.ComponentType<{ className?: string }>;
      danger?: boolean;
      onClick: () => void;
    };

interface MenuState {
  x: number;
  y: number;
  items: MenuItem[];
}

const ContextMenu: React.FC<{ menu: MenuState; onClose: () => void }> = ({ menu, onClose }) => {
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
      className="fixed z-50 min-w-[176px] py-1 rounded-md border border-gray-700 bg-[#1e2129] shadow-xl shadow-black/50 text-xs"
    >
      {menu.items.map((item, i) =>
        item.separator ? (
          <div key={i} className="my-1 border-t border-gray-700/70" />
        ) : (
          <button
            key={i}
            onClick={(e) => {
              e.stopPropagation();
              onClose();
              item.onClick();
            }}
            className={`w-full flex items-center gap-2 px-3 py-1.5 text-left transition-colors ${
              item.danger
                ? 'text-rose-400 hover:bg-rose-900/40'
                : 'text-gray-200 hover:bg-gray-700/60'
            }`}
          >
            <item.icon className="w-3.5 h-3.5 flex-shrink-0" />
            {item.label}
          </button>
        )
      )}
    </div>
  );
};

const rowBtn =
  'p-1 rounded text-gray-400 hover:bg-gray-700 hover:text-gray-100 transition-colors';

export const Sidebar: React.FC<SidebarProps> = ({
  width,
  collections,
  activeRequestId,
  onSelectRequest,
  onCreateCollection,
  onCreateRequest,
  onCreateFolder,
  onDeleteCollection,
  onDeleteFolder,
  onDeleteRequest,
  onDuplicateRequest,
  onRenameCollection,
  onRenameFolder,
  onRenameRequest,
  onOpenCollectionVariables,
  onMoveItem,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  // Everything is collapsed by default; only what the user opened is remembered.
  const [expandedItems, setExpandedItems] = useState<Record<string, boolean>>(() => {
    try {
      return JSON.parse(localStorage.getItem('ezman.expandedItems') || '{}');
    } catch {
      return {};
    }
  });
  useEffect(() => {
    const open = Object.fromEntries(Object.entries(expandedItems).filter(([, v]) => v));
    localStorage.setItem('ezman.expandedItems', JSON.stringify(open));
  }, [expandedItems]);

  const [pinned, setPinned] = useState<string[]>(() => {
    try {
      return JSON.parse(localStorage.getItem('ezman.pinned') || '[]');
    } catch {
      return [];
    }
  });
  useEffect(() => localStorage.setItem('ezman.pinned', JSON.stringify(pinned)), [pinned]);
  const togglePin = (id: string) =>
    setPinned((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  // Pinned branches only: collection > folder path > pinned item. Deleted pins drop out.
  type PinNode = { id: string; folder?: Folder; pinnedFolder: boolean; requests: RequestItem[]; children: PinNode[] };
  const pruneNode = (
    node: { folders: Folder[]; requests: RequestItem[] },
    id: string,
    folder?: Folder
  ): PinNode | null => {
    if (folder && pinned.includes(folder.id)) {
      return { id, folder, pinnedFolder: true, requests: [], children: [] };
    }
    const requests = node.requests.filter((r) => pinned.includes(r.id));
    const children = node.folders
      .map((f) => pruneNode(f, f.id, f))
      .filter((n): n is PinNode => n !== null);
    if (!requests.length && !children.length) return null;
    return { id, folder, pinnedFolder: false, requests, children };
  };
  const pinnedTree = collections
    .map((c) => ({ col: c, node: pruneNode(c, c.id) }))
    .filter((x): x is { col: Collection; node: PinNode } => x.node !== null);

  const [pinCollapsed, setPinCollapsed] = useState<Record<string, boolean>>({});

  const renderPinNode = (node: PinNode, colId: string, depth: number, label: string): React.ReactNode => {
    if (node.pinnedFolder) return renderFolder(node.folder!, colId, depth);
    const collapsed = pinCollapsed[node.id] ?? false;
    return (
      <div key={`pin-${node.id}`}>
        <div
          onClick={() => setPinCollapsed((p) => ({ ...p, [node.id]: !collapsed }))}
          style={{ paddingLeft: `${depth * 14 + 8}px` }}
          className="flex items-center gap-1.5 py-1.5 pr-2 cursor-pointer rounded text-xs text-gray-400 hover:bg-gray-800/50"
        >
          {collapsed ? (
            <ChevronRight className="w-3.5 h-3.5 flex-shrink-0" />
          ) : (
            <ChevronDown className="w-3.5 h-3.5 flex-shrink-0" />
          )}
          {node.folder && <FolderIcon className="w-3.5 h-3.5 text-amber-400/50 flex-shrink-0" />}
          <span className="truncate">{label}</span>
        </div>
        {!collapsed && (
          <div>
            {node.children.map((c) => renderPinNode(c, colId, depth + 1, c.folder?.name ?? ''))}
            {node.requests.map((r) => renderRequestItem(r, colId, depth + 1, true, node.folder?.id))}
          </div>
        )}
      </div>
    );
  };

  // Drag & drop: drop on a folder/collection moves inside; drop on a request inserts before it.
  const dragRef = useRef<{ type: 'request' | 'folder'; id: string; colId: string } | null>(null);
  const [dropKey, setDropKey] = useState<string | null>(null);
  const hoverTimer = useRef<number | undefined>(undefined);

  const dragProps = (type: 'request' | 'folder', id: string, colId: string) => ({
    draggable: editingId !== id,
    onDragStart: (e: React.DragEvent) => {
      e.stopPropagation();
      dragRef.current = { type, id, colId };
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', id);
    },
    onDragEnd: () => {
      dragRef.current = null;
      setDropKey(null);
      window.clearTimeout(hoverTimer.current);
    },
  });

  const dropProps = (
    key: string,
    target: { colId: string; folderId?: string; beforeRequestId?: string },
    expandId?: string
  ) => ({
    onDragOver: (e: React.DragEvent) => {
      if (!dragRef.current) return;
      e.preventDefault();
      e.stopPropagation();
      e.dataTransfer.dropEffect = 'move';
      if (dropKey !== key) {
        setDropKey(key);
        window.clearTimeout(hoverTimer.current);
        if (expandId && !isOpen(expandId)) {
          hoverTimer.current = window.setTimeout(
            () => setExpandedItems((p) => ({ ...p, [expandId]: true })),
            700
          );
        }
      }
    },
    onDragLeave: (e: React.DragEvent) => {
      if (!e.currentTarget.contains(e.relatedTarget as Node)) {
        setDropKey((k) => (k === key ? null : k));
      }
    },
    onDrop: (e: React.DragEvent) => {
      const src = dragRef.current;
      if (!src) return;
      e.preventDefault();
      e.stopPropagation();
      dragRef.current = null;
      setDropKey(null);
      window.clearTimeout(hoverTimer.current);
      if (target.folderId || target.colId) {
        onMoveItem(src, target);
        if (expandId) setExpandedItems((p) => ({ ...p, [expandId]: true }));
      }
    },
  });

  const isSearching = searchQuery.trim().length > 0;
  const isOpen = (id: string) => isSearching || (expandedItems[id] ?? false);

  const countRequests = (folder: Folder): number =>
    folder.requests.length + folder.folders.reduce((n, f) => n + countRequests(f), 0);

  // Reveal the active request in the tree (only when the active request changes)
  useEffect(() => {
    if (!activeRequestId) return;
    const findIn = (folder: { folders: Folder[]; requests: RequestItem[] }, path: string[]): string[] | null => {
      if (folder.requests.some((r) => r.id === activeRequestId)) return path;
      for (const f of folder.folders) {
        const p = findIn(f, [...path, f.id]);
        if (p) return p;
      }
      return null;
    };
    for (const col of collections) {
      const path = findIn(col, [col.id]);
      if (path) {
        setExpandedItems((prev) => {
          if (path.every((id) => prev[id])) return prev;
          return { ...prev, ...Object.fromEntries(path.map((id) => [id, true])) };
        });
        requestAnimationFrame(() =>
          Array.from(document.querySelectorAll(`[data-request-id="${activeRequestId}"]`))
            .pop()
            ?.scrollIntoView({ block: 'nearest' })
        );
        break;
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeRequestId]);
  
  // Inline rename state: tracks which item is currently being edited
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const [menu, setMenu] = useState<MenuState | null>(null);

  const openMenu = (e: React.MouseEvent, items: MenuItem[]) => {
    e.preventDefault();
    e.stopPropagation();
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const fromButton = e.type === 'click';
    setMenu({
      x: fromButton ? rect.left : e.clientX,
      y: fromButton ? rect.bottom + 4 : e.clientY,
      items,
    });
  };

  const pinItem = (id: string): MenuItem =>
    pinned.includes(id)
      ? { label: 'Unpin', icon: PinOff, onClick: () => togglePin(id) }
      : { label: 'Pin to top', icon: Pin, onClick: () => togglePin(id) };

  const collectionMenu = (col: Collection): MenuItem[] => [
    { label: 'Variables & Auth', icon: Variable, onClick: () => onOpenCollectionVariables(col) },
    { separator: true },
    { label: 'Add request', icon: FilePlus, onClick: () => onCreateRequest(col.id) },
    { label: 'Add folder', icon: FolderPlus, onClick: () => onCreateFolder(col.id) },
    { label: 'Rename', icon: Pencil, onClick: () => startRename(col.id, col.name) },
    { separator: true },
    { label: 'Delete', icon: Trash2, danger: true, onClick: () => onDeleteCollection(col.id) },
  ];

  const folderMenu = (folder: Folder, colId: string): MenuItem[] => [
    pinItem(folder.id),
    { separator: true },
    { label: 'Add request', icon: FilePlus, onClick: () => onCreateRequest(colId, folder.id) },
    { label: 'Add folder', icon: FolderPlus, onClick: () => onCreateFolder(colId, folder.id) },
    { separator: true },
    { label: 'Rename', icon: Pencil, onClick: () => startRename(folder.id, folder.name) },
    { separator: true },
    { label: 'Delete', icon: Trash2, danger: true, onClick: () => onDeleteFolder(colId, folder.id) },
  ];

  const requestMenu = (req: RequestItem, colId: string): MenuItem[] => [
    pinItem(req.id),
    { separator: true },
    { label: 'Rename', icon: Pencil, onClick: () => startRename(req.id, req.name) },
    { label: 'Duplicate', icon: Copy, onClick: () => onDuplicateRequest(req, colId) },
    { separator: true },
    { label: 'Delete', icon: Trash2, danger: true, onClick: () => onDeleteRequest(req.id, colId) },
  ];

  useEffect(() => {
    if (editingId && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editingId]);

  const toggleExpand = (id: string, e?: React.MouseEvent) => {
    e?.stopPropagation();
    setExpandedItems((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const matchesSearch = (name: string, url?: string): boolean => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.trim().toLowerCase();
    return name.toLowerCase().includes(q) || (url?.toLowerCase().includes(q) ?? false);
  };

  // A container whose own name matches shows its full contents; otherwise only matching descendants.
  const folderVisible = (folder: Folder, parentMatched: boolean): boolean => {
    if (!isSearching || parentMatched || matchesSearch(folder.name)) return true;
    return (
      folder.requests.some((r) => matchesSearch(r.name, r.url)) ||
      folder.folders.some((f) => folderVisible(f, false))
    );
  };

  const startRename = (id: string, currentName: string, e?: React.MouseEvent) => {
    e?.stopPropagation();
    setEditingId(id);
    setEditValue(currentName);
  };

  const commitRename = (
    type: 'collection' | 'folder' | 'request',
    colId: string,
    itemId: string
  ) => {
    const trimmed = editValue.trim();
    if (trimmed && editingId === itemId) {
      if (type === 'collection') {
        onRenameCollection(colId, trimmed);
      } else if (type === 'folder') {
        onRenameFolder(colId, itemId, trimmed);
      } else if (type === 'request') {
        onRenameRequest(colId, itemId, trimmed);
      }
    }
    setEditingId(null);
  };

  const renderFolder = (folder: Folder, colId: string, depth = 1, parentMatched = false) => {
    const isExpanded = isOpen(folder.id);
    const isEditing = editingId === folder.id;
    if (!folderVisible(folder, parentMatched)) return null;
    const matched = parentMatched || (isSearching && matchesSearch(folder.name));
    const childRequests = matched
      ? folder.requests
      : folder.requests.filter((r) => matchesSearch(r.name, r.url));
    const childFolders = folder.folders;

    return (
      <div key={folder.id} className="select-none">
        <div
          onClick={(e) => {
            if (!isEditing) toggleExpand(folder.id, e);
          }}
          onContextMenu={(e) => openMenu(e, folderMenu(folder, colId))}
          {...dragProps('folder', folder.id, colId)}
          {...dropProps(`in:${folder.id}`, { colId, folderId: folder.id }, folder.id)}
          style={{ paddingLeft: `${depth * 14 + 8}px` }}
          className={`${dropKey === `in:${folder.id}` ? 'bg-blue-600/25 ring-1 ring-inset ring-blue-500 ' : ''}group flex items-center justify-between py-1.5 pr-2 hover:bg-gray-800/50 cursor-pointer rounded text-xs text-gray-300 transition-colors`}
        >
          <div className="flex items-center space-x-1.5 truncate flex-1 min-w-0 mr-1">
            {isExpanded ? (
              <ChevronDown className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" />
            ) : (
              <ChevronRight className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" />
            )}
            {isExpanded ? (
              <FolderOpen className="w-3.5 h-3.5 text-amber-400/80 flex-shrink-0" />
            ) : (
              <FolderIcon className="w-3.5 h-3.5 text-amber-400/80 flex-shrink-0" />
            )}

            {isEditing ? (
              <input
                ref={inputRef}
                type="text"
                value={editValue}
                onChange={(e) => setEditValue(e.target.value)}
                onClick={(e) => e.stopPropagation()}
                onBlur={() => commitRename('folder', colId, folder.id)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    commitRename('folder', colId, folder.id);
                  } else if (e.key === 'Escape') {
                    setEditingId(null);
                  }
                }}
                className="bg-[#121418] border border-blue-500 rounded px-1.5 py-0.5 text-xs text-white outline-none w-full"
              />
            ) : (
              <span
                onDoubleClick={(e) => startRename(folder.id, folder.name, e)}
                title="Double click to rename"
                className="truncate font-medium flex-1"
              >
                {folder.name}
              </span>
            )}
          </div>

          {!isEditing && (
            <span className="text-[10px] text-gray-600 tabular-nums mr-1 group-hover:hidden flex-shrink-0">
              {countRequests(folder)}
            </span>
          )}
          {!isEditing && (
            <div className="hidden group-hover:flex items-center flex-shrink-0">
              <button
                title="Add"
                onClick={(e) =>
                  openMenu(e, [
                    { label: 'Add request', icon: FilePlus, onClick: () => onCreateRequest(colId, folder.id) },
                    { label: 'Add folder', icon: FolderPlus, onClick: () => onCreateFolder(colId, folder.id) },
                  ])
                }
                className={rowBtn}
              >
                <Plus className="w-3.5 h-3.5" />
              </button>
              <button title="More" onClick={(e) => openMenu(e, folderMenu(folder, colId))} className={rowBtn}>
                <MoreHorizontal className="w-3.5 h-3.5" />
              </button>
            </div>
          )}
        </div>

        {isExpanded && (
          <div>
            {childFolders.map((sub) => renderFolder(sub, colId, depth + 1, matched))}
            {childRequests.map((req) => renderRequestItem(req, colId, depth + 1, true, folder.id))}
          </div>
        )}
      </div>
    );
  };

  const renderRequestItem = (req: RequestItem, colId: string, depth = 1, skipFilter = false, parentFolderId?: string) => {
    if (!skipFilter && !matchesSearch(req.name, req.url)) return null;
    const isActive = req.id === activeRequestId;
    const isEditing = editingId === req.id;

    return (
      <div
        key={req.id}
        data-request-id={req.id}
        onClick={() => {
          if (!isEditing) onSelectRequest(req, colId);
        }}
        onContextMenu={(e) => openMenu(e, requestMenu(req, colId))}
        {...dragProps('request', req.id, colId)}
        {...dropProps(`before:${req.id}`, { colId, folderId: parentFolderId, beforeRequestId: req.id })}
        style={{ paddingLeft: `${depth * 14 + 12}px` }}
        className={`group flex items-center justify-between py-1.5 pr-2 cursor-pointer rounded text-xs transition-colors ${
          dropKey === `before:${req.id}` ? 'shadow-[inset_0_2px_0_0_#3b82f6] ' : ''
        }${
          isActive
            ? 'bg-blue-600/20 text-white font-medium border-l-2 border-blue-500'
            : 'text-gray-300 hover:bg-gray-800/40'
        }`}
      >
        <div className="flex items-center space-x-2 truncate flex-1 min-w-0 mr-1">
          <span
            className={`font-mono text-[9px] px-1 py-0.5 rounded border font-semibold flex-shrink-0 ${getMethodBadgeClass(
              req.method
            )}`}
          >
            {req.method}
          </span>

          {isEditing ? (
            <input
              ref={inputRef}
              type="text"
              value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
              onClick={(e) => e.stopPropagation()}
              onBlur={() => commitRename('request', colId, req.id)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  commitRename('request', colId, req.id);
                } else if (e.key === 'Escape') {
                  setEditingId(null);
                }
              }}
              className="bg-[#121418] border border-blue-500 rounded px-1.5 py-0.5 text-xs text-white outline-none w-full"
            />
          ) : (
            <span
              onDoubleClick={(e) => startRename(req.id, req.name, e)}
              title="Double click to rename"
              className="truncate flex-1"
            >
              {req.name}
            </span>
          )}
        </div>

        {!isEditing && (
          <div className="hidden group-hover:flex items-center flex-shrink-0">
            <button title="More" onClick={(e) => openMenu(e, requestMenu(req, colId))} className={rowBtn}>
              <MoreHorizontal className="w-3.5 h-3.5" />
            </button>
          </div>
        )}
      </div>
    );
  };

  return (
    <aside style={{ width }} className="flex-shrink-0 h-full border-r border-gray-800 bg-[#16181d] flex flex-col select-none">
      {/* Search & Actions Bar */}
      <div className="p-2.5 border-b border-gray-800 flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-gray-400">
            Collections
          </span>
          <div className="flex items-center space-x-1">
            <button
              title="Collapse all"
              onClick={() => setExpandedItems({})}
              className="p-1 hover:bg-gray-700/60 rounded text-gray-300 hover:text-white"
            >
              <ChevronsDownUp className="w-3.5 h-3.5" />
            </button>
            <button
              title="New Standalone Request"
              onClick={() => onCreateRequest()}
              className="p-1 hover:bg-gray-700/60 rounded text-gray-300 hover:text-white"
            >
              <FilePlus className="w-3.5 h-3.5" />
            </button>
            <button
              title="New Collection"
              onClick={onCreateCollection}
              className="p-1 hover:bg-gray-700/60 rounded text-gray-300 hover:text-white"
            >
              <Plus className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        <div className="relative">
          <Search className="w-3.5 h-3.5 absolute left-2 top-2 text-gray-500" />
          <input
            type="text"
            placeholder="Search collections..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Escape' && setSearchQuery('')}
            className="w-full bg-[#1e2129] border border-gray-700/60 rounded pl-7 pr-7 py-1 text-xs text-gray-200 placeholder-gray-500 outline-none focus:border-blue-500/80"
          />
          {isSearching && (
            <button
              title="Clear search (Esc)"
              onClick={() => setSearchQuery('')}
              className="absolute right-1.5 top-1.5 text-gray-500 hover:text-gray-200"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Collections List */}
      <div className="flex-1 overflow-y-auto p-1.5 space-y-1">
        {!isSearching && pinnedTree.length > 0 && (
          <div className="pb-1.5 mb-1 border-b border-gray-800">
            <div className="flex items-center gap-1.5 px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-gray-500">
              <Pin className="w-3 h-3" />
              Pinned
            </div>
            {pinnedTree.map(({ col, node }) => renderPinNode(node, col.id, 0, col.name))}
          </div>
        )}
        {collections.length === 0 ? (
          <div className="py-8 px-4 text-center text-xs text-gray-500 flex flex-col items-center">
            <p>No collections yet.</p>
            <p className="mt-1 text-[11px] text-gray-600">
              Create one or import a Postman collection.
            </p>
          </div>
        ) : (
          collections.map((col) => {
            if (
              isSearching &&
              !matchesSearch(col.name) &&
              !col.requests.some((r) => matchesSearch(r.name, r.url)) &&
              !col.folders.some((f) => folderVisible(f, false))
            ) {
              return null;
            }
            const colMatched = isSearching && matchesSearch(col.name);
            const isExpanded = isOpen(col.id);
            const isEditing = editingId === col.id;

            return (
              <div key={col.id} className="select-none">
                <div
                  onClick={(e) => {
                    if (!isEditing) toggleExpand(col.id, e);
                  }}
                  onContextMenu={(e) => openMenu(e, collectionMenu(col))}
                  {...dropProps(`in:${col.id}`, { colId: col.id }, col.id)}
                  className={`${dropKey === `in:${col.id}` ? 'bg-blue-600/25 ring-1 ring-inset ring-blue-500 ' : ''}group flex items-center justify-between py-1.5 px-2 hover:bg-gray-800/60 cursor-pointer rounded text-xs text-gray-200 font-medium transition-colors`}
                >
                  <div className="flex items-center space-x-1.5 truncate flex-1 min-w-0 mr-1">
                    {isExpanded ? (
                      <ChevronDown className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" />
                    ) : (
                      <ChevronRight className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" />
                    )}

                    {isEditing ? (
                      <input
                        ref={inputRef}
                        type="text"
                        value={editValue}
                        onChange={(e) => setEditValue(e.target.value)}
                        onClick={(e) => e.stopPropagation()}
                        onBlur={() => commitRename('collection', col.id, col.id)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            commitRename('collection', col.id, col.id);
                          } else if (e.key === 'Escape') {
                            setEditingId(null);
                          }
                        }}
                        className="bg-[#121418] border border-blue-500 rounded px-1.5 py-0.5 text-xs text-white outline-none w-full"
                      />
                    ) : (
                      <span
                        onDoubleClick={(e) => startRename(col.id, col.name, e)}
                        title="Double click to rename"
                        className="truncate flex-1"
                      >
                        {col.name}
                      </span>
                    )}
                  </div>

                  {!isEditing && (
                    <span className="text-[10px] text-gray-600 tabular-nums mr-1 group-hover:hidden flex-shrink-0">
                      {countRequests(col)}
                    </span>
                  )}
                  {!isEditing && (
                    <div className="hidden group-hover:flex items-center flex-shrink-0">
                      <button
                        title="Add"
                        onClick={(e) =>
                          openMenu(e, [
                            { label: 'Add request', icon: FilePlus, onClick: () => onCreateRequest(col.id) },
                            { label: 'Add folder', icon: FolderPlus, onClick: () => onCreateFolder(col.id) },
                          ])
                        }
                        className={rowBtn}
                      >
                        <Plus className="w-3.5 h-3.5" />
                      </button>
                      <button title="More" onClick={(e) => openMenu(e, collectionMenu(col))} className={rowBtn}>
                        <MoreHorizontal className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  )}
                </div>

                {isExpanded && (
                  <div className="mt-0.5">
                    {col.folders.map((f) => renderFolder(f, col.id, 1, colMatched))}
                    {col.requests
                      .filter((r) => colMatched || matchesSearch(r.name, r.url))
                      .map((req) => renderRequestItem(req, col.id, 1, true))}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
      {menu && <ContextMenu menu={menu} onClose={() => setMenu(null)} />}
    </aside>
  );
};
