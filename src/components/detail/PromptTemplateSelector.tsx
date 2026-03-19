import { memo, useState } from 'react';
import { ChevronDown, BookOpen } from 'lucide-react';
import { PROMPT_TEMPLATES } from '../../constants/promptTemplates.ts';
import type { PromptTemplate } from '../../types/index.ts';

interface PromptTemplateSelectorProps {
  onSelect: (template: PromptTemplate) => void;
}

export const PromptTemplateSelector = memo(function PromptTemplateSelector({ onSelect }: PromptTemplateSelectorProps) {
  const [open, setOpen] = useState(false);

  const categories = [
    { key: 'analysis', label: '分析' },
    { key: 'summary', label: '摘要' },
    { key: 'comparison', label: '对比' },
    { key: 'research', label: '研究' },
  ] as const;

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
          <div className="absolute left-0 top-8 z-50 w-72 bg-white rounded-lg shadow-xl border border-slate-200 py-1 max-h-[400px] overflow-y-auto">
            {categories.map((cat) => {
              const templates = PROMPT_TEMPLATES.filter((t) => t.category === cat.key);
              if (templates.length === 0) return null;
              return (
                <div key={cat.key}>
                  <div className="px-3 py-1 text-[10px] font-semibold text-slate-400 uppercase tracking-wider">
                    {cat.label}
                  </div>
                  {templates.map((tpl) => (
                    <button
                      key={tpl.id}
                      onClick={() => {
                        onSelect(tpl);
                        setOpen(false);
                      }}
                      className="w-full text-left px-3 py-2 hover:bg-violet-50 transition-colors"
                    >
                      <div className="text-xs font-medium text-slate-700">{tpl.name}</div>
                      <div className="text-[10px] text-slate-400 mt-0.5">{tpl.description}</div>
                    </button>
                  ))}
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
});
