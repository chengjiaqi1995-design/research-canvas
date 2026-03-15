import { memo, useState, useCallback, useRef } from 'react';
import { useCanvasStore } from '../../stores/canvasStore.ts';
import type { MarkdownNodeData } from '../../types/index.ts';
import { Code, Code2 } from 'lucide-react';
import { marked } from 'marked';

interface MarkdownViewerProps {
    nodeId: string;
    data: MarkdownNodeData;
}

export const MarkdownViewer = memo(function MarkdownViewer({
    nodeId,
    data,
}: MarkdownViewerProps) {
    const updateNodeData = useCanvasStore((s) => s.updateNodeData);
    const [isEditingTitle, setIsEditingTitle] = useState(false);
    const [editTitle, setEditTitle] = useState(data.title);
    const [showCode, setShowCode] = useState(false);
    const [editContent, setEditContent] = useState(data.content);

    const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const handleSaveTitle = useCallback(() => {
        if (editTitle.trim()) {
            updateNodeData(nodeId, { title: editTitle.trim() });
        }
        setIsEditingTitle(false);
    }, [editTitle, nodeId, updateNodeData]);

    const handleContentChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
        const newContent = e.target.value;
        setEditContent(newContent);

        if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
        saveTimerRef.current = setTimeout(() => {
            updateNodeData(nodeId, { content: newContent });
        }, 500);
    }, [nodeId, updateNodeData]);

    // Convert markdown to HTML for preview
    const htmlContent = (() => {
        try {
            return marked.parse(data.content, { async: false }) as string;
        } catch {
            return `<pre>${data.content}</pre>`;
        }
    })();

    // Wrap rendered markdown in a styled HTML page
    const previewHtml = `<!DOCTYPE html>
<html>
<head>
<style>
  body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    line-height: 1.6;
    color: #334155;
    padding: 24px;
    max-width: 100%;
    margin: 0;
    font-size: 14px;
  }
  h1 { font-size: 1.8em; border-bottom: 2px solid #e2e8f0; padding-bottom: 0.3em; margin-top: 1.2em; }
  h2 { font-size: 1.4em; border-bottom: 1px solid #e2e8f0; padding-bottom: 0.3em; margin-top: 1em; }
  h3 { font-size: 1.2em; margin-top: 1em; }
  code { background: #f1f5f9; padding: 2px 6px; border-radius: 4px; font-size: 0.9em; }
  pre { background: #1e293b; color: #e2e8f0; padding: 16px; border-radius: 8px; overflow-x: auto; }
  pre code { background: none; padding: 0; color: inherit; }
  blockquote { border-left: 4px solid #6366f1; margin: 1em 0; padding: 0.5em 1em; background: #f8fafc; color: #475569; }
  table { border-collapse: collapse; width: 100%; margin: 1em 0; }
  th, td { border: 1px solid #e2e8f0; padding: 8px 12px; text-align: left; }
  th { background: #f8fafc; font-weight: 600; }
  a { color: #6366f1; text-decoration: none; }
  a:hover { text-decoration: underline; }
  img { max-width: 100%; border-radius: 8px; }
  ul, ol { padding-left: 1.5em; }
  li { margin: 0.25em 0; }
  hr { border: none; border-top: 1px solid #e2e8f0; margin: 1.5em 0; }
</style>
</head>
<body>${htmlContent}</body>
</html>`;

    return (
        <div className="flex flex-col h-full bg-white">
            {/* Header toolbar */}
            <div className="px-4 py-2 border-b border-slate-200 bg-slate-50 flex items-center justify-between shrink-0">
                <div className="flex-1">
                    {isEditingTitle ? (
                        <div className="flex items-center gap-2">
                            <input
                                autoFocus
                                value={editTitle}
                                onChange={(e) => setEditTitle(e.target.value)}
                                onKeyDown={(e) => {
                                    if (e.key === 'Enter') handleSaveTitle();
                                    if (e.key === 'Escape') {
                                        setEditTitle(data.title);
                                        setIsEditingTitle(false);
                                    }
                                }}
                                onBlur={handleSaveTitle}
                                className="flex-1 text-sm font-semibold border-b-2 border-indigo-400 outline-none pb-1 bg-transparent"
                            />
                            <button
                                onClick={handleSaveTitle}
                                className="text-xs text-indigo-600 px-2 py-0.5 rounded hover:bg-indigo-100"
                            >
                                OK
                            </button>
                        </div>
                    ) : (
                        <h2
                            className="text-sm font-semibold text-slate-800 cursor-pointer hover:text-indigo-600 transition-colors truncate"
                            onClick={() => {
                                setEditTitle(data.title);
                                setIsEditingTitle(true);
                            }}
                        >
                            {data.title}
                        </h2>
                    )}
                </div>
                <div className="flex items-center ml-4">
                    <button
                        onClick={() => setShowCode(!showCode)}
                        className={`p-1.5 rounded flex items-center gap-1 text-xs transition-colors ${showCode ? 'bg-indigo-100 text-indigo-700' : 'text-slate-500 hover:bg-slate-200'
                            }`}
                        title="查看源码"
                    >
                        {showCode ? <Code2 size={14} /> : <Code size={14} />}
                        源码
                    </button>
                </div>
            </div>

            {/* Source Code Editor */}
            <div className={`flex-1 overflow-hidden flex flex-col ${showCode ? '' : 'hidden'}`}>
                {showCode && (
                    <div className="flex-1 border-b border-slate-200 bg-slate-900 overflow-hidden relative">
                        <div className="absolute top-0 right-0 left-0 bg-slate-800 px-3 py-1 flex items-center justify-between pointer-events-none">
                            <span className="text-[10px] text-slate-400 font-mono uppercase">Markdown Source</span>
                        </div>
                        <textarea
                            className="w-full h-full p-4 pt-8 bg-transparent text-slate-300 font-mono text-xs outline-none resize-none leading-relaxed"
                            value={editContent}
                            onChange={handleContentChange}
                            spellCheck={false}
                        />
                    </div>
                )}
            </div>

            {/* Markdown Preview */}
            <div className="flex-1 bg-slate-100 overflow-hidden relative" style={{ height: showCode ? '50%' : '100%' }}>
                <iframe
                    className="w-full h-full border-none bg-white block"
                    srcDoc={previewHtml}
                    sandbox="allow-same-origin"
                    title={data.title}
                />
            </div>
        </div>
    );
});
