import React, { useState, useEffect } from 'react';
import { X, Plus, Trash2, Eye, EyeOff, Lock, Check } from 'lucide-react';
import { Environment, EnvironmentVariable } from '../types';
import { ConfirmModal } from './ConfirmModal';

interface EnvironmentModalProps {
  isOpen: boolean;
  onClose: () => void;
  environments: Environment[];
  onSaveEnvironment: (env: Environment) => void;
  onDeleteEnvironment: (id: string) => void;
}

export const EnvironmentModal: React.FC<EnvironmentModalProps> = ({
  isOpen,
  onClose,
  environments,
  onSaveEnvironment,
  onDeleteEnvironment,
}) => {
  const [selectedEnvId, setSelectedEnvId] = useState<string | null>(null);
  const [editingEnv, setEditingEnv] = useState<Environment | null>(null);
  const [showSecrets, setShowSecrets] = useState<Record<number, boolean>>({});
  const [isConfirmDeleteOpen, setIsConfirmDeleteOpen] = useState(false);

  useEffect(() => {
    if (environments.length > 0) {
      if (!selectedEnvId || !environments.some((e) => e.id === selectedEnvId)) {
        setSelectedEnvId(environments[0].id);
        setEditingEnv(JSON.parse(JSON.stringify(environments[0])));
      } else {
        const found = environments.find((e) => e.id === selectedEnvId);
        if (found) {
          setEditingEnv(JSON.parse(JSON.stringify(found)));
        }
      }
    } else {
      setSelectedEnvId(null);
      setEditingEnv(null);
    }
  }, [environments, isOpen]);

  if (!isOpen) return null;

  const handleSelectEnv = (env: Environment) => {
    setSelectedEnvId(env.id);
    setEditingEnv(JSON.parse(JSON.stringify(env)));
    setShowSecrets({});
  };

  const handleCreateNew = () => {
    const newEnv: Environment = {
      id: 'env_' + Math.random().toString(36).substring(2, 9),
      name: 'New Environment',
      variables: [
        { key: 'baseUrl', value: 'http://localhost:3000', enabled: true, secret: false },
      ],
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    onSaveEnvironment(newEnv);
    setSelectedEnvId(newEnv.id);
    setEditingEnv(newEnv);
  };

  const handleSave = () => {
    if (!editingEnv) return;
    onSaveEnvironment(editingEnv);
  };

  const handleDelete = () => {
    if (!editingEnv) return;
    setIsConfirmDeleteOpen(true);
  };

  const updateVariable = (idx: number, field: keyof EnvironmentVariable, val: any) => {
    if (!editingEnv) return;
    const updated = [...editingEnv.variables];
    updated[idx] = { ...updated[idx], [field]: val };
    setEditingEnv({ ...editingEnv, variables: updated });
  };

  const addVariable = () => {
    if (!editingEnv) return;
    setEditingEnv({
      ...editingEnv,
      variables: [
        ...editingEnv.variables,
        { key: '', value: '', enabled: true, secret: false },
      ],
    });
  };

  const deleteVariable = (idx: number) => {
    if (!editingEnv) return;
    setEditingEnv({
      ...editingEnv,
      variables: editingEnv.variables.filter((_, i) => i !== idx),
    });
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-[#181a20] border border-gray-800 rounded-xl w-full max-w-3xl h-[520px] flex flex-col shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="p-3 border-b border-gray-800 flex items-center justify-between bg-[#15171d]">
          <span className="font-semibold text-sm text-gray-200">Manage Environments</span>
          <button
            onClick={onClose}
            className="p-1 rounded hover:bg-gray-800 text-gray-400 hover:text-gray-200"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content body: 2-column layout */}
        <div className="flex-1 flex overflow-hidden">
          {/* Environments list on the left */}
          <div className="w-56 border-r border-gray-800 bg-[#14161b] p-2 flex flex-col justify-between">
            <div className="space-y-1 overflow-y-auto">
              <span className="text-[10px] uppercase font-semibold text-gray-500 tracking-wider px-2 py-1 block">
                Environments
              </span>
              {environments.map((env) => (
                <div
                  key={env.id}
                  onClick={() => handleSelectEnv(env)}
                  className={`px-3 py-1.5 rounded text-xs cursor-pointer truncate transition-colors flex items-center justify-between ${
                    env.id === selectedEnvId
                      ? 'bg-blue-600/20 text-blue-400 font-semibold border border-blue-500/40'
                      : 'text-gray-300 hover:bg-gray-800/60'
                  }`}
                >
                  <span className="truncate">{env.name}</span>
                  <span className="text-[10px] text-gray-500 font-mono ml-1">
                    {env.variables.length}
                  </span>
                </div>
              ))}
            </div>

            <button
              onClick={handleCreateNew}
              className="w-full flex items-center justify-center space-x-1.5 py-1.5 mt-2 rounded bg-gray-800/80 hover:bg-gray-700/80 border border-gray-700/60 text-xs font-medium text-gray-200 transition-colors"
            >
              <Plus className="w-3.5 h-3.5 text-blue-400" />
              <span>Add Environment</span>
            </button>
          </div>

          {/* Environment details on the right */}
          <div className="flex-1 flex flex-col bg-[#181a20] p-4 overflow-hidden">
            {editingEnv ? (
              <div className="flex-1 flex flex-col overflow-hidden space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex-1 mr-4">
                    <label className="text-[11px] font-medium text-gray-400 block mb-1">
                      Environment Name
                    </label>
                    <input
                      type="text"
                      value={editingEnv.name}
                      onChange={(e) =>
                        setEditingEnv({ ...editingEnv, name: e.target.value })
                      }
                      className="w-full bg-[#121418] border border-gray-700 rounded px-2.5 py-1.5 text-xs text-gray-100 outline-none focus:border-blue-500 font-medium"
                    />
                  </div>

                  <button
                    onClick={handleDelete}
                    className="flex items-center space-x-1 text-rose-400 hover:text-rose-300 hover:bg-rose-950/40 border border-rose-900/60 px-2.5 py-1.5 rounded text-xs mt-4 transition-colors"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>Delete</span>
                  </button>
                </div>

                <div className="flex-1 flex flex-col overflow-hidden">
                  <div className="flex items-center justify-between text-[11px] text-gray-400 mb-1.5">
                    <span>Variables (referenced via <code className="text-blue-300">{`{{variable}}`}</code>)</span>
                    <button
                      onClick={addVariable}
                      className="flex items-center space-x-1 text-blue-400 hover:text-blue-300 font-medium"
                    >
                      <Plus className="w-3 h-3" />
                      <span>Add Variable</span>
                    </button>
                  </div>

                  <div className="flex-1 overflow-y-auto border border-gray-800 rounded bg-[#13151a]">
                    <table className="w-full text-left border-collapse text-xs">
                      <thead>
                        <tr className="border-b border-gray-800 bg-gray-900/80 text-gray-400 text-[11px] font-medium">
                          <th className="w-8 py-1.5 px-2 text-center"></th>
                          <th className="py-1.5 px-3">Variable Name</th>
                          <th className="py-1.5 px-3">Value</th>
                          <th className="w-14 py-1.5 px-2 text-center">Secret</th>
                          <th className="w-8 py-1.5 px-2"></th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-800/60 font-mono text-xs">
                        {editingEnv.variables.map((v, idx) => {
                          const isSecret = v.secret;
                          const show = showSecrets[idx];
                          return (
                            <tr key={idx} className="hover:bg-gray-800/20 group">
                              <td className="py-1 px-2 text-center">
                                <input
                                  type="checkbox"
                                  checked={v.enabled}
                                  onChange={(e) =>
                                    updateVariable(idx, 'enabled', e.target.checked)
                                  }
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
                                <div className="relative flex items-center">
                                  <input
                                    type={isSecret && !show ? 'password' : 'text'}
                                    value={v.value}
                                    onChange={(e) =>
                                      updateVariable(idx, 'value', e.target.value)
                                    }
                                    placeholder="value"
                                    className="w-full bg-transparent text-gray-200 outline-none placeholder-gray-600 pr-6"
                                  />
                                  {isSecret && (
                                    <button
                                      type="button"
                                      onClick={() =>
                                        setShowSecrets((prev) => ({
                                          ...prev,
                                          [idx]: !prev[idx],
                                        }))
                                      }
                                      className="text-gray-500 hover:text-gray-300 ml-1"
                                    >
                                      {show ? (
                                        <EyeOff className="w-3.5 h-3.5" />
                                      ) : (
                                        <Eye className="w-3.5 h-3.5" />
                                      )}
                                    </button>
                                  )}
                                </div>
                              </td>
                              <td className="py-1 px-2 text-center">
                                <button
                                  type="button"
                                  title={isSecret ? 'Marked as Secret' : 'Not Secret'}
                                  onClick={() => updateVariable(idx, 'secret', !isSecret)}
                                  className={`p-1 rounded transition-colors ${
                                    isSecret
                                      ? 'text-amber-400 bg-amber-950/60 border border-amber-800/40'
                                      : 'text-gray-600 hover:text-gray-400'
                                  }`}
                                >
                                  <Lock className="w-3 h-3" />
                                </button>
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
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>

                <div className="flex justify-end pt-2 border-t border-gray-800">
                  <button
                    onClick={handleSave}
                    className="flex items-center space-x-1.5 bg-blue-600 hover:bg-blue-500 text-white px-4 py-1.5 rounded text-xs font-semibold shadow-md transition-colors"
                  >
                    <Check className="w-3.5 h-3.5" />
                    <span>Save Environment</span>
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex-1 flex items-center justify-center text-gray-500 text-xs">
                No environment selected.
              </div>
            )}
          </div>
        </div>
      </div>

      <ConfirmModal
        isOpen={isConfirmDeleteOpen}
        title="Delete Environment"
        message={`Are you sure you want to delete environment '${editingEnv?.name}'? This action cannot be undone.`}
        confirmText="Delete"
        onConfirm={() => {
          if (editingEnv) {
            onDeleteEnvironment(editingEnv.id);
          }
          setIsConfirmDeleteOpen(false);
        }}
        onCancel={() => setIsConfirmDeleteOpen(false)}
      />
    </div>
  );
};
