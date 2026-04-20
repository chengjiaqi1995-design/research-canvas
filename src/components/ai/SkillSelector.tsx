import { memo, useState, useRef, useCallback } from 'react';
import { ChevronDown, FileCode2, Upload, Trash2, CheckCircle2 } from 'lucide-react';
import { useAICardStore } from '../../stores/aiCardStore.ts';

interface SkillSelectorProps {
  selectedSkillId?: string;
  onSelect: (skillId?: string) => void;
  disabled?: boolean;
}

export const SkillSelector = memo(function SkillSelector({ selectedSkillId, onSelect, disabled }: SkillSelectorProps) {
  const [open, setOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const skills = useAICardStore((s) => s.skills);
  const addSkill = useAICardStore((s) => s.addSkill);
  const removeSkill = useAICardStore((s) => s.removeSkill);

  const handleFileUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const content = event.target?.result as string;
      if (content) {
        addSkill({
          name: file.name.replace(/\.[^/.]+$/, ""), // remove extension
          description: '从本地文件上传',
          content,
        });
      }
      // Reset input
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    };
    reader.readAsText(file);
  }, [addSkill]);

  const handleDelete = useCallback((id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (confirm('确定删除此方法论？删除后将无法恢复。')) {
      removeSkill(id);
      if (selectedSkillId === id) {
        onSelect(undefined);
      }
    }
  }, [removeSkill, selectedSkillId, onSelect]);

  const selectedSkill = skills.find(s => s.id === selectedSkillId);

  return (
    <div className="relative w-full">
      <button
        onClick={() => !disabled && setOpen(!open)}
        disabled={disabled}
        className={`flex items-center justify-between w-full px-2.5 py-1.5 text-xs text-left border rounded transition-colors ${
          disabled ? 'opacity-50 cursor-not-allowed bg-slate-50 border-slate-200 text-slate-400' :
          selectedSkillId ? 'bg-blue-50 border-blue-200 text-blue-900' : 'bg-white border-slate-200 text-slate-600 hover:border-slate-300'
        }`}
      >
        <span className="flex items-center gap-1.5 truncate">
          <FileCode2 size={12} className={selectedSkillId ? "text-amber-600" : "text-slate-400"} />
          <span className="truncate">{selectedSkill ? selectedSkill.name : '未挂载方法论 (可选)'}</span>
        </span>
        <ChevronDown size={11} className={`text-slate-400 transition-transform flex-shrink-0 ml-2 ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute left-0 right-0 top-8 z-50 bg-white rounded shadow-xl border border-slate-200 py-1 max-h-[250px] flex flex-col">
            
            <div className="px-2 py-1.5 border-b border-slate-100 shrink-0">
              <button
                onClick={() => fileInputRef.current?.click()}
                className="flex items-center justify-center gap-1.5 w-full px-2 py-1.5 text-xs text-blue-900 bg-blue-50 hover:bg-blue-100 rounded transition-colors font-medium border border-blue-200/60"
              >
                <Upload size={12} />
                上传新方法论 (.md/.txt/.skill)
              </button>
              <input
                type="file"
                ref={fileInputRef}
                onChange={handleFileUpload}
                className="hidden"
              />
            </div>

            <div className="flex-1 overflow-y-auto overflow-x-hidden p-1">
              <button
                onClick={() => {
                  onSelect(undefined);
                  setOpen(false);
                }}
                className={`flex items-center justify-between w-full px-2 py-1.5 text-xs rounded transition-colors ${
                  !selectedSkillId ? 'bg-slate-100 text-slate-800 font-medium' : 'text-slate-600 hover:bg-slate-50'
                }`}
              >
                <div className="flex items-center gap-2">
                  <div className="w-3" />
                  无方法论
                </div>
                {!selectedSkillId && <CheckCircle2 size={12} className="text-slate-400" />}
              </button>

              {skills.map((skill) => (
                <div
                  key={skill.id}
                  className={`flex items-center justify-between group w-full px-2 py-1.5 text-xs rounded transition-colors cursor-pointer ${
                    selectedSkillId === skill.id ? 'bg-blue-50 text-blue-900 font-semibold' : 'text-slate-700 hover:bg-slate-50'
                  }`}
                  onClick={() => {
                    onSelect(skill.id);
                    setOpen(false);
                  }}
                >
                  <div className="flex items-center gap-2 overflow-hidden">
                    <div className="w-3 shrink-0 flex items-center justify-center">
                      {selectedSkillId === skill.id && <CheckCircle2 size={12} className="text-amber-600" />}
                    </div>
                    <div className="flex flex-col items-start min-w-0">
                      <span className="truncate max-w-[150px]">{skill.name}</span>
                      {skill.description && (
                         <span className="text-[9px] text-slate-400 font-normal truncate max-w-[150px]">{skill.description}</span>
                      )}
                    </div>
                  </div>
                  <button
                    onClick={(e) => handleDelete(skill.id, e)}
                    className="opacity-0 group-hover:opacity-100 p-1 text-slate-300 hover:text-red-500 transition-opacity shrink-0"
                    title="删除"
                  >
                    <Trash2 size={11} />
                  </button>
                </div>
              ))}

              {skills.length === 0 && (
                <div className="px-3 py-4 text-center text-[10px] text-slate-400">
                  暂无保存的方法论
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
});
