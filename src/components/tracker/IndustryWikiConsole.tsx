import { memo, useEffect, useState, useMemo, useRef } from 'react';
import { useIndustryWikiStore } from '../../stores/industryWikiStore.ts';
import { FileText, Plus, Search, Sparkles, AlertTriangle, CheckSquare, Clock, Settings, ChevronRight, ChevronDown, History, Eye, Trash2, Tag } from 'lucide-react';
import { marked } from 'marked';
import { notesApi, wikiGenerationLogApi } from '../../db/apiClient.ts';
import { ingestSourcesToWiki, ingestSourcesToWikiMultiScope, queryWiki, lintWiki } from '../../services/wikiAiService.ts';
import { getApiConfig, DEFAULT_WIKI_USER_PROMPT, DEFAULT_WIKI_PAGE_TYPES, WIKI_SYSTEM_RULES, DEFAULT_MULTI_SCOPE_RULES, DEFAULT_LINT_DIMENSIONS } from '../../aiprocess/components/ApiConfigModal.tsx';
import { Modal, Form, Input } from 'antd';

// Configure marked for wiki rendering — GFM tables + raw HTML passthrough
marked.setOptions({ gfm: true, breaks: false });

interface IndustryWikiConsoleProps {
  industryCategory: string; // The active subCategoryName passed from TrackerView
  workspaceIds?: string[];
  entityNames?: string[]; // Company names for multi-scope ingest
}

export const IndustryWikiConsole = memo(function IndustryWikiConsole({ industryCategory, workspaceIds = [], entityNames = [] }: IndustryWikiConsoleProps) {
  const loadWikiData = useIndustryWikiStore(s => s.loadWikiData);
  const addArticle = useIndustryWikiStore(s => s.addArticle);
  const updateArticle = useIndustryWikiStore(s => s.updateArticle);
  const deleteArticle = useIndustryWikiStore(s => s.deleteArticle);
  const clearCategoryArticles = useIndustryWikiStore(s => s.clearCategoryArticles);
  const logAction = useIndustryWikiStore(s => s.logAction);
  
  const allArticles = useIndustryWikiStore(s => s.articles);
  const allActions = useIndustryWikiStore(s => s.actions);

  const [selectedArticleId, setSelectedArticleId] = useState<string | null>(null);
  const [isIngesting, setIsIngesting] = useState(false);
  const [ingestProgress, setIngestProgress] = useState('');
  const [ingestCurrent, setIngestCurrent] = useState(0);
  const [ingestTotal, setIngestTotal] = useState(0);
  const ingestAbortRef = useRef(false);
  const ingestAbortControllerRef = useRef<AbortController | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [editContent, setEditContent] = useState('');
  const [editTitle, setEditTitle] = useState('');
  const [filterViews, setFilterViews] = useState<string[]>(['All']);
  const markdownContainerRef = useRef<HTMLDivElement>(null);
  
  // View Date Filter states
  const [viewDateFrom, setViewDateFrom] = useState('');
  const [viewDateTo, setViewDateTo] = useState('');
  
  // Wiki Settings Modal
  const [showWikiSettings, setShowWikiSettings] = useState(false);
  const wikiPageTypes = useIndustryWikiStore(s => s.wikiPageTypes);
  const setWikiPageTypes = useIndustryWikiStore(s => s.setWikiPageTypes);
  const setIndustryConfig = useIndustryWikiStore(s => s.setIndustryConfig);
  const getIndustryConfig = useIndustryWikiStore(s => s.getIndustryConfig);
  const [localPageTypes, setLocalPageTypes] = useState(wikiPageTypes || DEFAULT_WIKI_PAGE_TYPES);
  const [localIngestPrompt, setLocalIngestPrompt] = useState(() => getApiConfig().wikiIngestPrompt || DEFAULT_WIKI_USER_PROMPT);
  const [localCustomInstructions, setLocalCustomInstructions] = useState('');
  const wikiMultiScopeRules = useIndustryWikiStore(s => s.wikiMultiScopeRules);
  const setWikiMultiScopeRules = useIndustryWikiStore(s => s.setWikiMultiScopeRules);
  const wikiLintDimensions = useIndustryWikiStore(s => s.wikiLintDimensions);
  const setWikiLintDimensions = useIndustryWikiStore(s => s.setWikiLintDimensions);
  const [localMultiScopeRules, setLocalMultiScopeRules] = useState(wikiMultiScopeRules || DEFAULT_MULTI_SCOPE_RULES);
  const [localLintDimensions, setLocalLintDimensions] = useState(wikiLintDimensions || DEFAULT_LINT_DIMENSIONS);

  // Generation History states
  const [rightTab, setRightTab] = useState<'log' | 'history'>('log');
  const [genLogs, setGenLogs] = useState<any[]>([]);
  const [genLogDetail, setGenLogDetail] = useState<any>(null);
  const [genLogLoading, setGenLogLoading] = useState(false);

  // Ingest Config states
  const [showIngestModal, setShowIngestModal] = useState(false);
  const [ingestDateFrom, setIngestDateFrom] = useState('');
  const [ingestDateTo, setIngestDateTo] = useState('');

  const toggleFilter = (type: string) => {
    if (type === 'All') {
      setFilterViews(['All']);
    } else {
      setFilterViews(prev => {
        let next = prev.filter(v => v !== 'All');
        if (next.includes(type)) {
          next = next.filter(v => v !== type);
        } else {
          next.push(type);
        }
        return next.length === 0 ? ['All'] : next;
      });
    }
  };

  // Filter articles — at industry level, include all sub-scopes (company wikis) too
  const isIndustryLevel = !industryCategory.includes('::');
  const articles = (isIndustryLevel
    ? allArticles.filter(a => a.industryCategory === industryCategory || a.industryCategory.startsWith(industryCategory + '::'))
    : allArticles.filter(a => a.industryCategory === industryCategory)
  ).sort((a, b) => b.updatedAt - a.updatedAt);
  const actions = allActions.filter(a =>
    isIndustryLevel
      ? (a.industryCategory === industryCategory || a.industryCategory.startsWith(industryCategory + '::'))
      : a.industryCategory === industryCategory
  ).slice(0, 20);
  const selectedArticle = articles.find(a => a.id === selectedArticleId);

  // Group articles by scope for the collapsible index (industry level only)
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set([industryCategory]));
  const toggleGroup = (scope: string) => {
    setExpandedGroups(prev => {
      const next = new Set(prev);
      if (next.has(scope)) next.delete(scope); else next.add(scope);
      return next;
    });
  };

  const groupedArticles = useMemo(() => {
    if (!isIndustryLevel) return null;
    const groups: { scope: string; label: string; articles: typeof articles }[] = [];
    // Industry group
    const industryArts = articles.filter(a => a.industryCategory === industryCategory);
    if (industryArts.length > 0) {
      groups.push({ scope: industryCategory, label: '行业趋势与对比', articles: industryArts });
    }
    // Company groups
    const companyScopes = new Map<string, typeof articles>();
    articles.filter(a => a.industryCategory.startsWith(industryCategory + '::')).forEach(a => {
      const list = companyScopes.get(a.industryCategory) || [];
      list.push(a);
      companyScopes.set(a.industryCategory, list);
    });
    // Sort company groups alphabetically
    Array.from(companyScopes.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .forEach(([scope, arts]) => {
        const companyName = scope.split('::')[1] || scope;
        groups.push({ scope, label: companyName, articles: arts });
      });
    return groups;
  }, [articles, industryCategory, isIndustryLevel]);

  useEffect(() => {
    // DOM Filter for Dates
    if (!markdownContainerRef.current) return;
    const container = markdownContainerRef.current;
    
    // First, clear any inline display styles
    const elements = container.querySelectorAll('p, li');
    elements.forEach((el: Element) => {
       (el as HTMLElement).style.display = '';
    });

    if (viewDateFrom || viewDateTo) {
      // Input values correspond to YYYY-MM
      // The tags in markdown are 'YY/MM
      const fromYm = viewDateFrom || '0000-00';
      const toYm = viewDateTo || '9999-12';
      
      elements.forEach((el: Element) => {
         const spans = el.querySelectorAll('span[class*="bg-"]');
         if (spans.length === 0) return; // if no span, let CSS :has() handle it
         
         let hasValidDate = false;
         spans.forEach((span: Element) => {
            const match = span.textContent?.match(/'(\d{2})\/(\d{2})/);
            if (match) {
               const yearStr = '20' + match[1]; // Assuming 2000s
               const monthStr = match[2];
               const spanYm = `${yearStr}-${monthStr}`;
               
               if (spanYm >= fromYm && spanYm <= toYm) {
                 hasValidDate = true;
               }
            }
         });
         
         // Only hide explicitly if it DOES have tags but none match the date filter
         // Thus overriding the display:block!important from `:has` rule
         if (!hasValidDate) {
            (el as HTMLElement).style.display = 'none';
         }
      });
    }
  }, [selectedArticle?.content, viewDateFrom, viewDateTo, filterViews]);

  useEffect(() => {
    loadWikiData();
  }, [loadWikiData]);

  useEffect(() => {
    if (selectedArticleId && !articles.find(a => a.id === selectedArticleId)) {
      setSelectedArticleId(null);
    }
  }, [articles, selectedArticleId]);

  const handleOpenIngest = () => setShowIngestModal(true);

  const confirmIngest = async () => {
    setShowIngestModal(false);
    setIsIngesting(true);
    setIngestProgress('正在加载笔记...');
    setIngestCurrent(0);
    setIngestTotal(0);
    ingestAbortRef.current = false;
    const abortController = new AbortController();
    ingestAbortControllerRef.current = abortController;
    try {
      // 1. Fetch raw sources using notes API for the passed workspaces
      // Inject date settings
      const res = await notesApi.query(workspaceIds, undefined, ingestDateFrom || undefined, ingestDateTo || undefined);
      if (!res.success || !res.notes || res.notes.length === 0) {
        alert('该行业（特定时间段内）暂时没有找到任何原始笔记作为情报来源。');
        setIsIngesting(false);
        return;
      }
      
      // Embed timestamps and all custom metadata so the AI can perceive context correctly
      const sourceTexts = res.notes.map(n => {
        const timestampIndicator = n.date ? `Date: ${n.date}` : `Date: Unknown (Assume current)`;
        // If the backend passes metadata (e.g. from Canvas notes), inject it dynamically
        const metadataString = n.metadata && Object.keys(n.metadata).length > 0
          ? `Metadata: ${JSON.stringify(n.metadata)}`
          : '';
        return `Title: ${n.title}\n${timestampIndicator}\n${metadataString}\nContent: ${n.content}`;
      });
      
      setIngestTotal(sourceTexts.length);
      setIngestProgress(`已加载 ${sourceTexts.length} 条笔记，开始逐条提取...`);
      const { wikiModel, wikiIngestPrompt } = getApiConfig();
      const wikiPageTypes = useIndustryWikiStore.getState().wikiPageTypes;
      const industryConfig = useIndustryWikiStore.getState().getIndustryConfig(industryCategory);

      let lastId: string | null = null;
      // Track actions that actually got applied to the wiki (not just LLM proposals)
      const appliedActions: Array<{ title: string; content: string; action: 'create' | 'update'; scope: string }> = [];
      const onSourceCompleteCb = (actions: any[], sourceIdx: number, totalSources: number) => {
        setIngestCurrent(sourceIdx + 1);
        setIngestProgress(`正在处理第 ${sourceIdx + 1}/${totalSources} 条笔记...`);
        for (const action of actions) {
          const targetScope = action.scope || industryCategory;
          const currentArticles = useIndustryWikiStore.getState().articles;

          if (action.type === 'create') {
            // Check if article with same title+scope already exists → treat as update instead
            const existing = currentArticles.find(a =>
              a.industryCategory === targetScope && a.title === action.title
            );
            if (existing) {
              updateArticle(existing.id, action.content, action.title, action.indexSummary || undefined);
              logAction(targetScope, 'update', action.title, action.description);
              lastId = existing.id;
              appliedActions.push({ title: action.title, content: action.content, action: 'update', scope: targetScope });
            } else {
              lastId = addArticle(targetScope, action.title, action.content, [], action.indexSummary || '');
              logAction(targetScope, 'create', action.title, action.description);
              appliedActions.push({ title: action.title, content: action.content, action: 'create', scope: targetScope });
            }
          } else if (action.type === 'update') {
            // Try resolve by id first, then by title+scope, else fall back to create
            let target = action.articleId ? currentArticles.find(a => a.id === action.articleId) : undefined;
            if (!target) {
              target = currentArticles.find(a =>
                a.industryCategory === targetScope && a.title === action.title
              );
            }
            if (target) {
              updateArticle(target.id, action.content, action.title, action.indexSummary || undefined);
              logAction(targetScope, 'update', action.title, action.description);
              lastId = target.id;
              appliedActions.push({ title: action.title, content: action.content, action: 'update', scope: targetScope });
            } else {
              // No match by id or title — fallback to create so data isn't lost
              lastId = addArticle(targetScope, action.title, action.content, [], action.indexSummary || '');
              logAction(targetScope, 'create', action.title, `${action.description} (由 update 降级为 create)`);
              appliedActions.push({ title: action.title, content: action.content, action: 'create', scope: targetScope });
            }
          }
        }
        return useIndustryWikiStore.getState().articles;
      };

      let aiResult;
      if (isIndustryLevel && entityNames.length > 0) {
        // Multi-scope ingest: auto-classify into industry + company wikis
        const allScopeArticles = allArticles.filter(a =>
          a.industryCategory === industryCategory ||
          a.industryCategory.startsWith(industryCategory + '::')
        );
        aiResult = await ingestSourcesToWikiMultiScope(
          industryCategory, entityNames, allScopeArticles, sourceTexts, wikiModel, wikiIngestPrompt,
          onSourceCompleteCb, allActions, wikiPageTypes,
          () => ingestAbortRef.current, abortController.signal,
          industryConfig.customInstructions,
          useIndustryWikiStore.getState().wikiMultiScopeRules || undefined
        );
      } else {
        // Single-scope ingest (company-level or no entities)
        const scopeArticles = allArticles.filter(a => a.industryCategory === industryCategory);
        aiResult = await ingestSourcesToWiki(
          industryCategory, scopeArticles, sourceTexts, wikiModel, wikiIngestPrompt,
          onSourceCompleteCb, allActions, wikiPageTypes,
          () => ingestAbortRef.current, abortController.signal,
          industryConfig.customInstructions
        );
      }

      if (ingestAbortRef.current) {
         if (aiResult && aiResult.actions.length > 0 && lastId) {
           setSelectedArticleId(lastId);
         }
         logAction(industryCategory, 'update', '用户暂停', `手动暂停，已处理 ${ingestCurrent}/${ingestTotal} 条笔记`);
      } else if (!aiResult || aiResult.actions.length === 0) {
         logAction(industryCategory, 'update', '无信息更新', 'AI 扫描了新情报但发现没有有效的新知识可以并入 Wiki。');
         alert('大模型跑完了，不过当前的笔记内容已经包含在已知情报里了，没有新改动。');
      } else {
         if (lastId) setSelectedArticleId(lastId);
      }

      // Save generation history log for experiment tracking
      // Use appliedActions (what actually landed in wiki) instead of raw LLM output,
      // so history reflects real results for cross-model comparison.
      if (appliedActions.length > 0) {
        const sourceTitles = res.notes.map((n: any) => n.title).slice(0, 20).join(', ');
        saveGenLog({
          industryCategory,
          model: wikiModel,
          promptTemplate: wikiIngestPrompt || DEFAULT_WIKI_USER_PROMPT,
          pageTypes: wikiPageTypes || DEFAULT_WIKI_PAGE_TYPES,
          sourceCount: sourceTexts.length,
          sourceSummary: sourceTitles,
          generatedArticles: appliedActions,
        });
      }
    } catch (e: any) {
      alert(`智能解析情报失败: ${e.message}`);
    } finally {
      setIsIngesting(false);
      setIngestProgress('');
      setIngestCurrent(0);
      setIngestTotal(0);
      ingestAbortRef.current = false;
      ingestAbortControllerRef.current = null;
    }
  };

  const handleQuery = async () => {
    const q = window.prompt(`基于当前 ${industryCategory} 的专属 Wiki，向大模型提问：`, "");
    if (!q) return;
    try {
      // Show loading state by creating a temp article or just blocking
      const tempId = addArticle(industryCategory, `🗨️ 问答: ${q}`, "AI 正在思考中，耐心等待...");
      setSelectedArticleId(tempId);
      
      const { wikiModel } = getApiConfig();
      const answer = await queryWiki(industryCategory, articles, q, wikiModel);
      
      updateArticle(tempId, answer);
      logAction(industryCategory, 'create', `🗨️ 问答: ${q}`, '用户执行了 AI 知识库专属提问');
    } catch (e: any) {
      alert(`查询失败: ${e.message}`);
    }
  };

  const handleLinting = async () => {
    if (articles.length === 0) {
      alert("当前没有可进行一致性检查的 Wiki 页面内容。");
      return;
    }
    
    try {
      const tempId = addArticle(industryCategory, `🔍 一致性审查报告`, "AI 正在全库巡检中，可能需要一点时间...");
      setSelectedArticleId(tempId);
      
      const { wikiModel } = getApiConfig();
      const report = await lintWiki(industryCategory, articles, wikiModel, useIndustryWikiStore.getState().wikiLintDimensions || undefined);
      
      updateArticle(tempId, report);
      logAction(industryCategory, 'create', `🔍 一致性审查报告`, '执行了全库 Wiki 内容一致性和孤立知识扫描');
    } catch (e: any) {
      alert(`审查失败: ${e.message}`);
    }
  };

  const handleCreateMock = () => {
    const newId = addArticle(industryCategory, `新建条目`, `# 标题\n\n内容`);
    setSelectedArticleId(newId);
    setIsEditing(true);
    setEditContent(`# 标题\n\n内容`);
  };

  // Promote a query result (🗨️) or lint report (🔍) into a proper wiki article
  const handlePromoteToWiki = () => {
    if (!selectedArticle) return;
    const newTitle = selectedArticle.title
      .replace(/^🗨️\s*问答:\s*/, '')
      .replace(/^🔍\s*一致性审查报告\s*/, '');
    const promptTitle = window.prompt('输入正式文章标题（可加页面类型前缀如 [趋势]）：', newTitle);
    if (!promptTitle) return;
    updateArticle(selectedArticle.id, selectedArticle.content, promptTitle);
    logAction(industryCategory, 'update', promptTitle, '从问答结果收录为正式 Wiki 文章');
  };

  const handleSave = () => {
    if (selectedArticleId && selectedArticle) {
      updateArticle(selectedArticleId, editContent, editTitle);
      logAction(industryCategory, 'update', editTitle, '用户通过编辑器手动修改');
      setIsEditing(false);
    }
  };

  const handleOpenWikiSettings = () => {
    setLocalPageTypes(wikiPageTypes || DEFAULT_WIKI_PAGE_TYPES);
    setLocalIngestPrompt(getApiConfig().wikiIngestPrompt || DEFAULT_WIKI_USER_PROMPT);
    setLocalCustomInstructions(getIndustryConfig(industryCategory).customInstructions || '');
    setLocalMultiScopeRules(wikiMultiScopeRules || DEFAULT_MULTI_SCOPE_RULES);
    setLocalLintDimensions(wikiLintDimensions || DEFAULT_LINT_DIMENSIONS);
    setShowWikiSettings(true);
  };
  const handleSaveWikiSettings = () => {
    setWikiPageTypes(localPageTypes);
    setIndustryConfig(industryCategory, { customInstructions: localCustomInstructions });
    setWikiMultiScopeRules(localMultiScopeRules);
    setWikiLintDimensions(localLintDimensions);
    // Save ingest prompt to localStorage (part of apiConfig)
    const config = getApiConfig();
    config.wikiIngestPrompt = localIngestPrompt;
    localStorage.setItem('apiConfig', JSON.stringify(config));
    setShowWikiSettings(false);
  };

  // Generation History helpers — localStorage-first with API sync as bonus
  const GEN_LOG_STORAGE_KEY = 'rc_wiki_gen_logs';

  const readLocalGenLogs = (): any[] => {
    try {
      return JSON.parse(localStorage.getItem(GEN_LOG_STORAGE_KEY) || '[]');
    } catch { return []; }
  };

  const writeLocalGenLogs = (logs: any[]) => {
    localStorage.setItem(GEN_LOG_STORAGE_KEY, JSON.stringify(logs.slice(0, 100)));
  };

  const saveGenLog = (log: any) => {
    const id = `gl_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const entry = { ...log, id, createdAt: Date.now() };
    const logs = [entry, ...readLocalGenLogs()];
    writeLocalGenLogs(logs);
    setGenLogs(logs);
    // Persist to cloud (best-effort) — send full entry with id
    wikiGenerationLogApi.create(entry).catch((err) => {
      console.warn('Wiki generation log cloud save failed:', err);
    });
  };

  const loadGenLogs = () => {
    setGenLogLoading(true);
    const local = readLocalGenLogs();
    setGenLogs(local);
    setGenLogLoading(false);
    // Merge cloud logs into local — cloud is source of truth
    wikiGenerationLogApi.list(undefined, 100).then(res => {
      if (res.success && res.data?.length > 0) {
        // Deduplicate by id
        const idMap = new Map<string, any>();
        // Cloud entries take priority
        for (const entry of res.data) {
          if (entry.id) idMap.set(entry.id, entry);
        }
        // Local entries fill in anything cloud doesn't have
        for (const entry of local) {
          if (entry.id && !idMap.has(entry.id)) idMap.set(entry.id, entry);
        }
        const merged = Array.from(idMap.values());
        merged.sort((a: any, b: any) => (b.createdAt || 0) - (a.createdAt || 0));
        setGenLogs(merged);
        writeLocalGenLogs(merged);
      }
    }).catch((err) => {
      console.warn('Wiki generation log cloud load failed:', err);
    });
  };

  const viewGenLogDetail = (id: string) => {
    const log = genLogs.find(l => l.id === id);
    if (log) setGenLogDetail(log);
  };

  const deleteGenLog = (id: string) => {
    if (!confirm('确定删除此生成记录？')) return;
    const updated = readLocalGenLogs().filter(l => l.id !== id);
    writeLocalGenLogs(updated);
    setGenLogs(updated);
    if (genLogDetail?.id === id) setGenLogDetail(null);
    wikiGenerationLogApi.delete(id).catch(() => {});
  };

  const updateGenLogLabel = (id: string, label: string) => {
    const logs = readLocalGenLogs().map(l => l.id === id ? { ...l, label } : l);
    writeLocalGenLogs(logs);
    setGenLogs(logs);
    wikiGenerationLogApi.update(id, { label }).catch(() => {});
  };

  // Load gen logs when switching to history tab
  useEffect(() => {
    if (rightTab === 'history' && genLogs.length === 0) loadGenLogs();
  }, [rightTab]);

  const companyContextName = useMemo(() => {
    if (industryCategory?.includes('::')) {
      return industryCategory.split('::')[1];
    }
    return '';
  }, [industryCategory]);

  const formatTitle = (title: string) => {
    if (!companyContextName) return title;
    const prefix1 = `${companyContextName} - `;
    const prefix2 = `${companyContextName} `;
    if (title.startsWith(prefix1)) return title.substring(prefix1.length);
    if (title.startsWith(prefix2)) return title.substring(prefix2.length);
    if (title.startsWith(companyContextName)) {
        // Fallback for cases like CompanyNamexxxx
        let trimmed = title.substring(companyContextName.length).trim();
        if (trimmed.startsWith('-') || trimmed.startsWith(':')) {
           trimmed = trimmed.substring(1).trim();
        }
        return trimmed || title;
    }
    return title;
  };

  return (
    <div className="flex w-full h-full bg-white divide-x divide-slate-200">
      
      {/* Left Pane: Index and Actions */}
      <div className="w-64 shrink-0 flex flex-col bg-slate-50/50">
        <div className="p-3 border-b border-slate-200">
          <div className="grid grid-cols-2 gap-1.5">
            <button
              onClick={handleOpenIngest}
              disabled={isIngesting || !industryCategory}
              className="col-span-2 flex justify-center items-center gap-1.5 py-2 bg-indigo-600 text-white rounded hover:bg-indigo-700 transition disabled:opacity-50 text-xs font-medium"
            >
              {isIngesting ? <Clock size={14} className="animate-spin" /> : <Sparkles size={14} />}
              <span>{isIngesting && ingestProgress ? ingestProgress : '智能提取情报'}</span>
            </button>
            <button onClick={handleQuery} className="flex justify-center items-center gap-1.5 py-1.5 text-xs text-indigo-700 bg-indigo-50 border border-indigo-200 rounded hover:bg-indigo-100 transition-colors">
               <Search size={14} /> AI 提问
            </button>
            <button onClick={handleLinting} className="flex justify-center items-center gap-1.5 py-1.5 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded hover:bg-amber-100 transition-colors">
               <CheckSquare size={14} /> Wiki Lint
            </button>
            <button onClick={handleOpenWikiSettings} className="flex justify-center items-center gap-1.5 py-1.5 text-xs text-slate-600 bg-slate-50 border border-slate-200 rounded hover:bg-slate-100 transition-colors">
               <Settings size={14} /> 配置
            </button>
            <button
              onClick={() => {
                const count = allArticles.filter(a => a.industryCategory === industryCategory || a.industryCategory.startsWith(industryCategory + '::')).length;
                if (count === 0) { alert('当前行业没有任何文章'); return; }
                if (confirm(`确认清空「${industryCategory}」下所有 ${count} 篇 Wiki 文章？此操作不可撤销。`)) {
                  clearCategoryArticles(industryCategory);
                  setSelectedArticleId(null);
                }
              }}
              className="flex justify-center items-center gap-1.5 py-1.5 text-xs text-red-600 bg-red-50 border border-red-200 rounded hover:bg-red-100 transition-colors"
            >
              <Trash2 size={14} /> 清空
            </button>
          </div>

          {/* Progress bar & abort button during ingest */}
          {isIngesting && ingestTotal > 0 && (
            <div className="mt-2 space-y-1.5">
              <div className="flex items-center justify-between text-[11px] text-slate-500">
                <span>{ingestCurrent}/{ingestTotal} 条笔记</span>
                <span>{Math.round((ingestCurrent / ingestTotal) * 100)}%</span>
              </div>
              <div className="w-full h-1.5 bg-slate-200 rounded-full overflow-hidden">
                <div
                  className="h-full bg-indigo-500 rounded-full transition-all duration-500 ease-out"
                  style={{ width: `${Math.round((ingestCurrent / ingestTotal) * 100)}%` }}
                />
              </div>
              <button
                onClick={() => { ingestAbortRef.current = true; ingestAbortControllerRef.current?.abort(); setIngestProgress('正在停止...'); }}
                className="w-full flex justify-center items-center gap-1.5 py-1.5 text-xs text-red-600 bg-red-50 border border-red-200 rounded hover:bg-red-100 transition-colors font-medium"
              >
                <AlertTriangle size={13} /> 暂停提取
              </button>
            </div>
          )}
        </div>

        <div className="flex-1 overflow-y-auto p-3 space-y-1">
          <div className="flex items-center justify-between px-2 pt-1 pb-2">
            <h3 className="text-xs font-semibold text-slate-500 uppercase">目录 Index</h3>
            <button onClick={handleCreateMock} className="text-slate-400 hover:text-indigo-600">
              <Plus size={14} />
            </button>
          </div>

          {articles.length === 0 ? (
            <div className="py-6 text-center text-xs text-slate-400">
               暂无生成的 Wiki 文件
            </div>
          ) : groupedArticles ? (
            /* Grouped collapsible index (industry level) */
            groupedArticles.map(group => (
              <div key={group.scope} className="mb-1">
                <div
                  onClick={() => toggleGroup(group.scope)}
                  className="flex items-center gap-1.5 px-2 py-1.5 cursor-pointer hover:bg-slate-100 rounded-md transition"
                >
                  {expandedGroups.has(group.scope)
                    ? <ChevronDown size={13} className="text-slate-400 shrink-0" />
                    : <ChevronRight size={13} className="text-slate-400 shrink-0" />}
                  <span className="text-xs font-semibold text-slate-700 truncate">{group.label}</span>
                  <span className="text-[10px] text-slate-400 ml-auto shrink-0">{group.articles.length}</span>
                </div>
                {expandedGroups.has(group.scope) && (
                  <div className="ml-3 border-l border-slate-200 pl-1">
                    {group.articles.map(article => (
                      <div
                        key={article.id}
                        onClick={() => { setSelectedArticleId(article.id); setIsEditing(false); }}
                        className={`px-2 py-1.5 rounded-md cursor-pointer flex items-start gap-1.5 transition ${selectedArticleId === article.id ? 'bg-indigo-50 text-indigo-700 font-medium' : 'text-slate-600 hover:bg-slate-100'}`}
                      >
                        <FileText size={12} className={`mt-0.5 shrink-0 ${selectedArticleId === article.id ? 'text-indigo-500' : 'text-slate-400'}`} />
                        <div className="min-w-0">
                          <div className="text-[13px] truncate">{formatTitle(article.title)}</div>
                          {article.description && <div className="text-[10px] text-slate-400 truncate">{article.description}</div>}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))
          ) : (
            /* Flat list (company level) */
            articles.map(article => (
              <div
                key={article.id}
                onClick={() => { setSelectedArticleId(article.id); setIsEditing(false); }}
                className={`px-3 py-2 rounded-lg cursor-pointer flex items-start gap-2 transition ${selectedArticleId === article.id ? 'bg-indigo-50 text-indigo-700 font-medium' : 'text-slate-600 hover:bg-slate-100'}`}
              >
                <FileText size={14} className={`mt-0.5 shrink-0 ${selectedArticleId === article.id ? 'text-indigo-500' : 'text-slate-400'}`} />
                <div className="min-w-0">
                  <div className="text-sm truncate">{formatTitle(article.title)}</div>
                  {article.description && <div className="text-[10px] text-slate-400 truncate">{article.description}</div>}
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Center Pane: Markdown Editor/Viewer */}
      <div className="flex-1 flex flex-col min-w-0 bg-white relative">
        {selectedArticle ? (
          <>
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
              {isEditing ? (
                <div className="flex-1">
                  <input 
                    value={editTitle}
                    onChange={e => setEditTitle(e.target.value)}
                    className="w-full text-2xl font-bold border-b border-transparent hover:border-slate-300 focus:border-blue-500 focus:outline-none bg-transparent px-1 py-1 transition-colors"
                  />
                  <div className="flex items-center gap-4 mt-2 px-1 text-xs text-slate-400">
                    <span>更新于 {new Date(selectedArticle.updatedAt).toLocaleString('zh-CN', { hour12: false })}</span>
                    <span>创建于 {new Date(selectedArticle.createdAt).toLocaleString('zh-CN', { hour12: false })}</span>
                  </div>
                </div>
              ) : (
                <div className="flex-1">
                  <h2 className="text-2xl font-bold text-slate-900 border-b border-transparent px-1 py-1">{selectedArticle.title}</h2>
                  <div className="flex items-center gap-4 mt-2 px-1 text-xs text-slate-400">
                    <span>更新于 {new Date(selectedArticle.updatedAt).toLocaleString('zh-CN', { hour12: false })}</span>
                    <span>创建于 {new Date(selectedArticle.createdAt).toLocaleString('zh-CN', { hour12: false })}</span>
                  </div>
                </div>
              )}
              <div className="flex gap-2">
                {isEditing ? (
                  <button onClick={handleSave} className="text-xs px-3 py-1.5 bg-blue-600 text-white rounded hover:bg-blue-700">保存修改</button>
                ) : (
                  <button onClick={() => { setIsEditing(true); setEditContent(selectedArticle.content); setEditTitle(selectedArticle.title); }} className="text-xs px-3 py-1.5 border border-slate-200 text-slate-600 rounded hover:bg-slate-50">手工编辑</button>
                )}
                {(selectedArticle.title.startsWith('🗨️') || selectedArticle.title.startsWith('🔍')) && !isEditing && (
                  <button onClick={handlePromoteToWiki} className="text-xs px-3 py-1.5 bg-emerald-50 text-emerald-700 border border-emerald-200 rounded hover:bg-emerald-100">
                    收录到 Wiki
                  </button>
                )}
                <button
                  onClick={() => { if(confirm('确认删除?')) deleteArticle(selectedArticle.id); }}
                  className="text-xs p-1.5 text-red-500 hover:bg-red-50 rounded"
                >
                  删除
                </button>
              </div>
            </div>

            {!isEditing && (
              <div className="px-6 py-2 bg-slate-50/80 border-b border-slate-200 flex gap-2 overflow-x-auto items-center">
                <span className="text-xs text-slate-400 mr-1 font-medium">透视镜:</span>
                <button 
                  onClick={() => toggleFilter('All')} 
                  className={`px-3 py-1 text-[11px] rounded transition ${filterViews.includes('All') ? 'bg-indigo-100 text-indigo-700 font-medium' : 'bg-white border border-slate-200 text-slate-500 hover:bg-slate-50'}`}
                >全部显示</button>
                <button 
                  onClick={() => toggleFilter('Management')}
                  className={`px-3 py-1 text-[11px] rounded transition ${filterViews.includes('Management') ? 'bg-slate-800 text-white font-medium' : 'bg-white border border-slate-200 text-slate-500 hover:bg-slate-50'}`}
                >管理层</button>
                <button 
                  onClick={() => toggleFilter('Expert')}
                  className={`px-3 py-1 text-[11px] rounded transition ${filterViews.includes('Expert') ? 'bg-sky-100 text-sky-700 font-medium' : 'bg-white border border-slate-200 text-slate-500 hover:bg-slate-50'}`}
                >专家访谈</button>
                <button 
                  onClick={() => toggleFilter('Sellside')}
                  className={`px-3 py-1 text-[11px] rounded transition ${filterViews.includes('Sellside') ? 'bg-blue-100 text-blue-700 font-medium' : 'bg-white border border-slate-200 text-slate-500 hover:bg-slate-50'}`}
                >卖方研报</button>
                <div className="flex items-center gap-1 ml-4 border-l border-slate-200 pl-4">
                  <span className="text-[11px] text-slate-500">限定时间段:</span>
                  <input type="month" value={viewDateFrom} onChange={e => setViewDateFrom(e.target.value)} className="text-[11px] bg-white border border-slate-200 text-slate-700 rounded px-1 min-h-[22px]" />
                  <span className="text-[11px] text-slate-400">-</span>
                  <input type="month" value={viewDateTo} onChange={e => setViewDateTo(e.target.value)} className="text-[11px] bg-white border border-slate-200 text-slate-700 rounded px-1 min-h-[22px]" />
                </div>
              </div>
            )}

            <div className="flex-1 overflow-y-auto p-6 bg-slate-50">
              <style>{`
                .wiki-filter-active p, .wiki-filter-active li {
                  display: none !important;
                }
                
                /* Active Highlights based on :has() */
                .wiki-filter-active.show-management p:has(.bg-slate-800),
                .wiki-filter-active.show-management li:has(.bg-slate-800),
                .wiki-filter-active.show-expert p:has(.bg-sky-100),
                .wiki-filter-active.show-expert li:has(.bg-sky-100),
                .wiki-filter-active.show-sellside p:has(.bg-blue-100),
                .wiki-filter-active.show-sellside li:has(.bg-blue-100) {
                  display: block !important;
                }
                
                /* List items should be list-item not block */
                .wiki-filter-active.show-management li:has(.bg-slate-800),
                .wiki-filter-active.show-expert li:has(.bg-sky-100),
                .wiki-filter-active.show-sellside li:has(.bg-blue-100) {
                  display: list-item !important;
                }
              `}</style>
              
              {isEditing ? (
                <textarea
                  className="w-full h-full p-4 border border-blue-200 rounded-lg outline-none focus:ring-2 focus:ring-blue-100 font-mono text-sm leading-relaxed"
                  value={editContent}
                  onChange={e => setEditContent(e.target.value)}
                />
              ) : (
                <div
                  ref={markdownContainerRef}
                  className={`prose prose-sm max-w-none prose-indigo prose-headings:font-semibold prose-a:text-indigo-600 bg-white p-6 rounded-lg border border-slate-200 shadow-sm min-h-full ${!filterViews.includes('All') ? 'wiki-filter-active' : ''} ${filterViews.includes('Management') ? 'show-management' : ''} ${filterViews.includes('Expert') ? 'show-expert' : ''} ${filterViews.includes('Sellside') ? 'show-sellside' : ''}`}
                  dangerouslySetInnerHTML={{ __html: marked.parse(selectedArticle.content) as string }}
                />
              )}
            </div>
          </>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center text-slate-400">
             <FileText size={48} className="mb-4 opacity-20" />
             <p className="text-sm">在左侧选择一个知识节点，或点击上方 "一键解析情报" 让 AI 为你构建图谱。</p>
          </div>
        )}
        
        {showIngestModal && (
          <div className="absolute inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-sm p-4">
            <div className="bg-white rounded-xl shadow-2xl w-full max-w-md overflow-hidden flex flex-col">
              <div className="p-4 border-b border-slate-100 flex justify-between items-center bg-indigo-50/50">
                <h3 className="font-bold text-slate-800 flex items-center gap-2">
                   <Sparkles size={18} className="text-indigo-600" /> 智能提取设置
                </h3>
              </div>
              <div className="p-6 space-y-4 text-sm">
                <p className="text-slate-600 leading-relaxed">
                  你可以限制提取的时间范围，让 AI 仅针对较新的情报进行增量更新，而非全局扫描。
                </p>
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-semibold text-slate-500 uppercase">开始日期 (From)</label>
                  <input 
                    type="date" 
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent" 
                    value={ingestDateFrom} 
                    onChange={e => setIngestDateFrom(e.target.value)} 
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-semibold text-slate-500 uppercase">结束日期 (To) [可选]</label>
                  <input 
                    type="date" 
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent" 
                    value={ingestDateTo} 
                    onChange={e => setIngestDateTo(e.target.value)} 
                  />
                </div>
              </div>
              <div className="p-4 border-t border-slate-100 bg-slate-50 flex justify-end gap-3">
                <button 
                  onClick={() => setShowIngestModal(false)}
                  className="px-4 py-2 text-sm font-medium text-slate-600 hover:text-slate-800 transition-colors"
                >
                  取消
                </button>
                <button 
                  onClick={confirmIngest}
                  className="px-6 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium rounded-lg shadow-sm transition-colors flex items-center gap-2"
                >
                  开始分析
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Right Pane: Timeline / History */}
      <div className="w-72 shrink-0 border-l border-slate-200 bg-slate-50/50 flex flex-col">
        {/* Tab header */}
        <div className="flex border-b border-slate-200">
          <button
            onClick={() => setRightTab('log')}
            className={`flex-1 flex justify-center items-center gap-1.5 py-2.5 text-xs font-medium transition-colors ${rightTab === 'log' ? 'text-indigo-600 border-b-2 border-indigo-600 bg-white' : 'text-slate-500 hover:text-slate-700'}`}
          >
            <Clock size={14} /> 更新日志
          </button>
          <button
            onClick={() => setRightTab('history')}
            className={`flex-1 flex justify-center items-center gap-1.5 py-2.5 text-xs font-medium transition-colors ${rightTab === 'history' ? 'text-indigo-600 border-b-2 border-indigo-600 bg-white' : 'text-slate-500 hover:text-slate-700'}`}
          >
            <History size={14} /> 生成历史
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          {rightTab === 'log' ? (
            /* Actions log tab (existing) */
            actions.length === 0 ? (
              <div className="text-center text-xs text-slate-400 py-6">暂无活动记录</div>
            ) : (
              <div className="relative border-l-2 border-slate-200 ml-3 space-y-6 pb-4">
                {actions.map(action => (
                  <div key={action.id} className="relative pl-4">
                    <span className={`absolute -left-[5px] top-1 w-2.5 h-2.5 rounded-full border-2 border-white ${action.action === 'create' ? 'bg-emerald-400' : action.action === 'update' ? 'bg-blue-400' : 'bg-red-400'}`}></span>
                    <div className="text-[10px] text-slate-400 font-medium mb-0.5">
                      {new Date(action.timestamp).toLocaleString()}
                    </div>
                    <div className="text-xs font-semibold text-slate-700">{action.action === 'create' ? '新建' : action.action === 'update' ? '更新' : '移除'} {action.articleTitle}</div>
                    <div className="text-[11px] text-slate-500 leading-relaxed mt-1">{action.description}</div>
                  </div>
                ))}
              </div>
            )
          ) : (
            /* Generation history tab */
            genLogDetail ? (
              /* Detail view */
              <div className="space-y-3">
                <button onClick={() => setGenLogDetail(null)} className="text-xs text-indigo-600 hover:text-indigo-800 flex items-center gap-1">
                  ← 返回列表
                </button>
                <div className="space-y-2">
                  <div className="text-xs font-semibold text-slate-700">{genLogDetail.label || '未命名实验'}</div>
                  <div className="text-[10px] text-slate-400">
                    {new Date(genLogDetail.createdAt).toLocaleString('zh-CN', { hour12: false })}
                  </div>
                  <div className="text-[11px] text-slate-600 space-y-1">
                    <div><span className="text-slate-400">模型:</span> {genLogDetail.model}</div>
                    <div><span className="text-slate-400">Scope:</span> {genLogDetail.industryCategory}</div>
                    <div><span className="text-slate-400">来源笔记:</span> {genLogDetail.sourceCount} 条</div>
                    {genLogDetail.sourceSummary && (
                      <div className="text-[10px] text-slate-400 italic truncate" title={genLogDetail.sourceSummary}>
                        {genLogDetail.sourceSummary}
                      </div>
                    )}
                  </div>

                  {/* Prompt used */}
                  <details className="mt-2">
                    <summary className="text-[11px] text-slate-500 cursor-pointer hover:text-slate-700 font-medium">查看约束条件 (Prompt)</summary>
                    <pre className="mt-1 text-[10px] text-slate-600 bg-slate-100 p-2 rounded max-h-48 overflow-y-auto whitespace-pre-wrap break-words leading-relaxed">
                      {genLogDetail.promptTemplate}
                    </pre>
                  </details>

                  {genLogDetail.pageTypes && (
                    <details className="mt-1">
                      <summary className="text-[11px] text-slate-500 cursor-pointer hover:text-slate-700 font-medium">查看页面类型</summary>
                      <pre className="mt-1 text-[10px] text-slate-600 bg-slate-100 p-2 rounded max-h-32 overflow-y-auto whitespace-pre-wrap break-words">
                        {genLogDetail.pageTypes}
                      </pre>
                    </details>
                  )}

                  {/* Generated articles */}
                  <div className="mt-3">
                    <div className="text-[11px] font-semibold text-slate-600 mb-2">
                      生成文章 ({genLogDetail.generatedArticles?.length || 0})
                    </div>
                    <div className="space-y-2">
                      {(genLogDetail.generatedArticles || []).map((article: any, idx: number) => (
                        <details key={idx} className="group">
                          <summary className="text-[11px] text-slate-700 cursor-pointer hover:text-indigo-600 font-medium flex items-center gap-1">
                            <span className={`inline-block w-1.5 h-1.5 rounded-full shrink-0 ${article.action === 'create' ? 'bg-emerald-400' : 'bg-blue-400'}`}></span>
                            <span className="truncate">{article.title}</span>
                          </summary>
                          <div className="mt-1 text-[10px] text-slate-500 bg-white border border-slate-200 rounded p-2 max-h-60 overflow-y-auto">
                            <div className="text-[9px] text-slate-400 mb-1">
                              {article.action === 'create' ? '新建' : '更新'} · {article.scope || genLogDetail.industryCategory}
                            </div>
                            <pre className="whitespace-pre-wrap break-words leading-relaxed">{article.content}</pre>
                          </div>
                        </details>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              /* List view */
              <div className="space-y-2">
                {genLogLoading ? (
                  <div className="text-center text-xs text-slate-400 py-6">加载中...</div>
                ) : genLogs.length === 0 ? (
                  <div className="text-center text-xs text-slate-400 py-6">
                    暂无生成记录<br />
                    <span className="text-[10px]">每次「智能提取情报」后自动记录</span>
                  </div>
                ) : (
                  genLogs.map(log => (
                    <div key={log.id} className="bg-white rounded-lg border border-slate-200 p-2.5 hover:border-indigo-300 transition-colors">
                      <div className="flex items-start justify-between gap-1">
                        <div className="min-w-0 flex-1">
                          <div className="text-[11px] font-medium text-slate-700 truncate">
                            {log.label || `${log.model} · ${log.sourceCount}条笔记`}
                          </div>
                          <div className="text-[10px] text-slate-400 mt-0.5">
                            {new Date(log.createdAt).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false })}
                            {' · '}{log.industryCategory}
                          </div>
                          {log.sourceSummary && (
                            <div className="text-[9px] text-slate-400 mt-0.5 truncate" title={log.sourceSummary}>
                              {log.sourceSummary}
                            </div>
                          )}
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          <button
                            onClick={() => viewGenLogDetail(log.id)}
                            className="p-1 text-slate-400 hover:text-indigo-600 transition-colors"
                            title="查看详情"
                          >
                            <Eye size={13} />
                          </button>
                          <button
                            onClick={() => {
                              const label = prompt('为此实验添加标签:', log.label || '');
                              if (label !== null) updateGenLogLabel(log.id, label);
                            }}
                            className="p-1 text-slate-400 hover:text-amber-600 transition-colors"
                            title="添加标签"
                          >
                            <Tag size={13} />
                          </button>
                          <button
                            onClick={() => deleteGenLog(log.id)}
                            className="p-1 text-slate-400 hover:text-red-500 transition-colors"
                            title="删除"
                          >
                            <Trash2 size={13} />
                          </button>
                        </div>
                      </div>
                    </div>
                  ))
                )}
                {genLogs.length > 0 && (
                  <button
                    onClick={loadGenLogs}
                    className="w-full text-[10px] text-indigo-500 hover:text-indigo-700 py-1"
                  >
                    刷新
                  </button>
                )}
              </div>
            )
          )}
        </div>
      </div>

      <Modal
        title="Wiki 提纲与规则配置"
        open={showWikiSettings}
        onOk={handleSaveWikiSettings}
        onCancel={() => setShowWikiSettings(false)}
        okText="保存"
        cancelText="取消"
        width={640}
      >
        <Form layout="vertical" style={{ marginTop: 16 }}>
          <Form.Item label={<span style={{ fontWeight: 600, color: '#4f46e5' }}>「{industryCategory}」行业专属分析框架 <span style={{ color: '#999', fontWeight: 'normal' }}>（仅对当前行业生效）</span></span>}>
            <Input.TextArea
              value={localCustomInstructions}
              onChange={(e) => setLocalCustomInstructions(e.target.value)}
              placeholder={`为「${industryCategory}」行业定义专属的分析重点，例如：\n\n重点关注的指标：\n- 订单增速、产能利用率、海外收入占比\n\n关键问题：\n- 技术路线选择对竞争格局的影响？\n- 政策变化如何影响出口？\n\n分析框架：\n- 按区域拆解（北美/欧洲/东南亚）\n- 价格带竞争分析`}
              autoSize={{ minRows: 4, maxRows: 12 }}
              style={{ fontFamily: 'monospace', fontSize: 12 }}
            />
            <div style={{ marginTop: 4, fontSize: 12, color: '#999' }}>
              这些内容会作为该行业的「分析重点」注入 AI 提示词，引导 AI 在提取信息时优先关注你关心的方向。留空则不注入。每个行业独立存储。
            </div>
          </Form.Item>
          <Form.Item label="页面类型定义（全局通用）">
            <Input.TextArea
              value={localPageTypes}
              onChange={(e) => setLocalPageTypes(e.target.value)}
              autoSize={{ minRows: 4, maxRows: 10 }}
              style={{ fontFamily: 'monospace', fontSize: 12 }}
            />
            <div style={{ marginTop: 4, fontSize: 12, color: '#999' }}>
              定义 Wiki 文章的页面类型。格式为 <code>- [类型名] 描述</code>。LLM 会在文章标题前加类型标签。此设置云端同步。
            </div>
            <button
              type="button"
              onClick={() => setLocalPageTypes(DEFAULT_WIKI_PAGE_TYPES)}
              className="mt-2 text-xs text-blue-600 hover:text-blue-800"
            >
              恢复默认类型
            </button>
          </Form.Item>
          <Form.Item label="用户可编辑 Prompt（上下文与变量模板）">
            <Input.TextArea
              value={localIngestPrompt}
              onChange={(e) => setLocalIngestPrompt(e.target.value)}
              autoSize={{ minRows: 6, maxRows: 14 }}
              style={{ fontFamily: 'monospace', fontSize: 12 }}
            />
            <div style={{ marginTop: 4, fontSize: 12, color: '#999' }}>
              可用变量: <code>{`{{industryCategory}}`}</code>, <code>{`{{currentDate}}`}</code>, <code>{`{{pageTypes}}`}</code>, <code>{`{{customInstructions}}`}</code>, <code>{`{{serializedWiki}}`}</code>, <code>{`{{recentLog}}`}</code>, <code>{`{{sourceMaterial}}`}</code>
            </div>
            <button
              type="button"
              onClick={() => setLocalIngestPrompt(DEFAULT_WIKI_USER_PROMPT)}
              className="mt-2 text-xs text-blue-600 hover:text-blue-800"
            >
              恢复默认规则
            </button>
          </Form.Item>
          <Form.Item label={<span>系统固定规则 <span style={{ color: '#999', fontWeight: 'normal' }}>（不可编辑，自动追加在上方 Prompt 之后）</span></span>}>
            <Input.TextArea
              value={WIKI_SYSTEM_RULES}
              readOnly
              autoSize={{ minRows: 6, maxRows: 14 }}
              style={{ fontFamily: 'monospace', fontSize: 11, background: '#f5f5f5', color: '#666', cursor: 'default' }}
            />
          </Form.Item>
          <Form.Item label={<span>多 Scope 路由规则 <span style={{ color: '#999', fontWeight: 'normal' }}>（云端同步，控制多公司 scope 同时 ingest 时内容分配）</span></span>}>
            <Input.TextArea
              value={localMultiScopeRules}
              onChange={(e) => setLocalMultiScopeRules(e.target.value)}
              autoSize={{ minRows: 4, maxRows: 12 }}
              style={{ fontFamily: 'monospace', fontSize: 12 }}
            />
            <button type="button" onClick={() => setLocalMultiScopeRules(DEFAULT_MULTI_SCOPE_RULES)} className="mt-2 text-xs text-blue-600 hover:text-blue-800">恢复默认路由规则</button>
          </Form.Item>
          <Form.Item label={<span>Lint 审计维度 <span style={{ color: '#999', fontWeight: 'normal' }}>（云端同步，Wiki Lint 检查时使用的维度）</span></span>}>
            <Input.TextArea
              value={localLintDimensions}
              onChange={(e) => setLocalLintDimensions(e.target.value)}
              autoSize={{ minRows: 3, maxRows: 10 }}
              style={{ fontFamily: 'monospace', fontSize: 12 }}
            />
            <button type="button" onClick={() => setLocalLintDimensions(DEFAULT_LINT_DIMENSIONS)} className="mt-2 text-xs text-blue-600 hover:text-blue-800">恢复默认审计维度</button>
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
});
