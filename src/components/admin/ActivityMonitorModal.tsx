import React, { useEffect, useState } from 'react';
import { Modal, Tabs, Table, Badge, Avatar, Spin, Tag, message } from 'antd';
import { User, Activity, Clock, Users, ShieldAlert } from 'lucide-react';
import { adminApi, shareMonitorApi } from '../../db/apiClient';
import dayjs from 'dayjs';

interface ActivityMonitorModalProps {
  open: boolean;
  onClose: () => void;
}

export const ActivityMonitorModal: React.FC<ActivityMonitorModalProps> = ({ open, onClose }) => {
  const [activeTab, setActiveTab] = useState('users');
  
  // Data States
  const [users, setUsers] = useState<any[]>([]);
  const [usersLoading, setUsersLoading] = useState(false);
  
  const [shares, setShares] = useState<any[]>([]);
  const [sharesLoading, setSharesLoading] = useState(false);
  
  // Fetch Data Handlers
  const fetchUsers = async () => {
    setUsersLoading(true);
    try {
      const res = await adminApi.getAllUsers();
      if (res.success && res.data?.users) {
        setUsers(res.data.users);
      }
    } catch (e: any) {
      message.error(e.message || '获取用户列表失败');
    } finally {
      setUsersLoading(false);
    }
  };

  const fetchShares = async () => {
    setSharesLoading(true);
    try {
      const res = await shareMonitorApi.getMyShares();
      if (res.success && res.data) {
        setShares(res.data);
      }
    } catch (e: any) {
      message.error(e.message || '获取分享记录失败');
    } finally {
      setSharesLoading(false);
    }
  };

  // Lifecycle
  useEffect(() => {
    if (open) {
      if (activeTab === 'users') {
        fetchUsers();
      } else if (activeTab === 'shares') {
        fetchShares();
      }
    }
  }, [open, activeTab]);

  // Expandable row for Share logs
  const ShareAccessTable = ({ shareToken }: { shareToken: string }) => {
    const [logs, setLogs] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
      shareMonitorApi.getAccessLogs(shareToken).then(res => {
        if (res.success && res.data) {
          setLogs(res.data.items || []);
        }
      }).catch(() => {
        // quiet fail inside nested table
      }).finally(() => {
        setLoading(false);
      });
    }, [shareToken]);

    if(loading) return <Spin className="my-4 mx-4" />;

    if(logs.length === 0) return <div className="text-slate-400 text-xs py-4 px-6">尚无访问记录</div>;

    return (
      <Table 
        size="small" 
        dataSource={logs} 
        rowKey="id" 
        pagination={false}
        columns={[
          { title: '访问者', dataIndex: 'userName', key: 'userName', render: (val, record) => val || record.userEmail || <span className="text-slate-400">游客 / 未登录</span> },
          { title: '最新访问时间', dataIndex: 'accessedAt', key: 'accessedAt', width: 150, render: val => dayjs(val).format('YYYY-MM-DD HH:mm') },
          { title: '总访问次数', dataIndex: 'accessCount', key: 'accessCount', width: 100 },
          { title: 'IP/环境', dataIndex: 'ipAddress', key: 'ipAddress', render: (_, record) => <span className="text-[10px] text-slate-400">{record.ipAddress || '未知 IP'}</span> },
        ]} 
      />
    );
  };

  return (
    <Modal
      title={
        <div className="flex items-center gap-2">
          <Activity size={18} className="text-blue-500" />
          <span>活动监控盘</span>
        </div>
      }
      open={open}
      onCancel={onClose}
      footer={null}
      width={800}
      destroyOnClose
    >
      <Tabs activeKey={activeTab} onChange={setActiveTab} items={[
        {
          key: 'users',
          label: <span className="flex items-center gap-1.5"><User size={14} /> 系统账号追踪</span>,
          children: (
            <Table
              loading={usersLoading}
              dataSource={users}
              rowKey="id"
              size="small"
              pagination={{ pageSize: 12 }}
              columns={[
                {
                  title: '账号',
                  key: 'account',
                  render: (_, record) => (
                    <div className="flex items-center gap-3">
                      <Avatar src={record.picture} size="small">{record.name?.charAt(0)}</Avatar>
                      <div>
                        <div className="font-medium text-slate-700 text-xs">{record.name}</div>
                        <div className="text-[10px] text-slate-400">{record.email}</div>
                      </div>
                    </div>
                  )
                },
                {
                  title: '最近登录/活跃',
                  dataIndex: 'updatedAt',
                  key: 'updatedAt',
                  render: val => (
                    <div className="flex items-center gap-1.5 text-xs text-slate-600">
                      <Clock size={12} className="text-slate-400" />
                      {dayjs(val).format('YYYY-MM-DD HH:mm')}
                    </div>
                  )
                },
                {
                  title: '注册时间',
                  dataIndex: 'createdAt',
                  key: 'createdAt',
                  render: val => <span className="text-xs text-slate-500">{dayjs(val).format('YYYY-MM-DD')}</span>
                }
              ]}
            />
          )
        },
        {
          key: 'shares',
          label: <span className="flex items-center gap-1.5"><Users size={14} /> 分享追踪统计</span>,
          children: (
            <div className="bg-slate-50/50 -mx-6 px-6 pb-6 pt-2">
              <div className="mb-4 flex items-center justify-between">
                <p className="text-xs text-slate-500">点击行展开查看具体的访客记录（只展示您创建的分享连接）</p>
              </div>
              <Table
                loading={sharesLoading}
                dataSource={shares}
                rowKey="id"
                size="small"
                pagination={{ pageSize: 8 }}
                expandable={{
                  expandedRowRender: record => <ShareAccessTable shareToken={record.shareToken} />,
                  rowExpandable: record => record.viewCount > 0,
                }}
                columns={[
                  {
                    title: '归属笔记/分享标题',
                    dataIndex: 'title',
                    key: 'title',
                    render: (val, record) => (
                      <div>
                        <div className="font-medium text-slate-700 text-xs mb-0.5">{val}</div>
                        <a href={record.shareUrl} target="_blank" rel="noreferrer" className="text-[10px] text-blue-500 hover:underline">
                          🔗 复制有效链接
                        </a>
                      </div>
                    )
                  },
                  {
                    title: '有效时限',
                    dataIndex: 'expiresAt',
                    key: 'expiresAt',
                    render: val => {
                      if (!val) return <Tag color="green">永久有效</Tag>;
                      const isExpired = dayjs().isAfter(dayjs(val));
                      return isExpired ? (
                        <Tag color="red" icon={<ShieldAlert size={10} className="mr-1 inline" />}>已于 {dayjs(val).format('MM-DD HH:mm')} 过期</Tag>
                      ) : (
                        <Tag color="orange" icon={<Clock size={10} className="mr-1 inline" />}>{dayjs(val).format('YYYY-MM-DD HH:mm')}</Tag>
                      );
                    }
                  },
                  {
                    title: '总浏览数',
                    dataIndex: 'viewCount',
                    key: 'viewCount',
                    render: val => (
                      <Badge count={val} showZero color={val > 0 ? '#10b981' : '#cbd5e1'} />
                    )
                  },
                  {
                    title: '分享日期',
                    dataIndex: 'createdAt',
                    key: 'createdAt',
                    render: val => <span className="text-xs text-slate-500">{dayjs(val).format('YYYY-MM-DD')}</span>
                  }
                ]}
              />
            </div>
          )
        }
      ]} />
    </Modal>
  );
};
