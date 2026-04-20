import { memo, useState, useCallback, useEffect } from 'react';
import { Plus, Trash2, X, GripVertical, ChevronDown, ChevronRight } from 'lucide-react';
import { useIndustryCategoryStore } from '../../stores/industryCategoryStore.ts';
import { resolveIcon, AVAILABLE_ICONS, type IndustryCategory } from '../../constants/industryCategories.ts';
import { useWorkspaceStore } from '../../stores/workspaceStore.ts';

interface IndustryCategoryManagerProps {
  open: boolean;
  onClose: () => void;
}

export const IndustryCategoryManager = memo(function IndustryCategoryManager({ open, onClose }: IndustryCategoryManagerProps) {
  const categories = useIndustryCategoryStore((s) => s.categories);
  const saveCategories = useIndustryCategoryStore((s) => s.saveCategories);

  const workspaces = useWorkspaceStore((s) => s.workspaces);
  const createWorkspace = useWorkspaceStore((s) => s.createWorkspace);
  const updateWorkspaceCategory = useWorkspaceStore((s) => s.updateWorkspaceCategory);

  const [editingCategories, setEditingCategories] = useState<IndustryCategory[]>([]);
  const [expandedIdx, setExpandedIdx] = useState<number | null>(null);
  const [newSubInput, setNewSubInput] = useState('');
  const [showIconPicker, setShowIconPicker] = useState<number | null>(null);
  const [newCatName, setNewCatName] = useState('');
  const [dirty, setDirty] = useState(false);

  // Initialize editing state when dialog opens
  useEffect(() => {
    if (open) {
      async function forceInitialize() {
        await useIndustryCategoryStore.getState().loadCategories(true);
        const latest = useIndustryCategoryStore.getState().categories;
        setEditingCategories(latest.map(c => ({ ...c, subCategories: [...c.subCategories] })));
        setDirty(false);
        setExpandedIdx(null);
        setNewSubInput('');
        setShowIconPicker(null);
        setNewCatName('');
      }
      forceInitialize();
    } else {
      setEditingCategories([]);
    }
  }, [open]);

  if (!open) return null;

  const updateCat = (idx: number, patch: Partial<IndustryCategory>) => {
    setEditingCategories(prev => {
      const next = [...prev];
      next[idx] = { ...next[idx], ...patch };
      return next;
    });
    setDirty(true);
  };

  const deleteCat = (idx: number) => {
    setEditingCategories(prev => prev.filter((_, i) => i !== idx));
    setDirty(true);
    if (expandedIdx === idx) setExpandedIdx(null);
  };

  const addCategory = () => {
    const name = newCatName.trim();
    if (!name) return;
    setEditingCategories(prev => [...prev, { label: name, icon: 'Folder', subCategories: [] }]);
    setNewCatName('');
    setDirty(true);
    setExpandedIdx(editingCategories.length);
  };

  const addSub = (catIdx: number) => {
    const sub = newSubInput.trim();
    if (!sub) return;
    setEditingCategories(prev => {
      const next = [...prev];
      if (!next[catIdx].subCategories.includes(sub)) {
        next[catIdx] = { ...next[catIdx], subCategories: [...next[catIdx].subCategories, sub] };
      }
      return next;
    });
    setNewSubInput('');
    setDirty(true);
  };

  const removeSub = (catIdx: number, subIdx: number) => {
    setEditingCategories(prev => {
      const next = [...prev];
      next[catIdx] = { ...next[catIdx], subCategories: next[catIdx].subCategories.filter((_, i) => i !== subIdx) };
      return next;
    });
    setDirty(true);
  };

  const handleSave = async () => {
    // 1. Sync category tree
    await saveCategories(editingCategories);

    // 2. Automatically generate Workspaces for new subcategories ensures they instantly appear in the sidebar
    for (const cat of editingCategories) {
      for (const sub of cat.subCategories) {
        // Use a fresh grab of workspaces state inside the loop
        const currentWorkspaces = useWorkspaceStore.getState().workspaces;
        const existingWs = currentWorkspaces.find(w => w.name.toLowerCase() === sub.toLowerCase());
        
        try {
          if (!existingWs) {
            // Auto-create folder
            const newWs = await useWorkspaceStore.getState().createWorkspace(sub, 'Folder', 'industry');
            await useWorkspaceStore.getState().updateWorkspaceCategory(newWs.id, 'industry', cat.label);
          } else if (existingWs.industryCategory !== cat.label || existingWs.category !== 'industry') {
            // If it exists but is unassigned or assigned incorrectly, snap it to this category
            await useWorkspaceStore.getState().updateWorkspaceCategory(existingWs.id, 'industry', cat.label);
          }
        } catch (err) {
          console.error("Auto-sync workspace failed for", sub, err);
        }
      }
    }

    // 3. Force reload from the backend to ensure the Sidebar picks up all creations and changes
    try {
      await useWorkspaceStore.getState().loadWorkspaces();
    } catch (e) {
      console.warn("Failed to reload workspaces", e);
    }

    setDirty(false);
    onClose();
  };

  const handleCancel = () => {
    setEditingCategories([]);
    setDirty(false);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/30" onClick={handleCancel}>
      <div
        className="bg-white rounded-xl shadow-2xl w-[520px] max-h-[80vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-slate-200">
          <h3 className="text-sm font-semibold text-slate-800">管理行业分类</h3>
          <button onClick={handleCancel} className="text-slate-400 hover:text-slate-600">
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-3 space-y-1">
          {editingCategories.map((cat, idx) => {
            const IconComp = resolveIcon(cat.icon);
            const isExpanded = expandedIdx === idx;

            return (
              <div key={idx} className="border border-slate-200 rounded-md overflow-hidden">
                {/* Category header */}
                <div className="flex items-center gap-2 px-3 py-2 bg-slate-50 hover:bg-slate-100 cursor-pointer"
                  onClick={() => setExpandedIdx(isExpanded ? null : idx)}
                >
                  {isExpanded ? <ChevronDown size={12} className="text-slate-400" /> : <ChevronRight size={12} className="text-slate-400" />}

                  {/* Icon button */}
                  <button
                    className="relative p-1 hover:bg-slate-200 rounded"
                    onClick={(e) => { e.stopPropagation(); setShowIconPicker(showIconPicker === idx ? null : idx); }}
                    title="更换图标"
                  >
                    <IconComp size={14} className="text-slate-500" />
                  </button>

                  {/* Icon picker dropdown */}
                  {showIconPicker === idx && (
                    <div className="absolute mt-8 bg-white border border-slate-200 rounded-md shadow-lg p-2 grid grid-cols-6 gap-1 z-50"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {AVAILABLE_ICONS.map(iconName => {
                        const IC = resolveIcon(iconName);
                        return (
                          <button
                            key={iconName}
                            className={`p-1.5 rounded hover:bg-slate-100 ${cat.icon === iconName ? 'bg-blue-100 ring-1 ring-blue-400' : ''}`}
                            onClick={() => { updateCat(idx, { icon: iconName }); setShowIconPicker(null); }}
                            title={iconName}
                          >
                            <IC size={14} />
                          </button>
                        );
                      })}
                    </div>
                  )}

                  {/* Editable label */}
                  <input
                    className="flex-1 text-xs font-medium bg-transparent border-b border-transparent focus:border-blue-400 outline-none px-1 py-0.5"
                    value={cat.label}
                    onClick={(e) => e.stopPropagation()}
                    onChange={(e) => updateCat(idx, { label: e.target.value })}
                  />

                  <span className="text-[10px] text-slate-400 mr-2">{cat.subCategories.length} 个子类</span>

                  <button
                    className="p-1 text-slate-400 hover:text-red-500"
                    onClick={(e) => { e.stopPropagation(); deleteCat(idx); }}
                    title="删除分类"
                  >
                    <Trash2 size={12} />
                  </button>
                </div>

                {/* Expanded: subcategories */}
                {isExpanded && (
                  <div className="px-3 py-2 space-y-1 bg-white">
                    {cat.subCategories.map((sub, subIdx) => (
                      <div key={subIdx} className="flex items-center gap-2 group">
                        <GripVertical size={10} className="text-slate-300" />
                        <span className="text-xs text-slate-600 flex-1">{sub}</span>
                        <button
                          className="p-0.5 text-slate-300 hover:text-red-500 opacity-0 group-hover:opacity-100"
                          onClick={() => removeSub(idx, subIdx)}
                        >
                          <X size={10} />
                        </button>
                      </div>
                    ))}
                    {/* Add subcategory */}
                    <div className="flex items-center gap-1 mt-1">
                      <input
                        className="flex-1 text-xs border border-slate-200 rounded px-2 py-1 outline-none focus:border-blue-400"
                        placeholder="添加子分类..."
                        value={expandedIdx === idx ? newSubInput : ''}
                        onChange={(e) => setNewSubInput(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter') addSub(idx); }}
                      />
                      <button
                        className="px-2 py-1 text-xs text-blue-600 hover:bg-blue-50 rounded"
                        onClick={() => addSub(idx)}
                      >
                        添加
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}

          {/* Add new category */}
          <div className="flex items-center gap-2 pt-2">
            <input
              className="flex-1 text-xs border border-slate-200 rounded px-2 py-1.5 outline-none focus:border-blue-400"
              placeholder="新大类名称..."
              value={newCatName}
              onChange={(e) => setNewCatName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') addCategory(); }}
            />
            <button
              className="flex items-center gap-1 px-3 py-1.5 text-xs text-white bg-blue-500 hover:bg-blue-600 rounded"
              onClick={addCategory}
              disabled={!newCatName.trim()}
            >
              <Plus size={12} /> 添加大类
            </button>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-slate-200">
          <button
            className="px-4 py-1.5 text-xs text-slate-600 hover:bg-slate-100 rounded"
            onClick={handleCancel}
          >
            取消
          </button>
          <button
            className={`px-4 py-1.5 text-xs text-white rounded ${dirty ? 'bg-blue-500 hover:bg-blue-600' : 'bg-slate-300 cursor-not-allowed'}`}
            onClick={handleSave}
            disabled={!dirty}
          >
            保存
          </button>
        </div>
      </div>
    </div>
  );
});
