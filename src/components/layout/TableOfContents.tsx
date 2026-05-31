import { memo, useMemo, useState, useCallback } from 'react';
import { ChevronDown, ChevronRight, List, FileText } from 'lucide-react';
import { useCanvasStore } from '../../stores/canvasStore.ts';
import { useWorkspaceStore } from '../../stores/workspaceStore.ts';

interface TocHeading {
    level: number;     // 1-4
    text: string;
    occurrence: number;
}

interface TocModule {
    moduleId: string;
    moduleName: string;
    headings: TocHeading[];
    childCount: number;  // number of non-main nodes
}

function normalizeHeadingText(text: string): string {
    return text.replace(/\s+/g, ' ').trim();
}

function getHeadingText(element: Element): string {
    return normalizeHeadingText(
        element.querySelector('.bn-inline-content')?.textContent ||
        element.textContent ||
        ''
    );
}

function headingLevelFromElement(element: Element): number | null {
    const tagMatch = element.tagName.match(/^H([1-4])$/i);
    if (tagMatch) return parseInt(tagMatch[1], 10);

    const level = element.getAttribute('data-level');
    const parsed = level ? parseInt(level, 10) : NaN;
    return parsed >= 1 && parsed <= 4 ? parsed : null;
}

/** Extract headings (h1-h4) from HTML content string */
function extractHeadings(html: string): TocHeading[] {
    if (!html) return [];
    const headings: TocHeading[] = [];
    const counts = new Map<string, number>();

    if (typeof DOMParser !== 'undefined') {
        const doc = new DOMParser().parseFromString(html, 'text/html');
        doc.querySelectorAll('h1, h2, h3, h4').forEach((heading) => {
            const level = headingLevelFromElement(heading);
            const text = getHeadingText(heading);
            if (!level || !text) return;

            const key = `${level}::${text}`;
            const occurrence = counts.get(key) || 0;
            counts.set(key, occurrence + 1);
            headings.push({ level, text, occurrence });
        });
        return headings;
    }

    // Fallback for non-browser contexts.
    const regex = /<h([1-4])[^>]*>(.*?)<\/h\1>/gi;
    let match;
    while ((match = regex.exec(html)) !== null) {
        const level = parseInt(match[1], 10);
        const text = normalizeHeadingText(match[2].replace(/<[^>]*>/g, ''));
        if (text) {
            const key = `${level}::${text}`;
            const occurrence = counts.get(key) || 0;
            counts.set(key, occurrence + 1);
            headings.push({ level, text, occurrence });
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

    const flashElement = useCallback((element: HTMLElement) => {
        const previousOutline = element.style.outline;
        const previousBackground = element.style.backgroundColor;
        const previousBorderRadius = element.style.borderRadius;
        element.style.outline = '2px solid rgba(37, 99, 235, 0.55)';
        element.style.backgroundColor = 'rgba(219, 234, 254, 0.75)';
        element.style.borderRadius = '6px';
        window.setTimeout(() => {
            element.style.outline = previousOutline;
            element.style.backgroundColor = previousBackground;
            element.style.borderRadius = previousBorderRadius;
        }, 1400);
    }, []);

    const scrollToModuleElement = useCallback((moduleId: string) => {
        const el = document.getElementById(`module-${moduleId}`);
        if (!el) return false;

        el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        el.style.transition = 'box-shadow 0.3s ease';
        el.style.boxShadow = 'inset 3px 0 0 #3b82f6, 0 0 0 1px rgba(59,130,246,0.15)';
        window.setTimeout(() => {
            el.style.boxShadow = '';
        }, 1500);
        return true;
    }, []);

    const scrollToHeadingElement = useCallback((moduleId: string, heading: TocHeading) => {
        const moduleEl = document.getElementById(`module-${moduleId}`);
        if (!moduleEl) return false;

        const candidates = Array.from(
            moduleEl.querySelectorAll<HTMLElement>('h1, h2, h3, h4, [data-content-type="heading"]')
        ).filter((element) => {
            const level = headingLevelFromElement(element);
            return level === heading.level && getHeadingText(element) === heading.text;
        });

        const target = candidates[heading.occurrence] || candidates[0];
        if (!target) return false;

        target.scrollIntoView({ behavior: 'smooth', block: 'start', inline: 'nearest' });
        flashElement(target);
        return true;
    }, [flashElement]);

    const ensureModuleExpanded = useCallback((moduleId: string) => {
        // Ensure the module is expanded (uncollapsed)
        const mod = modules.find((m) => m.id === moduleId);
        if (mod?.collapsed) {
            toggleModuleCollapse(moduleId);
        }
    }, [modules, toggleModuleCollapse]);

    const handleScrollToModule = useCallback((moduleId: string) => {
        ensureModuleExpanded(moduleId);
        // Wait for DOM update after possible uncollapse, then scroll + flash
        setTimeout(() => {
            scrollToModuleElement(moduleId);
        }, 100);
    }, [ensureModuleExpanded, scrollToModuleElement]);

    const handleScrollToHeading = useCallback((moduleId: string, heading: TocHeading) => {
        ensureModuleExpanded(moduleId);
        // BlockNote needs a tick to render when a collapsed module is opened.
        setTimeout(() => {
            if (!scrollToHeadingElement(moduleId, heading)) {
                scrollToModuleElement(moduleId);
            }
        }, 120);
    }, [ensureModuleExpanded, scrollToHeadingElement, scrollToModuleElement]);

    if (!currentCanvasId || tocData.length === 0) return null;

    return (
        <div className="border-t border-slate-200">
            {/* TOC header */}
            <button
                onClick={() => setCollapsed(!collapsed)}
                className="flex items-center gap-1.5 w-full px-3 py-1.5 text-xs font-semibold text-slate-500 hover:bg-slate-100 transition-colors"
            >
                {collapsed ? <ChevronRight size={11} /> : <ChevronDown size={11} />}
                <List size={11} />
                <span>目录</span>
                <span className="ml-auto text-slate-300 font-normal text-[10px]">{tocData.length}</span>
            </button>

            {/* TOC items */}
            {!collapsed && (
                <div className="pb-1">
                    {tocData.map((mod) => (
                        <div key={mod.moduleId}>
                            {/* Module name (level 0) */}
                            <div
                                onClick={() => handleScrollToModule(mod.moduleId)}
                                className="flex items-center gap-1 px-3 py-1 cursor-pointer text-[11px] text-slate-700 hover:bg-blue-50 hover:text-blue-700 transition-colors"
                            >
                                <span className="w-1 h-1 rounded-full bg-slate-400 shrink-0" />
                                <span className="font-semibold truncate flex-1">{mod.moduleName}</span>
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
                                    1: { dot: 'bg-blue-500', text: 'text-slate-700 font-semibold', size: 'text-[11px]' },
                                    2: { dot: 'bg-blue-400', text: 'text-slate-600 font-medium', size: 'text-[10px]' },
                                    3: { dot: 'bg-slate-400', text: 'text-slate-500', size: 'text-[9px]' },
                                    4: { dot: 'bg-slate-300', text: 'text-slate-400', size: 'text-[9px]' },
                                };
                                const style = levelStyles[h.level] || levelStyles[4];
                                return (
                                    <div
                                        key={`${mod.moduleId}-h-${idx}`}
                                        onClick={() => handleScrollToHeading(mod.moduleId, h)}
                                        className={`flex items-center gap-1 py-0.5 cursor-pointer hover:text-blue-600 hover:bg-blue-50/50 transition-colors ${style.text} ${style.size}`}
                                        style={{ paddingLeft: `${8 + h.level * 10}px` }}
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
