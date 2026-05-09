import { memo, useEffect, useState, useCallback, useMemo } from 'react';
import {
    Plus, Sparkles, Trash2, Play, Square, RefreshCw,
    Pencil, Eye, ChevronDown, ChevronRight, Globe, FileText, Layers,
    Cloud, CloudOff, Loader2, Search, BookOpen,
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
import type { AICardSourceMode, PromptTemplate, AISkill, FormatTemplate } from '../../types/index.ts';
import TemplateManagementModal from './TemplateManagementModal.tsx';
import { PrimaryButton } from '../ui/index.ts';

/** Cloud sync status indicator */
const SyncStatusBadge = memo(function SyncStatusBadge() {
    const status = useAICardStore((s) => s.cloudSyncStatus);
    if (status === 'idle') return null;
    if (status === 'syncing') return <span title="正在同步..."><Loader2 size={11} className="animate-spin text-blue-400" /></span>;
    if (status === 'synced') return <span title="已同步"><Cloud size={11} className="text-emerald-500" /></span>;
    if (status === 'error') return <span title="同步失败"><CloudOff size={11} className="text-red-500" /></span>;
    return null;
});

type LibraryAssetKind = 'workflow' | 'prompt' | 'skill' | 'format';
type LibraryFilter = LibraryAssetKind | 'all';
type LibrarySelection = { kind: LibraryAssetKind; id: string };

interface LibraryAsset {
    id: string;
    kind: LibraryAssetKind;
    name: string;
    description: string;
    content: string;
    origin: 'cloud' | 'system';
    meta?: string;
    updatedAt?: number;
    isRunning?: boolean;
    hasOutput?: boolean;
}

const KIND_META: Record<LibraryAssetKind, { label: string; shortLabel: string; icon: typeof Sparkles; tone: string }> = {
    workflow: { label: 'Workflow 工作流', shortLabel: 'Workflow', icon: Sparkles, tone: 'text-blue-600 bg-blue-50 border-blue-100' },
    prompt: { label: 'Prompt 模板', shortLabel: 'Prompt', icon: FileText, tone: 'text-indigo-600 bg-indigo-50 border-indigo-100' },
    skill: { label: 'Skill 方法论', shortLabel: 'Skill', icon: BookOpen, tone: 'text-emerald-600 bg-emerald-50 border-emerald-100' },
    format: { label: 'Format 输出格式', shortLabel: 'Format', icon: Layers, tone: 'text-amber-600 bg-amber-50 border-amber-100' },
};

function buildLibraryAssets(
    cards: AICard[],
    customTemplates: PromptTemplate[],
    skills: AISkill[],
    customFormats: FormatTemplate[],
): LibraryAsset[] {
    return [
        ...cards.map((card) => ({
            id: card.id,
            kind: 'workflow' as const,
            name: card.title,
            description: card.prompt ? card.prompt.replace(/\s+/g, ' ').slice(0, 110) : '可运行的研究工作流',
            content: card.prompt,
            origin: 'cloud' as const,
            meta: `${card.config.model.split('-').slice(0, 2).join('-')}${card.generatedContent ? ' · 已运行' : ''}`,
            updatedAt: card.updatedAt || card.lastGeneratedAt,
            isRunning: card.isStreaming,
            hasOutput: !!card.generatedContent,
        })),
        ...PROMPT_TEMPLATES.map((tpl) => ({
            id: tpl.id,
            kind: 'prompt' as const,
            name: tpl.name,
            description: tpl.description,
            content: tpl.prompt,
            origin: 'system' as const,
            meta: tpl.category,
        })),
        ...customTemplates.map((tpl) => ({
            id: tpl.id,
            kind: 'prompt' as const,
            name: tpl.name,
            description: tpl.description,
            content: tpl.prompt,
            origin: 'cloud' as const,
            meta: tpl.category,
        })),
        ...skills.map((skill) => ({
            id: skill.id,
            kind: 'skill' as const,
            name: skill.name,
            description: skill.description || '云端 Skill 方法论',
            content: skill.content,
            origin: 'cloud' as const,
            meta: skill.createdAt ? new Date(skill.createdAt).toLocaleDateString('zh-CN') : undefined,
            updatedAt: skill.createdAt,
        })),
        ...FORMAT_TEMPLATES.map((fmt) => ({
            id: fmt.id,
            kind: 'format' as const,
            name: fmt.name,
            description: fmt.description,
            content: fmt.content,
            origin: 'system' as const,
        })),
        ...customFormats.map((fmt) => ({
            id: fmt.id,
            kind: 'format' as const,
            name: fmt.name,
            description: fmt.description,
            content: fmt.content,
            origin: 'cloud' as const,
        })),
    ];
}

const LibrarySidebar = memo(function LibrarySidebar({
    selectedAsset,
    filter,
    onFilterChange,
    onSelectAsset,
    onCreateWorkflow,
    onOpenManager,
}: {
    selectedAsset: LibrarySelection | null;
    filter: LibraryFilter;
    onFilterChange: (filter: LibraryFilter) => void;
    onSelectAsset: (asset: LibrarySelection) => void;
    onCreateWorkflow: (initial?: { title?: string; prompt?: string }) => void;
    onOpenManager: (tab: 'prompt' | 'skill' | 'format') => void;
}) {
    const cards = useAICardStore((s) => s.cards);
    const customTemplates = useAICardStore((s) => s.customTemplates);
    const skills = useAICardStore((s) => s.skills);
    const customFormats = useAICardStore((s) => s.customFormats || []);
    const removeCard = useAICardStore((s) => s.removeCard);
    const selectCard = useAICardStore((s) => s.selectCard);
    const [query, setQuery] = useState('');

    const assets = useMemo(
        () => buildLibraryAssets(cards, customTemplates, skills, customFormats),
        [cards, customTemplates, skills, customFormats],
    );

    const filteredAssets = useMemo(() => {
        const normalizedQuery = query.trim().toLowerCase();
        return assets.filter((asset) => {
            if (filter !== 'all' && asset.kind !== filter) return false;
            if (!normalizedQuery) return true;
            return `${asset.name} ${asset.description} ${asset.content} ${asset.meta || ''}`.toLowerCase().includes(normalizedQuery);
        });
    }, [assets, filter, query]);

    const filters: Array<{ key: LibraryFilter; label: string; count: number }> = [
        { key: 'all', label: '全部', count: assets.length },
        { key: 'workflow', label: 'Workflows', count: assets.filter(a => a.kind === 'workflow').length },
        { key: 'prompt', label: 'Prompts', count: assets.filter(a => a.kind === 'prompt').length },
        { key: 'skill', label: 'Skills', count: assets.filter(a => a.kind === 'skill').length },
        { key: 'format', label: 'Formats', count: assets.filter(a => a.kind === 'format').length },
    ];

    return (
        <div className="flex flex-col h-full bg-slate-50 w-full">
            <div className="flex items-center justify-between px-2 border-b border-slate-200 bg-white shrink-0" style={{ minHeight: 38 }}>
                <span className="text-xs font-semibold text-slate-700 flex items-center gap-1.5">
                    能力库 <SyncStatusBadge />
                </span>
                <button
                    onClick={() => onCreateWorkflow()}
                    className="flex items-center gap-1 px-2 py-0.5 text-xs text-slate-500 hover:text-blue-600 hover:bg-blue-50 rounded transition-colors"
                    title="新建 Workflow"
                >
                    <Plus size={12} />
                    Workflow
                </button>
            </div>

            <div className="shrink-0 p-2 border-b border-slate-200 bg-white space-y-2">
                <div className="relative">
                    <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-400" />
                    <input
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        className="w-full rounded border border-slate-200 bg-slate-50 py-1 pl-7 pr-2 text-xs text-slate-700 outline-none focus:border-blue-400 focus:bg-white"
                        placeholder="搜索 Prompt / Skill / Workflow"
                    />
                </div>
                <div className="grid grid-cols-2 gap-1">
                    {filters.map((item) => (
                        <button
                            key={item.key}
                            onClick={() => onFilterChange(item.key)}
                            className={`flex items-center justify-between rounded px-2 py-1 text-[11px] transition-colors ${
                                filter === item.key
                                    ? 'bg-blue-50 text-blue-700 font-semibold'
                                    : 'text-slate-500 hover:bg-slate-100'
                            }`}
                        >
                            <span>{item.label}</span>
                            <span className="text-[10px] text-slate-400">{item.count}</span>
                        </button>
                    ))}
                </div>
                <div className="flex gap-1 text-[10px]">
                    <button onClick={() => onOpenManager('prompt')} className="flex-1 rounded border border-slate-200 bg-white px-1.5 py-1 text-slate-500 hover:text-blue-600 hover:border-blue-200">Prompt</button>
                    <button onClick={() => onOpenManager('skill')} className="flex-1 rounded border border-slate-200 bg-white px-1.5 py-1 text-slate-500 hover:text-blue-600 hover:border-blue-200">Skill</button>
                    <button onClick={() => onOpenManager('format')} className="flex-1 rounded border border-slate-200 bg-white px-1.5 py-1 text-slate-500 hover:text-blue-600 hover:border-blue-200">Format</button>
                </div>
            </div>

            <div className="flex-1 overflow-y-auto px-1 py-1 space-y-0.5">
                {filteredAssets.length === 0 && (
                    <div className="px-3 py-8 mt-8 text-center flex flex-col items-center">
                        <Sparkles size={20} className="mx-auto mb-2 text-slate-300" />
                        <p className="text-[11px] text-slate-500 mb-4">暂无匹配内容</p>

                        <PrimaryButton
                            onClick={() => {
                                const tpl = PROMPT_TEMPLATES.find(p => p.id === 'weekly_report');
                                onCreateWorkflow({ title: '投资周报 Workflow', prompt: tpl?.prompt || '' });
                            }}
                            icon={<Sparkles size={12} />}
                            className="w-full"
                        >
                            创建投资周报 Workflow
                        </PrimaryButton>

                        <button
                            onClick={() => onCreateWorkflow()}
                            className="text-[11px] text-slate-500 hover:text-slate-700 mt-3"
                        >
                            或创建空白 Workflow
                        </button>
                    </div>
                )}
                {filteredAssets.map((asset) => {
                    const isSelected = selectedAsset?.kind === asset.kind && selectedAsset.id === asset.id;
                    const meta = KIND_META[asset.kind];
                    const Icon = meta.icon;
                    return (
                        <div
                            key={`${asset.kind}:${asset.id}`}
                            onClick={() => {
                                if (asset.kind === 'workflow') selectCard(asset.id);
                                onSelectAsset({ kind: asset.kind, id: asset.id });
                            }}
                            className={`flex items-center gap-1.5 px-2 py-1 rounded cursor-pointer group text-xs transition-colors ${
                                isSelected ? 'bg-blue-100 text-blue-800 font-medium' : 'text-slate-500 hover:bg-slate-100'
                            }`}
                        >
                            <Icon size={11} className={`shrink-0 ${isSelected ? 'text-blue-500' : 'text-slate-400'}`} />
                            <div className="flex-1 min-w-0">
                                <div className="truncate">{asset.name}</div>
                                <div className="text-[10px] text-slate-400 truncate">
                                    {meta.shortLabel} · {asset.origin === 'cloud' ? '云端' : '内置'}{asset.meta ? ` · ${asset.meta}` : ''}
                                </div>
                            </div>
                            {asset.isRunning && (
                                <div className="w-1.5 h-1.5 bg-blue-500 rounded-full animate-pulse shrink-0" />
                            )}
                            {asset.kind === 'workflow' && (
                                <button
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        if (confirm('删除此 Workflow？')) removeCard(asset.id);
                                    }}
                                    className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-red-100 text-slate-300 hover:text-red-500 shrink-0 transition-opacity"
                                >
                                    <Trash2 size={11} />
                                </button>
                            )}
                        </div>
                    );
                })}
            </div>

            <div className="px-2 py-1 border-t border-slate-200 text-[10px] text-slate-400 shrink-0 bg-white">
                {assets.length} 个能力资产 · {cards.length} 个 Workflow
            </div>
        </div>
    );
});

const LibraryAssetDetail = memo(function LibraryAssetDetail({
    asset,
    onUseAsset,
    onOpenManager,
}: {
    asset: LibraryAsset;
    onUseAsset: (asset: LibraryAsset) => void;
    onOpenManager: (tab: 'prompt' | 'skill' | 'format') => void;
}) {
    const meta = KIND_META[asset.kind];
    const Icon = meta.icon;
    const managerTab = asset.kind === 'workflow' ? null : asset.kind;

    return (
        <div className="mobile-scroll-container flex h-full min-h-0 flex-col overflow-hidden bg-white max-md:overflow-y-auto">
            <div className="shrink-0 border-b border-slate-200 bg-white px-4 py-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                        <div className="mb-2 flex items-center gap-2">
                            <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold ${meta.tone}`}>
                                <Icon size={12} />
                                {meta.label}
                            </span>
                            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-500">
                                {asset.origin === 'cloud' ? '云端同步' : '系统内置'}
                            </span>
                        </div>
                        <h2 className="truncate text-lg font-semibold text-slate-900">{asset.name}</h2>
                        <p className="mt-1 max-w-3xl text-sm leading-relaxed text-slate-500">{asset.description || '暂无描述'}</p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                        {managerTab && (
                            <button
                                onClick={() => onOpenManager(managerTab)}
                                className="rounded border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50"
                            >
                                管理库
                            </button>
                        )}
                        <PrimaryButton onClick={() => onUseAsset(asset)} icon={<Plus size={12} />}>
                            用它创建 Workflow
                        </PrimaryButton>
                    </div>
                </div>
            </div>

            <div className="flex-1 overflow-y-auto p-4">
                <div className="grid gap-3 md:grid-cols-3">
                    <div className="rounded border border-slate-200 bg-slate-50 px-3 py-2">
                        <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">类型</div>
                        <div className="mt-1 text-sm font-semibold text-slate-700">{meta.shortLabel}</div>
                    </div>
                    <div className="rounded border border-slate-200 bg-slate-50 px-3 py-2">
                        <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">存储</div>
                        <div className="mt-1 text-sm font-semibold text-slate-700">{asset.origin === 'cloud' ? '云端库' : '系统内置库'}</div>
                    </div>
                    <div className="rounded border border-slate-200 bg-slate-50 px-3 py-2">
                        <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">标记</div>
                        <div className="mt-1 text-sm font-semibold text-slate-700">{asset.meta || '-'}</div>
                    </div>
                </div>

                <div className="mt-4 rounded border border-slate-200 bg-white">
                    <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50 px-3 py-2">
                        <h3 className="text-xs font-semibold text-slate-700">正文</h3>
                        <span className="text-[10px] text-slate-400">{asset.content.length.toLocaleString('zh-CN')} chars</span>
                    </div>
                    <pre className="max-h-[calc(100vh-280px)] overflow-auto whitespace-pre-wrap px-3 py-3 text-xs leading-relaxed text-slate-700">
                        {asset.content || '暂无内容'}
                    </pre>
                </div>
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
        if (!title || title === 'AI 卡片' || title === '新建 Workflow') setTitle(`${tpl.name} Workflow`);
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
        <div className="mobile-scroll-container flex h-full min-h-0 flex-col overflow-hidden max-md:overflow-y-auto">
            {/* Title */}
            <div className="flex items-center px-3 shrink-0 border-b border-slate-200 bg-white" style={{ minHeight: 38 }}>
                <input
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    onBlur={handleSaveTitle}
                    onKeyDown={(e) => e.key === 'Enter' && handleSaveTitle()}
                    className="w-full text-sm font-semibold text-slate-700 border-none outline-none bg-transparent"
                    placeholder="Workflow 名称..."
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
                    运行配置
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
                            <div className="flex-[4] min-w-[380px] shrink-0 flex flex-col border border-slate-200 rounded overflow-hidden bg-white h-[460px]">
                                <div className="bg-slate-50 px-2 border-b border-slate-200 flex items-center" style={{ minHeight: 30 }}>
                                    <h3 className="text-xs font-semibold text-slate-700 m-0 flex items-center gap-1.5 select-none">
                                        <Layers size={12} className="text-slate-400" />
                                        输入数据源
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
                            <div className="flex-[6] min-w-[460px] flex flex-col border border-slate-200 rounded overflow-hidden bg-white h-[460px]">
                                <div className="bg-slate-50 px-2 border-b border-slate-200 flex items-center justify-between shrink-0" style={{ minHeight: 30 }}>
                                    <h3 className="text-xs font-semibold text-slate-700 m-0 flex items-center gap-1.5 select-none">
                                        <Sparkles size={12} className="text-slate-400" />
                                        Prompt / Skill / Format 编排
                                    </h3>
                                    <button
                                        onClick={() => onOpenManager('prompt')}
                                        className="text-[10px] text-slate-400 hover:text-blue-600 transition-colors"
                                    >
                                        管理能力库
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
                                                placeholder="输入这个 Workflow 的 Prompt... (支持 Ctrl+Enter 快速运行)"
                                                className="flex-1 w-full text-xs leading-relaxed text-slate-700 border-0 resize-none focus:ring-0 focus:outline-none placeholder-slate-300 custom-scrollbar p-2"
                                                style={{ boxShadow: 'none' }}
                                            />
                                        </div>

                                        {/* 勾选列表区域 (右侧三列) */}
                                        <div className="w-[420px] shrink-0 flex divide-x divide-slate-200 bg-slate-50 border-l border-slate-200">
                                            {/* Prompt 模板列 */}
                                            <div className="flex-1 flex flex-col min-w-0">
                                                <div className="px-2 py-1 bg-white border-b border-slate-200 text-[10px] font-semibold text-slate-400 tracking-wider uppercase shrink-0 flex items-center">
                                                    Prompt
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
                                                    Skill
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
                                                    Format
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
                                            中止运行
                                        </button>
                                    ) : (
                                        <PrimaryButton
                                            onClick={handleGenerate}
                                            disabled={!prompt.trim()}
                                            icon={<Play size={11} />}
                                        >
                                            运行
                                        </PrimaryButton>
                                    )}
                                    {hasContent && !card.isStreaming && (
                                        <button
                                            onClick={handleGenerate}
                                            className="flex items-center justify-center gap-1 px-3 py-1 text-xs font-medium text-slate-600 bg-white border border-slate-200 rounded hover:bg-slate-50 transition-colors"
                                        >
                                            <RefreshCw size={11} />
                                            重新运行
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
                        正在运行...
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
                        <p className="text-xs">配置数据源、Prompt 和 Skill 后点击运行</p>
                        <p className="text-[10px] mt-1 text-slate-300">Ctrl+Enter 快速运行</p>
                    </div>
                )}
            </div>

            {/* Footer */}
            {card.lastGeneratedAt && (
                <div className="px-3 py-1 border-t border-slate-100 text-[10px] text-slate-400 shrink-0">
                    上次运行: {new Date(card.lastGeneratedAt).toLocaleString('zh-CN')}
                </div>
            )}
        </div>
    );
});

/** Main AI Cards View — replaces AIResearchView */
export const AICardsView = memo(function AICardsView() {
    const cards = useAICardStore((s) => s.cards);
    const selectedCardId = useAICardStore((s) => s.selectedCardId);
    const customTemplates = useAICardStore((s) => s.customTemplates);
    const skills = useAICardStore((s) => s.skills);
    const customFormats = useAICardStore((s) => s.customFormats || []);
    const addCard = useAICardStore((s) => s.addCard);
    const updateCard = useAICardStore((s) => s.updateCard);
    const selectCard = useAICardStore((s) => s.selectCard);
    const loadModels = useAICardStore((s) => s.loadModels);
    const syncWithServer = useAICardStore((s) => s.syncWithServer);

    const [managerTab, setManagerTab] = useState<'prompt' | 'skill' | 'format' | null>(null);
    const [showLogs, setShowLogs] = useState(false);
    const [libraryFilter, setLibraryFilter] = useState<LibraryFilter>('all');
    const [selectedAsset, setSelectedAsset] = useState<LibrarySelection | null>(null);

    useEffect(() => {
        loadModels();
        syncWithServer();
    }, [loadModels, syncWithServer]);

    const assets = useMemo(
        () => buildLibraryAssets(cards, customTemplates, skills, customFormats),
        [cards, customTemplates, skills, customFormats],
    );

    useEffect(() => {
        if (selectedAsset && assets.some((asset) => asset.kind === selectedAsset.kind && asset.id === selectedAsset.id)) return;
        if (selectedCardId && cards.some((card) => card.id === selectedCardId)) {
            setSelectedAsset({ kind: 'workflow', id: selectedCardId });
            return;
        }
        const firstAsset = assets[0];
        setSelectedAsset(firstAsset ? { kind: firstAsset.kind, id: firstAsset.id } : null);
    }, [assets, cards, selectedAsset, selectedCardId]);

    const createWorkflow = useCallback((initial?: Parameters<typeof addCard>[0]) => {
        const id = addCard(initial);
        selectCard(id);
        setSelectedAsset({ kind: 'workflow', id });
        setLibraryFilter('workflow');
        return id;
    }, [addCard, selectCard]);

    const handleUseAsset = useCallback((asset: LibraryAsset) => {
        if (asset.kind === 'workflow') {
            selectCard(asset.id);
            setSelectedAsset({ kind: 'workflow', id: asset.id });
            return;
        }

        const title = `${asset.name} Workflow`;
        const basePrompt = asset.kind === 'prompt'
            ? asset.content
            : '请基于选定资料完成研究分析。\n\n{context}';
        const id = createWorkflow({ title, prompt: basePrompt });
        const created = useAICardStore.getState().cards.find((card) => card.id === id);
        if (!created) return;

        if (asset.kind === 'skill') {
            updateCard(id, { config: { ...created.config, skillId: asset.id } });
        } else if (asset.kind === 'format') {
            updateCard(id, { config: { ...created.config, formatId: asset.id } });
        }
    }, [createWorkflow, selectCard, updateCard]);

    const selectedCard = selectedAsset?.kind === 'workflow'
        ? cards.find((c) => c.id === selectedAsset.id) ?? null
        : null;
    const selectedAssetObject = selectedAsset && !selectedCard
        ? assets.find((asset) => asset.kind === selectedAsset.kind && asset.id === selectedAsset.id) ?? null
        : null;

    return (
        <div className="h-full bg-white relative">
            <ResponsiveLayout
                sidebar={(
                    <LibrarySidebar
                        selectedAsset={selectedAsset}
                        filter={libraryFilter}
                        onFilterChange={setLibraryFilter}
                        onSelectAsset={setSelectedAsset}
                        onCreateWorkflow={createWorkflow}
                        onOpenManager={setManagerTab}
                    />
                )}
                sidebarWidth={280}
                sidebarClassName="bg-slate-50"
                drawerTitle="能力库"
            >
                {selectedCard ? (
                    <CardEditor key={selectedCard.id} card={selectedCard} onOpenManager={setManagerTab} />
                ) : selectedAssetObject ? (
                    <LibraryAssetDetail
                        key={`${selectedAssetObject.kind}:${selectedAssetObject.id}`}
                        asset={selectedAssetObject}
                        onUseAsset={handleUseAsset}
                        onOpenManager={setManagerTab}
                    />
                ) : (
                    <div className="flex flex-col items-center justify-center h-full text-slate-400">
                        <Sparkles size={32} className="mb-2 text-slate-300" />
                        <p className="text-xs">选择一个 Prompt / Skill / Workflow，或创建新的 Workflow</p>
                    </div>
                )}
            </ResponsiveLayout>

            {/* 调试日志入口：右下角浮动按钮 */}
            <button
                onClick={() => setShowLogs(true)}
                className="absolute bottom-4 right-4 z-20 w-8 h-8 rounded-full bg-white border border-slate-200 hover:bg-slate-50 text-slate-400 hover:text-slate-600 flex items-center justify-center shadow-sm transition-colors"
                title="查看能力库调试日志"
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
