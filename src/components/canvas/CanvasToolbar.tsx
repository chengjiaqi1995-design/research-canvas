import { memo, useRef } from 'react';
import { ZoomIn, ZoomOut, Maximize, FileUp, Code } from 'lucide-react';
import { useReactFlow } from '@xyflow/react';
import { useCanvas } from '../../hooks/useCanvas.ts';

export const CanvasToolbar = memo(function CanvasToolbar() {
  const { addTextNode, addTableNode, addHtmlNode } = useCanvas();
  const reactFlowInstance = useReactFlow();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const htmlInputRef = useRef<HTMLInputElement>(null);

  const getCenter = () => {
    const viewport = reactFlowInstance.getViewport();
    // Get the center of the visible canvas area
    const x = (-viewport.x + 400) / viewport.zoom;
    const y = (-viewport.y + 300) / viewport.zoom;
    return { x, y };
  };

  const handleImportMd = () => {
    fileInputRef.current?.click();
  };

  const handleImportHtml = () => {
    htmlInputRef.current?.click();
  };

  const handleHtmlFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    if (!file.name.endsWith('.html') && !file.name.endsWith('.htm')) {
      alert('请选择 HTML (.html) 格式的文件');
      return;
    }

    const title = file.name.replace(/\.html?$/, '');
    const reader = new FileReader();

    reader.onload = (e) => {
      const content = e.target?.result as string;
      if (content) {
        addHtmlNode(getCenter(), title, content);
      }
      if (htmlInputRef.current) {
        htmlInputRef.current.value = '';
      }
    };

    reader.onerror = () => {
      alert('读取文件失败');
    };

    reader.readAsText(file);
  };

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    if (!file.name.endsWith('.md')) {
      alert('请选择 markdown (.md) 格式的文件');
      return;
    }

    const title = file.name.replace(/\.md$/, '');
    const reader = new FileReader();

    reader.onload = (e) => {
      const content = e.target?.result as string;
      if (content) {
        addTextNode(getCenter(), undefined, { title, content });
      }
      // Reset input value so the same file can be selected again
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    };

    reader.onerror = () => {
      alert('读取文件失败');
    };

    reader.readAsText(file);
  };

  return (
    <div className="absolute top-3 left-3 z-10 flex items-center gap-1 bg-white rounded-lg shadow-md border border-slate-200 px-2 py-1">
      <button
        onClick={() => addTextNode(getCenter())}
        className="px-2 py-1 text-xs rounded hover:bg-blue-50 text-slate-600 hover:text-blue-600"
        title="添加文本节点 (Ctrl+1)"
      >
        文本
      </button>

      <div className="w-px h-5 bg-slate-200" />

      <button
        onClick={() => addTableNode(getCenter())}
        className="px-2 py-1 text-xs rounded hover:bg-green-50 text-slate-600 hover:text-green-600"
        title="添加表格节点 (Ctrl+2)"
      >
        表格
      </button>

      <div className="w-px h-5 bg-slate-200" />

      <button
        onClick={handleImportMd}
        className="px-2 py-1 flex items-center gap-1 text-xs rounded hover:bg-purple-50 text-slate-600 hover:text-purple-600"
        title="导入 Markdown 笔记"
      >
        <FileUp size={14} className="opacity-70" />
        导入 MD
      </button>
      <input
        type="file"
        accept=".md"
        className="hidden"
        ref={fileInputRef}
        onChange={handleFileChange}
      />

      <div className="w-px h-5 bg-slate-200" />

      <button
        onClick={handleImportHtml}
        className="px-2 py-1 flex items-center gap-1 text-xs rounded hover:bg-orange-50 text-slate-600 hover:text-orange-600"
        title="导入 HTML"
      >
        <Code size={14} className="opacity-70" />
        导入 HTML
      </button>
      <input
        type="file"
        accept=".html,.htm"
        className="hidden"
        ref={htmlInputRef}
        onChange={handleHtmlFileChange}
      />

      <div className="w-px h-5 bg-slate-200" />

      <button
        onClick={() => reactFlowInstance.zoomIn()}
        className="p-1 rounded hover:bg-slate-100 text-slate-500"
        title="放大"
      >
        <ZoomIn size={14} />
      </button>
      <button
        onClick={() => reactFlowInstance.zoomOut()}
        className="p-1 rounded hover:bg-slate-100 text-slate-500"
        title="缩小"
      >
        <ZoomOut size={14} />
      </button>
      <button
        onClick={() => reactFlowInstance.fitView({ padding: 0.2 })}
        className="p-1 rounded hover:bg-slate-100 text-slate-500"
        title="适应视图"
      >
        <Maximize size={14} />
      </button>
    </div>
  );
});
