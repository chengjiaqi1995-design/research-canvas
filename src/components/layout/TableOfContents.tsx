import { memo, useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, List, FileText } from 'lucide-react';
import { useCanvasStore } from '../../stores/canvasStore.ts';
import { useWorkspaceStore } from '../../stores/workspaceStore.ts';

interface TocHeading {
    level: number;     // 1-4
    text: string;
}

interface TocModule {
    moduleId: string;
    moduleName: string;
    headings: TocHeading[];
    childCount: number;  // number of non-main nodes
}

/** Extract headings (h1-h4) from HTML content string */
function extractHeadings(html: string): TocHeading[] {
    if (!html) return [];
    const headings: TocHeading[] = [];
    // Match <h1>...<h6> tags, capture level and inner text
    const regex = /<h([1-4])[^>]*>(.*?)<\/h\1>/gi;
    let match;
    while ((match = regex.exec(html)) !== null) {
        const level = parseInt(match[1], 10);
        // Strip inner HTML tags to get plain text
        const text = match[2].replace(/<[^>]*>/g, '').trim();
        if (text) {
            headings.push({ level, text });
        }
    }
    return headings;
}

export const TableOfContents = memo(function TableOfContents() {
    const modules = useCanvasStore((s) => s.modules);
    const nodes = useCanvasStore((s) => s.nodes);
    const currentCanvasId = useWorkspaceStore((s) => s.currentCanvasId);
    const [collapsed, setCollapsed] = useState(false);

    const tocData = useMemo<TocModule[]>(() => {
        if (!currentCanvasId) return [];
        const sorted = [...modules].sort((a, b) => a.order - b.order);
        return sorted.map((mod) => {
            // Find main text node for this module
            const mainNode = nodes.find(
                (n) => n.module === mod.id && n.isMain && n.data.type === 'text'
            );
            const content = mainNode?.data.type === 'text' ? mainNode.data.content : '';
            const headings = extractHeadings(content);
            const childCount = nodes.filter((n) => n.module === mod.id && !n.isMain).length;
            return {
                moduleId: mod.id,
                moduleName: mod.name,
                headings,
                childCount,
            };
        });
    }, [modules, nodes, currentCanvasId]);

    if (!currentCanvasId || tocData.length === 0) return null;

    const handleScrollToModule = (moduleId: string) => {
        const el = document.getElementById(`module-${moduleId}`);
        if (el) {
            el.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
    };

    return (
        <div className="border-t border-slate-200">
            {/* TOC header */}
            <button
                onClick={() => setCollapsed(!collapsed)}
                className="flex items-center gap-1.5 w-full px-3 py-2 text-xs font-semibold text-slate-500 hover:bg-slate-100 transition-colors"
            >
                {collapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
                <List size={12} />
                <span>目录</span>
                <span className="ml-auto text-slate-300 font-normal">{tocData.length}</span>
            </button>

            {/* TOC items */}
            {!collapsed && (
                <div className="pb-1">
                    {tocData.map((mod) => (
                        <div key={mod.moduleId}>
                            {/* Module name (level 0) */}
                            <div
                                onClick={() => handleScrollToModule(mod.moduleId)}
                                className="flex items-center gap-1.5 px-3 py-1 cursor-pointer text-xs text-slate-700 hover:bg-blue-50 hover:text-blue-700 transition-colors"
                            >
                                <span className="w-1.5 h-1.5 rounded-full bg-slate-400 shrink-0" />
                                <span className="font-medium truncate flex-1">{mod.moduleName}</span>
                                {mod.childCount > 0 && (
                                    <span className="text-[10px] text-slate-300 shrink-0 flex items-center gap-0.5">
                                        {mod.childCount}
                                        <FileText size={8} />
                                    </span>
                                )}
                            </div>

                            {/* Sub-headings */}
                            {mod.headings.map((h, idx) => (
                                <div
                                    key={`${mod.moduleId}-h-${idx}`}
                                    onClick={() => handleScrollToModule(mod.moduleId)}
                                    className="flex items-center gap-1 py-0.5 cursor-pointer text-[11px] text-slate-500 hover:text-blue-600 hover:bg-blue-50/50 transition-colors truncate"
                                    style={{ paddingLeft: `${12 + h.level * 10}px` }}
                                >
                                    <span className="text-slate-300">{'─'}</span>
                                    <span className="truncate">{h.text}</span>
                                </div>
                            ))}
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
});
