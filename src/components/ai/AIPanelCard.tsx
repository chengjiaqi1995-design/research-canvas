import { memo, useCallback, useRef, useEffect, useState } from 'react';
import { Send, X, Square, Copy, Check, ChevronDown } from 'lucide-react';
import { useAIResearchStore } from '../../stores/aiResearchStore.ts';
import type { AIPanel } from '../../types/index.ts';

interface AIPanelCardProps {
    panel: AIPanel;
}

export const AIPanelCard = memo(function AIPanelCard({ panel }: AIPanelCardProps) {
    const models = useAIResearchStore((s) => s.models);
    const updatePanel = useAIResearchStore((s) => s.updatePanel);
    const removePanel = useAIResearchStore((s) => s.removePanel);
    const sendMessage = useAIResearchStore((s) => s.sendMessage);
    const stopStreaming = useAIResearchStore((s) => s.stopStreaming);

    const [isEditingTitle, setIsEditingTitle] = useState(false);
    const [editTitle, setEditTitle] = useState(panel.title);
    const [copied, setCopied] = useState(false);

    const responseRef = useRef<HTMLTextAreaElement>(null);

    // Auto-scroll response during streaming
    useEffect(() => {
        if (panel.isStreaming && responseRef.current) {
            responseRef.current.scrollTop = responseRef.current.scrollHeight;
        }
    }, [panel.response, panel.isStreaming]);

    const handleSend = useCallback(() => {
        console.log('[AIPanelCard] handleSend called, prompt:', panel.prompt.substring(0, 50), 'isStreaming:', panel.isStreaming);
        if (panel.prompt.trim() && !panel.isStreaming) {
            console.log('[AIPanelCard] calling sendMessage with id:', panel.id);
            sendMessage(panel.id);
        } else {
            console.log('[AIPanelCard] sendMessage NOT called - prompt empty or streaming');
        }
    }, [panel.id, panel.prompt, panel.isStreaming, sendMessage]);

    const handleKeyDown = useCallback(
        (e: React.KeyboardEvent) => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                handleSend();
            }
        },
        [handleSend]
    );

    const handleCopy = useCallback(() => {
        navigator.clipboard.writeText(panel.editedResponse || panel.response).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        });
    }, [panel.editedResponse, panel.response]);

    const handleTitleSave = useCallback(() => {
        if (editTitle.trim()) {
            updatePanel(panel.id, { title: editTitle.trim() });
        }
        setIsEditingTitle(false);
    }, [editTitle, panel.id, updatePanel]);

    return (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden transition-shadow hover:shadow-md">
            {/* Panel header */}
            <div className="flex items-center gap-2 px-4 py-3 bg-gradient-to-r from-slate-50 to-white border-b border-slate-100">
                {/* Title */}
                <div className="flex-1 min-w-0">
                    {isEditingTitle ? (
                        <input
                            autoFocus
                            value={editTitle}
                            onChange={(e) => setEditTitle(e.target.value)}
                            onKeyDown={(e) => {
                                if (e.key === 'Enter') handleTitleSave();
                                if (e.key === 'Escape') {
                                    setEditTitle(panel.title);
                                    setIsEditingTitle(false);
                                }
                            }}
                            onBlur={handleTitleSave}
                            className="text-sm font-semibold w-full px-1 border-b-2 border-indigo-400 outline-none bg-transparent"
                        />
                    ) : (
                        <h3
                            className="text-sm font-semibold text-slate-800 truncate cursor-pointer hover:text-indigo-600 transition-colors"
                            onClick={() => {
                                setEditTitle(panel.title);
                                setIsEditingTitle(true);
                            }}
                        >
                            {panel.title}
                        </h3>
                    )}
                </div>

                {/* Model selector */}
                <div className="relative shrink-0">
                    <select
                        value={panel.model}
                        onChange={(e) => updatePanel(panel.id, { model: e.target.value })}
                        className="appearance-none text-xs px-2 py-1 pr-6 border border-slate-200 rounded-lg bg-white cursor-pointer hover:border-indigo-300 focus:outline-none focus:ring-1 focus:ring-indigo-400 text-slate-600"
                    >
                        {models.map((m) => (
                            <option key={m.id} value={m.id}>
                                {m.name}
                            </option>
                        ))}
                    </select>
                    <ChevronDown size={12} className="absolute right-1.5 top-1/2 -translate-y-1/2 pointer-events-none text-slate-400" />
                </div>

                {/* Close button */}
                <button
                    onClick={() => removePanel(panel.id)}
                    className="p-1 rounded-lg text-slate-400 hover:text-red-500 hover:bg-red-50 transition-colors"
                    title="关闭面板"
                >
                    <X size={16} />
                </button>
            </div>

            {/* Prompt area — pre-filled with default, user can modify */}
            <div className="px-4 py-3 border-b border-slate-100">
                <div className="flex gap-2">
                    <textarea
                        value={panel.prompt}
                        onChange={(e) => updatePanel(panel.id, { prompt: e.target.value })}
                        onKeyDown={handleKeyDown}
                        placeholder="输入你的 Prompt... (Ctrl+Enter 发送)"
                        rows={5}
                        className="flex-1 px-3 py-2 text-sm border border-slate-200 rounded-lg resize-y focus:outline-none focus:ring-2 focus:ring-indigo-400 focus:border-transparent placeholder:text-slate-400 font-mono leading-relaxed"
                    />
                    <div className="flex flex-col gap-1 justify-end">
                        {panel.isStreaming ? (
                            <button
                                onClick={() => stopStreaming(panel.id)}
                                className="px-3 py-2 text-sm text-white bg-red-500 hover:bg-red-600 rounded-lg transition-colors flex items-center gap-1"
                                title="停止"
                            >
                                <Square size={14} />
                            </button>
                        ) : (
                            <button
                                onClick={handleSend}
                                disabled={!panel.prompt.trim()}
                                className="px-3 py-2 text-sm text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1"
                                title="发送 (Ctrl+Enter)"
                            >
                                <Send size={14} />
                            </button>
                        )}
                    </div>
                </div>
            </div>

            {/* Response area */}
            {(panel.response || panel.isStreaming) && (
                <div className="px-4 py-3">
                    <div className="flex items-center justify-between mb-2">
                        <span className="text-xs text-slate-500 font-medium">
                            {panel.isStreaming ? (
                                <span className="flex items-center gap-1">
                                    <span className="inline-block w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
                                    AI 回答中...
                                </span>
                            ) : (
                                '回答 (可编辑)'
                            )}
                        </span>
                        {!panel.isStreaming && panel.response && (
                            <button
                                onClick={handleCopy}
                                className="flex items-center gap-1 text-xs text-slate-400 hover:text-slate-600 transition-colors"
                            >
                                {copied ? <Check size={12} className="text-green-500" /> : <Copy size={12} />}
                                {copied ? '已复制' : '复制'}
                            </button>
                        )}
                    </div>
                    <textarea
                        ref={responseRef}
                        value={panel.editedResponse || panel.response}
                        onChange={(e) => updatePanel(panel.id, { editedResponse: e.target.value })}
                        readOnly={panel.isStreaming}
                        className={`w-full min-h-[120px] max-h-[400px] px-3 py-2 text-sm rounded-lg border resize-y font-mono leading-relaxed ${panel.isStreaming
                            ? 'bg-slate-50 border-slate-200 text-slate-700'
                            : 'bg-white border-slate-200 focus:ring-2 focus:ring-indigo-400 focus:border-transparent hover:border-indigo-300'
                            } focus:outline-none transition-colors`}
                        style={{ whiteSpace: 'pre-wrap' }}
                    />
                </div>
            )}
        </div>
    );
});
