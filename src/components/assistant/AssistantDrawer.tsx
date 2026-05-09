import { memo, useEffect, useMemo, useRef, useState } from 'react';
import {
  Bot,
  Check,
  ChevronRight,
  CircleStop,
  Database,
  ExternalLink,
  Globe2,
  MessageCircle,
  Search,
  Send,
  Sparkles,
  TrendingUp,
  X,
} from 'lucide-react';
import { useAssistantStore } from '../../stores/assistantStore.ts';
import { useAICardStore, type AppViewMode } from '../../stores/aiCardStore.ts';
import { useWorkspaceStore } from '../../stores/workspaceStore.ts';
import { useAuthStore } from '../../stores/authStore.ts';
import { useMobile } from '../../hooks/useMobile.ts';
import type { AssistantExternalSourceKey, AssistantSource, AssistantSourceKey } from '../../db/apiClient.ts';

const SOURCE_OPTIONS: Array<{ key: AssistantSourceKey; label: string }> = [
  { key: 'canvas', label: 'Canvas' },
  { key: 'ai_process', label: 'AI Process' },
  { key: 'portfolio', label: 'Portfolio' },
  { key: 'tracker', label: '行业看板' },
  { key: 'feed', label: '信息流' },
  { key: 'ai_library', label: '能力库' },
  { key: 'overview', label: '纵览' },
];

const EXTERNAL_SOURCE_OPTIONS: Array<{ key: AssistantExternalSourceKey; label: string; description: string; icon: typeof Globe2 }> = [
  { key: 'web', label: '联网', description: '需要搜索服务 key', icon: Globe2 },
  { key: 'fmp', label: 'FMP', description: '市场数据/新闻', icon: TrendingUp },
];

const VIEW_SOURCE_MAP: Record<string, AssistantSourceKey> = {
  canvas: 'canvas',
  ai_process: 'ai_process',
  portfolio: 'portfolio',
  tracker: 'tracker',
  feed: 'feed',
  ai_research: 'ai_library',
  overview: 'overview',
};

function formatTime(value?: string) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

function isKnownViewMode(value?: string): value is AppViewMode {
  return value === 'overview'
    || value === 'canvas'
    || value === 'ai_research'
    || value === 'ai_process'
    || value === 'portfolio'
    || value === 'tracker'
    || value === 'feed';
}

function SourceCard({ source, onOpen }: { source: AssistantSource; onOpen: (source: AssistantSource) => void }) {
  return (
    <button
      type="button"
      onClick={() => onOpen(source)}
      className="group w-full rounded-lg border border-slate-200 bg-white p-2 text-left transition-colors hover:border-blue-200 hover:bg-blue-50/40"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 text-[11px] font-semibold text-blue-600">
            <span>{source.moduleLabel}</span>
            {source.location && <span className="truncate text-slate-400">{source.location}</span>}
          </div>
          <div className="mt-1 truncate text-xs font-semibold text-slate-800">{source.title}</div>
        </div>
        <ExternalLink size={13} className="mt-0.5 shrink-0 text-slate-300 group-hover:text-blue-500" />
      </div>
      {source.preview && (
        <p className="mt-1 line-clamp-2 text-[11px] leading-5 text-slate-500">{source.preview}</p>
      )}
      {source.timestamp && <div className="mt-1 text-[10px] text-slate-400">{formatTime(source.timestamp)}</div>}
    </button>
  );
}

export const AssistantDrawer = memo(function AssistantDrawer() {
  const isMobile = useMobile();
  const readOnly = useAuthStore((s) => s.user?.readOnly === true);
  const isOpen = useAssistantStore((s) => s.isOpen);
  const close = useAssistantStore((s) => s.close);
  const scope = useAssistantStore((s) => s.scope);
  const setScope = useAssistantStore((s) => s.setScope);
  const enabledSources = useAssistantStore((s) => s.enabledSources);
  const toggleSource = useAssistantStore((s) => s.toggleSource);
  const externalSources = useAssistantStore((s) => s.externalSources);
  const toggleExternalSource = useAssistantStore((s) => s.toggleExternalSource);
  const deepAnalysis = useAssistantStore((s) => s.deepAnalysis);
  const setDeepAnalysis = useAssistantStore((s) => s.setDeepAnalysis);
  const messages = useAssistantStore((s) => s.messages);
  const isStreaming = useAssistantStore((s) => s.isStreaming);
  const tools = useAssistantStore((s) => s.tools);
  const sendMessage = useAssistantStore((s) => s.sendMessage);
  const stop = useAssistantStore((s) => s.stop);
  const clear = useAssistantStore((s) => s.clear);

  const viewMode = useAICardStore((s) => s.viewMode);
  const setViewMode = useAICardStore((s) => s.setViewMode);
  const currentWorkspaceId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const currentCanvasId = useWorkspaceStore((s) => s.currentCanvasId);
  const workspaces = useWorkspaceStore((s) => s.workspaces);
  const canvases = useWorkspaceStore((s) => s.canvases);
  const setCurrentWorkspace = useWorkspaceStore((s) => s.setCurrentWorkspace);
  const setCurrentCanvas = useWorkspaceStore((s) => s.setCurrentCanvas);

  const [input, setInput] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const currentTitle = useMemo(() => {
    const workspace = workspaces.find((item) => item.id === currentWorkspaceId)?.name;
    const canvas = canvases.find((item) => item.id === currentCanvasId)?.title;
    return [workspace, canvas].filter(Boolean).join(' / ');
  }, [canvases, currentCanvasId, currentWorkspaceId, workspaces]);
  const currentSource = VIEW_SOURCE_MAP[viewMode];
  const currentSourceLabel = SOURCE_OPTIONS.find((item) => item.key === currentSource)?.label || '当前模块';

  useEffect(() => {
    if (isOpen) textareaRef.current?.focus();
  }, [isOpen]);

  useEffect(() => {
    const node = scrollRef.current;
    if (!node) return;
    node.scrollTop = node.scrollHeight;
  }, [messages, tools]);

  const submit = () => {
    const query = input.trim();
    if (!query) return;
    setInput('');
    void sendMessage(query, {
      viewMode,
      currentWorkspaceId,
      currentCanvasId,
      currentTitle,
      location: window.location.pathname,
    });
  };

  const openSource = (source: AssistantSource) => {
    const target = source.target;
    if (target?.href) {
      window.open(target.href, '_blank', 'noopener,noreferrer');
      return;
    }
    if (isKnownViewMode(target?.viewMode)) {
      setViewMode(target.viewMode);
    } else if (source.module === 'canvas') {
      setViewMode('canvas');
    }
    if (target?.workspaceId) {
      setCurrentWorkspace(target.workspaceId);
      if (target.canvasId) {
        window.setTimeout(() => setCurrentCanvas(target.canvasId || null), 150);
      }
    } else if (target?.canvasId) {
      setCurrentCanvas(target.canvasId);
    }
  };

  const optionControls = (
    <div className="mb-3 space-y-2">
      <div className="rounded-xl border border-slate-200 bg-slate-50 p-2">
        <div className="mb-2 flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-600">
            <Database size={12} className="text-slate-400" />
            输入来源限定
          </div>
          <span className="text-[10px] text-slate-400">本地数据默认开启</span>
        </div>
        <div className="grid grid-cols-3 gap-1.5">
          <div className="rounded-lg border border-blue-200 bg-blue-50 px-2 py-1.5 text-[11px] font-semibold text-blue-700">
            <div className="flex items-center gap-1">
              <Check size={11} />
              本地
            </div>
            <div className="mt-0.5 text-[10px] font-medium text-blue-500">Canvas / 笔记 / 信息流</div>
          </div>
          {EXTERNAL_SOURCE_OPTIONS.map((item) => {
            const Icon = item.icon;
            const active = externalSources.includes(item.key);
            return (
              <button
                key={item.key}
                type="button"
                onClick={() => toggleExternalSource(item.key)}
                className={`rounded-lg border px-2 py-1.5 text-left text-[11px] font-semibold transition-colors ${
                  active
                    ? 'border-blue-200 bg-blue-50 text-blue-700'
                    : 'border-slate-200 bg-white text-slate-500 hover:bg-slate-50'
                }`}
              >
                <div className="flex items-center gap-1">
                  {active ? <Check size={11} /> : <Icon size={11} />}
                  {item.label}
                </div>
                <div className={`mt-0.5 text-[10px] font-medium ${active ? 'text-blue-500' : 'text-slate-400'}`}>
                  {item.description}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      <div className="rounded-xl border border-slate-200 bg-slate-50 p-2">
        <div className="mb-2 flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-600">
            <Database size={12} className="text-slate-400" />
            页面范围
          </div>
          <span className="text-[10px] text-slate-400">
            {scope === 'current' ? `当前: ${currentSourceLabel}` : '全站模块可选'}
          </span>
        </div>
        <div className="grid grid-cols-2 gap-1.5">
          <button
            type="button"
            onClick={() => setScope('current')}
            className={`rounded-lg border px-2 py-1.5 text-left text-[11px] font-semibold transition-colors ${
              scope === 'current'
                ? 'border-blue-200 bg-blue-50 text-blue-700'
                : 'border-slate-200 bg-white text-slate-500 hover:bg-slate-50'
            }`}
          >
            <div className="flex items-center gap-1">
              {scope === 'current' ? <Check size={11} /> : <Database size={11} />}
              当前页面
            </div>
            <div className={`mt-0.5 text-[10px] font-medium ${scope === 'current' ? 'text-blue-500' : 'text-slate-400'}`}>
              {currentSourceLabel}
            </div>
          </button>
          <button
            type="button"
            onClick={() => setScope('all')}
            className={`rounded-lg border px-2 py-1.5 text-left text-[11px] font-semibold transition-colors ${
              scope === 'all'
                ? 'border-blue-200 bg-blue-50 text-blue-700'
                : 'border-slate-200 bg-white text-slate-500 hover:bg-slate-50'
            }`}
          >
            <div className="flex items-center gap-1">
              {scope === 'all' ? <Check size={11} /> : <Search size={11} />}
              全站
            </div>
            <div className={`mt-0.5 text-[10px] font-medium ${scope === 'all' ? 'text-blue-500' : 'text-slate-400'}`}>
              {enabledSources.length} 个模块
            </div>
          </button>
        </div>

        {scope === 'all' && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {SOURCE_OPTIONS.map((item) => {
              const active = enabledSources.includes(item.key);
              return (
                <button
                  key={item.key}
                  type="button"
                  onClick={() => toggleSource(item.key)}
                  className={`inline-flex items-center gap-1 rounded-full border px-2 py-1 text-[11px] font-medium ${
                    active
                      ? 'border-blue-200 bg-blue-50 text-blue-700'
                      : 'border-slate-200 bg-white text-slate-400 hover:text-slate-600'
                  }`}
                >
                  {active && <Check size={11} />}
                  {item.label}
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );

  if (!isOpen) return null;

  return (
    <>
      <div className="fixed inset-0 z-[70] bg-slate-900/10" onClick={close} />
      <aside
        className={`fixed z-[80] flex bg-white shadow-2xl ${
          isMobile
            ? 'inset-0 flex-col'
            : 'right-0 top-0 h-[100dvh] w-[620px] max-w-[calc(100vw-24px)] flex-col border-l border-slate-200'
        }`}
      >
        <header className="border-b border-slate-200 p-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-50 text-blue-600">
                  <MessageCircle size={18} />
                </div>
                <div>
                  <h2 className="text-sm font-semibold text-slate-900">Research Assistant</h2>
                  <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-slate-400">
                    <Sparkles size={11} />
                    <span>引用回答</span>
                    {readOnly && <span className="rounded-full bg-amber-50 px-1.5 py-0.5 font-semibold text-amber-700">只读</span>}
                  </div>
                </div>
              </div>
            </div>
            <button
              type="button"
              onClick={close}
              className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
              title="关闭"
            >
              <X size={18} />
            </button>
          </div>

        </header>

        <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto bg-slate-50 p-3">
          {messages.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center px-6 text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white text-blue-600 shadow-sm">
                <Bot size={24} />
              </div>
              <h3 className="mt-3 text-sm font-semibold text-slate-800">跨 Research Canvas 检索与总结</h3>
              <p className="mt-2 max-w-[320px] text-xs leading-5 text-slate-500">
                可以问今天更新、某个行业变化、某家公司相关笔记，回答会带来源卡片。
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {messages.map((message) => (
                <div
                  key={message.id}
                  className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
                >
                  <div
                    className={`max-w-[92%] rounded-2xl px-3 py-2 text-sm shadow-sm ${
                      message.role === 'user'
                        ? 'bg-blue-600 text-white'
                        : 'border border-slate-200 bg-white text-slate-800'
                    }`}
                  >
                    <div className="whitespace-pre-wrap leading-6">{message.content || (isStreaming ? '检索中...' : '')}</div>
                    {message.role === 'assistant' && message.tools && message.tools.length > 0 && (
                      <div className="mt-2 rounded-lg bg-slate-50 p-2">
                        <div className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold text-slate-500">
                          <Database size={12} />
                          检索状态
                        </div>
                        <div className="space-y-1">
                          {message.tools.map((tool) => (
                            <div key={`${message.id}-${tool.source}`} className="flex items-center justify-between gap-2 text-[11px] text-slate-500">
                              <span className="truncate">{tool.label}</span>
                              <span className={tool.error ? 'text-red-500' : 'text-slate-400'}>
                                {tool.error ? tool.error : `${tool.count} 条`}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                    {message.role === 'assistant' && message.sources && message.sources.length > 0 && (
                      <div className="mt-2 space-y-1.5">
                        {message.sources.slice(0, 5).map((source) => (
                          <SourceCard key={`${message.id}-${source.id}`} source={source} onOpen={openSource} />
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <footer className="border-t border-slate-200 bg-white p-3">
          {optionControls}
          {tools.length > 0 && isStreaming && (
            <div className="mb-2 flex items-center gap-2 overflow-x-auto text-[11px] text-slate-500">
              <Search size={12} className="shrink-0" />
              {tools.map((tool) => (
                <span key={tool.source} className="shrink-0 rounded-full bg-slate-100 px-2 py-1">
                  {tool.label} {tool.error ? '失败' : `${tool.count}`}
                </span>
              ))}
            </div>
          )}
          <div className="flex items-end gap-2">
            <textarea
              ref={textareaRef}
              value={input}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={(event) => {
                if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
                  event.preventDefault();
                  submit();
                }
              }}
              rows={3}
              placeholder="问 Research Canvas..."
              className="min-h-[78px] flex-1 resize-none rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-800 outline-none focus:border-blue-300 focus:bg-white focus:ring-2 focus:ring-blue-100"
            />
            <div className="flex flex-col gap-2">
              <button
                type="button"
                onClick={clear}
                className="rounded-lg border border-slate-200 bg-white px-2 py-2 text-xs font-semibold text-slate-500 hover:bg-slate-50"
                title="清空"
              >
                清空
              </button>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setDeepAnalysis(!deepAnalysis)}
                  className={`h-9 rounded-lg border px-2 text-[11px] font-semibold ${
                    deepAnalysis
                      ? 'border-blue-200 bg-blue-50 text-blue-700'
                      : 'border-slate-200 bg-white text-slate-500 hover:bg-slate-50'
                  }`}
                >
                  Deep
                </button>
                {isStreaming ? (
                  <button
                    type="button"
                    onClick={stop}
                    className="h-9 rounded-lg bg-slate-900 px-3 text-white hover:bg-slate-700"
                    title="停止"
                  >
                    <CircleStop size={16} />
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={submit}
                    disabled={!input.trim()}
                    className="h-9 rounded-lg bg-blue-600 px-3 text-white hover:bg-blue-500 disabled:cursor-not-allowed disabled:bg-blue-200"
                    title="发送"
                  >
                    <Send size={16} />
                  </button>
                )}
              </div>
            </div>
          </div>
          <div className="mt-2 flex items-center gap-1 text-[11px] text-slate-400">
            <ChevronRight size={12} />
            <span>v1 只读检索与引用回答，不会自动写回。</span>
          </div>
        </footer>
      </aside>
    </>
  );
});
