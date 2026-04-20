import React, { useState, useEffect } from 'react';
import { X, Loader2, Sparkles, BrainCircuit } from 'lucide-react';
import { canvasApi, aiApi } from '../../db/apiClient.ts';
import { useTrackerStore } from '../../stores/trackerStore.ts';
import { generateId } from '../../utils/id.ts';
import type { Tracker, TrackerInboxItem } from '../../types/index.ts';
import { getApiConfig } from '../../aiprocess/components/ApiConfigModal.tsx';

interface TrackerAIModalProps {
  onClose: () => void;
  activeIndustryId: string;
  activeTrackers: Tracker[];
}

export const TrackerAIModal: React.FC<TrackerAIModalProps> = ({ onClose, activeIndustryId, activeTrackers }) => {
  const [timePeriod, setTimePeriod] = useState<string>(new Date().toISOString().slice(0, 7)); // Default YYYY-MM
  const [isLoading, setIsLoading] = useState(false);
  const [progress, setProgress] = useState<string>('');
  const addInboxItem = useTrackerStore(s => s.addInboxItem);

  const startExtraction = async () => {
    if (!timePeriod) {
      alert('请输入目标提取时间周期 (如 2026-03)');
      return;
    }
    
    if (activeTrackers.length === 0) {
      alert('当前没有任何监控实体和指标，请先在网格中定义（或导入Excel）后再进行自动提取。');
      return;
    }

    try {
      setIsLoading(true);
      setProgress('正在拉取当前行业所有画布节点数据...');
      
      const canvases = await canvasApi.list(activeIndustryId);
      if (!canvases || canvases.length === 0) {
        throw new Error('未找到任何画布数据');
      }

      // Aggregate all text from all canvases
      let aggregatedText = '';
      let textLen = 0;
      canvases.forEach(canvas => {
         if (canvas.nodes) {
           canvas.nodes.forEach((node: any) => {
             if (node.data?.content) {
                const chunk = `[来源节点: ${node.data.title || '未命名'}]\n${node.data.content}\n\n`;
                if (textLen < 80000) { // arbitrary safe chunking threshold for the prompt
                  aggregatedText += chunk;
                  textLen += chunk.length;
                }
             }
           });
         }
      });

      if (!aggregatedText) {
         throw new Error('当前行业的画布中没有找到任何文本内容，提取终止。');
      }

      // Build target framework schema from activeTrackers
      const targetEntities = new Set<string>();
      const targetColumns = new Set<string>();
      
      activeTrackers.forEach(t => {
         t.entities?.forEach(e => targetEntities.add(e.name));
         t.columns?.forEach(c => targetColumns.add(c.name));
      });

      setProgress('正在请求 AI 分析并提取追踪指标...');

      const prompt = `你是一个高级金融情报分析师。你需要从以下提供的所有的原始笔记中，根据给定的实体(Entities)和它们被跟踪的指标(Metrics)，精确地提取出属于时间周期【${timePeriod}】的定性和定量数据。
如果笔记文本中提到了相关公司的特定指标或者其最新说辞动态，且看似发生在或有关于该时间周期内，请提取它们。

【目标跟踪实体(Entities)】:
${Array.from(targetEntities).join(', ')}

【目标跟踪指标(Metrics)】:
${Array.from(targetColumns).join(', ')}

请返回包含所有提取结果的JSON，不要包含任何\`\`\`json或多余描述格式，**直接返回干净的JSON数组**。
要求JSON格式为：
[
  {
    "targetCompany": "实体名称(必须是上面列表中的一个)",
    "targetMetric": "指标名称(必须是上面列表中的一个)",
    "extractedValue": "提取出来的具体数值或者简短文本描述(不要超过30字)",
    "content": "用于证明该提取结论的原文片段或依据(最多50字)"
  }
]

【原始笔记内容片段】:
${aggregatedText}`;

      const config = getApiConfig();
      // Try to use flash/pro or whatever is configured, defaulting to flash for large context
      const model = config.metadataFillModel || config.excelParsingModel || 'gemini-3-flash-preview';

      let resultString = '';
      for await (const event of aiApi.chatStream({
         model,
         messages: [{ role: 'user', content: prompt }],
         systemPrompt: '你是一个严格遵守JSON输出格式的特工机器。绝不输出JSON以外的任何废话。'
      })) {
         if (event.type === 'text' && event.content) {
            resultString += event.content;
         }
      }

      // cleanup markdown
      resultString = resultString.trim().replace(/^```json/i, '').replace(/^```/, '').replace(/```$/, '').trim();
      
      const parsedItems = JSON.parse(resultString);
      if (!Array.isArray(parsedItems)) {
         throw new Error('AI返回的数据格式不是数组');
      }

      setProgress('正在推入情报草稿箱待审核...');
      let addedCount = 0;
      for (const item of parsedItems) {
         if (item.targetCompany && item.targetMetric && item.extractedValue) {
            addInboxItem({
               id: `inbox_${generateId()}`,
               source: 'canvas',
               content: item.content || '自动提取的内容依据',
               targetCompany: item.targetCompany,
               targetMetric: item.targetMetric,
               extractedValue: item.extractedValue,
               timePeriod: timePeriod,
               timestamp: Date.now()
            });
            addedCount++;
         }
      }

      alert(`成功提取并向草稿箱推送了 ${addedCount} 条监控情报，请在右侧侧边栏确认入库！`);
      onClose();

    } catch (err: any) {
      alert(`提取失败: ${err.message}`);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-sm" onClick={onClose}>
      <div 
        className="bg-white rounded-md shadow-lg w-full max-w-lg mx-4 flex flex-col border border-slate-200 overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-6 py-4 bg-gradient-to-r from-blue-50 to-blue-50 border-b border-blue-100">
          <div className="flex items-center gap-3">
             <div className="p-2 bg-blue-100 text-blue-700 rounded-md shadow-inner">
                <BrainCircuit size={18} />
             </div>
             <div>
                <h2 className="text-base font-bold text-slate-800">画布笔记自动提取入库</h2>
                <p className="text-xs text-slate-500 mt-0.5">跨画布智能寻找追踪对象的散落碎片</p>
             </div>
          </div>
          <button onClick={onClose} className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-white rounded-md transition-colors">
            <X size={20} />
          </button>
        </div>
        
        <div className="p-6">
          <div className="mb-6">
             <label className="block text-sm font-semibold text-slate-700 mb-2">
                目标时间轴 (Target Time Period)
             </label>
             <input 
               type="text" 
               value={timePeriod}
               onChange={(e) => setTimePeriod(e.target.value)}
               placeholder="例如：2026-03 或 24Q1"
               className="w-full px-4 py-2 bg-white border border-slate-300 rounded-md text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500 transition-shadow"
             />
             <p className="text-xs text-slate-500 mt-2">
                提取的数据段将被统一打上以上时间戳标记，用于网格中的对齐显示。
             </p>
          </div>

          <div className="p-4 bg-slate-50 border border-slate-200 rounded-md mb-6">
            <h4 className="text-xs font-semibold text-slate-700 mb-2 flex items-center gap-1.5">
               <Sparkles size={14} className="text-blue-500" />
               正在嗅探的范围依据
            </h4>
            <div className="text-[11px] text-slate-600 leading-relaxed max-h-24 overflow-y-auto">
               当前配置了 {activeTrackers.flatMap(t => t.entities || []).length} 个探测实体与 {activeTrackers.flatMap(t => t.columns || []).length} 项探测指标。<br/>
               <span className="text-slate-400 mt-1 inline-block">AI 将通读此行业下的所有画布详情，定向提取符合要求的数据入库至「情报箱」。可能需要消耗几秒钟到十几秒的时长。</span>
            </div>
          </div>

          <button 
            onClick={startExtraction}
            disabled={isLoading}
            className={`w-full flex items-center justify-center gap-2 py-2.5 rounded-md text-sm font-medium transition-all shadow-sm ${
              isLoading 
                ? 'bg-blue-100 text-blue-400 cursor-not-allowed' 
                : 'bg-blue-600 text-white hover:bg-blue-700 hover:shadow-md'
            }`}
          >
            {isLoading ? (
               <>
                 <Loader2 size={16} className="animate-spin" />
                 {progress || '正在提取中...'}
               </>
            ) : (
               <>开始全局嗅探</>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};
