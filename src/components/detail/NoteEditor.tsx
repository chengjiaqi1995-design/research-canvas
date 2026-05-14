import { memo, useState, useCallback, useEffect, useRef } from 'react';
import { useCreateBlockNote, getDefaultReactSlashMenuItems, SuggestionMenuController } from '@blocknote/react';
import { BlockNoteView } from '@blocknote/mantine';
import '@blocknote/core/fonts/inter.css';
import '@blocknote/mantine/style.css';
import '../../blocknote-overrides.css';
import { useCanvasStore } from '../../stores/canvasStore.ts';
import { useAuthStore } from '../../stores/authStore.ts';
import { canvasSyncApi } from '../../db/apiClient.ts';
import type { TextNodeData, MarkdownNodeData } from '../../types/index.ts';
import { NoteModal } from './NoteModal.tsx';
import { schema } from '../editor/schema.ts';
import { useInlineAIStore } from '../editor/inlineAIStore.ts';
import { Link2, RefreshCw } from 'lucide-react';
import { getValidStoredSessionToken } from '../../utils/sessionAuth.ts';
import { makeAttachmentReferenceId, truncate, useAttachmentReferences } from '../../hooks/useAttachmentReferences.ts';
import type { CanvasAttachmentReference } from '../../types/index.ts';

interface NoteEditorProps {
  nodeId: string;
  data: TextNodeData | MarkdownNodeData;
  transcriptionId?: string;
}

export const NoteEditor = memo(function NoteEditor({ nodeId, data, transcriptionId }: NoteEditorProps) {
  const updateNodeData = useCanvasStore((s) => s.updateNodeData);
  const activeReference = useCanvasStore((s) => s.activeAttachmentReference);
  const clearActiveAttachmentReference = useCanvasStore((s) => s.clearActiveAttachmentReference);
  const nodes = useCanvasStore((s) => s.nodes);
  const readOnly = useAuthStore((s) => s.user?.readOnly === true);
  const { addReferenceToHome } = useAttachmentReferences();
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const editorContainerRef = useRef<HTMLDivElement>(null);

  // Modal state for [[标题]] links
  const [modalOpen, setModalOpen] = useState(false);
  const [modalTitle, setModalTitle] = useState('');
  const [modalContent, setModalContent] = useState('');
  const canCreateReference = !readOnly && (data.type === 'markdown' || data.type === 'text');

  // Auto-migrate legacy '标签' metadata to standalone 'tags'
  useEffect(() => {
    if (readOnly) return;
    if (data.type === 'markdown' && data.metadata && data.metadata['标签']) {
      const splitTags = data.metadata['标签'].split(',').map(s => s.trim()).filter(Boolean);
      const newTags = Array.from(new Set([...(data.tags || []), ...splitTags]));
      const newMeta = { ...data.metadata };
      delete newMeta['标签'];
      updateNodeData(nodeId, { tags: newTags, metadata: newMeta });
    }
  }, [data.type, data.metadata, data.tags, nodeId, updateNodeData, readOnly]);

  // Create BlockNote editor with custom schema (includes AI inline block)
  const editor = useCreateBlockNote({
    schema,
    initialContent: undefined,
    uploadFile: async (file: File) => {
      if (readOnly) throw new Error('只读模式不能上传文件');
      const credential = getValidStoredSessionToken({
        allowSessionToken: true,
        cleanupInvalid: true,
        normalizeSessionToken: true,
      });
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
        if (!readOnly) {
          updateNodeData(nodeId, {
            title: res.title,
            content: freshContent,
            tags: res.tags || [],
            metadata: { ...(data as MarkdownNodeData).metadata, ...res.metadata },
          });
        }
        if (freshContent) loadContent(freshContent);
      }).catch(() => {
        // Fallback to local content
        if (data.content) loadContent(data.content);
      });
    } else if (data.content) {
      loadContent(data.content);
    }
  }, [editor, data.content, transcriptionId, nodeId, updateNodeData, readOnly, data]);

  // Refresh from AI Process (manual pull)
  const handleRefreshFromAIProcess = useCallback(async () => {
    if (!transcriptionId) return;
    try {
      const res = await canvasSyncApi.getTranscriptionContent(transcriptionId);
      const freshContent = res.content || '';
      if (!readOnly) {
        updateNodeData(nodeId, {
          title: res.title,
          content: freshContent,
          tags: res.tags || [],
          metadata: { ...(data as MarkdownNodeData).metadata, ...res.metadata },
        });
      }
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
  }, [transcriptionId, editor, nodeId, updateNodeData, data, readOnly]);

  const handleCreateReference = useCallback(() => {
    if (!canCreateReference || !editorContainerRef.current) return;
    const selection = window.getSelection();
    const selectedText = selection?.toString().replace(/\s+/g, ' ').trim() || '';
    const anchorNode = selection?.anchorNode;
    if (!selectedText || !anchorNode || !editorContainerRef.current.contains(anchorNode)) {
      alert('请先在附件正文里选中一段文字，再生成引用。');
      return;
    }
    const note = window.prompt('给这条引用加一句备注（可选）', '') || '';
    const sourceType = data.type === 'markdown' ? 'markdown' : 'text';
    const reference: CanvasAttachmentReference = {
      id: makeAttachmentReferenceId(),
      sourceNodeId: nodeId,
      sourceType,
      sourceTitle: data.title,
      title: truncate(selectedText, 64),
      note: note.trim(),
      quote: selectedText,
      anchor: {
        type: sourceType,
        textQuote: selectedText,
      },
      preview: {
        kind: 'quote',
        text: selectedText,
      },
      createdAt: Date.now(),
    };
    updateNodeData(nodeId, {
      annotations: [...(((data as MarkdownNodeData | TextNodeData).annotations) || []), reference],
    });
    addReferenceToHome(reference);
  }, [addReferenceToHome, canCreateReference, data, nodeId, updateNodeData]);

  const jumpToReference = useCallback((reference: CanvasAttachmentReference) => {
    const container = editorContainerRef.current;
    if (!container || (reference.anchor.type !== 'markdown' && reference.anchor.type !== 'text')) return;
    const quote = reference.anchor.textQuote || reference.quote || '';
    const normalizedQuote = quote.replace(/\s+/g, ' ').trim();
    if (!normalizedQuote) return;
    const needle = normalizedQuote.slice(0, Math.min(80, normalizedQuote.length));
    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, {
      acceptNode: (node) => {
        const text = node.textContent?.replace(/\s+/g, ' ').trim() || '';
        return text.includes(needle) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
      },
    });
    const textNode = walker.nextNode() as Text | null;
    const target = textNode?.parentElement;
    if (!target) return;
    target.scrollIntoView({ block: 'center', behavior: 'smooth' });
    const previousOutline = target.style.outline;
    const previousBackground = target.style.backgroundColor;
    target.style.outline = '3px solid rgba(245, 158, 11, 0.85)';
    target.style.backgroundColor = 'rgba(254, 243, 199, 0.85)';
    window.setTimeout(() => {
      target.style.outline = previousOutline;
      target.style.backgroundColor = previousBackground;
    }, 2400);
  }, []);

  useEffect(() => {
    if (!activeReference || activeReference.sourceNodeId !== nodeId) return;
    if (activeReference.anchor.type !== 'markdown' && activeReference.anchor.type !== 'text') return;
    const timer = window.setTimeout(() => {
      jumpToReference(activeReference);
      clearActiveAttachmentReference();
    }, 250);
    return () => window.clearTimeout(timer);
  }, [activeReference, clearActiveAttachmentReference, jumpToReference, nodeId]);

  // Handle changes — debounce save
  // Synced notes: content ONLY writes to AI Process (single source of truth)
  // Regular notes: content writes to canvas bundle
  const handleChange = useCallback(() => {
    if (readOnly) return;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(async () => {
      let html = await editor.blocksToHTMLLossy();
      html = html.replace(/<p><\/p>/g, '<p><br></p>');
      if (transcriptionId) {
        // Single source: only write to AI Process
        canvasSyncApi.updateTranscriptionContent(transcriptionId, html).catch(e => {
          console.error('Failed to sync content to AI Process:', e);
        });
      } else {
        updateNodeData(nodeId, { content: html });
      }
    }, 500);
  }, [editor, nodeId, updateNodeData, transcriptionId, readOnly]);

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
        if (readOnly) return;
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
  }, [editor, nodeId, updateNodeData, readOnly]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      {(transcriptionId || canCreateReference) && (
        <div className="flex items-center justify-between px-4 py-2 border-b border-slate-100 shrink-0">
          <div className="flex min-w-0 items-center gap-2">
            {transcriptionId && (
              <span className="text-[11px] text-blue-500 font-medium flex items-center gap-1.5">
                <span className="w-4 h-4 rounded bg-blue-100 text-blue-600 text-[9px] font-bold flex items-center justify-center">AI</span>
                AI Process 同步笔记
              </span>
            )}
            {canCreateReference && (
              <button
                onClick={handleCreateReference}
                className="inline-flex items-center gap-1.5 rounded border border-blue-100 bg-blue-50 px-2 py-1 text-[11px] font-medium text-blue-600 hover:bg-blue-100"
                title="选中正文后，插入到 Canvas 主页引用卡片"
              >
                <Link2 size={12} />
                引用选中
              </button>
            )}
          </div>
          {transcriptionId && (
            <button
              onClick={handleRefreshFromAIProcess}
              className="p-1 text-slate-400 hover:text-slate-600 rounded hover:bg-slate-100"
              title="从 AI Process 刷新最新内容"
            >
              <RefreshCw size={13} />
            </button>
          )}
        </div>
      )}
      {/* BlockNote editor */}
      <div className="min-h-0 flex-1 overflow-y-auto" ref={editorContainerRef}>
        <BlockNoteView
          editor={editor}
          onChange={readOnly ? undefined : handleChange}
          editable={!readOnly}
          theme="light"
          slashMenu={false}
        >
          {!readOnly && (
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
          )}
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
