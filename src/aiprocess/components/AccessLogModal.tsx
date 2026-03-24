import React, { useEffect, useState } from 'react';
import { Modal, Table, Tag, Space, Button, message, Input, Select, Typography, Statistic, Row, Col } from 'antd';
import { EyeOutlined, UserOutlined, ClockCircleOutlined, DeleteOutlined } from '@ant-design/icons';
import { getAccessLogs, revokeAccess } from '../api/share';
import type { ColumnsType } from 'antd/es/table';

const { Text } = Typography;
const { Search } = Input;

interface AccessLog {
  id: string;
  userId: string | null;
  userEmail: string | null;
  userName: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  accessedAt: string;
  accessCount: number;
}

interface AccessLogModalProps {
  open: boolean;
  onClose: () => void;
  shareToken: string;
}

const AccessLogModal: React.FC<AccessLogModalProps> = ({ open, onClose, shareToken }) => {
  const [loading, setLoading] = useState(false);
  const [logs, setLogs] = useState<AccessLog[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [uniqueVisitors, setUniqueVisitors] = useState(0);
  const [searchUserId, setSearchUserId] = useState<string | undefined>();

  useEffect(() => {
    if (open && shareToken) {
      loadAccessLogs();
    }
  }, [open, shareToken, page, pageSize, searchUserId]);

  const loadAccessLogs = async () => {
    setLoading(true);
    try {
      const response = await getAccessLogs(shareToken, page, pageSize, searchUserId);
      
      if (response.data?.success && response.data?.data) {
        setLogs(response.data.data.items);
        setTotal(response.data.data.total);
        setUniqueVisitors(response.data.data.uniqueVisitors || 0);
      } else {
        message.error(response.data?.error || '加载访问日志失败');
      }
    } catch (error: any) {
      console.error('加载访问日志失败:', error);
      message.error('加载访问日志失败：' + (error.response?.data?.message || error.message));
    } finally {
      setLoading(false);
    }
  };

  const handleRevokeAccess = async (userId: string, userEmail: string | null) => {
    if (!userId) {
      message.warning('无法撤销未登录用户的访问权限');
      return;
    }

    try {
      const response = await revokeAccess(shareToken, userId);
      
      if (response.data?.success) {
        message.success('访问权限已撤销');
        loadAccessLogs(); // 重新加载日志
      } else {
        message.error(response.data?.error || '撤销访问权限失败');
      }
    } catch (error: any) {
      console.error('撤销访问权限失败:', error);
      message.error('撤销访问权限失败：' + (error.response?.data?.message || error.message));
    }
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleString('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  };

  const getBrowserInfo = (userAgent: string | null) => {
    if (!userAgent) return '未知';
    
    if (userAgent.includes('Chrome')) return 'Chrome';
    if (userAgent.includes('Firefox')) return 'Firefox';
    if (userAgent.includes('Safari') && !userAgent.includes('Chrome')) return 'Safari';
    if (userAgent.includes('Edge')) return 'Edge';
    if (userAgent.includes('Opera')) return 'Opera';
    return '其他';
  };

  const columns: ColumnsType<AccessLog> = [
    {
      title: '访问者',
      key: 'visitor',
      width: 200,
      render: (_, record) => {
        if (record.userId) {
          return (
            <Space>
              <UserOutlined />
              <div>
                <div style={{ fontWeight: 500 }}>
                  {record.userName || record.userEmail || '未知用户'}
                </div>
                {record.userEmail && record.userEmail !== record.userName && (
                  <div style={{ fontSize: 12, color: '#999' }}>{record.userEmail}</div>
                )}
              </div>
            </Space>
          );
        } else {
          return (
            <Space>
              <UserOutlined style={{ color: '#999' }} />
              <Text type="secondary">未登录用户</Text>
            </Space>
          );
        }
      },
    },
    {
      title: '访问时间',
      dataIndex: 'accessedAt',
      key: 'accessedAt',
      width: 180,
      render: (date: string) => (
        <Space>
          <ClockCircleOutlined />
          <Text>{formatDate(date)}</Text>
        </Space>
      ),
      sorter: (a, b) => new Date(a.accessedAt).getTime() - new Date(b.accessedAt).getTime(),
      defaultSortOrder: 'descend',
    },
    {
      title: '访问次数',
      dataIndex: 'accessCount',
      key: 'accessCount',
      width: 100,
      render: (count: number) => (
        <Tag color="blue">{count} 次</Tag>
      ),
    },
    {
      title: '浏览器',
      dataIndex: 'userAgent',
      key: 'browser',
      width: 120,
      render: (userAgent: string | null) => (
        <Text type="secondary">{getBrowserInfo(userAgent)}</Text>
      ),
    },
    {
      title: 'IP地址',
      dataIndex: 'ipAddress',
      key: 'ipAddress',
      width: 150,
      render: (ip: string | null) => (
        <Text code style={{ fontSize: 12 }}>{ip || '未知'}</Text>
      ),
    },
    {
      title: '操作',
      key: 'action',
      width: 100,
      render: (_, record) => {
        if (!record.userId) {
          return <Text type="secondary">-</Text>;
        }
        return (
          <Button
            type="link"
            danger
            size="small"
            icon={<DeleteOutlined />}
            onClick={() => {
              Modal.confirm({
                title: '确认撤销访问权限',
                content: `确定要撤销 ${record.userEmail || record.userName || '该用户'} 的访问权限吗？`,
                onOk: () => handleRevokeAccess(record.userId!, record.userEmail),
              });
            }}
          >
            撤销权限
          </Button>
        );
      },
    },
  ];

  return (
    <Modal
      title={
        <Space>
          <EyeOutlined />
          <span>访问日志</span>
        </Space>
      }
      open={open}
      onCancel={onClose}
      footer={[
        <Button key="close" onClick={onClose}>
          关闭
        </Button>,
      ]}
      width={1000}
    >
      {/* 统计信息 */}
      <Row gutter={16} style={{ marginBottom: 24 }}>
        <Col span={8}>
          <Statistic
            title="总访问次数"
            value={total}
            prefix={<EyeOutlined />}
          />
        </Col>
        <Col span={8}>
          <Statistic
            title="独立访问者"
            value={uniqueVisitors}
            prefix={<UserOutlined />}
          />
        </Col>
        <Col span={8}>
          <Statistic
            title="当前页记录数"
            value={logs.length}
          />
        </Col>
      </Row>

      {/* 搜索筛选 */}
      <div style={{ marginBottom: 16 }}>
        <Space>
          <Text>筛选：</Text>
          <Search
            placeholder="搜索用户邮箱"
            allowClear
            style={{ width: 300 }}
            onSearch={(value) => {
              setSearchUserId(value || undefined);
              setPage(1);
            }}
          />
        </Space>
      </div>

      {/* 访问日志表格 */}
      <Table
        columns={columns}
        dataSource={logs}
        rowKey="id"
        loading={loading}
        pagination={{
          current: page,
          pageSize: pageSize,
          total: total,
          showSizeChanger: true,
          showTotal: (total) => `共 ${total} 条记录`,
          onChange: (newPage, newPageSize) => {
            setPage(newPage);
            setPageSize(newPageSize);
          },
        }}
        size="small"
      />
    </Modal>
  );
};

export default AccessLogModal;
