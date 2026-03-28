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
} from 'antd';
import type { MenuProps } from 'antd';
import { InboxOutlined, LoadingOutlined, PlusOutlined, SettingOutlined, FileTextOutlined, MergeCellsOutlined } from '@ant-design/icons';
import * as pdfjsLib from 'pdfjs-dist';

// 设置 PDF.js worker - 使用本地文件
pdfjsLib.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';
import type { SourceItem, AggregationMode, AppStatus } from './merge/types';
import { MAX_SOURCES, PLACEHOLDER_TEXTS } from './merge/constants';
import { aggregateContent, extractTextWithGemini, fileToBase64 } from './merge/geminiService';
import { SourceCard } from './merge/components/SourceCard';
import { ResultView } from './merge/components/ResultView';
import { PromptInspector } from './merge/components/PromptInspector';
import { PlusIcon } from './merge/components/Icons';
import { createMergeHistory, createFromText } from '../api/transcription';
import { useNavigate } from 'react-router-dom';

const { TextArea } = Input;

const MergePage: React.FC = () => {
  const navigate = useNavigate();
  const [sources, setSources] = useState<SourceItem[]>([
    { id: uuidv4(), title: '', content: '' },
    { id: uuidv4(), title: '', content: '' },
  ]);
  const [status, setStatus] = useState<AppStatus>('IDLE');
  const [result, setResult] = useState<string>('');
  const [isTruncated, setIsTruncated] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  // Advanced Mode State
  const [isDeepMode, setIsDeepMode] = useState<boolean>(true);
  const [outlinePrompt, setOutlinePrompt] = useState<string>('');

  const [progressMessage, setProgressMessage] = useState<string>('');
  const [progressValue, setProgressValue] = useState<number>(0);

  // Prompt Inspector Modal State
  const [showPromptInspector, setShowPromptInspector] = useState(false);
  
  // Outline Config Modal State
  const [showOutlineModal, setShowOutlineModal] = useState<boolean>(false);


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
    // Basic validation: strip HTML tags to check for empty content
    const hasContent = sources.some((s) => s.content.replace(/<[^>]*>/g, '').trim().length > 0);
    if (!hasContent) {
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
      setStatus('COMPLETED');
    } catch (e: any) {
      setError(e.message || '发生意外错误');
      setStatus('ERROR');
    }
  };

  const handleReset = () => {
    setStatus('IDLE');
    setResult('');
    setIsTruncated(false);
    setError(null);
    setProgressValue(0);
  };

  const handleSaveResult = async () => {
    if (!result) return;

    // Create a default title based on first source or date
    const firstSourceTitle = sources.find((s) => s.title)?.title;
    const modeLabel = isDeepMode ? '(深度)' : '';
    const autoTitle = firstSourceTitle
      ? `${firstSourceTitle} ${modeLabel}`
      : `合并 ${new Date().toLocaleString('zh-CN')} ${modeLabel}`;

    // Save to database
    try {
      const response = await createMergeHistory(
        autoTitle,
        result,
        sources,
        'gemini'
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

    try {
      for (let i = 0; i < sourcesWithContent.length; i++) {
        const source = sourcesWithContent[i];
        const sourceTitle = source.title.trim() || `源 ${sources.indexOf(source) + 1}`;
        
        const response = await createFromText({
          text: source.content,
          sourceTitle: sourceTitle,
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

  return (
    <div className="flex flex-col h-full bg-white">
      {/* Compact toolbar header */}
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-slate-200 shrink-0 bg-white">
        <div className="flex items-center gap-1.5">
          <h1 className="text-sm font-semibold text-slate-800 mr-2">多文档合并</h1>

          <Tooltip title="导入 PDF / 图片 / 文本文件">
            <button
              className="flex items-center gap-1 px-2 py-1 text-xs rounded hover:bg-slate-100 text-slate-500 hover:text-slate-700 disabled:opacity-40"
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
              className="flex items-center gap-1 px-2 py-1 text-xs rounded hover:bg-slate-100 text-slate-500 hover:text-slate-700 disabled:opacity-40"
              disabled={status === 'PROCESSING' || isCreatingNotes}
              onClick={handleCreateNotes}
            >
              <PlusOutlined style={{ fontSize: 12 }} />
              <span>{isCreatingNotes ? '创建中...' : '新建笔记'}</span>
            </button>
          </Tooltip>

          <Tooltip title={isDeepMode ? '深度合并（多轮 AI）' : '快速合并'}>
            <button
              className="flex items-center gap-1 px-2 py-1 text-xs rounded bg-blue-50 hover:bg-blue-100 text-blue-600 disabled:opacity-40"
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
              <span className="text-xs text-slate-500">深度</span>
            </Checkbox>
          </Tooltip>

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
            <button className="p-1 rounded hover:bg-slate-100 text-slate-400 hover:text-slate-600">
              <SettingOutlined style={{ fontSize: 13 }} />
            </button>
          </Dropdown>
        </div>

        <div className="flex items-center gap-3 text-xs text-slate-400">
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
                className="h-[280px] rounded-lg border-2 border-dashed border-slate-200 flex flex-col items-center justify-center text-slate-400 bg-slate-50/50 transition-all cursor-pointer group hover:bg-white hover:border-blue-300 hover:text-blue-500"
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
