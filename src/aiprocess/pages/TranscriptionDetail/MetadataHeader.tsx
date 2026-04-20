import React, { useState, useCallback, useMemo, useEffect } from 'react';
import {
  Button,
  Input,
  Modal,
  Select,
  Tooltip,
  Tag,
  message,
} from 'antd';
import {
  EditOutlined,
  SyncOutlined,
  CheckCircleOutlined,
  LoadingOutlined,
  CloseCircleOutlined,
  ReloadOutlined,
  SettingOutlined,
} from '@ant-design/icons';
import { Sparkles, Loader2, X } from 'lucide-react';
import type { Transcription } from '../../types';
import type { MetadataField, MetadataFormValues } from '../../hooks/useMetadataEditor';
import { useReadOnly } from '../../contexts/ReadOnlyContext';
import { aiApi } from '../../../db/apiClient';
import { getApiConfig } from '../../components/ApiConfigModal';
import { updateTranscriptionMetadata } from '../../api/transcription';
import { useIndustryCategoryStore } from '../../../stores/industryCategoryStore';
import styles from '../TranscriptionDetailPage.module.css';
import {
  DEFAULT_METADATA_FILL_PROMPT,
  SAMPLE_COMPANIES,
  getMetadataFillPrompt,
  saveMetadataFillPrompt,
  syncMetadataFillPrompt,
  sampleTextChunks,
  guardSingleOrg,
  aiNormalizeCompanyName,
} from '../../../utils/metadataFillPrompt';

interface MetadataHeaderProps {
  transcription: Transcription;
  setTranscription: React.Dispatch<React.SetStateAction<Transcription | null>>;
  loadTranscriptions: () => Promise<void>;
  // File name editing
  editingFileName: boolean;
  editedFileName: string;
  setEditedFileName: (v: string) => void;
  handleSaveFileName: () => void;
  handleStartEditFileName: () => void;
  handleCancelEditFileName: () => void;
  // Metadata modal
  showMetadataModal: boolean;
  editedMetadata: MetadataFormValues;
  setEditedMetadata: React.Dispatch<React.SetStateAction<MetadataFormValues>>;
  industries: string[];
  handleOpenMetadataModal: () => void;
  handleSaveMetadata: () => void;
  handleCloseMetadataModal: () => void;
  // Legacy single-field edit (kept for double-click)
  editingMetadata: MetadataField | null;
  handleStartEditMetadata: (field: MetadataField) => void;
  handleCancelEditMetadata: () => void;
  formatParticipants: (participants: string | undefined | null) => string;
  // Tags (inline in title row)
  tagsNode?: React.ReactNode;
  // Processing status
  onReprocess?: () => void;
}

const FIELD_LABELS: Record<MetadataField, string> = {
  topic: '主题',
  organization: '公司',
  intermediary: '中介',
  industry: '行业',
  country: '国家',
  participants: '演讲人类型',
  eventDate: '发生时间',
  speaker: '演讲人',
};

const MetadataHeader: React.FC<MetadataHeaderProps> = ({
  transcription,
  setTranscription,
  loadTranscriptions,
  editingFileName,
  editedFileName,
  setEditedFileName,
  handleSaveFileName,
  handleStartEditFileName,
  handleCancelEditFileName,
  showMetadataModal,
  editedMetadata,
  setEditedMetadata,
  industries,
  handleOpenMetadataModal,
  handleSaveMetadata,
  handleCloseMetadataModal,
  editingMetadata,
  handleStartEditMetadata,
  handleCancelEditMetadata,
  formatParticipants,
  tagsNode,
  onReprocess,
}) => {
  const { isReadOnly } = useReadOnly();
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

  // AI assist: fill metadata from transcript
  const handleAiFill = useCallback(async () => {
    if (!transcription?.transcriptText && !transcription?.summary) {
      message.warning('没有转录文本或总结内容，无法进行 AI 填充');
      return;
    }
    setAiLoading(true);

    try {
      const config = getApiConfig();
      const namingModel = config.metadataFillModel || config.namingModel || 'gemini-3-flash-preview';

      // Build prompt from template
      const promptTemplate = getMetadataFillPrompt();
      const systemPrompt = promptTemplate
        .replace('{sampleCompanies}', SAMPLE_COMPANIES.slice(0, 10).join(', '))
        .replace('{industryOptions}', INDUSTRY_OPTIONS_STR);

      // Sample 6 x 500-char chunks evenly from transcript
      const sampledText = sampleTextChunks(transcription.transcriptText || '');
      const createdDate = new Date(transcription.createdAt).toLocaleDateString('zh-CN', { year: 'numeric', month: 'numeric', day: 'numeric' });

      let result = '';
      for await (const event of aiApi.chatStream({
        model: namingModel,
        messages: [{ role: 'user', content: `创建时间：${createdDate}\n\n转录文本（采样片段）：\n${sampledText}` }],
        systemPrompt,
      })) {
        if (event.type === 'text' && event.content) {
          result += event.content;
        }
      }

      const jsonMatch = result.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        const fallbackDate = new Date(transcription.createdAt).toLocaleDateString('zh-CN', { year: 'numeric', month: 'numeric', day: 'numeric' });
        // Use AI result when field is present (even if empty string = intentionally blank).
        // Only fallback to existing DB value when AI didn't return the field at all (undefined).
        const metadata: MetadataFormValues = {
          topic: parsed.topic !== undefined ? parsed.topic : (transcription.topic || ''),
          organization: parsed.organization !== undefined ? guardSingleOrg(parsed.organization) : (transcription.organization || ''),
          speaker: parsed.speaker !== undefined ? parsed.speaker : (transcription.speaker || ''),
          participants: parsed.participants !== undefined ? parsed.participants : (transcription.participants || ''),
          intermediary: parsed.intermediary !== undefined ? parsed.intermediary : (transcription.intermediary || ''),
          industry: parsed.industry !== undefined ? parsed.industry : (transcription.industry || ''),
          country: parsed.country !== undefined ? parsed.country : (transcription.country || ''),
          eventDate: parsed.eventDate !== undefined ? parsed.eventDate : (transcription.eventDate || fallbackDate),
        };
        // Update form state (for modal if open)
        setEditedMetadata(metadata);
        // Auto-save to backend
        try {
          const resp = await updateTranscriptionMetadata(transcription.id, metadata);
          if (resp.success && resp.data) {
            setTranscription(resp.data);
            await loadTranscriptions();
          }
        } catch {}
        message.success('AI 填充完成');
      } else {
        message.warning('AI 返回格式异常，请重试');
      }
    } catch (err: any) {
      console.error('AI metadata extraction failed:', err);
      message.error(`AI 填充失败: ${err?.message || '未知错误'}`);
    } finally {
      setAiLoading(false);
    }
  }, [transcription, setEditedMetadata]);

  // Processing status badge
  const renderStatusBadge = () => {
    const status = transcription.status;
    if (status === 'pending') {
      return (
        <Tag icon={<SyncOutlined spin />} color="default" style={{ cursor: 'default', marginRight: 0 }}>
          排队中
        </Tag>
      );
    }
    if (status === 'processing') {
      const step = transcription.processingStep;
      const steps = [
        { key: 'transcribing', label: '语音转文字' },
        { key: 'summarizing', label: 'AI 总结生成' },
        { key: 'extracting_metadata', label: '元数据提取' },
        { key: 'finalizing', label: '保存结果' },
      ];
      const currentIdx = steps.findIndex(s => s.key === step);
      const currentLabel = currentIdx >= 0 ? steps[currentIdx].label : '处理中';
      const progress = `${Math.max(currentIdx, 0) + 1}/${steps.length}`;

      const tooltipContent = (
        <div style={{ fontSize: 12 }}>
          {steps.map((s, idx) => (
            <div key={s.key} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
              {idx < currentIdx ? (
                <CheckCircleOutlined style={{ color: '#52c41a', fontSize: 11 }} />
              ) : idx === currentIdx ? (
                <LoadingOutlined style={{ color: '#1890ff', fontSize: 11 }} />
              ) : (
                <span style={{ display: 'inline-block', width: 11, height: 11, borderRadius: '50%', border: '1px solid #666', boxSizing: 'border-box' }} />
              )}
              <span style={{ color: idx === currentIdx ? '#1890ff' : idx < currentIdx ? '#52c41a' : '#999' }}>
                {s.label}
              </span>
            </div>
          ))}
        </div>
      );

      return (
        <Tooltip title={tooltipContent} placement="bottomRight">
          <Tag icon={<SyncOutlined spin />} color="processing" style={{ cursor: 'default', marginRight: 0 }}>
            {currentLabel} ({progress})
          </Tag>
        </Tooltip>
      );
    }

    if (status === 'failed') {
      return (
        <Tooltip title={transcription.errorMessage || '处理失败'}>
          <Tag
            icon={<CloseCircleOutlined />}
            color="error"
            style={{ cursor: 'default', marginRight: 0 }}
          >
            失败
          </Tag>
        </Tooltip>
      );
    }

    return null;
  };

  // Single-field edit modal (for double-click)
  const renderSingleFieldModal = () => {
    if (!editingMetadata) return null;
    return (
      <Modal
        title={`编辑${FIELD_LABELS[editingMetadata]}`}
        open={true}
        onOk={handleSaveMetadata}
        onCancel={handleCancelEditMetadata}
        okText="保存"
        cancelText="取消"
        width={400}
      >
        {editingMetadata === 'participants' ? (
          <Select
            value={editedMetadata.participants || undefined}
            onChange={(value) => setEditedMetadata({ ...editedMetadata, participants: value })}
            placeholder="请选择演讲人类型"
            style={{ width: '100%' }}
            autoFocus
          >
            <Select.Option value="management">Management</Select.Option>
            <Select.Option value="expert">Expert</Select.Option>
            <Select.Option value="sellside">Sellside</Select.Option>
          </Select>
        ) : editingMetadata === 'industry' ? (
          <Select
            value={editedMetadata.industry || undefined}
            onChange={(value) => setEditedMetadata({ ...editedMetadata, industry: value })}
            placeholder="请选择行业"
            style={{ width: '100%' }}
            autoFocus
            showSearch
          >
            {CANVAS_INDUSTRIES.map(ind => (
              <Select.Option key={ind.name} value={ind.name}>{ind.group} / {ind.name}</Select.Option>
            ))}
          </Select>
        ) : editingMetadata === 'country' ? (
          <Select
            value={editedMetadata.country || undefined}
            onChange={(value) => setEditedMetadata({ ...editedMetadata, country: value })}
            placeholder="请选择国家/地区"
            style={{ width: '100%' }}
            autoFocus
          >
            <Select.Option value="中国">中国</Select.Option>
            <Select.Option value="美国">美国</Select.Option>
            <Select.Option value="日本">日本</Select.Option>
            <Select.Option value="韩国">韩国</Select.Option>
            <Select.Option value="欧洲">欧洲</Select.Option>
            <Select.Option value="印度">印度</Select.Option>
            <Select.Option value="其他">其他</Select.Option>
          </Select>
        ) : (
          <Input
            value={editedMetadata[editingMetadata]}
            onChange={(e) => setEditedMetadata({ ...editedMetadata, [editingMetadata]: e.target.value })}
            onPressEnter={handleSaveMetadata}
            autoFocus
            placeholder={`请输入${FIELD_LABELS[editingMetadata]}`}
          />
        )}
      </Modal>
    );
  };

  // Full metadata editing modal — styled to match CanvasNameModal
  const renderMetadataModal = () => {
    if (!showMetadataModal) return null;

    const inputClass = "w-full px-3 py-2 text-sm border border-slate-300 rounded-md focus:outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-100";
    const selectClass = "w-full px-3 py-2 text-sm border border-slate-300 rounded-md focus:outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-100 bg-white appearance-none";
    const labelClass = "text-[11px] text-slate-500 font-medium mb-1 block";

    return (
      <div
        className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/40"
        onClick={handleCloseMetadataModal}
      >
        <div
          className="bg-white rounded-xl shadow-2xl w-[480px] max-h-[85vh] overflow-hidden"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-5 py-3 border-b border-slate-100">
            <div>
              <h3 className="text-sm font-semibold text-slate-800">编辑元数据</h3>
              <p className="text-[11px] text-slate-400 mt-0.5">设置笔记的关键信息，可使用 AI 自动填充</p>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={handleAiFill}
                disabled={aiLoading}
                className="flex items-center gap-1 px-3 py-1.5 bg-blue-500 text-white text-xs rounded-md hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {aiLoading ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />}
                <span>{aiLoading ? '提取中' : 'AI 填充'}</span>
              </button>
              <Tooltip title="AI 填充 Prompt 设置">
                <button
                  onClick={() => { setPromptDraft(getMetadataFillPrompt()); setShowPromptSettings(true); }}
                  className="p-1.5 rounded hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition-colors"
                >
                  <SettingOutlined style={{ fontSize: 14 }} />
                </button>
              </Tooltip>
              <button onClick={handleCloseMetadataModal} className="p-1 rounded hover:bg-slate-100 text-slate-400">
                <X size={16} />
              </button>
            </div>
          </div>

          {/* Form */}
          <div className="px-5 py-4 space-y-3 max-h-[60vh] overflow-y-auto">
            {/* Topic */}
            <div>
              <label className={labelClass}>主题</label>
              <input
                value={editedMetadata.topic}
                onChange={(e) => setEditedMetadata(prev => ({ ...prev, topic: e.target.value }))}
                placeholder="会议/通话主题"
                className={inputClass}
              />
            </div>

            {/* Company — standardized name with AI naming */}
            <div>
              <label className={labelClass}>公司（规范名称）</label>
              <div className="flex gap-2">
                <input
                  value={editedMetadata.organization}
                  onChange={(e) => setEditedMetadata(prev => ({ ...prev, organization: e.target.value }))}
                  placeholder="如 三一重工、Tesla、SpaceX..."
                  className={inputClass + ' flex-1'}
                />
                <button
                  onClick={async () => {
                    if (!editedMetadata.organization?.trim() || namingLoading) return;
                    setNamingLoading(true);
                    try {
                      const result = await aiNormalizeCompanyName(editedMetadata.organization);
                      if (result) setEditedMetadata(prev => ({ ...prev, organization: result }));
                    } catch (e) { console.error('AI naming failed:', e); }
                    finally { setNamingLoading(false); }
                  }}
                  disabled={namingLoading || !editedMetadata.organization?.trim()}
                  className="flex items-center gap-1 px-3 py-1.5 bg-blue-50 text-blue-600 text-xs rounded-md hover:bg-blue-100 disabled:opacity-40 disabled:cursor-not-allowed transition-colors whitespace-nowrap"
                >
                  {namingLoading ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />}
                  AI命名
                </button>
              </div>
              <p className="text-[10px] text-slate-400 mt-1">输入简称后点击「AI命名」自动生成规范名称，如 [TSLA US] Tesla</p>
            </div>

            {/* Speaker name */}
            <div>
              <label className={labelClass}>演讲人</label>
              <input
                value={editedMetadata.speaker}
                onChange={(e) => setEditedMetadata(prev => ({ ...prev, speaker: e.target.value }))}
                placeholder="演讲人/嘉宾姓名，多位用逗号分隔"
                className={inputClass}
              />
            </div>

            {/* Speaker type (was "参与人") — right after speaker */}
            <div>
              <label className={labelClass}>演讲人类型</label>
              <select
                value={editedMetadata.participants}
                onChange={(e) => setEditedMetadata(prev => ({ ...prev, participants: e.target.value }))}
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
                value={editedMetadata.intermediary}
                onChange={(e) => setEditedMetadata(prev => ({ ...prev, intermediary: e.target.value }))}
                placeholder="券商、咨询公司等"
                className={inputClass}
              />
            </div>

            {/* Two columns: Industry + Country */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelClass}>行业</label>
                <select
                  value={editedMetadata.industry}
                  onChange={(e) => setEditedMetadata(prev => ({ ...prev, industry: e.target.value }))}
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
                  value={editedMetadata.country}
                  onChange={(e) => setEditedMetadata(prev => ({ ...prev, country: e.target.value }))}
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

            {/* Two columns: Event date + Created date */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelClass}>发生时间</label>
                <input
                  value={editedMetadata.eventDate}
                  onChange={(e) => setEditedMetadata(prev => ({ ...prev, eventDate: e.target.value }))}
                  placeholder="如 2024/3/15"
                  className={inputClass}
                />
              </div>
              <div>
                <label className={labelClass}>创建时间</label>
                <input
                  value={new Date(transcription.createdAt).toLocaleDateString('zh-CN')}
                  disabled
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-md bg-slate-50 text-slate-500 cursor-not-allowed"
                />
              </div>
            </div>
          </div>

          {/* Footer */}
          <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-slate-100 bg-slate-50/50">
            <button
              onClick={handleCloseMetadataModal}
              className="px-4 py-1.5 text-xs text-slate-600 rounded-md hover:bg-slate-200 transition-colors"
            >
              取消
            </button>
            <button
              onClick={handleSaveMetadata}
              className="px-4 py-1.5 text-xs bg-blue-500 text-white rounded-md hover:bg-blue-600 transition-colors font-medium"
            >
              保存
            </button>
          </div>
        </div>
      </div>
    );
  };

  return (
    <>
      <div className={styles.summaryHeader}>
        <div style={{ flex: 1 }}>
          {/* Title row */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <span style={{ fontSize: '16px', fontWeight: 600, color: '#222', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {transcription.topic || transcription.fileName}
            </span>
            {renderStatusBadge()}
            {/* Reprocess button — only shown when processing/failed */}
            {!isReadOnly && onReprocess && (transcription.status === 'processing' || transcription.status === 'failed') && (
              <Tooltip title="强制重新处理">
                <Button type="text" icon={<ReloadOutlined />} size="small" onClick={onReprocess} style={{ color: '#999' }} />
              </Tooltip>
            )}
            {tagsNode && <div style={{ marginLeft: 'auto', flexShrink: 0 }}>{tagsNode}</div>}
          </div>
          {/* Metadata info strip — click to edit, hover for labels */}
          <div
            className="flex items-center gap-1.5 flex-wrap text-xs text-slate-500 mt-0.5"
          >
            <Tooltip title="公司"><span className="hover:text-blue-600 transition-colors">{transcription.organization || '-'}</span></Tooltip>
            {transcription.speaker && (
              <>
                <span className="text-slate-300">·</span>
                <Tooltip title="演讲人"><span className="hover:text-blue-600 transition-colors">{transcription.speaker}</span></Tooltip>
              </>
            )}
            <span className="text-slate-300">·</span>
            <Tooltip title="中介"><span className="hover:text-blue-600 transition-colors">{transcription.intermediary || '-'}</span></Tooltip>
            <span className="text-slate-300">·</span>
            <Tooltip title="行业"><span className="hover:text-blue-600 transition-colors">{transcription.industry || '-'}</span></Tooltip>
            <span className="text-slate-300">·</span>
            <Tooltip title="国家"><span className="hover:text-blue-600 transition-colors">{transcription.country || '-'}</span></Tooltip>
            <span className="text-slate-300">·</span>
            <Tooltip title="演讲人类型"><span className="hover:text-blue-600 transition-colors">{formatParticipants(transcription.participants)}</span></Tooltip>
            <span className="text-slate-300">·</span>
            <Tooltip title="发生时间"><span className="hover:text-blue-600 transition-colors">{transcription.eventDate && transcription.eventDate !== '未提及' ? transcription.eventDate : new Date(transcription.createdAt).toLocaleDateString('zh-CN')}</span></Tooltip>
            <span className="text-slate-300">·</span>
            <Tooltip title="创建时间"><span className="text-slate-400">{new Date(transcription.createdAt).toLocaleDateString('zh-CN')}</span></Tooltip>
            {!isReadOnly && (
              <div className="ml-auto flex items-center gap-0.5">
                <Tooltip title={aiLoading ? 'AI 填充中...' : 'AI 自动填充元数据'}>
                  <button
                    onClick={(e) => { e.stopPropagation(); handleAiFill(); }}
                    disabled={aiLoading}
                    className="p-0.5 rounded hover:bg-slate-100 text-slate-400 hover:text-blue-500 transition-colors disabled:opacity-40"
                  >
                    {aiLoading ? <LoadingOutlined style={{ fontSize: 11 }} /> : <Sparkles size={11} />}
                  </button>
                </Tooltip>
                <Tooltip title="编辑元数据">
                  <button
                    onClick={(e) => { e.stopPropagation(); handleOpenMetadataModal(); }}
                    className="p-0.5 rounded hover:bg-slate-100 text-slate-400 hover:text-blue-500 transition-colors"
                  >
                    <EditOutlined style={{ fontSize: 11 }} />
                  </button>
                </Tooltip>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Single-field edit modal (double-click) */}
      {renderSingleFieldModal()}

      {/* Full metadata editing modal */}
      {renderMetadataModal()}

      {/* AI Fill Prompt Settings Modal */}
      {showPromptSettings && (
        <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/40" onClick={() => setShowPromptSettings(false)}>
          <div className="bg-white rounded-xl shadow-2xl w-[90vw] max-w-[1000px] max-h-[90vh] overflow-hidden" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-3 border-b border-slate-100">
              <div>
                <h3 className="text-sm font-semibold text-slate-800">AI 填充 Prompt 设置</h3>
                <p className="text-[11px] text-slate-400 mt-0.5">
                  可用变量：{'{sampleCompanies}'} 公司名参考、{'{industryOptions}'} 行业选项
                </p>
              </div>
              <button onClick={() => setShowPromptSettings(false)} className="p-1 rounded hover:bg-slate-100 text-slate-400">
                <X size={16} />
              </button>
            </div>
            <div className="px-5 py-4">
              <textarea
                value={promptDraft}
                onChange={(e) => setPromptDraft(e.target.value)}
                className="w-full h-[60vh] px-4 py-3 text-sm font-mono leading-relaxed border border-slate-300 rounded-md focus:outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-100 resize-none"
              />
            </div>
            <div className="flex items-center justify-between px-5 py-3 border-t border-slate-100">
              <button
                onClick={() => { setPromptDraft(DEFAULT_METADATA_FILL_PROMPT); }}
                className="text-xs text-slate-400 hover:text-slate-600 transition-colors"
              >
                恢复默认
              </button>
              <div className="flex items-center gap-2">
                <button onClick={() => setShowPromptSettings(false)} className="px-3 py-1.5 text-xs text-slate-600 rounded-md hover:bg-slate-100 transition-colors">
                  取消
                </button>
                <button
                  onClick={async () => { await saveMetadataFillPrompt(promptDraft); setShowPromptSettings(false); message.success('Prompt 已保存并同步至云端'); }}
                  className="px-4 py-1.5 text-xs bg-blue-500 text-white rounded-md hover:bg-blue-600 transition-colors"
                >
                  保存
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default MetadataHeader;
