import { memo, useState, useCallback, useEffect, useRef } from 'react';
import { useCreateBlockNote } from '@blocknote/react';
import { BlockNoteView } from '@blocknote/mantine';
import '@blocknote/core/fonts/inter.css';
import '@blocknote/mantine/style.css';
import '../../blocknote-overrides.css';
import { useCanvasStore } from '../../stores/canvasStore.ts';
import { useAuthStore } from '../../stores/authStore.ts';
import type { MarkdownNodeData } from '../../types/index.ts';
import { useMermaidRender } from '../../hooks/useMermaidRender.ts';
import { fileApi } from '../../db/apiClient.ts';
import { schema } from '../editor/schema.ts';
import { markdownToHtmlWithMath } from '../../utils/mathMarkdown.ts';

interface MarkdownViewerProps {
  nodeId: string;
  data: MarkdownNodeData;
}

export const MarkdownViewer = memo(function MarkdownViewer({ nodeId, data }: MarkdownViewerProps) {
  const updateNodeData = useCanvasStore((s) => s.updateNodeData);
  const readOnly = useAuthStore((s) => s.user?.readOnly === true);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const editorContainerRef = useRef<HTMLDivElement>(null);
  useMermaidRender(editorContainerRef, [nodeId, data.content]);

  // Title editing
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [editTitle, setEditTitle] = useState(data.title);

  const handleSaveTitle = useCallback(() => {
    if (readOnly) {
      setIsEditingTitle(false);
      return;
    }
    if (editTitle.trim()) {
      updateNodeData(nodeId, { title: editTitle.trim() });
    }
    setIsEditingTitle(false);
  }, [editTitle, nodeId, updateNodeData, readOnly]);

  // Convert markdown to HTML for BlockNote to parse
  const htmlFromMarkdown = (() => {
    try {
      return markdownToHtmlWithMath(data.content);
    } catch {
      return `<p>${data.content}</p>`;
    }
  })();

  const editor = useCreateBlockNote({
    schema,
    initialContent: undefined,
    uploadFile: async (file: File) => {
      if (readOnly) throw new Error('只读模式不能上传文件');
      const uploaded = await fileApi.uploadAny(file);
      return {
        props: {
          url: uploaded.url,
          name: uploaded.originalName || file.name,
        },
      };
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
    if (readOnly) return;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(async () => {
      let html = await editor.blocksToHTMLLossy();
      html = html.replace(/<p><\/p>/g, '<p><br></p>');
      updateNodeData(nodeId, { content: html });
    }, 500);
  }, [editor, nodeId, updateNodeData, readOnly]);

  useEffect(() => {
    return () => {
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
        if (readOnly) return;
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
  }, [editor, nodeId, updateNodeData, readOnly]);

  return (
    <div className="flex h-full min-h-0 flex-col">
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
              className="flex-1 text-lg font-semibold border-b-2 border-blue-400 outline-none pb-1 bg-transparent"
            />
            <button
              onClick={handleSaveTitle}
              className="text-xs text-blue-500 px-2 py-0.5 rounded hover:bg-blue-50"
            >
              OK
            </button>
          </div>
        ) : (
          <h2
            className="text-lg font-semibold text-slate-800 cursor-pointer hover:text-blue-600 transition-colors"
            onClick={() => {
              if (readOnly) return;
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
            <span key={key} className="inline-flex items-center gap-1.5 bg-blue-50/80 text-blue-700 border border-blue-100 rounded-full px-2.5 py-1 text-xs font-medium transition-colors hover:bg-blue-100 cursor-default shadow-[0_1px_2px_rgba(0,0,0,0.02)]">
              <span className="opacity-60 font-medium">{key}:</span>
              <span>{value}</span>
            </span>
          ))}
        </div>
      )}

      {/* BlockNote editor */}
      <div ref={editorContainerRef} className="min-h-0 flex-1 overflow-y-auto">
        <BlockNoteView
          editor={editor}
          onChange={readOnly ? undefined : handleChange}
          editable={!readOnly}
          theme="light"
        />
      </div>
    </div>
  );
});
