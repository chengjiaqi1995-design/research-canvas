import { memo, useState, useCallback, useEffect, useRef } from 'react';
import { Sparkles, ChevronDown, ChevronRight, RefreshCw, Pencil, X, Play, Square, BookOpen, FileCode2, Database } from 'lucide-react';
import { Popover } from 'antd';
import { aiApi } from '../../db/apiClient.ts';
import { useInlineAIGeneration } from './useInlineAIGeneration.ts';
import { PROMPT_TEMPLATES } from '../../constants/promptTemplates.ts';
import { useAICardStore } from '../../stores/aiCardStore.ts';
import { SourceFolderPicker } from '../ai/SourceFolderPicker.tsx';
import type { PromptTemplate } from '../../types/index.ts';
import { NoteModal } from '../detail/NoteModal.tsx';
import { useCanvasStore } from '../../stores/canvasStore.ts';
import { parseAIMarkdown } from '../../utils/markdownParser.ts';

interface AIInlineBlockRendererProps {
  block: any;
  editor: any;
}



// Base64 encode/decode helpers
export function encodeB64(text: string): string {
  try {
    return btoa(encodeURIComponent(text));
  } catch {
    return '';
  }
}

export function decodeB64(encoded: string): string {
  try {
    return decodeURIComponent(atob(encoded));
  } catch {
    return encoded;
  }
}

export const AIInlineBlockRenderer = memo(function AIInlineBlockRenderer({
  block,
  editor,
}: AIInlineBlockRendererProps) {
  const props = block.props;
  const blockId = props.blockId || '';

  // Skill store
  const skills = useAICardStore((s) => s.skills);
  const customTemplates = useAICardStore((s) => s.customTemplates || []);

  // Local state
  const [prompt, setPrompt] = useState(props.prompt || '');
  const [model, setModel] = useState(props.model || '');
  const [models, setModels] = useState<{ id: string; name: string }[]>([]);
  const [selectedSkillId, setSelectedSkillId] = useState<string | undefined>(undefined);
  const [collapsed, setCollapsed] = useState(props.collapsed === 'true');
  const [editing, setEditing] = useState(!props.generatedContent);
  const [generatedContent, setGeneratedContent] = useState(
    props.generatedContent ? decodeB64(props.generatedContent) : ''
  );
  const [showTemplates, setShowTemplates] = useState(false);
  const [showSkills, setShowSkills] = useState(false);

  // Note Modal state
  const nodes = useCanvasStore((s) => s.nodes);
  const [modalOpen, setModalOpen] = useState(false);
  const [modalTitle, setModalTitle] = useState('');
  const [modalContent, setModalContent] = useState('');

  // Source filtering state
  const [sourceWorkspaceIds, setSourceWorkspaceIds] = useState<string[]>(() => {
    try { return JSON.parse(props.sourceWorkspaceIds || '[]'); } catch { return []; }
  });
  const [sourceCanvasIds, setSourceCanvasIds] = useState<string[]>(() => {
    try { return JSON.parse(props.sourceCanvasIds || '[]'); } catch { return []; }
  });
  const [sourceDateFrom, setSourceDateFrom] = useState(props.sourceDateFrom || '');
  const [sourceDateTo, setSourceDateTo] = useState(props.sourceDateTo || '');
  const [sourceDateField, setSourceDateField] = useState<'occurred' | 'created'>((props.sourceDateField as any) || 'occurred');
  const [showSourcePicker, setShowSourcePicker] = useState(false);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const templateRef = useRef<HTMLDivElement>(null);
  const skillRef = useRef<HTMLDivElement>(null);
  const sourceRef = useRef<HTMLDivElement>(null);

  // Close dropdowns on outside click
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (templateRef.current && !templateRef.current.contains(e.target as Node)) setShowTemplates(false);
      if (skillRef.current && !skillRef.current.contains(e.target as Node)) setShowSkills(false);
      if (sourceRef.current && !sourceRef.current.contains(e.target as Node)) setShowSourcePicker(false);
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  // Load available models
  useEffect(() => {
    aiApi.getModels().then(setModels).catch(console.error);
  }, []);

  // Set default model to gemini-3-flash-preview
  useEffect(() => {
    if (!model && models.length > 0) {
      const defaultModel = models.find((m) => m.id === 'gemini-3-flash-preview');
      setModel(defaultModel ? defaultModel.id : models[0].id);
    }
  }, [model, models]);

  // Update block props helper
  const updateBlockProps = useCallback(
    (updates: Record<string, string>) => {
      try {
        editor.updateBlock(block, { props: updates });
      } catch (err) {
        console.warn('Failed to update block props:', err);
      }
    },
    [editor, block]
  );

  const handleContentUpdate = useCallback(
    (content: string) => {
      setGeneratedContent(content);
    },
    []
  );

  const handleStatusChange = useCallback(
    (status: 'idle' | 'generating' | 'done' | 'error', errorMessage?: string) => {
      const updates: Record<string, string> = { status };
      if (status === 'done') {
        const finalContent = generatedContentRef.current;
        updates.generatedContent = encodeB64(finalContent);
        updates.lastGeneratedAt = new Date().toISOString();
        setEditing(false);
      }
      if (status === 'error' && errorMessage) {
        updates.errorMessage = errorMessage;
      }
      updateBlockProps(updates);
    },
    [updateBlockProps]
  );

  const generatedContentRef = useRef(generatedContent);
  useEffect(() => {
    generatedContentRef.current = generatedContent;
  }, [generatedContent]);

  const { generate, abort, isStreaming } = useInlineAIGeneration({
    editor,
    blockId,
    onContentUpdate: handleContentUpdate,
    onStatusChange: handleStatusChange,
  });

  const getSkillContent = useCallback(() => {
    if (!selectedSkillId) return undefined;
    const skill = skills.find((s) => s.id === selectedSkillId);
    return skill?.content;
  }, [selectedSkillId, skills]);

  const handleGenerate = useCallback(() => {
    if (!prompt.trim()) return;
    updateBlockProps({ 
      prompt, 
      model,
      sourceWorkspaceIds: JSON.stringify(sourceWorkspaceIds),
      sourceCanvasIds: JSON.stringify(sourceCanvasIds),
      sourceDateFrom,
      sourceDateTo,
      sourceDateField,
    });
    setGeneratedContent('');
    generate(prompt, model, getSkillContent(), {
      sourceWorkspaceIds, sourceCanvasIds, sourceDateFrom, sourceDateTo, sourceDateField
    });
  }, [prompt, model, generate, updateBlockProps, getSkillContent, sourceWorkspaceIds, sourceCanvasIds, sourceDateFrom, sourceDateTo, sourceDateField]);

  const handleRegenerate = useCallback(() => {
    setCollapsed(false);
    setGeneratedContent('');
    generate(prompt, model, getSkillContent(), {
      sourceWorkspaceIds, sourceCanvasIds, sourceDateFrom, sourceDateTo, sourceDateField
    });
  }, [prompt, model, generate, getSkillContent, sourceWorkspaceIds, sourceCanvasIds, sourceDateFrom, sourceDateTo, sourceDateField]);

  const handleDelete = useCallback(() => {
    if (isStreaming) abort();
    editor.removeBlocks([block]);
  }, [editor, block, isStreaming, abort]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        e.stopPropagation();
        handleGenerate();
      }
    },
    [handleGenerate]
  );

  const handleLinkClick = useCallback((e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    if (target.classList.contains('ref-link')) {
      e.preventDefault();
      e.stopPropagation();

      // Handle [REFx] by searching for its title in the content
      const refIdxStr = target.getAttribute('data-ref');
      if (refIdxStr) {
        const refPattern = new RegExp(`\\[REF${refIdxStr}\\][\\s:]+([^\\n]+)`);
        const titleMatch = generatedContent.match(refPattern) || 
                           (props.prompt && props.prompt.match(refPattern));
        const inferredTitle = titleMatch ? titleMatch[1].trim() : '';
        
        // 1. Try local match
        if (inferredTitle) {
          const matched = nodes.find(n => n.data.title === inferredTitle) || 
                          nodes.find(n => n.data.title && n.data.title.includes(inferredTitle));
          if (matched) {
            setModalTitle(matched.data.title || '');
            setModalContent((matched.data as any).content || '');
            setModalOpen(true);
            return;
          }
        }

        // 2. Fallback to API query dynamically using block props
        const doAsyncFetch = async () => {
          setModalTitle(`正在获取引用 ${refIdxStr}...`);
          setModalContent('<div class="flex justify-center p-8"><div class="animate-spin w-6 h-6 border-2 border-violet-500 border-t-transparent rounded-full"></div></div>');
          setModalOpen(true);

          try {
            const { notesApi } = await import('../../db/apiClient.ts');
            const parsedWorkspaces = JSON.parse(props.sourceWorkspaceIds || '[]');
            const parsedCanvases = JSON.parse(props.sourceCanvasIds || '[]');
            
            // Only query if we actually have filters set
            if (parsedWorkspaces.length > 0 || parsedCanvases.length > 0 || props.sourceDateFrom || props.sourceDateTo) {
              const result = await notesApi.query(
                parsedWorkspaces,
                parsedCanvases,
                props.sourceDateFrom,
                props.sourceDateTo,
                (props.sourceDateField as any) || 'occurred'
              );
              const idx = parseInt(refIdxStr, 10) - 1;
              const note = result.notes[idx];
              if (note) {
                setModalTitle(note.title || `参考资料 ${refIdxStr}`);
                setModalContent(note.content || '暂无内容');
                return;
              }
            } else {
              // Local context fallback block analysis
               const otherBlocks = editor.document.filter(
                (b: any) => !(b.type === 'aiInline' && b.props?.blockId === props.blockId)
              );
              if (otherBlocks.length > 0) {
                 const html = await editor.blocksToHTMLLossy(otherBlocks);
                 setModalTitle('当前画布附带内容');
                 setModalContent(html || '');
                 return;
              }
            }
          } catch (err) {
            console.error('Failed to query note for ref:', err);
          }
          
          // Final fallback
          setModalTitle(inferredTitle || `参考资料 ${refIdxStr}`);
          setModalContent(`<p class="text-slate-500 py-4 text-center">系统未能自动定位到此引用对应的具体笔记节点。<br/><br/>这可能是一个通过外部 Web 检索临时获得的文献，或当前引用的内容并未包含在您的源数据中。</p>`);
        };
        doAsyncFetch();
        return;
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
  }, [nodes, generatedContent, props, editor]);

  const status = props.status || 'idle';
  const hasContent = !!generatedContent;
  const showInput = editing || status === 'idle' || (status === 'error' && !hasContent);
  const displayTitle = prompt || 'AI 生成块';

  return (
    <div
      className="my-1.5 rounded-lg border border-slate-200 bg-white shadow-[0_1px_3px_rgba(0,0,0,0.04)]"
      contentEditable={false}
    >
      {/* Header bar - always visible */}
      <div
        className={`flex items-center gap-1.5 px-2.5 py-1 border-b border-slate-100 ${
          hasContent && !showInput ? 'cursor-pointer hover:bg-slate-50/80' : ''
        }`}
        onClick={hasContent && !showInput ? () => setCollapsed(!collapsed) : undefined}
      >
        <Sparkles size={11} className="text-indigo-500 shrink-0" />

        {hasContent && !showInput ? (
          <>
            <span className="flex-1 text-[11px] font-medium text-slate-600 truncate select-none" title={prompt}>
              {displayTitle}
            </span>
            {collapsed ? <ChevronRight size={11} className="text-slate-400 shrink-0" /> : <ChevronDown size={11} className="text-slate-400 shrink-0" />}
            <button
              onClick={(e) => { e.stopPropagation(); handleRegenerate(); }}
              disabled={isStreaming}
              className="p-0.5 rounded hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition-colors disabled:opacity-40"
              title="重新生成"
            >
              <RefreshCw size={10} />
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); setEditing(true); setCollapsed(false); }}
              className="p-0.5 rounded hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition-colors"
              title="编辑 Prompt"
            >
              <Pencil size={10} />
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); handleDelete(); }}
              className="p-0.5 rounded hover:bg-red-50 text-slate-400 hover:text-red-500 transition-colors"
              title="删除"
            >
              <X size={10} />
            </button>
          </>
        ) : (
          <>
            <span className="flex-1 text-[11px] font-medium text-slate-600 select-none">AI 生成块</span>
            <button
              onClick={handleDelete}
              className="p-0.5 rounded hover:bg-red-50 text-slate-400 hover:text-red-500 transition-colors shrink-0"
              title="删除"
            >
              <X size={10} />
            </button>
          </>
        )}
      </div>

      {/* Input area */}
      {showInput && (
        <div className="px-2.5 py-2 space-y-1.5 bg-slate-50/50">
          {/* Toolbar row: Template, Skill, Model, Generate */}
          <div className="flex items-center gap-1">
            {/* Prompt Template selector */}
            <Popover
              content={
                <div className="w-[260px] max-h-[240px] overflow-y-auto custom-scrollbar">
                  {[...PROMPT_TEMPLATES, ...customTemplates].map((t: PromptTemplate) => (
                    <div
                      key={t.id}
                      className="px-3 py-1.5 hover:bg-indigo-50 cursor-pointer border-b border-slate-50 last:border-0"
                      onClick={() => { setPrompt(t.prompt); setShowTemplates(false); }}
                    >
                      <div className="text-[11px] font-medium text-slate-700">{t.name}</div>
                      <div className="text-[9px] text-slate-400 truncate">{t.description}</div>
                    </div>
                  ))}
                </div>
              }
              trigger="click"
              open={showTemplates}
              onOpenChange={(v) => { setShowTemplates(v); if(v){setShowSkills(false);setShowSourcePicker(false)} }}
              placement="bottomLeft"
              overlayInnerStyle={{ padding: 0 }}
              arrow={false}
            >
              <button
                className={`flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded border transition-colors ${
                  showTemplates ? 'text-indigo-600 bg-indigo-50 border-indigo-200' : 'text-slate-500 hover:text-indigo-600 hover:bg-indigo-50 border-slate-200'
                }`}
                title="选择 Prompt 模板"
              >
                <BookOpen size={9} />
                模板
                <ChevronDown size={7} />
              </button>
            </Popover>

            {/* Skill selector */}
            <Popover
              content={
                <div className="w-[200px] max-h-[200px] overflow-y-auto custom-scrollbar">
                  <div
                    className="px-3 py-1.5 hover:bg-slate-50 cursor-pointer border-b border-slate-100 text-[10px] text-slate-400"
                    onClick={() => { setSelectedSkillId(undefined); setShowSkills(false); }}
                  >
                    不使用 Skill
                  </div>
                  {skills.length === 0 ? (
                    <div className="px-3 py-2 text-[10px] text-slate-400">暂无 Skill</div>
                  ) : (
                    skills.map((s) => (
                      <div
                        key={s.id}
                        className={`px-3 py-1.5 hover:bg-indigo-50 cursor-pointer border-b border-slate-50 last:border-0 flex items-center gap-1.5 ${
                          selectedSkillId === s.id ? 'bg-indigo-50' : ''
                        }`}
                        onClick={() => { setSelectedSkillId(s.id); setShowSkills(false); }}
                      >
                        <FileCode2 size={9} className={selectedSkillId === s.id ? 'text-indigo-500' : 'text-slate-400'} />
                        <span className="text-[11px] text-slate-700 truncate">{s.name}</span>
                      </div>
                    ))
                  )}
                </div>
              }
              trigger="click"
              open={showSkills}
              onOpenChange={(v) => { setShowSkills(v); if(v){setShowTemplates(false);setShowSourcePicker(false)} }}
              placement="bottomLeft"
              overlayInnerStyle={{ padding: 0 }}
              arrow={false}
            >
              <button
                className={`flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded border transition-colors ${
                  selectedSkillId
                    ? 'text-indigo-600 bg-indigo-50 border-indigo-200'
                    : 'text-slate-500 hover:text-indigo-600 hover:bg-indigo-50 border-slate-200'
                }`}
                title="挂载方法论 (Skill)"
              >
                <FileCode2 size={9} />
                {selectedSkillId ? skills.find(s => s.id === selectedSkillId)?.name || 'Skill' : 'Skill'}
                <ChevronDown size={7} />
              </button>
            </Popover>

            {/* Source Config selector */}
            <Popover
              content={
                <div className="w-[420px] max-h-[400px] overflow-y-auto custom-scrollbar p-3 bg-slate-50/50">
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
                     onChangeDateField={setSourceDateField as any}
                   />
                </div>
              }
              trigger="click"
              open={showSourcePicker}
              onOpenChange={(v) => { setShowSourcePicker(v); if(v){setShowTemplates(false);setShowSkills(false)} }}
              placement="bottomLeft"
              overlayInnerStyle={{ padding: 0 }}
              arrow={false}
            >
              <button
                className={`flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded border transition-colors ${
                  sourceWorkspaceIds.length > 0 || sourceDateFrom || sourceDateTo
                    ? 'text-indigo-600 bg-indigo-50 border-indigo-200'
                    : 'text-slate-500 hover:text-indigo-600 hover:bg-indigo-50 border-slate-200'
                }`}
                title="数据源配置"
              >
                <Database size={9} />
                {sourceWorkspaceIds.length > 0 ? `数据源 (${sourceWorkspaceIds.length})` : '数据源'}
                <ChevronDown size={7} />
              </button>
            </Popover>

            {/* Spacer */}
            <div className="flex-1" />

            {/* Model selector */}
            <select
              value={model}
              onChange={(e) => setModel(e.target.value)}
              className="text-[10px] text-slate-500 border border-slate-200 rounded px-1.5 py-0.5 bg-white focus:outline-none focus:border-indigo-400 max-w-[160px]"
            >
              {models.length > 0 ? (
                models.map((m) => (
                  <option key={m.id} value={m.id}>{m.name}</option>
                ))
              ) : (
                <option value={model}>{model || '...'}</option>
              )}
            </select>

            {/* Cancel / Generate / Stop */}
            {hasContent && (
              <button
                onClick={() => setEditing(false)}
                className="text-[10px] text-slate-400 hover:text-slate-600 px-1.5 py-0.5 rounded hover:bg-slate-100 transition-colors"
              >
                取消
              </button>
            )}
            {isStreaming ? (
              <button
                onClick={abort}
                className="flex items-center gap-1 text-[10px] font-medium text-red-600 bg-red-50 border border-red-200 rounded px-2 py-0.5 hover:bg-red-100 transition-colors"
              >
                <Square size={9} />
                停止
              </button>
            ) : (
              <button
                onClick={handleGenerate}
                disabled={!prompt.trim()}
                className="flex items-center gap-1 text-[10px] font-medium text-white bg-indigo-600 rounded px-2.5 py-0.5 hover:bg-indigo-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <Play size={9} />
                生成
              </button>
            )}
          </div>

          <textarea
            ref={textareaRef}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="输入指令... 可用 {context} 插入笔记内容 (Ctrl+Enter 生成)"
            rows={2}
            className="w-full text-[11px] leading-normal text-slate-700 bg-white border border-slate-200 rounded px-2 py-1.5 resize-none focus:outline-none focus:border-indigo-400 focus:ring-1 focus:ring-indigo-400/30 placeholder-slate-300"
          />

          {status === 'error' && props.errorMessage && (
            <div className="text-[10px] text-red-600 bg-red-50 border border-red-200 rounded px-2 py-1">
              {props.errorMessage}
            </div>
          )}
        </div>
      )}

      {/* Streaming indicator */}
      {isStreaming && (
        <div className="flex items-center gap-1.5 px-2.5 py-1 text-[10px] text-indigo-500 bg-indigo-50/50">
          <div className="w-1.5 h-1.5 bg-indigo-500 rounded-full animate-pulse" />
          正在生成...
        </div>
      )}

      {/* Generated content - expanded */}
      {hasContent && !collapsed && (
        <div
          className="px-3 py-2 text-[12px] leading-[1.6] text-slate-700 select-text prose prose-sm max-w-none [&>*:first-child]:mt-0 [&>*:last-child]:mb-0 prose-headings:font-bold prose-h1:text-[14px] prose-h2:text-[13px] prose-h3:text-[12px] prose-p:my-1.5 prose-ul:my-1.5 prose-li:my-0.5"
          dangerouslySetInnerHTML={{ __html: parseAIMarkdown(generatedContent) }}
          onClick={handleLinkClick}
        />
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
