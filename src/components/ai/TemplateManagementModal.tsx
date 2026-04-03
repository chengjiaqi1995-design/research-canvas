import React, { useState, useEffect, useRef, useMemo } from 'react';
import { X, BookOpen, Layers, Plus, Trash2, Save, Sparkles, AlertCircle, Upload } from 'lucide-react';
import { useAICardStore } from '../../stores/aiCardStore';
import { PROMPT_TEMPLATES } from '../../constants/promptTemplates';
import type { PromptTemplate, AISkill } from '../../types/index';
import { aiApi } from '../../db/apiClient';
import { message } from 'antd';

interface TemplateManagementModalProps {
    onClose: () => void;
    // initialTab can be 'prompt' or 'skill'
    initialTab?: 'prompt' | 'skill';
}

export function TemplateManagementModal({ onClose, initialTab = 'prompt' }: TemplateManagementModalProps) {
    const [activeTab, setActiveTab] = useState<'prompt' | 'skill'>(initialTab);
    
    const customTemplates = useAICardStore((s) => s.customTemplates);
    const addCustomTemplate = useAICardStore((s) => s.addCustomTemplate);
    const updateCustomTemplate = useAICardStore((s) => s.updateCustomTemplate);
    const removeCustomTemplate = useAICardStore((s) => s.removeCustomTemplate);

    const skills = useAICardStore((s) => s.skills);
    const addSkill = useAICardStore((s) => s.addSkill);
    const updateSkill = useAICardStore((s) => s.updateSkill);
    const removeSkill = useAICardStore((s) => s.removeSkill);

    const models = useAICardStore((s) => s.models);

    const mergedPrompts = useMemo(() => {
        return [...PROMPT_TEMPLATES, ...customTemplates];
    }, [customTemplates]);

    // Local selected item state
    const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);

    // Form states
    const [isEditing, setIsEditing] = useState(false);
    const [formData, setFormData] = useState({
        name: '',
        description: '',
        prompt: '',
        category: 'custom' as PromptTemplate['category'], // Only for prompts
    });

    const [isGenerating, setIsGenerating] = useState(false);

    // Filter categories for prompt
    const [filterCategory, setFilterCategory] = useState<string>('all');

    const promptCategories = [
        { key: 'all', label: '全部' },
        { key: 'analysis', label: '分析' },
        { key: 'summary', label: '摘要' },
        { key: 'comparison', label: '对比' },
        { key: 'research', label: '研究' },
        { key: 'custom', label: '自定义' },
    ];

    useEffect(() => {
        if (activeTab === 'prompt') {
            if (selectedItemId) {
                const item = mergedPrompts.find(p => p.id === selectedItemId);
                if (item) {
                    setFormData({
                        name: item.name,
                        description: item.description,
                        prompt: item.prompt,
                        category: item.category || 'custom'
                    });
                    setIsEditing(!item.id.startsWith('prompt_')); // Prompt constants don't start with custom_ but actually they have hardcoded ids like analysis_swot
                }
            } else {
                if (mergedPrompts.length > 0) setSelectedItemId(mergedPrompts[0].id);
            }
        } else {
            if (selectedItemId) {
                const item = skills.find(s => s.id === selectedItemId);
                if (item) {
                    setFormData({
                        name: item.name,
                        description: item.description || '',
                        prompt: item.content,
                        category: 'custom'
                    });
                    setIsEditing(true);
                }
            } else {
                if (skills.length > 0) setSelectedItemId(skills[0].id);
                else handleNew();
            }
        }
    }, [activeTab, selectedItemId, mergedPrompts, skills]);

    // Cleanup when tab changes
    useEffect(() => {
        setSelectedItemId(null);
        handleNew();
    }, [activeTab]);

    const handleNew = () => {
        setSelectedItemId('new');
        setFormData({
            name: '',
            description: '',
            prompt: '',
            category: 'custom'
        });
        setIsEditing(true);
    };

    const handleImportFile = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (event) => {
            const content = event.target?.result as string;
            const name = file.name.replace(/\.[^/.]+$/, ""); // Strip extension
            
            try {
                // If it's a JSON/Skill file
                if (file.name.endsWith('.json') || file.name.endsWith('.skill')) {
                    const parsed = JSON.parse(content);
                    const importedPrompt = parsed.prompt || parsed.content || content;
                    setFormData({
                        name: parsed.name || name,
                        description: parsed.description || '',
                        prompt: importedPrompt,
                        category: parsed.category || 'custom'
                    });
                } else {
                    // Raw text or markdown file
                    setFormData({
                        name: name,
                        description: '',
                        prompt: content,
                        category: 'custom'
                    });
                }
                
                setSelectedItemId('new');
                setIsEditing(true);
                message.success('已导入文件内容，请检查修改后保存');
            } catch (err) {
                // Fallback for failed JSON parsing
                setFormData({
                    name: name,
                    description: '',
                    prompt: content,
                    category: 'custom'
                });
                setSelectedItemId('new');
                setIsEditing(true);
                message.success('已导入文本内容，请检查修改后保存');
            }
            
            // clear input
            if (fileInputRef.current) {
                fileInputRef.current.value = '';
            }
        };
        reader.readAsText(file);
    };

    const handleSave = () => {
        if (!formData.name.trim() || !formData.prompt.trim()) {
            message.warning('名称和内容不能为空');
            return;
        }

        if (activeTab === 'prompt') {
            if (selectedItemId && selectedItemId !== 'new') {
                updateCustomTemplate(selectedItemId, { ...formData });
                message.success('已更新 Prompt 模板');
            } else {
                addCustomTemplate({ ...formData });
                message.success('已新建 Prompt 模板');
                // Could ideally select the newly added template, but selecting null falls back securely
                setSelectedItemId(null);
            }
        } else {
            if (selectedItemId && selectedItemId !== 'new') {
                updateSkill(selectedItemId, {
                    name: formData.name,
                    description: formData.description,
                    content: formData.prompt,
                });
                message.success('已更新方法论');
            } else {
                addSkill({
                    name: formData.name,
                    description: formData.description,
                    content: formData.prompt,
                });
                message.success('已新建方法论');
                setSelectedItemId(null);
            }
        }
    };

    const handleDelete = () => {
        if (!selectedItemId || selectedItemId === 'new') return;
        
        if (confirm(`确定删除此${activeTab === 'prompt' ? '模板' : '方法论'}？`)) {
            if (activeTab === 'prompt') {
                removeCustomTemplate(selectedItemId);
            } else {
                removeSkill(selectedItemId);
            }
            setSelectedItemId(null);
        }
    };

    const handleGenerateDescription = async () => {
        if (!formData.prompt.trim()) {
            message.warning('请先输入正文内容');
            return;
        }
        
        setIsGenerating(true);
        const typeStr = activeTab === 'prompt' ? 'Prompt (提示词)' : 'Skill (分析方法论)';
        const systemPrompt = `你是一个专业的助手。请根据用户提供的 ${typeStr} 内容，用 1 句话（最多 20 个字）总结其核心功能和适用场景。直接输出简介，不需要任何前缀或解释。`;
        
        let targetModel = 'gemini-2.0-flash-001';
        if (models && models.length > 0) {
            targetModel = models[0].id;
        }

        try {
            const stream = aiApi.chatStream({
                model: targetModel,
                systemPrompt,
                messages: [{ role: 'user', content: formData.prompt }]
            });

            let currentDesc = '';
            for await (const chunk of stream) {
                if (chunk.type === 'content' && chunk.content) {
                    currentDesc += chunk.content;
                    setFormData(prev => ({ ...prev, description: currentDesc }));
                }
            }
        } catch (e: any) {
            console.error(e);
            message.error('生成失败: ' + e.message);
        } finally {
            setIsGenerating(false);
        }
    };

    const visiblePrompts = useMemo(() => {
        if (filterCategory === 'all') return mergedPrompts;
        return mergedPrompts.filter(p => p.category === filterCategory);
    }, [mergedPrompts, filterCategory]);

    // Check if the current item is built-in
    const isBuiltInPrompt = !!(activeTab === 'prompt' && selectedItemId && selectedItemId !== 'new' && !selectedItemId.startsWith('custom_'));

    return (
        <div className="fixed inset-0 z-[100] flex justify-center items-center bg-slate-900/40 backdrop-blur-sm" onClick={onClose}>
            <div 
                className="bg-white rounded-2xl shadow-2xl w-[90vw] max-w-[1000px] h-[85vh] flex overflow-hidden border border-slate-200"
                onClick={e => e.stopPropagation()}
            >
                {/* Left Sidebar - Navigation */}
                <div className="w-[180px] bg-slate-50 border-r border-slate-200 flex flex-col pt-4">
                    <div className="px-4 pb-4 border-b border-slate-200/60 shrink-0">
                        <h2 className="text-sm font-bold text-slate-800">模板与技能管理</h2>
                        <p className="text-[10px] text-slate-500 mt-1">配置 AI 内容生产环境</p>
                    </div>
                    
                    <div className="flex-1 overflow-y-auto py-3 px-2 space-y-1">
                        <button
                            onClick={() => setActiveTab('prompt')}
                            className={`w-full flex items-center gap-2 px-3 py-2 text-xs font-medium rounded-lg transition-colors ${
                                activeTab === 'prompt' ? 'bg-violet-100 text-violet-800' : 'text-slate-600 hover:bg-slate-100'
                            }`}
                        >
                            <BookOpen size={14} className={activeTab === 'prompt' ? 'text-violet-600' : 'text-slate-400'} />
                            Prompt 模板
                        </button>
                        <button
                            onClick={() => setActiveTab('skill')}
                            className={`w-full flex items-center gap-2 px-3 py-2 text-xs font-medium rounded-lg transition-colors ${
                                activeTab === 'skill' ? 'bg-rose-100 text-rose-800' : 'text-slate-600 hover:bg-slate-100'
                            }`}
                        >
                            <Layers size={14} className={activeTab === 'skill' ? 'text-rose-600' : 'text-slate-400'} />
                            Skill 方法论
                        </button>
                    </div>
                    
                    <div className="p-3 border-t border-slate-200 shrink-0">
                        <button
                            onClick={onClose}
                            className="w-full flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-600 border border-slate-300 rounded-lg hover:bg-slate-50 transition-colors"
                        >
                            <X size={14} />
                            关闭
                        </button>
                    </div>
                </div>

                {/* Middle List - Items */}
                <div className="w-[260px] border-r border-slate-200 flex flex-col bg-white">
                    <div className="px-3 py-2.5 border-b border-slate-100 flex items-center justify-between shrink-0">
                        <span className="text-xs font-semibold text-slate-700">
                            {activeTab === 'prompt' ? '所有 Prompt' : '所有方法论'}
                        </span>
                        <div className="flex gap-0.5">
                            <button
                                onClick={() => fileInputRef.current?.click()}
                                className="p-1 rounded hover:bg-slate-100 text-slate-400 transition-colors"
                                title="导入文件 (.md, .txt, .skill)"
                            >
                                <Upload size={14} />
                            </button>
                            <button
                                onClick={handleNew}
                                className="p-1 rounded hover:bg-slate-100 text-slate-400 transition-colors"
                                title="新建"
                            >
                                <Plus size={14} />
                            </button>
                        </div>
                    </div>
                    
                    {/* Hidden input for file picking */}
                    <input 
                        type="file" 
                        ref={fileInputRef} 
                        className="hidden" 
                        accept=".txt,.md,.json,.skill" 
                        onChange={handleImportFile}
                    />
                    
                    {activeTab === 'prompt' && (
                        <div className="px-2 py-2 border-b border-slate-100 shrink-0 bg-slate-50/50">
                            <select 
                                value={filterCategory}
                                onChange={(e) => setFilterCategory(e.target.value)}
                                className="w-full text-xs border-slate-200 rounded px-2 py-1 bg-white focus:outline-none focus:border-violet-300"
                            >
                                {promptCategories.map(c => (
                                    <option key={c.key} value={c.key}>{c.label}</option>
                                ))}
                            </select>
                        </div>
                    )}

                    <div className="flex-1 overflow-y-auto p-2 space-y-0.5 custom-scrollbar">
                        {activeTab === 'prompt' ? (
                            visiblePrompts.map(p => (
                                <div
                                    key={p.id}
                                    onClick={() => setSelectedItemId(p.id)}
                                    className={`px-3 py-2 text-left rounded-lg cursor-pointer transition-colors flex flex-col ${
                                        selectedItemId === p.id ? 'bg-violet-50 border border-violet-200/60 shadow-sm' : 'hover:bg-slate-50 border border-transparent'
                                    }`}
                                >
                                    <span className={`text-xs font-medium truncate ${selectedItemId === p.id ? 'text-violet-800' : 'text-slate-700'}`}>{p.name}</span>
                                    <span className="text-[10px] text-slate-400 truncate mt-0.5">{p.description}</span>
                                </div>
                            ))
                        ) : (
                            skills.map(s => (
                                <div
                                    key={s.id}
                                    onClick={() => setSelectedItemId(s.id)}
                                    className={`px-3 py-2 text-left rounded-lg cursor-pointer transition-colors flex flex-col ${
                                        selectedItemId === s.id ? 'bg-rose-50 border border-rose-200/60 shadow-sm' : 'hover:bg-slate-50 border border-transparent'
                                    }`}
                                >
                                    <span className={`text-xs font-medium truncate ${selectedItemId === s.id ? 'text-rose-800' : 'text-slate-700'}`}>{s.name}</span>
                                    <span className="text-[10px] text-slate-400 truncate mt-0.5">{s.description || '无简介'}</span>
                                </div>
                            ))
                        )}
                        
                        {(activeTab === 'prompt' ? visiblePrompts.length : skills.length) === 0 && (
                            <div className="pt-8 text-center text-slate-400 text-xs">
                                尚无数据
                            </div>
                        )}
                    </div>
                </div>

                {/* Right Panel - Detail Editor */}
                <div className="flex-1 flex flex-col bg-slate-50/50 min-w-0">
                    <div className="px-5 py-3 border-b border-slate-200 bg-white shadow-sm z-10 flex items-center justify-between shrink-0">
                        <div className="flex items-center gap-2">
                            <span className="text-sm font-semibold text-slate-800">
                                {selectedItemId === 'new' ? '新建' : '编辑'} {activeTab === 'prompt' ? 'Prompt' : 'Skill'}
                            </span>
                            {isBuiltInPrompt && (
                                <span className="flex items-center gap-1 px-2 py-0.5 text-[10px] font-medium text-amber-700 bg-amber-100 rounded border border-amber-200">
                                    <AlertCircle size={10} /> 系统内置 (不可改)
                                </span>
                            )}
                        </div>
                        <div className="flex gap-2">
                            {selectedItemId !== 'new' && !isBuiltInPrompt && (
                                <button
                                    onClick={handleDelete}
                                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-red-600 bg-red-50 hover:bg-red-100 border border-red-200 rounded-lg transition-colors"
                                >
                                    <Trash2 size={12} />
                                    删除
                                </button>
                            )}
                            <button
                                onClick={handleSave}
                                disabled={isBuiltInPrompt}
                                className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white rounded-lg transition-colors ${
                                    isBuiltInPrompt 
                                        ? 'bg-slate-300 cursor-not-allowed' 
                                        : 'bg-violet-600 hover:bg-violet-700 shadow-sm'
                                }`}
                            >
                                <Save size={12} />
                                保存
                            </button>
                        </div>
                    </div>
                    
                    <div className="flex-1 overflow-y-auto p-5 custom-scrollbar">
                        <div className="max-w-[600px] space-y-4">
                            <div>
                                <label className="block text-xs font-medium text-slate-700 mb-1">
                                    名称
                                </label>
                                <input
                                    type="text"
                                    value={formData.name}
                                    onChange={e => setFormData(prev => ({ ...prev, name: e.target.value }))}
                                    disabled={isBuiltInPrompt}
                                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-violet-500/20 focus:border-violet-500 bg-white disabled:bg-slate-50 disabled:text-slate-500"
                                    placeholder="例如：财报深度分析"
                                />
                            </div>

                            {activeTab === 'prompt' && (
                                <div>
                                    <label className="block text-xs font-medium text-slate-700 mb-1">分类</label>
                                    <select
                                        value={formData.category}
                                        onChange={e => setFormData(prev => ({ ...prev, category: e.target.value as any }))}
                                        disabled={isBuiltInPrompt}
                                        className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-violet-500/20 focus:border-violet-500 bg-white disabled:bg-slate-50 disabled:text-slate-500"
                                    >
                                        {promptCategories.filter(c => c.key !== 'all').map(c => (
                                            <option key={c.key} value={c.key}>{c.label}</option>
                                        ))}
                                    </select>
                                </div>
                            )}

                            <div>
                                <div className="flex items-center justify-between mb-1">
                                    <label className="block text-xs font-medium text-slate-700">
                                        简介 / 功能描述
                                    </label>
                                    <button
                                        onClick={handleGenerateDescription}
                                        disabled={isBuiltInPrompt || isGenerating || !formData.prompt.trim()}
                                        className="flex items-center gap-1 px-2 py-1 text-[10px] font-medium text-amber-700 bg-amber-50 hover:bg-amber-100 border border-amber-200 rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                                    >
                                        <Sparkles size={10} className={isGenerating ? "animate-pulse" : ""} />
                                        {isGenerating ? '生成中...' : 'AI 自动生成'}
                                    </button>
                                </div>
                                <input
                                    type="text"
                                    value={formData.description}
                                    onChange={e => setFormData(prev => ({ ...prev, description: e.target.value }))}
                                    disabled={isBuiltInPrompt || isGenerating}
                                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-violet-500/20 focus:border-violet-500 bg-white disabled:bg-slate-50 disabled:text-slate-500"
                                    placeholder="一段简短的功能描述"
                                />
                            </div>

                            <div className="flex-1 min-h-[300px] flex flex-col">
                                <label className="block text-xs font-medium text-slate-700 mb-1 flex items-center justify-between">
                                    <span>正文内容</span>
                                    {activeTab === 'prompt' && (
                                        <span className="text-[10px] text-slate-400 font-normal">支持 {'{context}'} 作为占位符</span>
                                    )}
                                </label>
                                <textarea
                                    value={formData.prompt}
                                    onChange={e => setFormData(prev => ({ ...prev, prompt: e.target.value }))}
                                    disabled={isBuiltInPrompt}
                                    className="w-full flex-1 min-h-[300px] px-3 py-2 text-sm font-mono border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-violet-500/20 focus:border-violet-500 bg-white resize-y disabled:bg-slate-50 disabled:text-slate-500"
                                    placeholder={activeTab === 'prompt' ? "在这里输入系统的 Prompt..." : "在这里输入 Markdown 格式的方法论..."}
                                />
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}

export default TemplateManagementModal;
