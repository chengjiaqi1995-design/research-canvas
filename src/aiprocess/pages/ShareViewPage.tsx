import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Spin, Alert, Button, Tabs, Card } from 'antd';
import { LoginOutlined } from '@ant-design/icons';
import { getSharedContent, getDynamicShareData } from '../api/share';
import { ReadOnlyProvider } from '../contexts/ReadOnlyContext';
import HistoryPage from './HistoryPage';
import OrganizationPage from './OrganizationPage';
import TranscriptionDetailPage from './TranscriptionDetailPage';
import type { Transcription } from '../types';
import styles from './ShareViewPage.module.css';

interface ShareConfig {
  modules: {
    notes: boolean;
    history: boolean;
    directory: boolean;
  };
  type: 'dynamic';
}

const ShareViewPage: React.FC = () => {
  const { token } = useParams<{ token: string }>();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [requireAuth, setRequireAuth] = useState(false);
  const [shareConfig, setShareConfig] = useState<ShareConfig | null>(null);
  const [notesData, setNotesData] = useState<Transcription[]>([]);
  const [historyData, setHistoryData] = useState<Transcription[]>([]);
  const [directoryData, setDirectoryData] = useState<Transcription[]>([]);
  const [industries, setIndustries] = useState<string[]>([]);
  const [loadingData, setLoadingData] = useState(false);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isStaticShare, setIsStaticShare] = useState(false);

  useEffect(() => {
    const authToken = localStorage.getItem('token') || localStorage.getItem('auth_token');
    setIsAuthenticated(!!authToken);
  }, []);

  useEffect(() => {
    loadShareConfig();
  }, [token, isAuthenticated]);

  const handleLogin = () => {
    const returnUrl = `/share/${token}`;
    navigate(`/login?returnUrl=${encodeURIComponent(returnUrl)}`);
  };

  const loadShareConfig = async () => {
    if (!token) {
      setError('分享链接无效');
      setLoading(false);
      return;
    }

    try {
      const response = await getSharedContent(token);

      if (response.data?.success && response.data?.data) {
        if (response.data.data.requireAuth && !isAuthenticated) {
          setRequireAuth(true);
          setError('需要登录');
          setLoading(false);
          return;
        }

        if (response.data.data.isDynamic && response.data.data.config) {
          // 动态分享：显示多个模块
          setShareConfig(response.data.data.config);
          setRequireAuth(response.data.data.requireAuth || false);
          loadDynamicData(token);
        } else if (response.data.data.isDynamic === false) {
          // 静态分享：单个 note
          try {
            const noteData = JSON.parse(response.data.data.content);
            // 标记为静态分享
            setIsStaticShare(true);
            setShareConfig({
              modules: { notes: true, history: false, directory: false },
              type: 'dynamic'
            });
            setNotesData([noteData]);
            setRequireAuth(response.data.data.requireAuth || false);
            setLoadingData(false);
          } catch (e) {
            console.error('解析静态分享内容失败:', e);
            setError('分享内容格式错误');
          }
        } else {
          setError('此分享链接格式不支持');
        }
      } else {
        setError(response.data?.error || '加载失败');
        if (response.status === 401) {
          setRequireAuth(true);
        }
      }
    } catch (error: any) {
      console.error('加载分享配置失败:', error);
      const errorMsg = error.response?.data?.error || error.message || '加载失败';
      setError(errorMsg);
      if (error.response?.status === 401) {
        setRequireAuth(true);
      }
    } finally {
      setLoading(false);
    }
  };

  const loadDynamicData = async (shareToken: string) => {
    setLoadingData(true);
    try {
      const response = await getDynamicShareData(shareToken);

      if (response.data?.success && response.data?.data) {
        if (response.data.data.notes) {
          // 转换数据格式，确保与 Transcription 类型兼容
          const notes = response.data.data.notes.map((note: any) => ({
            ...note,
            status: 'completed',
            tags: note.tags || [],
          }));
          setNotesData(notes);
        }
        if (response.data.data.history) {
          const history = response.data.data.history.map((item: any) => ({
            ...item,
            status: item.status || 'completed',
            tags: item.tags || [],
          }));
          setHistoryData(history);
        }
        if (response.data.data.directory) {
          const directory = response.data.data.directory.map((item: any) => ({
            ...item,
            status: 'completed',
            tags: item.tags || [],
          }));
          setDirectoryData(directory);

          // 优先使用后端返回的用户自定义行业列表（保持顺序和配置）
          if (response.data.data.industries && Array.isArray(response.data.data.industries) && response.data.data.industries.length > 0) {
            setIndustries(response.data.data.industries);
          } else {
            // 后备：提取行业列表
            const industrySet = new Set<string>();
            directory.forEach((item: any) => {
              if (item.industry && item.industry !== '未分类') {
                industrySet.add(item.industry);
              }
            });
            setIndustries(Array.from(industrySet));
          }
        }
      }
    } catch (error: any) {
      console.error('加载动态数据失败:', error);
    } finally {
      setLoadingData(false);
    }
  };

  if (loading) {
    return (
      <div className={styles.shareViewPage}>
        <div className={styles.loadingContainer}>
          <Spin size="large" />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className={styles.shareViewPage}>
        <Card style={{ maxWidth: 800, margin: '40px auto' }}>
          <Alert
            message={requireAuth ? "需要登录" : "加载失败"}
            description={
              requireAuth ? (
                <div>
                  <p>此分享链接需要 Google 登录才能访问。</p>
                  <Button
                    type="primary"
                    icon={<LoginOutlined />}
                    onClick={handleLogin}
                    style={{ marginTop: 16 }}
                  >
                    使用 Google 登录
                  </Button>
                </div>
              ) : (
                error
              )
            }
            type={requireAuth ? "warning" : "error"}
            showIcon
          />
        </Card>
      </div>
    );
  }

  if (!shareConfig) {
    return (
      <div className={styles.shareViewPage}>
        <Card style={{ maxWidth: 800, margin: '40px auto' }}>
          <Alert
            message="内容不存在"
            type="warning"
            showIcon
          />
        </Card>
      </div>
    );
  }

  // 静态分享：极简界面，只显示 Notes 内容
  if (isStaticShare && notesData.length > 0) {
    const note = notesData[0];
    return (
      <ReadOnlyProvider isReadOnly={true} shareToken={token}>
        <div className={styles.staticShareContainer}>
          {/* 标题 */}
          <h1 style={{ fontSize: '24px', fontWeight: 600, marginBottom: '24px', marginTop: 0 }}>
            {note.fileName || '分享的笔记'}
          </h1>

          {/* Notes 内容 */}
          <div
            className={styles.staticShareContent}
            style={{ marginBottom: note.translatedSummary ? '40px' : 0 }}
            dangerouslySetInnerHTML={{ __html: note.summary || '无内容' }}
          />

          {/* Notes（中文）内容 - 仅在有翻译时显示 */}
          {note.translatedSummary && (
            <div
              className={styles.staticShareContent}
              dangerouslySetInnerHTML={{ __html: note.translatedSummary }}
            />
          )}
        </div>
      </ReadOnlyProvider>
    );
  }

  // 动态分享：原有的标签页界面
  // 构建 Tab 项
  const tabItems = [];

  if (shareConfig.modules.notes) {
    tabItems.push({
      key: 'notes',
      label: `Notes (${notesData.length})`,
      children: (
        <div style={{ height: '100%' }}>
          <TranscriptionDetailPage
            externalData={notesData}
            externalId={notesData[0]?.id}
          />
        </div>
      ),
    });
  }

  if (shareConfig.modules.history) {
    tabItems.push({
      key: 'history',
      label: `History (${historyData.length})`,
      children: (
        <div style={{ height: '100%' }}>
          <HistoryPage externalData={historyData} />
        </div>
      ),
    });
  }

  if (shareConfig.modules.directory) {
    tabItems.push({
      key: 'directory',
      label: `Directory (${directoryData.length})`,
      children: (
        <div style={{ height: '100%' }}>
          <OrganizationPage
            externalData={directoryData}
            externalIndustries={industries}
          />
        </div>
      ),
    });
  }

  return (
    <ReadOnlyProvider isReadOnly={true} shareToken={token}>
      <div className={styles.shareViewFullscreen}>
        {loadingData ? (
          <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}>
            <Spin size="large" />
          </div>
        ) : (
          <Tabs
            defaultActiveKey={tabItems[0]?.key}
            items={tabItems}
            style={{ height: '100%' }}
            tabBarStyle={{ marginBottom: 0, paddingLeft: 16 }}
          />
        )}
      </div>
    </ReadOnlyProvider>
  );
};

export default ShareViewPage;
