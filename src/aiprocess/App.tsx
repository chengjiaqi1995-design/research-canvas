import { useState } from 'react';
import { MemoryRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { ConfigProvider, Layout, Button, Space, Tooltip, Dropdown, message } from 'antd';
import { SettingOutlined, CloudUploadOutlined, MergeCellsOutlined, AudioOutlined, RobotOutlined, MenuUnfoldOutlined, MenuFoldOutlined, ShareAltOutlined, DownloadOutlined, BarChartOutlined, FileTextOutlined, ApartmentOutlined, HistoryOutlined, EllipsisOutlined, StockOutlined } from '@ant-design/icons';
import apiClient from './api/client';
import { useNavigate, useLocation } from 'react-router-dom';
import zhCN from 'antd/locale/zh_CN';
import { getTranscriptions } from './api/transcription';
import HistoryPage from './pages/HistoryPage';
import OrganizationPage from './pages/OrganizationPage';
import TranscriptionDetailPage from './pages/TranscriptionDetailPage';
import RealtimeRecordPage from './pages/RealtimeRecordPage';
import ProjectPage from './pages/ProjectPage';
import MergePage from './pages/MergePage';
import KnowledgeBasePage from './pages/KnowledgeBasePage';
import ShareViewPage from './pages/ShareViewPage';
import WeeklySummaryPage from './pages/WeeklySummaryPage';
import PortfolioLayout from './pages/portfolio/PortfolioLayout';
import LoginPage from './pages/LoginPage';
import AuthCallbackPage from './pages/AuthCallbackPage';
import ProtectedRoute from './components/ProtectedRoute';
import ApiConfigModal from './components/ApiConfigModal';
import UploadModal from './components/UploadModal';
import ShareModal from './components/ShareModal';
import { useSidebar, SidebarProvider } from './contexts/SidebarContext';
import styles from './App.module.css';

const { Header, Content } = Layout;

function AppContent() {
  const navigate = useNavigate();
  const location = useLocation();
  const [configModalOpen, setConfigModalOpen] = useState(false);
  const [uploadModalOpen, setUploadModalOpen] = useState(false);
  const [shareModalOpen, setShareModalOpen] = useState(false);
  const [backupLoading, setBackupLoading] = useState(false);
  const { sidebarCollapsed, setSidebarCollapsed } = useSidebar();

  // 检查是否是分享页面
  const isSharePage = location.pathname.startsWith('/share/');

  // 检查是否是登录相关页面
  const isAuthPage = location.pathname === '/login' || location.pathname.startsWith('/auth/');

  const isHistoryActive = () => {
    return location.pathname === '/history';
  };

  const handleLogoClick = async () => {
    try {
      // 获取最新的转录记录（按创建时间降序，取第一个）
      const response = await getTranscriptions({
        page: 1,
        pageSize: 1,
        sortBy: 'createdAt',
        sortOrder: 'desc',
      });

      if (response.success && response.data && response.data.items.length > 0) {
        const latestTranscription = response.data.items[0];
        navigate(`/transcription/${latestTranscription.id}`);
      } else {
        // 如果没有记录，跳转到历史记录页面
        navigate('/history');
      }
    } catch (error: any) {
      console.error('获取最新记录失败:', error);
      // 出错时跳转到历史记录页面
      navigate('/history');
    }
  };

  const handleBackup = async () => {
    try {
      setBackupLoading(true);
      message.loading({ content: '正在生成备份...', key: 'backup', duration: 0 });

      const response = await apiClient.get('/backup/export', {
        responseType: 'blob',
        timeout: 600000, // 10 分钟超时
      });

      // 从 Content-Disposition 或生成文件名
      const dateStr = new Date().toISOString().slice(0, 10);
      const fileName = `AI-Notebook-Backup-${dateStr}.zip`;

      // 创建 Blob 下载链接
      const blob = new Blob([response.data], { type: 'application/zip' });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);

      message.success({ content: '备份下载完成！', key: 'backup' });
    } catch (error: any) {
      console.error('备份失败:', error);
      message.error({ content: '备份失败，请稍后重试', key: 'backup' });
    } finally {
      setBackupLoading(false);
    }
  };

  // 分享页面使用独立布局，不显示 Header
  if (isSharePage) {
    return (
      <Routes>
        <Route path="/share/:token" element={<ShareViewPage />} />
      </Routes>
    );
  }

  // 登录页面使用独立布局，不显示 Header
  if (isAuthPage) {
    return (
      <Layout style={{ minHeight: '100vh' }}>
        <Content style={{ background: '#ffffff', height: '100vh', overflow: 'hidden', padding: 0 }}>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route path="/auth/callback" element={<AuthCallbackPage />} />
          </Routes>
        </Content>
      </Layout>
    );
  }

  return (
    <Layout style={{ height: '100%', width: '100%' }}>
      <Header style={{ display: 'flex', alignItems: 'center', background: '#fafafa', padding: '0 16px', borderBottom: '1px solid #f0f0f0' }}>
        {/* 折叠按钮 - 仅在转录详情页显示 */}
        {location.pathname.startsWith('/transcription') && (
          <Button
            type="text"
            icon={sidebarCollapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
            onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
            style={{ color: '#666', marginRight: 4 }}
            title={sidebarCollapsed ? '展开侧边栏' : '折叠侧边栏'}
          />
        )}
        {/* 左侧导航：Notes, Directory, Weekly */}
        <Space size={0} className={styles.desktopNav}>
          <Tooltip title="Notes">
            <Button
              type="text"
              icon={<FileTextOutlined />}
              onClick={handleLogoClick}
              className={`${styles.navBtn} ${location.pathname.startsWith('/transcription') ? styles.active : ''}`}
            />
          </Tooltip>
          <Tooltip title="Directory">
            <Button
              type="text"
              icon={<ApartmentOutlined />}
              onClick={() => navigate('/organization')}
              className={`${styles.navBtn} ${location.pathname === '/organization' ? styles.active : ''}`}
            />
          </Tooltip>
          <Tooltip title="周报">
            <Button
              type="text"
              icon={<BarChartOutlined />}
              onClick={() => navigate('/weekly-summary')}
              className={`${styles.navBtn} ${location.pathname === '/weekly-summary' ? styles.active : ''}`}
            />
          </Tooltip>
          <Tooltip title="Portfolio">
            <Button
              type="text"
              icon={<StockOutlined />}
              onClick={() => navigate('/portfolio')}
              className={`${styles.navBtn} ${location.pathname.startsWith('/portfolio') ? styles.active : ''}`}
            />
          </Tooltip>
        </Space>
        <div style={{ flex: 1 }} />
        {/* 右侧操作：History + 工具图标 */}
        <Space size={0} className={styles.desktopActions}>
          <Tooltip title="History">
            <Button
              type="text"
              icon={<HistoryOutlined />}
              onClick={() => navigate('/history')}
              className={`${styles.navBtn} ${isHistoryActive() ? styles.active : ''}`}
            />
          </Tooltip>
          <div className={styles.navDivider} />
          <Tooltip title="上传音频">
            <Button type="text" icon={<CloudUploadOutlined />} onClick={() => setUploadModalOpen(true)} className={styles.actionBtn} />
          </Tooltip>
          <Tooltip title="导入notes">
            <Button type="text" icon={<MergeCellsOutlined />} onClick={() => navigate('/merge')} className={styles.actionBtn} />
          </Tooltip>
          <Tooltip title="实时录音">
            <Button type="text" icon={<AudioOutlined />} onClick={() => navigate('/realtime')} className={styles.actionBtn} />
          </Tooltip>
          <Tooltip title="知识库问答">
            <Button type="text" icon={<RobotOutlined />} onClick={() => navigate('/knowledge-base')} className={styles.actionBtn} />
          </Tooltip>
          {(location.pathname === '/history' || location.pathname === '/organization' || location.pathname.startsWith('/transcription/')) && (
            <Tooltip title="分享">
              <Button type="text" icon={<ShareAltOutlined />} onClick={() => setShareModalOpen(true)} className={styles.actionBtn} />
            </Tooltip>
          )}
          <Tooltip title="备份导出">
            <Button type="text" icon={<DownloadOutlined />} onClick={handleBackup} loading={backupLoading} className={styles.actionBtn} />
          </Tooltip>
          <Tooltip title="API配置">
            <Button type="text" icon={<SettingOutlined />} onClick={() => setConfigModalOpen(true)} className={styles.actionBtn} />
          </Tooltip>
        </Space>
      </Header>
      <Content style={{ background: '#ffffff', height: '100%', flex: 1, overflow: 'hidden', padding: 0 }}>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/auth/callback" element={<AuthCallbackPage />} />
          <Route
            path="/"
            element={
              <ProtectedRoute>
                <Navigate to="/history" replace />
              </ProtectedRoute>
            }
          />
          <Route
            path="/realtime"
            element={
              <ProtectedRoute>
                <RealtimeRecordPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/history"
            element={
              <ProtectedRoute>
                <HistoryPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/organization"
            element={
              <ProtectedRoute>
                <OrganizationPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/projects"
            element={
              <ProtectedRoute>
                <ProjectPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/merge"
            element={
              <ProtectedRoute>
                <MergePage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/knowledge-base"
            element={
              <ProtectedRoute>
                <KnowledgeBasePage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/weekly-summary"
            element={
              <ProtectedRoute>
                <WeeklySummaryPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/transcription/:id"
            element={
              <ProtectedRoute>
                <TranscriptionDetailPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/portfolio/*"
            element={
              <ProtectedRoute>
                <PortfolioLayout />
              </ProtectedRoute>
            }
          />
          <Route path="*" element={<Navigate to="/history" replace />} />
        </Routes>
      </Content>
      <ApiConfigModal
        open={configModalOpen}
        onClose={() => setConfigModalOpen(false)}
      />
      <UploadModal
        open={uploadModalOpen}
        onClose={() => setUploadModalOpen(false)}
      />
      <ShareModal
        open={shareModalOpen}
        onClose={() => setShareModalOpen(false)}
      />
    </Layout>
  );
}

function App() {
  return (
    <ConfigProvider locale={zhCN}>
      <Router>
        <SidebarProvider>
          <AppContent />
        </SidebarProvider>
      </Router>
    </ConfigProvider>
  );
}

export default App;
