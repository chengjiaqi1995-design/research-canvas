import { memo, useState, useEffect } from 'react';
import { X, Eye, EyeOff } from 'lucide-react';
import { aiApi } from '../../db/apiClient.ts';
import type { AIModel } from '../../types/index.ts';

interface AISettingsModalProps {
    open: boolean;
    onClose: () => void;
}

const PROVIDERS = [
    { id: 'anthropic', name: 'Anthropic (Claude)', placeholder: 'sk-ant-...' },
    { id: 'openai', name: 'OpenAI (GPT)', placeholder: 'sk-...' },
    { id: 'google', name: 'Google (Gemini)', placeholder: 'AIza...' },
    { id: 'dashscope', name: '阿里云 DashScope (Qwen)', placeholder: 'sk-...' },
    { id: 'deepseek', name: 'DeepSeek', placeholder: 'sk-...' },
] as const;

export const AISettingsModal = memo(function AISettingsModal({ open, onClose }: AISettingsModalProps) {
    const [keys, setKeys] = useState<Record<string, string>>({});
    const [defaultModel, setDefaultModel] = useState('claude-3-5-sonnet-20241022');
    const [models, setModels] = useState<AIModel[]>([]);
    const [showKeys, setShowKeys] = useState<Record<string, boolean>>({});
    const [saving, setSaving] = useState(false);
    const [loaded, setLoaded] = useState(false);

    useEffect(() => {
        if (!open) return;
        setLoaded(false);
        Promise.all([aiApi.getSettings(), aiApi.getModels()])
            .then(([settings, modelList]) => {
                setKeys(settings.keys || {});
                setDefaultModel(settings.defaultModel || 'claude-3-5-sonnet-20241022');
                setModels(modelList as AIModel[]);
                setLoaded(true);
            })
            .catch((err) => {
                console.error('Failed to load AI settings:', err);
                setLoaded(true);
            });
    }, [open]);

    const handleSave = async () => {
        setSaving(true);
        try {
            await aiApi.saveSettings({ keys, defaultModel });
            onClose();
        } catch (err) {
            console.error('Failed to save settings:', err);
            alert('保存失败: ' + (err as Error).message);
        } finally {
            setSaving(false);
        }
    };

    if (!open) return null;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
            <div
                className="bg-white rounded-2xl shadow-xl w-full max-w-lg mx-4 overflow-hidden"
                onClick={(e) => e.stopPropagation()}
            >
                {/* Header */}
                <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 bg-gradient-to-r from-indigo-500 to-purple-600">
                    <h2 className="text-lg font-semibold text-white">⚙ AI 设置</h2>
                    <button onClick={onClose} className="text-white/80 hover:text-white transition-colors">
                        <X size={20} />
                    </button>
                </div>

                {/* Body */}
                <div className="px-6 py-5 space-y-5 max-h-[60vh] overflow-y-auto">
                    {!loaded ? (
                        <div className="text-center text-slate-400 py-8">加载中...</div>
                    ) : (
                        <>
                            {/* Default model selector */}
                            <div>
                                <label className="block text-sm font-medium text-slate-700 mb-1.5">默认模型</label>
                                <select
                                    value={defaultModel}
                                    onChange={(e) => setDefaultModel(e.target.value)}
                                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400 focus:border-transparent"
                                >
                                    {models.map((m) => (
                                        <option key={m.id} value={m.id}>
                                            {m.name}
                                        </option>
                                    ))}
                                </select>
                            </div>

                            {/* API Keys */}
                            <div>
                                <label className="block text-sm font-medium text-slate-700 mb-3">API Keys</label>
                                <div className="space-y-3">
                                    {PROVIDERS.map((p) => (
                                        <div key={p.id}>
                                            <label className="block text-xs text-slate-500 mb-1">{p.name}</label>
                                            <div className="relative">
                                                <input
                                                    type={showKeys[p.id] ? 'text' : 'password'}
                                                    value={keys[p.id] || ''}
                                                    onChange={(e) => setKeys((prev) => ({ ...prev, [p.id]: e.target.value }))}
                                                    placeholder={p.placeholder}
                                                    className="w-full px-3 py-2 pr-10 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400 focus:border-transparent font-mono"
                                                />
                                                <button
                                                    type="button"
                                                    onClick={() => setShowKeys((prev) => ({ ...prev, [p.id]: !prev[p.id] }))}
                                                    className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                                                >
                                                    {showKeys[p.id] ? <EyeOff size={16} /> : <Eye size={16} />}
                                                </button>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>

                            <p className="text-xs text-slate-400">
                                API Key 会安全存储在服务端，不会暴露给前端。已设置的 Key 显示为脱敏格式。
                            </p>
                        </>
                    )}
                </div>

                {/* Footer */}
                <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-slate-200 bg-slate-50">
                    <button
                        onClick={onClose}
                        className="px-4 py-2 text-sm text-slate-600 hover:bg-slate-200 rounded-lg transition-colors"
                    >
                        取消
                    </button>
                    <button
                        onClick={handleSave}
                        disabled={saving || !loaded}
                        className="px-4 py-2 text-sm text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg transition-colors disabled:opacity-50"
                    >
                        {saving ? '保存中...' : '保存'}
                    </button>
                </div>
            </div>
        </div>
    );
});
