import { memo, useState, useCallback, useRef, useEffect } from 'react';
import { useCanvasStore } from '../../stores/canvasStore.ts';
import { useAuthStore } from '../../stores/authStore.ts';
import type { CanvasAttachmentReference, HtmlNodeData } from '../../types/index.ts';
import { Code, Code2, Link2 } from 'lucide-react';
import { makeAttachmentReferenceId, truncate, useAttachmentReferences } from '../../hooks/useAttachmentReferences.ts';

interface HtmlViewerProps {
    nodeId: string;
    data: HtmlNodeData;
}

export const HtmlViewer = memo(function HtmlViewer({
    nodeId,
    data,
}: HtmlViewerProps) {
    const updateNodeData = useCanvasStore((s) => s.updateNodeData);
    const activeReference = useCanvasStore((s) => s.activeAttachmentReference);
    const clearActiveAttachmentReference = useCanvasStore((s) => s.clearActiveAttachmentReference);
    const readOnly = useAuthStore((s) => s.user?.readOnly === true);
    const { addReferenceToHome } = useAttachmentReferences();
    const [showCode, setShowCode] = useState(false);
    const [editContent, setEditContent] = useState(data.content);
    const [frameLoaded, setFrameLoaded] = useState(false);
    const iframeRef = useRef<HTMLIFrameElement>(null);

    // Use a ref for the debounce timer
    const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const handleContentChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
        if (readOnly) return;
        const newContent = e.target.value;
        setEditContent(newContent);

        // Auto-save content with debounce
        if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
        saveTimerRef.current = setTimeout(() => {
            updateNodeData(nodeId, { content: newContent });
        }, 500);
    }, [nodeId, updateNodeData, readOnly]);

    const handleCreateReference = useCallback(() => {
        const frame = iframeRef.current;
        const doc = frame?.contentDocument;
        const win = frame?.contentWindow;
        const selection = win?.getSelection();
        const selectedText = selection?.toString().replace(/\s+/g, ' ').trim() || '';
        if (!doc || !win || !selectedText) {
            alert('请先在 HTML 附件里选中一段文字，再生成引用。');
            return;
        }

        const note = window.prompt('给这条引用加一句备注（可选）', '') || '';
        const reference: CanvasAttachmentReference = {
            id: makeAttachmentReferenceId(),
            sourceNodeId: nodeId,
            sourceType: 'html',
            sourceTitle: data.title,
            title: truncate(selectedText, 64),
            note: note.trim(),
            quote: selectedText,
            anchor: {
                type: 'html',
                scrollTop: doc.scrollingElement?.scrollTop || doc.documentElement.scrollTop || doc.body.scrollTop || 0,
                textQuote: selectedText,
            },
            preview: {
                kind: 'quote',
                text: selectedText,
            },
            createdAt: Date.now(),
        };

        updateNodeData(nodeId, {
            annotations: [...(data.annotations || []), reference],
        });
        addReferenceToHome(reference);
    }, [addReferenceToHome, data.annotations, data.title, nodeId, updateNodeData]);

    const jumpToReference = useCallback((reference: CanvasAttachmentReference) => {
        const frame = iframeRef.current;
        const doc = frame?.contentDocument;
        const win = frame?.contentWindow;
        if (!doc || !win || reference.anchor.type !== 'html') return;

        const scrollTop = reference.anchor.scrollTop || 0;
        win.scrollTo({ top: Math.max(0, scrollTop - 24), behavior: 'smooth' });

        const quote = reference.anchor.textQuote || reference.quote || '';
        if (!quote) return;
        const normalizedQuote = quote.replace(/\s+/g, ' ').trim();
        const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT, {
            acceptNode: (node) => {
                const text = node.textContent?.replace(/\s+/g, ' ').trim() || '';
                return text.includes(normalizedQuote.slice(0, Math.min(80, normalizedQuote.length)))
                    ? NodeFilter.FILTER_ACCEPT
                    : NodeFilter.FILTER_REJECT;
            },
        });
        const textNode = walker.nextNode() as Text | null;
        const target = textNode?.parentElement;
        if (!target) return;
        target.scrollIntoView({ block: 'center', behavior: 'smooth' });
        const previousOutline = target.style.outline;
        const previousBackground = target.style.backgroundColor;
        target.style.outline = '3px solid rgba(245, 158, 11, 0.85)';
        target.style.backgroundColor = 'rgba(254, 243, 199, 0.85)';
        window.setTimeout(() => {
            target.style.outline = previousOutline;
            target.style.backgroundColor = previousBackground;
        }, 2400);
    }, []);

    useEffect(() => {
        if (!frameLoaded || !activeReference || activeReference.sourceNodeId !== nodeId || activeReference.anchor.type !== 'html') return;
        jumpToReference(activeReference);
        const timer = window.setTimeout(() => clearActiveAttachmentReference(), 2500);
        return () => window.clearTimeout(timer);
    }, [activeReference, clearActiveAttachmentReference, frameLoaded, jumpToReference, nodeId]);

    return (
        <div className="flex h-full min-h-0 flex-col bg-white">
            {/* Header toolbar */}
            <div className="px-2 py-1 bg-white flex justify-end gap-1.5 shrink-0 border-b border-slate-100">
                {!readOnly && (
                    <button
                        onClick={handleCreateReference}
                        className="px-2 py-1 rounded flex items-center gap-1.5 text-xs font-medium text-blue-600 hover:bg-blue-50"
                        title="选中 HTML 中的一段文字后，插入到 Canvas 主页引用卡片"
                    >
                        <Link2 size={14} />
                        引用选中
                    </button>
                )}
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
            <div className={`flex min-h-0 flex-1 flex-col overflow-hidden ${showCode ? '' : 'hidden'}`}>
                {/* Source Code Editor */}
                {showCode && (
                    <div className="relative min-h-0 flex-1 overflow-hidden border-b border-slate-200 bg-slate-900">
                        <div className="absolute top-0 right-0 left-0 bg-slate-800 px-3 py-1 flex items-center justify-between pointer-events-none">
                            <span className="text-[10px] text-slate-400 font-mono uppercase">HTML/CSS/JS Source</span>
                        </div>
                        <textarea
                            className="w-full h-full p-4 pt-8 bg-transparent text-slate-300 font-mono text-xs outline-none resize-none leading-relaxed"
                            value={editContent}
                            onChange={handleContentChange}
                            readOnly={readOnly}
                            spellCheck={false}
                        />
                    </div>
                )}
            </div>

            {/* HTML Previev Iframe */}
            <div className="relative min-h-0 flex-1 overflow-hidden bg-slate-100" style={{ height: showCode ? '50%' : '100%' }}>
                <iframe
                    ref={iframeRef}
                    className="w-full h-full border-none bg-white block"
                    srcDoc={data.content}
                    sandbox="allow-scripts allow-same-origin"
                    title={data.title}
                    onLoad={() => setFrameLoaded(true)}
                />
            </div>
        </div>
    );
});
