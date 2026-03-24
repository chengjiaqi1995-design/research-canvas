import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Card,
  Button,
  DatePicker,
  Segmented,
  Collapse,
  Input,
  Spin,
  message,
  List,
  Tag,
  Empty,
  Space,
  Typography,
} from 'antd';
import {
  BarChartOutlined,
  FileTextOutlined,
  ThunderboltOutlined,
  HistoryOutlined,
  LockOutlined,
  UnlockOutlined,
  UploadOutlined,
  DeleteOutlined,
  CheckCircleOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import isoWeek from 'dayjs/plugin/isoWeek';
import 'dayjs/locale/zh-cn';
import { generateWeeklySummary, getTranscriptions, getWeeklySettings, updateWeeklySettings } from '../api/transcription';
import JSZip from 'jszip';
import type { Transcription } from '../types';
import { getApiConfig } from '../components/ApiConfigModal';
import styles from './WeeklySummaryPage.module.css';

dayjs.extend(isoWeek);
dayjs.locale('zh-cn');

const { TextArea } = Input;
const { Text, Title } = Typography;

// 固定系统 Prompt（与后端 WEEKLY_SYSTEM_PROMPT 保持一致，仅用于前端展示）
const SYSTEM_PROMPT = `你是一位专业的金融研究助理。请根据以下本周数据，按照用户的分析要求生成周报。

## 本周概览（{weekStart} ~ {weekEnd}）
笔记数量：{noteCount}，涉及行业：{industries}，涉及公司：{companies}

## 本周高亮标注内容（用户在笔记中重点标记的关键信息）
{highlights}

## 与上周对比
{benchmark}

## 各笔记摘要
{summaries}

## 参考来源列表
{references}

---

## 输出格式要求（固定，不可更改，对所有 Prompt 和 Skill 均生效）
- 输出 HTML 格式，使用 h2/h3/p/ul/li/strong/mark/table 标签
- 语言：中文
- **输出量要求**：以内容完整性为第一优先级，字数不限。每条信息单独写出，带具体数字和来源，不要合并、不要概括。宁多勿少。
- **引用格式（严格遵守）**：每个引用独立写 [REF1] [REF2]，禁止合并为 [REF1, REF2]，禁止省略 REF 前缀。引用越多越好。

---

## 用户的分析要求`;

// 用户可编辑的默认分析要求（只有这部分显示在编辑框中）
const DEFAULT_USER_PROMPT = `请生成以下结构的研究周报：

1. **本周核心发现**（3-5 个要点）
   - 综合所有笔记和高亮内容，提炼本周最重要的发现
   - 每个发现用 1-2 句话概括，附上来源引用

2. **行业动态**
   - 按行业分组，概括每个行业本周的关键信息和趋势
   - 标注信息来源

3. **公司追踪**
   - 各公司本周的重要变化、业绩、战略动向
   - 包含具体数据和关键指标

4. **与上周对比分析**
   - 新出现的变化和趋势转折
   - 值得关注的新动向

5. **下周关注建议**
   - 基于本周信息，建议下周重点关注的方向和理由`;


const WeeklySummaryPage: React.FC = () => {
  const navigate = useNavigate();
  const [dateRange, setDateRange] = useState<[dayjs.Dayjs, dayjs.Dayjs]>([
    dayjs().subtract(1, 'week').startOf('isoWeek'),
    dayjs().subtract(1, 'week').endOf('isoWeek'),
  ]);
  const [customPrompt, setCustomPrompt] = useState<string>(DEFAULT_USER_PROMPT);
  const [systemPrompt, setSystemPrompt] = useState<string>(SYSTEM_PROMPT);
  const [systemPromptLocked, setSystemPromptLocked] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [historySummaries, setHistorySummaries] = useState<Transcription[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);

  // Skill 状态
  const [skillContent, setSkillContent] = useState<string>('');
  const [skillSaving, setSkillSaving] = useState(false);
  const [skillEditing, setSkillEditing] = useState(false);
  const [skillEditValue, setSkillEditValue] = useState('');
  const [promptSaving, setPromptSaving] = useState(false);

  // 加载历史周报 + 周报设置
  useEffect(() => {
    loadHistorySummaries();
    loadWeeklySettings();
  }, []);

  const loadWeeklySettings = async () => {
    try {
      const res = await getWeeklySettings();
      if (res.success && res.data) {
        setSkillContent(res.data.skillContent || '');
        if (res.data.userPrompt) setCustomPrompt(res.data.userPrompt);
        if (res.data.systemPrompt) setSystemPrompt(res.data.systemPrompt);
      }
    } catch (e) {
      console.error('加载周报设置失败:', e);
    }
  };

  const handleSkillUpload = async (file: File) => {
    setSkillSaving(true);
    try {
      let content = '';
      if (file.name.endsWith('.zip') || file.name.endsWith('.skill')) {
        const zip = await JSZip.loadAsync(file);
        const mdFiles: string[] = [];
        zip.forEach((path, entry) => {
          if (path.endsWith('.md') && !entry.dir) {
            mdFiles.push(path);
          }
        });
        mdFiles.sort();
        const parts: string[] = [];
        for (const mdPath of mdFiles) {
          const text = await zip.file(mdPath)!.async('text');
          if (text.trim()) parts.push(text.trim());
        }
        content = parts.join('\n\n---\n\n');
      } else {
        content = await file.text();
      }

      const res = await updateWeeklySettings({ skillContent: content });
      if (res.success) {
        setSkillContent(content);
        message.success('Skill 已更新');
      } else {
        message.error('保存失败');
      }
    } catch (e) {
      console.error(e);
      message.error('解析文件失败');
    } finally {
      setSkillSaving(false);
    }
  };

  const handleSkillSave = async () => {
    setSkillSaving(true);
    try {
      const res = await updateWeeklySettings({ skillContent: skillEditValue });
      if (res.success) {
        setSkillContent(skillEditValue);
        setSkillEditing(false);
        message.success('Skill 已保存');
      } else {
        message.error('保存失败');
      }
    } catch (e) {
      message.error('保存失败');
    } finally {
      setSkillSaving(false);
    }
  };

  const handleSkillClear = async () => {
    setSkillSaving(true);
    try {
      const res = await updateWeeklySettings({ skillContent: '' });
      if (res.success) {
        setSkillContent('');
        setSkillEditing(false);
        message.success('Skill 已清除，将使用默认 Prompt');
      }
    } catch (e) {
      message.error('清除失败');
    } finally {
      setSkillSaving(false);
    }
  };

  // 保存 Prompt 到后端
  const handleSavePrompts = async () => {
    setPromptSaving(true);
    try {
      const data: Record<string, string> = { userPrompt: customPrompt };
      if (systemPrompt !== SYSTEM_PROMPT) {
        data.systemPrompt = systemPrompt;
      } else {
        data.systemPrompt = ''; // 清空表示使用默认
      }
      const res = await updateWeeklySettings(data);
      if (res.success) {
        message.success('Prompt 已保存');
      }
    } catch (e) {
      message.error('保存失败');
    } finally {
      setPromptSaving(false);
    }
  };

  const loadHistorySummaries = async () => {
    setLoadingHistory(true);
    try {
      const response = await getTranscriptions({
        page: 1,
        pageSize: 50,
        sortBy: 'actualDate',
        sortOrder: 'desc',
      });
      if (response.success && response.data) {
        // 过滤出 weekly-summary 类型
        const weeklySummaries = response.data.items.filter(
          (item: Transcription) => item.type === 'weekly-summary'
        );
        setHistorySummaries(weeklySummaries);
      }
    } catch (error: any) {
      console.error('加载历史周报失败:', error);
    } finally {
      setLoadingHistory(false);
    }
  };

  const handleGenerate = async () => {
    if (!dateRange || !dateRange[0] || !dateRange[1]) {
      message.warning('请选择日期范围');
      return;
    }

    setGenerating(true);
    try {
      const weekStart = dateRange[0].format('YYYY-MM-DD');
      const weekEnd = dateRange[1].format('YYYY-MM-DD');

      // 先保存 prompts 到后端
      await updateWeeklySettings({
        userPrompt: customPrompt,
        systemPrompt: systemPrompt !== SYSTEM_PROMPT ? systemPrompt : '',
      }).catch(() => {});

      // 从 localStorage 读取 API 配置
      const parsedConfig = getApiConfig();
      const geminiApiKey = parsedConfig.geminiApiKey || undefined;
      const weeklySummaryModel = parsedConfig.weeklySummaryModel || undefined;

      // 发送用户 prompt（后端会从 DB 读取 skill 和设置）
      const promptToSend = customPrompt;

      const response = await generateWeeklySummary(
        weekStart,
        promptToSend,
        geminiApiKey,
        weeklySummaryModel,
        weekEnd
      );

      if (response.success && response.data) {
        message.success('周报生成成功！点击历史记录查看');
        // 刷新历史列表，不跳转
        loadHistorySummaries();
      } else {
        message.error(response.error || '生成失败');
      }
    } catch (error: any) {
      const errorMsg = error?.response?.data?.error || error.message || '生成周报失败';
      message.error(errorMsg);
    } finally {
      setGenerating(false);
    }
  };

  const handleResetPrompt = async () => {
    setCustomPrompt(DEFAULT_USER_PROMPT);
    setSystemPrompt(SYSTEM_PROMPT);
    setSystemPromptLocked(true);
    await updateWeeklySettings({ userPrompt: '', systemPrompt: '' }).catch(() => {});
    message.info('已恢复默认 Prompt');
  };

  const formatWeekRange = (item: Transcription) => {
    try {
      const data = JSON.parse(item.transcriptText || '{}');
      if (data.weekStart && data.weekEnd) {
        return `${data.weekStart} ~ ${data.weekEnd}`;
      }
    } catch {}
    return item.fileName;
  };

  return (
    <div className={styles.weeklySummaryPage}>
      <div className={styles.weeklySummaryContent}>
        {/* 生成区域 */}
        <Card
          title={
            <Space>
              <BarChartOutlined />
              <span>生成周度总结</span>
            </Space>
          }
          className={styles.generateCard}
        >
          <div className={styles.generateControls}>
            <div className={styles.weekPickerRow}>
              <Text strong>日期范围：</Text>
              <Segmented
                size="small"
                options={[
                  { label: '上周', value: 'last-week' },
                  { label: '近10天', value: 'last-10' },
                  { label: '近14天', value: 'last-14' },
                ]}
                onChange={(val) => {
                  const now = dayjs();
                  if (val === 'last-week') {
                    setDateRange([now.subtract(1, 'week').startOf('isoWeek'), now.subtract(1, 'week').endOf('isoWeek')]);
                  } else if (val === 'last-10') {
                    setDateRange([now.subtract(10, 'day'), now.subtract(1, 'day')]);
                  } else if (val === 'last-14') {
                    setDateRange([now.subtract(14, 'day'), now.subtract(1, 'day')]);
                  }
                }}
              />
              <DatePicker.RangePicker
                value={dateRange}
                onChange={(dates) => {
                  if (dates && dates[0] && dates[1]) {
                    setDateRange([dates[0], dates[1]]);
                  }
                }}
                style={{ width: 280 }}
                allowClear={false}
              />
              <Button
                type="primary"
                icon={<ThunderboltOutlined />}
                onClick={handleGenerate}
                loading={generating}
                size="large"
              >
                {generating ? '正在生成...' : '生成周报'}
              </Button>
            </div>

            {generating && (
              <div className={styles.generatingTip}>
                <Spin size="small" />
                <Text type="secondary" style={{ marginLeft: 8 }}>
                  正在收集笔记数据、提取高亮、生成 AI 分析，预计需要 30-60 秒...
                </Text>
              </div>
            )}
          </div>

          <Collapse
            ghost
            items={[{
              key: 'skill',
              label: (
                <Space>
                  <Text type="secondary">周报 Skill（方法论）</Text>
                  {skillContent ? (
                    <Tag color="green" icon={<CheckCircleOutlined />}>已配置 ({Math.round(skillContent.length / 1000)}k 字符)</Tag>
                  ) : (
                    <Tag>未配置</Tag>
                  )}
                </Space>
              ),
              children: (
                <div style={{ padding: '4px 0' }}>
                  {skillEditing ? (
                    <>
                      <TextArea
                        value={skillEditValue}
                        onChange={(e) => setSkillEditValue(e.target.value)}
                        rows={16}
                        style={{ fontFamily: 'monospace', fontSize: 12, marginBottom: 8 }}
                        placeholder="粘贴或编辑 Skill 方法论内容..."
                      />
                      <Space>
                        <Button type="primary" size="small" onClick={handleSkillSave} loading={skillSaving}>保存</Button>
                        <Button size="small" onClick={() => setSkillEditing(false)}>取消</Button>
                      </Space>
                    </>
                  ) : (
                    <>
                      <div style={{ marginBottom: 8 }}>
                        <Text type="secondary" style={{ fontSize: 12 }}>
                          上传 Skill 文件（.skill / .zip / .md），AI 生成周报时会使用其中的方法论来筛选和组织信息。
                        </Text>
                      </div>
                      <Space wrap>
                        <Button
                          size="small"
                          icon={<UploadOutlined />}
                          loading={skillSaving}
                          onClick={() => {
                            const input = document.createElement('input');
                            input.type = 'file';
                            input.accept = '.skill,.zip,.md';
                            input.onchange = (e) => {
                              const file = (e.target as HTMLInputElement).files?.[0];
                              if (file) handleSkillUpload(file);
                            };
                            input.click();
                          }}
                        >
                          上传 Skill
                        </Button>
                        {skillContent && (
                          <>
                            <Button
                              size="small"
                              onClick={() => {
                                setSkillEditValue(skillContent);
                                setSkillEditing(true);
                              }}
                            >
                              查看 / 编辑
                            </Button>
                            <Button
                              size="small"
                              danger
                              icon={<DeleteOutlined />}
                              onClick={handleSkillClear}
                              loading={skillSaving}
                            >
                              清除
                            </Button>
                          </>
                        )}
                      </Space>
                      {skillContent && (
                        <div style={{ marginTop: 8, padding: '8px 12px', background: '#f6ffed', borderRadius: 6, border: '1px solid #b7eb8f', maxHeight: 120, overflow: 'auto' }}>
                          <Text style={{ fontSize: 11, whiteSpace: 'pre-wrap', color: '#389e0d' }}>
                            {skillContent.substring(0, 500)}{skillContent.length > 500 ? '...' : ''}
                          </Text>
                        </div>
                      )}
                    </>
                  )}
                </div>
              ),
            }, {
              key: 'prompt',
              label: <Text type="secondary">AI Prompt 设置（点击展开编辑）</Text>,
              children: (
                <div className={styles.promptEditor}>
                  {/* 固定系统部分 */}
                  <div style={{ marginBottom: 12 }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                      <Text strong style={{ fontSize: 13 }}>
                        {systemPromptLocked ? '🔒' : '🔓'} 系统 Prompt（数据上下文 + 输出格式 + 引用规则）
                      </Text>
                      <Button
                        size="small"
                        type="text"
                        icon={systemPromptLocked ? <LockOutlined /> : <UnlockOutlined />}
                        onClick={() => {
                          setSystemPromptLocked(!systemPromptLocked);
                        }}
                        style={{ color: systemPromptLocked ? '#999' : '#1677ff' }}
                      >
                        {systemPromptLocked ? '解锁编辑' : '锁定'}
                      </Button>
                    </div>
                    {systemPromptLocked ? (
                      <div style={{ padding: '10px 12px', background: '#f6f8fa', borderRadius: 6, border: '1px solid #e8e8e8' }}>
                        <Text type="secondary" style={{ fontSize: 12 }}>
                          系统会自动提供：角色设定、本周概览数据、高亮标注、与上周对比、各笔记摘要全文、参考来源列表、HTML 输出格式要求、引用规则（[REF] → 笔记标题链接）。
                          {systemPrompt !== SYSTEM_PROMPT && (
                            <Tag color="orange" style={{ marginLeft: 8 }}>已自定义</Tag>
                          )}
                        </Text>
                      </div>
                    ) : (
                      <TextArea
                        value={systemPrompt}
                        onChange={(e) => setSystemPrompt(e.target.value)}
                        rows={12}
                        style={{ fontFamily: 'monospace', fontSize: 12, background: '#fffbe6', borderColor: '#ffe58f' }}
                      />
                    )}
                  </div>

                  {/* 用户可编辑部分 */}
                  <Text strong style={{ fontSize: 13, marginBottom: 6, display: 'block' }}>
                    ✏️ 你的分析要求（可自由编辑）：
                  </Text>
                  <TextArea
                    value={customPrompt}
                    onChange={(e) => setCustomPrompt(e.target.value)}
                    rows={14}
                    placeholder="输入你想要的周报结构和分析要求..."
                    style={{ fontFamily: 'monospace', fontSize: 13 }}
                  />
                  <div className={styles.promptActions}>
                    <Text type="secondary" style={{ fontSize: 12 }}>
                      直接描述你想要的周报结构即可，数据和引用规则会自动注入
                    </Text>
                    <Space>
                      <Button size="small" type="primary" onClick={handleSavePrompts} loading={promptSaving}>
                        保存
                      </Button>
                      <Button size="small" onClick={handleResetPrompt}>
                        恢复默认
                      </Button>
                    </Space>
                  </div>
                </div>
              ),
            }]}
          />
        </Card>

        {/* 历史周报列表 */}
        <Card
          title={
            <Space>
              <HistoryOutlined />
              <span>历史周报</span>
            </Space>
          }
          className={styles.historyCard}
        >
          {loadingHistory ? (
            <div style={{ textAlign: 'center', padding: '40px 0' }}>
              <Spin />
            </div>
          ) : historySummaries.length === 0 ? (
            <Empty description="暂无历史周报" />
          ) : (
            <List
              dataSource={historySummaries}
              renderItem={(item) => {
                let noteCount = 0;
                let companies: string[] = [];
                let itemTokenStats: any = null;
                try {
                  const data = JSON.parse(item.transcriptText || '{}');
                  noteCount = data.noteCount || 0;
                  companies = data.metadata?.companies || [];
                  itemTokenStats = data.tokenStats || null;
                } catch {}

                return (
                  <List.Item
                    className={styles.historyItem}
                    onClick={() => navigate(`/transcription/${item.id}`)}
                    actions={[
                      <Button
                        type="link"
                        icon={<FileTextOutlined />}
                        onClick={(e) => {
                          e.stopPropagation();
                          navigate(`/transcription/${item.id}`);
                        }}
                      >
                        查看
                      </Button>,
                    ]}
                  >
                    <List.Item.Meta
                      title={
                        <Space>
                          <Tag color="blue">周报</Tag>
                          <span>{formatWeekRange(item)}</span>
                        </Space>
                      }
                      description={
                        <div>
                          <Space size={[8, 4]} wrap>
                            <Text type="secondary">{noteCount} 篇笔记</Text>
                            {companies.slice(0, 3).map((c) => (
                              <Tag key={c} color="default" style={{ fontSize: 11 }}>{c}</Tag>
                            ))}
                            {companies.length > 3 && (
                              <Text type="secondary" style={{ fontSize: 11 }}>+{companies.length - 3}</Text>
                            )}
                          </Space>
                          {itemTokenStats && (
                            <div style={{ fontSize: 11, color: '#999', marginTop: 2 }}>
                              Token: 输入 {itemTokenStats.inputUtilization}% · 输出 {itemTokenStats.outputUtilization}%
                              {itemTokenStats.totalCalls > 1 && ` · ${itemTokenStats.totalCalls}次调用`}
                              {itemTokenStats.batchCount > 1 && ` · ${itemTokenStats.batchCount}批`}
                              {itemTokenStats.continueCalls > 0 && ` · ${itemTokenStats.continueCalls}次续写`}
                            </div>
                          )}
                        </div>
                      }
                    />
                  </List.Item>
                );
              }}
            />
          )}
        </Card>
      </div>
    </div>
  );
};

export default WeeklySummaryPage;
