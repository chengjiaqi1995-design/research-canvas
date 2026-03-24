import { useEffect, useState } from 'react';
import { Table, Button, Tag, Space, Popconfirm, message, Card, Select } from 'antd';
import { DeleteOutlined, FileTextOutlined, ArrowUpOutlined, ArrowDownOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import type { ColumnsType } from 'antd/es/table';
import { getTranscriptions, deleteTranscription, updateTranscriptionProject } from '../api/transcription';
import type { Transcription, Project } from '../types';
import { useReadOnly } from '../contexts/ReadOnlyContext';
import styles from './HistoryPage.module.css';

interface HistoryPageProps {
  externalData?: Transcription[];
}

const HistoryPage: React.FC<HistoryPageProps> = ({ externalData }) => {
  const navigate = useNavigate();
  const { isReadOnly } = useReadOnly();
  const [transcriptions, setTranscriptions] = useState<Transcription[]>([]);
  const [loading, setLoading] = useState(false);
  const [projects, setProjects] = useState<Project[]>([]);
  const [sortBy, setSortBy] = useState<'createdAt' | 'actualDate'>('createdAt');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');
  const [selectedProjectId, setSelectedProjectId] = useState<string | null | undefined>(undefined);
  const [selectedTag, setSelectedTag] = useState<string | null | undefined>(undefined);
  const [allTags, setAllTags] = useState<string[]>([]);
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [total, setTotal] = useState(0);

  const loadProjects = async () => {
    // Project module removed
  };

  // 获取用于排序的日期（与显示逻辑一致）
  const getEffectiveDate = (item: Transcription): Date => {
    if (item.actualDate) {
      return new Date(item.actualDate);
    }
    if (item.eventDate && item.eventDate !== '未提及') {
      // eventDate 可能是 "2025/12/20" 格式
      return new Date(item.eventDate);
    }
    return new Date(item.createdAt);
  };

  const loadTranscriptions = async (page: number = currentPage) => {
    // 如果有外部数据，不需要加载
    if (externalData) return;

    setLoading(true);
    try {
      const response = await getTranscriptions({
        page,
        pageSize,
        projectId: selectedProjectId,
        tag: selectedTag,
        sortBy,
        sortOrder,
      });
      if (response.success && response.data) {
        setTranscriptions(response.data.items);
        setTotal(response.data.total);
        setCurrentPage(page);
      }
    } catch (error: any) {
      message.error('加载失败：' + (error.message || '未知错误'));
    } finally {
      setLoading(false);
    }
  };

  // 加载所有标签列表
  const loadAllTags = async () => {
    try {
      // 获取更多记录以提取标签
      const response = await getTranscriptions({
        page: 1,
        pageSize: 200,
      });
      if (response.success && response.data) {
        const tags: string[] = [];
        response.data.items.forEach(item => {
          if (item.tags && Array.isArray(item.tags)) {
            tags.push(...item.tags);
          }
        });
        const uniqueTags = [...new Set(tags)].filter(tag => tag && tag.trim());
        setAllTags(uniqueTags);
      }
    } catch (error: any) {
      console.error('加载标签列表失败:', error);
    }
  };

  useEffect(() => {
    // 如果有外部数据，直接使用，不需要加载
    if (externalData) {
      setTranscriptions(externalData);
      setTotal(externalData.length);
      // 提取标签
      const tags: string[] = [];
      externalData.forEach(item => {
        if (item.tags && Array.isArray(item.tags)) {
          tags.push(...item.tags);
        }
      });
      setAllTags([...new Set(tags)].filter(tag => tag && tag.trim()));
      setLoading(false);
      return;
    }
    loadProjects();
    loadAllTags();
    loadTranscriptions(1);
  }, [externalData]);

  useEffect(() => {
    // 筛选条件变化时，重置到第一页
    setCurrentPage(1);
    loadTranscriptions(1);
  }, [sortBy, sortOrder, selectedProjectId, selectedTag]);

  // 自动刷新机制：每30秒刷新一次（如果页面可见）
  useEffect(() => {
    const interval = setInterval(() => {
      if (document.visibilityState === 'visible') {
        loadTranscriptions();
      }
    }, 30000); // 30秒

    return () => clearInterval(interval);
  }, [sortBy, sortOrder, selectedProjectId, selectedTag]);

  const handleDelete = async (id: string) => {
    try {
      const response = await deleteTranscription(id);
      if (response.success) {
        message.success('删除成功');
        loadTranscriptions();
      }
    } catch (error: any) {
      message.error('删除失败：' + (error.message || '未知错误'));
    }
  };

  const getStatusTag = (status: string) => {
    const statusMap: Record<string, { color: string; text: string }> = {
      pending: { color: 'default', text: '等待中' },
      processing: { color: 'processing', text: '处理中' },
      completed: { color: 'success', text: '已完成' },
      failed: { color: 'error', text: '失败' },
    };
    const config = statusMap[status] || statusMap.pending;
    return <Tag color={config.color}>{config.text}</Tag>;
  };

  const getProviderTag = (provider: string) => {
    const providerMap: Record<string, { color: string; text: string }> = {
      gemini: { color: 'blue', text: 'Gemini' },
      qwen: { color: 'orange', text: '通义千问' },
    };
    const config = providerMap[provider] || { color: 'default', text: provider };
    return <Tag color={config.color}>{config.text}</Tag>;
  };

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(2) + ' KB';
    return (bytes / 1024 / 1024).toFixed(2) + ' MB';
  };

  const formatDuration = (seconds?: number) => {
    if (!seconds) return '-';
    const minutes = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${minutes}:${secs.toString().padStart(2, '0')}`;
  };

  const handleAssignProject = async (transcriptionId: string, projectId: string | null) => {
    // Project module removed
  };

  // 获取来源类型
  const getSourceType = (item: Transcription): string => {
    const type = item.type || 'transcription';
    const filePath = item.filePath || '';

    if (type === 'merge') {
      return '深度合并';
    } else if (type === 'note') {
      if (filePath && filePath.length > 0) {
        return '插件导入';
      } else {
        return '新建笔记';
      }
    } else {
      // type === 'transcription' 或默认
      if (!filePath || filePath === '') {
        return '实时录音';
      } else {
        return '上传音频';
      }
    }
  };


  const columns: ColumnsType<Transcription> = [
    {
      title: '文件名',
      dataIndex: 'fileName',
      key: 'fileName',
      ellipsis: true,
      render: (text: string, record: Transcription) => (
        <span
          className={isReadOnly ? '' : styles.clickableFilename}
          onClick={() => !isReadOnly && navigate(`/transcription/${record.id}`, { replace: true })}
          style={isReadOnly ? { cursor: 'default' } : {}}
        >
          <FileTextOutlined style={{ marginRight: 8 }} />
          {text}
          {record.type === 'merge' && (
            <Tag color="purple" style={{ marginLeft: 8, fontSize: 10 }}>
              合并
            </Tag>
          )}
        </span>
      ),
    },
    {
      title: '标签',
      dataIndex: 'tags',
      key: 'tags',
      width: 225,
      render: (tags: string[] | undefined) => {
        if (!tags || tags.length === 0) {
          return <span style={{ color: '#999' }}>-</span>;
        }
        return (
          <Space size={[4, 4]} wrap>
            {tags.map((tag, index) => (
              <Tag key={index} style={{ margin: 0, fontSize: 11 }}>
                {tag}
              </Tag>
            ))}
          </Space>
        );
      },
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      width: 100,
      render: (status: string) => getStatusTag(status),
    },
    {
      title: '实际日期',
      dataIndex: 'actualDate',
      key: 'actualDate',
      width: 100,
      render: (date: string | null, record: Transcription) => {
        if (date) {
          return new Date(date).toLocaleDateString('zh-CN');
        }
        // 如果没有实际日期，使用 eventDate 或创建时间
        if (record.eventDate && record.eventDate !== '未提及') {
          return record.eventDate;
        }
        return new Date(record.createdAt).toLocaleDateString('zh-CN');
      },
    },
    {
      title: '创建日期',
      dataIndex: 'createdAt',
      key: 'createdAt',
      width: 100,
      render: (date: string) => new Date(date).toLocaleDateString('zh-CN'),
    },
    {
      title: '参与人',
      dataIndex: 'participants',
      key: 'participants',
      width: 100,
      render: (participants: string) => (
        <span>{participants || '-'}</span>
      ),
    },
    {
      title: '来源',
      key: 'source',
      width: 100,
      render: (_: any, record: Transcription) => (
        <span style={{ fontSize: 12, color: '#666' }}>{getSourceType(record)}</span>
      ),
    },
    // 只读模式下不显示操作列
    ...(!isReadOnly ? [{
      title: '操作',
      key: 'actions',
      width: 60,
      render: (_: any, record: Transcription) => (
        <Popconfirm
          title="确定要删除这条记录吗？"
          onConfirm={() => handleDelete(record.id)}
          okText="确定"
          cancelText="取消"
        >
          <Button type="text" size="small" danger icon={<DeleteOutlined />} />
        </Popconfirm>
      ),
    }] : []),
  ];

  return (
    <div className={styles.historyPage}>
      <Card className={styles.historyCard}>
        <div style={{ marginBottom: 8, display: 'flex', gap: 12, alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap' }}>
          <Space size="large" wrap>
            <Space>
              <span style={{ fontSize: 12, color: '#666' }}>排序方式:</span>
              <Select
                value={sortBy}
                onChange={setSortBy}
                size="small"
                style={{ width: 100, fontSize: 12 }}
              >
                <Select.Option value="createdAt">创建日期</Select.Option>
                <Select.Option value="actualDate">实际日期</Select.Option>
              </Select>
              <Button
                size="small"
                icon={sortOrder === 'desc' ? <ArrowDownOutlined /> : <ArrowUpOutlined />}
                onClick={() => setSortOrder(sortOrder === 'desc' ? 'asc' : 'desc')}
                title={sortOrder === 'desc' ? '降序' : '升序'}
                style={{ fontSize: 12 }}
              />
            </Space>
            <Space>
              <span style={{ fontSize: 12, color: '#666' }}>标签筛选:</span>
              <Select
                value={selectedTag}
                onChange={setSelectedTag}
                size="small"
                style={{ width: 200, fontSize: 12 }}
                allowClear
                placeholder="全部"
                showSearch
                optionFilterProp="children"
              >
                <Select.Option value="null">无标签</Select.Option>
                {allTags.map(tag => (
                  <Select.Option key={tag} value={tag}>
                    {tag}
                  </Select.Option>
                ))}
              </Select>
            </Space>
          </Space>
        </div>
        <Table
          columns={columns}
          dataSource={transcriptions}
          loading={loading}
          rowKey="id"
          pagination={{
            current: currentPage,
            pageSize: pageSize,
            total: total,
            showSizeChanger: true,
            showQuickJumper: true,
            showTotal: (total, range) => `第 ${range[0]}-${range[1]} 条，共 ${total} 条`,
            pageSizeOptions: ['20', '50', '100', '200'],
            onChange: (page, size) => {
              setCurrentPage(page);
              setPageSize(size);
              loadTranscriptions(page);
            },
            onShowSizeChange: (current, size) => {
              setCurrentPage(1);
              setPageSize(size);
              loadTranscriptions(1);
            },
          }}
          scroll={{ x: 'max-content', y: 'calc(100vh - 300px)' }}
        />
      </Card>

    </div>
  );
};

export default HistoryPage;
