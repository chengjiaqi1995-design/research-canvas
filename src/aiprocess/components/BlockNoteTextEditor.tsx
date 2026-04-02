import { memo, useEffect, useRef, useCallback } from 'react';
import { useCreateBlockNote } from '@blocknote/react';
import { BlockNoteView } from '@blocknote/mantine';
import '@blocknote/core/fonts/inter.css';
import '@blocknote/mantine/style.css';
import '../../blocknote-overrides.css'; // Global overriding CSS for Canvas styling

const LS_TEXT_COLOR = 'bn_lastTextColor';
const LS_BG_COLOR = 'bn_lastBgColor';

/** Detect if a string is already well-formed HTML (has block-level closing tags) */
function isHtml(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed.startsWith('<')) return false;
  return /<\/(p|h[1-6]|ul|ol|li|div|table|blockquote)>/i.test(trimmed);
}

interface BlockNoteTextEditorProps {
  content: string;
  onChange?: (html: string) => void;
  editable?: boolean;
  placeholder?: string;
  hideToolbar?: boolean;
  className?: string;
}

const BlockNoteTextEditor = memo(function BlockNoteTextEditor({
  content,
  onChange,
  editable = true,
  hideToolbar,
  className = '',
}: BlockNoteTextEditorProps) {
  // Create the editor engine
  const editor = useCreateBlockNote({
    initialContent: undefined, // Let the effect mount the HTML to prevent racing
    uploadFile: async (file: File) => {
      // Stub file upload logic
      return URL.createObjectURL(file);
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
        // 已保存的 HTML → tryParseHTMLToBlocks；原始 Markdown → tryParseMarkdownToBlocks（保留标题、粗体等格式）
        const blocks = isHtml(content)
          ? editor.tryParseHTMLToBlocks(content)
          : editor.tryParseMarkdownToBlocks(content);
        if (blocks.length > 0) {
          editor.replaceBlocks(editor.document, blocks);
          lastLoadedContentRef.current = content;
        }
      } catch (err) {
        console.warn('BlockNote could not parse legacy HTML payloads:', err);
      }
    }
  }, [editor, content]);

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
    <div className={`w-full h-full flex flex-col bg-white overflow-y-auto ${className}`}>
      <BlockNoteView
        editor={editor}
        theme="light"
        editable={editable}
        onChange={handleChange}
        className="flex-1"
      />
    </div>
  );
});

export default BlockNoteTextEditor;
