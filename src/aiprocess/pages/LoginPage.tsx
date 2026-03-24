import React, { useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Card, Button, message, Divider } from 'antd';
import { GoogleOutlined, CodeOutlined } from '@ant-design/icons';
import styles from './LoginPage.module.css';

const LoginPage: React.FC = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [loading, setLoading] = React.useState(false);

  useEffect(() => {
    // 检查 URL 参数中是否有 token（OAuth 回调）
    const token = searchParams.get('token');
    const error = searchParams.get('error');

    if (error) {
      message.error(`登录失败: ${decodeURIComponent(error)}`);
      return;
    }

    if (token) {
      // 保存 token 到 localStorage
      localStorage.setItem('auth_token', token);
      
      // 获取用户信息 - 使用相对路径支持生产环境
      const apiBase = import.meta.env.VITE_API_BASE_URL || 
        (window.location.hostname === 'localhost' 
          ? `http://localhost:${import.meta.env.VITE_DEV_PORT || '8080'}/api` 
          : '/api');
      fetch(`${apiBase}/auth/me`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      })
        .then((res) => res.json())
        .then((data) => {
          if (data.success) {
            localStorage.setItem('user', JSON.stringify(data.data));
            localStorage.setItem('token', token); // 同时保存为 token
            message.success('登录成功！');
            // 检查是否有返回 URL
            const returnUrl = searchParams.get('returnUrl');
            navigate(returnUrl || '/history');
          } else {
            message.error('获取用户信息失败');
          }
        })
        .catch((err) => {
          console.error('获取用户信息错误:', err);
          message.error('获取用户信息失败');
        });
    }

    // 检查是否已登录
    const existingToken = localStorage.getItem('auth_token');
    if (existingToken) {
      navigate('/history');
    }
  }, [searchParams, navigate]);

  const getApiBase = () =>
    import.meta.env.VITE_API_BASE_URL ||
    (window.location.hostname === 'localhost'
      ? `http://localhost:${import.meta.env.VITE_DEV_PORT || '8080'}/api`
      : '/api');

  const handleGoogleLogin = () => {
    setLoading(true);
    window.location.href = `${getApiBase()}/auth/google`;
  };

  const handleDevLogin = async () => {
    setLoading(true);
    // Dev login 强制使用本地后端（线上是 production 不会有此端点）
    const devApiBase = `http://localhost:${import.meta.env.VITE_DEV_PORT || '3001'}/api`;
    try {
      const res = await fetch(`${devApiBase}/auth/dev-login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'dev@localhost.com', name: 'Dev User' }),
      });
      const data = await res.json();
      if (data.success) {
        localStorage.setItem('auth_token', data.token);
        localStorage.setItem('token', data.token);
        localStorage.setItem('user', JSON.stringify(data.user));
        message.success('开发登录成功！');
        navigate('/history');
      } else {
        message.error('开发登录失败');
      }
    } catch (err) {
      console.error('Dev login error:', err);
      message.error('开发登录失败，请确保后端已启动');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className={styles.loginPage}>
      <Card className={styles.loginCard}>
        <div className={styles.loginContent}>
          <h1 className={styles.loginTitle}>AI Notebook</h1>
          <p className={styles.loginDesigner}>Designed By JQ</p>
          <Button
            type="primary"
            size="large"
            icon={<GoogleOutlined />}
            onClick={handleGoogleLogin}
            loading={loading}
            className={styles.loginButton}
          >
            使用 Google 账号登录
          </Button>
          {import.meta.env.DEV && (
            <>
              <Divider plain style={{ color: '#999', fontSize: 12 }}>开发模式</Divider>
              <Button
                size="large"
                icon={<CodeOutlined />}
                onClick={handleDevLogin}
                loading={loading}
                className={styles.loginButton}
                style={{ background: '#f0f0f0' }}
              >
                开发者快速登录
              </Button>
            </>
          )}
          <p className={styles.loginHint}>
            登录后即可开始使用 AI 转录功能
          </p>
        </div>
      </Card>
    </div>
  );
};

export default LoginPage;
