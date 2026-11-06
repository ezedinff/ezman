import React, { useState } from 'react';
import { X, Plus, Trash2, Check, Eye, EyeOff } from 'lucide-react';
import { ApiKeyLocation, AuthConfig, AuthType, Collection, KeyValueItem } from '../types';

interface CollectionVariablesModalProps {
  isOpen: boolean;
  onClose: () => void;
  collection: Collection | null;
  onSave: (updated: Collection) => void;
}

export const CollectionVariablesModal: React.FC<CollectionVariablesModalProps> = ({
  isOpen,
  onClose,
  collection,
  onSave,
}) => {
  if (!isOpen || !collection) return null;

  const [activeTab, setActiveTab] = useState<'variables' | 'auth'>('variables');
  const [editingCol, setEditingCol] = useState<Collection>(JSON.parse(JSON.stringify(collection)));
  const [showPassword, setShowPassword] = useState(false);

  const updateVariable = (idx: number, field: keyof KeyValueItem, val: any) => {
    const vars = [...editingCol.variables];
    vars[idx] = { ...vars[idx], [field]: val };
    setEditingCol({ ...editingCol, variables: vars });
  };

  const addVariable = () => {
    setEditingCol({
      ...editingCol,
      variables: [...editingCol.variables, { key: '', value: '', enabled: true }],
    });
  };

  const deleteVariable = (idx: number) => {
    setEditingCol({
      ...editingCol,
      variables: editingCol.variables.filter((_, i) => i !== idx),
    });
  };

  const updateAuth = (updater: Partial<AuthConfig>) => {
    setEditingCol({
      ...editingCol,
      auth: {
        ...(editingCol.auth || { auth_type: 'none' }),
        ...updater,
      },
    });
  };

  const handleSave = () => {
    onSave(editingCol);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-[#181a20] border border-gray-800 rounded-xl w-full max-w-2xl h-[480px] flex flex-col shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="p-3 border-b border-gray-800 flex items-center justify-between bg-[#15171d]">
          <div className="flex items-center space-x-2">
            <span className="font-semibold text-sm text-gray-200">
              Collection Settings: <span className="text-blue-400">{collection.name}</span>
            </span>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded hover:bg-gray-800 text-gray-400 hover:text-gray-200"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Tab switch */}
        <div className="flex items-center space-x-2 border-b border-gray-800 bg-[#14161b] px-4 pt-1 text-xs">
          <button
            onClick={() => setActiveTab('variables')}
            className={`px-3 py-1.5 font-medium border-b-2 transition-colors ${
              activeTab === 'variables'
                ? 'border-blue-500 text-blue-400'
                : 'border-transparent text-gray-400 hover:text-gray-200'
            }`}
          >
            Variables
          </button>
          <button
            onClick={() => setActiveTab('auth')}
            className={`px-3 py-1.5 font-medium border-b-2 transition-colors ${
              activeTab === 'auth'
                ? 'border-blue-500 text-blue-400'
                : 'border-transparent text-gray-400 hover:text-gray-200'
            }`}
          >
            Shared Auth
          </button>
        </div>

        {/* Body content */}
        <div className="flex-1 overflow-y-auto p-4 text-xs bg-[#181a20]">
          {activeTab === 'variables' && (
            <div className="space-y-3">
              <div className="flex items-center justify-between text-gray-400 text-[11px]">
                <span>Collection Variables (overridden by active Environment)</span>
                <button
                  onClick={addVariable}
                  className="flex items-center space-x-1 text-blue-400 hover:text-blue-300 font-medium"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Add Variable</span>
                </button>
              </div>

              <div className="border border-gray-800 rounded bg-[#13151a]">
                <table className="w-full text-left border-collapse text-xs font-mono">
                  <thead>
                    <tr className="border-b border-gray-800 bg-gray-900/80 text-gray-400 font-sans text-[11px]">
                      <th className="w-8 py-1.5 px-2 text-center"></th>
                      <th className="py-1.5 px-3">Variable Name</th>
                      <th className="py-1.5 px-3">Value</th>
                      <th className="w-8 py-1.5 px-2"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-800/60">
                    {editingCol.variables.map((v, idx) => (
                      <tr key={idx} className="hover:bg-gray-800/20 group">
                        <td className="py-1 px-2 text-center">
                          <input
                            type="checkbox"
                            checked={v.enabled}
                            onChange={(e) => updateVariable(idx, 'enabled', e.target.checked)}
                            className="rounded border-gray-700 bg-gray-800 text-blue-600 focus:ring-0 cursor-pointer"
                          />
                        </td>
                        <td className="py-1 px-3">
                          <input
                            type="text"
                            value={v.key}
                            onChange={(e) => updateVariable(idx, 'key', e.target.value)}
                            placeholder="key"
                            className="w-full bg-transparent text-gray-200 outline-none placeholder-gray-600"
                          />
                        </td>
                        <td className="py-1 px-3">
                          <input
                            type="text"
                            value={v.value}
                            onChange={(e) => updateVariable(idx, 'value', e.target.value)}
                            placeholder="value"
                            className="w-full bg-transparent text-gray-200 outline-none placeholder-gray-600"
                          />
                        </td>
                        <td className="py-1 px-2 text-center">
                          <button
                            onClick={() => deleteVariable(idx)}
                            className="opacity-0 group-hover:opacity-100 p-1 hover:text-rose-400 text-gray-500 transition-opacity"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </td>
                      </tr>
                    ))}
                    {editingCol.variables.length === 0 && (
                      <tr>
                        <td colSpan={4} className="py-4 text-center text-gray-500 font-sans text-xs">
                          No collection variables yet.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {activeTab === 'auth' && (
            <div className="space-y-4 max-w-md">
              <div className="space-y-1.5">
                <label className="text-gray-400 font-medium text-[11px]">Inherited Auth Type</label>
                <select
                  value={editingCol.auth?.auth_type || 'none'}
                  onChange={(e) => updateAuth({ auth_type: e.target.value as AuthType })}
                  className="w-full bg-[#14161b] border border-gray-700 rounded px-2.5 py-1.5 text-xs text-gray-200 outline-none focus:border-blue-500"
                >
                  <option value="none">No Auth</option>
                  <option value="bearer">Bearer Token</option>
                  <option value="basic">Basic Auth</option>
                  <option value="apikey">API Key</option>
                  <option value="custom">Custom Header</option>
                </select>
              </div>

              {editingCol.auth?.auth_type === 'bearer' && (
                <div className="space-y-1.5">
                  <label className="text-gray-400 font-medium text-[11px]">Token</label>
                  <div className="relative">
                    <input
                      type={showPassword ? 'text' : 'password'}
                      value={editingCol.auth?.bearer_token || ''}
                      onChange={(e) => updateAuth({ bearer_token: e.target.value })}
                      placeholder="Token or {{token}}"
                      className="w-full bg-[#14161b] border border-gray-700 rounded px-2.5 py-1.5 text-xs text-gray-200 outline-none focus:border-blue-500 font-mono"
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

              {editingCol.auth?.auth_type === 'basic' && (
                <div className="space-y-3">
                  <div className="space-y-1">
                    <label className="text-gray-400 font-medium text-[11px]">Username</label>
                    <input
                      type="text"
                      value={editingCol.auth?.basic_username || ''}
                      onChange={(e) => updateAuth({ basic_username: e.target.value })}
                      placeholder="Username or {{username}}"
                      className="w-full bg-[#14161b] border border-gray-700 rounded px-2.5 py-1.5 text-xs text-gray-200 outline-none focus:border-blue-500 font-mono"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-gray-400 font-medium text-[11px]">Password</label>
                    <div className="relative">
                      <input
                        type={showPassword ? 'text' : 'password'}
                        value={editingCol.auth?.basic_password || ''}
                        onChange={(e) => updateAuth({ basic_password: e.target.value })}
                        placeholder="Password or {{password}}"
                        className="w-full bg-[#14161b] border border-gray-700 rounded px-2.5 py-1.5 text-xs text-gray-200 outline-none focus:border-blue-500 font-mono"
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

              {editingCol.auth?.auth_type === 'apikey' && (
                <div className="space-y-3">
                  <div className="space-y-1">
                    <label className="text-gray-400 font-medium text-[11px]">Key Name</label>
                    <input
                      type="text"
                      value={editingCol.auth?.api_key_name || ''}
                      onChange={(e) => updateAuth({ api_key_name: e.target.value })}
                      placeholder="e.g. X-API-Key"
                      className="w-full bg-[#14161b] border border-gray-700 rounded px-2.5 py-1.5 text-xs text-gray-200 outline-none focus:border-blue-500 font-mono"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-gray-400 font-medium text-[11px]">Key Value</label>
                    <input
                      type="text"
                      value={editingCol.auth?.api_key_value || ''}
                      onChange={(e) => updateAuth({ api_key_value: e.target.value })}
                      placeholder="Value or {{apiKey}}"
                      className="w-full bg-[#14161b] border border-gray-700 rounded px-2.5 py-1.5 text-xs text-gray-200 outline-none focus:border-blue-500 font-mono"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-gray-400 font-medium text-[11px]">Location</label>
                    <select
                      value={editingCol.auth?.api_key_in || 'header'}
                      onChange={(e) => updateAuth({ api_key_in: e.target.value as ApiKeyLocation })}
                      className="w-full bg-[#14161b] border border-gray-700 rounded px-2.5 py-1.5 text-xs text-gray-200 outline-none focus:border-blue-500"
                    >
                      <option value="header">Header</option>
                      <option value="query">Query Params</option>
                    </select>
                  </div>
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
            onClick={handleSave}
            className="flex items-center space-x-1.5 bg-blue-600 hover:bg-blue-500 text-white px-4 py-1.5 rounded text-xs font-semibold shadow-md transition-colors"
          >
            <Check className="w-3.5 h-3.5" />
            <span>Save Settings</span>
          </button>
        </div>
      </div>
    </div>
  );
};
