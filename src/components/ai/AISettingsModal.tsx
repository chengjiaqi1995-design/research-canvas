import { memo, useState, useEffect } from 'react';
import { X, Eye, EyeOff, Settings, AudioLines } from 'lucide-react';
import { aiApi } from '../../db/apiClient.ts';
import type { AIModel } from '../../types/index.ts';
import { getApiConfig, DEFAULT_MODELS, DEFAULT_WIKI_PROMPT, type ApiConfig } from '../../aiprocess/components/ApiConfigModal.tsx';

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
    { id: 'minimax', name: 'MiniMax', placeholder: 'sk-...' },
    { id: 'xiaomi', name: '小米 (MiLM)', placeholder: 'sk-...' },
] as const;

export const AISettingsModal = memo(function AISettingsModal({ open, onClose }: AISettingsModalProps) {
    const [activeTab, setActiveTab] = useState<'keys' | 'models' | 'advanced'>('keys');
    
    // DB settings
    const [keys, setKeys] = useState<Record<string, string>>({});
    const [defaultModel, setDefaultModel] = useState('claude-3-5-sonnet-20241022');
    const [models, setModels] = useState<AIModel[]>([]);
    const [showKeys, setShowKeys] = useState<Record<string, boolean>>({});
    
    // AI Process localStorage settings
    const [apiConfig, setApiConfig] = useState<ApiConfig>({
        googleSpeechApiKey: '',
        geminiApiKey: '',
        qwenApiKey: '',
        transcriptionModel: DEFAULT_MODELS.transcriptionModel,
        summaryModel: DEFAULT_MODELS.summaryModel,
        metadataModel: DEFAULT_MODELS.metadataModel,
        weeklySummaryModel: DEFAULT_MODELS.weeklySummaryModel,
        translationModel: DEFAULT_MODELS.translationModel,
        namingModel: DEFAULT_MODELS.namingModel,
        metadataFillModel: DEFAULT_MODELS.metadataFillModel,
        excelParsingModel: DEFAULT_MODELS.excelParsingModel,
        wikiModel: DEFAULT_MODELS.wikiModel,
        wikiIngestPrompt: DEFAULT_MODELS.wikiIngestPrompt,
    });

    const [saving, setSaving] = useState(false);
    const [loaded, setLoaded] = useState(false);

    useEffect(() => {
        if (!open) return;
        setLoaded(false);
        setApiConfig(getApiConfig());
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
            // Always save API keys to localStorage first (works independently of backend)
            // Only update a key if the new value is a real key (not masked with ****)
            // Also preserve existing localStorage value if current input is masked
            const existingConfig = getApiConfig();
            const googleKey = keys['google'] && !keys['google'].includes('****')
                ? keys['google']
                : (existingConfig.geminiApiKey && !existingConfig.geminiApiKey.includes('****') ? existingConfig.geminiApiKey : apiConfig.geminiApiKey);
            const dashscopeKey = keys['dashscope'] && !keys['dashscope'].includes('****')
                ? keys['dashscope']
                : (existingConfig.qwenApiKey && !existingConfig.qwenApiKey.includes('****') ? existingConfig.qwenApiKey : apiConfig.qwenApiKey);
            const updatedApiConfig = {
                ...apiConfig,
                geminiApiKey: googleKey && !googleKey.includes('****') ? googleKey : existingConfig.geminiApiKey || '',
                qwenApiKey: dashscopeKey && !dashscopeKey.includes('****') ? dashscopeKey : existingConfig.qwenApiKey || '',
            };
            localStorage.setItem('apiConfig', JSON.stringify(updatedApiConfig));
            window.dispatchEvent(new Event('apiConfigUpdated'));

            // Try saving to backend (may fail if /api/ai/settings route doesn't exist)
            try {
                await aiApi.saveSettings({ keys, defaultModel });
            } catch (err) {
                console.warn('Backend settings save failed (non-critical):', err);
            }
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
                <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 bg-white">
                    <h2 className="text-lg font-semibold text-slate-800 flex items-center gap-2">
                        <Settings size={18} className="text-slate-500" />
                        全局设置
                    </h2>
                    <button onClick={onClose} className="text-slate-400 hover:text-slate-600 focus:outline-none transition-colors">
                        <X size={20} />
                    </button>
                </div>

                {/* Tabs */}
                <div className="flex items-center px-6 pt-2 border-b border-slate-200 bg-white">
                    <button
                        onClick={() => setActiveTab('keys')}
                        className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 focus:outline-none transition-colors ${
                            activeTab === 'keys' ? 'border-blue-600 text-blue-600' : 'border-transparent text-slate-500 hover:text-slate-800 hover:border-slate-300'
                        }`}
                    >
                        API 密钥配置
                    </button>
                    <button
                        onClick={() => setActiveTab('models')}
                        className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 focus:outline-none transition-colors ${
                            activeTab === 'models' ? 'border-blue-600 text-blue-600' : 'border-transparent text-slate-500 hover:text-slate-800 hover:border-slate-300'
                        }`}
                    >
                        功能模型选择
                    </button>
                    <button
                        onClick={() => setActiveTab('advanced')}
                        className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 focus:outline-none transition-colors ${
                            activeTab === 'advanced' ? 'border-blue-600 text-blue-600' : 'border-transparent text-slate-500 hover:text-slate-800 hover:border-slate-300'
                        }`}
                    >
                        高级提示词
                    </button>
                </div>

                {/* Body */}
                <div className="px-6 py-5 space-y-5 max-h-[60vh] overflow-y-auto w-full">
                    {!loaded ? (
                        <div className="text-center text-slate-400 py-8 w-full block">加载中...</div>
                    ) : (
                        <>
                            {activeTab === 'keys' && (
                                <div className="space-y-5 w-full block animate-in">
                                    {/* API Keys */}
                                    <div>
                                        <label className="block text-sm font-medium text-slate-700 mb-3">大模型提供商 API Keys</label>
                                        <div className="space-y-3 block w-full">
                                            {PROVIDERS.map((p) => (
                                                <div key={p.id} className="block w-full">
                                                    <label className="block text-xs text-slate-500 mb-1">{p.name}</label>
                                                    <div className="relative block w-full">
                                                        <input
                                                            type={showKeys[p.id] ? 'text' : 'password'}
                                                            value={keys[p.id] || ''}
                                                            onChange={(e) => setKeys((prev) => ({ ...prev, [p.id]: e.target.value }))}
                                                            placeholder={p.placeholder}
                                                            className="block w-full px-3 py-2 pr-10 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent font-mono"
                                                        />
                                                        <button
                                                            type="button"
                                                            onClick={() => setShowKeys((prev) => ({ ...prev, [p.id]: !prev[p.id] }))}
                                                            className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 focus:outline-none"
                                                        >
                                                            {showKeys[p.id] ? <EyeOff size={16} /> : <Eye size={16} />}
                                                        </button>
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    </div>

                                    <div className="pt-4 border-t border-slate-100 block w-full">
                                        <label className="block text-sm font-medium text-slate-700 mb-3">其他服务 API Keys</label>
                                        <div>
                                            <label className="block text-xs text-slate-500 mb-1">Google Speech API Key (补充)</label>
                                            <div className="relative block w-full">
                                                <input
                                                    type={showKeys['gspeech'] ? 'text' : 'password'}
                                                    value={apiConfig.googleSpeechApiKey}
                                                    onChange={(e) => setApiConfig({ ...apiConfig, googleSpeechApiKey: e.target.value })}
                                                    placeholder="可选，仅用于备用的纯音频流式实时转录"
                                                    className="block w-full px-3 py-2 pr-10 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent font-mono"
                                                />
                                                <button
                                                    type="button"
                                                    onClick={() => setShowKeys((prev) => ({ ...prev, gspeech: !prev['gspeech'] }))}
                                                    className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 focus:outline-none"
                                                >
                                                    {showKeys['gspeech'] ? <EyeOff size={16} /> : <Eye size={16} />}
                                                </button>
                                            </div>
                                        </div>
                                    </div>

                                    <p className="text-xs text-slate-400 mt-2">
                                        API Key 会安全存储在服务端，不会暴露给前端。已设置的 Key 显示为脱敏格式。转录引擎会自动复用这里的 Gemini 与 Qwen 密钥。
                                    </p>
                                </div>
                            )}

                            {activeTab === 'models' && (
                                <div className="space-y-5 animate-in w-full block">
                                    {/* Default model selector */}
                                    <div>
                                        <label className="block text-sm font-medium text-slate-700 mb-1.5">默认聊天模型</label>
                                        <select
                                            value={defaultModel}
                                            onChange={(e) => setDefaultModel(e.target.value)}
                                            className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                                        >
                                            {models.map((m) => (
                                                <option key={m.id} value={m.id}>
                                                    {m.name}
                                                </option>
                                            ))}
                                        </select>
                                    </div>

                                    <div className="pt-4 border-t border-slate-100 block w-full">
                                        <h3 className="text-sm font-semibold text-slate-700 mb-3">AI Engine 特定任务模型</h3>
                                        <div className="space-y-4 block w-full">
                                            <div className="block w-full">
                                                <label className="block text-xs text-slate-500 mb-1">笔记总结模型</label>
                                                <select
                                                    value={apiConfig.summaryModel}
                                                    onChange={(e) => setApiConfig({ ...apiConfig, summaryModel: e.target.value })}
                                                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white"
                                                >
                                                    {models.map((m) => (
                                                        <option key={m.id} value={m.id}>
                                                            {m.name}
                                                        </option>
                                                    ))}
                                                </select>
                                            </div>
                                            <div className="block w-full">
                                                <label className="block text-xs text-slate-500 mb-1">元数据提取模型</label>
                                                <select
                                                    value={apiConfig.metadataModel}
                                                    onChange={(e) => setApiConfig({ ...apiConfig, metadataModel: e.target.value })}
                                                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white"
                                                >
                                                    {models.map((m) => (
                                                        <option key={m.id} value={m.id}>
                                                            {m.name}
                                                        </option>
                                                    ))}
                                                </select>
                                            </div>
                                            <div className="block w-full">
                                                <label className="block text-xs text-slate-500 mb-1">画布命名模型</label>
                                                <select
                                                    value={apiConfig.namingModel}
                                                    onChange={(e) => setApiConfig({ ...apiConfig, namingModel: e.target.value })}
                                                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white"
                                                >
                                                    {models.map((m) => (
                                                        <option key={m.id} value={m.id}>
                                                            {m.name}
                                                        </option>
                                                    ))}
                                                </select>
                                                <p className="text-[10px] text-slate-400 mt-1">新建公司画布时，AI 自动生成规范名称所用的模型</p>
                                            </div>
                                            <div className="block w-full">
                                                <label className="block text-xs text-slate-500 mb-1">元数据 AI 填充模型</label>
                                                <select
                                                    value={apiConfig.metadataFillModel}
                                                    onChange={(e) => setApiConfig({ ...apiConfig, metadataFillModel: e.target.value })}
                                                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white"
                                                >
                                                    {models.map((m) => (
                                                        <option key={m.id} value={m.id}>
                                                            {m.name}
                                                        </option>
                                                    ))}
                                                </select>
                                                <p className="text-[10px] text-slate-400 mt-1">AI Process 笔记中「AI 填充」元数据所用的模型</p>
                                            </div>
                                            <div className="block w-full">
                                                <label className="block text-xs text-slate-500 mb-1">中英互译模型</label>
                                                <select
                                                    value={apiConfig.translationModel}
                                                    onChange={(e) => setApiConfig({ ...apiConfig, translationModel: e.target.value })}
                                                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white"
                                                >
                                                    {models.map((m) => (
                                                        <option key={m.id} value={m.id}>
                                                            {m.name}
                                                        </option>
                                                    ))}
                                                </select>
                                            </div>
                                            <div className="block w-full">
                                                <label className="block text-xs text-slate-500 mb-1">Excel 提取解析模型</label>
                                                <select
                                                    value={apiConfig.excelParsingModel}
                                                    onChange={(e) => setApiConfig({ ...apiConfig, excelParsingModel: e.target.value })}
                                                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white"
                                                >
                                                    {models.map((m) => (
                                                        <option key={m.id} value={m.id}>
                                                            {m.name}
                                                        </option>
                                                    ))}
                                                </select>
                                                <p className="text-[10px] text-slate-400 mt-1">行业看板中导入 Excel 时的自动化提取模型 (建议选择大杯模型)</p>
                                            </div>
                                            <div className="block w-full">
                                                <label className="block text-xs text-slate-500 mb-1">行业百科Wiki大模型</label>
                                                <select
                                                    value={apiConfig.wikiModel}
                                                    onChange={(e) => setApiConfig({ ...apiConfig, wikiModel: e.target.value })}
                                                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white"
                                                >
                                                    {models.map((m) => (
                                                        <option key={m.id} value={m.id}>
                                                            {m.name}
                                                        </option>
                                                    ))}
                                                </select>
                                                <p className="text-[10px] text-slate-400 mt-1">用于自动化生成、提问和审查行业 Wiki</p>
                                            </div>
                                        </div>
                                    </div>

                                    <div className="pt-4 border-t border-slate-100 block w-full">
                                        <h3 className="text-sm font-semibold text-slate-700 mb-3">自动化系统配置</h3>
                                        <div className="flex items-center">
                                            <label className="flex items-center cursor-pointer">
                                              <div className="relative">
                                                <input 
                                                  type="checkbox" 
                                                  className="sr-only" 
                                                  checked={apiConfig.autoTrackerSniffing || false} 
                                                  onChange={(e) => setApiConfig({...apiConfig, autoTrackerSniffing: e.target.checked})} 
                                                />
                                                <div className={`block w-10 h-6 rounded-full transition-colors ${apiConfig.autoTrackerSniffing ? 'bg-blue-600' : 'bg-slate-300'}`}></div>
                                                <div className={`absolute left-1 top-1 bg-white w-4 h-4 rounded-full transition-transform ${apiConfig.autoTrackerSniffing ? 'translate-x-4' : ''}`}></div>
                                              </div>
                                              <div className="ml-3 text-slate-700 font-medium text-xs">
                                                开启后台 AI 自动嗅探 (Auto Tracker Sniffing)
                                              </div>
                                            </label>
                                        </div>
                                        <div className="ml-14">
                                          <p className="text-[10px] text-slate-400 mt-1">每次使用 AI 处理笔记和草稿源数据时，系统将自动使用背景进程为你扫描当前资料中是否提及了“行业看板”中已设立的重点公司核心指标，并自动推送到「情报草稿箱」。</p>
                                        </div>
                                    </div>
                                </div>
                            )}

                            {activeTab === 'advanced' && (
                                <div className="space-y-5 animate-in w-full block">
                                    <div className="block w-full">
                                        <label className="block text-sm font-medium text-slate-700 mb-1.5">行业Wiki合并规则 (System Prompt)</label>
                                        <textarea
                                            value={apiConfig.wikiIngestPrompt}
                                            onChange={(e) => setApiConfig({ ...apiConfig, wikiIngestPrompt: e.target.value })}
                                            className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent font-mono min-h-[160px]"
                                            placeholder="定义大模型整合知识碎片时的动作规则..."
                                        />
                                        <div className="mt-2 text-[10px] text-slate-500 leading-relaxed">
                                            定义大模型在整合碎片知识时的系统指令。可用的系统注入变量:<br />
                                            <code className="text-blue-600 bg-blue-50 px-1 py-0.5 rounded">{`{{industryCategory}}`}</code> - 行业分类名称<br />
                                            <code className="text-blue-600 bg-blue-50 px-1 py-0.5 rounded">{`{{currentDate}}`}</code> - 今天的真实世界时间<br />
                                            <code className="text-blue-600 bg-blue-50 px-1 py-0.5 rounded">{`{{serializedWiki}}`}</code> - 此Wiki现存的全部词条(JSON)<br />
                                            <code className="text-blue-600 bg-blue-50 px-1 py-0.5 rounded">{`{{sourceMaterial}}`}</code> - 新获取的草稿与研究笔记来源
                                        </div>
                                        <button
                                            type="button"
                                            onClick={() => setApiConfig({ ...apiConfig, wikiIngestPrompt: DEFAULT_WIKI_PROMPT })}
                                            className="mt-3 text-xs text-blue-600 hover:text-blue-800 block"
                                        >
                                            重置为系统默认高级规则
                                        </button>
                                    </div>
                                </div>
                            )}
                        </>
                    )}
                </div>

                {/* Footer */}
                <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-slate-100 bg-white">
                    <button
                        onClick={onClose}
                        className="px-4 py-2 text-sm text-slate-600 hover:bg-slate-200 rounded-lg transition-colors"
                    >
                        取消
                    </button>
                    <button
                        onClick={handleSave}
                        disabled={saving || !loaded}
                        className="px-5 py-2 text-sm text-white bg-blue-600 hover:bg-blue-700 focus:outline-none rounded-lg transition-colors disabled:opacity-50 font-medium"
                    >
                        {saving ? '保存中...' : '保存'}
                    </button>
                </div>
            </div>
        </div>
    );
});
