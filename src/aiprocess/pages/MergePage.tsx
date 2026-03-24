import React, { useState, useCallback, useEffect } from 'react';
import { v4 as uuidv4 } from 'uuid';
import {
  Card,
  Button,
  Space,
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
import styles from './MergePage.module.css';

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

  return (
    <div className={styles.mergePage}>
      <Card className={styles.mergeCard}>
        {/* Header removed - all controls moved to bottom action bar */}

        {isResultMode ? (
          <ResultView
            content={result}
            isTruncated={isTruncated}
            onReset={handleReset}
            onSave={handleSaveResult}
          />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 200px)', overflow: 'hidden' }}>
            {/* Scrollable Container for Input Mode */}
            <div style={{ flex: 1, overflow: 'auto', paddingBottom: 120 }}>
              {/* Error Banner */}
              {error && (
                <div
                  style={{
                    background: '#fff1f0',
                    border: '1px solid #ffccc7',
                    color: '#cf1322',
                    padding: '12px 16px',
                    borderRadius: 0,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    maxWidth: 1200,
                    margin: '0 auto 16px',
                    fontSize: '14px',
                  }}
                >
                  <span>⚠️</span>
                  {error}
                </div>
              )}

              {/* Source Grid */}
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(400px, 1fr))',
                  gap: 16,
                  paddingBottom: 16,
                }}
              >
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

                {/* Add New Source Card */}
                {sources.length < MAX_SOURCES && (
                  <button
                    onClick={addSource}
                    style={{
                      height: '320px',
                      border: '2px dashed #d9d9d9',
                      borderRadius: 0,
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      justifyContent: 'center',
                      color: '#999',
                      background: '#fafafa',
                      cursor: 'pointer',
                      transition: 'all 0.2s',
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.borderColor = '#666';
                      e.currentTarget.style.color = '#333';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.borderColor = '#d9d9d9';
                      e.currentTarget.style.color = '#999';
                    }}
                  >
                    <div
                      style={{
                        padding: 12,
                        background: '#f0f0f0',
                        borderRadius: 0,
                        marginBottom: 8,
                      }}
                    >
                      <PlusIcon className="w-6 h-6" />
                    </div>
                    <span style={{ fontSize: '14px', fontWeight: 500, color: '#333' }}>添加源</span>
                  </button>
                )}
              </div>

            </div>

            {/* Action Bar (Fixed at bottom) */}
            <div
              style={{
                position: 'sticky',
                bottom: 0,
                background: '#ffffff',
                borderTop: '1px solid #e8e8e8',
                padding: '12px 16px',
                marginTop: 'auto',
              }}
            >
              <div
                style={{
                  maxWidth: 1200,
                  margin: '0 auto',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 12,
                }}
              >
                {/* Bottom Row: Status, Progress and Actions */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 16, width: '100%' }}>
                  {/* Left: Actions */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>
                    <Button
                      type="default"
                      size="large"
                      icon={isLoadingFile ? <LoadingOutlined spin /> : <InboxOutlined />}
                      disabled={status === 'PROCESSING' || isLoadingFile}
                      onClick={() => document.getElementById('file-import-input')?.click()}
                      loading={isLoadingFile}
                      style={{ minWidth: 120 }}
                    >
                      {isLoadingFile ? (loadingMessage || '导入中...') : '导入文件'}
                    </Button>
                    <input
                      id="file-import-input"
                      type="file"
                      multiple
                      style={{ display: 'none' }}
                      accept=".txt,.md,.pdf,.jpg,.jpeg,.png,.gif,.webp,.bmp"
                      onChange={handleFileUpload}
                      disabled={isLoadingFile}
                    />
                    {/* Create Notes Button */}
                    <Button
                      type="default"
                      icon={<PlusOutlined />}
                      onClick={handleCreateNotes}
                      disabled={status === 'PROCESSING' || isCreatingNotes}
                      loading={isCreatingNotes}
                      size="large"
                      style={{ minWidth: 120 }}
                    >
                      {isCreatingNotes ? '创建中...' : '新建笔记'}
                    </Button>
                    {/* Merge Button */}
                    <Button
                      type="default"
                      icon={<MergeCellsOutlined />}
                      onClick={handleAggregate}
                      disabled={status === 'PROCESSING'}
                      loading={status === 'PROCESSING'}
                      size="large"
                      style={{ minWidth: 120 }}
                    >
                      {status === 'PROCESSING'
                        ? '处理中...'
                        : isDeepMode
                        ? '深度合并'
                        : '快速合并'}
                    </Button>
                    {/* Deep Merge Toggle */}
                    <Tooltip title="深度合并">
                      <Checkbox
                        checked={isDeepMode}
                        onChange={(e) => setIsDeepMode(e.target.checked)}
                        style={{ fontSize: '14px', lineHeight: '32px', color: '#333' }}
                      />
                    </Tooltip>
                    {/* Settings Dropdown */}
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
                    <Button
                      type="text"
                      size="small"
                      icon={<SettingOutlined />}
                      disabled={status === 'PROCESSING'}
                      style={{ color: '#333', fontSize: '14px' }}
                    />
                    </Dropdown>
                  </div>

                  {/* Center: Progress */}
                  {status === 'PROCESSING' ? (
                    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 8 }}>
                      <div
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          fontSize: '14px',
                          fontWeight: 500,
                          color: '#333',
                          textTransform: 'uppercase',
                          letterSpacing: '0.5px',
                        }}
                      >
                        <span>{progressMessage}</span>
                        <span>{progressValue}%</span>
                      </div>
                      <Progress
                        percent={progressValue}
                        showInfo={false}
                        strokeColor="#333"
                        style={{ margin: 0 }}
                      />
                    </div>
                  ) : (
                    <div style={{ flex: 1 }} />
                  )}

                  {/* Right: Source Count and Character Count */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>
                    {/* Source Count */}
                    <span style={{ fontSize: '14px', color: '#333', lineHeight: '32px' }}>
                      {sources.filter((s) => s.content.replace(/<[^>]*>/g, '').length > 0).length} 个源
                    </span>
                    {/* Total Character Count */}
                    <span style={{ fontSize: '14px', color: '#333', lineHeight: '32px' }}>
                      {sources.reduce((sum, s) => sum + s.content.replace(/<[^>]*>/g, '').length, 0)} 字符
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </Card>
      
      {/* Prompt Inspector Modal */}
      <Modal
        title="活动主策略"
        open={showPromptInspector}
        onCancel={() => setShowPromptInspector(false)}
        footer={null}
        width={700}
      >
        <PromptInspector />
      </Modal>

      {/* Outline Config Modal */}
      <Modal
        title="自定义目录（大纲）生成"
        open={showOutlineModal}
        onCancel={() => setShowOutlineModal(false)}
        onOk={() => setShowOutlineModal(false)}
        okText="确定"
        cancelText="取消"
        width={600}
      >
        <div style={{ marginTop: 16 }}>
          <label
            style={{
              display: 'block',
              fontSize: '14px',
              fontWeight: 500,
              color: '#333',
              marginBottom: 8,
            }}
          >
            大纲生成提示词
          </label>
          <TextArea
            value={outlinePrompt}
            onChange={(e) => setOutlinePrompt(e.target.value)}
            placeholder="例如：重点关注财务差异。按竞争对手分组。确保'市场分析'是第一章。"
            rows={4}
            style={{
              fontSize: '14px',
              fontFamily: 'monospace',
            }}
          />
          <div style={{ marginTop: 8, fontSize: '14px', color: '#666' }}>
            留空则使用默认大纲生成策略
          </div>
        </div>
      </Modal>
    </div>
  );
};

export default MergePage;
