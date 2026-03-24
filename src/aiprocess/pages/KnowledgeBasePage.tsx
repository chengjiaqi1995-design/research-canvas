import React, { useState, useEffect, useRef } from 'react';
import {
  Card,
  Button,
  Spin,
  message,
  Modal,
  Space,
  Tag,
  Typography,
  Alert,
  Input,
  List,
  Empty,
  Collapse,
  Row,
  Col,
  Divider,
  DatePicker,
  Progress,
} from 'antd';
import type { Dayjs } from 'dayjs';
import {
  SyncOutlined,
  SearchOutlined,
  CloudServerOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  LinkOutlined,
  FilterOutlined,
  ClearOutlined,
} from '@ant-design/icons';
import {
  getKnowledgeBaseStatus,
  syncAllTranscriptions,
  searchKnowledgeBase,
  getIndexProgress,
  queryNotebookLm,
  type NotebookLmCitation,
} from '../api/knowledgeBase';
import styles from './KnowledgeBasePage.module.css';

const { Title, Text, Paragraph } = Typography;
const { Search } = Input;

// 类型定义
interface KnowledgeBaseStatus {
  configured: boolean;
  projectId?: string;
  dataStoreId?: string;
  appId?: string;
  location?: string;
  message: string;
  lastSyncedAt?: string | null;
  totalNotes?: number;
  syncedNotes?: number;
}

interface SearchResult {
  document: {
    id: string;
    name: string;
    structData?: {
      content?: string;
      fileName?: string;
      topic?: string;
      organization?: string;
      participants?: string;
      eventDate?: string;
      tags?: string[];
      createdAt?: string;
    };
  };
  id: string;
}

const KnowledgeBasePage: React.FC = () => {
  const [status, setStatus] = useState<KnowledgeBaseStatus | null>(null);
  const [statusLoading, setStatusLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const [notebookQuestion, setNotebookQuestion] = useState('');
  const [notebookAnswer, setNotebookAnswer] = useState('');
  const [notebookCitations, setNotebookCitations] = useState<NotebookLmCitation[]>([]);
  const [notebookLoading, setNotebookLoading] = useState(false);
  const [notebookMeta, setNotebookMeta] = useState<{
    sourcesIncluded: number;
    sourcesTotal: number;
    truncated: boolean;
  } | null>(null);
  
  // 索引进度状态
  const [indexProgress, setIndexProgress] = useState<{
    uploaded: number;
    indexed: number;
    percentage: number;
    isComplete: boolean;
  } | null>(null);
  const [showProgress, setShowProgress] = useState(false);
  
  // Search tuning 参数
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [filterTopic, setFilterTopic] = useState<string>('');
  const [filterOrg, setFilterOrg] = useState<string>('');
  const [filterParticipants, setFilterParticipants] = useState<string>('');
  const [dateRange, setDateRange] = useState<[Dayjs | null, Dayjs | null] | null>(null);

  useEffect(() => {
    loadStatus();
    loadIndexProgress();
    
    // 每 2 分钟自动更新索引进度
    const interval = setInterval(() => {
      loadIndexProgress();
    }, 120000); // 2 分钟
    
    return () => clearInterval(interval);
  }, []);

  const loadStatus = async () => {
    try {
      setStatusLoading(true);
      const data = await getKnowledgeBaseStatus();
      setStatus(data);
    } catch (error: any) {
      message.error('获取知识库状态失败: ' + error.message);
    } finally {
      setStatusLoading(false);
    }
  };

  const loadIndexProgress = async () => {
    try {
      const progress = await getIndexProgress();
      setIndexProgress(progress);
      
      // 如果有文档且未完成索引，显示进度条
      if (progress.uploaded > 0 && !progress.isComplete) {
        setShowProgress(true);
      } else if (progress.isComplete) {
        // 索引完成后，等待5秒再隐藏进度条
        setTimeout(() => setShowProgress(false), 5000);
      }
    } catch (error: any) {
      console.error('获取索引进度失败:', error.message);
    }
  };

  const handleSearch = async (value: string) => {
    if (!value.trim()) {
      message.warning('请输入搜索关键词');
      return;
    }

    if (!status?.configured) {
      message.error('知识库未配置，请先配置 Vertex AI Search');
      return;
    }

    try {
      setSearching(true);
      setHasSearched(true);
      
      // 构建过滤条件
      const filters: any = {};
      if (filterTopic) filters.topic = filterTopic;
      if (filterOrg) filters.organization = filterOrg;
      if (filterParticipants) filters.participants = filterParticipants;
      
      // 添加日期范围过滤
      if (dateRange && dateRange[0] && dateRange[1]) {
        filters.startDate = dateRange[0].format('YYYY/MM/DD');
        filters.endDate = dateRange[1].format('YYYY/MM/DD');
      }
      
      const data = await searchKnowledgeBase(value, 20, undefined, Object.keys(filters).length > 0 ? filters : undefined);
      setSearchResults(data.results || []);
      
      if (data.results && data.results.length > 0) {
        message.success(`找到 ${data.results.length} 条相关结果`);
      } else {
        message.info('未找到相关结果，文档可能还在索引中（索引通常需要 5-60 分钟）');
      }
    } catch (error: any) {
      message.error('搜索失败: ' + error.message);
    } finally {
      setSearching(false);
    }
  };

  const handleClearFilters = () => {
    setFilterTopic('');
    setFilterOrg('');
    setFilterParticipants('');
    setDateRange(null);
    message.info('已清除所有过滤条件');
  };

  const handleNotebookQuery = async () => {
    if (!notebookQuestion.trim()) {
      message.warning('请输入问题');
      return;
    }

    try {
      setNotebookLoading(true);
      setNotebookAnswer('');
      setNotebookCitations([]);
      setNotebookMeta(null);

      const result = await queryNotebookLm(notebookQuestion.trim());
      if (!result.success) {
        throw new Error('NotebookLM 问答失败');
      }
      setNotebookAnswer(result.answer || '');
      setNotebookCitations(result.citations || []);
      setNotebookMeta({
        sourcesIncluded: result.sourcesIncluded,
        sourcesTotal: result.sourcesTotal,
        truncated: result.truncated,
      });
    } catch (error: any) {
      message.error('NotebookLM 问答失败: ' + (error.message || '未知错误'));
    } finally {
      setNotebookLoading(false);
    }
  };

  const handleSync = async () => {
    if (!status?.configured) {
      message.error('知识库未配置，请先配置 Vertex AI Search');
      return;
    }

    try {
      setSyncing(true);
      const data = await syncAllTranscriptions();
      
      if (data.success) {
        // 重新加载状态以更新同步时间
        await loadStatus();
        
        // 同步后显示进度条并开始监控
        setShowProgress(true);
        loadIndexProgress();
        
        if (data.failed > 0 && data.errors && data.errors.length > 0) {
          // 显示带错误详情的 Modal
          const errorList = data.errors.map((err, idx) => `${idx + 1}. ${err}`).join('\n');
          Modal.error({
            title: `同步完成: 成功 ${data.synced}, 失败 ${data.failed}`,
            content: (
              <div>
                <Paragraph>以下文档同步失败:</Paragraph>
                <pre style={{ 
                  maxHeight: '300px', 
                  overflow: 'auto', 
                  background: '#f5f5f5', 
                  padding: '12px',
                  fontSize: '12px'
                }}>
                  {errorList}
                </pre>
              </div>
            ),
            width: 600,
          });
        } else {
          message.success(data.message);
        }
      } else {
        message.error('同步失败');
      }
    } catch (error: any) {
      message.error('同步失败: ' + error.message);
    } finally {
      setSyncing(false);
    }
  };

  return (
    <div className={styles.knowledgeBasePage}>
      <div className={styles.pageHeader}>
        <Title level={2}>
          <CloudServerOutlined /> 知识库搜索
        </Title>
        <Paragraph type="secondary">
          基于 Google Vertex AI Search 的智能语义搜索引擎
        </Paragraph>
      </div>

      <Card className={styles.statusCard} loading={statusLoading}>
        <Space direction="vertical" style={{ width: '100%' }}>
          <Space>
            <Text strong>知识库状态:</Text>
            {status?.configured ? (
              <Tag icon={<CheckCircleOutlined />} color="success">
                已配置
              </Tag>
            ) : (
              <Tag icon={<CloseCircleOutlined />} color="error">
                未配置
              </Tag>
            )}
          </Space>
          
          {status && (
            <>
              <Text type="secondary">{status.message}</Text>
              {status.configured && status.projectId && (
                <Space direction="vertical" size="small">
                  <Text type="secondary">项目 ID: {status.projectId}</Text>
                  {status.appId && <Text type="secondary">应用 ID: {status.appId}</Text>}
                  {status.dataStoreId && <Text type="secondary">数据存储 ID: {status.dataStoreId}</Text>}
                  {status.lastSyncedAt && (
                    <Text type="secondary">
                      最后同步: {new Date(status.lastSyncedAt).toLocaleString('zh-CN')}
                    </Text>
                  )}
                  {status.totalNotes !== undefined && (
                    <Text type="secondary">
                      已同步: {status.syncedNotes || 0} / {status.totalNotes} 篇笔记
                    </Text>
                  )}
                </Space>
              )}
            </>
          )}

          {/* 索引进度条 */}
          {showProgress && indexProgress && (
            <Card
              size="small"
              style={{
                backgroundColor: indexProgress.isComplete ? '#f6ffed' : '#e6f7ff',
                borderColor: indexProgress.isComplete ? '#b7eb8f' : '#91d5ff',
              }}
            >
              <Space direction="vertical" style={{ width: '100%' }} size="small">
                <Space style={{ width: '100%', justifyContent: 'space-between' }}>
                  <Text strong>
                    {indexProgress.isComplete ? '🎉 索引完成！' : '📊 索引进度'}
                  </Text>
                  <Text type="secondary">
                    {indexProgress.indexed} / {indexProgress.uploaded} 篇
                  </Text>
                </Space>
                <Progress
                  percent={indexProgress.percentage}
                  status={indexProgress.isComplete ? 'success' : 'active'}
                  strokeColor={indexProgress.isComplete ? '#52c41a' : '#1890ff'}
                />
                {!indexProgress.isComplete && (
                  <Alert
                    message="索引正在进行中"
                    description={
                      indexProgress.indexed === 0
                        ? '正在准备索引，通常需要 5-10 分钟开始...'
                        : `正在索引文档，预计还需 ${Math.ceil((indexProgress.uploaded - indexProgress.indexed) * 2 / Math.max(indexProgress.indexed, 1))} 分钟`
                    }
                    type="info"
                    showIcon
                    style={{ marginTop: 8 }}
                  />
                )}
                {indexProgress.isComplete && (
                  <Alert
                    message="所有文档已完成索引，现在可以搜索了！"
                    type="success"
                    showIcon
                    style={{ marginTop: 8 }}
                  />
                )}
              </Space>
            </Card>
          )}

          {!status?.configured && (
            <Alert
              type="warning"
              message="知识库未配置"
              description="请查看项目根目录的 VERTEX_AI_SETUP.md 文件了解配置步骤。"
              showIcon
            />
          )}

          <Button
            type="primary"
            icon={<SyncOutlined />}
            onClick={handleSync}
            loading={syncing}
            disabled={!status?.configured}
          >
            同步所有笔记到知识库
          </Button>
        </Space>
      </Card>

      {/* NotebookLM 问答 */}
      <Card className={styles.searchCard} style={{ marginBottom: 16 }}>
        <Space direction="vertical" style={{ width: '100%' }} size="middle">
          <Space direction="vertical" style={{ width: '100%' }} size="small">
            <Title level={5} style={{ margin: 0 }}>
              NotebookLM 问答（基于全部 Notes）
            </Title>
            <Text type="secondary" style={{ fontSize: 12 }}>
              将你的全部笔记内容作为资料来源，返回带引用的回答/摘要。
            </Text>
          </Space>
          <Input.TextArea
            value={notebookQuestion}
            onChange={(e) => setNotebookQuestion(e.target.value)}
            placeholder="请输入问题，例如：总结印度汽车及零部件行业的关键观点"
            autoSize={{ minRows: 2, maxRows: 6 }}
            disabled={notebookLoading}
          />
          <Space>
            <Button type="primary" loading={notebookLoading} onClick={handleNotebookQuery}>
              提问
            </Button>
            {notebookMeta && (
              <Text type="secondary" style={{ fontSize: 12 }}>
                已使用 {notebookMeta.sourcesIncluded}/{notebookMeta.sourcesTotal} 条笔记
                {notebookMeta.truncated ? '（内容过长已截断）' : ''}
              </Text>
            )}
          </Space>
          {notebookAnswer && (
            <div style={{ background: '#fafafa', borderRadius: 6, padding: '12px 14px' }}>
              <Paragraph style={{ marginBottom: 8 }}>
                <Text strong>回答</Text>
              </Paragraph>
              <Paragraph style={{ whiteSpace: 'pre-wrap', marginBottom: 0 }}>
                {notebookAnswer}
              </Paragraph>
            </div>
          )}
          {notebookCitations.length > 0 && (
            <div style={{ background: '#fafafa', borderRadius: 6, padding: '12px 14px' }}>
              <Paragraph style={{ marginBottom: 8 }}>
                <Text strong>引用</Text>
              </Paragraph>
              <List
                dataSource={notebookCitations}
                renderItem={(item) => (
                  <List.Item style={{ padding: '6px 0' }}>
                    <Space direction="vertical" size={2} style={{ width: '100%' }}>
                      <Text style={{ fontSize: 12 }} type="secondary">
                        {item.sourceTitle || item.sourceId || '未知来源'}
                      </Text>
                      {item.snippet && (
                        <Text style={{ fontSize: 12 }}>{item.snippet}</Text>
                      )}
                      {item.url && (
                        <a href={item.url} target="_blank" rel="noreferrer">
                          {item.url}
                        </a>
                      )}
                    </Space>
                  </List.Item>
                )}
              />
            </div>
          )}
        </Space>
      </Card>

      {/* 搜索区域 */}
      <Card className={styles.searchCard}>
        <Space direction="vertical" style={{ width: '100%' }} size="large">
          <Search
            placeholder="输入关键词搜索笔记内容..."
            size="large"
            enterButton={
              <Button type="primary" icon={<SearchOutlined />}>
                搜索
              </Button>
            }
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onSearch={handleSearch}
            loading={searching}
            disabled={!status?.configured}
          />

          {/* Search Tuning - 高级搜索选项 */}
          <Collapse
            items={[
              {
                key: 'tuning',
                label: (
                  <Space>
                    <FilterOutlined />
                    <span>高级搜索选项 (Search Tuning)</span>
                  </Space>
                ),
                children: (
                  <Space direction="vertical" style={{ width: '100%' }} size="middle">
                    <Row gutter={16}>
                      <Col span={6}>
                        <div style={{ marginBottom: 8 }}>
                          <Text strong>主题过滤</Text>
                        </div>
                        <Input
                          placeholder="输入主题关键词"
                          value={filterTopic}
                          onChange={(e) => setFilterTopic(e.target.value)}
                          allowClear
                        />
                      </Col>
                      <Col span={6}>
                        <div style={{ marginBottom: 8 }}>
                          <Text strong>机构过滤</Text>
                        </div>
                        <Input
                          placeholder="输入机构名称"
                          value={filterOrg}
                          onChange={(e) => setFilterOrg(e.target.value)}
                          allowClear
                        />
                      </Col>
                      <Col span={6}>
                        <div style={{ marginBottom: 8 }}>
                          <Text strong>参与人过滤</Text>
                        </div>
                        <Input
                          placeholder="输入参与人姓名"
                          value={filterParticipants}
                          onChange={(e) => setFilterParticipants(e.target.value)}
                          allowClear
                        />
                      </Col>
                      <Col span={6}>
                        <div style={{ marginBottom: 8 }}>
                          <Text strong>发生时间段</Text>
                        </div>
                        <DatePicker.RangePicker
                          style={{ width: '100%' }}
                          value={dateRange}
                          onChange={(dates) => setDateRange(dates as [Dayjs | null, Dayjs | null] | null)}
                          placeholder={['开始日期', '结束日期']}
                          format="YYYY/MM/DD"
                        />
                      </Col>
                    </Row>

                    <Divider style={{ margin: '12px 0' }} />

                    <Space>
                      <Button 
                        icon={<ClearOutlined />} 
                        onClick={handleClearFilters}
                        size="small"
                      >
                        清除过滤
                      </Button>
                      <Text type="secondary" style={{ fontSize: '12px' }}>
                        {(filterTopic || filterOrg || filterParticipants || dateRange) 
                          ? '✓ 已应用过滤条件' 
                          : '未应用过滤'}
                      </Text>
                    </Space>
                  </Space>
                ),
              },
            ]}
          />
          
          {status?.configured && status.projectId && status.appId && (
            <Alert
              message="也可以在 Google Cloud Console 中搜索"
              description={
                <span>
                  <a 
                    href={`https://console.cloud.google.com/gen-app-builder/engines/${status.appId}/preview?project=${status.projectId}`}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <LinkOutlined /> 在 Google Cloud Console 中打开搜索预览
                  </a>
                </span>
              }
              type="info"
              showIcon
            />
          )}
        </Space>
      </Card>

      {/* 搜索结果 */}
      <Card 
        className={styles.resultsCard}
        title={hasSearched ? `搜索结果 (${searchResults.length})` : '搜索结果'}
      >
        {searching ? (
          <div style={{ textAlign: 'center', padding: '40px 0' }}>
            <Spin size="large" tip="正在搜索..." />
          </div>
        ) : hasSearched && searchResults.length === 0 ? (
          <Empty 
            description={
              <Space direction="vertical">
                <span>未找到相关结果</span>
                <Text type="secondary" style={{ fontSize: '12px' }}>
                  提示：新同步的文档需要 5-60 分钟才能被搜索到
                </Text>
              </Space>
            }
          />
        ) : !hasSearched ? (
          <Empty description="输入关键词开始搜索" />
        ) : (
          <List
            dataSource={searchResults}
            renderItem={(result) => {
              const data = result.document.structData || {};
              const tags = data.tags || [];
              
              return (
                <List.Item className={styles.searchResultItem}>
                  <div className={styles.resultContent} style={{ width: '100%' }}>
                    <div className={styles.resultHeader} style={{ marginBottom: '8px' }}>
                      <Title level={4} style={{ margin: 0, marginBottom: '8px' }}>
                        {data.fileName || '未命名'}
                      </Title>
                      <Space size={4} wrap>
                        {data.topic && <Tag color="blue">主题: {data.topic}</Tag>}
                        {data.organization && <Tag color="green">机构: {data.organization}</Tag>}
                        {data.participants && <Tag color="orange">参与人: {data.participants}</Tag>}
                        {data.eventDate && <Tag color="purple">时间: {data.eventDate}</Tag>}
                      </Space>
                    </div>
                    
                    <Paragraph 
                      style={{ marginBottom: '8px', color: '#666' }}
                      ellipsis={{ rows: 3, expandable: true, symbol: '展开' }}
                    >
                      {data.content?.substring(0, 300) || '无内容预览'}
                    </Paragraph>
                    
                    {tags.length > 0 && (
                      <Space size={4} wrap style={{ marginBottom: '8px' }}>
                        {tags.map((tag, index) => (
                          <Tag key={index} style={{ fontSize: '12px' }}>{tag}</Tag>
                        ))}
                      </Space>
                    )}
                    
                    {data.createdAt && (
                      <Text type="secondary" style={{ fontSize: '12px' }}>
                        创建时间: {new Date(data.createdAt).toLocaleString('zh-CN')}
                      </Text>
                    )}
                  </div>
                </List.Item>
              );
            }}
          />
        )}
      </Card>
    </div>
  );
};

export default KnowledgeBasePage;

