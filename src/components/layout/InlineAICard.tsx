import { memo, useState, useCallback, useEffect } from 'react';
import { Sparkles, Play, Square, RefreshCw, Pencil, Eye, ChevronDown, ChevronRight, Globe, FileText, Layers, Trash2, Settings } from 'lucide-react';
import { useCanvasStore } from '../../stores/canvasStore.ts';
import { useAICardGeneration } from '../../hooks/useAICardGeneration.ts';
import { SourceNodePicker } from '../detail/SourceNodePicker.tsx';
import { PromptTemplateSelector } from '../detail/PromptTemplateSelector.tsx';
import type { AICardNodeData, AICardSourceMode, PromptTemplate } from '../../types/index.ts';

interface InlineAICardProps {
  nodeId: string;
  data: AICardNodeData;
}

export const InlineAICard = memo(function InlineAICard({ nodeId, data }: InlineAICardProps) {
  const updateNodeData = useCanvasStore((s) => s.updateNodeData);
  const removeNode = useCanvasStore((s) => s.removeNode);
  const { generate, stop, isStreaming } = useAICardGeneration(nodeId);

  const [title, setTitle] = useState(data.title);
  const [prompt, setPrompt] = useState(data.prompt);
  const [model, setModel] = useState(data.config.model);
  const [sourceMode, setSourceMode] = useState<AICardSourceMode>(data.config.sourceMode);
  const [sourceNodeIds, setSourceNodeIds] = useState<string[]>(data.config.sourceNodeIds);
  const [configOpen, setConfigOpen] = useState(!data.generatedContent);
  const [contentExpanded, setContentExpanded] = useState(true);
  const [editMode, setEditMode] = useState(false);
  const [editContent, setEditContent] = useState(data.editedContent);
  const [models, setModels] = useState<Array<{ id: string; name: string }>>([]);

  useEffect(() => {
    import('../../db/apiClient.ts').then(({ aiApi }) => {
      aiApi.getModels().then(setModels).catch(() => {});
    });
  }, []);

  const handleSaveTitle = useCallback(() => {
    if (title.trim() && title !== data.title) {
      updateNodeData(nodeId, { title: title.trim() });
    }
  }, [title, data.title, nodeId, updateNodeData]);

  const saveConfig = useCallback(() => {
    updateNodeData(nodeId, {
      prompt,
      config: { ...data.config, model, sourceMode, sourceNodeIds },
    } as Partial<AICardNodeData>);
  }, [nodeId, prompt, model, sourceMode, sourceNodeIds, data.config, updateNodeData]);

  const handleGenerate = useCallback(() => {
    saveConfig();
    setTimeout(() => generate(), 50);
  }, [saveConfig, generate]);

  const handleTemplateSelect = useCallback((tpl: PromptTemplate) => {
    setPrompt(tpl.prompt);
    if (!title || title === 'AI 卡片') setTitle(tpl.name);
  }, [title]);

  const handleSaveEdit = useCallback(() => {
    updateNodeData(nodeId, { editedContent: editContent } as Partial<AICardNodeData>);
    setEditMode(false);
  }, [nodeId, editContent, updateNodeData]);

  useEffect(() => {
    if (isStreaming) setEditContent(data.editedContent);
  }, [data.editedContent, isStreaming]);

  const handleDelete = useCallback(() => {
    if (confirm('删除此 AI 卡片？')) removeNode(nodeId);
  }, [nodeId, removeNode]);

  const sourceModeOptions: { value: AICardSourceMode; label: string; icon: typeof FileText }[] = [
    { value: 'notes', label: '仅笔记', icon: FileText },
    { value: 'web', label: '仅联网', icon: Globe },
    { value: 'notes_web', label: '笔记+联网', icon: Layers },
  ];

  const hasContent = !!(data.generatedContent || data.editedContent);

  return (
    <div className="mx-2 my-2 border border-violet-200 rounded-lg bg-violet-50/30 overflow-hidden">
      {/* Card header */}
      <div className="flex items-center gap-2 px-3 py-2 bg-violet-50 border-b border-violet-100">
        <button
          onClick={() => setContentExpanded(!contentExpanded)}
          className="text-violet-400 hover:text-violet-600 shrink-0"
        >
          {contentExpanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        </button>
        <Sparkles size={13} className="text-violet-500 shrink-0" />
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={handleSaveTitle}
          onKeyDown={(e) => e.key === 'Enter' && handleSaveTitle()}
          className="flex-1 text-xs font-medium text-slate-700 bg-transparent border-none outline-none"
          placeholder="卡片标题..."
        />

        {/* Action buttons */}
        <div className="flex items-center gap-0.5 shrink-0">
          <button
            onClick={() => setConfigOpen(!configOpen)}
            className={`p-1 rounded transition-colors ${configOpen ? 'text-violet-600 bg-violet-100' : 'text-slate-400 hover:text-violet-500'}`}
            title="配置"
          >
            <Settings size={12} />
          </button>
          {isStreaming ? (
            <button onClick={stop} className="p-1 rounded text-red-500 hover:bg-red-50" title="停止">
              <Square size={12} />
            </button>
          ) : (
            <button
              onClick={handleGenerate}
              disabled={!prompt.trim()}
              className="p-1 rounded text-violet-500 hover:bg-violet-100 disabled:opacity-30 disabled:cursor-not-allowed"
              title="生成"
            >
              <Play size={12} />
            </button>
          )}
          {hasContent && !isStreaming && (
            <button onClick={handleGenerate} className="p-1 rounded text-slate-400 hover:text-violet-500" title="重新生成">
              <RefreshCw size={11} />
            </button>
          )}
          <button onClick={handleDelete} className="p-1 rounded text-slate-300 hover:text-red-400" title="删除卡片">
            <Trash2 size={11} />
          </button>
        </div>
      </div>

      {/* Expanded content */}
      {contentExpanded && (
        <div>
          {/* Config panel */}
          {configOpen && (
            <div className="px-3 py-2 border-b border-violet-100 space-y-2 bg-white/50">
              {/* Model */}
              <div className="flex items-center gap-2">
                <label className="text-[10px] font-medium text-slate-500 w-12 shrink-0">模型</label>
                <select
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                  className="flex-1 text-xs border border-slate-200 rounded px-2 py-1 bg-white focus:outline-none focus:border-violet-400"
                >
                  {models.length > 0 ? models.map((m) => (
                    <option key={m.id} value={m.id}>{m.name}</option>
                  )) : (
                    <option value={model}>{model}</option>
                  )}
                </select>
              </div>

              {/* Source mode */}
              <div className="flex items-center gap-2">
                <label className="text-[10px] font-medium text-slate-500 w-12 shrink-0">来源</label>
                <div className="flex gap-1">
                  {sourceModeOptions.map((opt) => {
                    const Icon = opt.icon;
                    return (
                      <button
                        key={opt.value}
                        onClick={() => setSourceMode(opt.value)}
                        className={`flex items-center gap-1 px-2 py-0.5 text-[10px] rounded transition-colors ${
                          sourceMode === opt.value
                            ? 'bg-violet-100 text-violet-700 border border-violet-300'
                            : 'bg-slate-100 text-slate-500 border border-transparent hover:bg-slate-200'
                        }`}
                      >
                        <Icon size={10} />
                        {opt.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Source node picker */}
              {sourceMode !== 'web' && (
                <SourceNodePicker selectedIds={sourceNodeIds} onChange={setSourceNodeIds} />
              )}

              {/* Prompt */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-[10px] font-medium text-slate-500">Prompt</label>
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
                  placeholder="输入指令... (Ctrl+Enter 生成)"
                  className="w-full h-20 text-xs border border-slate-200 rounded px-2 py-1.5 resize-y focus:outline-none focus:border-violet-400 bg-white"
                />
              </div>

              {/* Generate button */}
              <div className="flex items-center gap-2">
                {isStreaming ? (
                  <button onClick={stop} className="flex items-center gap-1 px-2.5 py-1 text-[10px] font-medium bg-red-500 text-white rounded hover:bg-red-600">
                    <Square size={10} /> 停止
                  </button>
                ) : (
                  <button
                    onClick={handleGenerate}
                    disabled={!prompt.trim()}
                    className="flex items-center gap-1 px-2.5 py-1 text-[10px] font-medium bg-violet-600 text-white rounded hover:bg-violet-700 disabled:opacity-50"
                  >
                    <Play size={10} /> 生成
                  </button>
                )}
              </div>
            </div>
          )}

          {/* Output */}
          <div className="px-3 py-2">
            {data.error && (
              <div className="mb-2 px-2 py-1.5 bg-red-50 border border-red-200 rounded text-[10px] text-red-600">
                {data.error}
              </div>
            )}

            {isStreaming && (
              <div className="flex items-center gap-2 mb-2 text-[10px] text-violet-500">
                <div className="w-1.5 h-1.5 bg-violet-500 rounded-full animate-pulse" />
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
                        setEditContent(data.editedContent || data.generatedContent);
                        setEditMode(true);
                      }
                    }}
                    className="flex items-center gap-1 text-[10px] text-slate-400 hover:text-violet-500"
                  >
                    {editMode ? <><Eye size={9} /> 预览</> : <><Pencil size={9} /> 编辑</>}
                  </button>
                </div>

                {editMode ? (
                  <textarea
                    value={editContent}
                    onChange={(e) => setEditContent(e.target.value)}
                    className="w-full h-40 text-xs border border-slate-200 rounded px-2 py-1.5 resize-y focus:outline-none focus:border-violet-400 font-mono bg-white"
                  />
                ) : (
                  <div
                    className="prose prose-sm max-w-none text-slate-700 text-xs leading-relaxed"
                    dangerouslySetInnerHTML={{
                      __html: (data.editedContent || data.generatedContent)
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

            {!hasContent && !isStreaming && !data.error && !configOpen && (
              <div className="flex items-center gap-2 text-xs text-slate-400 py-2">
                <Sparkles size={12} className="text-violet-300" />
                点击 ⚙️ 配置后生成
              </div>
            )}
          </div>

          {data.lastGeneratedAt && (
            <div className="px-3 py-1 border-t border-violet-100 text-[10px] text-slate-400">
              {new Date(data.lastGeneratedAt).toLocaleString('zh-CN')}
            </div>
          )}
        </div>
      )}
    </div>
  );
});
