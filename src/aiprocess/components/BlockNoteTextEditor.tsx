import { memo, useEffect, useRef, useCallback } from 'react';
import { useCreateBlockNote } from '@blocknote/react';
import { BlockNoteView } from '@blocknote/mantine';
import '@blocknote/core/fonts/inter.css';
import '@blocknote/mantine/style.css';
import '../../blocknote-overrides.css'; // Global overriding CSS for Canvas styling

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

  // Track the raw string length to detect massive external updates (i.e. API loads/streaming)
  const lastContentLengthRef = useRef(0);
  const internalChangeRef = useRef(false);

  // Sync external HTML into BlockNote Document payload
  useEffect(() => {
    if (!content) return;
    
    // If we just emitted this change ourselves, DO NOT re-parse it (avoids cursor reset loops)
    if (internalChangeRef.current) {
      internalChangeRef.current = false;
      return;
    }

    // Only force a full Document replacement if the incoming payload is massively different
    // (e.g., initial load, or a full regeneration drop). This avoids interrupting active typing.
    const diff = Math.abs(content.length - lastContentLengthRef.current);
    if (diff > 50 || lastContentLengthRef.current === 0) {
      try {
        const blocks = editor.tryParseHTMLToBlocks(content);
        if (blocks.length > 0) {
          editor.replaceBlocks(editor.document, blocks);
          lastContentLengthRef.current = content.length;
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
      lastContentLengthRef.current = html.length;
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
