import { MemoryRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { ConfigProvider, Layout } from 'antd';
import { useNavigate } from 'react-router-dom';
import zhCN from 'antd/locale/zh_CN';
import { getTranscriptions } from './api/transcription';
import TranscriptionDetailPage from './pages/TranscriptionDetailPage';
import MergePage from './pages/MergePage';
import RealtimeRecordPage from './pages/RealtimeRecordPage';
import ProtectedRoute from './components/ProtectedRoute';
import { SidebarProvider } from './contexts/SidebarContext';
import styles from './App.module.css';

const { Content } = Layout;

function AppContent() {
  const navigate = useNavigate();

  return (
    <Layout style={{ height: '100%', width: '100%' }}>
      <Content style={{ background: '#ffffff', height: '100%', flex: 1, overflow: 'hidden', padding: 0 }}>
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
                <MergePage />
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
          <Route path="*" element={<Navigate to="/transcription" replace />} />
        </Routes>
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
