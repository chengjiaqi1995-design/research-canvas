import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Card,
  Button,
  Space,
  Modal,
  Input,
  message,
  Popconfirm,
  Empty,
  Tag,
  Spin,
} from 'antd';
import {
  PlusOutlined,
  EditOutlined,
  DeleteOutlined,
  FolderOutlined,
  FolderOpenOutlined,
} from '@ant-design/icons';
import {
  createProject,
  getProjects,
  updateProject,
  deleteProject,
} from '../api/project';
import { getTranscriptions, updateTranscriptionProject } from '../api/transcription';
import type { Project, Transcription } from '../types';
import styles from './ProjectPage.module.css';

const { TextArea } = Input;

const ProjectPage: React.FC = () => {
  const navigate = useNavigate();
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [editingProject, setEditingProject] = useState<Project | null>(null);
  const [projectName, setProjectName] = useState('');
  const [projectDescription, setProjectDescription] = useState('');
  const [expandedProjects, setExpandedProjects] = useState<Set<string>>(new Set());
  const [projectTranscriptions, setProjectTranscriptions] = useState<{
    [key: string]: Transcription[];
  }>({});
  const [loadingTranscriptions, setLoadingTranscriptions] = useState<Set<string>>(new Set());

  useEffect(() => {
    loadProjects();
  }, []);

  const loadProjects = async () => {
    try {
      setLoading(true);
      const response = await getProjects();
      if (response.success && response.data) {
        setProjects(response.data);
      }
    } catch (error: any) {
      const errorMsg = error.message || '未知错误';
      console.error('加载项目列表失败:', error);
      message.error('加载项目列表失败：' + errorMsg);
    } finally {
      setLoading(false);
    }
  };

  const loadProjectTranscriptions = async (projectId: string) => {
    if (projectTranscriptions[projectId]) {
      return; // 已经加载过
    }

    try {
      setLoadingTranscriptions(prev => new Set(prev).add(projectId));
      const response = await getTranscriptions({
        projectId,
        page: 1,
        pageSize: 1000, // 加载所有
      });
      if (response.success && response.data) {
        setProjectTranscriptions(prev => ({
          ...prev,
          [projectId]: response.data!.items,
        }));
      }
    } catch (error: any) {
      message.error('加载转录记录失败：' + (error.message || '未知错误'));
    } finally {
      setLoadingTranscriptions(prev => {
        const newSet = new Set(prev);
        newSet.delete(projectId);
        return newSet;
      });
    }
  };

  const handleCreateProject = async () => {
    if (!projectName.trim()) {
      message.warning('项目名称不能为空');
      return;
    }

    try {
      const response = await createProject(projectName.trim(), projectDescription.trim() || undefined);
      if (response.success) {
        message.success('项目创建成功');
        setShowCreateModal(false);
        setProjectName('');
        setProjectDescription('');
        await loadProjects();
      }
    } catch (error: any) {
      message.error('创建项目失败：' + (error.message || '未知错误'));
    }
  };

  const handleEditProject = (project: Project) => {
    setEditingProject(project);
    setProjectName(project.name);
    setProjectDescription(project.description || '');
    setShowEditModal(true);
  };

  const handleUpdateProject = async () => {
    if (!editingProject || !projectName.trim()) {
      message.warning('项目名称不能为空');
      return;
    }

    try {
      const response = await updateProject(
        editingProject.id,
        projectName.trim(),
        projectDescription.trim() || undefined
      );
      if (response.success) {
        message.success('项目更新成功');
        setShowEditModal(false);
        setEditingProject(null);
        setProjectName('');
        setProjectDescription('');
        await loadProjects();
      }
    } catch (error: any) {
      message.error('更新项目失败：' + (error.message || '未知错误'));
    }
  };

  const handleDeleteProject = async (projectId: string) => {
    try {
      const response = await deleteProject(projectId);
      if (response.success) {
        message.success('项目删除成功');
        await loadProjects();
        // 清除相关的转录记录缓存
        setProjectTranscriptions(prev => {
          const newObj = { ...prev };
          delete newObj[projectId];
          return newObj;
        });
      }
    } catch (error: any) {
      message.error('删除项目失败：' + (error.message || '未知错误'));
    }
  };

  const toggleProject = (projectId: string) => {
    const newExpanded = new Set(expandedProjects);
    if (newExpanded.has(projectId)) {
      newExpanded.delete(projectId);
    } else {
      newExpanded.add(projectId);
      loadProjectTranscriptions(projectId);
    }
    setExpandedProjects(newExpanded);
  };

  const handleRemoveFromProject = async (transcriptionId: string, projectId: string) => {
    try {
      const response = await updateTranscriptionProject(transcriptionId, null);
      if (response.success) {
        message.success('已从项目中移除');
        // 重新加载项目转录记录
        setProjectTranscriptions(prev => {
          const newObj = { ...prev };
          delete newObj[projectId];
          return newObj;
        });
        await loadProjectTranscriptions(projectId);
        await loadProjects(); // 更新项目计数
      }
    } catch (error: any) {
      message.error('移除失败：' + (error.message || '未知错误'));
    }
  };

  return (
    <div className={styles.projectPage}>
      <Card className={styles.projectCard}>
        <div className={styles.projectHeader}>
          <h2>项目归类</h2>
          <Button
            type="primary"
            icon={<PlusOutlined />}
            onClick={() => setShowCreateModal(true)}
          >
            新建项目
          </Button>
        </div>

        {loading ? (
          <div style={{ textAlign: 'center', padding: 40 }}>
            <Spin size="large" />
          </div>
        ) : projects.length === 0 ? (
          <Empty description="暂无项目，点击上方按钮创建项目" />
        ) : (
          <div className={styles.projectList}>
            {projects.map(project => {
              const isExpanded = expandedProjects.has(project.id);
              const transcriptions = projectTranscriptions[project.id] || [];
              const isLoading = loadingTranscriptions.has(project.id);

              return (
                <div key={project.id} className={styles.projectItem}>
                  <div
                    className={styles.projectItemHeader}
                    onClick={() => toggleProject(project.id)}
                  >
                    <Space>
                      {isExpanded ? <FolderOpenOutlined /> : <FolderOutlined />}
                      <span className={styles.projectName}>{project.name}</span>
                      <Tag>{project.transcriptionCount || 0} 条记录</Tag>
                    </Space>
                    <Space>
                      <Button
                        type="text"
                        icon={<EditOutlined />}
                        size="small"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleEditProject(project);
                        }}
                        title="编辑项目"
                      />
                      <Popconfirm
                        title="确定要删除这个项目吗？"
                        description="删除项目不会删除转录记录，只会取消归类。"
                        onConfirm={(e) => {
                          e?.stopPropagation();
                          handleDeleteProject(project.id);
                        }}
                        okText="确定"
                        cancelText="取消"
                      >
                        <Button
                          type="text"
                          danger
                          icon={<DeleteOutlined />}
                          size="small"
                          onClick={(e) => {
                            e.stopPropagation();
                          }}
                          title="删除项目"
                        />
                      </Popconfirm>
                    </Space>
                  </div>
                  {project.description && (
                    <div className={styles.projectDescription}>{project.description}</div>
                  )}
                  {isExpanded && (
                    <div className={styles.projectTranscriptions}>
                      {isLoading ? (
                        <div style={{ textAlign: 'center', padding: 20 }}>
                          <Spin />
                        </div>
                      ) : transcriptions.length === 0 ? (
                        <Empty description="该项目暂无转录记录" />
                      ) : (
                        <div className={styles.transcriptionList}>
                          {transcriptions.map(transcription => (
                            <div key={transcription.id} className={styles.transcriptionItem}>
                              <span
                                className={styles.transcriptionName}
                                onClick={() => navigate(`/transcription/${transcription.id}`)}
                              >
                                {transcription.fileName}
                              </span>
                              <Button
                                type="text"
                                size="small"
                                onClick={() => handleRemoveFromProject(transcription.id, project.id)}
                                title="从项目中移除"
                              >
                                移除
                              </Button>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </Card>

      {/* 创建项目模态框 */}
      <Modal
        title="新建项目"
        open={showCreateModal}
        onOk={handleCreateProject}
        onCancel={() => {
          setShowCreateModal(false);
          setProjectName('');
          setProjectDescription('');
        }}
        okText="创建"
        cancelText="取消"
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div>
            <label style={{ display: 'block', marginBottom: 4 }}>项目名称 *</label>
            <Input
              value={projectName}
              onChange={(e) => setProjectName(e.target.value)}
              placeholder="请输入项目名称"
              onPressEnter={handleCreateProject}
            />
          </div>
          <div>
            <label style={{ display: 'block', marginBottom: 4 }}>项目描述</label>
            <TextArea
              value={projectDescription}
              onChange={(e) => setProjectDescription(e.target.value)}
              placeholder="请输入项目描述（可选）"
              rows={3}
            />
          </div>
        </div>
      </Modal>

      {/* 编辑项目模态框 */}
      <Modal
        title="编辑项目"
        open={showEditModal}
        onOk={handleUpdateProject}
        onCancel={() => {
          setShowEditModal(false);
          setEditingProject(null);
          setProjectName('');
          setProjectDescription('');
        }}
        okText="保存"
        cancelText="取消"
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div>
            <label style={{ display: 'block', marginBottom: 4 }}>项目名称 *</label>
            <Input
              value={projectName}
              onChange={(e) => setProjectName(e.target.value)}
              placeholder="请输入项目名称"
              onPressEnter={handleUpdateProject}
            />
          </div>
          <div>
            <label style={{ display: 'block', marginBottom: 4 }}>项目描述</label>
            <TextArea
              value={projectDescription}
              onChange={(e) => setProjectDescription(e.target.value)}
              placeholder="请输入项目描述（可选）"
              rows={3}
            />
          </div>
        </div>
      </Modal>
    </div>
  );
};

export default ProjectPage;

