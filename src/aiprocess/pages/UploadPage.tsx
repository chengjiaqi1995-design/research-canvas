import { useState, useEffect } from 'react';
import { Upload, Button, Select, Card, message, Spin, Progress } from 'antd';
import { InboxOutlined, CloudUploadOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import type { UploadFile } from 'antd/es/upload/interface';
import { uploadWithSignedUrl, importMarkdown } from '../api/transcription';
import type { AIProvider } from '../types';
import { getApiConfig } from '../components/ApiConfigModal';
import { getFilledMetadataPrompt } from '../../utils/metadataFillPrompt';
import { useIndustryCategoryStore } from '../../stores/industryCategoryStore';
import styles from './UploadPage.module.css';

const { Dragger } = Upload;

const UploadPage: React.FC = () => {
  const navigate = useNavigate();
  const [fileList, setFileList] = useState<UploadFile[]>([]);
  // 合并AI服务和模型选择：gemini, qwen-paraformer-v2, qwen-flash
  const [selectedOption, setSelectedOption] = useState<string>('gemini');
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [processingIndex, setProcessingIndex] = useState(0);

  // 从本地存储加载 API 配置
  const [apiConfig, setApiConfig] = useState(getApiConfig);

  useEffect(() => {
    const handleUpdate = () => setApiConfig(getApiConfig());
    window.addEventListener('apiConfigUpdated', handleUpdate);
    return () => window.removeEventListener('apiConfigUpdated', handleUpdate);
  }, []);

  // 是否包含 MD 文件
  const hasMdFiles = fileList.length > 0 && fileList.every(f => f.name.toLowerCase().endsWith('.md'));
  const hasMixedFiles = fileList.length > 0 && !hasMdFiles && fileList.some(f => f.name.toLowerCase().endsWith('.md'));

  const handleUpload = async () => {
    if (fileList.length === 0) {
      message.warning('请选择要上传的文件');
      return;
    }

    if (hasMixedFiles) {
      message.error('不支持同时上传音频和 Markdown 文件，请分开上传');
      return;
    }

    if (hasMdFiles) {
      return handleImportMarkdown();
    }

    // 无论使用哪个转录服务，总结都需要 Gemini API Key
    if (!apiConfig.geminiApiKey) {
      message.error('请先在 API 配置中设置 Gemini API Key（总结功能必需）');
      return;
    }

    console.log('准备上传文件列表，共计', fileList.length, '个');
    setUploading(true);
    setProgress(0);
    setProcessingIndex(0);

    try {
      // 根据选择解析 AI 服务、模型和签名 URL 模型标识
      let aiProvider: AIProvider;
      let qwenModel: string | undefined;
      let signedUrlModel: string;

      if (selectedOption === 'gemini') {
        aiProvider = 'gemini';
        signedUrlModel = 'gemini';
      } else if (selectedOption === 'qwen-paraformer-v2') {
        aiProvider = 'qwen';
        qwenModel = 'paraformer-v2';
        signedUrlModel = 'paraformer-v2';
      } else if (selectedOption === 'qwen-flash') {
        aiProvider = 'qwen';
        qwenModel = 'qwen3-asr-flash-filetrans';
        signedUrlModel = 'qwen3-asr-flash-filetrans';
      } else {
        aiProvider = 'gemini';
        signedUrlModel = 'gemini';
      }

      let successCount = 0;
      let lastSuccessId = '';

      for (let i = 0; i < fileList.length; i++) {
        setProcessingIndex(i);
        setProgress(0);

        const fileItem = fileList[i];
        const file = (fileItem.originFileObj || fileItem) as File;

        if (!file || !(file instanceof File)) {
          console.error('无效的文件对象:', fileItem);
          message.error(`第 ${i + 1} 个文件对象无效`);
          continue;
        }

        console.log(`正在上传第 ${i + 1}/${fileList.length} 个文件:`, file.name, file.type, file.size);

        try {
          // 使用 Signed URL 直传方案上传文件
          const response = await uploadWithSignedUrl(
            file,
            signedUrlModel,
            aiProvider,
            {
              qwenApiKey: apiConfig.qwenApiKey || undefined,
              geminiApiKey: apiConfig.geminiApiKey || undefined,
              qwenModel,
              customPrompt: localStorage.getItem('summaryPrompt') || undefined,
              metadataFillPrompt: (() => {
                const cats = useIndustryCategoryStore.getState().categories;
                return getFilledMetadataPrompt(cats.flatMap(c => c.subCategories).join('、'));
              })(),
              onProgress: (percent) => {
                // 上传进度占 80%，转录处理占 20%
                setProgress(Math.min(80, percent * 0.8));
              },
            }
          );

          setProgress(100);

          if (response.success && response.data) {
            successCount++;
            lastSuccessId = response.data.id;
          } else {
            console.error(`第 ${i + 1} 个文件转录失败:`, response.error);
            message.error(`文件 ${file.name} 处理失败: ${response.error || '未知错误'}`);
          }
        } catch (fileError: any) {
          console.error(`第 ${i + 1} 个文件发生异常:`, fileError);
          message.error(`文件 ${file.name} 发送失败: ${fileError.response?.data?.error || fileError.message}`);
        }

        // 每个文件之间稍微等待缓冲，避免过快的并发干扰
        if (i < fileList.length - 1) {
          await new Promise(resolve => setTimeout(resolve, 800));
        }
      }

      if (successCount > 0) {
        message.success(`所有任务结束，成功转录 ${successCount}/${fileList.length} 个文件！`);
        // 跳转到详情页或列表页
        setTimeout(() => {
          if (fileList.length === 1 && successCount === 1) {
            navigate(`/transcription/${lastSuccessId}`);
          } else {
            // 多文件则统一回列表或首页，确保能看到最新的转录项
            navigate('/');
          }
        }, 800);
      } else {
        message.error(`处理失败，这 ${fileList.length} 个文件均未能成功转录。`);
      }
    } catch (error: any) {
      console.error('批量上传过程中断:', error);
      message.error(error.message || '上传过程中发生严重错误');
    } finally {
      setUploading(false);
      setProgress(0);
    }
  };

  const handleImportMarkdown = async () => {
    setUploading(true);
    setProgress(0);

    try {
      const notes = await Promise.all(
        fileList.map(async (fileItem) => {
          const file = (fileItem.originFileObj || fileItem) as File;
          return new Promise<{ fileName: string; content: string }>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = (e) => {
              resolve({
                fileName: file.name,
                content: e.target?.result as string,
              });
            };
            reader.onerror = reject;
            reader.readAsText(file);
          });
        })
      );

      setProgress(50);
      const response = await importMarkdown({ notes });
      setProgress(100);

      if (response.success) {
        message.success(`成功导入 ${notes.length} 条笔记！`);
        // 如果只导入了一条，跳转到详情页
        if (response.data && response.data.length === 1) {
          setTimeout(() => {
            navigate(`/transcription/${response.data![0].id}`);
          }, 500);
        } else {
          // 多条则跳转到历史页
          setTimeout(() => {
            navigate('/history');
          }, 500);
        }
      } else {
        throw new Error(response.error || '导入失败');
      }
    } catch (error: any) {
      console.error('导入失败:', error);
      message.error(error.message || '导入失败');
      setProgress(0);
    } finally {
      setUploading(false);
    }
  };

  const uploadProps = {
    onRemove: () => {
      setFileList([]);
    },
    beforeUpload: (file: File) => {
      // 检查文件类型 - 更宽松的验证
      // 1. 检查 MIME 类型
      const isAudioMime = file.type.startsWith('audio/');
      // 2. 检查文件扩展名
      const fileName = file.name.toLowerCase();
      const isMd = fileName.endsWith('.md');
      const audioExtensions = ['.mp3', '.wav', '.m4a', '.ogg', '.flac', '.aac', '.wma', '.opus', '.webm', '.mpeg', '.mp4', '.avi', '.mov'];
      const hasAudioExtension = audioExtensions.some(ext => fileName.endsWith(ext));

      if (!isAudioMime && !hasAudioExtension && !isMd) {
        message.error('只能上传音频文件或 Markdown 文件！');
        return false;
      }

      // 检查文件大小（限制500MB，使用 Signed URL 直传无 32MB 限制）
      const isLt500M = file.size / 1024 / 1024 < 500;
      if (!isLt500M) {
        message.error('文件大小不能超过500MB！');
        return false;
      }

      // 创建 UploadFile 对象，确保包含 originFileObj
      const uploadFile: UploadFile = {
        uid: file.name + '-' + Date.now(),
        name: file.name,
        status: 'done',
        originFileObj: file as any,
        size: file.size,
        type: file.type,
      };

      setFileList(prev => {
        const isNewFileMd = file.name.toLowerCase().endsWith('.md');
        const hasExistingMd = prev.some(f => f.name.toLowerCase().endsWith('.md'));
        const hasExistingAudio = prev.some(f => !f.name.toLowerCase().endsWith('.md'));

        if (isNewFileMd) {
          if (hasExistingAudio) {
            message.error('不支持同时上传音频和 Markdown 文件');
            return prev;
          }
          return [...prev, uploadFile];
        } else {
          // 如果是音频，支持多文件上传和排队转录
          if (hasExistingMd) {
            message.error('不支持同时上传音频和 Markdown 文件');
            return prev;
          }
          return [...prev, uploadFile];
        }
      });
      return false; // 阻止自动上传
    },
    fileList,
  };

  return (
    <div className={styles.uploadPage}>
      <Card className={styles.uploadCard}>
        <div className={styles.pageHeader}>
          <div>
            <h1 className={styles.pageTitle}>{hasMdFiles ? '导入 Markdown 笔记' : 'AI音频转录'}</h1>
            <p className={styles.pageDescription}>
              {hasMdFiles
                ? '上传 Markdown 文件，自动创建笔记并生成智能总结'
                : '上传音频文件，使用AI自动转录为文字并生成智能总结'}
            </p>
          </div>
        </div>

        <div className={styles.uploadSection}>
          <Dragger {...uploadProps} disabled={uploading} multiple={true} style={{ maxWidth: '100%' }}>
            <p className="ant-upload-drag-icon">
              <InboxOutlined />
            </p>
            <p className="ant-upload-text">点击或拖拽文件到此区域上传</p>
            <p className="ant-upload-hint">
              支持语音格式或 .md 文档。Markdown 支持批量上传。
            </p>
          </Dragger>

          {!hasMdFiles && (
            <div className={styles.providerSelection} style={{ width: '100%', maxWidth: '100%' }}>
              <label>选择转录服务（3个选项）：</label>
              <Select
                value={selectedOption}
                onChange={setSelectedOption}
                style={{ width: '100%', maxWidth: 400 }}
                disabled={uploading}
              >
                <Select.Option value="gemini">
                  Google Gemini - 2.5 Flash
                </Select.Option>
                <Select.Option value="qwen-paraformer-v2">
                  阿里通义千问 - Paraformer V2
                </Select.Option>
                <Select.Option value="qwen-flash">
                  阿里通义千问 - Qwen3 Flash（不支持区分说话人）
                </Select.Option>
              </Select>
            </div>
          )}

          {/* 显示API密钥配置提示 */}
          {!apiConfig.geminiApiKey && !apiConfig.qwenApiKey && (
            <div style={{ marginTop: 8, padding: 12, background: '#e6f7ff', borderRadius: 4, fontSize: 13, color: '#096dd9', border: '1px solid #91d5ff' }}>
              💡 未在前端配置 API 密钥，将使用服务器端配置
            </div>
          )}

          {uploading && (
            <div className={styles.progressSection}>
              <Spin size="large" />
              <Progress percent={progress} status="active" />
              <p className={styles.progressText}>
                {hasMdFiles
                  ? '正在导入笔记，请稍候...'
                  : `正在处理第 ${processingIndex + 1}/${fileList.length} 个文件，请耐心等待...`}
              </p>
            </div>
          )}

          <Button
            type="primary"
            onClick={handleUpload}
            disabled={fileList.length === 0 || uploading}
            loading={uploading}
            size="large"
            icon={<CloudUploadOutlined />}
            className={styles.uploadButton}
          >
            {uploading ? '处理中...' : (hasMdFiles ? '开始导入' : '开始转录')}
          </Button>
        </div>
      </Card>
    </div>
  );
};

export default UploadPage;
