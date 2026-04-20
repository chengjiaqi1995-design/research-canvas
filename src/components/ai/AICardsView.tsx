import { memo, useEffect, useState, useCallback } from 'react';
import {
    Plus, Sparkles, Trash2, Play, Square, RefreshCw,
    Pencil, Eye, ChevronDown, ChevronRight, Globe, FileText, Layers,
    Cloud, CloudOff, Loader2,
} from 'lucide-react';
import { useAICardStore } from '../../stores/aiCardStore.ts';
import type { AICard } from '../../stores/aiCardStore.ts';
import { ResponsiveLayout } from '../layout/ResponsiveLayout.tsx';
import { AICardLogViewer } from './AICardLogViewer.tsx';
import { Bug } from 'lucide-react';
import { SourceNodePicker } from '../detail/SourceNodePicker.tsx';
import { PromptTemplateSelector } from '../detail/PromptTemplateSelector.tsx';
import { SourceFolderPicker } from './SourceFolderPicker.tsx';
import { SkillSelector } from './SkillSelector.tsx';
import { PROMPT_TEMPLATES } from '../../constants/promptTemplates.ts';
import { FORMAT_TEMPLATES } from '../../constants/formatTemplates.ts';
import type { AICardSourceMode, PromptTemplate } from '../../types/index.ts';
import TemplateManagementModal from './TemplateManagementModal.tsx';

/** Cloud sync status indicator */
const SyncStatusBadge = memo(function SyncStatusBadge() {
    const status = useAICardStore((s) => s.cloudSyncStatus);
    if (status === 'idle') return null;
    if (status === 'syncing') return <span title="正在同步..."><Loader2 size={11} className="animate-spin text-blue-400" /></span>;
    if (status === 'synced') return <span title="已同步"><Cloud size={11} className="text-emerald-500" /></span>;
    if (status === 'error') return <span title="同步失败"><CloudOff size={11} className="text-red-500" /></span>;
    return null;
});

const CardList = memo(function CardList() {
    const cards = useAICardStore((s) => s.cards);
    const selectedCardId = useAICardStore((s) => s.selectedCardId);
    const addCard = useAICardStore((s) => s.addCard);
    const removeCard = useAICardStore((s) => s.removeCard);
    const selectCard = useAICardStore((s) => s.selectCard);

    return (
        <div className="flex flex-col h-full bg-slate-50 w-full">
            {/* Header */}
            <div className="flex items-center justify-between px-2 border-b border-slate-200 bg-white shrink-0" style={{ minHeight: 38 }}>
                <span className="text-xs font-semibold text-slate-700 flex items-center gap-1.5">
                    AI 卡片 <SyncStatusBadge />
                </span>
                <button
                    onClick={() => addCard()}
                    className="flex items-center gap-1 px-2 py-0.5 text-xs text-slate-500 hover:text-blue-600 hover:bg-blue-50 rounded transition-colors"
                    title="新建卡片"
                >
                    <Plus size={12} />
                    新建
                </button>
            </div>

            {/* Card list */}
            <div className="flex-1 overflow-y-auto px-1 py-1 space-y-0.5">
                {cards.length === 0 && (
                    <div className="px-3 py-8 mt-8 text-center flex flex-col items-center">
                        <Sparkles size={20} className="mx-auto mb-2 text-slate-300" />
                        <p className="text-[11px] text-slate-500 mb-4">暂无分析卡片</p>

                        <button
                            onClick={() => {
                                const tpl = PROMPT_TEMPLATES.find(p => p.id === 'weekly_report');
                                addCard({ title: '新建AI周报', prompt: tpl?.prompt || '' });
                            }}
                            className="w-full flex items-center justify-center gap-1 px-2 py-1.5 text-xs font-medium bg-blue-500 hover:bg-blue-600 text-white rounded transition-colors"
                        >
                            <Sparkles size={12} />
                            一键生成投资周报
                        </button>

                        <button
                            onClick={() => addCard()}
                            className="text-[11px] text-slate-500 hover:text-slate-700 mt-3"
                        >
                            或创建空白卡片
                        </button>
                    </div>
                )}
                {cards.map((card) => {
                    const isSelected = selectedCardId === card.id;
                    return (
                        <div
                            key={card.id}
                            onClick={() => selectCard(card.id)}
                            className={`flex items-center gap-1.5 px-2 py-1 rounded cursor-pointer group text-xs transition-colors ${
                                isSelected ? 'bg-blue-100 text-blue-800 font-medium' : 'text-slate-500 hover:bg-slate-100'
                            }`}
                        >
                            <Sparkles size={11} className={`shrink-0 ${isSelected ? 'text-blue-500' : 'text-slate-400'}`} />
                            <div className="flex-1 min-w-0">
                                <div className="truncate">{card.title}</div>
                                <div className="text-[10px] text-slate-400 truncate">
                                    {card.config.model.split('-').slice(0, 2).join('-')}
                                    {card.generatedContent ? ' · 已生成' : ''}
                                </div>
                            </div>
                            {card.isStreaming && (
                                <div className="w-1.5 h-1.5 bg-blue-500 rounded-full animate-pulse shrink-0" />
                            )}
                            <button
                                onClick={(e) => {
                                    e.stopPropagation();
                                    if (confirm('删除此 AI 卡片？')) removeCard(card.id);
                                }}
                                className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-red-100 text-slate-300 hover:text-red-500 shrink-0 transition-opacity"
                            >
                                <Trash2 size={11} />
                            </button>
                        </div>
                    );
                })}
            </div>

            {/* Footer */}
            <div className="px-2 py-1 border-t border-slate-200 text-[10px] text-slate-400 shrink-0 bg-white">
                {cards.length} 个卡片
            </div>
        </div>
    );
});

/** Right panel: card editor */
const CardEditor = memo(function CardEditor({ card, onOpenManager }: { card: AICard; onOpenManager: (tab: 'prompt' | 'skill' | 'format') => void }) {
    const updateCard = useAICardStore((s) => s.updateCard);
    const sendMessage = useAICardStore((s) => s.sendMessage);
    const stopStreaming = useAICardStore((s) => s.stopStreaming);
    const models = useAICardStore((s) => s.models);
    const customTemplates = useAICardStore((s) => s.customTemplates);
    const skills = useAICardStore((s) => s.skills);
    const customFormats = useAICardStore((s) => s.customFormats || []);

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

    // Selection row component, unified style for Prompt/Skill/Format columns
    const SelectionRow = ({ selected, label, badge, onClick }: { selected: boolean; label: string; badge?: string; onClick: () => void }) => (
        <div
            onClick={onClick}
            className={`flex items-center gap-1.5 px-2 py-1 rounded cursor-pointer text-xs transition-colors ${
                selected ? 'bg-blue-100 text-blue-800 font-medium' : 'text-slate-500 hover:bg-slate-100'
            }`}
        >
            <div className={`w-3 h-3 rounded-full border flex items-center justify-center shrink-0 ${
                selected ? 'border-blue-500 bg-white' : 'border-slate-300 bg-white'
            }`}>
                {selected && <div className="w-1.5 h-1.5 bg-blue-500 rounded-full" />}
            </div>
            <span className="flex-1 min-w-0 truncate">{label}</span>
            {badge && (
                <span className={`text-[9px] px-1 py-0.5 rounded shrink-0 ${
                    selected ? 'bg-blue-200/60 text-blue-700' : 'bg-slate-100 text-slate-400'
                }`}>{badge}</span>
            )}
        </div>
    );

    return (
        <div className="flex flex-col h-full">
            {/* Title */}
            <div className="flex items-center px-3 shrink-0 border-b border-slate-200 bg-white" style={{ minHeight: 38 }}>
                <input
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    onBlur={handleSaveTitle}
                    onKeyDown={(e) => e.key === 'Enter' && handleSaveTitle()}
                    className="w-full text-sm font-semibold text-slate-700 border-none outline-none bg-transparent"
                    placeholder="卡片标题..."
                />
            </div>

            {/* Config section */}
            <div className="px-3 shrink-0">
                <button
                    onClick={() => setConfigOpen(!configOpen)}
                    className="flex items-center gap-1 text-xs text-slate-500 hover:text-slate-700 transition-colors my-2"
                >
                    {configOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                    <Sparkles size={11} />
                    配置
                </button>

                {configOpen && (
                    <div className="flex flex-col space-y-3 pb-3 border-b border-slate-200">
                        {/* 顶栏：全局性配置（内容来源 & 模型） */}
                        <div className="flex items-center justify-between gap-3 bg-slate-50 p-2 rounded border border-slate-200">
                            {/* Source mode */}
                            <div className="flex items-center gap-2">
                                <label className="text-xs font-medium text-slate-600 shrink-0 select-none hidden sm:block">工作模式</label>
                                <div className="flex items-center bg-slate-100 p-0.5 rounded">
                                    {sourceModeOptions.map((opt) => {
                                        const Icon = opt.icon;
                                        const active = sourceMode === opt.value;
                                        return (
                                            <button
                                                key={opt.value}
                                                onClick={() => setSourceMode(opt.value)}
                                                className={`flex items-center gap-1 px-2 py-0.5 text-xs rounded font-medium transition-colors ${
                                                    active
                                                        ? 'bg-white text-blue-700 shadow-sm'
                                                        : 'text-slate-500 hover:text-slate-700'
                                                }`}
                                            >
                                                <Icon size={11} />
                                                {opt.label}
                                            </button>
                                        );
                                    })}
                                </div>
                            </div>

                            {/* Model selector */}
                            <div className="flex items-center gap-1.5">
                                <label className="text-xs font-medium text-slate-600 shrink-0 select-none">引擎</label>
                                <select
                                    value={model}
                                    onChange={(e) => setModel(e.target.value)}
                                    className="w-[160px] text-xs text-slate-600 border border-slate-200 rounded px-2 py-1 bg-white focus:outline-none focus:border-blue-400 cursor-pointer"
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
                            <div className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1 flex items-center gap-1">
                                <Globe size={11} /> 联网搜索目前仅支持 Gemini 模型，请切换引擎。
                            </div>
                        )}

                        {/* 下区：左右双列布局 */}
                        <div className="flex flex-wrap gap-3 items-stretch">
                            {/* 左列：数据源配置卡片 */}
                            <div className="flex-[4] min-w-[380px] shrink-0 flex flex-col border border-slate-200 rounded-md overflow-hidden bg-white h-[460px]">
                                <div className="bg-slate-50 px-2 border-b border-slate-200 flex items-center" style={{ minHeight: 30 }}>
                                    <h3 className="text-xs font-semibold text-slate-700 m-0 flex items-center gap-1.5 select-none">
                                        <Layers size={12} className="text-slate-400" />
                                        投喂数据源
                                    </h3>
                                </div>
                                <div className="flex-1 flex flex-col p-2 bg-white space-y-2 min-h-0">
                                    {sourceMode !== 'web' && (
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
                            <div className="flex-[6] min-w-[460px] flex flex-col border border-slate-200 rounded-md overflow-hidden bg-white h-[460px]">
                                <div className="bg-slate-50 px-2 border-b border-slate-200 flex items-center justify-between shrink-0" style={{ minHeight: 30 }}>
                                    <h3 className="text-xs font-semibold text-slate-700 m-0 flex items-center gap-1.5 select-none">
                                        <Sparkles size={12} className="text-slate-400" />
                                        推理策略
                                    </h3>
                                    <button
                                        onClick={() => onOpenManager('prompt')}
                                        className="text-[10px] text-slate-400 hover:text-blue-600 transition-colors"
                                    >
                                        管理模板与技能包
                                    </button>
                                </div>
                                <div className="flex-1 flex flex-col overflow-hidden">
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
                                                className="flex-1 w-full text-xs leading-relaxed text-slate-700 border-0 resize-none focus:ring-0 focus:outline-none placeholder-slate-300 custom-scrollbar p-2"
                                                style={{ boxShadow: 'none' }}
                                            />
                                        </div>

                                        {/* 勾选列表区域 (右侧三列) */}
                                        <div className="w-[420px] shrink-0 flex divide-x divide-slate-200 bg-slate-50 border-l border-slate-200">
                                            {/* Prompt 模板列 */}
                                            <div className="flex-1 flex flex-col min-w-0">
                                                <div className="px-2 py-1 bg-white border-b border-slate-200 text-[10px] font-semibold text-slate-400 tracking-wider uppercase shrink-0 flex items-center">
                                                    Prompt 模板
                                                </div>
                                                <div className="flex-1 overflow-y-auto p-1 space-y-0.5 custom-scrollbar">
                                                    {PROMPT_TEMPLATES.map(p => (
                                                        <SelectionRow
                                                            key={p.id}
                                                            selected={prompt === p.prompt}
                                                            label={p.name}
                                                            onClick={() => handleTemplateSelect(p)}
                                                        />
                                                    ))}
                                                    {customTemplates.map(p => (
                                                        <SelectionRow
                                                            key={p.id}
                                                            selected={prompt === p.prompt}
                                                            label={p.name}
                                                            badge="自写"
                                                            onClick={() => handleTemplateSelect(p as any)}
                                                        />
                                                    ))}
                                                </div>
                                            </div>

                                            {/* Skill 方法论列 */}
                                            <div className="flex-1 flex flex-col min-w-0">
                                                <div className="px-2 py-1 bg-white border-b border-slate-200 text-[10px] font-semibold text-slate-400 tracking-wider uppercase shrink-0 flex items-center">
                                                    Skill 方法论
                                                </div>
                                                <div className="flex-1 overflow-y-auto p-1 space-y-0.5 custom-scrollbar">
                                                    <SelectionRow
                                                        selected={!card.config.skillId}
                                                        label="无（纯净）"
                                                        onClick={() => updateCard(card.id, { config: { ...card.config, skillId: undefined } })}
                                                    />
                                                    {skills.map(s => (
                                                        <SelectionRow
                                                            key={s.id}
                                                            selected={card.config.skillId === s.id}
                                                            label={s.name}
                                                            onClick={() => updateCard(card.id, { config: { ...card.config, skillId: s.id } })}
                                                        />
                                                    ))}
                                                </div>
                                            </div>

                                            {/* Format 格式规范列 */}
                                            <div className="flex-1 flex flex-col min-w-0">
                                                <div className="px-2 py-1 bg-white border-b border-slate-200 text-[10px] font-semibold text-slate-400 tracking-wider uppercase shrink-0 flex items-center">
                                                    格式规范
                                                </div>
                                                <div className="flex-1 overflow-y-auto p-1 space-y-0.5 custom-scrollbar">
                                                    <SelectionRow
                                                        selected={!card.config.formatId}
                                                        label="默认"
                                                        onClick={() => updateCard(card.id, { config: { ...card.config, formatId: undefined } })}
                                                    />
                                                    {[...FORMAT_TEMPLATES, ...customFormats].map(f => (
                                                        <SelectionRow
                                                            key={f.id}
                                                            selected={card.config.formatId === f.id}
                                                            label={f.name}
                                                            onClick={() => updateCard(card.id, { config: { ...card.config, formatId: f.id } })}
                                                        />
                                                    ))}
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                </div>

                                {/* Action Buttons */}
                                <div className="px-2 py-1.5 border-t border-slate-200 flex items-center justify-end gap-1.5 shrink-0 bg-white z-10 w-full">
                                    {card.isStreaming ? (
                                        <button
                                            onClick={handleStop}
                                            className="flex items-center justify-center gap-1 px-3 py-1 text-xs font-medium bg-red-50 text-red-600 border border-red-200 rounded hover:bg-red-500 hover:text-white transition-colors"
                                        >
                                            <Square size={11} />
                                            中止推理
                                        </button>
                                    ) : (
                                        <button
                                            onClick={handleGenerate}
                                            disabled={!prompt.trim()}
                                            className="flex items-center justify-center gap-1 px-3 py-1 text-xs font-medium bg-blue-500 text-white rounded hover:bg-blue-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                                        >
                                            <Play size={11} />
                                            开始推理
                                        </button>
                                    )}
                                    {hasContent && !card.isStreaming && (
                                        <button
                                            onClick={handleGenerate}
                                            className="flex items-center justify-center gap-1 px-3 py-1 text-xs font-medium text-slate-600 bg-white border border-slate-200 rounded hover:bg-slate-50 transition-colors"
                                        >
                                            <RefreshCw size={11} />
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
            <div className="flex-1 overflow-y-auto px-3 py-2">
                {card.error && (
                    <div className="mb-2 px-2 py-1 bg-red-50 border border-red-200 rounded text-xs text-red-600">
                        {card.error}
                    </div>
                )}

                {card.isStreaming && (
                    <div className="flex items-center gap-1.5 mb-2 text-xs text-blue-600">
                        <div className="w-1.5 h-1.5 bg-blue-500 rounded-full animate-pulse" />
                        正在生成...
                    </div>
                )}

                {hasContent && (
                    <div>
                        <div className="flex items-center justify-end mb-1">
                            <button
                                onClick={() => {
                                    if (editMode) {
                                        handleSaveEdit();
                                    } else {
                                        setEditContent(card.editedContent || card.generatedContent);
                                        setEditMode(true);
                                    }
                                }}
                                className="flex items-center gap-1 text-[10px] text-slate-400 hover:text-blue-600 transition-colors"
                            >
                                {editMode ? <><Eye size={10} /> 预览</> : <><Pencil size={10} /> 编辑</>}
                            </button>
                        </div>

                        {editMode ? (
                            <textarea
                                value={editContent}
                                onChange={(e) => setEditContent(e.target.value)}
                                className="w-full h-[calc(100%-32px)] text-xs border border-slate-200 rounded px-2 py-1.5 resize-none focus:outline-none focus:border-blue-400 font-mono bg-white"
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
                        <Sparkles size={28} className="mb-2 text-slate-300" />
                        <p className="text-xs">配置 Prompt 后点击生成</p>
                        <p className="text-[10px] mt-1 text-slate-300">Ctrl+Enter 快速生成</p>
                    </div>
                )}
            </div>

            {/* Footer */}
            {card.lastGeneratedAt && (
                <div className="px-3 py-1 border-t border-slate-100 text-[10px] text-slate-400 shrink-0">
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
    const syncWithServer = useAICardStore((s) => s.syncWithServer);

    const [managerTab, setManagerTab] = useState<'prompt' | 'skill' | 'format' | null>(null);
    const [showLogs, setShowLogs] = useState(false);

    useEffect(() => {
        loadModels();
        syncWithServer();
    }, [loadModels, syncWithServer]);

    const selectedCard = cards.find((c) => c.id === selectedCardId) ?? null;

    return (
        <div className="h-full bg-white relative">
            <ResponsiveLayout sidebar={<CardList />} sidebarWidth={220} sidebarClassName="bg-slate-50" drawerTitle="AI 卡片列表">
                {selectedCard ? (
                    <CardEditor key={selectedCard.id} card={selectedCard} onOpenManager={setManagerTab} />
                ) : (
                    <div className="flex flex-col items-center justify-center h-full text-slate-400">
                        <Sparkles size={32} className="mb-2 text-slate-300" />
                        <p className="text-xs">选择或创建一个 AI 卡片</p>
                    </div>
                )}
            </ResponsiveLayout>

            {/* 调试日志入口：右下角浮动按钮 */}
            <button
                onClick={() => setShowLogs(true)}
                className="absolute bottom-4 right-4 z-20 w-8 h-8 rounded-full bg-white border border-slate-200 hover:bg-slate-50 text-slate-400 hover:text-slate-600 flex items-center justify-center shadow-sm transition-colors"
                title="查看 AI 卡片调试日志"
            >
                <Bug size={14} />
            </button>

            <AICardLogViewer open={showLogs} onClose={() => setShowLogs(false)} />

            {managerTab && (
                <TemplateManagementModal
                    initialTab={managerTab}
                    onClose={() => setManagerTab(null)}
                />
            )}
        </div>
    );
});
