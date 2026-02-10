import { memo, useState, useCallback, useEffect, useRef, useMemo } from 'react';
import {
  EditorRoot,
  EditorContent,
  EditorCommand,
  EditorCommandItem,
  EditorCommandEmpty,
  EditorBubble,
  EditorBubbleItem,
  type JSONContent,
  handleCommandNavigation,
  createSuggestionItems,
  StarterKit,
  Placeholder,
  TiptapLink,
  TiptapUnderline,
  TiptapImage,
  HighlightExtension,
  HorizontalRule,
  TaskList,
  TaskItem,
  TextStyle,
  Color,
  handleImagePaste,
  handleImageDrop,
  createImageUpload,
} from 'novel';
import { useCanvasStore } from '../../stores/canvasStore.ts';
import type { TextNodeData } from '../../types/index.ts';
import {
  Heading1,
  Heading2,
  Heading3,
  List,
  ListOrdered,
  TextQuote,
  Code,
  Minus,
  CheckSquare,
  Bold,
  Italic,
  Underline,
  Strikethrough,
  Code2,
  Highlighter,
} from 'lucide-react';

/** Convert file to base64 data URI (for image paste) */
function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

/** Image upload handler: converts to base64 inline */
const uploadImage = createImageUpload({
  onUpload: async (file: File) => {
    return await fileToBase64(file);
  },
  validateFn: (file: File) => {
    if (!file.type.startsWith('image/')) return false;
    if (file.size > 20 * 1024 * 1024) {
      alert('图片大小不能超过 20MB');
      return false;
    }
    return true;
  },
});

interface NoteEditorProps {
  nodeId: string;
  data: TextNodeData;
}

// ─── Slash Command Items ──────────────────────────────────────
const suggestionItems = createSuggestionItems([
  {
    title: '标题 1',
    description: '大标题',
    icon: <Heading1 size={18} />,
    searchTerms: ['heading', 'h1', '标题'],
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).setNode('heading', { level: 1 }).run();
    },
  },
  {
    title: '标题 2',
    description: '中标题',
    icon: <Heading2 size={18} />,
    searchTerms: ['heading', 'h2'],
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).setNode('heading', { level: 2 }).run();
    },
  },
  {
    title: '标题 3',
    description: '小标题',
    icon: <Heading3 size={18} />,
    searchTerms: ['heading', 'h3'],
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).setNode('heading', { level: 3 }).run();
    },
  },
  {
    title: '无序列表',
    description: '项目符号列表',
    icon: <List size={18} />,
    searchTerms: ['bullet', 'list', 'ul'],
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).toggleBulletList().run();
    },
  },
  {
    title: '有序列表',
    description: '编号列表',
    icon: <ListOrdered size={18} />,
    searchTerms: ['ordered', 'list', 'ol', 'number'],
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).toggleOrderedList().run();
    },
  },
  {
    title: '待办事项',
    description: '任务复选框列表',
    icon: <CheckSquare size={18} />,
    searchTerms: ['todo', 'task', 'checkbox'],
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).toggleTaskList().run();
    },
  },
  {
    title: '引用',
    description: '引用文字块',
    icon: <TextQuote size={18} />,
    searchTerms: ['quote', 'blockquote'],
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).toggleBlockquote().run();
    },
  },
  {
    title: '代码块',
    description: '代码片段',
    icon: <Code size={18} />,
    searchTerms: ['code', 'codeblock'],
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).toggleCodeBlock().run();
    },
  },
  {
    title: '分割线',
    description: '水平分割线',
    icon: <Minus size={18} />,
    searchTerms: ['hr', 'divider', 'rule'],
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).setHorizontalRule().run();
    },
  },
]);

export const NoteEditor = memo(function NoteEditor({ nodeId, data }: NoteEditorProps) {
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

  // Parse HTML content to JSONContent for Novel
  const initialContentRef = useRef<JSONContent | undefined>(undefined);
  const initializedRef = useRef(false);

  if (!initializedRef.current && data.content) {
    initializedRef.current = true;
    // We'll set content via editor.commands.setContent after mount
  }

  // Track latest nodeId + data for save callback
  const nodeIdRef = useRef(nodeId);
  nodeIdRef.current = nodeId;
  const dataRef = useRef(data);
  dataRef.current = data;

  // Cleanup pending save on unmount
  useEffect(() => {
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, []);
  // Novel/TipTap extensions — must be provided explicitly
  const extensions = useMemo(() => [
    StarterKit.configure({
      horizontalRule: false,
    }),
    HorizontalRule,
    Placeholder.configure({
      placeholder: '输入 / 打开命令菜单...',
    }),
    TiptapLink.configure({
      HTMLAttributes: { class: 'text-blue-500 underline' },
    }),
    TiptapImage.configure({
      allowBase64: true,
      HTMLAttributes: { class: 'rounded-md' },
    }),
    TiptapUnderline,
    HighlightExtension.configure({ multicolor: true }),
    TaskList,
    TaskItem.configure({ nested: true }),
    TextStyle,
    Color,
  ], []);

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

      {/* Novel Editor */}
      <div className="flex-1 overflow-y-auto">
        <EditorRoot>
          <EditorContent
            initialContent={initialContentRef.current}
            immediatelyRender={false}
            onCreate={({ editor }) => {
              // Load existing HTML content
              if (data.content) {
                editor.commands.setContent(data.content);
              }
            }}
            onUpdate={({ editor }) => {
              // Debounced save
              if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
              saveTimerRef.current = setTimeout(() => {
                const html = editor.getHTML();
                updateNodeData(nodeIdRef.current, { content: html });
              }, 500);
            }}
            extensions={extensions}
            editorProps={{
              handlePaste: (view, event) => handleImagePaste(view, event, uploadImage),
              handleDrop: (view, event, _slice, moved) => handleImageDrop(view, event, moved, uploadImage),
              attributes: {
                class: 'prose prose-sm max-w-none px-4 py-2 focus:outline-none min-h-[200px]',
              },
            }}
          >
            {/* Slash Command Menu */}
            <EditorCommand
              onKeyDown={(e) => handleCommandNavigation(e.nativeEvent)}
              className="z-50 h-auto max-h-[330px] overflow-y-auto rounded-md border border-slate-200 bg-white shadow-lg transition-all"
            >
              <EditorCommandEmpty className="px-3 py-2 text-sm text-slate-400">
                没有匹配的命令
              </EditorCommandEmpty>
              {suggestionItems.map((item) => (
                <EditorCommandItem
                  key={item.title}
                  value={item.title}
                  onCommand={(val) => item.command?.(val)}
                  className="flex items-center gap-3 px-3 py-2 text-sm hover:bg-slate-100 cursor-pointer aria-selected:bg-slate-100"
                >
                  <div className="flex items-center justify-center w-8 h-8 rounded-md border border-slate-200 bg-white text-slate-500">
                    {item.icon}
                  </div>
                  <div>
                    <p className="font-medium text-slate-800">{item.title}</p>
                    <p className="text-xs text-slate-400">{item.description}</p>
                  </div>
                </EditorCommandItem>
              ))}
            </EditorCommand>

            {/* Bubble Toolbar (appears on text selection) */}
            <EditorBubble
              tippyOptions={{ placement: 'top' }}
              className="flex items-center gap-0.5 rounded-md border border-slate-200 bg-white shadow-lg p-1"
            >
              <EditorBubbleItem
                onSelect={(editor) => editor.chain().focus().toggleBold().run()}
                className="p-1.5 rounded hover:bg-slate-100 text-slate-600 data-[active=true]:text-blue-500"
              >
                <Bold size={14} />
              </EditorBubbleItem>
              <EditorBubbleItem
                onSelect={(editor) => editor.chain().focus().toggleItalic().run()}
                className="p-1.5 rounded hover:bg-slate-100 text-slate-600 data-[active=true]:text-blue-500"
              >
                <Italic size={14} />
              </EditorBubbleItem>
              <EditorBubbleItem
                onSelect={(editor) => editor.chain().focus().toggleUnderline().run()}
                className="p-1.5 rounded hover:bg-slate-100 text-slate-600 data-[active=true]:text-blue-500"
              >
                <Underline size={14} />
              </EditorBubbleItem>
              <EditorBubbleItem
                onSelect={(editor) => editor.chain().focus().toggleStrike().run()}
                className="p-1.5 rounded hover:bg-slate-100 text-slate-600 data-[active=true]:text-blue-500"
              >
                <Strikethrough size={14} />
              </EditorBubbleItem>
              <EditorBubbleItem
                onSelect={(editor) => editor.chain().focus().toggleCode().run()}
                className="p-1.5 rounded hover:bg-slate-100 text-slate-600 data-[active=true]:text-blue-500"
              >
                <Code2 size={14} />
              </EditorBubbleItem>
              <EditorBubbleItem
                onSelect={(editor) => editor.chain().focus().toggleHighlight().run()}
                className="p-1.5 rounded hover:bg-slate-100 text-slate-600 data-[active=true]:text-yellow-500"
              >
                <Highlighter size={14} />
              </EditorBubbleItem>
            </EditorBubble>
          </EditorContent>
        </EditorRoot>
      </div>
    </div>
  );
});
