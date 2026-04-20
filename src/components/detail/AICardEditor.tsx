import { memo, useState, useCallback, useEffect } from 'react';
import { Sparkles, Play, Square, RefreshCw, Pencil, Eye, ChevronDown, ChevronRight, Globe, FileText, Layers } from 'lucide-react';
import { useCanvasStore } from '../../stores/canvasStore.ts';
import { useAICardGeneration } from '../../hooks/useAICardGeneration.ts';
import { SourceNodePicker } from './SourceNodePicker.tsx';
import { PromptTemplateSelector } from './PromptTemplateSelector.tsx';
import type { AICardNodeData, AICardSourceMode, PromptTemplate } from '../../types/index.ts';
import { NoteModal } from './NoteModal.tsx';
import { parseAIMarkdown } from '../../utils/markdownParser.ts';
import { PrimaryButton } from '../ui/index.ts';

interface AICardEditorProps {
  nodeId: string;
  data: AICardNodeData;
}

export const AICardEditor = memo(function AICardEditor({ nodeId, data }: AICardEditorProps) {
  const updateNodeData = useCanvasStore((s) => s.updateNodeData);
  const { generate, stop, isStreaming } = useAICardGeneration(nodeId);

  // Local state
  const [title, setTitle] = useState(data.title);
  const [prompt, setPrompt] = useState(data.prompt);
  const [model, setModel] = useState(data.config.model);
  const [sourceMode, setSourceMode] = useState<AICardSourceMode>(data.config.sourceMode);
  const [sourceNodeIds, setSourceNodeIds] = useState<string[]>(data.config.sourceNodeIds);
  const [configOpen, setConfigOpen] = useState(!data.generatedContent);
  const [editMode, setEditMode] = useState(false);
  const [editContent, setEditContent] = useState(data.editedContent);
  const [models, setModels] = useState<Array<{ id: string; name: string }>>([]);

  const nodes = useCanvasStore((s) => s.nodes);
  const [modalOpen, setModalOpen] = useState(false);
  const [modalTitle, setModalTitle] = useState('');
  const [modalContent, setModalContent] = useState('');

  // Load available models
  useEffect(() => {
    import('../../db/apiClient.ts').then(({ aiApi }) => {
      aiApi.getModels().then(setModels).catch(() => {});
    });
  }, []);

  // Sync title changes
  const handleSaveTitle = useCallback(() => {
    if (title.trim() && title !== data.title) {
      updateNodeData(nodeId, { title: title.trim() });
    }
  }, [title, data.title, nodeId, updateNodeData]);

  // Save config before generating
  const saveConfig = useCallback(() => {
    updateNodeData(nodeId, {
      prompt,
      config: { ...data.config, model, sourceMode, sourceNodeIds },
    } as Partial<AICardNodeData>);
  }, [nodeId, prompt, model, sourceMode, sourceNodeIds, data.config, updateNodeData]);

  const handleGenerate = useCallback(() => {
    saveConfig();
    // Need a small delay for state to propagate
    setTimeout(() => generate(), 50);
  }, [saveConfig, generate]);

  const handleTemplateSelect = useCallback((tpl: PromptTemplate) => {
    setPrompt(tpl.prompt);
    if (!title || title === 'AI 卡片') {
      setTitle(tpl.name);
    }
  }, [title]);

  const handleSaveEdit = useCallback(() => {
    updateNodeData(nodeId, { editedContent: editContent } as Partial<AICardNodeData>);
    setEditMode(false);
  }, [nodeId, editContent, updateNodeData]);

  // Keep edit content in sync with generation
  useEffect(() => {
    if (isStreaming) {
      setEditContent(data.editedContent);
    }
  }, [data.editedContent, isStreaming]);

  const sourceModeOptions: { value: AICardSourceMode; label: string; icon: typeof FileText }[] = [
    { value: 'notes', label: '仅笔记', icon: FileText },
    { value: 'web', label: '仅联网', icon: Globe },
    { value: 'notes_web', label: '笔记+联网', icon: Layers },
  ];

  const handleLinkClick = useCallback((e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    if (target.classList.contains('ref-link')) {
      e.preventDefault();
      e.stopPropagation();
      
      const refIdx = target.getAttribute('data-ref');
      if (refIdx) {
        const idx = parseInt(refIdx, 10) - 1;
        const sourceNodes = data.config.sourceNodeIds || [];
        if (sourceNodes[idx]) {
          const matched = nodes.find(n => n.id === sourceNodes[idx]);
          if (matched) {
            setModalTitle(matched.data.title || '');
            setModalContent((matched.data as any).content || '');
            setModalOpen(true);
            return;
          }
        }
      }

      const refTitle = target.getAttribute('data-title');
      if (refTitle) {
        const matched = nodes.find(n => n.data.title === refTitle) || 
                        nodes.find(n => n.data.title && (n.data.title.includes(refTitle) || refTitle.includes(n.data.title)));
        if (matched) {
          setModalTitle(matched.data.title || '');
          setModalContent((matched.data as any).content || '');
          setModalOpen(true);
        }
      }
    }
  }, [nodes, data.config.sourceNodeIds]);

  const hasContent = !!(data.generatedContent || data.editedContent);

  return (
    <div className="flex flex-col h-full">
      {/* Title */}
      <div className="px-4 pt-3 pb-2 shrink-0">
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={handleSaveTitle}
          onKeyDown={(e) => e.key === 'Enter' && handleSaveTitle()}
          className="w-full text-lg font-semibold text-slate-800 border-none outline-none bg-transparent hover:text-blue-600 transition-colors"
          placeholder="卡片标题..."
        />
      </div>

      {/* Config section */}
      <div className="px-4 shrink-0">
        <button
          onClick={() => setConfigOpen(!configOpen)}
          className="flex items-center gap-1 text-xs text-slate-500 hover:text-blue-600 transition-colors mb-2"
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
                className="w-full text-xs border border-slate-200 rounded px-2 py-1.5 bg-white focus:outline-none focus:border-blue-400"
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
                          ? 'bg-blue-100 text-blue-700 border border-blue-300'
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

            {/* Source node picker */}
            {sourceMode !== 'web' && (
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
                className="w-full h-32 text-xs border border-slate-200 rounded px-3 py-2 resize-y focus:outline-none focus:border-blue-400 bg-white"
              />
            </div>

            {/* Generate button */}
            <div className="flex items-center gap-2">
              {isStreaming ? (
                <button
                  onClick={stop}
                  className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium bg-red-500 text-white rounded hover:bg-red-600 transition-colors"
                >
                  <Square size={11} />
                  停止
                </button>
              ) : (
                <PrimaryButton
                  onClick={handleGenerate}
                  disabled={!prompt.trim()}
                  icon={<Play size={11} />}
                >
                  生成
                </PrimaryButton>
              )}
              {hasContent && !isStreaming && (
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
        {data.error && (
          <div className="mb-3 px-3 py-2 bg-red-50 border border-red-200 rounded text-xs text-red-600">
            {data.error}
          </div>
        )}

        {isStreaming && (
          <div className="flex items-center gap-2 mb-3 text-xs text-blue-500">
            <div className="w-2 h-2 bg-blue-500 rounded-full animate-pulse" />
            正在生成...
          </div>
        )}

        {hasContent && (
          <div>
            {/* Edit/View toggle */}
            <div className="flex items-center justify-end mb-2">
              <button
                onClick={() => {
                  if (editMode) {
                    handleSaveEdit();
                  } else {
                    setEditContent(data.editedContent || data.generatedContent);
                    setEditMode(true);
                  }
                }}
                className="flex items-center gap-1 text-[10px] text-slate-400 hover:text-blue-500 transition-colors"
              >
                {editMode ? <><Eye size={10} /> 预览</> : <><Pencil size={10} /> 编辑</>}
              </button>
            </div>

            {editMode ? (
              <textarea
                value={editContent}
                onChange={(e) => setEditContent(e.target.value)}
                className="w-full h-[calc(100%-32px)] text-xs border border-slate-200 rounded px-3 py-2 resize-none focus:outline-none focus:border-blue-400 font-mono bg-white"
              />
            ) : (
              <div
                className="prose prose-sm max-w-none text-slate-700 text-xs leading-relaxed select-text [&>*:first-child]:mt-0 [&>*:last-child]:mb-0 prose-headings:font-bold prose-h1:text-sm prose-h2:text-[13px] prose-h3:text-xs"
                dangerouslySetInnerHTML={{
                  __html: parseAIMarkdown(data.editedContent || data.generatedContent)
                }}
                onClick={handleLinkClick}
              />
            )}
          </div>
        )}

        {!hasContent && !isStreaming && !data.error && (
          <div className="flex flex-col items-center justify-center h-full text-slate-400">
            <Sparkles size={32} className="mb-3 text-blue-300" />
            <p className="text-sm">配置 Prompt 后点击生成</p>
            <p className="text-xs mt-1">Ctrl+Enter 快速生成</p>
          </div>
        )}
      </div>

      {/* Footer */}
      {data.lastGeneratedAt && (
        <div className="px-4 py-1.5 border-t border-slate-100 text-[10px] text-slate-400 shrink-0">
          上次生成: {new Date(data.lastGeneratedAt).toLocaleString('zh-CN')}
        </div>
      )}

      {/* Embedded Note Modal */}
      <NoteModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={modalTitle}
        content={modalContent}
      />
    </div>
  );
});
