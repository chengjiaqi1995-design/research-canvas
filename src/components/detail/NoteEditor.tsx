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

  // Auto-migrate legacy '标签' metadata to standalone 'tags'
  useEffect(() => {
    if (data.type === 'markdown' && data.metadata && data.metadata['标签']) {
      const splitTags = data.metadata['标签'].split(',').map(s => s.trim()).filter(Boolean);
      const newTags = Array.from(new Set([...(data.tags || []), ...splitTags]));
      const newMeta = { ...data.metadata };
      delete newMeta['标签'];
      updateNodeData(nodeId, { tags: newTags, metadata: newMeta });
    }
  }, [data.type, data.metadata, data.tags, nodeId, updateNodeData]);

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

  // Helper: find a canvas node matching a [[title]]
  const findNodeByTitle = useCallback((title: string) => {
    return nodes.find((n) => n.data.title === title)
      || nodes.find((n) => (n.data.title || '').includes(title))
      || nodes.find((n) => {
        const t = n.data.title;
        return t && t.length > 0 && title.includes(t);
      })
      || null;
  }, [nodes]);

  // Process [[标题]] links in the rendered DOM
  const isProcessingRef = useRef(false);
  useEffect(() => {
    const container = editorContainerRef.current;
    if (!container) return;

    const processLinks = () => {
      if (isProcessingRef.current) return;
      isProcessingRef.current = true;

      try {
        const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, {
          acceptNode: (node) => {
            if ((node.parentElement as HTMLElement)?.classList?.contains('ref-link')) {
              return NodeFilter.FILTER_REJECT;
            }
            // Use a fresh regex each time (no g flag issue)
            return node.textContent && /\[\[.+?\]\]/.test(node.textContent)
              ? NodeFilter.FILTER_ACCEPT
              : NodeFilter.FILTER_REJECT;
          },
        });

        const textNodes: Text[] = [];
        let current: Text | null;
        while ((current = walker.nextNode() as Text | null)) {
          textNodes.push(current);
        }

        for (const textNode of textNodes) {
          const text = textNode.textContent || '';
          // Use non-global regex for split
          const parts = text.split(/(\[\[.+?\]\])/);
          if (parts.length <= 1) continue;

          const frag = document.createDocumentFragment();
          for (const part of parts) {
            if (!part) continue;
            const match = part.match(/^\[\[(.+?)\]\]$/);
            if (match) {
              const title = match[1];
              const matched = findNodeByTitle(title);
              if (matched) {
                const span = document.createElement('span');
                span.className = 'ref-link';
                span.textContent = title;
                span.style.color = '#3b82f6';
                span.style.cursor = 'pointer';
                span.style.textDecoration = 'underline';
                span.style.textUnderlineOffset = '2px';
                span.style.fontWeight = '500';
                span.addEventListener('click', (e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setModalTitle(matched.data.title || '');
                  setModalContent((matched.data as { content?: string }).content ?? '');
                  setModalOpen(true);
                });
                frag.appendChild(span);
              } else {
                frag.appendChild(document.createTextNode(part));
              }
            } else {
              frag.appendChild(document.createTextNode(part));
            }
          }
          textNode.parentNode?.replaceChild(frag, textNode);
        }
      } finally {
        isProcessingRef.current = false;
      }
    };

    const timer = setTimeout(processLinks, 500);
    const observer = new MutationObserver(() => {
      if (!isProcessingRef.current) {
        setTimeout(processLinks, 200);
      }
    });
    observer.observe(container, { childList: true, subtree: true, characterData: true });

    return () => {
      clearTimeout(timer);
      observer.disconnect();
    };
  }, [nodes, findNodeByTitle]);

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

      {/* Metadata Tags */}
      {data.type === 'markdown' && data.metadata && (
        <div className="flex flex-wrap gap-2 px-4 pb-3 shrink-0">
          {Object.entries(data.metadata).map(([key, value]) => (
            <span key={key} className="group inline-flex items-center gap-1.5 bg-indigo-50/80 text-indigo-700 border border-indigo-100 rounded-full pl-2.5 pr-2 py-1 text-xs font-medium transition-colors hover:bg-indigo-100 shadow-[0_1px_2px_rgba(0,0,0,0.02)] focus-within:ring-2 focus-within:ring-indigo-300">
              <span 
                className="opacity-70 font-semibold outline-none cursor-text border-b border-transparent focus:border-indigo-400 pb-[1px]"
                contentEditable
                suppressContentEditableWarning
                onBlur={(e) => {
                  let newKey = e.currentTarget.textContent || '';
                  if (newKey.endsWith(':')) newKey = newKey.slice(0, -1);
                  if (newKey && newKey !== key) {
                    const newMetadata = { ...data.metadata };
                    newMetadata[newKey] = newMetadata[key]; // Copy value to new key
                    delete newMetadata[key]; // Delete old key
                    updateNodeData(nodeId, { metadata: newMetadata });
                  }
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    e.currentTarget.blur();
                  }
                }}
              >
                {key}:
              </span>
              <span 
                className="outline-none min-w-[20px] cursor-text border-b border-transparent focus:border-indigo-400 pb-[1px]"
                contentEditable
                suppressContentEditableWarning
                onBlur={(e) => {
                  const newVal = e.currentTarget.textContent || '';
                  if (newVal !== value) {
                    const newMetadata = { ...data.metadata, [key]: newVal };
                    updateNodeData(nodeId, { metadata: newMetadata });
                  }
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    e.currentTarget.blur();
                  }
                }}
              >
                {value}
              </span>
              <button
                onClick={() => {
                  const newMetadata = { ...data.metadata };
                  delete newMetadata[key];
                  updateNodeData(nodeId, { metadata: newMetadata });
                }}
                className="opacity-0 group-hover:opacity-100 flex items-center justify-center w-3.5 h-3.5 rounded-full hover:bg-indigo-200 text-indigo-400 hover:text-indigo-800 transition-all font-bold cursor-pointer outline-none"
                title="删除标签"
              >
                ×
              </button>
            </span>
          ))}
          <button
            onClick={() => {
              const newKey = `新要素-${Date.now().toString().slice(-4)}`;
              const newMetadata = { ...data.metadata, [newKey]: "待填写" };
              updateNodeData(nodeId, { metadata: newMetadata });
            }}
            className="inline-flex items-center justify-center bg-gray-50/80 text-gray-500 border border-gray-200 border-dashed rounded-full px-3 py-1 text-xs font-medium transition-colors hover:bg-gray-100 hover:text-gray-700 cursor-pointer shadow-sm"
            title="添加新要素"
          >
            + 添加要素
          </button>
        </div>
      )}

      {/* Independent Custom Tags View */}
      {data.type === 'markdown' && (data.tags !== undefined) && (
        <div className="flex flex-wrap gap-2 px-4 pb-4 shrink-0">
          {data.tags.map((tag, idx) => (
            <span key={idx} className="group inline-flex items-center gap-1 bg-gray-100/80 text-gray-600 border border-gray-200 rounded-full pl-2.5 pr-1.5 py-1 text-xs font-medium transition-colors hover:bg-gray-200 shadow-[0_1px_2px_rgba(0,0,0,0.02)] focus-within:ring-2 focus-within:ring-gray-300">
              <span 
                className="outline-none min-w-[20px] cursor-text border-b border-transparent focus:border-gray-400 pb-[1px]"
                contentEditable
                suppressContentEditableWarning
                onBlur={(e) => {
                  const newVal = e.currentTarget.textContent || '';
                  const newTags = [...data.tags!];
                  if (newVal.trim() === '') {
                    newTags.splice(idx, 1);
                  } else {
                    newTags[idx] = newVal.trim();
                  }
                  if (JSON.stringify(newTags) !== JSON.stringify(data.tags)) {
                    updateNodeData(nodeId, { tags: newTags });
                  }
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    e.currentTarget.blur();
                  }
                }}
              >
                {tag}
              </span>
              <button
                onClick={() => {
                  const newTags = [...data.tags!];
                  newTags.splice(idx, 1);
                  updateNodeData(nodeId, { tags: newTags });
                }}
                className="opacity-0 group-hover:opacity-100 flex items-center justify-center w-3 h-3 rounded-full hover:bg-gray-300 text-gray-400 hover:text-gray-700 transition-all font-bold cursor-pointer outline-none ml-1"
                title="删除自定义标签"
              >
                ×
              </button>
            </span>
          ))}
          <button
            onClick={() => {
              const newTags = [...(data.tags || []), '新标签'];
              updateNodeData(nodeId, { tags: newTags });
            }}
            className="inline-flex items-center justify-center text-gray-400 border border-gray-200 border-dashed rounded-full px-2 py-0.5 text-[10px] font-medium transition-colors hover:bg-gray-100 hover:text-gray-600 cursor-pointer"
            title="添加独立标签"
          >
            + 标签
          </button>
        </div>
      )}

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
