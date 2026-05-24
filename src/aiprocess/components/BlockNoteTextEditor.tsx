import { memo, useEffect, useRef, useCallback, forwardRef, useImperativeHandle } from 'react';
import {
  BlockNoteSchema,
  createStyleSpec,
  defaultBlockSpecs,
  defaultInlineContentSpecs,
  defaultStyleSpecs,
} from '@blocknote/core';
import { useCreateBlockNote } from '@blocknote/react';
import { BlockNoteView } from '@blocknote/mantine';
import '@blocknote/core/fonts/inter.css';
import '@blocknote/mantine/style.css';
import '../../blocknote-overrides.css'; // Global overriding CSS for Canvas styling
import { useMermaidRender } from '../../hooks/useMermaidRender.ts';
import { fileApi } from '../../db/apiClient.ts';
import { MathFormulaInline } from '../../components/editor/mathFormulaInline.tsx';
import { containsMathDelimiters, markdownToHtmlWithMath, replaceMathDelimitersWithSpans } from '../../utils/mathMarkdown.ts';

const LS_TEXT_COLOR = 'bn_lastTextColor';
const LS_BG_COLOR = 'bn_lastBgColor';

const SourceCitation = createStyleSpec(
  {
    type: 'sourceCitation',
    propSchema: 'string',
  },
  {
    render: (value) => {
      const sup = document.createElement('sup');
      sup.className = 'source-cite';
      if (value) {
        sup.title = value;
        sup.dataset.sourceCite = value;
      }
      return {
        dom: sup,
        contentDOM: sup,
      };
    },
    toExternalHTML: (value) => {
      const sup = document.createElement('sup');
      sup.className = 'source-cite';
      if (value) {
        sup.title = value;
        sup.dataset.sourceCite = value;
      }
      return {
        dom: sup,
        contentDOM: sup,
      };
    },
    parse: (element) => {
      if (element.tagName !== 'SUP' || !element.classList.contains('source-cite')) {
        return undefined;
      }
      return element.getAttribute('data-value') ||
        element.getAttribute('data-source-cite') ||
        element.textContent?.trim() ||
        undefined;
    },
  },
);

const editorSchema = BlockNoteSchema.create({
  blockSpecs: defaultBlockSpecs,
  inlineContentSpecs: {
    ...defaultInlineContentSpecs,
    mathFormula: MathFormulaInline,
  },
  styleSpecs: {
    ...defaultStyleSpecs,
    sourceCitation: SourceCitation,
  },
});

/** Detect if a string is already well-formed HTML (has block-level closing tags) */
function isHtml(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed.startsWith('<')) return false;
  return /<\/(p|h[1-6]|ul|ol|li|div|table|blockquote)>/i.test(trimmed);
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderSourceCitation(title: string): string {
  const cleanTitle = title.trim();
  if (!cleanTitle) return '';
  const escapedTitle = escapeHtml(cleanTitle);
  return `<sup class="source-cite" data-style-type="sourceCitation" data-value="${escapedTitle}" data-source-cite="${escapedTitle}" title="${escapedTitle}">${escapedTitle}</sup>`;
}

function renderSourceCitationGroup(group: string): string {
  const citations: string[] = [];
  group.replace(/【\s*(?:源\s*\d+\s*[：:]\s*)?([^】]{1,80}?)\s*】/g, (_match, title) => {
    citations.push(renderSourceCitation(String(title)));
    return '';
  });
  return citations.join('');
}

function stripCitationPunctuation(text: string): string {
  return text
    .replace(/[（(]\s*((?:<sup\b[^>]*class=["'][^"']*source-cite[^"']*["'][\s\S]*?<\/sup>\s*(?:[、,，]\s*)?){1,8})\s*[）)]/g, (_match, group) => (
      String(group).replace(/\s*[、,，]\s*/g, '')
    ))
    .replace(/(<sup\b[^>]*class=["'][^"']*source-cite[^"']*["'][\s\S]*?<\/sup>)\s*[、,，]\s*(?=<sup\b[^>]*class=["'][^"']*source-cite)/g, '$1');
}

function hasSourceCitation(text: string): boolean {
  return /【\s*源\s*\d+\s*[：:]/.test(text) ||
    /【\s*[^】]{1,48}\s*】/.test(text);
}

function normalizeSourceCitations(text: string): string {
  const normalized = text
    .replace(/[（(]\s*((?:【\s*(?:源\s*\d+\s*[：:]\s*)?[^】]{1,80}?\s*】\s*(?:[、,，]\s*)?){1,8})\s*[）)]/g, (_match, group) => (
      renderSourceCitationGroup(String(group))
    ))
    .replace(/(?:【\s*(?:源\s*\d+\s*[：:]\s*)?[^】]{1,80}?\s*】\s*[、,，]\s*)+【\s*(?:源\s*\d+\s*[：:]\s*)?[^】]{1,80}?\s*】/g, (group) => (
      renderSourceCitationGroup(group)
    ))
    .replace(/【\s*源\s*\d+\s*[：:]\s*([^】]{1,80}?)\s*】/g, (_match, title) => (
      renderSourceCitation(String(title))
    ))
    .replace(/【\s*([^】]{1,48}?)\s*】/g, (_match, title) => (
      renderSourceCitation(String(title))
    ));

  return stripCitationPunctuation(normalized);
}

export interface BlockNoteTextEditorHandle {
  /** Append a plain-text paragraph at the end of the document and move cursor there. */
  insertParagraph: (text: string) => void;
}

interface BlockNoteTextEditorProps {
  content: string;
  onChange?: (html: string) => void;
  editable?: boolean;
  placeholder?: string;
  hideToolbar?: boolean;
  className?: string;
}

const BlockNoteTextEditor = memo(forwardRef<BlockNoteTextEditorHandle, BlockNoteTextEditorProps>(function BlockNoteTextEditor({
  content,
  onChange,
  editable = true,
  hideToolbar,
  className = '',
}, ref) {
  // Create the editor engine
  const editor = useCreateBlockNote({
    schema: editorSchema,
    initialContent: undefined, // Let the effect mount the HTML to prevent racing
    uploadFile: async (file: File) => {
      const uploaded = await fileApi.uploadAny(file);
      return {
        props: {
          url: uploaded.url,
          name: uploaded.originalName || file.name,
        },
      };
    },
  });

  // --- 拦截 addStyles / removeStyles，记住上次使用的颜色 ---
  const patchedRef = useRef(false);
  useEffect(() => {
    if (patchedRef.current) return;
    patchedRef.current = true;

    const origAdd = editor.addStyles.bind(editor);
    editor.addStyles = (styles: any) => {
      if (styles.textColor && styles.textColor !== 'default') {
        localStorage.setItem(LS_TEXT_COLOR, styles.textColor);
      }
      if (styles.backgroundColor && styles.backgroundColor !== 'default') {
        localStorage.setItem(LS_BG_COLOR, styles.backgroundColor);
      }
      return origAdd(styles);
    };
  }, [editor]);

  // --- 快捷键：Ctrl/Cmd+Shift+H = 上次高亮色，Ctrl/Cmd+Shift+T = 上次文字色 ---
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (!mod || !e.shiftKey) return;

      if (e.key === 'H' || e.key === 'h') {
        e.preventDefault();
        const lastBg = localStorage.getItem(LS_BG_COLOR) || 'yellow';
        editor.addStyles({ backgroundColor: lastBg });
      } else if (e.key === 'T' || e.key === 't') {
        e.preventDefault();
        const lastText = localStorage.getItem(LS_TEXT_COLOR) || 'red';
        editor.addStyles({ textColor: lastText });
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [editor]);

  // Track the last externally-loaded content to detect real changes vs internal echoes
  const lastLoadedContentRef = useRef('');
  const internalChangeRef = useRef(false);
  const editorContainerRef = useRef<HTMLDivElement>(null);
  useMermaidRender(editorContainerRef, [content, editable]);

  // Sync external content into BlockNote Document payload
  useEffect(() => {
    if (!content) return;

    // If we just emitted this change ourselves, DO NOT re-parse it (avoids cursor reset loops)
    if (internalChangeRef.current) {
      internalChangeRef.current = false;
      return;
    }

    // Skip if content hasn't meaningfully changed from what we last loaded
    if (content === lastLoadedContentRef.current) return;

    // Only force a full Document replacement if the incoming payload is significantly different
    // (e.g., initial load, or a full regeneration drop). This avoids interrupting active typing.
    const diff = Math.abs(content.length - lastLoadedContentRef.current.length);
    if (diff > 50 || lastLoadedContentRef.current === '') {
      try {
        const normalizedContent = normalizeSourceCitations(content);
        const hasMath = containsMathDelimiters(normalizedContent);
        // 已保存的 HTML → tryParseHTMLToBlocks；原始 Markdown → tryParseMarkdownToBlocks。
        // 含来源引用时先转成 HTML，保留自定义的 sourceCitation 角标样式。
        const blocks = isHtml(normalizedContent)
          ? editor.tryParseHTMLToBlocks(replaceMathDelimitersWithSpans(normalizedContent))
          : hasSourceCitation(content) || hasMath
            ? editor.tryParseHTMLToBlocks(markdownToHtmlWithMath(normalizedContent, { breaks: true, gfm: true }))
            : editor.tryParseMarkdownToBlocks(normalizedContent);
        if (blocks.length > 0) {
          editor.replaceBlocks(editor.document, blocks);
          lastLoadedContentRef.current = content;
        }
      } catch (err) {
        console.warn('BlockNote could not parse legacy HTML payloads:', err);
      }
    }
  }, [editor, content]);

  // Imperative API: append a paragraph at the end of the document
  useImperativeHandle(ref, () => ({
    insertParagraph: (text: string) => {
      if (!text || !text.trim()) return;
      try {
        const docBlocks = editor.document;
        const lastBlock = docBlocks[docBlocks.length - 1];
        const newBlock: any = { type: 'paragraph', content: text };
        if (lastBlock) {
          editor.insertBlocks([newBlock], lastBlock, 'after');
        } else {
          editor.replaceBlocks(editor.document, [newBlock]);
        }
      } catch (err) {
        console.warn('BlockNote insertParagraph failed:', err);
      }
    },
  }), [editor]);

  // Bubble up native BlockNote document changes back into standard HTML strings
  const handleChange = useCallback(async () => {
    if (!onChange) return;
    try {
      let html = await editor.blocksToHTMLLossy();
      html = html.replace(/<p><\/p>/g, '<p><br></p>');
      internalChangeRef.current = true;
      onChange(html);
    } catch (e) {}
  }, [editor, onChange]);

  return (
    <div ref={editorContainerRef} className={`w-full h-full flex flex-col bg-white overflow-y-auto ${className}`}>
      <BlockNoteView
        editor={editor}
        theme="light"
        editable={editable}
        onChange={handleChange}
        className="flex-1"
      />
    </div>
  );
}));

export default BlockNoteTextEditor;
