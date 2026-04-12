import React, { useState, useCallback, useMemo, useEffect } from 'react';
import { Tooltip, message } from 'antd';
import { SettingOutlined } from '@ant-design/icons';
import { Sparkles, Loader2, X } from 'lucide-react';
import { aiApi } from '../../db/apiClient';
import { getApiConfig } from '../../aiprocess/components/ApiConfigModal';
import { useIndustryCategoryStore } from '../../stores/industryCategoryStore';
import {
  DEFAULT_METADATA_FILL_PROMPT,
  SAMPLE_COMPANIES,
  getMetadataFillPrompt,
  saveMetadataFillPrompt,
  syncMetadataFillPrompt,
  sampleTextChunks,
  guardSingleOrg,
  aiNormalizeCompanyName,
} from '../../utils/metadataFillPrompt';

export interface CanvasMetadata {
  topic?: string;
  organization?: string;
  speaker?: string;
  participants?: string;
  intermediary?: string;
  industry?: string;
  country?: string;
  eventDate?: string;
  // Fallbacks for legacy canvas metadata keys that might be in Chinese
  公司?: string;
  行业?: string;
  参与人?: string;
  中介?: string;
  国家?: string;
  发生日期?: string;
}

interface CanvasMetadataEditorProps {
  initialMetadata: Record<string, string>;
  textContent: string;
  createdAt: number;
  onSave: (newMetadata: Record<string, string>) => void;
  onClose: () => void;
}

export const CanvasMetadataEditor: React.FC<CanvasMetadataEditorProps> = ({
  initialMetadata,
  textContent,
  createdAt,
  onSave,
  onClose,
}) => {
  const industryCategories = useIndustryCategoryStore((s) => s.categories);
  const CANVAS_INDUSTRIES = useMemo(() =>
    industryCategories.flatMap(cat => cat.subCategories.map(sub => ({ group: cat.label, name: sub }))),
    [industryCategories]
  );
  const INDUSTRY_OPTIONS_STR = useMemo(() =>
    industryCategories.flatMap(cat => cat.subCategories).join('、'),
    [industryCategories]
  );

  const [aiLoading, setAiLoading] = useState(false);
  const [namingLoading, setNamingLoading] = useState(false);
  const [showPromptSettings, setShowPromptSettings] = useState(false);
  const [promptDraft, setPromptDraft] = useState('');

  // Bidirectional sync metadataFillPrompt on mount
  useEffect(() => { syncMetadataFillPrompt(); }, []);

  const [edited, setEdited] = useState<CanvasMetadata>(() => {
    return {
      topic: initialMetadata.topic || initialMetadata.主题 || '',
      organization: initialMetadata.organization || initialMetadata.公司 || '',
      speaker: initialMetadata.speaker || initialMetadata.演讲人 || '',
      participants: initialMetadata.participants || initialMetadata.参与人 || '',
      intermediary: initialMetadata.intermediary || initialMetadata.中介 || '',
      industry: initialMetadata.industry || initialMetadata.行业 || '',
      country: initialMetadata.country || initialMetadata.国家 || '',
      eventDate: initialMetadata.eventDate || initialMetadata.发生日期 || '',
    };
  });

  const handleAiFill = useCallback(async () => {
    if (!textContent || textContent.length < 50) {
      message.warning('笔记内容过短，无法进行 AI 填充');
      return;
    }
    setAiLoading(true);

    try {
      const config = getApiConfig();
      const namingModel = config.metadataFillModel || config.summaryModel || 'gemini-3-flash-preview';

      const promptTemplate = getMetadataFillPrompt();
      const systemPrompt = promptTemplate
        .replace('{sampleCompanies}', SAMPLE_COMPANIES.slice(0, 10).join(', '))
        .replace('{industryOptions}', INDUSTRY_OPTIONS_STR);

      const sampledText = sampleTextChunks(textContent);
      const createdDate = new Date(createdAt).toLocaleDateString('zh-CN', { year: 'numeric', month: 'numeric', day: 'numeric' });

      let result = '';
      for await (const event of aiApi.chatStream({
        model: namingModel,
        messages: [{ role: 'user', content: `创建时间：${createdDate}\n\n笔记内容：\n${sampledText}` }],
        systemPrompt,
      })) {
        if (event.type === 'text' && event.content) {
          result += event.content;
        }
      }

      let cleanJson = result.trim();
      if (cleanJson.startsWith('```json')) cleanJson = cleanJson.substring(7);
      if (cleanJson.startsWith('```')) cleanJson = cleanJson.substring(3);
      if (cleanJson.endsWith('```')) cleanJson = cleanJson.substring(0, cleanJson.length - 3);
      cleanJson = cleanJson.trim();

      const parsed = JSON.parse(cleanJson);
      console.log('🔍 [MetadataFill V3] AI raw response:', JSON.stringify(parsed));
      const org = guardSingleOrg(parsed.organization || '');
      console.log('🔍 [MetadataFill V3] After guard:', { rawOrg: parsed.organization, guardedOrg: org });
      // Use AI result when field is present (even if empty = intentionally blank).
      // Only fallback to prev value when AI didn't return the field at all (undefined).
      setEdited(prev => ({
        ...prev,
        topic: parsed.topic !== undefined ? parsed.topic : prev.topic,
        organization: parsed.organization !== undefined ? guardSingleOrg(parsed.organization) : prev.organization,
        speaker: parsed.speaker !== undefined ? parsed.speaker : prev.speaker,
        participants: parsed.participants !== undefined ? parsed.participants : prev.participants,
        intermediary: parsed.intermediary !== undefined ? parsed.intermediary : prev.intermediary,
        industry: parsed.industry !== undefined ? parsed.industry : prev.industry,
        country: parsed.country !== undefined ? parsed.country : prev.country,
        eventDate: parsed.eventDate !== undefined ? parsed.eventDate : prev.eventDate,
      }));
      message.success('AI 已完成提取');
    } catch (e: any) {
      message.error(`AI 提取失败: ${e.message}`);
    } finally {
      setAiLoading(false);
    }
  }, [textContent, INDUSTRY_OPTIONS_STR]);

  const handleSave = () => {
    const finalMetadata: Record<string, string> = {
      ...initialMetadata,
      topic: edited.topic || '',
      公司: edited.organization || '', // Legacy sync for detail display
      organization: edited.organization || '',
      演讲人: edited.speaker || '',
      speaker: edited.speaker || '',
      参与人: edited.participants || '',
      participants: edited.participants || '',
      中介: edited.intermediary || '',
      intermediary: edited.intermediary || '',
      行业: edited.industry || '',
      industry: edited.industry || '',
      国家: edited.country || '',
      country: edited.country || '',
      发生日期: edited.eventDate || '',
      eventDate: edited.eventDate || '',
    };

    onSave(finalMetadata);
  };

  const inputClass = "w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-100 placeholder-slate-300";
  const selectClass = "w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-100 bg-white appearance-none";
  const labelClass = "text-[11px] text-slate-500 font-medium mb-1 block";

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/40"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-xl shadow-2xl w-[90vw] max-w-[1000px] max-h-[90vh] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-slate-100 shrink-0">
          <div>
            <h3 className="text-sm font-semibold text-slate-800">编辑元数据</h3>
            <p className="text-[11px] text-slate-400 mt-0.5">设置笔记的关键信息，可使用 AI 自动填充</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleAiFill}
              disabled={aiLoading}
              className="flex items-center gap-1 px-3 py-1.5 bg-blue-500 text-white text-xs rounded-lg hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors font-medium"
            >
              {aiLoading ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />}
              <span>{aiLoading ? '提取中...' : 'AI 填充'}</span>
            </button>
            <Tooltip title="AI 填充 Prompt 设置">
              <button
                onClick={() => { setPromptDraft(getMetadataFillPrompt()); setShowPromptSettings(true); }}
                className="p-1.5 rounded hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition-colors"
              >
                <SettingOutlined style={{ fontSize: 14 }} />
              </button>
            </Tooltip>
            <button onClick={onClose} className="p-1 rounded hover:bg-slate-100 text-slate-400">
              <X size={16} />
            </button>
          </div>
        </div>

        {/* Form Body */}
        {showPromptSettings ? (
          <div className="flex-1 overflow-y-auto px-5 py-4 bg-slate-50">
            <div className="flex items-center justify-between mb-3">
              <span className="text-[13px] font-semibold text-slate-700">模板设置</span>
              <button
                onClick={() => {
                  setPromptDraft(DEFAULT_METADATA_FILL_PROMPT);
                }}
                className="text-xs text-blue-500 hover:text-blue-600 font-medium"
              >
                恢复默认
              </button>
            </div>
            <p className="text-xs text-slate-500 mb-3">您可以修改 AI 填充的系统指令，以改变提取的内容格式。</p>
            <textarea
              className="w-full h-[60vh] text-sm font-mono leading-relaxed p-4 border border-slate-300 rounded-lg focus:outline-none focus:border-blue-400"
              value={promptDraft}
              onChange={(e) => setPromptDraft(e.target.value)}
            />
            <div className="flex justify-end mt-4 gap-2">
              <button
                className="px-4 py-1.5 text-xs text-slate-600 rounded-lg hover:bg-slate-200 transition-colors"
                onClick={() => setShowPromptSettings(false)}
              >
                取消
              </button>
              <button
                className="px-4 py-1.5 text-xs bg-slate-800 text-white rounded-lg hover:bg-slate-900 transition-colors"
                onClick={async () => {
                  await saveMetadataFillPrompt(promptDraft);
                  setShowPromptSettings(false);
                  message.success('Prompt 已保存并同步至云端');
                }}
              >
                保存模板设置
              </button>
            </div>
          </div>
        ) : (
          <div className="px-5 py-4 space-y-3 overflow-y-auto" style={{ maxHeight: '60vh' }}>
            {/* Topic */}
            <div>
              <label className={labelClass}>主题</label>
              <input
                value={edited.topic}
                onChange={(e) => setEdited(prev => ({ ...prev, topic: e.target.value }))}
                placeholder="主题名称"
                className={inputClass}
              />
            </div>

            {/* Company with AI naming */}
            <div>
              <label className={labelClass}>公司（规范名称）</label>
              <div className="flex gap-2">
                <input
                  value={edited.organization}
                  onChange={(e) => setEdited(prev => ({ ...prev, organization: e.target.value }))}
                  placeholder="如 三一重工、Tesla、SpaceX..."
                  className={inputClass + ' flex-1'}
                />
                <button
                  onClick={async () => {
                    if (!edited.organization?.trim() || namingLoading) return;
                    setNamingLoading(true);
                    try {
                      const result = await aiNormalizeCompanyName(edited.organization);
                      if (result) setEdited(prev => ({ ...prev, organization: result }));
                    } catch (e) { console.error('AI naming failed:', e); }
                    finally { setNamingLoading(false); }
                  }}
                  disabled={namingLoading || !edited.organization?.trim()}
                  className="flex items-center gap-1 px-3 py-1.5 bg-blue-50 text-blue-600 text-xs rounded-lg hover:bg-blue-100 disabled:opacity-40 disabled:cursor-not-allowed transition-colors whitespace-nowrap"
                >
                  {namingLoading ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />}
                  AI命名
                </button>
              </div>
              <p className="text-[10px] text-slate-400 mt-1">输入简称后点击「AI命名」自动生成规范名称，如 [TSLA US] Tesla</p>
            </div>

            {/* Speaker */}
            <div>
              <label className={labelClass}>演讲人</label>
              <input
                value={edited.speaker}
                onChange={(e) => setEdited(prev => ({ ...prev, speaker: e.target.value }))}
                placeholder="演讲人/嘉宾姓名，多位用逗号分隔"
                className={inputClass}
              />
            </div>

            {/* Participants */}
            <div>
              <label className={labelClass}>演讲人类型</label>
              <select
                value={edited.participants || ''}
                onChange={(e) => setEdited(prev => ({ ...prev, participants: e.target.value }))}
                className={selectClass}
              >
                <option value="">请选择</option>
                <option value="management">Management</option>
                <option value="expert">Expert</option>
                <option value="sellside">Sellside</option>
              </select>
            </div>

            {/* Intermediary */}
            <div>
              <label className={labelClass}>中介机构</label>
              <input
                value={edited.intermediary}
                onChange={(e) => setEdited(prev => ({ ...prev, intermediary: e.target.value }))}
                placeholder="券商、咨询公司等"
                className={inputClass}
              />
            </div>

            {/* Industry + Country */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelClass}>行业</label>
                <select
                  value={edited.industry || ''}
                  onChange={(e) => setEdited(prev => ({ ...prev, industry: e.target.value }))}
                  className={selectClass}
                >
                  <option value="">选择行业</option>
                  {CANVAS_INDUSTRIES.map(ind => (
                    <option key={ind.name} value={ind.name}>{ind.group} / {ind.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className={labelClass}>国家/地区</label>
                <select
                  value={edited.country || ''}
                  onChange={(e) => setEdited(prev => ({ ...prev, country: e.target.value }))}
                  className={selectClass}
                >
                  <option value="">选择国家</option>
                  <option value="中国">中国</option>
                  <option value="美国">美国</option>
                  <option value="日本">日本</option>
                  <option value="韩国">韩国</option>
                  <option value="欧洲">欧洲</option>
                  <option value="印度">印度</option>
                  <option value="其他">其他</option>
                </select>
              </div>
            </div>

            {/* EventDate + CreatedAt */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelClass}>发生时间</label>
                <input
                  value={edited.eventDate}
                  onChange={(e) => setEdited(prev => ({ ...prev, eventDate: e.target.value }))}
                  placeholder="如 2024/3/15"
                  className={inputClass}
                />
              </div>
              <div>
                <label className={labelClass}>创建时间</label>
                <input
                  value={new Date(createdAt).toLocaleDateString('zh-CN')}
                  disabled
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg bg-slate-50 text-slate-500 cursor-not-allowed"
                />
              </div>
            </div>
          </div>
        )}

        {/* Footer */}
        {!showPromptSettings && (
          <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-slate-100 bg-slate-50 shrink-0">
            <button
              onClick={onClose}
              className="px-4 py-1.5 text-xs text-slate-600 rounded-lg hover:bg-slate-200 transition-colors bg-white border border-slate-200 shadow-sm"
            >
              取消
            </button>
            <button
              onClick={handleSave}
              className="px-4 py-1.5 text-xs bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors font-medium shadow-sm"
            >
              保存
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
