import { memo, useEffect, useRef, useCallback } from 'react';
import { useCreateBlockNote } from '@blocknote/react';
import { BlockNoteView } from '@blocknote/mantine';
import { marked } from 'marked';
import '@blocknote/core/fonts/inter.css';
import '@blocknote/mantine/style.css';
import '../../blocknote-overrides.css'; // Global overriding CSS for Canvas styling

/** Detect if a string is already well-formed HTML (has block-level tags) */
function isHtml(text: string): boolean {
  const trimmed = text.trim();
  // Must start with a tag AND contain closing block-level tags
  if (!trimmed.startsWith('<')) return false;
  return /<\/(p|h[1-6]|ul|ol|li|div|table|blockquote)>/i.test(trimmed);
}

/** Convert Markdown to HTML, pass through if already HTML */
function ensureHtml(text: string): string {
  if (!text) return text;
  // If already well-formed HTML with block-level tags, pass through
  if (isHtml(text)) return text;
  // Otherwise, convert as Markdown (covers plain text, markdown, and mixed content)
  return marked.parse(text, { async: false }) as string;
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

  // Track the last externally-loaded content to detect real changes vs internal echoes
  const lastLoadedContentRef = useRef('');
  const internalChangeRef = useRef(false);

  // Sync external HTML into BlockNote Document payload
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
        const htmlContent = ensureHtml(content);
        const blocks = editor.tryParseHTMLToBlocks(htmlContent);
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
      const html = await editor.blocksToHTMLLossy();
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
