import { memo, useState, useEffect, useRef, useCallback } from 'react';
import { Loader2, RefreshCw } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeRaw from 'rehype-raw';
import { canvasSyncApi } from '../../db/apiClient.ts';
import { useCanvasStore } from '../../stores/canvasStore.ts';

interface TranscriptionNoteEditorProps {
  nodeId: string;
  transcriptionId: string;
}

export const TranscriptionNoteEditor = memo(function TranscriptionNoteEditor({
  nodeId,
  transcriptionId,
}: TranscriptionNoteEditorProps) {
  const updateNodeData = useCanvasStore(s => s.updateNodeData);

  const [content, setContent] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [isEditing, setIsEditing] = useState(false);
  const [editContent, setEditContent] = useState('');
  const [saving, setSaving] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const fetchContent = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await canvasSyncApi.getTranscriptionContent(transcriptionId);
      setContent(data.content || '');
      // Sync all fields back into the canvas node so it stays current
      updateNodeData(nodeId, {
        title: data.title,
        content: data.content || '',
        tags: data.tags || [],
        metadata: data.metadata || {},
      });
    } catch (err: any) {
      setError(err?.message || '加载失败');
    } finally {
      setLoading(false);
    }
  }, [transcriptionId, nodeId, updateNodeData]);

  useEffect(() => {
    fetchContent();
  }, [fetchContent]);

  useEffect(() => {
    if (isEditing && textareaRef.current) {
      textareaRef.current.focus();
    }
  }, [isEditing]);

  const handleEdit = () => {
    setEditContent(content);
    setIsEditing(true);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await canvasSyncApi.updateTranscriptionContent(transcriptionId, editContent);
      setContent(editContent);
      updateNodeData(nodeId, { content: editContent });
      setIsEditing(false);
      // Re-fetch to get any server-side updates (e.g. metadata changes)
      fetchContent();
    } catch (err: any) {
      alert('保存失败: ' + (err?.message || '未知错误'));
    } finally {
      setSaving(false);
    }
  };

  const handleCancel = () => {
    setIsEditing(false);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full text-slate-400 gap-2">
        <Loader2 size={16} className="animate-spin" />
        <span className="text-sm">从 AI Process 加载内容...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3 text-slate-400">
        <span className="text-sm text-red-500">{error}</span>
        <button
          onClick={fetchContent}
          className="text-xs px-3 py-1.5 bg-slate-100 rounded hover:bg-slate-200 flex items-center gap-1"
        >
          <RefreshCw size={12} /> 重试
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-4 py-2 border-b border-slate-100 shrink-0">
        <span className="text-[11px] text-blue-500 font-medium flex items-center gap-1.5">
          <span className="w-4 h-4 rounded bg-blue-100 text-blue-600 text-[9px] font-bold flex items-center justify-center">AI</span>
          AI Process 同步笔记
        </span>
        <div className="flex gap-2 items-center">
          {!isEditing && (
            <button
              onClick={fetchContent}
              className="p-1 text-slate-400 hover:text-slate-600 rounded hover:bg-slate-100"
              title="从 AI Process 刷新最新内容"
            >
              <RefreshCw size={13} />
            </button>
          )}
          {isEditing ? (
            <>
              <button
                onClick={handleCancel}
                disabled={saving}
                className="text-xs px-3 py-1.5 border border-slate-200 text-slate-600 rounded hover:bg-slate-50 disabled:opacity-40"
              >
                取消
              </button>
              <button
                onClick={handleSave}
                disabled={saving}
                className="text-xs px-3 py-1.5 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-40 flex items-center gap-1"
              >
                {saving && <Loader2 size={11} className="animate-spin" />}
                保存修改
              </button>
            </>
          ) : (
            <button
              onClick={handleEdit}
              className="text-xs px-3 py-1.5 border border-slate-200 text-slate-600 rounded hover:bg-slate-50"
            >
              编辑
            </button>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        {isEditing ? (
          <textarea
            ref={textareaRef}
            className="w-full h-full min-h-[400px] p-4 border border-blue-200 rounded-md outline-none focus:ring-2 focus:ring-blue-100 font-mono text-sm leading-relaxed resize-none"
            value={editContent}
            onChange={e => setEditContent(e.target.value)}
          />
        ) : (
          <div className="prose prose-sm max-w-none prose-headings:font-semibold prose-a:text-blue-600 bg-white p-6 rounded-md border border-slate-200 shadow-sm min-h-full">
            {content ? (
              <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeRaw]}>
                {content}
              </ReactMarkdown>
            ) : (
              <p className="text-slate-400 italic">暂无内容</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
});
