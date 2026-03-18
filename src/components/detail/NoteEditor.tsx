import { memo, useState, useCallback, useEffect, useRef } from 'react';
import { useCreateBlockNote } from '@blocknote/react';
import { BlockNoteView } from '@blocknote/mantine';
import '@blocknote/core/fonts/inter.css';
import '@blocknote/mantine/style.css';
import '../../blocknote-overrides.css';
import { useCanvasStore } from '../../stores/canvasStore.ts';
import type { TextNodeData, MarkdownNodeData } from '../../types/index.ts';
import { NoteModal } from './NoteModal.tsx';

interface NoteEditorProps {
  nodeId: string;
  data: TextNodeData | MarkdownNodeData;
}

export const NoteEditor = memo(function NoteEditor({ nodeId, data }: NoteEditorProps) {
  const updateNodeData = useCanvasStore((s) => s.updateNodeData);
  const nodes = useCanvasStore((s) => s.nodes);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const editorContainerRef = useRef<HTMLDivElement>(null);

  // Modal state for [[标题]] links
  const [modalOpen, setModalOpen] = useState(false);
  const [modalTitle, setModalTitle] = useState('');
  const [modalContent, setModalContent] = useState('');

  // Title editing
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [editTitle, setEditTitle] = useState(data.title);

  const handleSaveTitle = useCallback(() => {
    if (editTitle.trim()) {
      updateNodeData(nodeId, { title: editTitle.trim() });
    }
    setIsEditingTitle(false);
  }, [editTitle, nodeId, updateNodeData]);

  // Create BlockNote editor with initial content from HTML
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

  // Load initial content from HTML
  const initializedRef = useRef(false);
  useEffect(() => {
    if (initializedRef.current) return;
    initializedRef.current = true;

    if (data.content) {
      try {
        const blocks = editor.tryParseHTMLToBlocks(data.content);
        if (blocks.length > 0) {
          editor.replaceBlocks(editor.document, blocks);
        }
      } catch {
        // If parsing fails, leave default empty block
      }
    }
  }, [editor, data.content]);

  // Handle changes — debounce save back as HTML
  const handleChange = useCallback(() => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(async () => {
      const html = await editor.blocksToHTMLLossy();
      updateNodeData(nodeId, { content: html });
    }, 500);
  }, [editor, nodeId, updateNodeData]);

  // Process [[标题]] links in the rendered DOM
  useEffect(() => {
    const container = editorContainerRef.current;
    if (!container) return;

    const processLinks = () => {
      // Find all text nodes containing [[...]]
      const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, {
        acceptNode: (node) =>
          node.textContent && /\[\[.+?\]\]/.test(node.textContent)
            ? NodeFilter.FILTER_ACCEPT
            : NodeFilter.FILTER_REJECT,
      });

      const textNodes: Text[] = [];
      let current: Text | null;
      while ((current = walker.nextNode() as Text | null)) {
        // Skip if parent is already a ref-link
        if ((current.parentElement as HTMLElement)?.classList?.contains('ref-link')) continue;
        textNodes.push(current);
      }

      for (const textNode of textNodes) {
        const text = textNode.textContent || '';
        const parts = text.split(/(\[\[.+?\]\])/g);
        if (parts.length <= 1) continue;

        const frag = document.createDocumentFragment();
        for (const part of parts) {
          const match = part.match(/^\[\[(.+?)\]\]$/);
          if (match) {
            const title = match[1];
            const span = document.createElement('span');
            span.className = 'ref-link';
            span.textContent = title;
            span.style.color = '#3b82f6';
            span.style.cursor = 'pointer';
            span.style.textDecoration = 'underline';
            span.style.textUnderlineOffset = '2px';
            span.addEventListener('click', (e) => {
              e.preventDefault();
              e.stopPropagation();
              // Find matching node by title
              const matched = nodes.find((n) => n.data.title === title);
              if (matched) {
                setModalTitle(matched.data.title || '');
                setModalContent((matched.data as { content?: string }).content ?? '');
                setModalOpen(true);
              }
            });
            frag.appendChild(span);
          } else {
            frag.appendChild(document.createTextNode(part));
          }
        }
        textNode.parentNode?.replaceChild(frag, textNode);
      }
    };

    // Process initially after a short delay for BlockNote to render
    const timer = setTimeout(processLinks, 500);

    // Re-process when DOM changes (e.g. after edits)
    const observer = new MutationObserver(() => {
      setTimeout(processLinks, 100);
    });
    observer.observe(container, { childList: true, subtree: true, characterData: true });

    return () => {
      clearTimeout(timer);
      observer.disconnect();
    };
  }, [nodes]);

  // Cleanup: flush pending edits on unmount so nothing is lost
  useEffect(() => {
    return () => {
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
        // Synchronously flush the last editor state to the store
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
              setEditTitle(data.title);
              setIsEditingTitle(true);
            }}
          >
            {data.title}
          </h2>
        )}
      </div>

      {/* BlockNote editor */}
      <div className="flex-1 overflow-y-auto" ref={editorContainerRef}>
        <BlockNoteView
          editor={editor}
          onChange={handleChange}
          theme="light"
        />
      </div>

      {/* Modal for viewing referenced notes */}
      <NoteModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={modalTitle}
        content={modalContent}
      />
    </div>
  );
});
