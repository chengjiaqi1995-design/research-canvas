import { useState } from 'react';
import { MemoryRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { ConfigProvider, Layout, Button, Space, Tooltip, message } from 'antd';
import { SettingOutlined, CloudUploadOutlined, MergeCellsOutlined, MenuUnfoldOutlined, MenuFoldOutlined, DownloadOutlined, FileTextOutlined, HistoryOutlined } from '@ant-design/icons';
import apiClient from './api/client';
import { useNavigate, useLocation } from 'react-router-dom';
import zhCN from 'antd/locale/zh_CN';
import { getTranscriptions } from './api/transcription';
import HistoryPage from './pages/HistoryPage';
import TranscriptionDetailPage from './pages/TranscriptionDetailPage';
import MergePage from './pages/MergePage';
import ProtectedRoute from './components/ProtectedRoute';
import ApiConfigModal from './components/ApiConfigModal';
import UploadModal from './components/UploadModal';
import { useSidebar, SidebarProvider } from './contexts/SidebarContext';
import styles from './App.module.css';

const { Header, Content } = Layout;

function AppContent() {
  const navigate = useNavigate();
  const location = useLocation();
  const [configModalOpen, setConfigModalOpen] = useState(false);
  const [uploadModalOpen, setUploadModalOpen] = useState(false);
  const [backupLoading, setBackupLoading] = useState(false);
  const { sidebarCollapsed, setSidebarCollapsed } = useSidebar();

  const isHistoryActive = () => {
    return location.pathname === '/history';
  };

  const handleLogoClick = async () => {
    try {
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
        navigate('/history');
      }
    } catch (error: any) {
      console.error('获取最新记录失败:', error);
      navigate('/history');
    }
  };

  const handleBackup = async () => {
    try {
      setBackupLoading(true);
      message.loading({ content: '正在生成备份...', key: 'backup', duration: 0 });

      const response = await apiClient.get('/backup/export', {
        responseType: 'blob',
        timeout: 600000, 
      });

      const dateStr = new Date().toISOString().slice(0, 10);
      const fileName = `AI-Process-Backup-${dateStr}.zip`;

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

  return (
    <Layout style={{ height: '100%', width: '100%' }}>
      <Header style={{ display: 'flex', alignItems: 'center', background: '#fafafa', padding: '0 16px', borderBottom: '1px solid #f0f0f0' }}>
        {location.pathname.startsWith('/transcription') && (
          <Button
            type="text"
            icon={sidebarCollapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
            onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
            style={{ color: '#666', marginRight: 4 }}
            title={sidebarCollapsed ? '展开侧边栏' : '折叠侧边栏'}
          />
        )}
        <Space size={0} className={styles.desktopNav}>
          <Tooltip title="Notes 工作台">
            <Button
              type="text"
              icon={<FileTextOutlined />}
              onClick={handleLogoClick}
              className={`${styles.navBtn} ${location.pathname.startsWith('/transcription') ? styles.active : ''}`}
            />
          </Tooltip>
        </Space>
        
        <div style={{ flex: 1 }} />
        
        <Space size={0} className={styles.desktopActions}>
          <Tooltip title="所有的 Notes 历史记录">
            <Button
              type="text"
              icon={<HistoryOutlined />}
              onClick={() => navigate('/history')}
              className={`${styles.navBtn} ${isHistoryActive() ? styles.active : ''}`}
            />
          </Tooltip>
          <div className={styles.navDivider} />
          <Tooltip title="上传音频进行多轨大模型转录 (核心功能)">
            <Button type="text" icon={<CloudUploadOutlined />} onClick={() => setUploadModalOpen(true)} className={styles.actionBtn} />
          </Tooltip>
          <Tooltip title="多文档 / 网页文章智能提炼合并 (核心功能)">
            <Button type="text" icon={<MergeCellsOutlined />} onClick={() => navigate('/merge')} className={styles.actionBtn} />
          </Tooltip>
          <Tooltip title="完整数据备份导出">
            <Button type="text" icon={<DownloadOutlined />} onClick={handleBackup} loading={backupLoading} className={styles.actionBtn} />
          </Tooltip>
          <Tooltip title="API设置管理">
            <Button type="text" icon={<SettingOutlined />} onClick={() => setConfigModalOpen(true)} className={styles.actionBtn} />
          </Tooltip>
        </Space>
      </Header>
      
      <Content style={{ background: '#ffffff', height: '100%', flex: 1, overflow: 'hidden', padding: 0 }}>
        <Routes>
          <Route
            path="/"
            element={
              <ProtectedRoute>
                <Navigate to="/history" replace />
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
            path="/merge"
            element={
              <ProtectedRoute>
                <MergePage />
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
