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

// Improved markdown to HTML renderer with tighter spacing
function renderMarkdown(text: string): string {
  // Normalize line endings
  let html = text.replace(/\r\n/g, '\n');

  // Code blocks (```)
  html = html.replace(/```(\w*)\n([\s\S]*?)```/g,
    '<pre style="background:#f8f9fa;border:1px solid #e2e8f0;border-radius:4px;padding:8px 10px;margin:6px 0;overflow-x:auto;font-size:11px;line-height:1.5"><code>$2</code></pre>');

  // Headings
  html = html.replace(/^#### (.+)$/gm, '<h4 style="font-size:13px;font-weight:600;color:#334155;margin:8px 0 2px">$1</h4>');
  html = html.replace(/^### (.+)$/gm, '<h3 style="font-size:13px;font-weight:600;color:#334155;margin:10px 0 3px">$1</h3>');
  html = html.replace(/^## (.+)$/gm, '<h2 style="font-size:14px;font-weight:600;color:#1e293b;margin:12px 0 4px">$1</h2>');
  html = html.replace(/^# (.+)$/gm, '<h1 style="font-size:15px;font-weight:700;color:#0f172a;margin:12px 0 4px">$1</h1>');

  // Bold & italic
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong style="color:#1e293b">$1</strong>');
  html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');
  // Inline code
  html = html.replace(/`([^`]+)`/g, '<code style="background:#f1f5f9;padding:1px 4px;border-radius:3px;font-size:11px">$1</code>');

  // Lists: convert consecutive list items into proper ul/ol
  // Unordered
  html = html.replace(/(^[-*] .+$(\n|$))+/gm, (match) => {
    const items = match.trim().split('\n').map(line => {
      const content = line.replace(/^[-*] /, '');
      return `<li style="margin:1px 0;padding-left:2px">${content}</li>`;
    }).join('');
    return `<ul style="margin:4px 0;padding-left:18px;list-style:disc">${items}</ul>`;
  });
  // Ordered
  html = html.replace(/(^\d+\. .+$(\n|$))+/gm, (match) => {
    const items = match.trim().split('\n').map(line => {
      const content = line.replace(/^\d+\. /, '');
      return `<li style="margin:1px 0;padding-left:2px">${content}</li>`;
    }).join('');
    return `<ol style="margin:4px 0;padding-left:18px;list-style:decimal">${items}</ol>`;
  });

  // Blockquotes
  html = html.replace(/^> (.+)$/gm, '<blockquote style="border-left:3px solid #cbd5e1;padding-left:10px;margin:4px 0;color:#64748b;font-style:italic">$1</blockquote>');

  // Horizontal rules
  html = html.replace(/^---$/gm, '<hr style="border:none;border-top:1px solid #e2e8f0;margin:8px 0">');

  // Paragraphs: replace double newlines with paragraph breaks, single newlines within text
  html = html.replace(/\n\n+/g, '</p><p style="margin:4px 0">');
  html = html.replace(/\n/g, '<br>');

  // Wrap in paragraph
  html = `<p style="margin:0">${html}</p>`;

  // Clean up empty paragraphs
  html = html.replace(/<p style="margin:(?:0|4px 0)">\s*<\/p>/g, '');
  // Clean up br after block elements
  html = html.replace(/(<\/(?:h[1-4]|ul|ol|pre|blockquote|hr)>)<br>/g, '$1');
  html = html.replace(/<br>(<(?:h[1-4]|ul|ol|pre|blockquote|hr))/g, '$1');

  return html;
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
  const displayTitle = prompt || 'AI 生成块';

  return (
    <div
      className="my-1.5 rounded border border-slate-200 bg-white shadow-[0_1px_3px_rgba(0,0,0,0.04)] overflow-hidden"
      contentEditable={false}
      style={{ userSelect: 'none' }}
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
            <div className="relative" ref={templateRef}>
              <button
                onClick={() => { setShowTemplates(!showTemplates); setShowSkills(false); }}
                className="flex items-center gap-1 text-[10px] text-slate-500 hover:text-indigo-600 px-1.5 py-0.5 rounded hover:bg-indigo-50 border border-slate-200 transition-colors"
                title="选择 Prompt 模板"
              >
                <BookOpen size={9} />
                模板
                <ChevronDown size={7} />
              </button>
              {showTemplates && (
                <div className="absolute top-full left-0 mt-1 w-[260px] max-h-[240px] overflow-y-auto bg-white border border-slate-200 rounded-lg shadow-lg z-50">
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
              )}
            </div>

            {/* Skill selector */}
            <div className="relative" ref={skillRef}>
              <button
                onClick={() => { setShowSkills(!showSkills); setShowTemplates(false); }}
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
              {showSkills && (
                <div className="absolute top-full left-0 mt-1 w-[200px] max-h-[200px] overflow-y-auto bg-white border border-slate-200 rounded-lg shadow-lg z-50">
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
              )}
            </div>

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
          className="px-3 py-2 text-[12px] leading-[1.6] text-slate-700"
          dangerouslySetInnerHTML={{ __html: renderMarkdown(generatedContent) }}
        />
      )}
    </div>
  );
});
