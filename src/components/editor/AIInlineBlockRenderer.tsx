import { memo, useState, useCallback, useEffect, useRef } from 'react';
import { Sparkles, ChevronDown, ChevronRight, RefreshCw, Pencil, X, Play, Square, BookOpen, FileCode2 } from 'lucide-react';
import { aiApi } from '../../db/apiClient.ts';
import { useInlineAIGeneration } from './useInlineAIGeneration.ts';
import { PROMPT_TEMPLATES } from '../../constants/promptTemplates.ts';
import { useAICardStore } from '../../stores/aiCardStore.ts';
import type { PromptTemplate } from '../../types/index.ts';

interface AIInlineBlockRendererProps {
  block: any;
  editor: any;
}

// Simple markdown to HTML renderer (matching existing AICardEditor pattern)
function renderMarkdown(text: string): string {
  return text
    .replace(/^### (.+)$/gm, '<h3 class="text-sm font-semibold text-slate-700 mt-3 mb-1">$1</h3>')
    .replace(/^## (.+)$/gm, '<h2 class="text-base font-semibold text-slate-800 mt-4 mb-1.5">$1</h2>')
    .replace(/^# (.+)$/gm, '<h1 class="text-lg font-bold text-slate-900 mt-4 mb-2">$1</h1>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/^[-*] (.+)$/gm, '<li class="ml-4 list-disc text-slate-600">$1</li>')
    .replace(/^(\d+)\. (.+)$/gm, '<li class="ml-4 list-decimal text-slate-600">$2</li>')
    .replace(/\n/g, '<br>');
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
    return encoded; // fallback: return as-is if decode fails
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
  const [editing, setEditing] = useState(!props.generatedContent); // start in edit mode if no content
  const [generatedContent, setGeneratedContent] = useState(
    props.generatedContent ? decodeB64(props.generatedContent) : ''
  );
  const [showTemplates, setShowTemplates] = useState(false);
  const [showSkills, setShowSkills] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const templateRef = useRef<HTMLDivElement>(null);
  const skillRef = useRef<HTMLDivElement>(null);

  // Close dropdowns on outside click
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (templateRef.current && !templateRef.current.contains(e.target as Node)) setShowTemplates(false);
      if (skillRef.current && !skillRef.current.contains(e.target as Node)) setShowSkills(false);
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
        // Save final content to block props
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

  // Keep ref in sync for the status change callback
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

  // Get selected skill content
  const getSkillContent = useCallback(() => {
    if (!selectedSkillId) return undefined;
    const skill = skills.find((s) => s.id === selectedSkillId);
    return skill?.content;
  }, [selectedSkillId, skills]);

  const handleGenerate = useCallback(() => {
    if (!prompt.trim()) return;
    // Save prompt and model to block props
    updateBlockProps({ prompt, model });
    setGeneratedContent('');
    generate(prompt, model, getSkillContent());
  }, [prompt, model, generate, updateBlockProps, getSkillContent]);

  const handleRegenerate = useCallback(() => {
    setCollapsed(false);
    setGeneratedContent('');
    generate(prompt, model, getSkillContent());
  }, [prompt, model, generate, getSkillContent]);

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

  const status = props.status || 'idle';
  const hasContent = !!generatedContent;
  const showInput = editing || status === 'idle' || (status === 'error' && !hasContent);

  return (
    <div
      className="my-2 rounded-lg border border-amber-200 bg-amber-50/40 shadow-sm overflow-hidden"
      contentEditable={false}
      style={{ userSelect: 'none' }}
    >
      {/* Header */}
      <div className="flex items-center gap-1.5 px-3 py-1.5 bg-gradient-to-r from-amber-50 to-rose-50/50 border-b border-amber-200/60">
        <Sparkles size={12} className="text-amber-600 shrink-0" />
        {hasContent && !showInput ? (
          <>
            <span
              className="flex-1 text-[11px] text-slate-600 truncate cursor-pointer select-none"
              onClick={() => setCollapsed(!collapsed)}
              title={prompt}
            >
              {prompt || 'AI 生成块'}
            </span>
            <div className="flex items-center gap-0.5 shrink-0">
              <button
                onClick={() => setCollapsed(!collapsed)}
                className="p-1 rounded hover:bg-amber-100 text-slate-400 hover:text-slate-600 transition-colors"
                title={collapsed ? '展开' : '折叠'}
              >
                {collapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
              </button>
              <button
                onClick={handleRegenerate}
                disabled={isStreaming}
                className="p-1 rounded hover:bg-amber-100 text-slate-400 hover:text-slate-600 transition-colors disabled:opacity-40"
                title="重新生成"
              >
                <RefreshCw size={11} />
              </button>
              <button
                onClick={() => { setEditing(true); setCollapsed(false); }}
                className="p-1 rounded hover:bg-amber-100 text-slate-400 hover:text-slate-600 transition-colors"
                title="编辑 Prompt"
              >
                <Pencil size={11} />
              </button>
              <button
                onClick={handleDelete}
                className="p-1 rounded hover:bg-red-100 text-slate-400 hover:text-red-500 transition-colors"
                title="删除"
              >
                <X size={11} />
              </button>
            </div>
          </>
        ) : (
          <>
            <span className="flex-1 text-[11px] font-medium text-slate-700 select-none">AI 生成块</span>
            <button
              onClick={handleDelete}
              className="p-1 rounded hover:bg-red-100 text-slate-400 hover:text-red-500 transition-colors shrink-0"
              title="删除"
            >
              <X size={11} />
            </button>
          </>
        )}
      </div>

      {/* Input area */}
      {showInput && (
        <div className="px-3 py-2 space-y-2 border-b border-amber-100">
          {/* Prompt template & Skill row */}
          <div className="flex items-center gap-1.5">
            {/* Prompt Template selector */}
            <div className="relative" ref={templateRef}>
              <button
                onClick={() => { setShowTemplates(!showTemplates); setShowSkills(false); }}
                className="flex items-center gap-1 text-[10px] text-slate-500 hover:text-amber-700 px-1.5 py-0.5 rounded hover:bg-amber-50 border border-slate-200 transition-colors"
                title="选择 Prompt 模板"
              >
                <BookOpen size={10} />
                模板
                <ChevronDown size={8} />
              </button>
              {showTemplates && (
                <div className="absolute top-full left-0 mt-1 w-[260px] max-h-[240px] overflow-y-auto bg-white border border-slate-200 rounded-lg shadow-lg z-50">
                  {[...PROMPT_TEMPLATES, ...customTemplates].map((t: PromptTemplate) => (
                    <div
                      key={t.id}
                      className="px-3 py-1.5 hover:bg-amber-50 cursor-pointer border-b border-slate-100 last:border-0"
                      onClick={() => {
                        setPrompt(t.prompt);
                        setShowTemplates(false);
                      }}
                    >
                      <div className="text-[11px] font-medium text-slate-700">{t.name}</div>
                      <div className="text-[9px] text-slate-400 truncate">{t.description}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Skill selector */}
            <div className="relative" ref={skillRef}>
              <button
                onClick={() => { setShowSkills(!showSkills); setShowTemplates(false); }}
                className={`flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded border transition-colors ${
                  selectedSkillId
                    ? 'text-amber-700 bg-amber-50 border-amber-200'
                    : 'text-slate-500 hover:text-amber-700 hover:bg-amber-50 border-slate-200'
                }`}
                title="挂载方法论 (Skill)"
              >
                <FileCode2 size={10} />
                {selectedSkillId ? skills.find(s => s.id === selectedSkillId)?.name || 'Skill' : 'Skill'}
                <ChevronDown size={8} />
              </button>
              {showSkills && (
                <div className="absolute top-full left-0 mt-1 w-[200px] max-h-[200px] overflow-y-auto bg-white border border-slate-200 rounded-lg shadow-lg z-50">
                  <div
                    className="px-3 py-1.5 hover:bg-slate-50 cursor-pointer border-b border-slate-100 text-[10px] text-slate-400"
                    onClick={() => { setSelectedSkillId(undefined); setShowSkills(false); }}
                  >
                    不使用 Skill
                  </div>
                  {skills.length === 0 ? (
                    <div className="px-3 py-2 text-[10px] text-slate-400">
                      暂无 Skill，请在 AI 卡片中上传
                    </div>
                  ) : (
                    skills.map((s) => (
                      <div
                        key={s.id}
                        className={`px-3 py-1.5 hover:bg-amber-50 cursor-pointer border-b border-slate-100 last:border-0 flex items-center gap-1.5 ${
                          selectedSkillId === s.id ? 'bg-amber-50' : ''
                        }`}
                        onClick={() => { setSelectedSkillId(s.id); setShowSkills(false); }}
                      >
                        <FileCode2 size={9} className={selectedSkillId === s.id ? 'text-amber-600' : 'text-slate-400'} />
                        <span className="text-[11px] text-slate-700 truncate">{s.name}</span>
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>
          </div>

          <textarea
            ref={textareaRef}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="输入指令... 可用 {context} 插入笔记内容 (Ctrl+Enter 生成)"
            rows={3}
            className="w-full text-[12px] leading-relaxed text-slate-700 bg-white border border-slate-200 rounded-md px-2.5 py-2 resize-none focus:outline-none focus:border-amber-400 focus:ring-1 focus:ring-amber-400 placeholder-slate-300"
          />
          <div className="flex items-center justify-between gap-2">
            <select
              value={model}
              onChange={(e) => setModel(e.target.value)}
              className="text-[10px] text-slate-600 border border-slate-200 rounded px-2 py-1 bg-white focus:outline-none focus:border-amber-400 max-w-[200px]"
            >
              {models.length > 0 ? (
                models.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))
              ) : (
                <option value={model}>{model || '加载中...'}</option>
              )}
            </select>
            <div className="flex items-center gap-1.5">
              {hasContent && (
                <button
                  onClick={() => setEditing(false)}
                  className="text-[10px] text-slate-500 hover:text-slate-700 px-2 py-1 rounded hover:bg-slate-100 transition-colors"
                >
                  取消
                </button>
              )}
              {isStreaming ? (
                <button
                  onClick={abort}
                  className="flex items-center gap-1 text-[10px] font-medium text-red-600 bg-red-50 border border-red-200 rounded px-2.5 py-1 hover:bg-red-100 transition-colors"
                >
                  <Square size={10} />
                  停止
                </button>
              ) : (
                <button
                  onClick={handleGenerate}
                  disabled={!prompt.trim()}
                  className="flex items-center gap-1 text-[10px] font-medium text-amber-50 bg-rose-900 rounded px-2.5 py-1 hover:bg-rose-800 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <Play size={10} />
                  生成
                </button>
              )}
            </div>
          </div>

          {/* Error message */}
          {status === 'error' && props.errorMessage && (
            <div className="text-[10px] text-red-600 bg-red-50 border border-red-200 rounded px-2 py-1">
              {props.errorMessage}
            </div>
          )}
        </div>
      )}

      {/* Streaming indicator */}
      {isStreaming && (
        <div className="flex items-center gap-1.5 px-3 py-1 text-[10px] text-amber-600 border-b border-amber-100">
          <div className="w-1.5 h-1.5 bg-amber-500 rounded-full animate-pulse" />
          正在生成...
        </div>
      )}

      {/* Generated content */}
      {hasContent && !collapsed && (
        <div className="px-3 py-2.5">
          <div
            className="text-[12px] leading-relaxed text-slate-700 prose prose-sm max-w-none
              [&_h1]:text-base [&_h1]:font-bold [&_h1]:text-slate-900 [&_h1]:mt-3 [&_h1]:mb-1
              [&_h2]:text-sm [&_h2]:font-semibold [&_h2]:text-slate-800 [&_h2]:mt-2.5 [&_h2]:mb-1
              [&_h3]:text-[13px] [&_h3]:font-semibold [&_h3]:text-slate-700 [&_h3]:mt-2 [&_h3]:mb-0.5
              [&_li]:text-slate-600 [&_strong]:text-slate-800"
            dangerouslySetInnerHTML={{ __html: renderMarkdown(generatedContent) }}
          />
        </div>
      )}

      {/* Collapsed indicator */}
      {hasContent && collapsed && (
        <div
          className="px-3 py-1.5 text-[10px] text-slate-400 cursor-pointer hover:text-slate-600 hover:bg-amber-50 transition-colors"
          onClick={() => setCollapsed(false)}
        >
          点击展开内容...
        </div>
      )}
    </div>
  );
});
