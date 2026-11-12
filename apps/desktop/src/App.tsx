import React, { useState, useEffect, useCallback } from 'react';
import { Header } from './components/Header';
import { Sidebar } from './components/Sidebar';
import { ResizeHandle } from './components/ResizeHandle';
import { McpModal } from './components/McpModal';
import { UpdateBanner } from './components/UpdateBanner';
import { TabBar } from './components/TabBar';
import { RequestEditor } from './components/RequestEditor';
import { ResponseViewer } from './components/ResponseViewer';
import { EnvironmentModal } from './components/EnvironmentModal';
import { ImportModal } from './components/ImportModal';
import { CollectionVariablesModal } from './components/CollectionVariablesModal';
import { ConfirmModal } from './components/ConfirmModal';
import {
  Collection,
  Environment,
  Folder,
  HttpMethod,
  HttpResponse,
  ImportResult,
  RequestItem,
  ScriptLogEntry,
  TabItem,
} from './types';
import { api } from './services/api';
import { runScript } from './services/scriptRunner';
import { Send, Plus, Upload, PanelRightOpen } from 'lucide-react';

const createDefaultRequest = (name = 'New Request', method: HttpMethod = 'GET'): RequestItem => ({
  id: 'req_' + Math.random().toString(36).substring(2, 9),
  name,
  method,
  url: '',
  params: [],
  headers: [{ key: 'Accept', value: 'application/json', enabled: true }],
  body: { body_type: 'none' },
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
});

const findRequestInCollections = (
  cols: Collection[],
  requestId: string
): { request: RequestItem; collectionId: string } | null => {
  const searchFolders = (folders: Folder[]): RequestItem | null => {
    for (const folder of folders) {
      const direct = folder.requests.find((r) => r.id === requestId);
      if (direct) return direct;
      const nested = searchFolders(folder.folders);
      if (nested) return nested;
    }
    return null;
  };

  for (const col of cols) {
    const top = col.requests.find((r) => r.id === requestId);
    if (top) return { request: top, collectionId: col.id };
    const nested = searchFolders(col.folders);
    if (nested) return { request: nested, collectionId: col.id };
  }
  return null;
};

export const App: React.FC = () => {
  const [collections, setCollections] = useState<Collection[]>([]);
  const [environments, setEnvironments] = useState<Environment[]>([]);
  const [activeEnvironmentId, setActiveEnvironmentId] = useState<string | undefined>();
  const [tabs, setTabs] = useState<TabItem[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | undefined>();
  const [sidebarWidth, setSidebarWidth] = useState(() =>
    Number(localStorage.getItem('ezman.sidebarWidth')) || 256
  );
  const [splitRatio, setSplitRatio] = useState(() =>
    Number(localStorage.getItem('ezman.splitRatio')) || 50
  );
  const splitRef = React.useRef<HTMLDivElement>(null);
  const sessionReadyRef = React.useRef(false);
  useEffect(() => localStorage.setItem('ezman.sidebarWidth', String(sidebarWidth)), [sidebarWidth]);
  useEffect(() => localStorage.setItem('ezman.splitRatio', String(splitRatio)), [splitRatio]);
  const [responseLayout, setResponseLayout] = useState<'split' | 'maximized' | 'collapsed'>('split');

  // Modals state
  const [isEnvModalOpen, setIsEnvModalOpen] = useState(false);
  const [isImportModalOpen, setIsImportModalOpen] = useState(false);
  const [isMcpModalOpen, setIsMcpModalOpen] = useState(false);
  const [colVariablesCol, setColVariablesCol] = useState<Collection | null>(null);
  const [confirmModal, setConfirmModal] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
    onConfirm: () => void;
  }>({
    isOpen: false,
    title: '',
    message: '',
    onConfirm: () => {},
  });

  // Initial load — restore last open tabs / environment from preferences
  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      const [loadedCols, loadedEnvs, loadedPrefs] = await Promise.all([
        api.listCollections(),
        api.listEnvironments(),
        api.getPreferences(),
      ]);

      setCollections(loadedCols);
      setEnvironments(loadedEnvs);

      if (loadedPrefs.active_environment_id) {
        setActiveEnvironmentId(loadedPrefs.active_environment_id);
      } else if (loadedEnvs.length > 0) {
        setActiveEnvironmentId(loadedEnvs[0].id);
      }

      const restoredTabs: TabItem[] = [];
      for (const reqId of loadedPrefs.open_tabs || []) {
        const found = findRequestInCollections(loadedCols, reqId);
        if (!found) continue;
        if (restoredTabs.some((t) => t.request.id === found.request.id)) continue;
        restoredTabs.push({
          id: 'tab_' + found.request.id,
          request: JSON.parse(JSON.stringify(found.request)),
          collection_id: found.collectionId,
          is_dirty: false,
        });
      }

      if (restoredTabs.length > 0) {
        setTabs(restoredTabs);
        const preferred = loadedPrefs.active_tab_id
          ? restoredTabs.find(
              (t) => t.id === loadedPrefs.active_tab_id || t.request.id === loadedPrefs.active_tab_id
            )
          : undefined;
        setActiveTabId(preferred ? preferred.id : restoredTabs[0].id);
      }
      // Otherwise leave tabs empty — show the empty workspace instead of forcing httpbin.
    } catch (e) {
      console.error('Failed to load initial data:', e);
    } finally {
      sessionReadyRef.current = true;
    }
  };

  // Persist workspace session (open tabs + active env/tab)
  useEffect(() => {
    if (!sessionReadyRef.current) return;
    const openTabs = tabs
      .filter((t) => t.collection_id)
      .map((t) => t.request.id);
    const activeRequestId = tabs.find((t) => t.id === activeTabId)?.request.id;
    void api.savePreferences({
      active_environment_id: activeEnvironmentId,
      active_tab_id: activeRequestId ?? activeTabId,
      open_tabs: openTabs,
      theme: 'dark',
    });
  }, [tabs, activeTabId, activeEnvironmentId]);

  const activeTab = tabs.find((t) => t.id === activeTabId);

  // Tab Operations
  const handleSelectTab = (tabId: string) => {
    setActiveTabId(tabId);
  };

  const handleCloseTab = (tabId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const idx = tabs.findIndex((t) => t.id === tabId);
    if (idx === -1) return;

    const remaining = tabs.filter((t) => t.id !== tabId);
    setTabs(remaining);

    if (activeTabId === tabId) {
      if (remaining.length > 0) {
        const nextActive = remaining[Math.min(idx, remaining.length - 1)];
        setActiveTabId(nextActive.id);
      } else {
        setActiveTabId(undefined);
      }
    }
  };

  const handleNewTab = () => {
    const newReq = createDefaultRequest();
    const newTab: TabItem = {
      id: 'tab_' + newReq.id,
      request: newReq,
      is_dirty: true,
    };
    setTabs([...tabs, newTab]);
    setActiveTabId(newTab.id);
  };

  const handleSelectRequestFromSidebar = (req: RequestItem, colId?: string) => {
    // Check if already open
    const existing = tabs.find((t) => t.request.id === req.id);
    if (existing) {
      setActiveTabId(existing.id);
      return;
    }

    // Open new tab
    const newTab: TabItem = {
      id: 'tab_' + req.id,
      request: JSON.parse(JSON.stringify(req)),
      collection_id: colId,
      is_dirty: false,
    };
    setTabs([...tabs, newTab]);
    setActiveTabId(newTab.id);
  };

  const handleRequestChange = (updated: RequestItem) => {
    if (!activeTabId) return;
    const currentTab = tabs.find((t) => t.id === activeTabId);
    const nameChanged = currentTab && currentTab.request.name !== updated.name;

    setTabs((prev) =>
      prev.map((t) =>
        t.id === activeTabId
          ? { ...t, request: updated, is_dirty: true }
          : t
      )
    );

    // If request belongs to a collection and its name changed, sync immediately into collections state
    if (currentTab?.collection_id && nameChanged) {
      const colId = currentTab.collection_id;
      const reqId = updated.id;
      const newName = updated.name;

      setCollections((prev) =>
        prev.map((c) => {
          if (c.id !== colId) return c;
          const updateInFolders = (folders: Folder[]): Folder[] => {
            return folders.map((f) => ({
              ...f,
              requests: f.requests.map((r) => (r.id === reqId ? { ...r, name: newName } : r)),
              folders: updateInFolders(f.folders),
            }));
          };
          return {
            ...c,
            requests: c.requests.map((r) => (r.id === reqId ? { ...r, name: newName } : r)),
            folders: updateInFolders(c.folders),
          };
        })
      );
    }
  };

  // Execute Request
  const handleSendRequest = useCallback(async () => {
    if (!activeTab || activeTab.loading) return;

    // Set loading
    setTabs((prev) =>
      prev.map((t) =>
        t.id === activeTab.id ? { ...t, loading: true } : t
      )
    );

    const logs: ScriptLogEntry[] = [];
    const locals = new Map<string, string>();
    let env = environments.find((e) => e.id === activeEnvironmentId);
    let col = collections.find((c) => c.id === activeTab.collection_id);

    // Persist variables a script changed so the backend sees them on the next call.
    const persist = async (r: Awaited<ReturnType<typeof runScript>>) => {
      logs.push(...r.logs);
      env = r.environment;
      col = r.collection;
      if (r.environmentChanged && env) await handleSaveEnvironment(env);
      if (r.collectionChanged && col) {
        const saved = { ...col, updated_at: new Date().toISOString() };
        await api.saveCollection(saved);
        setCollections((prev) => prev.map((c) => (c.id === saved.id ? saved : c)));
      }
    };

    const finish = (response: HttpResponse) =>
      setTabs((prev) =>
        prev.map((t) =>
          t.id === activeTab.id ? { ...t, loading: false, response, script_logs: logs } : t
        )
      );

    const failure = (message: string): HttpResponse => ({
      status: 0,
      status_text: 'Error',
      headers: [],
      body: '',
      duration_ms: 0,
      size_bytes: 0,
      error: message,
    });

    try {
      const scripts = activeTab.request.scripts;

      if (scripts?.pre_request.trim()) {
        const pre = await runScript({
          stage: 'pre-request',
          code: scripts.pre_request,
          request: activeTab.request,
          environment: env,
          collection: col,
          locals,
        });
        await persist(pre);
        if (pre.error) {
          finish(failure(`Pre-request script failed: ${pre.error}`));
          return;
        }
      }

      const response = await api.executeRequest(
        activeTab.request,
        activeTab.collection_id,
        activeEnvironmentId
      );

      if (scripts?.post_response.trim() && !response.error) {
        await persist(
          await runScript({
            stage: 'post-response',
            code: scripts.post_response,
            request: activeTab.request,
            environment: env,
            collection: col,
            response,
            locals,
          })
        );
      }

      finish(response);
    } catch (err: any) {
      finish(failure(err.message || String(err)));
    }
  }, [activeTab, activeEnvironmentId, environments, collections]);

  // Save Request
  const handleSaveRequest = useCallback(async () => {
    if (!activeTab) return;
    const req = activeTab.request;

    if (!activeTab.collection_id) {
      // If not belonging to a collection, find or create default collection
      let defaultCol = collections.find((c) => c.name === 'Default Collection');
      if (!defaultCol) {
        defaultCol = {
          id: 'col_' + Math.random().toString(36).substring(2, 9),
          name: 'Default Collection',
          mcp_allow_secrets: false,
          variables: [],
          folders: [],
          requests: [req],
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        };
      } else {
        defaultCol = {
          ...defaultCol,
          requests: [...defaultCol.requests.filter((r) => r.id !== req.id), req],
        };
      }
      await api.saveCollection(defaultCol);
      setTabs((prev) =>
        prev.map((t) =>
          t.id === activeTab.id
            ? { ...t, collection_id: defaultCol?.id, is_dirty: false }
            : t
        )
      );
      setCollections((prev) => [
        ...prev.filter((c) => c.id !== defaultCol?.id),
        defaultCol!,
      ]);
      return;
    }

    // Save into existing collection
    const targetCol = collections.find((c) => c.id === activeTab.collection_id);
    if (!targetCol) return;

    // Helper to recursively update request in collection
    const updateInFolder = (folders: Folder[]): Folder[] => {
      return folders.map((f) => {
        const foundIdx = f.requests.findIndex((r) => r.id === req.id);
        if (foundIdx >= 0) {
          const reqs = [...f.requests];
          reqs[foundIdx] = req;
          return { ...f, requests: reqs };
        }
        return { ...f, folders: updateInFolder(f.folders) };
      });
    };

    let updatedRequests = [...targetCol.requests];
    const rootIdx = updatedRequests.findIndex((r) => r.id === req.id);
    if (rootIdx >= 0) {
      updatedRequests[rootIdx] = req;
    } else {
      // Check in folders
      const updatedFolders = updateInFolder(targetCol.folders);
      const isInsideFolder = JSON.stringify(updatedFolders) !== JSON.stringify(targetCol.folders);
      if (!isInsideFolder) {
        updatedRequests.push(req);
      }
      const updatedCol = {
        ...targetCol,
        folders: updatedFolders,
        requests: updatedRequests,
        updated_at: new Date().toISOString(),
      };
      await api.saveCollection(updatedCol);
      setCollections((prev) =>
        prev.map((c) => (c.id === updatedCol.id ? updatedCol : c))
      );
      setTabs((prev) =>
        prev.map((t) => (t.id === activeTab.id ? { ...t, is_dirty: false } : t))
      );
      return;
    }

    const updatedCol = {
      ...targetCol,
      requests: updatedRequests,
      updated_at: new Date().toISOString(),
    };
    await api.saveCollection(updatedCol);
    setCollections((prev) =>
      prev.map((c) => (c.id === updatedCol.id ? updatedCol : c))
    );
    setTabs((prev) =>
      prev.map((t) => (t.id === activeTab.id ? { ...t, is_dirty: false } : t))
    );
  }, [activeTab, collections]);

  // Keyboard Shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault();
        handleSendRequest();
      } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        handleSaveRequest();
      } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'w') {
        if (activeTabId) {
          e.preventDefault();
          const target = activeTabId;
          const idx = tabs.findIndex((t) => t.id === target);
          const remaining = tabs.filter((t) => t.id !== target);
          setTabs(remaining);
          if (remaining.length > 0) {
            setActiveTabId(remaining[Math.min(idx, remaining.length - 1)].id);
          } else {
            setActiveTabId(undefined);
          }
        }
      } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 't') {
        e.preventDefault();
        handleNewTab();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleSendRequest, handleSaveRequest, activeTabId, tabs]);

  // Collection CRUD & Renaming
  const handleCreateCollection = async () => {
    const newCol: Collection = {
      id: 'col_' + Math.random().toString(36).substring(2, 9),
      name: 'New Collection',
      mcp_allow_secrets: false,
      variables: [],
      folders: [],
      requests: [],
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    await api.saveCollection(newCol);
    setCollections((prev) => [...prev, newCol]);
  };

  const handleRenameCollection = async (colId: string, newName: string) => {
    const col = collections.find((c) => c.id === colId);
    if (!col || !newName.trim()) return;

    const updatedCol = {
      ...col,
      name: newName.trim(),
      updated_at: new Date().toISOString(),
    };
    await api.saveCollection(updatedCol);
    setCollections((prev) => prev.map((c) => (c.id === colId ? updatedCol : c)));
  };

  const handleDeleteCollection = (colId: string) => {
    const col = collections.find((c) => c.id === colId);
    if (!col) return;

    setConfirmModal({
      isOpen: true,
      title: 'Delete Collection',
      message: `Are you sure you want to delete collection '${col.name}'? This action cannot be undone.`,
      onConfirm: async () => {
        await api.deleteCollection(colId);
        setCollections((prev) => prev.filter((c) => c.id !== colId));
        setTabs((prev) => prev.filter((t) => t.collection_id !== colId));
        setConfirmModal((m) => ({ ...m, isOpen: false }));
      },
    });
  };

  // Folder CRUD & Renaming
  const handleCreateFolder = async (colId: string, parentFolderId?: string) => {
    const col = collections.find((c) => c.id === colId);
    if (!col) return;

    const newFolder: Folder = {
      id: 'fld_' + Math.random().toString(36).substring(2, 9),
      name: 'New Folder',
      folders: [],
      requests: [],
    };

    const addRecursive = (folders: Folder[]): Folder[] => {
      return folders.map((f) => {
        if (f.id === parentFolderId) {
          return { ...f, folders: [...f.folders, newFolder] };
        }
        return { ...f, folders: addRecursive(f.folders) };
      });
    };

    let updatedFolders = col.folders;
    if (parentFolderId) {
      updatedFolders = addRecursive(col.folders);
    } else {
      updatedFolders = [...col.folders, newFolder];
    }

    const updatedCol = { ...col, folders: updatedFolders, updated_at: new Date().toISOString() };
    await api.saveCollection(updatedCol);
    setCollections((prev) => prev.map((c) => (c.id === colId ? updatedCol : c)));
  };

  const handleRenameFolder = async (colId: string, folderId: string, newName: string) => {
    const col = collections.find((c) => c.id === colId);
    if (!col || !newName.trim()) return;

    const renameRecursive = (folders: Folder[]): Folder[] => {
      return folders.map((f) => {
        if (f.id === folderId) {
          return { ...f, name: newName.trim() };
        }
        return { ...f, folders: renameRecursive(f.folders) };
      });
    };

    const updatedCol = {
      ...col,
      folders: renameRecursive(col.folders),
      updated_at: new Date().toISOString(),
    };
    await api.saveCollection(updatedCol);
    setCollections((prev) => prev.map((c) => (c.id === colId ? updatedCol : c)));
  };

  const handleDeleteFolder = (colId: string, folderId: string) => {
    const col = collections.find((c) => c.id === colId);
    if (!col) return;

    const findFolderReqs = (folders: Folder[]): { name: string; reqIds: string[] } => {
      for (const f of folders) {
        if (f.id === folderId) {
          const getAllReqIds = (fld: Folder): string[] => [
            ...fld.requests.map((r) => r.id),
            ...fld.folders.flatMap(getAllReqIds),
          ];
          return { name: f.name, reqIds: getAllReqIds(f) };
        }
        const res = findFolderReqs(f.folders);
        if (res.name) return res;
      }
      return { name: 'Folder', reqIds: [] };
    };

    const { name: folderName, reqIds } = findFolderReqs(col.folders);

    setConfirmModal({
      isOpen: true,
      title: 'Delete Folder',
      message: `Are you sure you want to delete folder '${folderName}' and all its contents? This action cannot be undone.`,
      onConfirm: async () => {
        const removeRecursive = (folders: Folder[]): Folder[] => {
          return folders
            .filter((f) => f.id !== folderId)
            .map((f) => ({ ...f, folders: removeRecursive(f.folders) }));
        };

        const updatedCol = {
          ...col,
          folders: removeRecursive(col.folders),
          updated_at: new Date().toISOString(),
        };
        await api.saveCollection(updatedCol);
        setCollections((prev) => prev.map((c) => (c.id === colId ? updatedCol : c)));
        setTabs((prev) => prev.filter((t) => !reqIds.includes(t.request.id)));
        setConfirmModal((m) => ({ ...m, isOpen: false }));
      },
    });
  };

  const handleCreateRequest = async (colId?: string, folderId?: string) => {
    const newReq = createDefaultRequest('New Request');

    if (!colId) {
      // Just open an unsaved tab
      const tab: TabItem = {
        id: 'tab_' + newReq.id,
        request: newReq,
        is_dirty: true,
      };
      setTabs([...tabs, tab]);
      setActiveTabId(tab.id);
      return;
    }

    const col = collections.find((c) => c.id === colId);
    if (!col) return;

    if (folderId) {
      const addInFolder = (folders: Folder[]): Folder[] => {
        return folders.map((f) => {
          if (f.id === folderId) {
            return { ...f, requests: [...f.requests, newReq] };
          }
          return { ...f, folders: addInFolder(f.folders) };
        });
      };
      const updatedFolders = addInFolder(col.folders);
      const updatedCol = { ...col, folders: updatedFolders, updated_at: new Date().toISOString() };
      await api.saveCollection(updatedCol);
      setCollections((prev) => prev.map((c) => (c.id === colId ? updatedCol : c)));
    } else {
      const updatedCol = {
        ...col,
        requests: [...col.requests, newReq],
        updated_at: new Date().toISOString(),
      };
      await api.saveCollection(updatedCol);
      setCollections((prev) => prev.map((c) => (c.id === colId ? updatedCol : c)));
    }

    // Open in tab
    handleSelectRequestFromSidebar(newReq, colId);
  };

  const handleRenameRequest = async (colId: string, reqId: string, newName: string) => {
    const trimmed = newName.trim();
    if (!trimmed) return;

    const col = collections.find((c) => c.id === colId);
    if (col) {
      const renameInFolders = (folders: Folder[]): Folder[] => {
        return folders.map((f) => ({
          ...f,
          requests: f.requests.map((r) => (r.id === reqId ? { ...r, name: trimmed } : r)),
          folders: renameInFolders(f.folders),
        }));
      };

      const updatedCol = {
        ...col,
        requests: col.requests.map((r) => (r.id === reqId ? { ...r, name: trimmed } : r)),
        folders: renameInFolders(col.folders),
        updated_at: new Date().toISOString(),
      };
      await api.saveCollection(updatedCol);
      setCollections((prev) => prev.map((c) => (c.id === colId ? updatedCol : c)));
    }

    setTabs((prev) =>
      prev.map((t) =>
        t.request.id === reqId
          ? { ...t, request: { ...t.request, name: trimmed } }
          : t
      )
    );
  };

  const handleDuplicateRequest = async (req: RequestItem, colId: string) => {
    const col = collections.find((c) => c.id === colId);
    if (!col) return;

    const dupReq: RequestItem = {
      ...JSON.parse(JSON.stringify(req)),
      id: 'req_' + Math.random().toString(36).substring(2, 9),
      name: `${req.name} (Copy)`,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    // Helper to find and duplicate in folders
    let placed = false;
    const dupInFolders = (folders: Folder[]): Folder[] => {
      return folders.map((f) => {
        if (f.requests.some((r) => r.id === req.id)) {
          placed = true;
          return { ...f, requests: [...f.requests, dupReq] };
        }
        return { ...f, folders: dupInFolders(f.folders) };
      });
    };

    const updatedFolders = dupInFolders(col.folders);
    let updatedRequests = col.requests;
    if (!placed) {
      updatedRequests = [...col.requests, dupReq];
    }

    const updatedCol = {
      ...col,
      folders: updatedFolders,
      requests: updatedRequests,
      updated_at: new Date().toISOString(),
    };
    await api.saveCollection(updatedCol);
    setCollections((prev) => prev.map((c) => (c.id === colId ? updatedCol : c)));
    handleSelectRequestFromSidebar(dupReq, colId);
  };

  const handleMoveItem = async (
    source: { type: 'request' | 'folder'; id: string; colId: string },
    target: { colId: string; folderId?: string; beforeRequestId?: string }
  ) => {
    const srcCol = collections.find((c) => c.id === source.colId);
    const dstCol = collections.find((c) => c.id === target.colId);
    if (!srcCol || !dstCol) return;
    if (source.id === target.folderId || source.id === target.beforeRequestId) return;

    let moved: RequestItem | Folder | undefined;
    const take = <T extends { id: string }>(list: T[]): T[] =>
      list.filter((x) => {
        if (x.id === source.id) {
          moved = x as unknown as RequestItem | Folder;
          return false;
        }
        return true;
      });
    const stripFolders = (folders: Folder[]): Folder[] =>
      (source.type === 'folder' ? take(folders) : folders).map((f) => ({
        ...f,
        requests: source.type === 'request' ? take(f.requests) : f.requests,
        folders: stripFolders(f.folders),
      }));
    const stripped: Collection = {
      ...srcCol,
      requests: source.type === 'request' ? take(srcCol.requests) : srcCol.requests,
      folders: stripFolders(srcCol.folders),
    };
    if (!moved) return;
    const item = moved as RequestItem | Folder;

    // A folder cannot be dropped into itself or its own descendants.
    if (source.type === 'folder' && target.folderId) {
      const inside = (f: Folder): boolean =>
        f.id === target.folderId || f.folders.some(inside);
      if (inside(item as Folder)) return;
    }

    const base = srcCol.id === dstCol.id ? stripped : dstCol;
    const add = (f: { requests: RequestItem[]; folders: Folder[] }) => {
      if (source.type === 'folder') return { folders: [...f.folders, item as Folder], requests: f.requests };
      const reqs = [...f.requests];
      const idx = target.beforeRequestId ? reqs.findIndex((r) => r.id === target.beforeRequestId) : -1;
      reqs.splice(idx >= 0 ? idx : reqs.length, 0, item as RequestItem);
      return { folders: f.folders, requests: reqs };
    };
    const insertIn = (folders: Folder[]): Folder[] =>
      folders.map((f) =>
        f.id === target.folderId ? { ...f, ...add(f) } : { ...f, folders: insertIn(f.folders) }
      );
    const now = new Date().toISOString();
    const updatedDst: Collection = {
      ...base,
      ...(target.folderId ? { folders: insertIn(base.folders) } : add(base)),
      updated_at: now,
    };

    await api.saveCollection(updatedDst);
    const updates: Collection[] = [updatedDst];
    if (srcCol.id !== dstCol.id) {
      const updatedSrc = { ...stripped, updated_at: now };
      await api.saveCollection(updatedSrc);
      updates.push(updatedSrc);
      const ids = new Set<string>();
      const collect = (n: RequestItem | Folder) => {
        if ('folders' in n) {
          n.requests.forEach((r) => ids.add(r.id));
          n.folders.forEach(collect);
        } else ids.add(n.id);
      };
      collect(item);
      setTabs((prev) =>
        prev.map((t) => (ids.has(t.request.id) ? { ...t, collection_id: dstCol.id } : t))
      );
    }
    setCollections((prev) => prev.map((c) => updates.find((u) => u.id === c.id) ?? c));
  };

  const handleDeleteRequest = (reqId: string, colId: string) => {
    const col = collections.find((c) => c.id === colId);
    if (!col) return;

    let reqName = 'Request';
    const findReqName = (folders: Folder[]): string | undefined => {
      for (const f of folders) {
        const found = f.requests.find((r) => r.id === reqId);
        if (found) return found.name;
        const sub = findReqName(f.folders);
        if (sub) return sub;
      }
      return undefined;
    };
    const found = col.requests.find((r) => r.id === reqId);
    reqName = found ? found.name : (findReqName(col.folders) || 'Request');

    setConfirmModal({
      isOpen: true,
      title: 'Delete Request',
      message: `Are you sure you want to delete request '${reqName}'? This action cannot be undone.`,
      onConfirm: async () => {
        const removeFromFolder = (folders: Folder[]): Folder[] => {
          return folders.map((f) => ({
            ...f,
            requests: f.requests.filter((r) => r.id !== reqId),
            folders: removeFromFolder(f.folders),
          }));
        };

        const updatedCol = {
          ...col,
          requests: col.requests.filter((r) => r.id !== reqId),
          folders: removeFromFolder(col.folders),
          updated_at: new Date().toISOString(),
        };

        await api.saveCollection(updatedCol);
        setCollections((prev) => prev.map((c) => (c.id === colId ? updatedCol : c)));
        setTabs((prev) => prev.filter((t) => t.request.id !== reqId));
        setConfirmModal((m) => ({ ...m, isOpen: false }));
      },
    });
  };

  // Environment operations
  const handleSaveEnvironment = async (env: Environment) => {
    await api.saveEnvironment(env);
    setEnvironments((prev) => {
      const idx = prev.findIndex((e) => e.id === env.id);
      if (idx >= 0) {
        const copy = [...prev];
        copy[idx] = env;
        return copy;
      }
      return [...prev, env];
    });
  };

  const handleDeleteEnvironment = async (id: string) => {
    await api.deleteEnvironment(id);
    setEnvironments((prev) => prev.filter((e) => e.id !== id));
    if (activeEnvironmentId === id) {
      setActiveEnvironmentId(undefined);
    }
  };

  // Import success
  const handleImportSuccess = (res: ImportResult) => {
    setCollections((prev) => [
      ...prev.filter((c) => c.id !== res.collection.id),
      res.collection,
    ]);
    if (res.collection.requests.length > 0) {
      handleSelectRequestFromSidebar(res.collection.requests[0], res.collection.id);
    } else if (res.collection.folders[0]?.requests[0]) {
      handleSelectRequestFromSidebar(
        res.collection.folders[0].requests[0],
        res.collection.id
      );
    }
  };

  return (
    <div className="h-screen w-screen flex flex-col bg-[#121316] text-gray-200 overflow-hidden font-sans">
      {/* Top Header */}
      <Header
        environments={environments}
        activeEnvironmentId={activeEnvironmentId}
        onSelectEnvironment={setActiveEnvironmentId}
        onOpenEnvironmentModal={() => setIsEnvModalOpen(true)}
        onOpenImportModal={() => setIsImportModalOpen(true)}
        onOpenMcpModal={() => setIsMcpModalOpen(true)}
      />
      <McpModal isOpen={isMcpModalOpen} onClose={() => setIsMcpModalOpen(false)} />

      <UpdateBanner />

      {/* Main App Workspace */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left Sidebar */}
        <Sidebar
          width={sidebarWidth}
          collections={collections}
          activeRequestId={activeTab?.request.id}
          onSelectRequest={handleSelectRequestFromSidebar}
          onCreateCollection={handleCreateCollection}
          onCreateRequest={handleCreateRequest}
          onCreateFolder={handleCreateFolder}
          onDeleteCollection={handleDeleteCollection}
          onDeleteFolder={handleDeleteFolder}
          onDeleteRequest={handleDeleteRequest}
          onDuplicateRequest={handleDuplicateRequest}
          onRenameCollection={handleRenameCollection}
          onRenameFolder={handleRenameFolder}
          onRenameRequest={handleRenameRequest}
          onOpenCollectionVariables={(col) => setColVariablesCol(col)}
          onMoveItem={handleMoveItem}
        />
        <ResizeHandle
          onDrag={(x) => setSidebarWidth(Math.min(560, Math.max(180, x)))}
          onDoubleClick={() => setSidebarWidth(256)}
        />

        {/* Workspace Central & Right panels */}
        <main className="flex-1 flex flex-col overflow-hidden bg-[#181a20]">
          {/* Tab Bar */}
          <TabBar
            tabs={tabs}
            activeTabId={activeTabId}
            onSelectTab={handleSelectTab}
            onCloseTab={handleCloseTab}
            onNewTab={handleNewTab}
          />

          {/* Split Pane: Request Editor & Response Viewer */}
          {activeTab ? (
            <div ref={splitRef} className="flex-1 flex overflow-hidden">
              {/* Request Editor Pane */}
              <div
                style={responseLayout === 'split' ? { width: `${splitRatio}%` } : undefined}
                className={`flex flex-col border-r border-gray-800 overflow-hidden ${
                  responseLayout === 'maximized'
                    ? 'hidden'
                    : responseLayout === 'collapsed'
                    ? 'flex-1'
                    : 'flex-shrink-0'
                }`}
              >
                <RequestEditor
                  request={activeTab.request}
                  onChange={handleRequestChange}
                  onSend={handleSendRequest}
                  onSave={handleSaveRequest}
                  loading={activeTab.loading}
                />
              </div>

              {/* Response Viewer Pane */}
              {responseLayout === 'collapsed' ? (
                /* Slim Collapsed Rail */
                <div
                  onClick={() => setResponseLayout('split')}
                  title="Expand Response Panel"
                  className="w-10 bg-[#14161b] hover:bg-[#181a20] border-l border-gray-800 flex flex-col items-center py-3 cursor-pointer select-none transition-colors group"
                >
                  <button
                    className="p-1.5 rounded text-gray-400 group-hover:text-blue-400 hover:bg-gray-800 transition-colors mb-4"
                    title="Expand Response"
                  >
                    <PanelRightOpen className="w-4 h-4" />
                  </button>
                  <span className="text-[10px] font-mono uppercase tracking-widest text-gray-500 group-hover:text-gray-300 transform -rotate-90 whitespace-nowrap mt-8">
                    Response
                  </span>
                  {activeTab.response && (
                    <div className="mt-auto flex flex-col items-center space-y-1">
                      <span
                        className={`text-[9px] font-mono font-bold px-1 py-0.5 rounded ${
                          activeTab.response.status >= 200 && activeTab.response.status < 300
                            ? 'bg-emerald-950 text-emerald-400 border border-emerald-800'
                            : 'bg-rose-950 text-rose-400 border border-rose-800'
                        }`}
                      >
                        {activeTab.response.status}
                      </span>
                    </div>
                  )}
                </div>
              ) : (
                <>
                {responseLayout === 'split' && (
                  <ResizeHandle
                    onDrag={(x) => {
                      const r = splitRef.current?.getBoundingClientRect();
                      if (!r) return;
                      setSplitRatio(Math.min(80, Math.max(20, ((x - r.left) / r.width) * 100)));
                    }}
                    onDoubleClick={() => setSplitRatio(50)}
                  />
                )}
                <div className="flex-1 min-w-0 flex flex-col overflow-hidden">
                  <ResponseViewer
                    response={activeTab.response}
                    scriptLogs={activeTab.script_logs}
                    loading={activeTab.loading}
                    layoutMode={responseLayout}
                    onToggleMaximize={() =>
                      setResponseLayout(responseLayout === 'maximized' ? 'split' : 'maximized')
                    }
                    onToggleCollapse={() => setResponseLayout('collapsed')}
                  />
                </div>
                </>
              )}
            </div>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center p-8 text-gray-500 select-none">
              <div className="w-14 h-14 rounded-2xl bg-blue-600/10 border border-blue-500/20 flex items-center justify-center mb-4">
                <Send className="w-7 h-7 text-blue-400" />
              </div>
              <h3 className="text-sm font-semibold text-gray-200">No request selected</h3>
              <p className="text-xs text-gray-500 mt-1 max-w-sm text-center">
                Select a request from the sidebar, or create a new request tab to start testing APIs.
              </p>
              <div className="flex items-center space-x-3 mt-5">
                <button
                  onClick={handleNewTab}
                  className="flex items-center space-x-1.5 bg-blue-600 hover:bg-blue-500 text-white px-3.5 py-1.5 rounded-md text-xs font-medium shadow-md transition-all"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>New Request</span>
                </button>
                <button
                  onClick={() => setIsImportModalOpen(true)}
                  className="flex items-center space-x-1.5 bg-gray-800 hover:bg-gray-700 text-gray-300 border border-gray-700 px-3.5 py-1.5 rounded-md text-xs font-medium transition-all"
                >
                  <Upload className="w-3.5 h-3.5 text-blue-400" />
                  <span>Import Collection</span>
                </button>
              </div>
            </div>
          )}
        </main>
      </div>

      {/* Modals */}
      <EnvironmentModal
        isOpen={isEnvModalOpen}
        onClose={() => setIsEnvModalOpen(false)}
        environments={environments}
        onSaveEnvironment={handleSaveEnvironment}
        onDeleteEnvironment={handleDeleteEnvironment}
      />

      <ImportModal
        isOpen={isImportModalOpen}
        onClose={() => setIsImportModalOpen(false)}
        onSuccess={handleImportSuccess}
      />

      <CollectionVariablesModal
        isOpen={Boolean(colVariablesCol)}
        onClose={() => setColVariablesCol(null)}
        collection={colVariablesCol}
        onSave={async (updated) => {
          await api.saveCollection(updated);
          setCollections((prev) =>
            prev.map((c) => (c.id === updated.id ? updated : c))
          );
        }}
      />

      <ConfirmModal
        isOpen={confirmModal.isOpen}
        title={confirmModal.title}
        message={confirmModal.message}
        onConfirm={confirmModal.onConfirm}
        onCancel={() => setConfirmModal((m) => ({ ...m, isOpen: false }))}
      />
    </div>
  );
};

export default App;
