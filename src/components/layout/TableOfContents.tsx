import { memo, useMemo, useState, useCallback } from 'react';
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
    const toggleModuleCollapse = useCanvasStore((s) => s.toggleModuleCollapse);
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

    const handleScrollToModule = useCallback((moduleId: string) => {
        // Ensure the module is expanded (uncollapsed)
        const mod = modules.find((m) => m.id === moduleId);
        if (mod?.collapsed) {
            toggleModuleCollapse(moduleId);
        }

        // Wait for DOM update after possible uncollapse, then scroll + flash
        setTimeout(() => {
            const el = document.getElementById(`module-${moduleId}`);
            if (el) {
                el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
                // Flash highlight
                el.style.transition = 'box-shadow 0.3s ease';
                el.style.boxShadow = 'inset 3px 0 0 #3b82f6, 0 0 0 1px rgba(59,130,246,0.15)';
                setTimeout(() => {
                    el.style.boxShadow = '';
                }, 1500);
            }
        }, 100);
    }, [modules, toggleModuleCollapse]);

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
                            {mod.headings.map((h, idx) => {
                                const levelStyles: Record<number, { dot: string; text: string; size: string }> = {
                                    1: { dot: 'bg-blue-500', text: 'text-slate-700 font-semibold', size: 'text-[12px]' },
                                    2: { dot: 'bg-sky-400', text: 'text-slate-600 font-medium', size: 'text-[11px]' },
                                    3: { dot: 'bg-teal-400', text: 'text-slate-500', size: 'text-[10.5px]' },
                                    4: { dot: 'bg-slate-400', text: 'text-slate-400', size: 'text-[10.5px]' },
                                };
                                const style = levelStyles[h.level] || levelStyles[4];
                                return (
                                    <div
                                        key={`${mod.moduleId}-h-${idx}`}
                                        onClick={() => handleScrollToModule(mod.moduleId)}
                                        className={`flex items-center gap-1.5 py-0.5 cursor-pointer hover:text-blue-600 hover:bg-blue-50/50 transition-colors ${style.text} ${style.size}`}
                                        style={{ paddingLeft: `${8 + h.level * 12}px` }}
                                    >
                                        <span className={`w-1 h-1 rounded-full ${style.dot} shrink-0`} />
                                        <span className="truncate">{h.text}</span>
                                    </div>
                                );
                            })}
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
});
