import { memo, useState, useCallback } from 'react';
import { ChevronDown, BookOpen, Plus, Trash2, X, Save } from 'lucide-react';
import { PROMPT_TEMPLATES } from '../../constants/promptTemplates.ts';
import { useAICardStore } from '../../stores/aiCardStore.ts';
import type { PromptTemplate } from '../../types/index.ts';

interface PromptTemplateSelectorProps {
  onSelect: (template: PromptTemplate) => void;
}

/** Modal for adding / editing a custom template */
function TemplateEditor({
  initial,
  onSave,
  onCancel,
}: {
  initial?: PromptTemplate;
  onSave: (data: { name: string; description: string; prompt: string; category: PromptTemplate['category'] }) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(initial?.name ?? '');
  const [description, setDescription] = useState(initial?.description ?? '');
  const [prompt, setPrompt] = useState(initial?.prompt ?? '');
  const [category, setCategory] = useState<PromptTemplate['category']>(initial?.category ?? 'custom');

  const categories: { value: PromptTemplate['category']; label: string }[] = [
    { value: 'analysis', label: '分析' },
    { value: 'summary', label: '摘要' },
    { value: 'comparison', label: '对比' },
    { value: 'research', label: '研究' },
    { value: 'custom', label: '自定义' },
  ];

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/30" onClick={onCancel}>
      <div className="bg-white rounded-xl shadow-2xl border border-slate-200 w-[520px] max-h-[80vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200 shrink-0">
          <span className="text-sm font-semibold text-slate-800">
            {initial ? '编辑模板' : '新建 Prompt 模板'}
          </span>
          <button onClick={onCancel} className="p-1 rounded hover:bg-slate-100 text-slate-400">
            <X size={16} />
          </button>
        </div>

        {/* Form */}
        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
          <div>
            <label className="text-xs font-medium text-slate-600 mb-1 block">名称</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="模板名称"
              className="w-full text-sm border border-slate-200 rounded-md px-3 py-2 focus:outline-none focus:border-blue-400"
            />
          </div>

          <div>
            <label className="text-xs font-medium text-slate-600 mb-1 block">描述</label>
            <input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="简短描述模板用途"
              className="w-full text-sm border border-slate-200 rounded-md px-3 py-2 focus:outline-none focus:border-blue-400"
            />
          </div>

          <div>
            <label className="text-xs font-medium text-slate-600 mb-1 block">分类</label>
            <div className="flex gap-1 flex-wrap">
              {categories.map((cat) => (
                <button
                  key={cat.value}
                  onClick={() => setCategory(cat.value)}
                  className={`px-2.5 py-1 text-xs rounded-md transition-colors ${
                    category === cat.value
                      ? 'bg-blue-100 text-blue-700 border border-blue-300'
                      : 'bg-slate-100 text-slate-500 border border-transparent hover:bg-slate-200'
                  }`}
                >
                  {cat.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="text-xs font-medium text-slate-600 mb-1 block">
              Prompt 内容
              <span className="text-slate-400 font-normal ml-1">（可用 {'{context}'} 作为资料占位符）</span>
            </label>
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="输入 Prompt 内容..."
              className="w-full h-48 text-sm border border-slate-200 rounded-md px-3 py-2 resize-y focus:outline-none focus:border-blue-400 font-mono"
            />
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-slate-200 shrink-0">
          <button
            onClick={onCancel}
            className="px-3 py-1.5 text-xs text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-md transition-colors"
          >
            取消
          </button>
          <button
            onClick={() => {
              if (!name.trim() || !prompt.trim()) return;
              onSave({ name: name.trim(), description: description.trim(), prompt, category });
            }}
            disabled={!name.trim() || !prompt.trim()}
            className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Save size={12} />
            保存
          </button>
        </div>
      </div>
    </div>
  );
}

export const PromptTemplateSelector = memo(function PromptTemplateSelector({ onSelect }: PromptTemplateSelectorProps) {
  const [open, setOpen] = useState(false);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<PromptTemplate | undefined>(undefined);

  const customTemplates = useAICardStore((s) => s.customTemplates);
  const addCustomTemplate = useAICardStore((s) => s.addCustomTemplate);
  const updateCustomTemplate = useAICardStore((s) => s.updateCustomTemplate);
  const removeCustomTemplate = useAICardStore((s) => s.removeCustomTemplate);

  const builtinCategories = [
    { key: 'analysis', label: '分析' },
    { key: 'summary', label: '摘要' },
    { key: 'comparison', label: '对比' },
    { key: 'research', label: '研究' },
  ] as const;

  const allCategories = [
    ...builtinCategories,
    { key: 'custom' as const, label: '自定义' },
  ];

  const handleSave = useCallback((data: { name: string; description: string; prompt: string; category: PromptTemplate['category'] }) => {
    if (editingTemplate) {
      updateCustomTemplate(editingTemplate.id, data);
    } else {
      addCustomTemplate(data);
    }
    setEditorOpen(false);
    setEditingTemplate(undefined);
  }, [editingTemplate, addCustomTemplate, updateCustomTemplate]);

  const handleEdit = useCallback((tpl: PromptTemplate) => {
    setEditingTemplate(tpl);
    setEditorOpen(true);
    setOpen(false);
  }, []);

  const handleDelete = useCallback((id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (confirm('确定删除此模板？')) {
      removeCustomTemplate(id);
    }
  }, [removeCustomTemplate]);

  // Merge built-in + custom templates
  const allTemplates = [...PROMPT_TEMPLATES, ...customTemplates];

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1 px-2 py-1 text-xs text-slate-600 bg-slate-100 hover:bg-slate-200 rounded transition-colors"
      >
        <BookOpen size={11} />
        模板
        <ChevronDown size={10} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-8 z-50 w-80 bg-white rounded-md shadow-xl border border-slate-200 py-1 max-h-[400px] overflow-y-auto">
            {/* Add template button */}
            <div className="px-3 py-1.5 border-b border-slate-100">
              <button
                onClick={() => {
                  setEditingTemplate(undefined);
                  setEditorOpen(true);
                  setOpen(false);
                }}
                className="flex items-center gap-1.5 w-full px-2 py-1.5 text-xs text-blue-600 hover:bg-blue-50 rounded-md transition-colors"
              >
                <Plus size={12} />
                新建自定义模板
              </button>
            </div>

            {allCategories.map((cat) => {
              const templates = allTemplates.filter((t) => t.category === cat.key);
              if (templates.length === 0) return null;
              return (
                <div key={cat.key}>
                  <div className="px-3 py-1 text-[10px] font-semibold text-slate-400 uppercase tracking-wider">
                    {cat.label}
                  </div>
                  {templates.map((tpl) => {
                    const isCustom = tpl.id.startsWith('custom_');
                    return (
                      <div
                        key={tpl.id}
                        className="flex items-center group hover:bg-blue-50 transition-colors"
                      >
                        <button
                          onClick={() => {
                            onSelect(tpl);
                            setOpen(false);
                          }}
                          className="flex-1 text-left px-3 py-2 min-w-0"
                        >
                          <div className="text-xs font-medium text-slate-700 truncate">{tpl.name}</div>
                          <div className="text-[10px] text-slate-400 mt-0.5 truncate">{tpl.description}</div>
                        </button>
                        {isCustom && (
                          <div className="flex items-center gap-0.5 pr-2 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleEdit(tpl);
                              }}
                              className="p-1 text-slate-400 hover:text-blue-500 rounded"
                              title="编辑"
                            >
                              <BookOpen size={11} />
                            </button>
                            <button
                              onClick={(e) => handleDelete(tpl.id, e)}
                              className="p-1 text-slate-400 hover:text-red-500 rounded"
                              title="删除"
                            >
                              <Trash2 size={11} />
                            </button>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </>
      )}

      {/* Template editor modal */}
      {editorOpen && (
        <TemplateEditor
          initial={editingTemplate}
          onSave={handleSave}
          onCancel={() => {
            setEditorOpen(false);
            setEditingTemplate(undefined);
          }}
        />
      )}
    </div>
  );
});
