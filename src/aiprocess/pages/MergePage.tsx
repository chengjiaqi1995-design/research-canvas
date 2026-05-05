import React, { useState, useCallback, useEffect } from 'react';
import { v4 as uuidv4 } from 'uuid';
import {
  Button,
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
import { InboxOutlined, PlusOutlined, SettingOutlined, FileTextOutlined, MergeCellsOutlined, ThunderboltOutlined } from '@ant-design/icons';
import * as pdfjsLib from 'pdfjs-dist';

// 设置 PDF.js worker - 使用 public 目录下的静态文件
pdfjsLib.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.js';
import type { SourceItem, AggregationMode, AppStatus } from './merge/types';
import { MAX_SOURCES, PLACEHOLDER_TEXTS } from './merge/constants';
import { aggregateContent, extractTextWithGemini, fileToBase64 } from './merge/geminiService';
import { SourceCard } from './merge/components/SourceCard';
import { ResultView } from './merge/components/ResultView';
import { PromptInspector } from './merge/components/PromptInspector';
import { PlusIcon } from './merge/components/Icons';
import { createMergeHistory, createFromText } from '../api/transcription';
import { useNavigate } from 'react-router-dom';
import { getApiConfig } from '../components/ApiConfigModal';
import { getFilledMetadataPrompt } from '../../utils/metadataFillPrompt';
import { useIndustryCategoryStore } from '../../stores/industryCategoryStore';
import { aiApi } from '../../db/apiClient';
import { useAICardStore } from '../../stores/aiCardStore';
import { buildEarningsReviewApiPromptContext } from '../../utils/earningsReviewApiContext';

const { TextArea } = Input;

type ResultMeta = {
  kind: 'merge' | 'skill';
  model: string;
  title: string;
  generatedBy: string;
};

const DEFAULT_SKILL_MODEL = 'gemini-3-flash-preview';

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

  // Advanced Mode State
  const [isDeepMode, setIsDeepMode] = useState<boolean>(false);
  const [outlinePrompt, setOutlinePrompt] = useState<string>('');
  const [selectedSkillId, setSelectedSkillId] = useState<string>('');
  const [skillModel, setSkillModel] = useState<string>(() => getApiConfig().mergeSkillModel || DEFAULT_SKILL_MODEL);

  const [progressMessage, setProgressMessage] = useState<string>('');
  const [progressValue, setProgressValue] = useState<number>(0);

  // Prompt Inspector Modal State
  const [showPromptInspector, setShowPromptInspector] = useState(false);
  
  // Outline Config Modal State
  const [showOutlineModal, setShowOutlineModal] = useState<boolean>(false);

  useEffect(() => {
    let cancelled = false;
    const refreshSkillModelFromLocal = () => {
      const config = getApiConfig();
      setSkillModel(config.mergeSkillModel || config.summaryModel || DEFAULT_SKILL_MODEL);
    };

    loadModels();
    syncWithServer();
    refreshSkillModelFromLocal();
    aiApi.getSettings()
      .then((settings) => {
        if (!cancelled) {
          const cloudConfig = settings.apiConfig || {};
          setSkillModel(cloudConfig.mergeSkillModel || getApiConfig().mergeSkillModel || settings.defaultModel || DEFAULT_SKILL_MODEL);
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
    if (!skills.length) return;
    if (!selectedSkillId || !skills.some((skill) => skill.id === selectedSkillId)) {
      setSelectedSkillId(skills[0].id);
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

  const handleAggregate = async () => {
    const sourcesWithContent = getSourcesWithContent();
    if (sourcesWithContent.length === 0) {
      setError('请至少在一个源中添加内容');
      return;
    }

    setStatus('PROCESSING');
    setError(null);
    setIsTruncated(false);
    setProgressValue(0);
    setProgressMessage('正在初始化 AI 代理...');

    try {
      const mode: AggregationMode = isDeepMode ? 'deep' : 'comprehensive';

      const { text, isTruncated: truncated } = await aggregateContent(
        sources,
        mode,
        (msg, val) => {
          setProgressMessage(msg);
          setProgressValue(val);
        },
        isDeepMode ? outlinePrompt : undefined
      );

      setResult(text);
      setIsTruncated(truncated);
      setResultMeta({
        kind: 'merge',
        model: 'gemini',
        title: isDeepMode ? '深度合并结果' : '合并结果',
        generatedBy: 'Gemini AI',
      });
      setStatus('COMPLETED');
    } catch (e: any) {
      setError(e.message || '发生意外错误');
      setStatus('ERROR');
    }
  };

  const handleSkillGenerate = async () => {
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

    const model = skillModel || getApiConfig().mergeSkillModel || DEFAULT_SKILL_MODEL;
    const modelName = models.find((item) => item.id === model)?.name || model;
    const attachments = sourcesWithContent
      .map((source, index) => [
        `<attachment index="${index + 1}" title="${source.title}">`,
        source.content,
        '</attachment>',
      ].join('\n'))
      .join('\n\n---\n\n');
    const earningsApiContext = await buildEarningsReviewApiPromptContext({
      skill,
      prompt: `${skill.name}\n${sourcesWithContent.map((source) => source.title).join('\n')}`,
      context: attachments,
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
      '- 引用来源时使用【源1: 标题】这类格式，确保可以追溯到附件。',
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

      const finalText = generated.trim();
      if (!finalText) {
        throw new Error('Skill 生成结果为空');
      }

      setProgressValue(92);
      setProgressMessage('正在保存到 Summary...');
      setResult(finalText);

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
        setResult(generated.trim());
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
      : isDeepMode ? '(深度)' : '';
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
  // 新建笔记时是否自动生成 summary 和提取元数据（复用上传 Modal 同一个 localStorage 键）
  const [autoSummary, setAutoSummary] = useState<boolean>(() => {
    const saved = localStorage.getItem('uploadAutoSummary');
    return saved === null ? true : saved === 'true';
  });

  // 为每个有内容的源创建独立笔记
  const handleCreateNotes = async () => {
    const sourcesWithContent = sources.filter(
      (s) => s.content.replace(/<[^>]*>/g, '').trim().length > 0
    );

    if (sourcesWithContent.length === 0) {
      message.warning('请至少在一个源中添加内容');
      return;
    }

    setIsCreatingNotes(true);
    let successCount = 0;
    let lastCreatedId = '';

    const apiConfig = getApiConfig();
    const geminiApiKey = apiConfig.geminiApiKey || undefined;

    // 仅在勾选 autoSummary 时传 prompt（与上传 Modal 逻辑一致）
    const customPrompt = autoSummary ? (localStorage.getItem('summaryPrompt') || undefined) : undefined;
    const metadataFillPrompt = autoSummary ? (() => {
      const cats = useIndustryCategoryStore.getState().categories;
      return getFilledMetadataPrompt(cats.flatMap(c => c.subCategories).join('、'));
    })() : undefined;

    try {
      for (let i = 0; i < sourcesWithContent.length; i++) {
        const source = sourcesWithContent[i];
        const sourceTitle = source.title.trim() || `源 ${sources.indexOf(source) + 1}`;

        const response = await createFromText({
          text: source.content,
          sourceTitle: sourceTitle,
          geminiApiKey,
          customPrompt,
          metadataFillPrompt,
          summaryModel: apiConfig.summaryModel || undefined,
        });

        if (response.success && response.data) {
          successCount++;
          lastCreatedId = response.data.id;
        }
      }

      if (successCount > 0) {
        message.success(`成功创建 ${successCount} 个笔记！`);
        // 跳转到最后创建的笔记
        if (lastCreatedId) {
          navigate(`/transcription/${lastCreatedId}`);
        }
      } else {
        message.error('创建笔记失败');
      }
    } catch (error: any) {
      console.error('创建笔记失败:', error);
      message.error('创建笔记失败: ' + (error.message || '未知错误'));
    } finally {
      setIsCreatingNotes(false);
    }
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
  return (
    <div className="flex flex-col h-full bg-white">
      {/* Compact toolbar header */}
      <div className="flex items-center justify-between gap-2 px-3 py-1.5 border-b border-slate-200 shrink-0 bg-white">
        <div className="flex min-w-0 items-center gap-1.5 overflow-x-auto">
          <h1 className="text-sm font-semibold text-slate-800 mr-2 shrink-0 whitespace-nowrap">多文档合并</h1>

          <Tooltip title="导入 PDF / 图片 / 文本文件">
            <button
              className="flex shrink-0 items-center gap-1 px-2 py-1 text-xs rounded hover:bg-slate-100 text-slate-500 hover:text-slate-700 disabled:opacity-40 whitespace-nowrap"
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

          <Tooltip title="为每个有内容的源创建独立笔记">
            <button
              className="flex shrink-0 items-center gap-1 px-2 py-1 text-xs rounded hover:bg-slate-100 text-slate-500 hover:text-slate-700 disabled:opacity-40 whitespace-nowrap"
              disabled={status === 'PROCESSING' || isCreatingNotes}
              onClick={handleCreateNotes}
            >
              <PlusOutlined style={{ fontSize: 12 }} />
              <span>{isCreatingNotes ? '创建中...' : '新建笔记'}</span>
            </button>
          </Tooltip>

          <Tooltip title="勾选后，新建笔记会自动生成摘要并提取元数据（一次 AI 调用）">
            <Checkbox
              checked={autoSummary}
              onChange={(e) => {
                setAutoSummary(e.target.checked);
                localStorage.setItem('uploadAutoSummary', String(e.target.checked));
              }}
              className="ml-1"
            >
              <span className="text-xs text-slate-500 whitespace-nowrap">自动摘要</span>
            </Checkbox>
          </Tooltip>

          <Tooltip title={isDeepMode ? '深度合并（多轮 AI）' : '快速合并'}>
            <button
              className="flex shrink-0 items-center gap-1 px-2 py-1 text-xs rounded bg-blue-50 hover:bg-blue-100 text-blue-600 disabled:opacity-40 whitespace-nowrap"
              disabled={status === 'PROCESSING'}
              onClick={handleAggregate}
            >
              <MergeCellsOutlined style={{ fontSize: 12 }} />
              <span>{status === 'PROCESSING' ? '处理中...' : isDeepMode ? '深度合并' : '快速合并'}</span>
            </button>
          </Tooltip>

          <Tooltip title="切换深度/快速模式">
            <Checkbox
              checked={isDeepMode}
              onChange={(e) => setIsDeepMode(e.target.checked)}
              className="ml-1"
            >
              <span className="text-xs text-slate-500 whitespace-nowrap">深度</span>
            </Checkbox>
          </Tooltip>

          <div className="flex shrink-0 items-center gap-1.5 ml-1 pl-2 border-l border-slate-200">
            <Select
              size="small"
              value={selectedSkillId || undefined}
              placeholder="选择 Skill"
              options={skillOptions}
              onChange={setSelectedSkillId}
              disabled={status === 'PROCESSING'}
              showSearch
              optionFilterProp="label"
              notFoundContent="暂无 Skill"
              style={{ width: 150 }}
            />
            <Tooltip title="把多个源作为附件，按 Skill 生成并保存到 Summary">
              <button
                className="flex shrink-0 items-center gap-1 px-2 py-1 text-xs rounded bg-indigo-50 hover:bg-indigo-100 text-indigo-600 disabled:opacity-40 whitespace-nowrap"
                disabled={status === 'PROCESSING' || skills.length === 0}
                onClick={handleSkillGenerate}
              >
                <ThunderboltOutlined style={{ fontSize: 12 }} />
                <span>{status === 'PROCESSING' ? '生成中...' : 'Skill生成'}</span>
              </button>
            </Tooltip>
          </div>

          <Dropdown
            menu={{
              items: (() => {
                const items: MenuProps['items'] = [
                  {
                    key: 'prompt',
                    label: '查看主策略提示词',
                    icon: <SettingOutlined />,
                    onClick: () => setShowPromptInspector(true),
                  },
                ];
                if (isDeepMode) {
                  items.push({
                    key: 'outline',
                    label: '自定义大纲',
                    icon: <FileTextOutlined />,
                    onClick: () => setShowOutlineModal(true),
                  });
                }
                return items;
              })(),
            }}
            disabled={status === 'PROCESSING'}
            trigger={['click']}
          >
            <button className="p-1 rounded hover:bg-slate-100 text-slate-400 hover:text-slate-600 shrink-0">
              <SettingOutlined style={{ fontSize: 13 }} />
            </button>
          </Dropdown>
        </div>

        <div className="flex shrink-0 items-center gap-3 text-xs text-slate-400">
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

      <Modal title="自定义目录（大纲）生成" open={showOutlineModal} onCancel={() => setShowOutlineModal(false)} onOk={() => setShowOutlineModal(false)} okText="确定" cancelText="取消" width={600}>
        <div style={{ marginTop: 16 }}>
          <label className="block text-sm font-medium text-slate-700 mb-2">大纲生成提示词</label>
          <TextArea
            value={outlinePrompt}
            onChange={(e) => setOutlinePrompt(e.target.value)}
            placeholder="例如：重点关注财务差异。按竞争对手分组。确保'市场分析'是第一章。"
            rows={4}
            style={{ fontSize: '13px', fontFamily: 'monospace' }}
          />
          <div className="mt-2 text-xs text-slate-400">留空则使用默认大纲生成策略</div>
        </div>
      </Modal>
    </div>
  );
};

export default MergePage;
