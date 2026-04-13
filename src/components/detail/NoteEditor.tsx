import { memo, useState, useCallback, useEffect, useRef } from 'react';
import { useCreateBlockNote, getDefaultReactSlashMenuItems, SuggestionMenuController } from '@blocknote/react';
import { BlockNoteView } from '@blocknote/mantine';
import '@blocknote/core/fonts/inter.css';
import '@blocknote/mantine/style.css';
import '../../blocknote-overrides.css';
import { useCanvasStore } from '../../stores/canvasStore.ts';
import { canvasSyncApi } from '../../db/apiClient.ts';
import type { TextNodeData, MarkdownNodeData } from '../../types/index.ts';
import { NoteModal } from './NoteModal.tsx';
import { schema } from '../editor/schema.ts';
import { useInlineAIStore } from '../editor/inlineAIStore.ts';
import { RefreshCw } from 'lucide-react';

interface NoteEditorProps {
  nodeId: string;
  data: TextNodeData | MarkdownNodeData;
  transcriptionId?: string;
}

export const NoteEditor = memo(function NoteEditor({ nodeId, data, transcriptionId }: NoteEditorProps) {
  const updateNodeData = useCanvasStore((s) => s.updateNodeData);
  const nodes = useCanvasStore((s) => s.nodes);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const editorContainerRef = useRef<HTMLDivElement>(null);

  // Modal state for [[标题]] links
  const [modalOpen, setModalOpen] = useState(false);
  const [modalTitle, setModalTitle] = useState('');
  const [modalContent, setModalContent] = useState('');

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

  // Create BlockNote editor with custom schema (includes AI inline block)
  const editor = useCreateBlockNote({
    schema,
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

    const loadContent = (html: string) => {
      try {
        const blocks = editor.tryParseHTMLToBlocks(html);
        if (blocks.length > 0) {
          editor.replaceBlocks(editor.document, blocks);
        }
      } catch {
        // If parsing fails, leave default empty block
      }
    };

    if (transcriptionId) {
      // Fetch latest content from AI Process, then load into editor
      canvasSyncApi.getTranscriptionContent(transcriptionId).then(res => {
        const freshContent = res.content || '';
        // Also sync metadata back to canvas node
        updateNodeData(nodeId, {
          title: res.title,
          content: freshContent,
          tags: res.tags || [],
          metadata: { ...(data as MarkdownNodeData).metadata, ...res.metadata },
        });
        if (freshContent) loadContent(freshContent);
      }).catch(() => {
        // Fallback to local content
        if (data.content) loadContent(data.content);
      });
    } else if (data.content) {
      loadContent(data.content);
    }
  }, [editor, data.content, transcriptionId, nodeId, updateNodeData]);

  // Refresh from AI Process (manual pull)
  const handleRefreshFromAIProcess = useCallback(async () => {
    if (!transcriptionId) return;
    try {
      const res = await canvasSyncApi.getTranscriptionContent(transcriptionId);
      const freshContent = res.content || '';
      updateNodeData(nodeId, {
        title: res.title,
        content: freshContent,
        tags: res.tags || [],
        metadata: { ...(data as MarkdownNodeData).metadata, ...res.metadata },
      });
      if (freshContent) {
        try {
          const blocks = editor.tryParseHTMLToBlocks(freshContent);
          if (blocks.length > 0) {
            editor.replaceBlocks(editor.document, blocks);
          }
        } catch { /* ignore */ }
      }
    } catch (e) {
      console.error('Failed to refresh from AI Process:', e);
    }
  }, [transcriptionId, editor, nodeId, updateNodeData, data]);

  // Handle changes — debounce save back as HTML + sync to AI Process if linked
  const handleChange = useCallback(() => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(async () => {
      let html = await editor.blocksToHTMLLossy();
      html = html.replace(/<p><\/p>/g, '<p><br></p>');
      updateNodeData(nodeId, { content: html });
      // If linked to AI Process transcription, sync content back
      if (transcriptionId) {
        canvasSyncApi.updateTranscriptionContent(transcriptionId, html).catch(e => {
          console.error('Failed to sync content back to AI Process:', e);
        });
      }
    }, 500);
  }, [editor, nodeId, updateNodeData, transcriptionId]);

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

  // Cleanup: flush pending edits on unmount and abort any active streaming
  useEffect(() => {
    return () => {
      // Abort all active inline AI streaming
      useInlineAIStore.getState().abortAll();

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
      {/* AI Process sync badge */}
      {transcriptionId && (
        <div className="flex items-center justify-between px-4 py-2 border-b border-slate-100 shrink-0">
          <span className="text-[11px] text-blue-500 font-medium flex items-center gap-1.5">
            <span className="w-4 h-4 rounded bg-blue-100 text-blue-600 text-[9px] font-bold flex items-center justify-center">AI</span>
            AI Process 同步笔记
          </span>
          <button
            onClick={handleRefreshFromAIProcess}
            className="p-1 text-slate-400 hover:text-slate-600 rounded hover:bg-slate-100"
            title="从 AI Process 刷新最新内容"
          >
            <RefreshCw size={13} />
          </button>
        </div>
      )}
      {/* BlockNote editor */}
      <div className="flex-1 overflow-y-auto" ref={editorContainerRef}>
        <BlockNoteView
          editor={editor}
          onChange={handleChange}
          theme="light"
          slashMenu={false}
        >
          <SuggestionMenuController
            triggerCharacter="/"
            getItems={async (query) => {
              const defaultItems = getDefaultReactSlashMenuItems(editor);
              const aiItem = {
                title: 'AI 生成块',
                subtext: '插入 AI 分析/生成块',
                aliases: ['ai', 'generate', '智能', '生成', 'aiblock'],
                group: 'AI',
                onItemClick: () => {
                  const currentBlock = editor.getTextCursorPosition().block;
                  editor.insertBlocks(
                    [{
                      type: 'aiInline' as any,
                      props: {
                        blockId: crypto.randomUUID(),
                        status: 'idle',
                      },
                    }],
                    currentBlock,
                    'after'
                  );
                },
              };
              return [aiItem, ...defaultItems].filter(
                (item) => {
                  const q = query.toLowerCase();
                  return !q ||
                    item.title.toLowerCase().includes(q) ||
                    item.aliases?.some((a: string) => a.toLowerCase().includes(q)) ||
                    item.group?.toLowerCase().includes(q);
                }
              );
            }}
          />
        </BlockNoteView>
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
