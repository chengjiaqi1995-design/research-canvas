import { memo, useEffect, useState, useCallback } from 'react';
import {
    Plus, Sparkles, Trash2, Play, Square, RefreshCw,
    Pencil, Eye, ChevronDown, ChevronRight, Globe, FileText, Layers,
} from 'lucide-react';
import { useAICardStore } from '../../stores/aiCardStore.ts';
import type { AICard } from '../../stores/aiCardStore.ts';
import { SourceNodePicker } from '../detail/SourceNodePicker.tsx';
import { PromptTemplateSelector } from '../detail/PromptTemplateSelector.tsx';
import { SourceFolderPicker } from './SourceFolderPicker.tsx';
import { SkillSelector } from './SkillSelector.tsx';
import { PROMPT_TEMPLATES } from '../../constants/promptTemplates.ts';
import type { AICardSourceMode, PromptTemplate } from '../../types/index.ts';
import TemplateManagementModal from './TemplateManagementModal.tsx';

/** Left panel: card list */
const CardList = memo(function CardList() {
    const cards = useAICardStore((s) => s.cards);
    const selectedCardId = useAICardStore((s) => s.selectedCardId);
    const addCard = useAICardStore((s) => s.addCard);
    const removeCard = useAICardStore((s) => s.removeCard);
    const selectCard = useAICardStore((s) => s.selectCard);

    return (
        <div className="flex flex-col h-full border-r border-slate-200 bg-slate-50" style={{ width: 260 }}>
            {/* Header */}
            <div className="flex items-center justify-between px-3 py-2 border-b border-slate-200 bg-white shrink-0">
                <span className="text-xs font-semibold text-slate-700">AI 卡片</span>
                <button
                    onClick={() => addCard()}
                    className="flex items-center gap-1 px-2 py-1 text-xs text-rose-900 hover:bg-rose-50 rounded transition-colors"
                >
                    <Plus size={12} />
                    新建
                </button>
            </div>

            {/* Card list */}
            <div className="flex-1 overflow-y-auto py-1">
                {cards.length === 0 && (
                    <div className="px-3 py-8 mt-12 text-center flex flex-col items-center">
                        <Sparkles size={24} className="mx-auto mb-2 text-amber-400" />
                        <p className="text-[11px] text-slate-500 mb-6">暂无分析卡片。先在画布选定节点内容，然后点击...</p>
                        
                        <button
                            onClick={() => {
                                const tpl = PROMPT_TEMPLATES.find(p => p.id === 'weekly_report');
                                addCard({ title: '新建AI周报', prompt: tpl?.prompt || '' });
                            }}
                            className="flex flex-col items-center justify-center w-[90%] border border-rose-200 bg-rose-50 hover:bg-rose-100 text-rose-900 py-3.5 rounded-xl transition-all shadow-sm shadow-rose-900/5 hover:shadow"
                        >
                            <span className="text-[13px] font-semibold flex items-center gap-1.5 mb-0.5">
                                ⚡ 一键生成【投资周报】
                            </span>
                            <span className="text-[10px] text-amber-600 font-medium">
                                (自动载入专业金融周报 AI 框架)
                            </span>
                        </button>

                        <div className="mt-6 flex items-center justify-center gap-2">
                           <div className="h-px w-8 bg-slate-200"></div>
                           <span className="text-[10px] text-slate-400">或者可以</span>
                           <div className="h-px w-8 bg-slate-200"></div>
                        </div>

                        <button 
                            onClick={() => addCard()}
                            className="text-[11px] text-slate-500 hover:text-slate-700 underline underline-offset-2 mt-2"
                        >
                            创建空白 AI 对话
                        </button>
                    </div>
                )}
                {cards.map((card) => (
                    <div
                        key={card.id}
                        onClick={() => selectCard(card.id)}
                        className={`flex items-center gap-2 px-3 py-2 mx-1 rounded-lg cursor-pointer group transition-colors ${
                            selectedCardId === card.id
                                ? 'bg-rose-100 text-rose-900'
                                : 'text-slate-600 hover:bg-slate-100'
                        }`}
                    >
                        <Sparkles size={12} className={selectedCardId === card.id ? 'text-amber-600' : 'text-slate-400'} />
                        <div className="flex-1 min-w-0">
                            <div className="text-xs font-medium truncate">{card.title}</div>
                            <div className="text-[10px] text-slate-400 truncate">
                                {card.config.model.split('-').slice(0, 2).join('-')}
                                {card.generatedContent ? ' · 已生成' : ''}
                            </div>
                        </div>
                        {card.isStreaming && (
                            <div className="w-1.5 h-1.5 bg-rose-500 rounded-full animate-pulse shrink-0" />
                        )}
                        <button
                            onClick={(e) => {
                                e.stopPropagation();
                                if (confirm('删除此 AI 卡片？')) removeCard(card.id);
                            }}
                            className="opacity-0 group-hover:opacity-100 text-slate-300 hover:text-red-400 shrink-0 p-0.5"
                        >
                            <Trash2 size={11} />
                        </button>
                    </div>
                ))}
            </div>

            {/* Footer */}
            <div className="px-3 py-1.5 border-t border-slate-200 text-[10px] text-slate-400 shrink-0">
                {cards.length} 个卡片
            </div>
        </div>
    );
});

/** Right panel: card editor */
const CardEditor = memo(function CardEditor({ card, onOpenManager }: { card: AICard; onOpenManager: (tab: 'prompt' | 'skill') => void }) {
    const updateCard = useAICardStore((s) => s.updateCard);
    const sendMessage = useAICardStore((s) => s.sendMessage);
    const stopStreaming = useAICardStore((s) => s.stopStreaming);
    const models = useAICardStore((s) => s.models);
    const customTemplates = useAICardStore((s) => s.customTemplates);
    const skills = useAICardStore((s) => s.skills);

    const [title, setTitle] = useState(card.title);
    const [prompt, setPrompt] = useState(card.prompt);
    const [model, setModel] = useState(card.config.model);
    const [sourceMode, setSourceMode] = useState<AICardSourceMode>(card.config.sourceMode);
    const [sourceNodeIds, setSourceNodeIds] = useState<string[]>(card.config.sourceNodeIds);
    const [sourceWorkspaceIds, setSourceWorkspaceIds] = useState<string[]>(card.config.sourceWorkspaceIds || []);
    const [sourceCanvasIds, setSourceCanvasIds] = useState<string[]>(card.config.sourceCanvasIds || []);
    const [sourceDateFrom, setSourceDateFrom] = useState(card.config.sourceDateFrom || '');
    const [sourceDateTo, setSourceDateTo] = useState(card.config.sourceDateTo || '');
    const [sourceDateField, setSourceDateField] = useState<'occurred' | 'created'>(card.config.sourceDateField || 'occurred');
    const [configOpen, setConfigOpen] = useState(!card.generatedContent);
    const [editMode, setEditMode] = useState(false);
    const [editContent, setEditContent] = useState(card.editedContent);

    // Reset local state when card changes
    useEffect(() => {
        setTitle(card.title);
        setPrompt(card.prompt);
        setModel(card.config.model);
        setSourceMode(card.config.sourceMode);
        setSourceNodeIds(card.config.sourceNodeIds);
        setSourceWorkspaceIds(card.config.sourceWorkspaceIds || []);
        setSourceCanvasIds(card.config.sourceCanvasIds || []);
        setSourceDateFrom(card.config.sourceDateFrom || '');
        setSourceDateTo(card.config.sourceDateTo || '');
        setSourceDateField(card.config.sourceDateField || 'occurred');
        setConfigOpen(!card.generatedContent);
        setEditMode(false);
        setEditContent(card.editedContent);
    }, [card.id]);

    // Sync streaming content
    useEffect(() => {
        if (card.isStreaming) {
            setEditContent(card.editedContent);
        }
    }, [card.editedContent, card.isStreaming]);

    const handleSaveTitle = useCallback(() => {
        if (title.trim() && title !== card.title) {
            updateCard(card.id, { title: title.trim() });
        }
    }, [title, card.title, card.id, updateCard]);

    const saveConfig = useCallback(() => {
        updateCard(card.id, {
            prompt,
            config: {
                ...card.config,
                model,
                sourceMode,
                sourceNodeIds,
                sourceWorkspaceIds: sourceWorkspaceIds.length > 0 ? sourceWorkspaceIds : undefined,
                sourceCanvasIds: sourceCanvasIds.length > 0 ? sourceCanvasIds : undefined,
                sourceDateFrom: sourceDateFrom || undefined,
                sourceDateTo: sourceDateTo || undefined,
                sourceDateField,
            },
        });
    }, [card.id, prompt, model, sourceMode, sourceNodeIds, sourceWorkspaceIds, sourceCanvasIds, sourceDateFrom, sourceDateTo, sourceDateField, card.config, updateCard]);

    const handleGenerate = useCallback(() => {
        saveConfig();
        setTimeout(() => sendMessage(card.id), 50);
    }, [saveConfig, sendMessage, card.id]);

    const handleStop = useCallback(() => {
        stopStreaming(card.id);
    }, [stopStreaming, card.id]);

    const handleTemplateSelect = useCallback((tpl: PromptTemplate) => {
        setPrompt(tpl.prompt);
        if (!title || title === 'AI 卡片') setTitle(tpl.name);
    }, [title]);

    const handleSaveEdit = useCallback(() => {
        updateCard(card.id, { editedContent: editContent });
        setEditMode(false);
    }, [card.id, editContent, updateCard]);

    const sourceModeOptions: { value: AICardSourceMode; label: string; icon: typeof FileText }[] = [
        { value: 'notes', label: '仅笔记', icon: FileText },
        { value: 'web', label: '仅联网', icon: Globe },
        { value: 'notes_web', label: '笔记+联网', icon: Layers },
    ];

    const hasContent = !!(card.generatedContent || card.editedContent);

    return (
        <div className="flex flex-col h-full">
            {/* Title */}
            <div className="px-4 pt-3 pb-2 shrink-0 border-b border-slate-200 bg-white">
                <input
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    onBlur={handleSaveTitle}
                    onKeyDown={(e) => e.key === 'Enter' && handleSaveTitle()}
                    className="w-full text-lg font-semibold text-slate-800 border-none outline-none bg-transparent hover:text-rose-900 transition-colors"
                    placeholder="卡片标题..."
                />
            </div>

            {/* Config section */}
            <div className="px-4 shrink-0">
                <button
                    onClick={() => setConfigOpen(!configOpen)}
                    className="flex items-center gap-1 text-xs text-slate-500 hover:text-rose-900 transition-colors my-2"
                >
                    {configOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                    <Sparkles size={11} />
                    配置
                </button>

                {configOpen && (
                    <div className="flex flex-col space-y-4 pb-4 border-b border-slate-200">
                        {/* 顶栏：全局性配置（内容来源 & 模型） */}
                        <div className="flex items-center justify-between bg-slate-50/70 p-2.5 rounded-lg border border-slate-200/60 shadow-sm">
                            {/* Source mode */}
                            <div className="flex items-center gap-3">
                                <label className="text-xs font-semibold text-slate-700 shrink-0 select-none hidden sm:block">AI 工作模式</label>
                                <div className="flex gap-1 bg-slate-200/50 p-1 rounded-md">
                                    {sourceModeOptions.map((opt) => {
                                        const Icon = opt.icon;
                                        return (
                                            <button
                                                key={opt.value}
                                                onClick={() => setSourceMode(opt.value)}
                                                className={`flex items-center gap-1.5 px-3 py-1.5 text-xs rounded font-medium transition-all duration-200 ${
                                                    sourceMode === opt.value
                                                        ? 'bg-white text-rose-900 shadow-sm ring-1 ring-black/5'
                                                        : 'text-slate-500 hover:text-slate-700 hover:bg-slate-200/50'
                                                }`}
                                            >
                                                <Icon size={12} className={sourceMode === opt.value ? "text-amber-600" : "text-slate-400"} />
                                                {opt.label}
                                            </button>
                                        );
                                    })}
                                </div>
                            </div>

                            {/* Model selector */}
                            <div className="flex items-center gap-2">
                                <label className="text-xs font-semibold text-slate-700 shrink-0 select-none">执行引擎</label>
                                <select
                                    value={model}
                                    onChange={(e) => setModel(e.target.value)}
                                    className="w-[180px] text-xs font-medium text-slate-600 border border-slate-200 rounded-md px-2.5 py-1.5 bg-white shadow-sm focus:outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500 transition-shadow cursor-pointer"
                                >
                                    {models.length > 0 ? models.map((m) => (
                                        <option key={m.id} value={m.id}>{m.name}</option>
                                    )) : (
                                        <option value={model}>{model}</option>
                                    )}
                                </select>
                            </div>
                        </div>

                        {sourceMode !== 'notes' && !model.startsWith('gemini') && (
                            <div className="text-[11px] text-rose-900 font-semibold -mt-2 px-1 flex items-center gap-1">
                                <Globe size={10} /> 联网搜索目前仅支持 Gemini 模型，请从右上角切换模型。
                            </div>
                        )}

                        {/* 下区：左右双列等高布局 */}
                        <div className="flex gap-4 items-stretch h-[460px] mb-4">
                            {/* 左列：数据源配置卡片 */}
                            <div className="w-[320px] shrink-0 flex flex-col border border-slate-200 rounded-xl overflow-hidden shadow-sm bg-white">
                                <div className="bg-slate-50/80 px-3.5 py-2.5 border-b border-slate-200">
                                    <h3 className="text-xs font-semibold text-slate-700 m-0 flex items-center gap-1.5 select-none">
                                        <Layers size={13} className="text-amber-600" />
                                        投喂数据源配置
                                    </h3>
                                </div>
                                <div className="flex-1 flex flex-col p-3.5 bg-white space-y-4 min-h-0">
                                    {sourceMode !== 'web' && (
                                        <div className="flex-1 flex flex-col min-h-0">
                                            <div className="flex-1 flex flex-col min-h-0">
                                                <SourceFolderPicker
                                                    selectedWorkspaceIds={sourceWorkspaceIds}
                                                    selectedCanvasIds={sourceCanvasIds}
                                                    dateFrom={sourceDateFrom}
                                                    dateTo={sourceDateTo}
                                                    dateField={sourceDateField}
                                                    onChangeWorkspaces={setSourceWorkspaceIds}
                                                    onChangeCanvases={setSourceCanvasIds}
                                                    onChangeDateFrom={setSourceDateFrom}
                                                    onChangeDateTo={setSourceDateTo}
                                                    onChangeDateField={setSourceDateField}
                                                />
                                            </div>
                                        </div>
                                    )}

                                    {/* Source node picker (current canvas nodes) */}
                                    {sourceMode !== 'web' && sourceWorkspaceIds.length === 0 && sourceCanvasIds.length === 0 && !sourceDateFrom && !sourceDateTo && (
                                        <div className="shrink-0 pt-2 border-t border-slate-100 flex flex-col">
                                            <SourceNodePicker
                                                selectedIds={sourceNodeIds}
                                                onChange={setSourceNodeIds}
                                            />
                                        </div>
                                    )}
                                </div>
                            </div>

                            {/* 右列：Prompt 策略与执行卡片 */}
                            <div className="flex-1 flex flex-col min-w-[280px] border border-slate-200 rounded-xl overflow-hidden shadow-sm bg-white">
                                <div className="bg-slate-50/80 px-3.5 py-2 border-b border-slate-200 flex items-center justify-between shrink-0">
                                    <h3 className="text-xs font-semibold text-slate-700 m-0 flex items-center gap-1.5 select-none">
                                        <Sparkles size={13} className="text-amber-600" />
                                        主推理策略与配置
                                    </h3>
                                    <button 
                                        onClick={() => onOpenManager('prompt')} 
                                        className="text-[10px] font-medium text-slate-400 hover:text-violet-600 underline underline-offset-2 transition-colors"
                                    >
                                        管理模板与技能包
                                    </button>
                                </div>
                                <div className="flex-1 flex flex-col overflow-hidden bg-slate-50/30">
                                    <div className="flex-1 flex overflow-hidden">
                                        {/* 输入区域 (左侧) */}
                                        <div className="flex-1 flex flex-col border-r border-slate-200 bg-white">
                                            <textarea
                                                value={prompt}
                                                onChange={(e) => setPrompt(e.target.value)}
                                                onKeyDown={(e) => {
                                                    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                                                        e.preventDefault();
                                                        handleGenerate();
                                                    }
                                                }}
                                                placeholder="输入您的指令... (支持 Ctrl+Enter 快速执行)"
                                                className="flex-1 w-full text-[13px] leading-relaxed text-slate-700 border-0 resize-none focus:ring-0 focus:outline-none placeholder-slate-300 custom-scrollbar p-4"
                                                style={{ boxShadow: 'none' }}
                                            />
                                        </div>

                                        {/* 勾选列表区域 (右侧两列) */}
                                        <div className="w-[360px] shrink-0 flex divide-x divide-slate-200 bg-slate-50/50">
                                            {/* Prompt 模板列 */}
                                            <div className="flex-1 flex flex-col min-w-0">
                                                <div className="px-3 py-2 bg-slate-100 border-b border-slate-200 text-[10px] font-semibold text-slate-500 uppercase tracking-wider shrink-0 flex items-center justify-between">
                                                    Prompt 模板
                                                </div>
                                                <div className="flex-1 overflow-y-auto p-1.5 custom-scrollbar">
                                                    {PROMPT_TEMPLATES.map(p => (
                                                        <label key={p.id} onClick={() => handleTemplateSelect(p)} className="flex items-start gap-2 px-2 py-2 hover:bg-violet-50 cursor-pointer rounded mb-0.5 group">
                                                            <div className="flex-shrink-0 pt-0.5">
                                                                <input type="radio" checked={prompt === p.prompt} readOnly className="w-3 h-3 text-violet-600 border-slate-300 focus:ring-violet-500" />
                                                            </div>
                                                            <div className="text-[11px] text-slate-700 leading-relaxed group-hover:text-violet-700 flex-1 min-w-0 break-words">{p.name}</div>
                                                        </label>
                                                    ))}
                                                    {customTemplates.map(p => (
                                                        <label key={p.id} onClick={() => handleTemplateSelect(p as any)} className="flex items-start gap-2 px-2 py-2 hover:bg-violet-50 cursor-pointer rounded mb-0.5 group bg-white shadow-sm border border-slate-100">
                                                            <div className="flex-shrink-0 pt-0.5">
                                                                <input type="radio" checked={prompt === p.prompt} readOnly className="w-3 h-3 text-violet-600 border-slate-300 focus:ring-violet-500" />
                                                            </div>
                                                            <div className="text-[11px] text-slate-700 leading-relaxed group-hover:text-violet-700 flex-1 min-w-0 break-words font-medium">
                                                                {p.name} <span className="text-slate-400 text-[9px] font-normal inline-block align-middle bg-slate-100 px-1 rounded ml-0.5">自写</span>
                                                            </div>
                                                        </label>
                                                    ))}
                                                </div>
                                            </div>

                                            {/* Skill 挂载列 */}
                                            <div className="flex-1 flex flex-col min-w-0">
                                                <div className="px-3 py-2 bg-slate-100 border-b border-slate-200 text-[10px] font-semibold text-slate-500 uppercase tracking-wider shrink-0 flex items-center justify-between">
                                                    Skill 方法论
                                                </div>
                                                <div className="flex-1 overflow-y-auto p-1.5 custom-scrollbar">
                                                    <label className="flex items-start gap-2 px-2 py-2 hover:bg-rose-50 cursor-pointer rounded mb-0.5 group bg-white shadow-sm border border-slate-100">
                                                        <div className="flex-shrink-0 pt-0.5">
                                                            <input type="radio" checked={!card.config.skillId} onChange={() => updateCard(card.id, { config: { ...card.config, skillId: undefined } })} className="w-3 h-3 text-rose-500 border-slate-300 focus:ring-rose-500" />
                                                        </div>
                                                        <div className="text-[11px] text-slate-800 leading-relaxed group-hover:text-rose-700 flex-1 min-w-0 break-words font-semibold">无 (纯净模式)</div>
                                                    </label>
                                                    {skills.map(s => (
                                                        <label key={s.id} className="flex items-start gap-2 px-2 py-2 hover:bg-rose-50 cursor-pointer rounded mb-0.5 group">
                                                            <div className="flex-shrink-0 pt-0.5">
                                                                <input type="radio" checked={card.config.skillId === s.id} onChange={() => updateCard(card.id, { config: { ...card.config, skillId: s.id } })} className="w-3 h-3 text-rose-500 border-slate-300 focus:ring-rose-500" />
                                                            </div>
                                                            <div className="text-[11px] text-slate-700 leading-relaxed group-hover:text-rose-700 flex-1 min-w-0 break-words">{s.name}</div>
                                                        </label>
                                                    ))}
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                </div>

                                {/* Action Buttons */}
                                <div className="p-3.5 border-t border-slate-200 flex items-center justify-end gap-2 shrink-0 bg-white z-10 w-full">
                                        {card.isStreaming ? (
                                            <button
                                                onClick={handleStop}
                                                className="flex items-center justify-center gap-1.5 px-4 py-2 text-xs font-semibold bg-red-50 text-red-600 border border-red-200 rounded-lg hover:bg-red-500 hover:text-white transition-all duration-200"
                                            >
                                                <Square size={12} />
                                                中止推理
                                            </button>
                                        ) : (
                                            <button
                                                onClick={handleGenerate}
                                                disabled={!prompt.trim()}
                                                className="flex items-center justify-center gap-1.5 px-5 py-2 text-xs font-semibold bg-rose-900 text-amber-50 rounded-lg hover:bg-rose-800 hover:shadow-md hover:shadow-rose-900/20 transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:shadow-none"
                                            >
                                                <Play size={12} />
                                                开始推理
                                            </button>
                                        )}
                                        {hasContent && !card.isStreaming && (
                                            <button
                                                onClick={handleGenerate}
                                                className="flex items-center justify-center gap-1.5 px-4 py-2 text-xs font-semibold text-slate-600 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 hover:text-rose-900 hover:border-rose-200 transition-all duration-200"
                                            >
                                                <RefreshCw size={12} />
                                                重新生成
                                            </button>
                                        )}
                                    </div>
                                </div>
                            </div>
                        </div>
                )}
            </div>

            {/* Output area */}
            <div className="flex-1 overflow-y-auto px-4 py-3">
                {card.error && (
                    <div className="mb-3 px-3 py-2 bg-red-50 border border-red-200 rounded text-xs text-red-600">
                        {card.error}
                    </div>
                )}

                {card.isStreaming && (
                    <div className="flex items-center gap-2 mb-3 text-xs text-amber-600">
                        <div className="w-2 h-2 bg-rose-500 rounded-full animate-pulse" />
                        正在生成...
                    </div>
                )}

                {hasContent && (
                    <div>
                        <div className="flex items-center justify-end mb-2">
                            <button
                                onClick={() => {
                                    if (editMode) {
                                        handleSaveEdit();
                                    } else {
                                        setEditContent(card.editedContent || card.generatedContent);
                                        setEditMode(true);
                                    }
                                }}
                                className="flex items-center gap-1 text-[10px] text-slate-400 hover:text-amber-600 transition-colors"
                            >
                                {editMode ? <><Eye size={10} /> 预览</> : <><Pencil size={10} /> 编辑</>}
                            </button>
                        </div>

                        {editMode ? (
                            <textarea
                                value={editContent}
                                onChange={(e) => setEditContent(e.target.value)}
                                className="w-full h-[calc(100%-32px)] text-xs border border-slate-200 rounded px-3 py-2 resize-none focus:outline-none focus:border-amber-500 font-mono bg-white"
                            />
                        ) : (
                            <div
                                className="prose prose-sm max-w-none text-slate-700 text-xs leading-relaxed"
                                dangerouslySetInnerHTML={{
                                    __html: (card.editedContent || card.generatedContent)
                                        .replace(/\n/g, '<br>')
                                        .replace(/^### (.+)$/gm, '<h3>$1</h3>')
                                        .replace(/^## (.+)$/gm, '<h2>$1</h2>')
                                        .replace(/^# (.+)$/gm, '<h1>$1</h1>')
                                        .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
                                        .replace(/\*(.+?)\*/g, '<em>$1</em>')
                                }}
                            />
                        )}
                    </div>
                )}

                {!hasContent && !card.isStreaming && !card.error && (
                    <div className="flex flex-col items-center justify-center h-full text-slate-400">
                        <Sparkles size={32} className="mb-3 text-amber-400" />
                        <p className="text-sm">配置 Prompt 后点击生成</p>
                        <p className="text-xs mt-1">Ctrl+Enter 快速生成</p>
                    </div>
                )}
            </div>

            {/* Footer */}
            {card.lastGeneratedAt && (
                <div className="px-4 py-1.5 border-t border-slate-100 text-[10px] text-slate-400 shrink-0">
                    上次生成: {new Date(card.lastGeneratedAt).toLocaleString('zh-CN')}
                </div>
            )}
        </div>
    );
});

/** Main AI Cards View — replaces AIResearchView */
export const AICardsView = memo(function AICardsView() {
    const cards = useAICardStore((s) => s.cards);
    const selectedCardId = useAICardStore((s) => s.selectedCardId);
    const loadModels = useAICardStore((s) => s.loadModels);

    const [managerTab, setManagerTab] = useState<'prompt' | 'skill' | null>(null);

    useEffect(() => {
        loadModels();
    }, [loadModels]);

    const selectedCard = cards.find((c) => c.id === selectedCardId) ?? null;

    return (
        <div className="flex h-full bg-white relative">
            <CardList />
            <div className="flex-1 overflow-hidden">
                {selectedCard ? (
                    <CardEditor key={selectedCard.id} card={selectedCard} onOpenManager={setManagerTab} />
                ) : (
                    <div className="flex flex-col items-center justify-center h-full text-slate-400">
                        <Sparkles size={40} className="mb-3 text-amber-300" />
                        <p className="text-sm">选择或创建一个 AI 卡片</p>
                        <p className="text-xs mt-1 text-slate-300">这里是 AI Skill 的核心配置入口</p>
                    </div>
                )}
            </div>
            
            {managerTab && (
                <TemplateManagementModal 
                    initialTab={managerTab} 
                    onClose={() => setManagerTab(null)} 
                />
            )}
        </div>
    );
});
