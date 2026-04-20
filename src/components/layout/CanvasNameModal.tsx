import { useState, useRef, useEffect, useCallback } from 'react';
import { Sparkles, Loader2, X, Building2, BookOpen, Users, TrendingUp } from 'lucide-react';
import { aiApi } from '../../db/apiClient.ts';
import { INDUSTRY_COMPANIES } from '../../constants/industryCategories.ts';
import { getApiConfig } from '../../aiprocess/components/ApiConfigModal.tsx';
import { IconButton, PrimaryButton, TextInput } from '../ui/index.ts';

interface CanvasNameModalProps {
  open: boolean;
  workspaceName: string; // Parent workspace/folder name for context
  onConfirm: (name: string) => void;
  onClose: () => void;
}

// Collect sample company names for AI prompt context
const SAMPLE_COMPANIES: string[] = [];
for (const companies of Object.values(INDUSTRY_COMPANIES)) {
  for (const c of companies) {
    if (c.startsWith('[') && SAMPLE_COMPANIES.length < 30) {
      SAMPLE_COMPANIES.push(c);
    }
  }
}

type CanvasType = 'company' | '行业研究' | 'Expert' | 'Sellside';

const TYPE_OPTIONS: { key: CanvasType; label: string; icon: typeof Building2; desc: string }[] = [
  { key: 'company', label: '公司', icon: Building2, desc: '输入公司名，AI生成规范名称' },
  { key: '行业研究', label: '行业研究', icon: BookOpen, desc: '行业研究画布' },
  { key: 'Expert', label: 'Expert', icon: Users, desc: '专家访谈画布' },
  { key: 'Sellside', label: 'Sellside', icon: TrendingUp, desc: '卖方研究画布' },
];

export default function CanvasNameModal({ open, workspaceName, onConfirm, onClose }: CanvasNameModalProps) {
  const [selectedType, setSelectedType] = useState<CanvasType>('company');
  const [companyInput, setCompanyInput] = useState('');
  const [generatedName, setGeneratedName] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [customName, setCustomName] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Focus input when modal opens or type changes
  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 100);
      // Reset state
      setSelectedType('company');
      setCompanyInput('');
      setGeneratedName('');
      setCustomName('');
      setIsGenerating(false);
    }
  }, [open]);

  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [selectedType, open]);

  // Cleanup abort on unmount
  useEffect(() => {
    return () => { abortRef.current?.abort(); };
  }, []);

  const handleGenerateName = useCallback(async () => {
    if (!companyInput.trim() || isGenerating) return;

    setIsGenerating(true);
    setGeneratedName('');

    if (abortRef.current) abortRef.current.abort();
    abortRef.current = new AbortController();

    try {
      const systemPrompt = `你是一个金融研究助手。根据用户输入的公司名称，生成规范的公司画布名称。

命名规则：
- 上市公司格式：[股票代码 交易所] 公司全称
  - 美股：[TICKER US] Company Full Name，如 [DE US] Deere & Company
  - 港股：[代码 HK] 公司全称，如 [0669 HK] 创科实业有限公司
  - A股：[6位代码 CH] 公司全称，如 [600031 CH] 三一重工
  - 日股：[4位代码 JP] Company Name，如 [6506 JP] Yaskawa
  - 印度：[代码 IN] Company Name，如 [BEL IN] Bharat Electronics Ltd.
  - 欧洲：[代码 交易所] Company Name，如 [SHA GY] Schaeffler AG
- 非上市公司格式：[Private] 公司名称，如 [Private] SpaceX
- 中国公司用中文全称，外国公司用英文全称
- 不要加引号

现有公司命名参考：
${SAMPLE_COMPANIES.slice(0, 20).join('\n')}

只输出一个最规范的名称，不要任何解释。`;

      const config = getApiConfig();
      const namingModel = config.namingModel || 'gemini-3-flash-preview';

      let result = '';
      for await (const event of aiApi.chatStream({
        model: namingModel,
        messages: [{ role: 'user', content: `公司名：${companyInput.trim()}\n所属行业文件夹：${workspaceName}` }],
        systemPrompt,
      })) {
        if (event.type === 'text' && event.content) {
          result += event.content;
        }
      }

      const cleaned = result.trim().replace(/^["']|["']$/g, '');
      setGeneratedName(cleaned);
      setCustomName(cleaned);
    } catch (err: any) {
      if (err.name !== 'AbortError') {
        console.error('AI name generation failed:', err);
        // Fallback: just use the input as-is
        setGeneratedName(companyInput.trim());
        setCustomName(companyInput.trim());
      }
    } finally {
      setIsGenerating(false);
    }
  }, [companyInput, isGenerating, workspaceName]);

  const handleConfirm = useCallback(() => {
    if (selectedType === 'company') {
      const name = customName.trim() || companyInput.trim();
      if (name) onConfirm(name);
    } else {
      // For non-company types, use the type name directly
      onConfirm(selectedType);
    }
    onClose();
  }, [selectedType, customName, companyInput, onConfirm, onClose]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      onClose();
    }
  }, [onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-slate-900/40"
      onClick={onClose}
      onKeyDown={handleKeyDown}
    >
      <div
        className="bg-white rounded shadow-xl border border-slate-200 w-[420px] max-h-[80vh] overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200 bg-slate-50">
          <div>
            <h3 className="text-xs font-semibold text-slate-700">新建画布</h3>
            <p className="text-[11px] text-slate-400 mt-0.5">在「{workspaceName}」下创建</p>
          </div>
          <IconButton onClick={onClose} title="关闭">
            <X size={14} />
          </IconButton>
        </div>

        {/* Type selector */}
        <div className="px-4 py-3 border-b border-slate-100">
          <p className="text-[11px] text-slate-500 mb-2 font-medium">选择画布类型</p>
          <div className="grid grid-cols-4 gap-1.5">
            {TYPE_OPTIONS.map(({ key, label, icon: Icon }) => (
              <button
                key={key}
                onClick={() => {
                  setSelectedType(key);
                  setGeneratedName('');
                  setCustomName('');
                }}
                className={`flex flex-col items-center gap-1 py-2 px-1 rounded border text-[11px] transition-colors ${
                  selectedType === key
                    ? 'border-blue-200 bg-blue-50 text-blue-700 font-medium'
                    : 'border-slate-200 text-slate-500 hover:bg-slate-50'
                }`}
              >
                <Icon size={14} />
                <span className="truncate w-full text-center">{label}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Content area */}
        <div className="px-4 py-3">
          {selectedType === 'company' ? (
            <div className="space-y-3">
              {/* Company input + AI button */}
              <div>
                <label className="text-[11px] text-slate-500 font-medium mb-1 block">输入公司名称</label>
                <div className="flex gap-1.5">
                  <TextInput
                    ref={inputRef}
                    value={companyInput}
                    onChange={(e) => setCompanyInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        if (generatedName || customName) {
                          handleConfirm();
                        } else {
                          handleGenerateName();
                        }
                      }
                    }}
                    placeholder="如: 三一重工、Tesla、SpaceX..."
                    className="flex-1"
                  />
                  <PrimaryButton
                    onClick={handleGenerateName}
                    disabled={!companyInput.trim() || isGenerating}
                    icon={isGenerating ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />}
                  >
                    {isGenerating ? '生成中' : 'AI命名'}
                  </PrimaryButton>
                </div>
              </div>

              {/* Generated/editable name */}
              {(generatedName || customName) && (
                <div>
                  <label className="text-[11px] text-emerald-600 font-medium mb-1 block flex items-center gap-1">
                    <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-500" />
                    规范名称（可编辑）
                  </label>
                  <TextInput
                    value={customName}
                    onChange={(e) => setCustomName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleConfirm();
                    }}
                    className="w-full border-emerald-200 bg-emerald-50/40"
                  />
                </div>
              )}

              {/* Hint */}
              <p className="text-[10px] text-slate-400">
                输入简称后点击「AI命名」自动生成规范名称，如 <code className="bg-slate-100 px-1 rounded">[TSLA US] TESLA ORD</code>
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              <p className="text-xs text-slate-600">
                将创建名为 <span className="font-semibold text-blue-700">「{selectedType}」</span> 的画布
              </p>
              <p className="text-[11px] text-slate-400">
                {selectedType === '行业研究' && '用于存放行业研究报告、数据和分析'}
                {selectedType === 'Expert' && '用于存放专家访谈记录和笔记'}
                {selectedType === 'Sellside' && '用于存放卖方研究报告和观点'}
              </p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-slate-100 bg-slate-50">
          <PrimaryButton variant="secondary" onClick={onClose}>
            取消
          </PrimaryButton>
          <PrimaryButton
            onClick={handleConfirm}
            disabled={selectedType === 'company' && !customName.trim() && !companyInput.trim()}
          >
            创建
          </PrimaryButton>
        </div>
      </div>
    </div>
  );
}
