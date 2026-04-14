import React, { useState, useEffect } from 'react';
import { Modal, Upload, Select, Button, Progress, message, List, Tag } from 'antd';
import { InboxOutlined, CloudUploadOutlined, CheckCircleOutlined, CloseCircleOutlined, LoadingOutlined } from '@ant-design/icons';
import type { UploadFile } from 'antd/es/upload/interface';
import { useNavigate } from 'react-router-dom';
import { uploadWithSignedUrl } from '../api/transcription';
import { getApiConfig } from './ApiConfigModal';

const { Dragger } = Upload;

type AIProvider = 'gemini' | 'qwen';

const GEMINI_TRANSCRIPTION_MODELS = [
  { value: 'gemini-3-flash-preview', label: 'Gemini 3 Flash (Preview)' },
  { value: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash' },
];

interface UploadModalProps {
  open: boolean;
  onClose: () => void;
}

interface FileUploadStatus {
  file: File;
  status: 'pending' | 'uploading' | 'success' | 'error';
  progress: number;
  id?: string;
  error?: string;
}

const UploadModal: React.FC<UploadModalProps> = ({ open, onClose }) => {
  const navigate = useNavigate();
  const [uploadFileList, setUploadFileList] = useState<UploadFile[]>([]);
  // 合并AI服务和模型选择
  const [selectedOption, setSelectedOption] = useState<string>('qwen-flash');
  const [geminiTranscriptionModel, setGeminiTranscriptionModel] = useState<string>('gemini-3-flash-preview');
  const [uploading, setUploading] = useState(false);
  const [fileStatuses, setFileStatuses] = useState<FileUploadStatus[]>([]);

  // 从本地存储加载 API 配置
  const [apiConfig, setApiConfig] = useState(getApiConfig());

  useEffect(() => {
    if (open) {
      setApiConfig(getApiConfig());
    }
    const handleUpdate = () => setApiConfig(getApiConfig());
    window.addEventListener('apiConfigUpdated', handleUpdate);
    return () => window.removeEventListener('apiConfigUpdated', handleUpdate);
  }, [open]);

  // 从本地存储加载自定义 Prompt
  const customPrompt = (() => {
    const saved = localStorage.getItem('summaryPrompt');
    return saved || 'Please intelligently summarize the following transcribed text, extracting key information and main points. Present the summary in a clear, structured format (such as headings, lists, etc.), but do not use any dividers or horizontal lines.\n\nIMPORTANT: Use the same language as the transcribed text for your summary. If the text is in English, summarize in English. If the text is in Chinese, summarize in Chinese.\n\nTranscribed text:\n{text}\n\nPlease provide the summary:';
  })();

  const handleClose = () => {
    if (uploading) {
      message.warning('文件正在上传中，请稍候...');
      return;
    }
    setUploadFileList([]);
    setFileStatuses([]);
    onClose();
  };

  const updateFileStatus = (index: number, update: Partial<FileUploadStatus>) => {
    setFileStatuses(prev => {
      const newStatuses = [...prev];
      newStatuses[index] = { ...newStatuses[index], ...update };
      return newStatuses;
    });
  };

  const uploadSingleFile = async (file: File, index: number) => {
    updateFileStatus(index, { status: 'uploading', progress: 0 });

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

      // 使用 Signed URL 直传方案上传文件
      const response = await uploadWithSignedUrl(
        file,
        signedUrlModel,
        aiProvider,
        {
          qwenApiKey: apiConfig.qwenApiKey || undefined,
          geminiApiKey: apiConfig.geminiApiKey || undefined,
          qwenModel,
          customPrompt,
          transcriptionModel: aiProvider === 'gemini' ? geminiTranscriptionModel : undefined,
          summaryModel: apiConfig.summaryModel || undefined,
          metadataModel: apiConfig.metadataModel || undefined,
          onProgress: (percent) => {
            // 上传进度占 80%，四舍五入为整数
            updateFileStatus(index, {
              progress: Math.round(Math.min(80, percent * 0.8))
            });
          },
        }
      );

      if (response.success && response.data) {
        updateFileStatus(index, {
          status: 'success',
          progress: 100,
          id: response.data.id
        });
        return { success: true, id: response.data.id };
      } else {
        throw new Error(response.error || '转录失败');
      }
    } catch (error: any) {
      const errorMsg = error.response?.data?.error || error.message || '上传失败';
      updateFileStatus(index, {
        status: 'error',
        progress: 0,
        error: errorMsg
      });
      return { success: false, error: errorMsg };
    }
  };

  const handleUpload = async () => {
    if (uploadFileList.length === 0) {
      message.error('请先选择音频文件');
      return;
    }

    // API 密钥提示（不阻止上传，后端会 fallback 到环境变量）

    // 验证所有文件
    const files: File[] = [];
    for (const uploadFile of uploadFileList) {
      if (!uploadFile.originFileObj) {
        message.error('文件无效');
        return;
      }
      files.push(uploadFile.originFileObj);
    }

    // 初始化文件状态
    const initialStatuses: FileUploadStatus[] = files.map(file => ({
      file,
      status: 'pending',
      progress: 0
    }));
    setFileStatuses(initialStatuses);
    setUploading(true);

    message.info(`开始并发上传 ${files.length} 个文件...`);

    // 并发上传所有文件
    const uploadPromises = files.map((file, index) => uploadSingleFile(file, index));
    const results = await Promise.all(uploadPromises);

    setUploading(false);

    // 统计结果
    const successCount = results.filter(r => r.success).length;
    const failCount = results.filter(r => !r.success).length;

    if (successCount > 0 && failCount === 0) {
      message.success(`全部上传成功！共 ${successCount} 个文件`);
      setTimeout(() => {
        handleClose();
        navigate('/history');
      }, 1500);
    } else if (successCount > 0) {
      message.warning(`部分上传成功：${successCount} 成功，${failCount} 失败`);
    } else {
      message.error('全部上传失败');
    }
  };

  const getStatusIcon = (status: FileUploadStatus['status']) => {
    switch (status) {
      case 'success':
        return <CheckCircleOutlined style={{ color: '#52c41a' }} />;
      case 'error':
        return <CloseCircleOutlined style={{ color: '#ff4d4f' }} />;
      case 'uploading':
        return <LoadingOutlined style={{ color: '#1890ff' }} />;
      default:
        return null;
    }
  };

  const getStatusTag = (status: FileUploadStatus['status']) => {
    switch (status) {
      case 'success':
        return <Tag color="success">成功</Tag>;
      case 'error':
        return <Tag color="error">失败</Tag>;
      case 'uploading':
        return <Tag color="processing">处理中</Tag>;
      case 'pending':
        return <Tag>等待中</Tag>;
    }
  };

  return (
    <Modal
      title={`上传音频文件${uploadFileList.length > 0 ? ` (${uploadFileList.length} 个)` : ''}`}
      open={open}
      onCancel={handleClose}
      footer={null}
      width={700}
      maskClosable={!uploading}
    >
      <div style={{ padding: '20px 0' }}>
        <Dragger
          multiple
          fileList={uploadFileList}
          onChange={({ fileList }) => {
            // ✅ 修复内存泄漏：限制最多 50 个文件（避免无限增长）
            const MAX_FILES = 50;
            const limitedFileList = fileList.length > MAX_FILES 
              ? fileList.slice(0, MAX_FILES) 
              : fileList;
            if (fileList.length > MAX_FILES) {
              message.warning(`最多只能上传 ${MAX_FILES} 个文件，已自动移除多余的文件`);
            }
            setUploadFileList(limitedFileList);
          }}
          beforeUpload={() => false}
          accept="audio/*"
          disabled={uploading}
          style={{ marginBottom: 20 }}
        >
          <p className="ant-upload-drag-icon">
            <InboxOutlined />
          </p>
          <p className="ant-upload-text">点击或拖拽音频文件到此区域上传</p>
          <p className="ant-upload-hint">
            支持多文件并发上传，MP3、WAV、M4A、OGG 等格式，单个文件不超过500MB
          </p>
        </Dragger>

        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: selectedOption === 'gemini' ? 8 : 16 }}>
          <label style={{ fontSize: 14, flexShrink: 0 }}>转录服务：</label>
          <Select
            value={selectedOption}
            onChange={setSelectedOption}
            style={{ width: '100%', maxWidth: 400 }}
            disabled={uploading}
          >
            <Select.Option value="gemini">Google Gemini</Select.Option>
            <Select.Option value="qwen-paraformer-v2">阿里通义千问 - Paraformer V2</Select.Option>
            <Select.Option value="qwen-flash">阿里通义千问 - Qwen3 Flash（不支持区分说话人）</Select.Option>
          </Select>
        </div>
        {selectedOption === 'gemini' && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16, paddingLeft: 72 }}>
            <label style={{ fontSize: 13, color: '#666', flexShrink: 0 }}>模型：</label>
            <Select
              value={geminiTranscriptionModel}
              onChange={setGeminiTranscriptionModel}
              options={GEMINI_TRANSCRIPTION_MODELS}
              style={{ width: '100%', maxWidth: 300 }}
              disabled={uploading}
              size="small"
            />
          </div>
        )}

        {/* 显示API密钥配置提示 */}
        {!apiConfig.geminiApiKey && !apiConfig.qwenApiKey && (
          <div style={{ marginBottom: 16, padding: 12, background: '#e6f7ff', borderRadius: 4, fontSize: 13, color: '#096dd9', border: '1px solid #91d5ff' }}>
            💡 未在前端配置 API 密钥，将使用服务器端配置
          </div>
        )}

        {/* 上传状态列表 */}
        {fileStatuses.length > 0 && (
          <div style={{ marginTop: 20, maxHeight: 300, overflowY: 'auto' }}>
            <List
              size="small"
              bordered
              dataSource={fileStatuses}
              renderItem={(item, index) => (
                <List.Item
                  style={{ padding: '12px 16px' }}
                  extra={getStatusTag(item.status)}
                >
                  <List.Item.Meta
                    avatar={getStatusIcon(item.status)}
                    title={
                      <div style={{ fontSize: 13 }}>
                        {item.file.name}
                        <span style={{ marginLeft: 8, color: '#999', fontSize: 12 }}>
                          ({(item.file.size / 1024 / 1024).toFixed(2)} MB)
                        </span>
                      </div>
                    }
                    description={
                      <div>
                        {item.status === 'uploading' && (
                          <Progress 
                            percent={item.progress} 
                            size="small" 
                            status="active"
                            style={{ marginTop: 4 }}
                          />
                        )}
                        {item.status === 'error' && (
                          <span style={{ color: '#ff4d4f', fontSize: 12 }}>
                            {item.error}
                          </span>
                        )}
                        {item.status === 'success' && (
                          <span style={{ color: '#52c41a', fontSize: 12 }}>
                            转录成功！
                          </span>
                        )}
                      </div>
                    }
                  />
                </List.Item>
              )}
            />
          </div>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 12, marginTop: 20 }}>
          <Button
            onClick={handleClose}
            disabled={uploading}
          >
            {uploading ? '上传中...' : '取消'}
          </Button>
          <Button
            type="primary"
            onClick={handleUpload}
            disabled={uploadFileList.length === 0 || uploading}
            loading={uploading}
            icon={<CloudUploadOutlined />}
          >
            开始转录 ({uploadFileList.length})
          </Button>
        </div>
      </div>
    </Modal>
  );
};

export default UploadModal;
