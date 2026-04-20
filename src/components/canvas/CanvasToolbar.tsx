import { memo, useRef } from 'react';
import { ZoomIn, ZoomOut, Maximize, FileUp, Code, Type, Table } from 'lucide-react';
import { useReactFlow } from '@xyflow/react';
import { useCanvas } from '../../hooks/useCanvas.ts';
import { marked } from 'marked';
import { IconButton } from '../ui/index.ts';

export const CanvasToolbar = memo(function CanvasToolbar() {
  const { addTextNode, addTableNode, addHtmlNode, addMarkdownNode } = useCanvas();
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
      const rawMd = e.target?.result as string;
      if (rawMd) {
        // Convert markdown to HTML at import time so BlockNote can parse it correctly
        const content = marked.parse(rawMd, { async: false }) as string;
        addMarkdownNode(getCenter(), title, content);
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

  const divider = <div className="w-px h-4 bg-slate-200 mx-0.5" />;

  const ToolbarText = ({ onClick, title, icon, children }: {
    onClick: () => void;
    title: string;
    icon?: React.ReactNode;
    children: React.ReactNode;
  }) => (
    <button
      onClick={onClick}
      title={title}
      className="flex items-center gap-1 px-2 py-1 text-xs rounded text-slate-600 hover:bg-slate-100 hover:text-slate-800 transition-colors"
    >
      {icon}
      {children}
    </button>
  );

  return (
    <div className="absolute top-3 left-3 z-10 flex items-center gap-0.5 bg-white rounded shadow-sm border border-slate-200 px-1.5 py-1">
      <ToolbarText onClick={() => addTextNode(getCenter())} title="添加文本节点 (Ctrl+1)" icon={<Type size={12} className="text-slate-400" />}>
        文本
      </ToolbarText>
      <ToolbarText onClick={() => addTableNode(getCenter())} title="添加表格节点 (Ctrl+2)" icon={<Table size={12} className="text-slate-400" />}>
        表格
      </ToolbarText>

      {divider}

      <ToolbarText onClick={handleImportMd} title="导入 Markdown 笔记" icon={<FileUp size={12} className="text-slate-400" />}>
        导入 MD
      </ToolbarText>
      <input type="file" accept=".md" className="hidden" ref={fileInputRef} onChange={handleFileChange} />

      <ToolbarText onClick={handleImportHtml} title="导入 HTML" icon={<Code size={12} className="text-slate-400" />}>
        导入 HTML
      </ToolbarText>
      <input type="file" accept=".html,.htm" className="hidden" ref={htmlInputRef} onChange={handleHtmlFileChange} />

      {divider}

      <IconButton onClick={() => reactFlowInstance.zoomIn()} title="放大">
        <ZoomIn size={13} />
      </IconButton>
      <IconButton onClick={() => reactFlowInstance.zoomOut()} title="缩小">
        <ZoomOut size={13} />
      </IconButton>
      <IconButton onClick={() => reactFlowInstance.fitView({ padding: 0.2 })} title="适应视图">
        <Maximize size={13} />
      </IconButton>
    </div>
  );
});
