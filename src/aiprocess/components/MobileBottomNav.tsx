import { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { Drawer } from 'antd';
import {
  FileTextOutlined,
  HistoryOutlined,
  ApartmentOutlined,
  AppstoreOutlined,
  CloudUploadOutlined,
  MergeCellsOutlined,
  AudioOutlined,
  RobotOutlined,
  BarChartOutlined,
  ShareAltOutlined,
  DownloadOutlined,
  SettingOutlined,
} from '@ant-design/icons';
import styles from './MobileBottomNav.module.css';

interface MobileBottomNavProps {
  onUpload: () => void;
  onShare: () => void;
  onBackup: () => void;
  onSettings: () => void;
  showShare: boolean;
}

export default function MobileBottomNav({ onUpload, onShare, onBackup, onSettings, showShare }: MobileBottomNavProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const [drawerOpen, setDrawerOpen] = useState(false);

  const isActive = (path: string) => {
    if (path === '/transcription') return location.pathname.startsWith('/transcription');
    return location.pathname === path;
  };

  const handleMore = (action: () => void) => {
    setDrawerOpen(false);
    action();
  };

  return (
    <>
      <nav className={styles.mobileBottomNav}>
        <button className={`${styles.mobileNavItem} ${isActive('/transcription') ? styles.active : ''}`} onClick={() => navigate('/')}>
          <FileTextOutlined className={styles.navIcon} />
          <span>Notes</span>
        </button>
        <button className={`${styles.mobileNavItem} ${isActive('/history') ? styles.active : ''}`} onClick={() => navigate('/history')}>
          <HistoryOutlined className={styles.navIcon} />
          <span>History</span>
        </button>
        <button className={`${styles.mobileNavItem} ${isActive('/organization') ? styles.active : ''}`} onClick={() => navigate('/organization')}>
          <ApartmentOutlined className={styles.navIcon} />
          <span>Directory</span>
        </button>
        <button className={`${styles.mobileNavItem} ${drawerOpen ? styles.active : ''}`} onClick={() => setDrawerOpen(true)}>
          <AppstoreOutlined className={styles.navIcon} />
          <span>More</span>
        </button>
      </nav>

      <Drawer
        title="More"
        placement="bottom"
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        height="auto"
        className={styles.mobileMoreDrawer}
        styles={{ body: { padding: 0 } }}
      >
        <ul className={styles.mobileMoreMenu}>
          <li className={styles.mobileMoreMenuItem} onClick={() => handleMore(onUpload)}>
            <CloudUploadOutlined className={styles.menuIcon} />
            <span>Upload Audio</span>
          </li>
          <li className={styles.mobileMoreMenuItem} onClick={() => handleMore(() => navigate('/merge'))}>
            <MergeCellsOutlined className={styles.menuIcon} />
            <span>Import Notes</span>
          </li>
          <li className={styles.mobileMoreMenuItem} onClick={() => handleMore(() => navigate('/realtime'))}>
            <AudioOutlined className={styles.menuIcon} />
            <span>Realtime Record</span>
          </li>
          <li className={styles.mobileMoreMenuItem} onClick={() => handleMore(() => navigate('/knowledge-base'))}>
            <RobotOutlined className={styles.menuIcon} />
            <span>Knowledge Base</span>
          </li>
          <li className={styles.mobileMoreMenuItem} onClick={() => handleMore(() => navigate('/weekly-summary'))}>
            <BarChartOutlined className={styles.menuIcon} />
            <span>Weekly Summary</span>
          </li>
          {showShare && (
            <li className={styles.mobileMoreMenuItem} onClick={() => handleMore(onShare)}>
              <ShareAltOutlined className={styles.menuIcon} />
              <span>Share</span>
            </li>
          )}
          <li className={styles.mobileMoreMenuItem} onClick={() => handleMore(onBackup)}>
            <DownloadOutlined className={styles.menuIcon} />
            <span>Backup Export</span>
          </li>
          <li className={styles.mobileMoreMenuItem} onClick={() => handleMore(onSettings)}>
            <SettingOutlined className={styles.menuIcon} />
            <span>Settings</span>
          </li>
        </ul>
      </Drawer>
    </>
  );
}
