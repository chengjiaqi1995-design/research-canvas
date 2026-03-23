import { memo, useState, useCallback, useEffect, useRef } from 'react';
import { useCreateBlockNote } from '@blocknote/react';
import { BlockNoteView } from '@blocknote/mantine';
import '@blocknote/core/fonts/inter.css';
import '@blocknote/mantine/style.css';
import '../../blocknote-overrides.css';
import { useCanvasStore } from '../../stores/canvasStore.ts';
import type { MarkdownNodeData } from '../../types/index.ts';
import { marked } from 'marked';

interface MarkdownViewerProps {
  nodeId: string;
  data: MarkdownNodeData;
}

export const MarkdownViewer = memo(function MarkdownViewer({ nodeId, data }: MarkdownViewerProps) {
  const updateNodeData = useCanvasStore((s) => s.updateNodeData);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Title editing
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [editTitle, setEditTitle] = useState(data.title);

  const handleSaveTitle = useCallback(() => {
    if (editTitle.trim()) {
      updateNodeData(nodeId, { title: editTitle.trim() });
    }
    setIsEditingTitle(false);
  }, [editTitle, nodeId, updateNodeData]);

  // Convert markdown to HTML for BlockNote to parse
  const htmlFromMarkdown = (() => {
    try {
      return marked.parse(data.content, { async: false }) as string;
    } catch {
      return `<p>${data.content}</p>`;
    }
  })();

  const editor = useCreateBlockNote({
    initialContent: undefined,
    uploadFile: async (file: File) => {
      const token = localStorage.getItem('rc_auth_user');
      const credential = token ? JSON.parse(token)._credential : null;
      if (!credential) throw new Error('Not authenticated');

      const formData = new FormData();
      formData.append('file', file);

      const res = await fetch('/api/upload', {
        method: 'POST',
        headers: { Authorization: `Bearer ${credential}` },
        body: formData,
      });
      if (!res.ok) throw new Error('Upload failed');
      const { url } = await res.json();
      return url;
    },
  });

  // Load markdown content (converted to HTML) into BlockNote
  const initializedRef = useRef(false);
  useEffect(() => {
    if (initializedRef.current) return;
    initializedRef.current = true;

    if (htmlFromMarkdown) {
      try {
        const blocks = editor.tryParseHTMLToBlocks(htmlFromMarkdown);
        if (blocks.length > 0) {
          editor.replaceBlocks(editor.document, blocks);
        }
      } catch {
        // If parsing fails, leave default empty block
      }
    }
  }, [editor, htmlFromMarkdown]);

  // Handle changes — debounce save back as HTML
  const handleChange = useCallback(() => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(async () => {
      const html = await editor.blocksToHTMLLossy();
      updateNodeData(nodeId, { content: html });
    }, 500);
  }, [editor, nodeId, updateNodeData]);

  useEffect(() => {
    return () => {
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
        try {
          const html = editor.blocksToHTMLLossy();
          if (html && typeof html === 'string') {
            updateNodeData(nodeId, { content: html });
          }
        } catch {
          // editor may already be destroyed
        }
      }
    };
  }, [editor, nodeId, updateNodeData]);

  return (
    <div className="flex flex-col h-full">
      {/* Editable title */}
      <div className="px-4 pt-3 pb-2 shrink-0">
        {isEditingTitle ? (
          <div className="flex items-center gap-2">
            <input
              autoFocus
              value={editTitle}
              onChange={(e) => setEditTitle(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleSaveTitle();
                if (e.key === 'Escape') {
                  setEditTitle(data.title);
                  setIsEditingTitle(false);
                }
              }}
              onBlur={handleSaveTitle}
              className="flex-1 text-lg font-semibold border-b-2 border-indigo-400 outline-none pb-1 bg-transparent"
            />
            <button
              onClick={handleSaveTitle}
              className="text-xs text-indigo-500 px-2 py-0.5 rounded hover:bg-indigo-50"
            >
              OK
            </button>
          </div>
        ) : (
          <h2
            className="text-lg font-semibold text-slate-800 cursor-pointer hover:text-indigo-600 transition-colors"
            onClick={() => {
              setEditTitle(data.title);
              setIsEditingTitle(true);
            }}
          >
            {data.title}
          </h2>
        )}
      </div>

      {/* Metadata Tags */}
      {data.type === 'markdown' && data.metadata && Object.keys(data.metadata).length > 0 && (
        <div className="flex flex-wrap gap-2 px-4 pb-3 shrink-0">
          {Object.entries(data.metadata).map(([key, value]) => (
            <span key={key} className="inline-flex items-center gap-1.5 bg-indigo-50/80 text-indigo-700 border border-indigo-100 rounded-full px-2.5 py-1 text-xs font-medium transition-colors hover:bg-indigo-100 cursor-default shadow-[0_1px_2px_rgba(0,0,0,0.02)]">
              <span className="opacity-60 font-medium">{key}:</span>
              <span>{value}</span>
            </span>
          ))}
        </div>
      )}

      {/* BlockNote editor */}
      <div className="flex-1 overflow-y-auto">
        <BlockNoteView
          editor={editor}
          onChange={handleChange}
          theme="light"
        />
      </div>
    </div>
  );
});
