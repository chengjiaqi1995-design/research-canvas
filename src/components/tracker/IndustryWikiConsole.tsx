import { memo, useEffect, useState } from 'react';
import { useIndustryWikiStore } from '../../stores/industryWikiStore.ts';
import { FileText, Plus, Search, Sparkles, AlertTriangle, CheckSquare, Clock } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

interface IndustryWikiConsoleProps {
  industryCategory: string; // The active subCategoryName passed from TrackerView
}

export const IndustryWikiConsole = memo(function IndustryWikiConsole({ industryCategory }: IndustryWikiConsoleProps) {
  const loadWikiData = useIndustryWikiStore(s => s.loadWikiData);
  const addArticle = useIndustryWikiStore(s => s.addArticle);
  const updateArticle = useIndustryWikiStore(s => s.updateArticle);
  const deleteArticle = useIndustryWikiStore(s => s.deleteArticle);
  const logAction = useIndustryWikiStore(s => s.logAction);
  
  const allArticles = useIndustryWikiStore(s => s.articles);
  const allActions = useIndustryWikiStore(s => s.actions);

  const [selectedArticleId, setSelectedArticleId] = useState<string | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [editContent, setEditContent] = useState('');
  const [isIngesting, setIsIngesting] = useState(false);

  useEffect(() => {
    loadWikiData();
  }, [loadWikiData]);

  // Filter explicitly for this industry
  const articles = allArticles.filter(a => a.industryCategory === industryCategory).sort((a, b) => b.updatedAt - a.updatedAt);
  const actions = allActions.filter(a => a.industryCategory === industryCategory).slice(0, 20); // show last 20

  useEffect(() => {
    if (selectedArticleId && !articles.find(a => a.id === selectedArticleId)) {
      setSelectedArticleId(null);
    }
  }, [articles, selectedArticleId]);

  const selectedArticle = articles.find(a => a.id === selectedArticleId);

  const handleIngest = async () => {
    setIsIngesting(true);
    // TODO: Phase 3 AI Pipeline hookup
    setTimeout(() => {
      // Mock result
      const newId = addArticle(industryCategory, `新研究笔记 - ${new Date().toLocaleTimeString()}`, `# 摘要\n\n大模型在此自动生成的 ${industryCategory} 相关知识概念...\n\n## 矛盾点\n无`);
      logAction(industryCategory, 'create', `新研究笔记 - ${new Date().toLocaleTimeString()}`, '通过一键解析最新情报自动生成');
      setSelectedArticleId(newId);
      setIsIngesting(false);
    }, 1500);
  };

  const handleCreateMock = () => {
    const newId = addArticle(industryCategory, `新建条目`, `# 标题\n\n内容`);
    setSelectedArticleId(newId);
    setIsEditing(true);
    setEditContent(`# 标题\n\n内容`);
  };

  const handleSave = () => {
    if (selectedArticleId && selectedArticle) {
      updateArticle(selectedArticleId, editContent);
      logAction(industryCategory, 'update', selectedArticle.title, '用户通过编辑器手动修改');
      setIsEditing(false);
    }
  };

  return (
    <div className="flex w-full h-full bg-white divide-x divide-slate-200">
      
      {/* Left Pane: Index and Actions */}
      <div className="w-64 shrink-0 flex flex-col bg-slate-50/50">
        <div className="p-4 border-b border-slate-200">
          <button
            onClick={handleIngest}
            disabled={isIngesting || !industryCategory}
            className="w-full flex justify-center items-center gap-2 py-2 px-4 bg-indigo-600 text-white rounded-lg shadow-sm hover:bg-indigo-700 transition disabled:opacity-50 text-sm font-medium"
          >
            {isIngesting ? <Clock size={16} className="animate-spin" /> : <Sparkles size={16} />}
            一键解析情报 (Ingest)
          </button>
          
          <div className="flex gap-2 mt-3">
             <button className="flex-1 flex justify-center items-center gap-1.5 py-1.5 text-xs text-indigo-700 bg-indigo-50 border border-indigo-200 rounded hover:bg-indigo-100">
               <Search size={14} /> AI 提问
             </button>
             <button className="flex-1 flex justify-center items-center gap-1.5 py-1.5 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded hover:bg-amber-100">
               <CheckSquare size={14} /> Wiki Lint
             </button>
          </div>
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
          ) : (
             articles.map(article => (
                <div
                  key={article.id}
                  onClick={() => { setSelectedArticleId(article.id); setIsEditing(false); }}
                  className={`px-3 py-2 text-sm rounded-lg cursor-pointer flex items-center gap-2 transition ${selectedArticleId === article.id ? 'bg-indigo-50 text-indigo-700 font-medium' : 'text-slate-600 hover:bg-slate-100'}`}
                >
                  <FileText size={14} className={selectedArticleId === article.id ? 'text-indigo-500' : 'text-slate-400'} />
                  <span className="truncate">{article.title}</span>
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
              <input 
                className="text-lg font-bold text-slate-800 outline-none bg-transparent flex-1"
                value={selectedArticle.title}
                onChange={(e) => updateArticle(selectedArticle.id, selectedArticle.content, e.target.value)}
                placeholder="页面标题..."
              />
              <div className="flex gap-2">
                {isEditing ? (
                  <button onClick={handleSave} className="text-xs px-3 py-1.5 bg-blue-600 text-white rounded hover:bg-blue-700">保存修改</button>
                ) : (
                  <button onClick={() => { setIsEditing(true); setEditContent(selectedArticle.content); }} className="text-xs px-3 py-1.5 border border-slate-200 text-slate-600 rounded hover:bg-slate-50">手工编辑</button>
                )}
                <button 
                  onClick={() => { if(confirm('确认删除?')) deleteArticle(selectedArticle.id); }}
                  className="text-xs p-1.5 text-red-500 hover:bg-red-50 rounded"
                >
                  删除
                </button>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto p-6 bg-slate-50">
              {isEditing ? (
                <textarea
                  className="w-full h-full p-4 border border-blue-200 rounded-lg outline-none focus:ring-2 focus:ring-blue-100 font-mono text-sm leading-relaxed"
                  value={editContent}
                  onChange={e => setEditContent(e.target.value)}
                />
              ) : (
                <div className="prose prose-sm max-w-none prose-indigo prose-headings:font-semibold prose-a:text-indigo-600 bg-white p-6 rounded-lg border border-slate-200 shadow-sm min-h-full">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>
                    {selectedArticle.content}
                  </ReactMarkdown>
                </div>
              )}
            </div>
          </>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center text-slate-400">
             <FileText size={48} className="mb-4 opacity-20" />
             <p className="text-sm">在左侧选择一个知识节点，或点击上方 "一键解析情报" 让 AI 为你构建图谱。</p>
          </div>
        )}
      </div>

      {/* Right Pane: Timeline / Log */}
      <div className="w-72 shrink-0 border-l border-slate-200 bg-slate-50/50 flex flex-col">
        <div className="px-4 py-3 border-b border-slate-200">
           <h3 className="text-sm font-semibold text-slate-700 flex items-center gap-2">
              <Clock size={16} className="text-slate-400" />
              Wiki 更新日志
           </h3>
        </div>
        <div className="flex-1 overflow-y-auto p-4">
           {actions.length === 0 ? (
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
           )}
        </div>
      </div>

    </div>
  );
});
