import React, { useState, useCallback, useEffect } from 'react';
import { v4 as uuidv4 } from 'uuid';
import {
  Progress,
  Checkbox,
  Input,
  message,
  Modal,
  Tooltip,
  Dropdown,
  Select,
} from 'antd';
import type { MenuProps } from 'antd';
import { CheckCircleOutlined, InboxOutlined, PlusOutlined, SettingOutlined, ThunderboltOutlined, SearchOutlined } from '@ant-design/icons';
import * as pdfjsLib from 'pdfjs-dist';

// 设置 PDF.js worker - 使用 public 目录下的静态文件
pdfjsLib.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.js';
import type { SourceItem, AppStatus } from './merge/types';
import { MAX_SOURCES, PLACEHOLDER_TEXTS } from './merge/constants';
import { aggregateContent, extractTextWithGemini, fileToBase64 } from './merge/geminiService';
import { SourceCard } from './merge/components/SourceCard';
import { ResultView } from './merge/components/ResultView';
import { PromptInspector } from './merge/components/PromptInspector';
import { PlusIcon } from './merge/components/Icons';
import { createMergeHistory, createFromText } from '../api/transcription';
import { resolveFmpSymbol } from '../api/portfolio';
import { useNavigate } from 'react-router-dom';
import { getApiConfig } from '../components/ApiConfigModal';
import { getFilledMetadataPrompt } from '../../utils/metadataFillPrompt';
import { useIndustryCategoryStore } from '../../stores/industryCategoryStore';
import { aiApi } from '../../db/apiClient';
import { useAICardStore } from '../../stores/aiCardStore';
import { buildEarningsReviewApiPromptContext } from '../../utils/earningsReviewApiContext';

type ResultMeta = {
  kind: 'merge' | 'skill';
  model: string;
  title: string;
  generatedBy: string;
};

const DEFAULT_SKILL_MODEL = 'gemini-3-flash-preview';
const DEFAULT_CHAT_MODEL = 'claude-3-5-sonnet-20241022';

type MergeModelConfig = {
  mergeSkillModel?: string;
  summaryModel?: string;
};

const resolveMergeSkillModel = (config: MergeModelConfig, defaultModel?: string): string => {
  const taskModel = config.mergeSkillModel?.trim();
  const fallbackModel = defaultModel?.trim();
  if (taskModel && taskModel !== DEFAULT_SKILL_MODEL) return taskModel;
  if (fallbackModel && fallbackModel !== DEFAULT_SKILL_MODEL && fallbackModel !== DEFAULT_CHAT_MODEL) {
    return fallbackModel;
  }
  return taskModel || config.summaryModel || DEFAULT_SKILL_MODEL;
};

const decodeHtmlEntities = (value: string): string =>
  value
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCharCode(parseInt(code, 16)));

const sourceToText = (content: string): string =>
  decodeHtmlEntities(
    content
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/p>/gi, '\n')
      .replace(/<\/div>/gi, '\n')
      .replace(/<\/li>/gi, '\n')
      .replace(/<[^>]+>/g, '')
      .replace(/\n{3,}/g, '\n\n')
  ).trim();

const trimTitle = (title: string, maxLength = 80): string =>
  title.length > maxLength ? `${title.slice(0, maxLength - 1)}...` : title;

const cleanTickerInput = (value: unknown): string => {
  const text = String(value || '')
    .trim()
    .toUpperCase()
    .replace(/^[\s$([{]+/, '')
    .replace(/[\])},;:：。]+$/, '')
    .replace(/\s+/g, ' ');
  if (/^[A-Z0-9][A-Z0-9.-]{0,24}$/.test(text)) return text;
  if (/^[A-Z0-9/.-]{1,16}\s+[A-Z]{2,5}(?:\s+EQUITY)?$/.test(text)) return text;
  return '';
};

const normalizeTickerDraft = (value: unknown): string =>
  String(value || '')
    .toUpperCase()
    .replace(/[^A-Z0-9/.\-\s]/g, '')
    .replace(/\s+/g, ' ')
    .slice(0, 40);

const normalizeSourceCitationLabels = (text: string): string =>
  text.replace(/【\s*源\s*\d+\s*[：:]\s*([^】]+?)\s*】/g, (_, title) => `【${String(title).trim()}】`);

const buildOriginalSourcesTranscript = (sources: SourceItem[]): string =>
  sources
    .map((source, index) => [
      `## 源 ${index + 1}${source.title ? `：${source.title}` : ''}`,
      '',
      source.content,
    ].join('\n'))
    .join('\n\n---\n\n')
    .trim();

const MergePage: React.FC = () => {
  const navigate = useNavigate();
  const models = useAICardStore((s) => s.models);
  const skills = useAICardStore((s) => s.skills);
  const loadModels = useAICardStore((s) => s.loadModels);
  const syncWithServer = useAICardStore((s) => s.syncWithServer);
  const [sources, setSources] = useState<SourceItem[]>([
    { id: uuidv4(), title: '', content: '' },
    { id: uuidv4(), title: '', content: '' },
  ]);
  const [status, setStatus] = useState<AppStatus>('IDLE');
  const [result, setResult] = useState<string>('');
  const [isTruncated, setIsTruncated] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [resultMeta, setResultMeta] = useState<ResultMeta>({
    kind: 'merge',
    model: 'gemini',
    title: '合并结果',
    generatedBy: 'Gemini AI',
  });

  // Skill / FMP helper state
  const [selectedSkillId, setSelectedSkillId] = useState<string>('');
  const [skillModel, setSkillModel] = useState<string>(() => resolveMergeSkillModel(getApiConfig()));
  const [fmpTicker, setFmpTicker] = useState<string>('');
  const [resolvedFmpSymbol, setResolvedFmpSymbol] = useState<string>('');
  const [fmpCompanyName, setFmpCompanyName] = useState<string>('');
  const [fmpTickerConfidence, setFmpTickerConfidence] = useState<number | null>(null);
  const [isResolvingTicker, setIsResolvingTicker] = useState<boolean>(false);

  const [progressMessage, setProgressMessage] = useState<string>('');
  const [progressValue, setProgressValue] = useState<number>(0);

  // Prompt Inspector Modal State
  const [showPromptInspector, setShowPromptInspector] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const refreshSkillModelFromLocal = () => {
      const config = getApiConfig();
      setSkillModel(resolveMergeSkillModel(config));
    };

    loadModels();
    syncWithServer();
    refreshSkillModelFromLocal();
    aiApi.getSettings()
      .then((settings) => {
        if (!cancelled) {
          const cloudConfig = settings.apiConfig || {};
          const localConfig = getApiConfig();
          setSkillModel(resolveMergeSkillModel({ ...localConfig, ...cloudConfig }, settings.defaultModel));
        }
      })
      .catch((err) => {
        console.warn('Failed to load AI settings for MergePage:', err);
      });
    window.addEventListener('apiConfigUpdated', refreshSkillModelFromLocal);
    return () => {
      cancelled = true;
      window.removeEventListener('apiConfigUpdated', refreshSkillModelFromLocal);
    };
  }, [loadModels, syncWithServer]);

  useEffect(() => {
    if (selectedSkillId && !skills.some((skill) => skill.id === selectedSkillId)) {
      setSelectedSkillId('');
    }
  }, [selectedSkillId, skills]);

  const getSourcesWithContent = useCallback((): SourceItem[] =>
    sources
      .map((source, index) => ({
        ...source,
        title: source.title.trim() || `源 ${index + 1}`,
        content: sourceToText(source.content),
      }))
      .filter((source) => source.content.length > 0),
  [sources]);

  const addSource = useCallback(() => {
    if (sources.length < MAX_SOURCES) {
      setSources((prev) => [...prev, { id: uuidv4(), title: '', content: '' }]);
    }
  }, [sources.length]);

  const removeSource = useCallback((id: string) => {
    setSources((prev) => prev.filter((s) => s.id !== id));
  }, []);

  const updateSource = useCallback((id: string, field: 'title' | 'content', value: string) => {
    setSources((prev) =>
      prev.map((s) => (s.id === id ? { ...s, [field]: value } : s))
    );
  }, []);

  const handleResolveTicker = async () => {
    const tickerInput = cleanTickerInput(fmpTicker);
    if (!tickerInput) {
      message.warning('请先输入 FMP 或 Bloomberg ticker，例如 WMB / WMB US Equity / 700 HK Equity');
      return;
    }

    setIsResolvingTicker(true);
    setError(null);

    try {
      setFmpTicker(tickerInput);
      const resolveResponse = await resolveFmpSymbol({ input: tickerInput });
      const resolved = resolveResponse.data?.data;

      if (!resolved?.resolved || !resolved.symbol) {
        setFmpTicker(tickerInput);
        setResolvedFmpSymbol('');
        setFmpCompanyName('');
        setFmpTickerConfidence(null);
        message.error(`未能把 ${tickerInput} 映射到 FMP symbol，请检查市场后缀或直接输入 FMP ticker`);
        return;
      }

      setResolvedFmpSymbol(resolved.symbol);
      setFmpCompanyName(resolved.companyName || '');
      setFmpTickerConfidence(resolved.confidence);
      message.success(`${tickerInput} -> FMP ${resolved.symbol}${resolved.companyName ? ` · ${resolved.companyName}` : ''}`);
    } catch (e: any) {
      console.error('验证 FMP ticker 失败:', e);
      message.error('验证 ticker 失败: ' + (e.message || '未知错误'));
    } finally {
      setIsResolvingTicker(false);
    }
  };

  const handleSkillGenerate = async (options: { saveToNote?: boolean } = {}) => {
    const saveToNote = options.saveToNote ?? false;
    const sourcesWithContent = getSourcesWithContent();
    if (sourcesWithContent.length === 0) {
      setError('请至少在一个源中添加内容');
      return;
    }

    const skill = skills.find((item) => item.id === selectedSkillId);
    if (!skill) {
      setError('请先选择一个 Skill');
      return;
    }

    const model = skillModel || resolveMergeSkillModel(getApiConfig());
    const modelName = models.find((item) => item.id === model)?.name || model;
    const attachments = sourcesWithContent
      .map((source, index) => [
        `<attachment index="${index + 1}" title="${source.title}">`,
        source.content,
        '</attachment>',
      ].join('\n'))
      .join('\n\n---\n\n');
    const tickerPromptHint = (resolvedFmpSymbol || fmpTicker)
      ? [
          `ticker input: ${fmpTicker}`,
          resolvedFmpSymbol ? `resolved FMP ticker: ${resolvedFmpSymbol}` : '',
          fmpCompanyName ? `verified company: ${fmpCompanyName}` : '',
        ].filter(Boolean).join('\n')
      : '';
    const earningsApiContext = await buildEarningsReviewApiPromptContext({
      skill,
      prompt: [tickerPromptHint, skill.name, sourcesWithContent.map((source) => source.title).join('\n')]
        .filter(Boolean)
        .join('\n'),
      context: attachments,
      inferTickerFromContext: false,
    });

    const systemPrompt = [
      '你是一位专业的投资研究分析助理。',
      '你必须把用户提供的多个 attachment 当作输入来源，严格遵循指定 Skill 方法论生成内容。',
      '只基于附件内容和 Skill 进行分析；无法从附件确认的信息要明确标注不确定，不要编造。',
      '输出中文。直接输出可以写入研究笔记 summary 字段的正文，不要解释你如何调用模型。',
    ].join('\n');

    const userPrompt = [
      '请基于以下多个来源附件，严格调用所选 Skill 生成一份研究内容。',
      '',
      '## Skill',
      `名称：${skill.name}`,
      skill.description ? `说明：${skill.description}` : '',
      '',
      '### 方法论全文',
      skill.content,
      earningsApiContext ? '\n## Research Canvas FMP API 数据' : '',
      earningsApiContext || '',
      '',
      '## 输出要求',
      '- 生成内容会直接写入 AI Process 的 summary 字段。',
      '- 使用清晰标题、要点、必要表格来组织内容。',
      '- 引用来源时直接使用【标题】格式，标题必须取 attachment 的 title；不要写成【源1: 标题】、【源1：标题】或带 source/index 前缀的格式。',
      '- 多个来源冲突时，明确列出冲突点和你的判断。',
      '- 不要输出“以下是生成内容”等过程性套话。',
      '',
      '## 附件来源',
      attachments,
    ].filter(Boolean).join('\n');

    setStatus('PROCESSING');
    setError(null);
    setIsTruncated(false);
    setResult('');
    setProgressValue(8);
    setProgressMessage(`正在调用 ${skill.name} · ${modelName}...`);
    setResultMeta({
      kind: 'skill',
      model,
      title: `Skill 生成结果 · ${skill.name}`,
      generatedBy: `${skill.name} · ${modelName}`,
    });

    let generated = '';

    try {
      const stream = aiApi.chatStream({
        model,
        messages: [{ role: 'user', content: userPrompt }],
        systemPrompt,
      });

      for await (const event of stream) {
        if (event.type === 'text' && event.content) {
          generated += event.content;
          setProgressMessage(`正在生成 Summary · ${generated.length.toLocaleString('zh-CN')} 字符`);
          setProgressValue((value) => Math.min(88, Math.max(value + 1, 28)));
        } else if (event.type === 'error') {
          throw new Error(event.content || 'Skill 生成失败');
        }
      }

      const finalText = normalizeSourceCitationLabels(generated.trim());
      if (!finalText) {
        throw new Error('Skill 生成结果为空');
      }

      setProgressValue(92);
      setProgressMessage(saveToNote ? '正在保存到 Summary...' : '正在整理生成结果...');
      setResult(finalText);

      if (!saveToNote) {
        setProgressValue(100);
        setStatus('COMPLETED');
        message.success('Skill 已生成结果');
        return;
      }

      const firstTitle = sourcesWithContent[0]?.title || '多来源';
      const autoTitle = trimTitle(`${firstTitle} · ${skill.name}`);
      const response = await createMergeHistory(
        autoTitle,
        finalText,
        sourcesWithContent,
        model,
        {
          transcriptText: buildOriginalSourcesTranscript(sourcesWithContent),
          participants: 'company',
          tags: ['公司点评', 'skill-merge'],
          topic: autoTitle,
        }
      );

      setProgressValue(100);
      setStatus('COMPLETED');

      if (response.success && response.data?.id) {
        message.success('已用 Skill 生成并保存到 Summary');
        navigate(`/transcription/${response.data.id}`);
      } else {
        message.success('已生成结果，请手动保存');
      }
    } catch (e: any) {
      setError(e.message || 'Skill 生成失败');
      setStatus(generated ? 'COMPLETED' : 'ERROR');
      if (generated) {
        setResult(normalizeSourceCitationLabels(generated.trim()));
        message.warning('Skill 已生成内容，但保存失败，请手动保存');
      }
    }
  };

  const handleReset = () => {
    setStatus('IDLE');
    setResult('');
    setIsTruncated(false);
    setError(null);
    setProgressValue(0);
    setProgressMessage('');
  };

  const handleSaveResult = async () => {
    if (!result) return;

    const sourcesWithContent = getSourcesWithContent();
    // Create a default title based on first source or date
    const firstSourceTitle = sourcesWithContent[0]?.title;
    const modeLabel = resultMeta.kind === 'skill'
      ? `(${resultMeta.generatedBy})`
      : '';
    const autoTitle = firstSourceTitle
      ? `${firstSourceTitle} ${modeLabel}`
      : `合并 ${new Date().toLocaleString('zh-CN')} ${modeLabel}`;

    // Save to database
    try {
      const response = await createMergeHistory(
        trimTitle(autoTitle),
        result,
        sourcesWithContent.length > 0 ? sourcesWithContent : sources,
        resultMeta.model || 'gemini',
        resultMeta.kind === 'skill'
          ? {
              transcriptText: buildOriginalSourcesTranscript(sourcesWithContent.length > 0 ? sourcesWithContent : sources),
              participants: 'company',
              tags: ['公司点评', 'skill-merge'],
              topic: trimTitle(autoTitle),
            }
          : undefined
      );
      if (response.success) {
        message.success('合并历史已保存到数据库');
      }
    } catch (error: any) {
      console.error('保存合并历史到数据库失败:', error);
      message.warning('保存到数据库失败');
    }
  };


  const [isCreatingNotes, setIsCreatingNotes] = useState(false);
  // 新建笔记时是否生成 AI 总结和提取元数据（复用上传 Modal 同一个 localStorage 键）
  const [autoSummary, setAutoSummary] = useState<boolean>(() => {
    const saved = localStorage.getItem('uploadAutoSummary');
    return saved === null ? true : saved === 'true';
  });

  const handleCreateAiSummaryNote = async (sourcesWithContent: SourceItem[]) => {
    if (sourcesWithContent.length === 0) {
      message.warning('请至少在一个源中添加内容');
      return;
    }

    setIsCreatingNotes(true);
    setStatus('PROCESSING');
    setError(null);
    setIsTruncated(false);
    setProgressValue(10);
    setProgressMessage('正在创建 AI 总结笔记...');

    const apiConfig = getApiConfig();
    const geminiApiKey = apiConfig.geminiApiKey || undefined;
    const customPrompt = localStorage.getItem('summaryPrompt') || undefined;
    const metadataFillPrompt = (() => {
      const cats = useIndustryCategoryStore.getState().categories;
      return getFilledMetadataPrompt(cats.flatMap(c => c.subCategories).join('、'));
    })();

    try {
      const firstTitle = sourcesWithContent[0]?.title || '多来源';
      const sourceTitle = trimTitle(`${firstTitle} · AI总结`);
      const response = await createFromText({
        text: buildOriginalSourcesTranscript(sourcesWithContent),
        sourceTitle,
        geminiApiKey,
        customPrompt,
        metadataFillPrompt,
        summaryModel: apiConfig.summaryModel || undefined,
      });

      if (response.success && response.data?.id) {
        setProgressValue(100);
        setStatus('COMPLETED');
        message.success('已创建 AI 总结笔记');
        navigate(`/transcription/${response.data.id}`);
      } else {
        message.error('创建笔记失败');
        setStatus('ERROR');
      }
    } catch (error: any) {
      console.error('创建笔记失败:', error);
      setError(error.message || '创建笔记失败');
      setStatus('ERROR');
      message.error('创建笔记失败: ' + (error.message || '未知错误'));
    } finally {
      setIsCreatingNotes(false);
    }
  };

  const handleCreateQuickMergeNote = async (sourcesWithContent: SourceItem[]) => {
    if (sourcesWithContent.length === 0) {
      message.warning('请至少在一个源中添加内容');
      return;
    }

    setIsCreatingNotes(true);
    setStatus('PROCESSING');
    setError(null);
    setIsTruncated(false);
    setProgressValue(0);
    setProgressMessage('正在快速合并并创建笔记...');

    try {
      const { text, isTruncated: truncated } = await aggregateContent(
        sourcesWithContent,
        'comprehensive',
        (msg, val) => {
          setProgressMessage(msg);
          setProgressValue(val);
        }
      );
      const finalText = normalizeSourceCitationLabels(text.trim());
      const firstTitle = sourcesWithContent[0]?.title || '多来源';
      const autoTitle = trimTitle(`${firstTitle} · 快速合并`);

      setResult(finalText);
      setIsTruncated(truncated);
      setResultMeta({
        kind: 'merge',
        model: 'gemini',
        title: '快速合并结果',
        generatedBy: 'Gemini AI',
      });
      setProgressValue(92);
      setProgressMessage('正在保存快速合并笔记...');

      const response = await createMergeHistory(
        autoTitle,
        finalText,
        sourcesWithContent,
        'gemini',
        {
          transcriptText: buildOriginalSourcesTranscript(sourcesWithContent),
          participants: 'company',
          tags: ['quick-merge'],
          topic: autoTitle,
        }
      );

      setProgressValue(100);
      setStatus('COMPLETED');
      if (response.success && response.data?.id) {
        message.success('已创建快速合并笔记');
        navigate(`/transcription/${response.data.id}`);
      } else {
        message.success('已生成快速合并结果，请手动保存');
      }
    } catch (error: any) {
      console.error('快速合并创建笔记失败:', error);
      setError(error.message || '快速合并创建笔记失败');
      setStatus('ERROR');
      message.error('快速合并创建笔记失败: ' + (error.message || '未知错误'));
    } finally {
      setIsCreatingNotes(false);
    }
  };

  const handleCreateNote = async () => {
    const sourcesWithContent = getSourcesWithContent();
    if (sourcesWithContent.length === 0) {
      message.warning('请至少在一个源中添加内容');
      return;
    }

    if (selectedSkillId) {
      setIsCreatingNotes(true);
      try {
        await handleSkillGenerate({ saveToNote: true });
      } finally {
        setIsCreatingNotes(false);
      }
      return;
    }

    if (autoSummary) {
      await handleCreateAiSummaryNote(sourcesWithContent);
      return;
    }

    await handleCreateQuickMergeNote(sourcesWithContent);
  };

  const [isLoadingFile, setIsLoadingFile] = useState(false);
  const [loadingMessage, setLoadingMessage] = useState('');

  // 图片文件扩展名
  const IMAGE_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp'];
  
  // 检查是否是图片文件
  const isImageFile = (fileName: string): boolean => {
    const ext = fileName.toLowerCase().slice(fileName.lastIndexOf('.'));
    return IMAGE_EXTENSIONS.includes(ext);
  };

  // 获取图片的 MIME 类型
  const getImageMimeType = (fileName: string): string => {
    const ext = fileName.toLowerCase().slice(fileName.lastIndexOf('.'));
    const mimeTypes: Record<string, string> = {
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.png': 'image/png',
      '.gif': 'image/gif',
      '.webp': 'image/webp',
      '.bmp': 'image/bmp',
    };
    return mimeTypes[ext] || 'image/jpeg';
  };

  // 解析 PDF 文件（尝试文本提取，如果失败则使用 OCR）
  const parsePDF = async (file: File): Promise<string> => {
    const arrayBuffer = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    let fullText = '';
    let hasText = false;
    
    // 首先尝试提取文本层
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const textContent = await page.getTextContent();
      const pageText = textContent.items
        .map((item: any) => item.str)
        .join(' ')
        .trim();
      if (pageText) {
        hasText = true;
        fullText += pageText + '\n\n';
      }
    }
    
    // 如果没有提取到文本，使用 Gemini OCR 逐页识别
    if (!hasText || fullText.trim().length < 50) {
      setLoadingMessage('PDF 无文本层，使用 AI 识别中...');
      fullText = '';
      
      for (let i = 1; i <= pdf.numPages; i++) {
        setLoadingMessage(`AI 识别第 ${i}/${pdf.numPages} 页...`);
        const page = await pdf.getPage(i);
        const viewport = page.getViewport({ scale: 2.0 }); // 提高分辨率
        
        // 创建 canvas 渲染 PDF 页面
        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d')!;
        canvas.height = viewport.height;
        canvas.width = viewport.width;
        
        await page.render({
          canvasContext: context,
          viewport: viewport,
          canvas: canvas,
        } as any).promise;
        
        // 转换为 base64
        const imageData = canvas.toDataURL('image/png').split(',')[1];
        
        try {
          const pageText = await extractTextWithGemini(imageData, 'image/png', `${file.name}_page_${i}`);
          fullText += `--- 第 ${i} 页 ---\n${pageText}\n\n`;
        } catch (err) {
          console.error(`OCR 第 ${i} 页失败:`, err);
          fullText += `--- 第 ${i} 页 ---\n[识别失败]\n\n`;
        }
      }
    }
    
    return fullText.trim();
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    setIsLoadingFile(true);
    setLoadingMessage(`正在导入 ${files.length} 个文件...`);
    
    try {
      const filesArray = Array.from(files);
      let successCount = 0;
      let failCount = 0;
      const newSources: SourceItem[] = [];

      // 处理每个文件
      for (let i = 0; i < filesArray.length; i++) {
        const file = filesArray[i];
        setLoadingMessage(`正在处理 ${i + 1}/${filesArray.length}: ${file.name}...`);
        
        try {
          let text = '';
          const fileName = file.name.toLowerCase();
          
          if (fileName.endsWith('.pdf')) {
            // PDF 文件
            setLoadingMessage(`解析 PDF ${i + 1}/${filesArray.length}: ${file.name}...`);
            text = await parsePDF(file);
            text = text.replace(/\n/g, '<br/>');
          } else if (isImageFile(fileName)) {
            // 图片文件 - 使用 Gemini OCR
            setLoadingMessage(`AI 识别图片 ${i + 1}/${filesArray.length}: ${file.name}...`);
            const base64 = await fileToBase64(file);
            const mimeType = getImageMimeType(fileName);
            text = await extractTextWithGemini(base64, mimeType, file.name);
            text = text.replace(/\n/g, '<br/>');
          } else {
            // 文本文件 (.txt, .md)
            setLoadingMessage(`读取文本 ${i + 1}/${filesArray.length}: ${file.name}...`);
            text = await new Promise<string>((resolve, reject) => {
              const reader = new FileReader();
              reader.onload = (event) => {
                const result = event.target?.result as string;
                resolve(result ? result.replace(/\n/g, '<br/>') : '');
              };
              reader.onerror = reject;
              reader.readAsText(file);
            });
          }

          if (text) {
            newSources.push({
              id: uuidv4(),
              title: file.name,
              content: text,
            });
            successCount++;
          }
        } catch (error: any) {
          console.error(`文件 ${file.name} 导入失败:`, error);
          failCount++;
        }
      }

      // 将导入的文件分配到源文本框
      if (newSources.length > 0) {
        // 先填充空的源文本框
        const updatedSources = [...sources];
        let newSourceIndex = 0;

        // 填充现有的空源
        for (let i = 0; i < updatedSources.length && newSourceIndex < newSources.length; i++) {
          if (updatedSources[i].content.replace(/<[^>]*>/g, '').trim() === '') {
            updatedSources[i] = {
              ...updatedSources[i],
              title: newSources[newSourceIndex].title,
              content: newSources[newSourceIndex].content,
            };
            newSourceIndex++;
          }
        }

        // 如果还有未分配的文件，创建新的源
        while (newSourceIndex < newSources.length && updatedSources.length < MAX_SOURCES) {
          updatedSources.push(newSources[newSourceIndex]);
          newSourceIndex++;
        }

        setSources(updatedSources);

        if (successCount > 0) {
          message.success(`成功导入 ${successCount} 个文件${failCount > 0 ? `，${failCount} 个失败` : ''}`);
        }
        if (failCount > 0 && successCount === 0) {
          message.error(`导入失败: ${failCount} 个文件`);
        }
      } else {
        message.warning('没有成功导入任何文件');
      }
    } catch (error: any) {
      console.error('文件导入失败:', error);
      message.error('文件导入失败: ' + (error.message || '未知错误'));
    } finally {
      setIsLoadingFile(false);
      setLoadingMessage('');
      e.target.value = '';
    }
  };

  const isResultMode = status === 'COMPLETED';

  const filledSourceCount = sources.filter((s) => s.content.replace(/<[^>]*>/g, '').length > 0).length;
  const totalChars = sources.reduce((sum, s) => sum + s.content.replace(/<[^>]*>/g, '').length, 0);
  const skillOptions = skills.map((skill) => ({
    value: skill.id,
    label: skill.name,
  }));
  const createNoteModeLabel = selectedSkillId ? 'Skill生成' : autoSummary ? 'AI总结' : '快速合并';
  const toolbarButtonClass = 'inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium transition disabled:cursor-not-allowed disabled:opacity-40';
  const quietToolbarButtonClass = `${toolbarButtonClass} text-slate-600 hover:bg-slate-100 hover:text-slate-900`;
  const resolvedTickerLabel = resolvedFmpSymbol
    ? `FMP ${resolvedFmpSymbol}${fmpCompanyName ? ` · ${fmpCompanyName}` : ''}`
    : '';

  return (
    <div className="flex flex-col h-full bg-white">
      {/* Compact toolbar header */}
      <div className="flex items-center justify-between gap-3 border-b border-slate-200 bg-slate-50/80 px-4 py-2.5 shrink-0">
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
          <div className="flex h-8 shrink-0 items-center gap-1 rounded-lg border border-slate-200 bg-white px-1 shadow-sm">
            <Tooltip title="导入 PDF / 图片 / 文本文件">
              <button
                className={quietToolbarButtonClass}
                disabled={status === 'PROCESSING' || isLoadingFile}
                onClick={() => document.getElementById('file-import-input')?.click()}
              >
                <InboxOutlined style={{ fontSize: 13 }} />
                <span>{isLoadingFile ? (loadingMessage || '导入中...') : '导入'}</span>
              </button>
            </Tooltip>
            <input
              id="file-import-input"
              type="file"
              multiple
              style={{ display: 'none' }}
              accept=".txt,.md,.pdf,.jpg,.jpeg,.png,.gif,.webp,.bmp"
              onChange={handleFileUpload}
              disabled={isLoadingFile}
            />

            <Tooltip title="勾选后，新建笔记会生成 AI 总结并提取元数据（一次 AI 调用）">
              <Checkbox
                checked={autoSummary}
                onChange={(e) => {
                  setAutoSummary(e.target.checked);
                  localStorage.setItem('uploadAutoSummary', String(e.target.checked));
                }}
              >
                <span className="text-xs font-medium text-slate-600 whitespace-nowrap">AI总结</span>
              </Checkbox>
            </Tooltip>
          </div>

          <div className="flex h-8 min-w-0 shrink-0 items-center gap-1 rounded-lg border border-slate-200 bg-white px-1.5 shadow-sm">
            <Select
              size="small"
              value={selectedSkillId || undefined}
              placeholder="选择 Skill"
              options={skillOptions}
              onChange={(value) => setSelectedSkillId(value || '')}
              disabled={status === 'PROCESSING'}
              allowClear
              showSearch
              optionFilterProp="label"
              notFoundContent="暂无 Skill"
              variant="borderless"
              style={{ width: 190 }}
            />
            <div className="h-5 w-px bg-slate-200" />
            <Tooltip title="输入 FMP 或 Bloomberg ticker 后验证，例如 WMB / WMB US Equity / 700 HK Equity">
              <Input
                size="small"
                value={fmpTicker}
                placeholder="FMP / BBG ticker"
                onChange={(e) => {
                  setFmpTicker(normalizeTickerDraft(e.target.value));
                  setResolvedFmpSymbol('');
                  setFmpCompanyName('');
                  setFmpTickerConfidence(null);
                }}
                onPressEnter={handleResolveTicker}
                disabled={status === 'PROCESSING'}
                variant="borderless"
                style={{ width: 166 }}
              />
            </Tooltip>
            <Tooltip title="只验证输入框里的 ticker，不读取正文">
              <button
                className={`${toolbarButtonClass} bg-emerald-50 text-emerald-700 hover:bg-emerald-100 disabled:bg-slate-50 disabled:text-slate-400`}
                disabled={status === 'PROCESSING' || isResolvingTicker || !fmpTicker.trim()}
                onClick={handleResolveTicker}
              >
                <SearchOutlined style={{ fontSize: 12 }} />
                <span>{isResolvingTicker ? '验证中' : '验证'}</span>
              </button>
            </Tooltip>
            {resolvedTickerLabel && (
              <Tooltip title={`${resolvedTickerLabel}${fmpTickerConfidence != null ? ` · confidence ${(fmpTickerConfidence * 100).toFixed(0)}%` : ''}`}>
                <span className="inline-flex h-6 max-w-[260px] items-center gap-1 truncate rounded-md border border-emerald-200 bg-emerald-50 px-2 text-[11px] font-medium text-emerald-700">
                  <CheckCircleOutlined style={{ fontSize: 12 }} />
                  <span className="truncate">{resolvedTickerLabel}</span>
                </span>
              </Tooltip>
            )}
          </div>

          <div className="flex h-8 min-w-0 shrink-0 items-center gap-1 rounded-lg border border-slate-200 bg-white px-1 shadow-sm">
            <Tooltip title="按当前 Skill 生成预览结果；不新建笔记">
              <button
                className={`${toolbarButtonClass} bg-violet-50 text-violet-700 hover:bg-violet-100 disabled:bg-slate-50 disabled:text-slate-400`}
                disabled={status === 'PROCESSING' || !selectedSkillId}
                onClick={() => handleSkillGenerate()}
              >
                <ThunderboltOutlined style={{ fontSize: 12 }} />
                <span>{status === 'PROCESSING' ? '生成中...' : 'Skill生成'}</span>
              </button>
            </Tooltip>
            <Tooltip title={`新建笔记：${createNoteModeLabel}${selectedSkillId ? '' : autoSummary ? '；未选 Skill 时走 AI 总结' : '；未选 Skill 且未勾 AI总结时走快速合并'}`}>
              <button
                className={`${toolbarButtonClass} bg-blue-600 text-white hover:bg-blue-700`}
                disabled={status === 'PROCESSING' || isCreatingNotes || filledSourceCount === 0}
                onClick={handleCreateNote}
              >
                <PlusOutlined style={{ fontSize: 12 }} />
                <span>{status === 'PROCESSING' || isCreatingNotes ? '新建中...' : '新建笔记'}</span>
              </button>
            </Tooltip>

            <Dropdown
              menu={{
                items: [
                  {
                    key: 'prompt',
                    label: '查看主策略提示词',
                    icon: <SettingOutlined />,
                    onClick: () => setShowPromptInspector(true),
                  },
                ] as MenuProps['items'],
              }}
              disabled={status === 'PROCESSING'}
              trigger={['click']}
            >
              <button className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-slate-500 transition hover:bg-slate-100 hover:text-slate-800">
                <SettingOutlined style={{ fontSize: 13 }} />
              </button>
            </Dropdown>
          </div>
        </div>

        <div className="hidden shrink-0 items-center gap-3 text-xs text-slate-400 md:flex">
          <span>{filledSourceCount} 个源</span>
          <span>{totalChars} 字符</span>
        </div>
      </div>

      {/* Progress bar */}
      {status === 'PROCESSING' && (
        <div className="px-4 py-2 border-b border-slate-100 bg-slate-50 shrink-0">
          <div className="flex justify-between text-xs text-slate-500 mb-1">
            <span>{progressMessage}</span>
            <span>{progressValue}%</span>
          </div>
          <Progress percent={progressValue} showInfo={false} strokeColor="#1677ff" size="small" style={{ margin: 0 }} />
        </div>
      )}

      {/* Error banner */}
      {error && (
        <div className="mx-3 mt-2 px-3 py-2 bg-red-50 border border-red-200 rounded text-xs text-red-600 flex items-center gap-2 shrink-0">
          <span>{error}</span>
          <button onClick={() => setError(null)} className="ml-auto text-red-400 hover:text-red-600 font-medium">Dismiss</button>
        </div>
      )}

      {/* Main content */}
      {isResultMode ? (
        <div className="flex-1 overflow-hidden">
          <ResultView
            content={result}
            isTruncated={isTruncated}
            onReset={handleReset}
            onSave={handleSaveResult}
            title={resultMeta.title}
            generatedBy={resultMeta.generatedBy}
          />
        </div>
      ) : (
        <div className="flex-1 overflow-auto p-3">
          {/* Source Grid */}
          <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))' }}>
            {sources.map((source, index) => (
              <SourceCard
                key={source.id}
                source={source}
                index={index}
                onUpdate={updateSource}
                onRemove={removeSource}
                placeholder={PLACEHOLDER_TEXTS[index] || '粘贴其他源文本...'}
              />
            ))}

            {/* Add New Source */}
            {sources.length < MAX_SOURCES && (
              <button
                onClick={addSource}
                className="h-[280px] rounded-md border-2 border-dashed border-slate-200 flex flex-col items-center justify-center text-slate-400 bg-slate-50/50 transition-all cursor-pointer group hover:bg-white hover:border-blue-300 hover:text-blue-500"
              >
                <PlusIcon className="w-5 h-5 mb-1" />
                <span className="text-xs font-medium">添加源</span>
              </button>
            )}
          </div>
        </div>
      )}

      {/* Modals */}
      <Modal title="活动主策略" open={showPromptInspector} onCancel={() => setShowPromptInspector(false)} footer={null} width={700}>
        <PromptInspector />
      </Modal>

    </div>
  );
};

export default MergePage;
