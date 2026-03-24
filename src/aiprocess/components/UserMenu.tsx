import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Dropdown, Avatar, Button } from 'antd';
import type { MenuProps } from 'antd';
import { LogoutOutlined, UserOutlined } from '@ant-design/icons';
import { logout } from '../api/auth';

const UserMenu: React.FC = () => {
  const navigate = useNavigate();
  const [user, setUser] = useState<any>(null);

  useEffect(() => {
    const userStr = localStorage.getItem('user');
    if (userStr) {
      try {
        setUser(JSON.parse(userStr));
      } catch (e) {
        console.error('Failed to parse user data:', e);
      }
    }
  }, []);

  const handleLogout = async () => {
    try {
      await logout();
    } catch (error) {
      console.error('Logout error:', error);
    } finally {
      localStorage.removeItem('auth_token');
      localStorage.removeItem('user');
      navigate('/login');
    }
  };

  const items: MenuProps['items'] = [
    {
      key: 'user',
      label: (
        <div style={{ padding: '4px 0' }}>
          <div style={{ fontWeight: 500 }}>{user?.name || '用户'}</div>
          <div style={{ fontSize: 12, color: '#999' }}>{user?.email}</div>
        </div>
      ),
      disabled: true,
    },
    {
      type: 'divider',
    },
    {
      key: 'logout',
      label: '登出',
      icon: <LogoutOutlined />,
      onClick: handleLogout,
    },
  ];

  if (!user) {
    return null;
  }

  return (
    <Dropdown menu={{ items }} placement="bottomRight">
      <Button
        type="text"
        style={{
          color: 'rgba(255, 255, 255, 0.65)',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
        }}
      >
        <Avatar
          size="small"
          src={user.picture}
          icon={<UserOutlined />}
          style={{ backgroundColor: '#1890ff' }}
        />
        <span style={{ fontSize: 14 }}>{user.name}</span>
      </Button>
    </Dropdown>
  );
};

export default UserMenu;


