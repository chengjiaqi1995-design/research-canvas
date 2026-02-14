import { memo, useEffect, useCallback, useState } from 'react';
import { Plus, ArrowRight, CheckSquare, Square } from 'lucide-react';
import { useAIResearchStore } from '../../stores/aiResearchStore.ts';
import { useCanvasStore } from '../../stores/canvasStore.ts';
import { useWorkspaceStore } from '../../stores/workspaceStore.ts';
import { generateId } from '../../utils/id.ts';
import { AIPanelCard } from './AIPanelCard.tsx';

export const AIResearchView = memo(function AIResearchView() {
    const panels = useAIResearchStore((s) => s.panels);
    const addPanel = useAIResearchStore((s) => s.addPanel);
    const loadModels = useAIResearchStore((s) => s.loadModels);
    const selectAllPanels = useAIResearchStore((s) => s.selectAllPanels);
    const updatePanel = useAIResearchStore((s) => s.updatePanel);

    const addNode = useCanvasStore((s) => s.addNode);
    const currentCanvasId = useWorkspaceStore((s) => s.currentCanvasId);

    const [merging, setMerging] = useState(false);

    // Load models on mount
    useEffect(() => {
        loadModels();
    }, [loadModels]);

    // Add initial panel if empty
    useEffect(() => {
        if (panels.length === 0) {
            addPanel();
        }
    }, [panels.length, addPanel]);

    const selectedPanels = panels.filter((p) => p.selected);
    const allSelected = panels.length > 0 && panels.every((p) => p.selected);

    const handleMergeToCanvas = useCallback(() => {
        if (selectedPanels.length === 0 || !currentCanvasId) return;

        setMerging(true);

        // Build merged Markdown content
        const sections = selectedPanels.map((p) => {
            const title = p.title || '未命名';
            const content = (p.editedResponse || p.response || '').trim();
            return `# ${title}\n\n${content}`;
        });
        const mergedContent = sections.join('\n\n---\n\n');

        // Create a new text node on the canvas
        const nodeId = generateId();
        const existingNodes = useCanvasStore.getState().nodes;
        const yOffset = existingNodes.length * 50;

        addNode({
            id: nodeId,
            type: 'text',
            position: { x: 100, y: 100 + yOffset },
            data: {
                type: 'text',
                title: `AI 研究 - ${new Date().toLocaleDateString('zh-CN')}`,
                content: mergedContent,
            },
        });

        setMerging(false);
    }, [selectedPanels, currentCanvasId, addNode]);

    return (
        <div className="flex flex-col h-full bg-gradient-to-b from-slate-50 to-slate-100">
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 bg-white/80 backdrop-blur-sm shrink-0">
                <div>
                    <h2 className="text-lg font-semibold text-slate-800">🔬 AI 研究</h2>
                    <p className="text-xs text-slate-500 mt-0.5">
                        多问题并行查询，合并导入到 Canvas
                    </p>
                </div>
                <button
                    onClick={() => addPanel()}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg transition-colors shadow-sm"
                >
                    <Plus size={14} />
                    添加问题
                </button>
            </div>

            {/* Scrollable panels area */}
            <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
                {panels.map((panel) => (
                    <AIPanelCard key={panel.id} panel={panel} />
                ))}

                {/* Add panel placeholder */}
                <button
                    onClick={() => addPanel()}
                    className="w-full py-6 border-2 border-dashed border-slate-300 rounded-xl text-slate-400 hover:text-indigo-600 hover:border-indigo-300 transition-colors flex items-center justify-center gap-2 text-sm"
                >
                    <Plus size={16} />
                    添加新问题面板
                </button>
            </div>

            {/* Merge-to-Canvas bar */}
            {panels.length > 0 && (
                <div className="shrink-0 px-6 py-3 border-t border-slate-200 bg-white/90 backdrop-blur-sm">
                    <div className="flex items-center gap-4">
                        {/* Select all */}
                        <button
                            onClick={() => selectAllPanels(!allSelected)}
                            className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-700 transition-colors"
                        >
                            {allSelected ? <CheckSquare size={14} className="text-indigo-600" /> : <Square size={14} />}
                            全选
                        </button>

                        {/* Panel checkboxes */}
                        <div className="flex items-center gap-2 flex-1 overflow-x-auto">
                            {panels.map((p) => (
                                <button
                                    key={p.id}
                                    onClick={() => updatePanel(p.id, { selected: !p.selected })}
                                    className={`flex items-center gap-1 px-2 py-1 text-xs rounded-md border transition-colors whitespace-nowrap ${p.selected
                                        ? 'bg-indigo-50 border-indigo-300 text-indigo-700'
                                        : 'bg-white border-slate-200 text-slate-500 hover:border-slate-300'
                                        }`}
                                >
                                    {p.selected ? <CheckSquare size={12} /> : <Square size={12} />}
                                    {p.title}
                                </button>
                            ))}
                        </div>

                        {/* Merge button */}
                        <button
                            onClick={handleMergeToCanvas}
                            disabled={selectedPanels.length === 0 || !currentCanvasId || merging}
                            className="flex items-center gap-1.5 px-4 py-2 text-sm text-white bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-700 hover:to-purple-700 rounded-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-sm whitespace-nowrap"
                        >
                            <ArrowRight size={14} />
                            合并导入到 Canvas ({selectedPanels.length})
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
});
