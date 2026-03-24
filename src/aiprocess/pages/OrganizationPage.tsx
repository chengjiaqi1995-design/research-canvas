import { useEffect, useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Space, Tag, Input, Button, message, Select, Empty, Modal, Table, Tooltip } from 'antd';
import { PlusOutlined, CloseOutlined, SyncOutlined, CheckOutlined, ArrowRightOutlined, EditOutlined } from '@ant-design/icons';
import { getIndustries, addIndustry, deleteIndustry, resetIndustries } from '../api/user';
import { getDirectoryData, getTranscription, reclassifyIndustries, normalizeCompanies, updateCompanyIndustry } from '../api/transcription';
const { Option } = Select;
import { getApiConfig } from '../components/ApiConfigModal';
import type { Transcription } from '../types';
import MarkdownViewer from '../components/MarkdownViewer';
import { useReadOnly } from '../contexts/ReadOnlyContext';
import styles from './OrganizationPage.module.css';

interface OrganizationPageProps {
  externalData?: Transcription[];
  externalIndustries?: string[];
}

const OrganizationPage: React.FC<OrganizationPageProps> = ({ externalData, externalIndustries }) => {
  const navigate = useNavigate();
  const { isReadOnly } = useReadOnly();
  const [industries, setIndustries] = useState<string[]>([]);
  const [newIndustry, setNewIndustry] = useState('');
  const [addingIndustry, setAddingIndustry] = useState(false);
  const [editingIndustries, setEditingIndustries] = useState(false);
  // 移除 groupBy，只保留按行业分组
  const [transcriptions, setTranscriptions] = useState<Transcription[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedTag, setSelectedTag] = useState<string | undefined>(undefined);
  const [allTags, setAllTags] = useState<string[]>([]);
  const [selectedCountry, setSelectedCountry] = useState<string | undefined>(undefined);
  const [selectedTimeRange, setSelectedTimeRange] = useState<string | undefined>(undefined);
  const [expandedCompanies, setExpandedCompanies] = useState<Set<string>>(new Set());
  const [expandedIndustries, setExpandedIndustries] = useState<Set<string>>(new Set());
  const [expandedSuperCategories, setExpandedSuperCategories] = useState<Set<string>>(new Set(['能源', '资源', '工业', '科技', '互联网', 'General', '政治']));
  const [previewVisible, setPreviewVisible] = useState(false);
  const [previewNote, setPreviewNote] = useState<Transcription | null>(null);
  const [reclassifying, setReclassifying] = useState(false);
  const [reclassifyPreview, setReclassifyPreview] = useState<{
    summary: any;
    details: Array<{ id: string; fileName: string; oldIndustry: string | null; newIndustry: string; method: string }>;
  } | null>(null);
  const [reclassifyPreviewVisible, setReclassifyPreviewVisible] = useState(false);

  // 归一化预览状态
  const [normalizingCompanies, setNormalizingCompanies] = useState(false);
  const [normalizePreview, setNormalizePreview] = useState<Array<{ old: string; new: string; count: number; method: string }>>([]);
  const [normalizePreviewVisible, setNormalizePreviewVisible] = useState(false);
  const [selectedNormalizeKeys, setSelectedNormalizeKeys] = useState<React.Key[]>([]);
  const [confirmingNormalize, setConfirmingNormalize] = useState(false);

  // 手动修改公司行业状态
  const [editIndustryModalVisible, setEditIndustryModalVisible] = useState(false);
  const [editingOrgName, setEditingOrgName] = useState('');
  const [editingNewOrgName, setEditingNewOrgName] = useState('');
  const [editingCurrentIndustry, setEditingCurrentIndustry] = useState('');
  const [editingNewIndustry, setEditingNewIndustry] = useState('');
  const [savingIndustry, setSavingIndustry] = useState(false);

  const handleOpenEditIndustryModal = (orgName: string, currentIndustry: string) => {
    setEditingOrgName(orgName);
    setEditingNewOrgName(orgName);
    setEditingCurrentIndustry(currentIndustry);
    setEditingNewIndustry(currentIndustry);
    setEditIndustryModalVisible(true);
  };

  const handleSaveIndustry = async () => {
    const isIndustryUnchanged = !editingNewIndustry || editingNewIndustry === editingCurrentIndustry;
    const isNameUnchanged = !editingNewOrgName || editingNewOrgName.trim() === editingOrgName;
    
    if (isIndustryUnchanged && isNameUnchanged) {
      setEditIndustryModalVisible(false);
      return;
    }
    setSavingIndustry(true);
    try {
      const res = await updateCompanyIndustry(editingOrgName, editingNewIndustry, editingNewOrgName.trim());
      if (res.success) {
        message.success(`保存成功`);
        setEditIndustryModalVisible(false);
        loadTranscriptions();
      } else {
        message.error('修改失败');
      }
    } catch (e) {
      message.error('请求出错');
    } finally {
      setSavingIndustry(false);
    }
  };

  // 一键归一化公司名称 (Dry Run)
  const handleNormalizeCompanies = async () => {
    setNormalizingCompanies(true);
    const config = getApiConfig();
    const hide = message.loading('正在利用 Portfolio 和 AI 分析公司名称...', 0);
    try {
      const response = await normalizeCompanies({
        geminiApiKey: config.geminiApiKey || '',
        geminiModel: config.metadataModel || '',
        dryRun: true
      });
      hide();
      if (response.success) {
        if (response.data && response.data.length > 0) {
          setNormalizePreview(response.data);
          // 默认选中所有建议
          setSelectedNormalizeKeys(response.data.map((item: any) => item.old));
          setNormalizePreviewVisible(true);
        } else {
          message.success('当前没有需要归一化的新名称');
        }
      } else {
        message.error(response.error || '分析失败');
      }
    } catch (error) {
      console.error(error);
      hide();
      message.error('请求出错');
    } finally {
      setNormalizingCompanies(false);
    }
  };

  // 确认应用公司归一化
  const handleConfirmNormalize = async () => {
    if (selectedNormalizeKeys.length === 0) {
      message.warning('请至少选择一项要应用的变化');
      return;
    }

    const approvedMapping: Record<string, string> = {};
    for (const item of normalizePreview) {
      if (selectedNormalizeKeys.includes(item.old)) {
        approvedMapping[item.old] = item.new;
      }
    }

    setConfirmingNormalize(true);
    const hide = message.loading('正在应用合并...', 0);
    try {
      const response = await normalizeCompanies({ dryRun: false, approvedMapping });
      hide();
      if (response.success) {
        message.success('归一化合并应用成功');
        setNormalizePreviewVisible(false);
        loadTranscriptions();
      } else {
        message.error(response.error || '应用失败');
      }
    } catch (e) {
      console.error(e);
      hide();
      message.error('应用请求出错');
    } finally {
      setConfirmingNormalize(false);
    }
  };

  // 点击笔记弹出预览
  const handleNoteClick = async (item: Transcription) => {
    const hide = message.loading('加载中...', 0);
    try {
      const response = await getTranscription(item.id);
      if (response.success && response.data) {
        setPreviewNote(response.data);
      } else {
        setPreviewNote(item);
      }
    } catch (error) {
      console.error('获取笔记详情失败:', error);
      message.error('加载笔记内容失败，将显示部分信息');
      setPreviewNote(item);
    } finally {
      hide();
      setPreviewVisible(true);
    }
  };

  // 加载行业列表
  const loadIndustries = async () => {
    try {
      const response = await getIndustries();
      if (response.success && response.data) {
        setIndustries(response.data.industries);
      }
    } catch (error: any) {
      console.error('加载行业列表失败:', error);
    }
  };

  // 加载笔记列表（使用轻量级 Directory API）
  const loadTranscriptions = async () => {
    setLoading(true);
    try {
      const response = await getDirectoryData({
        tag: selectedTag,
      });
      if (response.success && response.data) {
        setTranscriptions(response.data.items);

        // 提取所有标签
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
      message.error('加载失败：' + (error.message || '未知错误'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    // 如果有外部数据，使用外部数据
    if (externalData) {
      setTranscriptions(externalData);
      // 提取标签
      const tags: string[] = [];
      externalData.forEach(item => {
        if (item.tags && Array.isArray(item.tags)) {
          tags.push(...item.tags);
        }
      });
      setAllTags([...new Set(tags)].filter(tag => tag && tag.trim()));
      setLoading(false);
    } else {
      loadTranscriptions();
    }
  }, [externalData, selectedTag]);

  useEffect(() => {
    if (externalIndustries) {
      setIndustries(externalIndustries);
    } else {
      loadIndustries();
    }
  }, [externalIndustries]);

  // 添加行业
  const handleAddIndustry = async () => {
    if (!newIndustry.trim()) {
      message.warning('行业名称不能为空');
      return;
    }
    setAddingIndustry(true);
    try {
      const response = await addIndustry(newIndustry.trim());
      if (response.success && response.data) {
        setIndustries(response.data.industries);
        setNewIndustry('');
        message.success('添加成功');
      }
    } catch (error: any) {
      message.error(error.message || '添加失败');
    } finally {
      setAddingIndustry(false);
    }
  };

  // 删除行业
  const handleDeleteIndustry = async (industry: string) => {
    try {
      const response = await deleteIndustry(industry);
      if (response.success && response.data) {
        setIndustries(response.data.industries);
        message.success('删除成功');
      }
    } catch (error: any) {
      message.error(error.message || '删除失败');
    }
  };

  // Step 1: 预览重分类方案
  const handleReclassifyPreview = async () => {
    setReclassifying(true);
    const hide = message.loading('正在生成重分类方案，可能需要几分钟...', 0);
    try {
      const apiConfig = getApiConfig();
      const response = await reclassifyIndustries({ dryRun: true, geminiApiKey: apiConfig.geminiApiKey || undefined });
      if (response.success && response.data) {
        setReclassifyPreview(response.data);
        setReclassifyPreviewVisible(true);
      } else {
        message.error('预览失败：' + (response.error || '未知错误'));
      }
    } catch (error: any) {
      message.error('预览失败：' + (error.response?.data?.error || error.message || '未知错误'));
    } finally {
      hide();
      setReclassifying(false);
    }
  };

  // Step 2: 确认执行重分类
  const handleReclassifyConfirm = async () => {
    setReclassifying(true);
    const hide = message.loading('正在执行重分类...', 0);
    try {
      const apiConfig = getApiConfig();
      const response = await reclassifyIndustries({ dryRun: false, geminiApiKey: apiConfig.geminiApiKey || undefined });
      if (response.success && response.data) {
        const { summary } = response.data;
        message.success(
          `重分类完成！共 ${summary.total} 条笔记，${summary.changed} 条已更新（映射: ${summary.mapped}, Portfolio: ${summary.portfolioMatched || 0}, AI分类: ${summary.geminiClassified}）`,
          8
        );
        setReclassifyPreviewVisible(false);
        setReclassifyPreview(null);
        await loadIndustries();
        await loadTranscriptions();
      }
    } catch (error: any) {
      message.error('重分类失败：' + (error.message || '未知错误'));
    } finally {
      hide();
      setReclassifying(false);
    }
  };

  // 同步行业分类：将预定义的完整行业列表写入，不动笔记
  const TARGET_INDUSTRIES = [
    '核电', '铜金', '铁', '铝', '航空航天', '五金工具', '泛工业', '工业软件', '稀土', 'LNG', '煤', 'EPC',
    '互联网/大模型', 'bitcoin miner', '军工', '卡车', '基建地产链条', '天然气发电', '战略金属', '报废车',
    '数据中心设备', '煤电', '石油', '车险', '钠电', '电网设备', '汽车', '零部件', '锂电', '自动化',
    '电力运营商', '工程机械/矿山机械', '两轮车/全地形车', '风光储', '轨道交通', '机器人/工业自动化',
    '检测服务', '自动驾驶', '轮胎', '工业MRO', '设备租赁', '天然气管道',
    '暖通空调/楼宇设备', '农用机械', '航运', '海运', '铁路', '车运/货代', '非电消纳', '造船',
    '创新消费品', '农业', '金融业', '建设', '政治', '宏观'
  ];

  // 高层级分组主题设置
  const SUPER_CATEGORIES: { name: string; color: string; industries: string[] }[] = [
    {
      name: '电力',
      color: '#fadb14',
      industries: ['核电', '煤电', '天然气发电', '风光储', '电网设备', '电力运营商', 'bitcoin miner', '非电消纳'],
    },
    {
      name: '能源',
      color: '#fa8c16',
      industries: ['LNG', '煤', '石油', '天然气管道'],
    },
    {
      name: '资源',
      color: '#13c2c2',
      industries: ['稀土', '战略金属', '铜金', '铁', '铝'],
    },
    {
      name: '工业',
      color: '#1677ff',
      industries: [
        '航空航天', '五金工具', '泛工业', '军工', '卡车', '基建地产链条',
        '零部件', '自动化', '工程机械/矿山机械', '轨道交通',
        '机器人/工业自动化', '检测服务', '自动驾驶', '轮胎', '工业MRO',
        '锂电', '钠电', '暖通空调/楼宇设备'
      ],
    },
    {
      name: '科技和互联网',
      color: '#722ed1',
      industries: ['工业软件', '互联网/大模型', '数据中心设备'],
    },
    {
      name: '消费',
      color: '#52c41a',
      industries: ['车险', '汽车', '两轮车/全地形车', '报废车', '创新消费品'],
    },
    {
      name: '物流和运输',
      color: '#08979c',
      industries: ['航运', '海运', '铁路', '车运/货代', '造船'],
    },
    {
      name: '建设',
      color: '#eb2f96',
      industries: ['EPC', '设备租赁'],
    },
    {
      name: '农业',
      color: '#a0d911',
      industries: ['农用机械'],
    },
    {
      name: '金融业',
      color: '#d48806',
      industries: [],
    },
    {
      name: '政治',
      color: '#cf1322',
      industries: ['政治', '宏观'],
    }
  ];

  // 获取行业所属的大类
  const getIndustrySuperCategory = (industry: string): string => {
    for (const cat of SUPER_CATEGORIES) {
      if (cat.industries.includes(industry)) return cat.name;
    }
    return 'General'; // 未分类的默认归入 General
  };

  const handleSyncIndustries = async () => {
    // 直接替换为目标分类列表
    const hide = message.loading('正在同步行业分类...', 0);
    try {
      const response = await resetIndustries(TARGET_INDUSTRIES);
      if (response.success && response.data) {
        setIndustries(response.data.industries);
        message.success(`行业分类已同步，共 ${response.data.industries.length} 个行业`);
      }
    } catch (error: any) {
      message.error('同步失败：' + (error.message || '未知错误'));
    } finally {
      hide();
    }
  };

  // 提取所有国家列表（去重），并包含常用选项
  const baseCountries = ['中国', '美国', '日本', '韩国', '欧洲', '印度', '其他'];
  const allCountries = useMemo(() => Array.from(new Set(
    [
      ...baseCountries,
      ...transcriptions
        .map(t => (t as any).country)
        .filter(c => c && c !== '未知' && c !== '未提及')
    ]
  )).sort(), [transcriptions]);

  // 根据时间范围筛选
  const filteredByTimeRange = useMemo(() => selectedTimeRange
    ? transcriptions.filter(t => {
      const createdAt = new Date(t.createdAt);
      const now = new Date();
      let startDate: Date;

      if (selectedTimeRange === 'week') {
        // 过去一周
        startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      } else if (selectedTimeRange === 'month') {
        // 过去一个月
        startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      } else {
        return true;
      }

      return createdAt >= startDate;
    })
    : transcriptions, [transcriptions, selectedTimeRange]);

  // 根据国家筛选
  const filteredByCountry = useMemo(() => selectedCountry
    ? filteredByTimeRange.filter(t => (t as any).country === selectedCountry)
    : filteredByTimeRange, [filteredByTimeRange, selectedCountry]);

  // 检查是否有 organization
  const hasOrganization = (item: Transcription): boolean => {
    const org = (item as any).organization;
    return org && org !== '' && org !== '未提及' && org !== '未知公司';
  };

  // 获取用于排序的日期
  const getItemDate = (item: Transcription): Date => {
    const eventDate = (item as any).eventDate;
    if (eventDate && eventDate !== '未提及') {
      const parsed = new Date(eventDate.replace(/\//g, '-'));
      if (!isNaN(parsed.getTime())) {
        return parsed;
      }
    }
    return new Date(item.createdAt);
  };

  // 按时间降序排序的纯函数
  const sortByDateDesc = (items: Transcription[]): Transcription[] => {
    return [...items].sort((a, b) => getItemDate(b).getTime() - getItemDate(a).getTime());
  };

  // 按行业分组，分为公司类和行业类
  const industryGroups = useMemo(() => {
    const groups: Record<string, {
      // 公司类：按 organization 分组，每个组织内按 participant 分组
      companies: Record<string, {
        management: Transcription[];
        expert: Transcription[];
        sellside: Transcription[];
      }>;
      // 行业类：直接按 participant 分组（无 organization 的笔记）
      industry: {
        expert: Transcription[];
        sellside: Transcription[];
      };
    }> = {};

    filteredByCountry.forEach((item: Transcription) => {
      const industry = (item as any).industry || '未分类';
      const participant = item.participants || 'unknown';
      const org = (item as any).organization || '未知公司';

      if (!groups[industry]) {
        groups[industry] = {
          companies: {},
          industry: { expert: [], sellside: [] }
        };
      }

      // 判断是否有 organization
      if (hasOrganization(item)) {
        // 公司类：按 organization 分组
        if (!groups[industry].companies[org]) {
          groups[industry].companies[org] = {
            management: [],
            expert: [],
            sellside: []
          };
        }

        if (participant === 'management') {
          groups[industry].companies[org].management.push(item);
        } else if (participant === 'expert') {
          groups[industry].companies[org].expert.push(item);
        } else if (participant === 'sellside') {
          groups[industry].companies[org].sellside.push(item);
        }
      } else {
        // 行业类：直接按 participant 分组（无 organization）
        if (participant === 'expert') {
          groups[industry].industry.expert.push(item);
        } else if (participant === 'sellside') {
          groups[industry].industry.sellside.push(item);
        }
        // 注意：行业类不会有 company 类型（因为 company 类型都有 organization，属于公司类）
      }
    });

    // 预排序：避免在渲染期间进行 O(n log n) 排序
    for (const indKey of Object.keys(groups)) {
      const g = groups[indKey];
      g.industry.expert = sortByDateDesc(g.industry.expert);
      g.industry.sellside = sortByDateDesc(g.industry.sellside);
      for (const orgKey of Object.keys(g.companies)) {
        const c = g.companies[orgKey];
        c.management = sortByDateDesc(c.management);
        c.expert = sortByDateDesc(c.expert);
        c.sellside = sortByDateDesc(c.sellside);
      }
    }

    return groups;
  }, [filteredByCountry]);



  // 按公司名称分组（用于显示具体公司列表）
  const groupByOrganization = (items: Transcription[]) => {
    const orgGroups: Record<string, Transcription[]> = {};
    items.forEach(item => {
      const org = (item as any).organization || '未知公司';
      if (!orgGroups[org]) {
        orgGroups[org] = [];
      }
      orgGroups[org].push(item);
    });
    // 对每个组内的项目按时间降序排序
    for (const org of Object.keys(orgGroups)) {
      orgGroups[org] = sortByDateDesc(orgGroups[org]);
    }
    return orgGroups;
  };

  // 显示公司总数
  const getOrganizationSummary = (items: Transcription[]) => {
    const orgGroups = groupByOrganization(items);
    const orgNames = Object.keys(orgGroups).sort();
    return orgNames.map(name => `${name} (${orgGroups[name].length})`).join('、');
  };

  // 渲染带有 Ticker 标签的公司名称
  const renderOrganizationWithTag = (orgName: string) => {
    if (!orgName) return orgName;
    const match = orgName.match(/^\[(.*?)\]\s*(.*)$/);
    if (match) {
      return (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, verticalAlign: 'middle' }}>
          <Tag color="blue" style={{ margin: 0, fontSize: 10, lineHeight: '18px' }}>{match[1]}</Tag>
          <span style={{ display: 'inline-block', flex: 1 }}>{match[2]}</span>
        </span>
      );
    }
    return orgName;
  };

  // 切换公司展开/折叠状态
  const toggleCompanyExpand = (companyKey: string) => {
    setExpandedCompanies(prev => {
      const newSet = new Set(prev);
      if (newSet.has(companyKey)) {
        newSet.delete(companyKey);
      } else {
        newSet.add(companyKey);
      }
      return newSet;
    });
  };

  // 切换大类展开/折叠
  const toggleSuperCategoryExpand = (cat: string) => {
    setExpandedSuperCategories(prev => {
      const newSet = new Set(prev);
      if (newSet.has(cat)) {
        newSet.delete(cat);
      } else {
        newSet.add(cat);
      }
      return newSet;
    });
  };

  // 切换行业展开/折叠状态
  const toggleIndustryExpand = (industry: string) => {
    setExpandedIndustries(prev => {
      const newSet = new Set(prev);
      if (newSet.has(industry)) {
        newSet.delete(industry);
      } else {
        newSet.add(industry);
      }
      return newSet;
    });
  };

  // 显示所有用户定义的行业（包括空的）+ 有数据但不在列表中的行业
  const industryKeys = useMemo(() => {
    const dataKeys = Object.keys(industryGroups).filter(industry => {
      const group = industryGroups[industry];
      const hasCompanies = Object.keys(group.companies).length > 0;
      const hasIndustry = group.industry.expert.length > 0 || group.industry.sellside.length > 0;
      return hasCompanies || hasIndustry;
    });
    // 合并：用户定义的 + 有数据的（去重，保持用户定义的顺序在前）
    return [...new Set([...industries, ...dataKeys])];
  }, [industries, industryGroups]);

  // 按大类分组 industryKeys
  const groupedBySuperCategory = useMemo(() => {
    const result: { name: string; color: string; industries: string[]; totalNotes: number }[] = [];
    for (const cat of SUPER_CATEGORIES) {
      const catIndustries = industryKeys.filter(k => getIndustrySuperCategory(k) === cat.name);
      let totalNotes = 0;
      catIndustries.forEach(ind => {
        const group = industryGroups[ind];
        if (group) {
          Object.values(group.companies).forEach(c => {
            totalNotes += c.management.length + c.expert.length + c.sellside.length;
          });
          totalNotes += group.industry.expert.length + group.industry.sellside.length;
        }
      });
      if (catIndustries.length > 0) {
        result.push({ name: cat.name, color: cat.color, industries: catIndustries, totalNotes });
      }
    }
    // 未归入任何大类的行业放到最后
    const allCategorized = new Set(SUPER_CATEGORIES.flatMap(c => c.industries));
    const uncategorizedIndustries = industryKeys.filter(k => !allCategorized.has(k));
    if (uncategorizedIndustries.length > 0) {
      let totalNotes = 0;
      uncategorizedIndustries.forEach(ind => {
        const group = industryGroups[ind];
        if (group) {
          Object.values(group.companies).forEach(c => {
            totalNotes += c.management.length + c.expert.length + c.sellside.length;
          });
          totalNotes += group.industry.expert.length + group.industry.sellside.length;
        }
      });
      result.push({ name: '未分组', color: '#d9d9d9', industries: uncategorizedIndustries, totalNotes });
    }
    return result;
  }, [industryKeys, industryGroups]);

  // 获取未归类的 notes：
  // 1. participants 不是 company/sellside/expert 的
  // 2. 或者 industry 不在用户定义的行业列表中
  const uncategorizedNotes = useMemo(() => {
    const notes = filteredByCountry.filter(item => {
      const participantRaw = item.participants || 'unknown';
      const participant = participantRaw.toLowerCase();
      const normalizedParticipant = participant === 'management' ? 'company' : participant;
      const industry = (item as any).industry || '未分类';
      const isValidParticipant =
        normalizedParticipant === 'company' ||
        normalizedParticipant === 'sellside' ||
        normalizedParticipant === 'expert';
      const isValidIndustry = industries.includes(industry);
      return !isValidParticipant || !isValidIndustry;
    });
    return sortByDateDesc(notes);
  }, [filteredByCountry, industries]);

  const formatParticipant = (p: string | undefined) => {
    const map: Record<string, string> = {
      company: 'Management',
      sellside: 'Sell-side',
      expert: 'Expert',
    };
    return map[p || ''] || '未知';
  };


  return (
    <div style={{
      padding: '12px 16px',
      maxWidth: '1600px',
      margin: '0 auto',
      background: '#f0f2f5',
      height: 'calc(100vh - 48px)',
      overflowY: 'auto',
    }}>
      {/* 筛选和操作栏 */}
      <div style={{
        marginBottom: 12,
        padding: '8px 12px',
        background: '#fff',
        borderRadius: 4,
        border: '1px solid #e8e8e8',
        display: 'flex',
        alignItems: 'center',
        gap: 16,
        flexWrap: 'wrap',
      }}>
        <Space size="middle">
          <span style={{ fontSize: 11, color: '#999' }}>筛选</span>
          <Select
            value={selectedTag}
            onChange={setSelectedTag}
            size="small"
            style={{ width: 120, fontSize: 11 }}
            allowClear
            placeholder="全部标签"
            showSearch
            optionFilterProp="children"
            popupClassName={styles.organizationFilterDropdown}
          >
            <Select.Option value="null">无标签</Select.Option>
            {allTags.map(tag => (
              <Select.Option key={tag} value={tag}>{tag}</Select.Option>
            ))}
          </Select>
          <Select
            value={selectedCountry}
            onChange={setSelectedCountry}
            size="small"
            style={{ width: 100, fontSize: 11 }}
            allowClear
            placeholder="全部国家"
            popupClassName={styles.organizationFilterDropdown}
          >
            {allCountries.map(country => (
              <Select.Option key={country} value={country}>{country}</Select.Option>
            ))}
          </Select>
          <Select
            value={selectedTimeRange}
            onChange={setSelectedTimeRange}
            size="small"
            style={{ width: 100, fontSize: 11 }}
            allowClear
            placeholder="全部时间"
            popupClassName={styles.organizationFilterDropdown}
          >
            <Select.Option value="week">过去一周</Select.Option>
            <Select.Option value="month">过去一个月</Select.Option>
          </Select>
        </Space>
        <div style={{ flex: 1 }} />
        {!isReadOnly && (
          <Space size={4}>
            <Button
              size="small"
              onClick={handleSyncIndustries}
              style={{ fontSize: 11, borderRadius: 3 }}
            >
              同步行业分类
            </Button>
            <Button
              size="small"
              icon={<SyncOutlined spin={reclassifying} />}
              loading={reclassifying}
              onClick={handleReclassifyPreview}
              style={{ fontSize: 11, borderRadius: 3 }}
            >
              AI重分类
            </Button>
            <Button
              size="small"
              icon={<SyncOutlined spin={normalizingCompanies} />}
              loading={normalizingCompanies}
              onClick={handleNormalizeCompanies}
              style={{ fontSize: 11, borderRadius: 3 }}
            >
              规范化公司名
            </Button>
          </Space>
        )}
      </div>

      {/* 分组展示 */}
      {loading ? (
        <div style={{ textAlign: 'center', padding: 60, color: '#999' }}>加载中...</div>
      ) : filteredByCountry.length === 0 ? (
        <Empty description="暂无数据" />
      ) : (
        <div className={styles.orgTableContainer} style={{ background: '#fff', borderRadius: 4, border: '1px solid #e8e8e8' }}>
          {/* 全局表头 - 只显示一次 */}
          <div style={{ display: 'flex', background: '#fafafa', borderBottom: '1px solid #e8e8e8' }}>
            <div style={{ flex: '1 1 60%', display: 'flex', borderRight: '1px solid #e8e8e8' }}>
              <div style={{ width: '25%', padding: '8px 12px', fontWeight: 600, fontSize: 12, color: '#333' }}>Company</div>
              <div style={{ width: '25%', padding: '8px 12px', fontWeight: 600, fontSize: 12, color: '#333' }}>Management</div>
              <div style={{ width: '25%', padding: '8px 12px', fontWeight: 600, fontSize: 12, color: '#333' }}>Expert</div>
              <div style={{ width: '25%', padding: '8px 12px', fontWeight: 600, fontSize: 12, color: '#333' }}>Sellside</div>
            </div>
            <div style={{ flex: '1 1 40%', display: 'flex' }}>
              <div style={{ width: '50%', padding: '8px 12px', fontWeight: 600, fontSize: 12, color: '#333' }}>Expert</div>
              <div style={{ width: '50%', padding: '8px 12px', fontWeight: 600, fontSize: 12, color: '#333' }}>Sellside</div>
            </div>
          </div>

          {/* 按大类 → 行业分组 */}
          {groupedBySuperCategory.map(superCat => {
            const isSuperExpanded = expandedSuperCategories.has(superCat.name);
            return (
              <div key={superCat.name}>
                {/* 大类标题行 */}
                <div
                  onClick={() => toggleSuperCategoryExpand(superCat.name)}
                  style={{
                    padding: '8px 12px 8px 8px',
                    background: '#f2f4f7',
                    borderBottom: '1px solid #d9d9d9',
                    borderLeft: `4px solid ${superCat.color}`,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    cursor: 'pointer',
                    userSelect: 'none',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      width: 14,
                      height: 14,
                    }}>
                      <span style={{
                        display: 'inline-block',
                        width: 0,
                        height: 0,
                        borderStyle: 'solid',
                        ...(isSuperExpanded
                          ? { borderWidth: '5px 4px 0 4px', borderColor: `${superCat.color} transparent transparent transparent`, transform: 'translateY(2px)' }
                          : { borderWidth: '4px 0 4px 5px', borderColor: `transparent transparent transparent ${superCat.color}`, transform: 'translateX(2px)' }
                        ),
                      }} />
                    </span>
                    <span style={{ fontSize: 13, fontWeight: 700, color: '#333' }}>{superCat.name}</span>
                    <span style={{ fontSize: 11, color: '#777', marginLeft: 6 }}>
                      ({superCat.totalNotes} 条记录 · {superCat.industries.length} 个子类别)
                    </span>
                  </div>
                </div>

                {/* 大类展开后显示行业 */}
                {isSuperExpanded && superCat.industries.map(industry => {
            const group = industryGroups[industry] || {
              companies: {},
              industry: { expert: [], sellside: [] }
            };
            let total = 0;
            Object.values(group.companies).forEach(company => {
              total += company.management.length + company.expert.length + company.sellside.length;
            });
            total += group.industry.expert.length + group.industry.sellside.length;

            const isIndustryExpanded = expandedIndustries.has(industry);

            return (
              <div key={industry} style={{ borderBottom: '1px solid #e8e8e8' }}>
                {/* 行业标题行 */}
                <div
                  style={{
                    padding: '6px 12px 6px 24px',
                    borderBottom: '1px dotted #e8e8e8',
                    backgroundColor: isIndustryExpanded ? '#fbfcff' : '#fff',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    cursor: 'pointer',
                    userSelect: 'none',
                    transition: 'background-color 0.2s',
                  }}
                  className="industry-row-hover"
                >
                  <div
                    onClick={() => toggleIndustryExpand(industry)}
                    style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1 }}
                  >
                    <span style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      width: 12,
                      height: 12,
                    }}>
                      <span style={{
                        display: 'inline-block',
                        width: 0,
                        height: 0,
                        borderStyle: 'solid',
                        ...(isIndustryExpanded
                          ? { borderWidth: '4.5px 3.5px 0 3.5px', borderColor: '#888 transparent transparent transparent', transform: 'translateY(1px)' }
                          : { borderWidth: '3.5px 0 3.5px 4.5px', borderColor: 'transparent transparent transparent #888', transform: 'translateX(1px)' }
                        ),
                      }} />
                    </span>
                    <span style={{ fontSize: 12, fontWeight: 500, color: total > 0 ? '#444' : '#bbb' }}>{industry}</span>
                    <span style={{ fontSize: 11, color: '#aaa' }}>({total})</span>
                  </div>
                  {!isReadOnly && (
                    <Button
                      type="text"
                      size="small"
                      icon={<CloseOutlined />}
                      onClick={(e) => {
                        e.stopPropagation();
                        if (total > 0) {
                          Modal.confirm({
                            title: `删除行业「${industry}」？`,
                            content: `该行业下有 ${total} 条笔记，删除后这些笔记将变为"未归类"。`,
                            okText: '确认删除',
                            cancelText: '取消',
                            onOk: () => handleDeleteIndustry(industry),
                          });
                        } else {
                          handleDeleteIndustry(industry);
                        }
                      }}
                      style={{ fontSize: 10, color: '#ccc', padding: '0 4px', minWidth: 'auto' }}
                      className="industry-delete-btn"
                    />
                  )}
                </div>

                {/* 行业数据 */}
                {isIndustryExpanded && (
                  <div style={{ display: 'flex' }}>
                    {/* 左侧公司区域 60% - 按公司分行 */}
                    <div style={{ flex: '1 1 60%', borderRight: '1px solid #e8e8e8' }}>
                      {Object.keys(group.companies).length === 0 ? (
                        <div style={{ display: 'flex', borderBottom: '1px solid #f0f0f0' }}>
                          <div style={{ width: '25%', padding: '6px 12px', paddingLeft: 40, color: '#ccc', fontSize: 11 }}>-</div>
                          <div style={{ width: '25%', padding: '6px 12px', color: '#ccc', fontSize: 11 }}>-</div>
                          <div style={{ width: '25%', padding: '6px 12px', color: '#ccc', fontSize: 11 }}>-</div>
                          <div style={{ width: '25%', padding: '6px 12px', color: '#ccc', fontSize: 11 }}>-</div>
                        </div>
                      ) : (
                        Object.keys(group.companies).sort().map((orgName) => {
                          const company = group.companies[orgName];
                          return (
                            <div key={orgName} style={{ display: 'flex', borderBottom: '1px solid #f0f0f0' }}>
                              <div style={{ width: '25%', padding: '6px 12px', paddingLeft: 40, fontSize: 11, fontWeight: 500, color: '#333', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                                  <span>{renderOrganizationWithTag(orgName)}</span>
                                </div>
                                {!isReadOnly && (
                                  <Tooltip title="手动修改公司分类">
                                    <Button
                                      type="text"
                                      size="small"
                                      icon={<EditOutlined style={{ fontSize: 10, color: '#bfbfbf' }} />}
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        handleOpenEditIndustryModal(orgName, industry);
                                      }}
                                      style={{ padding: '0 4px', height: 20 }}
                                      className="industry-delete-btn"
                                    />
                                  </Tooltip>
                                )}
                              </div>
                              <div style={{ width: '25%', padding: '6px 12px' }}>
                                {company.management.length === 0 ? <span style={{ color: '#ccc' }}>-</span> : (
                                  company.management.map(item => {
                                    const eventDate = (item as any).eventDate;
                                    const dateStr = eventDate && eventDate !== '\u672A\u63D0\u53CA' ? eventDate : new Date(item.createdAt).toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' }).replace(/\//g, '/');
                                    return (
                                      <div key={item.id} onClick={() => handleNoteClick(item)} className="note-link-hover" style={{ padding: '2px 0', cursor: 'pointer', color: '#666', fontSize: 10 }}>
                                        {'\u2022'} {item.topic || '\u672A\u63D0\u53D6'} <span style={{ color: '#999', fontSize: 9 }}>({dateStr})</span>
                                      </div>
                                    );
                                  })
                                )}
                              </div>
                              <div style={{ width: '25%', padding: '6px 12px' }}>
                                {company.expert.length === 0 ? <span style={{ color: '#ccc' }}>-</span> : (
                                  company.expert.map(item => {
                                    const eventDate = (item as any).eventDate;
                                    const dateStr = eventDate && eventDate !== '\u672A\u63D0\u53CA' ? eventDate : new Date(item.createdAt).toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' }).replace(/\//g, '/');
                                    return (
                                      <div key={item.id} onClick={() => handleNoteClick(item)} className="note-link-hover" style={{ padding: '2px 0', cursor: 'pointer', color: '#666', fontSize: 10 }}>
                                        {'\u2022'} {item.topic || '\u672A\u63D0\u53D6'} <span style={{ color: '#999', fontSize: 9 }}>({dateStr})</span>
                                      </div>
                                    );
                                  })
                                )}
                              </div>
                              <div style={{ width: '25%', padding: '6px 12px' }}>
                                {company.sellside.length === 0 ? <span style={{ color: '#ccc' }}>-</span> : (
                                  company.sellside.map(item => {
                                    const eventDate = (item as any).eventDate;
                                    const dateStr = eventDate && eventDate !== '\u672A\u63D0\u53CA' ? eventDate : new Date(item.createdAt).toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' }).replace(/\//g, '/');
                                    return (
                                      <div key={item.id} onClick={() => handleNoteClick(item)} className="note-link-hover" style={{ padding: '2px 0', cursor: 'pointer', color: '#666', fontSize: 10 }}>
                                        {'\u2022'} {item.topic || '\u672A\u63D0\u53D6'} <span style={{ color: '#999', fontSize: 9 }}>({dateStr})</span>
                                      </div>
                                    );
                                  })
                                )}
                              </div>
                            </div>
                          );
                        })
                      )}
                    </div>

                    {/* 右侧行业区域 40% - 独立整体，不分行 */}
                    <div style={{ flex: '1 1 40%', display: 'flex' }}>
                      <div style={{ width: '50%', padding: '6px 12px' }}>
                        {group.industry.expert.length === 0 ? <span style={{ color: '#ccc' }}>-</span> : (
                          group.industry.expert.map(item => {
                            const eventDate = (item as any).eventDate;
                            const dateStr = eventDate && eventDate !== '\u672A\u63D0\u53CA' ? eventDate : new Date(item.createdAt).toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' }).replace(/\//g, '/');
                            return (
                              <div key={item.id} onClick={() => handleNoteClick(item)} className="note-link-hover" style={{ padding: '2px 0', cursor: 'pointer', color: '#666', fontSize: 10 }}>
                                {'\u2022'} {item.topic || '\u672A\u63D0\u53D6'} <span style={{ color: '#999', fontSize: 9 }}>({dateStr})</span>
                              </div>
                            );
                          })
                        )}
                      </div>
                      <div style={{ width: '50%', padding: '6px 12px' }}>
                        {group.industry.sellside.length === 0 ? <span style={{ color: '#ccc' }}>-</span> : (
                          group.industry.sellside.map(item => {
                            const eventDate = (item as any).eventDate;
                            const dateStr = eventDate && eventDate !== '\u672A\u63D0\u53CA' ? eventDate : new Date(item.createdAt).toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' }).replace(/\//g, '/');
                            return (
                              <div key={item.id} onClick={() => handleNoteClick(item)} className="note-link-hover" style={{ padding: '2px 0', cursor: 'pointer', color: '#666', fontSize: 10 }}>
                                {'\u2022'} {item.topic || '\u672A\u63D0\u53D6'} <span style={{ color: '#999', fontSize: 9 }}>({dateStr})</span>
                              </div>
                            );
                          })
                        )}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
              </div>
            );
          })}

          {/* 添加行业 */}
          {!isReadOnly && (
            <div style={{
              padding: '4px 12px',
              display: 'flex',
              alignItems: 'center',
              gap: 6,
            }}>
              <Input
                value={newIndustry}
                onChange={(e) => setNewIndustry(e.target.value)}
                onPressEnter={handleAddIndustry}
                placeholder="添加新行业..."
                style={{ width: 160, borderRadius: 3, fontSize: 11 }}
                size="small"
              />
              <Button
                type="primary"
                size="small"
                icon={<PlusOutlined />}
                onClick={handleAddIndustry}
                loading={addingIndustry}
                style={{ borderRadius: 3, fontSize: 11 }}
              >
                添加
              </Button>
            </div>
          )}
        </div>
      )}

      {/* 未归类的 Notes */}
      {uncategorizedNotes.length > 0 && (() => {
        const isUncategorizedExpanded = expandedIndustries.has('__uncategorized__');
        return (
          <div style={{
            marginTop: 6,
            background: '#fff',
            borderRadius: 4,
            border: '1px solid #e8e8e8',
          }}>
            <div
              onClick={() => toggleIndustryExpand('__uncategorized__')}
              style={{
                padding: '8px 12px',
                borderBottom: isUncategorizedExpanded ? '1px solid #f0f0f0' : 'none',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                cursor: 'pointer',
                userSelect: 'none',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  width: 10,
                  height: 10,
                }}>
                  <span style={{
                    display: 'inline-block',
                    width: 0,
                    height: 0,
                    borderStyle: 'solid',
                    ...(isUncategorizedExpanded
                      ? { borderWidth: '5px 4px 0 4px', borderColor: '#999 transparent transparent transparent' }
                      : { borderWidth: '4px 0 4px 5px', borderColor: 'transparent transparent transparent #333' }
                    ),
                  }} />
                </span>
                <span style={{ fontSize: 12, fontWeight: 600, color: '#999' }}>未归类</span>
              </div>
              <span style={{ fontSize: 10, color: '#999' }}>
                {uncategorizedNotes.length} 条
              </span>
            </div>
            {isUncategorizedExpanded && (
              <div style={{ padding: '8px 12px' }}>
                {uncategorizedNotes.map(item => {
                  const eventDate = (item as any).eventDate;
                  const dateStr = eventDate && eventDate !== '未提及'
                    ? eventDate
                    : new Date(item.createdAt).toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' }).replace(/\//g, '/');
                  return (
                    <div
                      key={item.id}
                      className="note-link-hover"
                      onClick={() => handleNoteClick(item)}
                      style={{
                        padding: '3px 0',
                        cursor: 'pointer',
                        fontSize: 11,
                        color: '#666',
                      }}
                    >
                      • {item.fileName || item.topic || '未命名'} <span style={{ color: '#999', fontSize: 10 }}>({dateStr})</span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })()}

      {/* AI重分类预览弹窗 */}
      <Modal
        title={
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span>AI 重分类方案预览</span>
            {reclassifyPreview && (
              <Tag color="blue" style={{ fontSize: 11 }}>
                {reclassifyPreview.summary.changed} 条将变更 / {reclassifyPreview.summary.total} 条总计
              </Tag>
            )}
          </div>
        }
        open={reclassifyPreviewVisible}
        onCancel={() => { setReclassifyPreviewVisible(false); setReclassifyPreview(null); }}
        width={900}
        footer={[
          <Button key="cancel" onClick={() => { setReclassifyPreviewVisible(false); setReclassifyPreview(null); }}>
            取消
          </Button>,
          <Button
            key="confirm"
            type="primary"
            icon={<CheckOutlined />}
            loading={reclassifying}
            onClick={handleReclassifyConfirm}
            disabled={!reclassifyPreview || reclassifyPreview.summary.changed === 0}
          >
            确认执行 ({reclassifyPreview?.summary.changed || 0} 条变更)
          </Button>,
        ]}
      >
        {reclassifyPreview && (
          <div>
            {/* 统计摘要 */}
            <div style={{ marginBottom: 16, padding: 12, background: '#f6f8fa', borderRadius: 6, display: 'flex', gap: 24, fontSize: 12 }}>
              <span>总计: <strong>{reclassifyPreview.summary.total}</strong></span>
              <span>保持不变: <strong>{reclassifyPreview.summary.kept}</strong></span>
              <span>直接映射: <strong style={{ color: '#1890ff' }}>{reclassifyPreview.summary.mapped}</strong></span>
              <span>Portfolio匹配: <strong style={{ color: '#13c2c2' }}>{reclassifyPreview.summary.portfolioMatched || 0}</strong></span>
              <span>AI分类: <strong style={{ color: '#722ed1' }}>{reclassifyPreview.summary.geminiClassified}</strong></span>
              <span>将变更: <strong style={{ color: '#f5222d' }}>{reclassifyPreview.summary.changed}</strong></span>
            </div>
            {/* 变更列表 */}
            <Table
              dataSource={reclassifyPreview.details.filter(d => d.oldIndustry !== d.newIndustry)}
              rowKey="id"
              size="small"
              pagination={{ pageSize: 15, size: 'small' }}
              scroll={{ y: 400 }}
              columns={[
                {
                  title: '笔记',
                  dataIndex: 'fileName',
                  key: 'fileName',
                  width: '35%',
                  ellipsis: true,
                  render: (text: string) => <span style={{ fontSize: 11 }}>{text}</span>,
                },
                {
                  title: '原行业',
                  dataIndex: 'oldIndustry',
                  key: 'oldIndustry',
                  width: '20%',
                  render: (text: string | null) => (
                    <Tag color="default" style={{ fontSize: 10 }}>{text || '无'}</Tag>
                  ),
                },
                {
                  title: '',
                  key: 'arrow',
                  width: '5%',
                  render: () => <ArrowRightOutlined style={{ color: '#1890ff', fontSize: 10 }} />,
                },
                {
                  title: '新行业',
                  dataIndex: 'newIndustry',
                  key: 'newIndustry',
                  width: '20%',
                  render: (text: string) => (
                    <Tag color="blue" style={{ fontSize: 10 }}>{text}</Tag>
                  ),
                },
                {
                  title: '方式',
                  dataIndex: 'method',
                  key: 'method',
                  width: '20%',
                  render: (method: string) => {
                    const config: Record<string, { color: string; label: string }> = {
                      keep: { color: 'green', label: '保持' },
                      mapping: { color: 'blue', label: '映射' },
                      portfolio: { color: 'cyan', label: 'Portfolio' },
                      gemini: { color: 'purple', label: 'AI分类' },
                    };
                    const c = config[method] || { color: 'default', label: method };
                    return <Tag color={c.color} style={{ fontSize: 10 }}>{c.label}</Tag>;
                  },
                },
              ]}
            />
          </div>
        )}
      </Modal>

      {/* 笔记预览弹窗 */}
      <Modal
        title={previewNote?.topic || "\u7B14\u8BB0\u8BE6\u60C5"}
        open={previewVisible}
        onCancel={() => setPreviewVisible(false)}
        footer={[
          // 只读模式下不显示"查看详情"按钮
          ...(!isReadOnly ? [
            <Button key="detail" type="primary" onClick={() => {
              setPreviewVisible(false);
              if (previewNote) navigate(`/transcription/${previewNote.id}`);
            }}>
              查看详情
            </Button>
          ] : []),
          <Button key="close" onClick={() => setPreviewVisible(false)}>
            关闭
          </Button>,
        ]}
        width={1200}
      >
        {previewNote && (
          <div>
            <div style={{ marginBottom: 16, padding: "12px", background: "#f5f5f5", borderRadius: 4 }}>
              <Space size={16} wrap>
                <span><strong>{"\u516C\u53F8"}:</strong> {(previewNote as any).organization || "\u672A\u77E5"}</span>
                <span><strong>{"\u884C\u4E1A"}:</strong> {(previewNote as any).industry || "\u672A\u77E5"}</span>
                <span><strong>{"\u56FD\u5BB6"}:</strong> {(previewNote as any).country || "\u672A\u77E5"}</span>
                <span><strong>{"\u53C2\u4E0E\u4EBA"}:</strong> {previewNote.participants || "\u672A\u77E5"}</span>
                <span><strong>{"\u4E2D\u4ECB"}:</strong> {(previewNote as any).intermediary || "\u672A\u77E5"}</span>
                <span><strong>{"\u65E5\u671F"}:</strong> {(previewNote as any).eventDate || "\u672A\u63D0\u53CA"}</span>
              </Space>
            </div>
            <div>
              <h4 style={{ marginBottom: 8 }}>Notes</h4>
              <div style={{ background: "#fafafa", borderRadius: 4, maxHeight: 600, overflow: "auto", padding: '16px' }}>
                <MarkdownViewer
                  content={
                    (previewNote.summary || "\u6682\u65E0\u603B\u7ED3") +
                    ((previewNote as any).translatedSummary ?
                      "<hr style='margin: 24px 0; border: none; border-top: 1px solid #e8e8e8;'/><h3>Notes\uFF08\u4E2D\u6587\uFF09</h3>" + (previewNote as any).translatedSummary
                      : "")
                  }
                />
              </div>
            </div>
          </div>
        )}
      </Modal>

      {/* 规范化预览弹窗 */}
      <Modal
        title="公司名称合并预览 (审查)"
        open={normalizePreviewVisible}
        onCancel={() => setNormalizePreviewVisible(false)}
        width={800}
        footer={[
          <Button key="cancel" onClick={() => setNormalizePreviewVisible(false)}>
            取消
          </Button>,
          <Button 
            key="submit" 
            type="primary" 
            loading={confirmingNormalize} 
            onClick={handleConfirmNormalize}
            disabled={selectedNormalizeKeys.length === 0}
          >
            应用选中合并 ({selectedNormalizeKeys.length})
          </Button>,
        ]}
      >
        <div style={{ marginBottom: 16, color: '#666' }}>
          以下是AI和大字典建议的组织名称合并（自动补充了 Bloomberg Ticker）。如果发现错误的映射（例如毫不相关的公司被合并），请<b>取消勾选</b>。
        </div>
        <Table
          size="small"
          dataSource={normalizePreview}
          rowKey="old"
          pagination={false}
          scroll={{ y: 400 }}
          rowSelection={{
            selectedRowKeys: selectedNormalizeKeys,
            onChange: (newSelectedRowKeys) => {
              setSelectedNormalizeKeys(newSelectedRowKeys);
            },
          }}
          columns={[
            {
              title: '原名称 (散装)',
              dataIndex: 'old',
              width: '35%',
            },
            {
              title: '操作',
              key: 'arrow',
              width: 50,
              render: () => <ArrowRightOutlined style={{ color: '#bfbfbf' }} />
            },
            {
              title: '目标名称 (规范大类)',
              dataIndex: 'new',
              width: '35%',
              render: (newOrg: string, record: any) => (
                <span style={{ fontWeight: 'bold', color: record.method === 'portfolio' ? '#52c41a' : '#1677ff' }}>
                  {renderOrganizationWithTag(newOrg)}
                </span>
              )
            },
            {
              title: '模式',
              dataIndex: 'method',
              width: 80,
              render: (method: string) => (
                <Tag color={method === 'portfolio' ? 'green' : 'blue'}>
                  {method === 'portfolio' ? '高确信匹配' : '大模型聚类'}
                </Tag>
              )
            },
            {
              title: '影响篇数',
              dataIndex: 'count',
              width: 80,
              render: (count: number) => <Tag>{count} 篇</Tag>
            }
          ]}
        />
      </Modal>

      {/* 手动修改行业弹窗 */}
      <Modal
        title={`修改公司信息 - ${editingOrgName}`}
        open={editIndustryModalVisible}
        onOk={handleSaveIndustry}
        onCancel={() => setEditIndustryModalVisible(false)}
        confirmLoading={savingIndustry}
        width={400}
        okText="确认修改"
        cancelText="取消"
      >
        <div style={{ marginBottom: 12 }}>
          <span>当前行业分类: </span>
          <Tag color="blue">{getIndustrySuperCategory(editingCurrentIndustry)} - {editingCurrentIndustry}</Tag>
        </div>
        <div style={{ marginBottom: 16 }}>
          <div style={{ marginBottom: 8 }}>更改公司名称为:</div>
          <Input 
            value={editingNewOrgName} 
            onChange={(e) => setEditingNewOrgName(e.target.value)} 
            placeholder="如果公司名字出错了可以改一下"
          />
        </div>
        <div>
          <div style={{ marginBottom: 8 }}>更改小分类为:</div>
          <Select
            value={editingNewIndustry}
            onChange={setEditingNewIndustry}
            style={{ width: '100%' }}
            showSearch
          >
            {industries.map(ind => (
              <Option key={ind} value={ind}>{getIndustrySuperCategory(ind)} - {ind}</Option>
            ))}
          </Select>
        </div>
      </Modal>

    </div>
  );
};

export default OrganizationPage;

