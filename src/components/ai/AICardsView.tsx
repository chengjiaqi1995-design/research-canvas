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
import type { AICardSourceMode, PromptTemplate } from '../../types/index.ts';

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
                    onClick={addCard}
                    className="flex items-center gap-1 px-2 py-1 text-xs text-violet-600 hover:bg-violet-50 rounded transition-colors"
                >
                    <Plus size={12} />
                    新建
                </button>
            </div>

            {/* Card list */}
            <div className="flex-1 overflow-y-auto py-1">
                {cards.length === 0 && (
                    <div className="px-3 py-8 text-center">
                        <Sparkles size={24} className="mx-auto mb-2 text-violet-300" />
                        <p className="text-xs text-slate-400">暂无卡片</p>
                        <p className="text-[10px] text-slate-400 mt-1">点击「新建」创建 AI 卡片</p>
                    </div>
                )}
                {cards.map((card) => (
                    <div
                        key={card.id}
                        onClick={() => selectCard(card.id)}
                        className={`flex items-center gap-2 px-3 py-2 mx-1 rounded-lg cursor-pointer group transition-colors ${
                            selectedCardId === card.id
                                ? 'bg-violet-100 text-violet-700'
                                : 'text-slate-600 hover:bg-slate-100'
                        }`}
                    >
                        <Sparkles size={12} className={selectedCardId === card.id ? 'text-violet-500' : 'text-slate-400'} />
                        <div className="flex-1 min-w-0">
                            <div className="text-xs font-medium truncate">{card.title}</div>
                            <div className="text-[10px] text-slate-400 truncate">
                                {card.config.model.split('-').slice(0, 2).join('-')}
                                {card.generatedContent ? ' · 已生成' : ''}
                            </div>
                        </div>
                        {card.isStreaming && (
                            <div className="w-1.5 h-1.5 bg-violet-500 rounded-full animate-pulse shrink-0" />
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
const CardEditor = memo(function CardEditor({ card }: { card: AICard }) {
    const updateCard = useAICardStore((s) => s.updateCard);
    const sendMessage = useAICardStore((s) => s.sendMessage);
    const stopStreaming = useAICardStore((s) => s.stopStreaming);
    const models = useAICardStore((s) => s.models);

    const [title, setTitle] = useState(card.title);
    const [prompt, setPrompt] = useState(card.prompt);
    const [model, setModel] = useState(card.config.model);
    const [sourceMode, setSourceMode] = useState<AICardSourceMode>(card.config.sourceMode);
    const [sourceNodeIds, setSourceNodeIds] = useState<string[]>(card.config.sourceNodeIds);
    const [sourceWorkspaceIds, setSourceWorkspaceIds] = useState<string[]>(card.config.sourceWorkspaceIds || []);
    const [sourceDateFrom, setSourceDateFrom] = useState(card.config.sourceDateFrom || '');
    const [sourceDateTo, setSourceDateTo] = useState(card.config.sourceDateTo || '');
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
        setSourceDateFrom(card.config.sourceDateFrom || '');
        setSourceDateTo(card.config.sourceDateTo || '');
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
                sourceDateFrom: sourceDateFrom || undefined,
                sourceDateTo: sourceDateTo || undefined,
            },
        });
    }, [card.id, prompt, model, sourceMode, sourceNodeIds, sourceWorkspaceIds, sourceDateFrom, sourceDateTo, card.config, updateCard]);

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
                    className="w-full text-lg font-semibold text-slate-800 border-none outline-none bg-transparent hover:text-violet-600 transition-colors"
                    placeholder="卡片标题..."
                />
            </div>

            {/* Config section */}
            <div className="px-4 shrink-0">
                <button
                    onClick={() => setConfigOpen(!configOpen)}
                    className="flex items-center gap-1 text-xs text-slate-500 hover:text-violet-600 transition-colors my-2"
                >
                    {configOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                    <Sparkles size={11} />
                    配置
                </button>

                {configOpen && (
                    <div className="space-y-3 pb-3 border-b border-slate-200">
                        {/* Model selector */}
                        <div>
                            <label className="text-xs font-medium text-slate-600 mb-1 block">模型</label>
                            <select
                                value={model}
                                onChange={(e) => setModel(e.target.value)}
                                className="w-full text-xs border border-slate-200 rounded px-2 py-1.5 bg-white focus:outline-none focus:border-violet-400"
                            >
                                {models.length > 0 ? models.map((m) => (
                                    <option key={m.id} value={m.id}>{m.name}</option>
                                )) : (
                                    <option value={model}>{model}</option>
                                )}
                            </select>
                        </div>

                        {/* Source mode */}
                        <div>
                            <label className="text-xs font-medium text-slate-600 mb-1 block">内容来源</label>
                            <div className="flex gap-1">
                                {sourceModeOptions.map((opt) => {
                                    const Icon = opt.icon;
                                    return (
                                        <button
                                            key={opt.value}
                                            onClick={() => setSourceMode(opt.value)}
                                            className={`flex items-center gap-1 px-2.5 py-1 text-xs rounded transition-colors ${
                                                sourceMode === opt.value
                                                    ? 'bg-violet-100 text-violet-700 border border-violet-300'
                                                    : 'bg-slate-100 text-slate-600 border border-transparent hover:bg-slate-200'
                                            }`}
                                        >
                                            <Icon size={11} />
                                            {opt.label}
                                        </button>
                                    );
                                })}
                            </div>
                            {sourceMode !== 'notes' && !model.startsWith('gemini') && (
                                <div className="text-[10px] text-amber-600 mt-1">
                                    联网搜索目前仅支持 Gemini 模型，请切换模型
                                </div>
                            )}
                        </div>

                        {/* Source folder picker (cross-folder notes) */}
                        {sourceMode !== 'web' && (
                            <div>
                                <label className="text-xs font-medium text-slate-600 mb-1 block">笔记来源（按文件夹筛选）</label>
                                <SourceFolderPicker
                                    selectedWorkspaceIds={sourceWorkspaceIds}
                                    dateFrom={sourceDateFrom}
                                    dateTo={sourceDateTo}
                                    onChangeWorkspaces={setSourceWorkspaceIds}
                                    onChangeDateFrom={setSourceDateFrom}
                                    onChangeDateTo={setSourceDateTo}
                                />
                            </div>
                        )}

                        {/* Source node picker (current canvas nodes) */}
                        {sourceMode !== 'web' && sourceWorkspaceIds.length === 0 && (
                            <SourceNodePicker
                                selectedIds={sourceNodeIds}
                                onChange={setSourceNodeIds}
                            />
                        )}

                        {/* Prompt */}
                        <div>
                            <div className="flex items-center justify-between mb-1">
                                <label className="text-xs font-medium text-slate-600">Prompt</label>
                                <PromptTemplateSelector onSelect={handleTemplateSelect} />
                            </div>
                            <textarea
                                value={prompt}
                                onChange={(e) => setPrompt(e.target.value)}
                                onKeyDown={(e) => {
                                    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                                        e.preventDefault();
                                        handleGenerate();
                                    }
                                }}
                                placeholder="输入你的指令... (Ctrl+Enter 生成)"
                                className="w-full h-32 text-xs border border-slate-200 rounded px-3 py-2 resize-y focus:outline-none focus:border-violet-400 bg-white"
                            />
                        </div>

                        {/* Generate button */}
                        <div className="flex items-center gap-2">
                            {card.isStreaming ? (
                                <button
                                    onClick={handleStop}
                                    className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium bg-red-500 text-white rounded hover:bg-red-600 transition-colors"
                                >
                                    <Square size={11} />
                                    停止
                                </button>
                            ) : (
                                <button
                                    onClick={handleGenerate}
                                    disabled={!prompt.trim()}
                                    className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium bg-violet-600 text-white rounded hover:bg-violet-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                                >
                                    <Play size={11} />
                                    生成
                                </button>
                            )}
                            {hasContent && !card.isStreaming && (
                                <button
                                    onClick={handleGenerate}
                                    className="flex items-center gap-1 px-3 py-1.5 text-xs text-slate-600 bg-slate-100 rounded hover:bg-slate-200 transition-colors"
                                >
                                    <RefreshCw size={11} />
                                    重新生成
                                </button>
                            )}
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
                    <div className="flex items-center gap-2 mb-3 text-xs text-violet-500">
                        <div className="w-2 h-2 bg-violet-500 rounded-full animate-pulse" />
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
                                className="flex items-center gap-1 text-[10px] text-slate-400 hover:text-violet-500 transition-colors"
                            >
                                {editMode ? <><Eye size={10} /> 预览</> : <><Pencil size={10} /> 编辑</>}
                            </button>
                        </div>

                        {editMode ? (
                            <textarea
                                value={editContent}
                                onChange={(e) => setEditContent(e.target.value)}
                                className="w-full h-[calc(100%-32px)] text-xs border border-slate-200 rounded px-3 py-2 resize-none focus:outline-none focus:border-violet-400 font-mono bg-white"
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
                        <Sparkles size={32} className="mb-3 text-violet-300" />
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

    useEffect(() => {
        loadModels();
    }, [loadModels]);

    const selectedCard = cards.find((c) => c.id === selectedCardId) ?? null;

    return (
        <div className="flex h-full bg-white">
            <CardList />
            <div className="flex-1 overflow-hidden">
                {selectedCard ? (
                    <CardEditor key={selectedCard.id} card={selectedCard} />
                ) : (
                    <div className="flex flex-col items-center justify-center h-full text-slate-400">
                        <Sparkles size={40} className="mb-3 text-violet-200" />
                        <p className="text-sm">选择或创建一个 AI 卡片</p>
                        <p className="text-xs mt-1 text-slate-300">这里是 AI Skill 的核心配置入口</p>
                    </div>
                )}
            </div>
        </div>
    );
});
