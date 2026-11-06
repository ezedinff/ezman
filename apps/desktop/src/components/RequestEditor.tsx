import React, { useState } from 'react';
import {
  Send,
  Save,
  Plus,
  Trash2,

  Eye,
  EyeOff,

  Sparkles,
  AlertCircle,
  Pencil,
} from 'lucide-react';
import {
  ApiKeyLocation,
  AuthConfig,
  AuthType,
  HttpMethod,
  KeyValueItem,

  RequestItem,
} from '../types';
import { getMethodBadgeClass } from './Sidebar';
import { CodeEditor } from './CodeEditor';

interface RequestEditorProps {
  request: RequestItem;
  onChange: (updated: RequestItem) => void;
  onSend: () => void;
  onSave: () => void;
  loading?: boolean;
}

const SCRIPT_SNIPPETS = {
  pre: [
    { label: 'Set variable', code: 'pm.variables.set("name", "value");' },
    { label: 'Log', code: 'console.log(pm.environment.get("name"));' },
  ],
  post: [
    {
      label: 'Save token → environment',
      code: 'pm.environment.set("token", pm.response.json().access_token);',
    },
    {
      label: 'Save token → collection',
      code: 'pm.collectionVariables.set("token", pm.response.json().access_token);',
    },
    {
      label: 'Status is 200',
      code: 'pm.test("Status is 200", () => pm.expect(pm.response.code).to.equal(200));',
    },
  ],
};

const COMMON_HEADERS = [
  'Accept',
  'Content-Type',
  'Authorization',
  'User-Agent',
  'Cache-Control',
  'X-API-Key',
];

export const RequestEditor: React.FC<RequestEditorProps> = ({
  request,
  onChange,
  onSend,
  onSave,
  loading = false,
}) => {
  const [activeTab, setActiveTab] = useState<'params' | 'headers' | 'auth' | 'body' | 'scripts'>('params');
  const [scriptStage, setScriptStage] = useState<'pre_request' | 'post_response'>('post_response');
  const appendScript = (code: string) => {
    const current = request.scripts?.[scriptStage] ?? '';
    onChange({
      ...request,
      scripts: {
        pre_request: request.scripts?.pre_request ?? '',
        post_response: request.scripts?.post_response ?? '',
        [scriptStage]: current.trim() ? `${current.replace(/\s+$/, '')}\n${code}\n` : `${code}\n`,
      },
    });
  };
  const [showPassword, setShowPassword] = useState(false);
  const [jsonError, setJsonError] = useState<string | null>(null);
  const [graphqlVarsError, setGraphqlVarsError] = useState<string | null>(null);

  const validateGraphqlVars = (val: string) => {
    if (!val.trim()) {
      setGraphqlVarsError(null);
      return;
    }
    try {
      JSON.parse(val);
      setGraphqlVarsError(null);
    } catch (e: any) {
      setGraphqlVarsError(e.message);
    }
  };

  const formatGraphqlVars = () => {
    try {
      const raw = request.body.graphql_variables || '';
      if (!raw.trim()) return;
      const parsed = JSON.parse(raw);
      const formatted = JSON.stringify(parsed, null, 2);
      onChange({
        ...request,
        body: { ...request.body, graphql_variables: formatted },
      });
      setGraphqlVarsError(null);
    } catch (e: any) {
      setGraphqlVarsError(e.message);
    }
  };

  const insertGqlSnippet = (type: 'query' | 'mutation' | 'subscription') => {
    let snippet = '';
    let vars = '';
    if (type === 'query') {
      snippet = `query GetUsers($limit: Int) {\n  users(limit: $limit) {\n    id\n    name\n    email\n  }\n}`;
      vars = `{\n  "limit": 10\n}`;
    } else if (type === 'mutation') {
      snippet = `mutation CreateUser($name: String!, $role: String) {\n  createUser(input: { name: $name, role: $role }) {\n    id\n    name\n    role\n  }\n}`;
      vars = `{\n  "name": "Alex",\n  "role": "Engineer"\n}`;
    } else if (type === 'subscription') {
      snippet = `subscription OnUserCreated {\n  userCreated {\n    id\n    name\n    createdAt\n  }\n}`;
      vars = `{}`;
    }

    onChange({
      ...request,
      method: request.method === 'GET' ? 'POST' : request.method,
      body: {
        ...request.body,
        body_type: 'graphql',
        graphql_query: snippet,
        graphql_variables: vars,
      },
    });
    setGraphqlVarsError(null);
  };

  const detectOperationType = (queryText: string = ''): 'QUERY' | 'MUTATION' | 'SUBSCRIPTION' | 'GRAPHQL' => {
    const trimmed = queryText.trim();
    if (/^\s*mutation\b/i.test(trimmed)) return 'MUTATION';
    if (/^\s*subscription\b/i.test(trimmed)) return 'SUBSCRIPTION';
    if (/^\s*query\b/i.test(trimmed)) return 'QUERY';
    return 'GRAPHQL';
  };

  // Synchronize URL and Params
  const updateUrlAndParams = (newUrl: string, newParams?: KeyValueItem[]) => {
    let finalUrl = newUrl;
    let finalParams = newParams ? [...newParams] : [...request.params];

    if (newParams) {
      // Rebuild query in URL from params
      try {
        const base = newUrl.split('?')[0];
        const activeParams = newParams.filter((p) => p.enabled && p.key.trim());
        if (activeParams.length > 0) {
          const qs = activeParams
            .map((p) => `${encodeURIComponent(p.key)}=${encodeURIComponent(p.value)}`)
            .join('&');
          finalUrl = `${base}?${qs}`;
        } else {
          finalUrl = base;
        }
      } catch {}
    } else if (newUrl.includes('?')) {
      // Rebuild params from URL
      try {
        const qs = newUrl.split('?')[1];
        if (qs) {
          const searchParams = new URLSearchParams(qs);
          const parsedParams: KeyValueItem[] = [];
          searchParams.forEach((value, key) => {
            parsedParams.push({ key, value, enabled: true });
          });
          if (parsedParams.length > 0) {
            finalParams = parsedParams;
          }
        }
      } catch {}
    }

    onChange({
      ...request,
      url: finalUrl,
      params: finalParams,
    });
  };

  const updateParam = (index: number, field: keyof KeyValueItem, val: any) => {
    const updated = [...request.params];
    updated[index] = { ...updated[index], [field]: val };
    updateUrlAndParams(request.url, updated);
  };

  const addParam = () => {
    const updated = [...request.params, { key: '', value: '', enabled: true }];
    updateUrlAndParams(request.url, updated);
  };

  const deleteParam = (index: number) => {
    const updated = request.params.filter((_, i) => i !== index);
    updateUrlAndParams(request.url, updated);
  };

  const updateHeader = (index: number, field: keyof KeyValueItem, val: any) => {
    const updated = [...request.headers];
    updated[index] = { ...updated[index], [field]: val };
    onChange({ ...request, headers: updated });
  };

  const addHeader = (presetKey?: string) => {
    const updated = [
      ...request.headers,
      { key: presetKey || '', value: '', enabled: true },
    ];
    onChange({ ...request, headers: updated });
  };

  const deleteHeader = (index: number) => {
    const updated = request.headers.filter((_, i) => i !== index);
    onChange({ ...request, headers: updated });
  };

  const updateAuth = (updater: Partial<AuthConfig>) => {
    onChange({
      ...request,
      auth: {
        ...(request.auth || { auth_type: 'none' }),
        ...updater,
      },
    });
  };

  const formatJsonBody = () => {
    if (!request.body.raw) return;
    try {
      const parsed = JSON.parse(request.body.raw);
      const formatted = JSON.stringify(parsed, null, 2);
      onChange({
        ...request,
        body: {
          ...request.body,
          body_type: 'json',
          raw: formatted,
        },
      });
      setJsonError(null);
    } catch (e: any) {
      setJsonError(e.message);
    }
  };

  const validateJson = (text: string) => {
    if (!text.trim()) {
      setJsonError(null);
      return;
    }
    try {
      JSON.parse(text);
      setJsonError(null);
    } catch (e: any) {
      setJsonError(e.message);
    }
  };

  return (
    <div className="flex-1 flex flex-col bg-[#181a20] overflow-hidden select-none">
      {/* Top Request Bar: Name, Method, URL, Send, Save */}
      <div className="p-3 border-b border-gray-800 space-y-2">
        <div className="flex items-center space-x-2 group">
          <Pencil className="w-3.5 h-3.5 text-gray-500 group-hover:text-blue-400 transition-colors flex-shrink-0" />
          <input
            type="text"
            value={request.name}
            onChange={(e) => onChange({ ...request, name: e.target.value })}
            placeholder="Request Name"
            title="Click to rename request"
            className="bg-[#14161b] hover:bg-[#1a1d24] focus:bg-[#121418] border border-gray-700/60 hover:border-gray-600 focus:border-blue-500 text-sm font-semibold text-gray-100 outline-none px-2.5 py-1 rounded transition-colors w-80 shadow-sm"
          />
        </div>

        <div className="flex items-center space-x-2">
          {/* Method Dropdown */}
          <div className="relative">
            <select
              value={request.method}
              onChange={(e) =>
                onChange({ ...request, method: e.target.value as HttpMethod })
              }
              className={`font-mono text-xs font-bold px-2.5 py-2 rounded-l-md border appearance-none outline-none cursor-pointer tracking-wider ${getMethodBadgeClass(
                request.method
              )}`}
            >
              <option value="GET">GET</option>
              <option value="POST">POST</option>
              <option value="PUT">PUT</option>
              <option value="PATCH">PATCH</option>
              <option value="DELETE">DELETE</option>
              <option value="HEAD">HEAD</option>
              <option value="OPTIONS">OPTIONS</option>
            </select>
          </div>

          {/* URL Input */}
          <div className="flex-1 relative">
            <input
              type="text"
              value={request.url}
              onChange={(e) => updateUrlAndParams(e.target.value)}
              onKeyDown={(e) => {
                if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                  onSend();
                } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
                  e.preventDefault();
                  onSave();
                }
              }}
              placeholder="Enter URL or paste request (e.g. {{baseUrl}}/api/v1/users)"
              className="w-full bg-[#121418] border border-gray-700/70 text-gray-100 text-xs px-3 py-2 rounded-r-md outline-none focus:border-blue-500 font-mono tracking-tight"
            />
          </div>

          {/* Send Button */}
          <button
            onClick={onSend}
            disabled={loading}
            className={`flex items-center space-x-1.5 px-4 py-2 rounded-md text-xs font-semibold text-white shadow-md transition-all ${
              loading
                ? 'bg-blue-700/60 cursor-not-allowed'
                : 'bg-blue-600 hover:bg-blue-500 active:scale-95 shadow-blue-500/20'
            }`}
          >
            {loading ? (
              <>
                <div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                <span>Sending...</span>
              </>
            ) : (
              <>
                <Send className="w-3.5 h-3.5" />
                <span>Send</span>
              </>
            )}
          </button>

          {/* Save Button */}
          <button
            onClick={onSave}
            title="Save Request (⌘S / Ctrl+S)"
            className="flex items-center space-x-1 px-3 py-2 rounded-md text-xs font-medium bg-gray-800 hover:bg-gray-700 text-gray-200 border border-gray-700 transition-colors"
          >
            <Save className="w-3.5 h-3.5 text-gray-400" />
            <span>Save</span>
          </button>
        </div>
      </div>

      {/* Request Details Tabs */}
      <div className="flex items-center space-x-1 border-b border-gray-800 bg-[#14161b] px-3 pt-1 text-xs">
        <button
          onClick={() => setActiveTab('params')}
          className={`px-3 py-1.5 font-medium border-b-2 transition-colors flex items-center space-x-1.5 ${
            activeTab === 'params'
              ? 'border-blue-500 text-blue-400'
              : 'border-transparent text-gray-400 hover:text-gray-200'
          }`}
        >
          <span>Params</span>
          {request.params.filter((p) => p.enabled && p.key.trim()).length > 0 && (
            <span className="w-1.5 h-1.5 rounded-full bg-blue-500" />
          )}
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
          {request.headers.filter((h) => h.enabled && h.key.trim()).length > 0 && (
            <span className="w-1.5 h-1.5 rounded-full bg-blue-500" />
          )}
        </button>

        <button
          onClick={() => setActiveTab('auth')}
          className={`px-3 py-1.5 font-medium border-b-2 transition-colors flex items-center space-x-1.5 ${
            activeTab === 'auth'
              ? 'border-blue-500 text-blue-400'
              : 'border-transparent text-gray-400 hover:text-gray-200'
          }`}
        >
          <span>Auth</span>
          {request.auth && request.auth.auth_type !== 'none' && (
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
          )}
        </button>

        <button
          onClick={() => setActiveTab('body')}
          className={`px-3 py-1.5 font-medium border-b-2 transition-colors flex items-center space-x-1.5 ${
            activeTab === 'body'
              ? 'border-blue-500 text-blue-400'
              : 'border-transparent text-gray-400 hover:text-gray-200'
          }`}
        >
          <span>Body</span>
          {request.body.body_type !== 'none' && (
            <span className="w-1.5 h-1.5 rounded-full bg-blue-500" />
          )}
        </button>

        <button
          onClick={() => setActiveTab('scripts')}
          className={`px-3 py-1.5 font-medium border-b-2 transition-colors flex items-center space-x-1.5 ${
            activeTab === 'scripts'
              ? 'border-blue-500 text-blue-400'
              : 'border-transparent text-gray-400 hover:text-gray-200'
          }`}
        >
          <span>Scripts</span>
          {(request.scripts?.pre_request.trim() || request.scripts?.post_response.trim()) && (
            <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
          )}
        </button>
      </div>

      {/* Tab Panels */}
      <div className="flex-1 overflow-y-auto p-4 text-xs">
        {/* PARAMS TAB */}
        {activeTab === 'params' && (
          <div className="space-y-3">
            <div className="flex items-center justify-between text-gray-400 text-[11px]">
              <span>Query Parameters</span>
              <button
                onClick={addParam}
                className="flex items-center space-x-1 text-blue-400 hover:text-blue-300 font-medium"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Add Parameter</span>
              </button>
            </div>

            <div className="border border-gray-800 rounded-md overflow-hidden bg-[#14161b]">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-gray-800 bg-gray-900/60 text-gray-400 font-medium text-[11px]">
                    <th className="w-8 py-1.5 px-2 text-center"></th>
                    <th className="py-1.5 px-3">Key</th>
                    <th className="py-1.5 px-3">Value</th>
                    <th className="py-1.5 px-3">Description</th>
                    <th className="w-8 py-1.5 px-2"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-800/60 font-mono text-xs">
                  {request.params.map((param, idx) => (
                    <tr key={idx} className="hover:bg-gray-800/20 group">
                      <td className="py-1 px-2 text-center">
                        <input
                          type="checkbox"
                          checked={param.enabled}
                          onChange={(e) => updateParam(idx, 'enabled', e.target.checked)}
                          className="rounded border-gray-700 bg-gray-800 text-blue-600 focus:ring-0 cursor-pointer"
                        />
                      </td>
                      <td className="py-1 px-3">
                        <input
                          type="text"
                          value={param.key}
                          onChange={(e) => updateParam(idx, 'key', e.target.value)}
                          placeholder="key"
                          className="w-full bg-transparent text-gray-200 outline-none placeholder-gray-600"
                        />
                      </td>
                      <td className="py-1 px-3">
                        <input
                          type="text"
                          value={param.value}
                          onChange={(e) => updateParam(idx, 'value', e.target.value)}
                          placeholder="value"
                          className="w-full bg-transparent text-gray-200 outline-none placeholder-gray-600"
                        />
                      </td>
                      <td className="py-1 px-3">
                        <input
                          type="text"
                          value={param.description || ''}
                          onChange={(e) => updateParam(idx, 'description', e.target.value)}
                          placeholder="description"
                          className="w-full bg-transparent text-gray-400 outline-none placeholder-gray-600 text-[11px] font-sans"
                        />
                      </td>
                      <td className="py-1 px-2 text-center">
                        <button
                          onClick={() => deleteParam(idx)}
                          className="opacity-0 group-hover:opacity-100 p-1 hover:text-rose-400 text-gray-500 transition-opacity"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </td>
                    </tr>
                  ))}
                  {request.params.length === 0 && (
                    <tr>
                      <td colSpan={5} className="py-4 text-center text-gray-500 font-sans text-xs">
                        No query parameters. Click 'Add Parameter' above to add one.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* HEADERS TAB */}
        {activeTab === 'headers' && (
          <div className="space-y-3">
            <div className="flex items-center justify-between text-gray-400 text-[11px]">
              <div className="flex items-center space-x-2">
                <span>Request Headers</span>
                <div className="flex items-center space-x-1">
                  {COMMON_HEADERS.map((h) => (
                    <button
                      key={h}
                      onClick={() => addHeader(h)}
                      className="px-1.5 py-0.5 rounded bg-gray-800 hover:bg-gray-700 text-[10px] text-gray-300 transition-colors"
                    >
                      +{h}
                    </button>
                  ))}
                </div>
              </div>
              <button
                onClick={() => addHeader()}
                className="flex items-center space-x-1 text-blue-400 hover:text-blue-300 font-medium"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Add Header</span>
              </button>
            </div>

            <div className="border border-gray-800 rounded-md overflow-hidden bg-[#14161b]">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-gray-800 bg-gray-900/60 text-gray-400 font-medium text-[11px]">
                    <th className="w-8 py-1.5 px-2 text-center"></th>
                    <th className="py-1.5 px-3">Header Name</th>
                    <th className="py-1.5 px-3">Header Value</th>
                    <th className="py-1.5 px-3">Description</th>
                    <th className="w-8 py-1.5 px-2"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-800/60 font-mono text-xs">
                  {request.headers.map((hdr, idx) => (
                    <tr key={idx} className="hover:bg-gray-800/20 group">
                      <td className="py-1 px-2 text-center">
                        <input
                          type="checkbox"
                          checked={hdr.enabled}
                          onChange={(e) => updateHeader(idx, 'enabled', e.target.checked)}
                          className="rounded border-gray-700 bg-gray-800 text-blue-600 focus:ring-0 cursor-pointer"
                        />
                      </td>
                      <td className="py-1 px-3">
                        <input
                          type="text"
                          value={hdr.key}
                          onChange={(e) => updateHeader(idx, 'key', e.target.value)}
                          placeholder="e.g. Content-Type"
                          className="w-full bg-transparent text-gray-200 outline-none placeholder-gray-600"
                        />
                      </td>
                      <td className="py-1 px-3">
                        <input
                          type="text"
                          value={hdr.value}
                          onChange={(e) => updateHeader(idx, 'value', e.target.value)}
                          placeholder="e.g. application/json"
                          className="w-full bg-transparent text-gray-200 outline-none placeholder-gray-600"
                        />
                      </td>
                      <td className="py-1 px-3">
                        <input
                          type="text"
                          value={hdr.description || ''}
                          onChange={(e) => updateHeader(idx, 'description', e.target.value)}
                          placeholder="description"
                          className="w-full bg-transparent text-gray-400 outline-none placeholder-gray-600 text-[11px] font-sans"
                        />
                      </td>
                      <td className="py-1 px-2 text-center">
                        <button
                          onClick={() => deleteHeader(idx)}
                          className="opacity-0 group-hover:opacity-100 p-1 hover:text-rose-400 text-gray-500 transition-opacity"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </td>
                    </tr>
                  ))}
                  {request.headers.length === 0 && (
                    <tr>
                      <td colSpan={5} className="py-4 text-center text-gray-500 font-sans text-xs">
                        No headers added. Click 'Add Header' above.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* AUTH TAB */}
        {activeTab === 'auth' && (
          <div className="max-w-xl space-y-4">
            <div className="space-y-1.5">
              <label className="text-gray-400 font-medium text-[11px]">Type</label>
              <select
                value={request.auth?.auth_type || 'none'}
                onChange={(e) => updateAuth({ auth_type: e.target.value as AuthType })}
                className="w-full bg-[#14161b] border border-gray-700/80 rounded px-2.5 py-1.5 text-xs text-gray-200 outline-none focus:border-blue-500"
              >
                <option value="none">No Auth</option>
                <option value="inherit">Inherit auth from parent / collection</option>
                <option value="bearer">Bearer Token</option>
                <option value="basic">Basic Auth</option>
                <option value="apikey">API Key</option>
                <option value="custom">Custom Header</option>
              </select>
            </div>

            {/* Bearer */}
            {request.auth?.auth_type === 'bearer' && (
              <div className="space-y-1.5">
                <label className="text-gray-400 font-medium text-[11px]">Token</label>
                <div className="relative">
                  <input
                    type={showPassword ? 'text' : 'password'}
                    value={request.auth?.bearer_token || ''}
                    onChange={(e) => updateAuth({ bearer_token: e.target.value })}
                    placeholder="Enter Bearer token or {{token}}"
                    className="w-full bg-[#14161b] border border-gray-700/80 rounded px-2.5 py-1.5 pr-8 text-xs text-gray-200 outline-none focus:border-blue-500 font-mono"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-2 top-2 text-gray-400 hover:text-gray-200"
                  >
                    {showPassword ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                  </button>
                </div>
              </div>
            )}

            {/* Basic */}
            {request.auth?.auth_type === 'basic' && (
              <div className="space-y-3">
                <div className="space-y-1">
                  <label className="text-gray-400 font-medium text-[11px]">Username</label>
                  <input
                    type="text"
                    value={request.auth?.basic_username || ''}
                    onChange={(e) => updateAuth({ basic_username: e.target.value })}
                    placeholder="Username or {{username}}"
                    className="w-full bg-[#14161b] border border-gray-700/80 rounded px-2.5 py-1.5 text-xs text-gray-200 outline-none focus:border-blue-500 font-mono"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-gray-400 font-medium text-[11px]">Password</label>
                  <div className="relative">
                    <input
                      type={showPassword ? 'text' : 'password'}
                      value={request.auth?.basic_password || ''}
                      onChange={(e) => updateAuth({ basic_password: e.target.value })}
                      placeholder="Password or {{password}}"
                      className="w-full bg-[#14161b] border border-gray-700/80 rounded px-2.5 py-1.5 pr-8 text-xs text-gray-200 outline-none focus:border-blue-500 font-mono"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-2 top-2 text-gray-400 hover:text-gray-200"
                    >
                      {showPassword ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* API Key */}
            {request.auth?.auth_type === 'apikey' && (
              <div className="space-y-3">
                <div className="space-y-1">
                  <label className="text-gray-400 font-medium text-[11px]">Key Name</label>
                  <input
                    type="text"
                    value={request.auth?.api_key_name || ''}
                    onChange={(e) => updateAuth({ api_key_name: e.target.value })}
                    placeholder="e.g. X-API-Key"
                    className="w-full bg-[#14161b] border border-gray-700/80 rounded px-2.5 py-1.5 text-xs text-gray-200 outline-none focus:border-blue-500 font-mono"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-gray-400 font-medium text-[11px]">Value</label>
                  <div className="relative">
                    <input
                      type={showPassword ? 'text' : 'password'}
                      value={request.auth?.api_key_value || ''}
                      onChange={(e) => updateAuth({ api_key_value: e.target.value })}
                      placeholder="Key value or {{apiKey}}"
                      className="w-full bg-[#14161b] border border-gray-700/80 rounded px-2.5 py-1.5 pr-8 text-xs text-gray-200 outline-none focus:border-blue-500 font-mono"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-2 top-2 text-gray-400 hover:text-gray-200"
                    >
                      {showPassword ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                    </button>
                  </div>
                </div>
                <div className="space-y-1">
                  <label className="text-gray-400 font-medium text-[11px]">Add To</label>
                  <select
                    value={request.auth?.api_key_in || 'header'}
                    onChange={(e) => updateAuth({ api_key_in: e.target.value as ApiKeyLocation })}
                    className="w-full bg-[#14161b] border border-gray-700/80 rounded px-2.5 py-1.5 text-xs text-gray-200 outline-none focus:border-blue-500"
                  >
                    <option value="header">Header</option>
                    <option value="query">Query Params</option>
                  </select>
                </div>
              </div>
            )}

            {/* Custom Header */}
            {request.auth?.auth_type === 'custom' && (
              <div className="space-y-3">
                <div className="space-y-1">
                  <label className="text-gray-400 font-medium text-[11px]">Header Name</label>
                  <input
                    type="text"
                    value={request.auth?.custom_header_name || ''}
                    onChange={(e) => updateAuth({ custom_header_name: e.target.value })}
                    placeholder="e.g. Authorization or X-Custom-Token"
                    className="w-full bg-[#14161b] border border-gray-700/80 rounded px-2.5 py-1.5 text-xs text-gray-200 outline-none focus:border-blue-500 font-mono"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-gray-400 font-medium text-[11px]">Header Value</label>
                  <input
                    type="text"
                    value={request.auth?.custom_header_value || ''}
                    onChange={(e) => updateAuth({ custom_header_value: e.target.value })}
                    placeholder="e.g. Token {{token}}"
                    className="w-full bg-[#14161b] border border-gray-700/80 rounded px-2.5 py-1.5 text-xs text-gray-200 outline-none focus:border-blue-500 font-mono"
                  />
                </div>
              </div>
            )}
          </div>
        )}

        {/* BODY TAB */}
        {activeTab === 'body' && (
          <div className="space-y-3 h-full flex flex-col">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-4">
                <label className="flex items-center space-x-1.5 cursor-pointer text-gray-300">
                  <input
                    type="radio"
                    name="body_type"
                    checked={request.body.body_type === 'none'}
                    onChange={() =>
                      onChange({ ...request, body: { ...request.body, body_type: 'none' } })
                    }
                    className="text-blue-600 focus:ring-0"
                  />
                  <span>none</span>
                </label>

                <label className="flex items-center space-x-1.5 cursor-pointer text-gray-300">
                  <input
                    type="radio"
                    name="body_type"
                    checked={request.body.body_type === 'json'}
                    onChange={() =>
                      onChange({ ...request, body: { ...request.body, body_type: 'json' } })
                    }
                    className="text-blue-600 focus:ring-0"
                  />
                  <span>JSON</span>
                </label>

                <label className="flex items-center space-x-1.5 cursor-pointer text-gray-300">
                  <input
                    type="radio"
                    name="body_type"
                    checked={request.body.body_type === 'text'}
                    onChange={() =>
                      onChange({ ...request, body: { ...request.body, body_type: 'text' } })
                    }
                    className="text-blue-600 focus:ring-0"
                  />
                  <span>Raw Text</span>
                </label>

                <label className="flex items-center space-x-1.5 cursor-pointer text-gray-300">
                  <input
                    type="radio"
                    name="body_type"
                    checked={request.body.body_type === 'urlencoded'}
                    onChange={() =>
                      onChange({
                        ...request,
                        body: {
                          ...request.body,
                          body_type: 'urlencoded',
                          url_encoded: request.body.url_encoded || [],
                        },
                      })
                    }
                    className="text-blue-600 focus:ring-0"
                  />
                  <span>URL-encoded</span>
                </label>

                <label className="flex items-center space-x-1.5 cursor-pointer text-gray-300">
                  <input
                    type="radio"
                    name="body_type"
                    checked={request.body.body_type === 'graphql'}
                    onChange={() =>
                      onChange({
                        ...request,
                        method: request.method === 'GET' ? 'POST' : request.method,
                        body: {
                          ...request.body,
                          body_type: 'graphql',
                          graphql_query: request.body.graphql_query ?? '',
                          graphql_variables: request.body.graphql_variables ?? '',
                        },
                      })
                    }
                    className="text-blue-600 focus:ring-0"
                  />
                  <span className="flex items-center space-x-1">
                    <span>GraphQL</span>
                    <span className="w-1.5 h-1.5 rounded-full bg-pink-500" />
                  </span>
                </label>
              </div>

              {request.body.body_type === 'json' && (
                <button
                  type="button"
                  onClick={formatJsonBody}
                  className="flex items-center space-x-1 bg-gray-800 hover:bg-gray-700 text-gray-300 px-2.5 py-1 rounded border border-gray-700 transition-colors"
                >
                  <Sparkles className="w-3 h-3 text-blue-400" />
                  <span>Format JSON</span>
                </button>
              )}
            </div>

            {/* JSON / Text Editor */}
            {(request.body.body_type === 'json' || request.body.body_type === 'text') && (
              <div className="flex-1 flex flex-col space-y-1 min-h-[300px]">
                {jsonError && (
                  <div className="bg-rose-950/40 border border-rose-800/60 text-rose-300 p-2 rounded text-[11px] flex items-center space-x-1.5">
                    <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
                    <span className="truncate">JSON Syntax Error: {jsonError}</span>
                  </div>
                )}
                <div className="flex-1 min-h-[300px]">
                  <CodeEditor
                    value={request.body.raw || ''}
                    language={request.body.body_type === 'json' ? 'json' : 'plaintext'}
                    path={
                      request.body.body_type === 'json'
                        ? 'ezman-request-body.json'
                        : 'ezman-request-body.txt'
                    }
                    onChange={(val) => {
                      onChange({
                        ...request,
                        body: { ...request.body, raw: val },
                      });
                      if (request.body.body_type === 'json') {
                        validateJson(val);
                      }
                    }}
                  />
                </div>
              </div>
            )}

            {/* URL Encoded Form */}
            {request.body.body_type === 'urlencoded' && (
              <div className="space-y-2">
                <button
                  onClick={() => {
                    const items = request.body.url_encoded || [];
                    onChange({
                      ...request,
                      body: {
                        ...request.body,
                        url_encoded: [...items, { key: '', value: '', enabled: true }],
                      },
                    });
                  }}
                  className="flex items-center space-x-1 text-blue-400 hover:text-blue-300 font-medium"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Add Field</span>
                </button>

                <div className="border border-gray-800 rounded-md overflow-hidden bg-[#14161b]">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="border-b border-gray-800 bg-gray-900/60 text-gray-400 font-medium text-[11px]">
                        <th className="w-8 py-1.5 px-2 text-center"></th>
                        <th className="py-1.5 px-3">Field Key</th>
                        <th className="py-1.5 px-3">Field Value</th>
                        <th className="w-8 py-1.5 px-2"></th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-800/60 font-mono text-xs">
                      {(request.body.url_encoded || []).map((item, idx) => (
                        <tr key={idx} className="hover:bg-gray-800/20 group">
                          <td className="py-1 px-2 text-center">
                            <input
                              type="checkbox"
                              checked={item.enabled}
                              onChange={(e) => {
                                const items = [...(request.body.url_encoded || [])];
                                items[idx] = { ...items[idx], enabled: e.target.checked };
                                onChange({
                                  ...request,
                                  body: { ...request.body, url_encoded: items },
                                });
                              }}
                              className="rounded border-gray-700 bg-gray-800 text-blue-600 focus:ring-0 cursor-pointer"
                            />
                          </td>
                          <td className="py-1 px-3">
                            <input
                              type="text"
                              value={item.key}
                              onChange={(e) => {
                                const items = [...(request.body.url_encoded || [])];
                                items[idx] = { ...items[idx], key: e.target.value };
                                onChange({
                                  ...request,
                                  body: { ...request.body, url_encoded: items },
                                });
                              }}
                              placeholder="key"
                              className="w-full bg-transparent text-gray-200 outline-none placeholder-gray-600"
                            />
                          </td>
                          <td className="py-1 px-3">
                            <input
                              type="text"
                              value={item.value}
                              onChange={(e) => {
                                const items = [...(request.body.url_encoded || [])];
                                items[idx] = { ...items[idx], value: e.target.value };
                                onChange({
                                  ...request,
                                  body: { ...request.body, url_encoded: items },
                                });
                              }}
                              placeholder="value"
                              className="w-full bg-transparent text-gray-200 outline-none placeholder-gray-600"
                            />
                          </td>
                          <td className="py-1 px-2 text-center">
                            <button
                              onClick={() => {
                                const items = (request.body.url_encoded || []).filter(
                                  (_, i) => i !== idx
                                );
                                onChange({
                                  ...request,
                                  body: { ...request.body, url_encoded: items },
                                });
                              }}
                              className="opacity-0 group-hover:opacity-100 p-1 hover:text-rose-400 text-gray-500 transition-opacity"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* GraphQL Editor */}
            {request.body.body_type === 'graphql' && (
              <div className="flex-1 flex flex-col space-y-3 min-h-0">
                {/* Query / Mutation / Subscription Section */}
                <div className="flex-1 flex flex-col min-h-[180px] space-y-1.5">
                  <div className="flex items-center justify-between text-[11px] text-gray-400">
                    <div className="flex items-center space-x-2">
                      <span className="font-semibold text-gray-300 uppercase tracking-wider">
                        Query / Mutation / Subscription
                      </span>
                      <span
                        className={`px-1.5 py-0.5 rounded text-[10px] font-mono font-semibold border ${
                          detectOperationType(request.body.graphql_query) === 'MUTATION'
                            ? 'bg-amber-950/60 text-amber-300 border-amber-700/60'
                            : detectOperationType(request.body.graphql_query) === 'SUBSCRIPTION'
                            ? 'bg-purple-950/60 text-purple-300 border-purple-700/60'
                            : 'bg-blue-950/60 text-blue-300 border-blue-700/60'
                        }`}
                      >
                        {detectOperationType(request.body.graphql_query)}
                      </span>
                    </div>

                    <div className="flex items-center space-x-1.5">
                      <span className="text-gray-500 text-[10px]">Snippets:</span>
                      <button
                        type="button"
                        onClick={() => insertGqlSnippet('query')}
                        className="px-2 py-0.5 rounded bg-gray-800 hover:bg-gray-700 text-gray-300 text-[10px] transition-colors"
                      >
                        + Query
                      </button>
                      <button
                        type="button"
                        onClick={() => insertGqlSnippet('mutation')}
                        className="px-2 py-0.5 rounded bg-gray-800 hover:bg-gray-700 text-amber-300 text-[10px] transition-colors"
                      >
                        + Mutation
                      </button>
                      <button
                        type="button"
                        onClick={() => insertGqlSnippet('subscription')}
                        className="px-2 py-0.5 rounded bg-gray-800 hover:bg-gray-700 text-purple-300 text-[10px] transition-colors"
                      >
                        + Subscription
                      </button>
                    </div>
                  </div>

                  <div className="flex-1 min-h-[200px]">
                    <CodeEditor
                      value={request.body.graphql_query || ''}
                      language="graphql"
                      path="ezman-request-graphql.graphql"
                      onChange={(val) =>
                        onChange({
                          ...request,
                          body: { ...request.body, graphql_query: val },
                        })
                      }
                    />
                  </div>
                </div>

                {/* Variables Section */}
                <div className="h-48 flex flex-col space-y-1.5 border-t border-gray-800 pt-2">
                  <div className="flex items-center justify-between text-[11px] text-gray-400">
                    <div className="flex items-center space-x-2">
                      <span className="font-semibold text-gray-300 uppercase tracking-wider">
                        Query Variables (JSON)
                      </span>
                      {graphqlVarsError && (
                        <span className="text-rose-400 text-[10px] flex items-center space-x-1">
                          <AlertCircle className="w-3 h-3 flex-shrink-0" />
                          <span className="truncate max-w-xs">{graphqlVarsError}</span>
                        </span>
                      )}
                    </div>

                    <button
                      type="button"
                      onClick={formatGraphqlVars}
                      className="flex items-center space-x-1 bg-gray-800 hover:bg-gray-700 text-gray-300 px-2 py-0.5 rounded border border-gray-700 text-[10px] transition-colors"
                    >
                      <Sparkles className="w-3 h-3 text-blue-400" />
                      <span>Format Variables</span>
                    </button>
                  </div>

                  <div className="flex-1 min-h-[140px]">
                    <CodeEditor
                      value={request.body.graphql_variables || ''}
                      language="json"
                      path="ezman-request-graphql-vars.json"
                      onChange={(val) => {
                        onChange({
                          ...request,
                          body: { ...request.body, graphql_variables: val },
                        });
                        validateGraphqlVars(val);
                      }}
                    />
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* SCRIPTS TAB */}
        {activeTab === 'scripts' && (
          <div className="h-full min-h-[280px] flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <div className="inline-flex rounded border border-gray-700 overflow-hidden">
                {(
                  [
                    ['pre_request', 'Pre-request'],
                    ['post_response', 'Post-response'],
                  ] as const
                ).map(([key, label]) => (
                  <button
                    key={key}
                    onClick={() => setScriptStage(key)}
                    className={`px-3 py-1 text-[11px] flex items-center gap-1.5 transition-colors ${
                      scriptStage === key
                        ? 'bg-blue-600/25 text-blue-300'
                        : 'text-gray-400 hover:bg-gray-800'
                    }`}
                  >
                    {label}
                    {request.scripts?.[key]?.trim() && (
                      <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
                    )}
                  </button>
                ))}
              </div>
              <span className="text-[10px] text-gray-500">
                {scriptStage === 'pre_request' ? 'Runs before the request is sent' : 'Runs after a response is received'}
              </span>
            </div>

            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-[10px] text-gray-500 mr-1">Snippets:</span>
              {(scriptStage === 'post_response'
                ? SCRIPT_SNIPPETS.post
                : SCRIPT_SNIPPETS.pre
              ).map((sn) => (
                <button
                  key={sn.label}
                  type="button"
                  onClick={() => appendScript(sn.code)}
                  className="px-2 py-0.5 rounded bg-gray-800 hover:bg-gray-700 text-gray-300 text-[10px] transition-colors"
                >
                  + {sn.label}
                </button>
              ))}
            </div>

            <div className="flex-1 min-h-[220px] border border-gray-800 rounded overflow-hidden">
              <CodeEditor
                key={`script-${scriptStage}`}
                value={request.scripts?.[scriptStage] ?? ''}
                language="javascript"
                path={`ezman-script-${scriptStage}.js`}
                onChange={(val) =>
                  onChange({
                    ...request,
                    scripts: {
                      pre_request: request.scripts?.pre_request ?? '',
                      post_response: request.scripts?.post_response ?? '',
                      [scriptStage]: val,
                    },
                  })
                }
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
