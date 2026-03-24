import React, { useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Spin, message } from 'antd';
import { getCurrentUser } from '../api/auth';
import styles from './AuthCallbackPage.module.css';

const AuthCallbackPage: React.FC = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  useEffect(() => {
    const token = searchParams.get('token');
    const error = searchParams.get('error');

    if (error) {
      message.error(`登录失败: ${decodeURIComponent(error)}`);
      navigate('/login');
      return;
    }

    if (token) {
      // 保存 token
      localStorage.setItem('auth_token', token);

      // 获取用户信息
      getCurrentUser()
        .then((response) => {
          if (response.success && response.data) {
            localStorage.setItem('user', JSON.stringify(response.data));
            message.success('登录成功！');
            navigate('/history');
          } else {
            message.error('获取用户信息失败');
            navigate('/login');
          }
        })
        .catch((err) => {
          console.error('获取用户信息错误:', err);
          message.error('获取用户信息失败');
          navigate('/login');
        });
    } else {
      navigate('/login');
    }
  }, [searchParams, navigate]);

  return (
    <div className={styles.authCallbackPage}>
      <Spin size="large" tip="正在登录..." />
    </div>
  );
};

export default AuthCallbackPage;


