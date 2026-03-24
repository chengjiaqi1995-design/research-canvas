import React, { useState } from 'react';
import { Modal, Button, Space, message, Input, Switch, Radio, Tag, Table, Popconfirm } from 'antd';
import { ShareAltOutlined, UserOutlined, EyeOutlined, DeleteOutlined, ArrowLeftOutlined } from '@ant-design/icons';
import { createShare, getMyShares, deleteShare } from '../api/share';
import AccessLogModal from './AccessLogModal';

interface ShareModalProps {
  open: boolean;
  onClose: () => void;
}

const ShareModal: React.FC<ShareModalProps> = ({ open, onClose }) => {
  const [loading, setLoading] = useState(false);
  // 默认分享全部模块
  const selectedModules = {
    notes: true,
    history: true,
    directory: true,
  };
  const [requireAuth, setRequireAuth] = useState(false);
  const [isPublic, setIsPublic] = useState(true);
  const [allowedUsers, setAllowedUsers] = useState<string[]>([]);
  const [newUserEmail, setNewUserEmail] = useState('');
  const [maxAccessUsers, setMaxAccessUsers] = useState<number | undefined>(undefined);
  const [accessLogModalOpen, setAccessLogModalOpen] = useState(false);
  const [currentShareToken, setCurrentShareToken] = useState<string | null>(null);
  const [generatedShareUrl, setGeneratedShareUrl] = useState<string | null>(null);
  const [showResult, setShowResult] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [shareHistory, setShareHistory] = useState<any[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  // 加载分享历史
  const loadShareHistory = async () => {
    setHistoryLoading(true);
    try {
      const response = await getMyShares();
      if (response.data?.success && response.data?.data) {
        setShareHistory(response.data.data);
      }
    } catch (error: any) {
      console.error('加载分享历史失败:', error);
      message.error('加载分享历史失败');
    } finally {
      setHistoryLoading(false);
    }
  };

  // 删除分享
  const handleDeleteShare = async (id: string) => {
    try {
      const response = await deleteShare(id);
      if (response.data?.success) {
        message.success('删除成功');
        loadShareHistory();
      }
    } catch (error: any) {
      message.error('删除失败');
    }
  };

  // 重置状态
  React.useEffect(() => {
    if (open) {
      setShowResult(false);
      setGeneratedShareUrl(null);
    }
  }, [open]);

  // 关闭时重置状态
  const handleClose = () => {
    setShowResult(false);
    setShowHistory(false);
    setGeneratedShareUrl(null);
    setCurrentShareToken(null);
    onClose();
  };

  // 显示分享历史
  const handleShowHistory = () => {
    setShowHistory(true);
    loadShareHistory();
  };

  const handleShare = async () => {
    setLoading(true);
    try {
      // 生成分享配置（JSON格式）
      const shareConfig = {
        modules: {
          notes: selectedModules.notes,
          history: selectedModules.history,
          directory: selectedModules.directory,
        },
        type: 'dynamic', // 标记为动态分享
      };

      const title = `分享 - ${new Date().toLocaleDateString('zh-CN')}`;
      const content = JSON.stringify(shareConfig);

      message.loading({ content: '正在创建分享链接...', key: 'share' });
      
      const response = await createShare(
        title, 
        content, 
        undefined, // expiresIn
        requireAuth,
        isPublic,
        isPublic ? undefined : allowedUsers,
        requireAuth ? maxAccessUsers : undefined
      );
      
      if (response.data?.success && response.data.data?.shareUrl) {
        const shareUrl = response.data.data.shareUrl;
        const shareToken = response.data.data.shareToken;
        
        await navigator.clipboard.writeText(shareUrl);
        
        message.success({ 
          content: '分享链接已复制到剪贴板！', 
          key: 'share',
          duration: 3,
        });
        
        // 在同一弹窗内显示结果
        setGeneratedShareUrl(shareUrl);
        setCurrentShareToken(shareToken);
        setShowResult(true);
      } else {
        throw new Error(response.data?.error || '创建分享链接失败');
      }
    } catch (error: any) {
      console.error('创建分享链接失败:', error);
      message.error({ 
        content: '创建分享链接失败：' + (error.response?.data?.message || error.message || '未知错误'),
        key: 'share',
      });
    } finally {
      setLoading(false);
    }
  };

  // 获取当前视图的标题
  const getTitle = () => {
    if (showHistory) return '分享历史';
    if (showResult) return '分享链接';
    return '分享全部内容';
  };

  // 获取当前视图的 footer
  const getFooter = () => {
    if (showHistory) {
      return [
        <Button key="back" icon={<ArrowLeftOutlined />} onClick={() => setShowHistory(false)}>
          返回
        </Button>,
        <Button key="close" onClick={handleClose}>
          关闭
        </Button>,
      ];
    }
    if (showResult) {
      return [
        <Button key="close" type="primary" onClick={handleClose}>
          完成
        </Button>,
      ];
    }
    return [
      <Button 
        key="log" 
        icon={<EyeOutlined />}
        onClick={handleShowHistory}
        style={{ marginRight: 'auto' }}
      >
        分享历史
      </Button>,
      <Button key="cancel" onClick={handleClose}>
        取消
      </Button>,
      <Button
        key="share"
        type="primary"
        icon={<ShareAltOutlined />}
        onClick={handleShare}
        loading={loading}
      >
        生成分享链接
      </Button>,
    ];
  };

  return (
    <Modal
      title={
        <Space>
          <ShareAltOutlined />
          <span>{getTitle()}</span>
        </Space>
      }
      open={open}
      onCancel={handleClose}
      footer={getFooter()}
      width={showHistory ? 800 : 600}
    >
      {showHistory ? (
        <div style={{ padding: '20px 0' }}>
          <Table
            dataSource={shareHistory}
            rowKey="id"
            loading={historyLoading}
            size="small"
            pagination={{ pageSize: 10 }}
            columns={[
              {
                title: '分享内容',
                dataIndex: 'title',
                key: 'title',
                width: 200,
                ellipsis: true,
              },
              {
                title: '创建时间',
                dataIndex: 'createdAt',
                key: 'createdAt',
                width: 150,
                render: (date: string) => new Date(date).toLocaleString('zh-CN'),
              },
              {
                title: '访问设置',
                key: 'settings',
                width: 120,
                render: (_: any, record: any) => (
                  <Space>
                    {record.requireAuth && <Tag color="blue">需登录</Tag>}
                    {!record.isPublic && <Tag color="orange">限制访问</Tag>}
                  </Space>
                ),
              },
              {
                title: '操作',
                key: 'action',
                width: 150,
                render: (_: any, record: any) => (
                  <Space>
                    <Button
                      type="link"
                      size="small"
                      icon={<EyeOutlined />}
                      onClick={() => {
                        setCurrentShareToken(record.shareToken);
                        setAccessLogModalOpen(true);
                      }}
                    >
                      日志
                    </Button>
                    <Popconfirm
                      title="确定删除此分享？"
                      onConfirm={() => handleDeleteShare(record.id)}
                    >
                      <Button type="link" size="small" danger icon={<DeleteOutlined />}>
                        删除
                      </Button>
                    </Popconfirm>
                  </Space>
                ),
              },
            ]}
          />
        </div>
      ) : showResult ? (
        <div style={{ padding: '20px 0' }}>
          <p style={{ marginBottom: 12, color: '#52c41a', fontWeight: 500 }}>✓ 分享链接已生成并复制到剪贴板！</p>
          <p style={{ fontSize: 12, color: '#666', marginBottom: 12 }}>
            此链接为动态链接，访问时会实时显示最新内容
          </p>
          <Input.TextArea
            value={generatedShareUrl || ''}
            readOnly
            autoSize={{ minRows: 2, maxRows: 4 }}
          />
        </div>
      ) : (
      <div style={{ padding: '20px 0', maxHeight: '70vh', overflowY: 'auto' }}>
        {/* 分享说明 */}
        <div style={{ marginBottom: 24, padding: 16, background: '#f6ffed', border: '1px solid #b7eb8f', borderRadius: 8 }}>
          <div style={{ fontWeight: 500, fontSize: 15, marginBottom: 8 }}>
            分享全部内容
          </div>
          <div style={{ fontSize: 13, color: '#666' }}>
            分享后，访问者将看到与你相同的界面（包括 Notes、History、Directory），但不能编辑或删除内容。
          </div>
        </div>

        {/* 访问控制设置 */}
        <div style={{ marginBottom: 24 }}>
          <p style={{ marginBottom: 16, color: '#666', fontWeight: 500 }}>
            <UserOutlined style={{ marginRight: 8 }} />
            访问控制设置
          </p>
          
          <div style={{ marginBottom: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <div>
                <div style={{ fontWeight: 500 }}>要求 Google 登录</div>
                <div style={{ fontSize: 12, color: '#999', marginTop: 4 }}>
                  开启后，访问者需要通过 Google 账号登录才能查看
                </div>
              </div>
              <Switch checked={requireAuth} onChange={setRequireAuth} />
            </div>
          </div>

          <div style={{ marginBottom: 16 }}>
            <div style={{ marginBottom: 12, fontWeight: 500 }}>访问权限：</div>
            <Radio.Group value={isPublic ? 'public' : 'restricted'} onChange={(e) => setIsPublic(e.target.value === 'public')}>
              <Space direction="vertical">
                <Radio value="public">公开访问（所有人可访问）</Radio>
                <Radio value="restricted">限制访问（仅指定用户可访问）</Radio>
              </Space>
            </Radio.Group>
          </div>

          {requireAuth && (
            <div style={{ marginBottom: 16 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <div style={{ fontWeight: 500 }}>最大访问账号数</div>
                  <div style={{ fontSize: 12, color: '#999', marginTop: 4 }}>
                    限制可访问的不同 Google 账号数量，留空表示不限制
                  </div>
                </div>
                <Input
                  type="number"
                  min={1}
                  placeholder="不限制"
                  value={maxAccessUsers}
                  onChange={(e) => setMaxAccessUsers(e.target.value ? parseInt(e.target.value) : undefined)}
                  style={{ width: 100 }}
                />
              </div>
            </div>
          )}

          {!isPublic && (
            <div style={{ marginTop: 16, padding: 12, background: '#f5f5f5', borderRadius: 4 }}>
              <div style={{ marginBottom: 8, fontWeight: 500 }}>允许访问的用户：</div>
              <div style={{ marginBottom: 8 }}>
                {allowedUsers.length > 0 ? (
                  <Space wrap>
                    {allowedUsers.map((email, index) => (
                      <Tag
                        key={index}
                        closable
                        onClose={() => setAllowedUsers(allowedUsers.filter((_, i) => i !== index))}
                      >
                        {email}
                      </Tag>
                    ))}
                  </Space>
                ) : (
                  <div style={{ color: '#999', fontSize: 12 }}>暂无用户，请添加允许访问的用户邮箱</div>
                )}
              </div>
              <Space.Compact style={{ width: '100%' }}>
                <Input
                  placeholder="输入用户邮箱"
                  value={newUserEmail}
                  onChange={(e) => setNewUserEmail(e.target.value)}
                  onPressEnter={() => {
                    if (newUserEmail.trim() && !allowedUsers.includes(newUserEmail.trim())) {
                      setAllowedUsers([...allowedUsers, newUserEmail.trim()]);
                      setNewUserEmail('');
                    }
                  }}
                />
                <Button
                  type="primary"
                  onClick={() => {
                    if (newUserEmail.trim() && !allowedUsers.includes(newUserEmail.trim())) {
                      setAllowedUsers([...allowedUsers, newUserEmail.trim()]);
                      setNewUserEmail('');
                    }
                  }}
                  disabled={!newUserEmail.trim() || allowedUsers.includes(newUserEmail.trim())}
                >
                  添加
                </Button>
              </Space.Compact>
            </div>
          )}
        </div>
      </div>
      )}
      
      {/* 访问日志弹窗 */}
      {currentShareToken && (
        <AccessLogModal
          open={accessLogModalOpen}
          onClose={() => {
            setAccessLogModalOpen(false);
          }}
          shareToken={currentShareToken}
        />
      )}
    </Modal>
  );
};

export default ShareModal;
