import { lazy, Suspense } from 'react';
import { MemoryRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { ConfigProvider, Layout } from 'antd';
import { useNavigate } from 'react-router-dom';
import zhCN from 'antd/locale/zh_CN';
import ProtectedRoute from './components/ProtectedRoute';
import { SidebarProvider } from './contexts/SidebarContext';
import RecordingIndicator from './components/RecordingIndicator';
import styles from './App.module.css';

// 懒加载页面组件 — 减少初始包体积
const TranscriptionDetailPage = lazy(() => import('./pages/TranscriptionDetailPage'));
const MergePage = lazy(() => import('./pages/MergePage'));
const RealtimeRecordPage = lazy(() => import('./pages/RealtimeRecordPage'));
const SidebarLayout = lazy(() => import('./components/SidebarLayout'));

const { Content } = Layout;

// 预热后端：JS 加载时立即发轻量请求唤醒 Cloud Run（不阻塞渲染）
(() => {
  const baseUrl = import.meta.env.VITE_API_BASE_URL || '/api';
  fetch(`${baseUrl}/health`, { method: 'GET' }).catch(() => {});
})();

function AppContent() {
  const navigate = useNavigate();

  return (
    <Layout style={{ height: '100%', width: '100%' }}>
      <Content style={{ background: '#ffffff', height: '100%', flex: 1, overflow: 'hidden', padding: 0 }}>
        <Suspense fallback={<div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#94a3b8' }}>加载中...</div>}>
        <Routes>
          <Route
            path="/"
            element={
              <ProtectedRoute>
                <Navigate to="/transcription" replace />
              </ProtectedRoute>
            }
          />
          <Route
            path="/transcription"
            element={
              <ProtectedRoute>
                <TranscriptionDetailPage />
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
            path="/merge"
            element={
              <ProtectedRoute>
                <SidebarLayout><MergePage /></SidebarLayout>
              </ProtectedRoute>
            }
          />
          <Route
            path="/realtime"
            element={
              <ProtectedRoute>
                <SidebarLayout><RealtimeRecordPage /></SidebarLayout>
              </ProtectedRoute>
            }
          />
          <Route path="*" element={<Navigate to="/transcription" replace />} />
        </Routes>
        </Suspense>
        <RecordingIndicator />
      </Content>
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
