import { memo, useState, useCallback, useRef } from 'react';
import { useCanvasStore } from '../../stores/canvasStore.ts';
import type { HtmlNodeData } from '../../types/index.ts';
import { Code, Code2 } from 'lucide-react';

interface HtmlViewerProps {
    nodeId: string;
    data: HtmlNodeData;
}

export const HtmlViewer = memo(function HtmlViewer({
    nodeId,
    data,
}: HtmlViewerProps) {
    const updateNodeData = useCanvasStore((s) => s.updateNodeData);
    const [isEditingTitle, setIsEditingTitle] = useState(false);
    const [editTitle, setEditTitle] = useState(data.title);
    const [showCode, setShowCode] = useState(false);
    const [editContent, setEditContent] = useState(data.content);

    // Use a ref for the debounce timer
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

        // Auto-save content with debounce
        if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
        saveTimerRef.current = setTimeout(() => {
            updateNodeData(nodeId, { content: newContent });
        }, 500);
    }, [nodeId, updateNodeData]);

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
                                className="flex-1 text-sm font-semibold border-b-2 border-orange-400 outline-none pb-1 bg-transparent"
                            />
                            <button
                                onClick={handleSaveTitle}
                                className="text-xs text-orange-600 px-2 py-0.5 rounded hover:bg-orange-100"
                            >
                                OK
                            </button>
                        </div>
                    ) : (
                        <h2
                            className="text-sm font-semibold text-slate-800 cursor-pointer hover:text-orange-600 transition-colors truncate"
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
                        className={`p-1.5 rounded flex items-center gap-1 text-xs transition-colors ${showCode ? 'bg-orange-100 text-orange-700' : 'text-slate-500 hover:bg-slate-200'
                            }`}
                        title="查看源码"
                    >
                        {showCode ? <Code2 size={14} /> : <Code size={14} />}
                        源码
                    </button>
                </div>
            </div>

            {/* Editor & Viewer Area */}
            <div className={`flex-1 overflow-hidden flex flex-col ${showCode ? '' : 'hidden'}`}>
                {/* Source Code Editor */}
                {showCode && (
                    <div className="flex-1 border-b border-slate-200 bg-slate-900 overflow-hidden relative">
                        <div className="absolute top-0 right-0 left-0 bg-slate-800 px-3 py-1 flex items-center justify-between pointer-events-none">
                            <span className="text-[10px] text-slate-400 font-mono uppercase">HTML/CSS/JS Source</span>
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

            {/* HTML Previev Iframe */}
            <div className="flex-1 bg-slate-100 overflow-hidden relative" style={{ height: showCode ? '50%' : '100%' }}>
                <iframe
                    className="w-full h-full border-none bg-white block"
                    srcDoc={data.content}
                    sandbox="allow-scripts allow-same-origin"
                    title={data.title}
                />
            </div>
        </div>
    );
});
