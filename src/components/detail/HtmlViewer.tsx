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
    const [showCode, setShowCode] = useState(false);
    const [editContent, setEditContent] = useState(data.content);

    // Use a ref for the debounce timer
    const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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
            <div className="px-2 py-1 bg-white flex justify-end shrink-0 border-b border-slate-100">
                <button
                    onClick={() => setShowCode(!showCode)}
                    className={`px-2 py-1 rounded flex items-center gap-1.5 text-xs font-medium transition-colors ${showCode ? 'bg-blue-100 text-blue-800' : 'text-slate-500 hover:bg-slate-100'
                        }`}
                    title="查看源码"
                >
                    {showCode ? <Code2 size={14} /> : <Code size={14} />}
                    源码
                </button>
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
