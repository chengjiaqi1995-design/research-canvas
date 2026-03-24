import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import Highlight from '@tiptap/extension-highlight';
import { Table } from '@tiptap/extension-table';
import { TableRow } from '@tiptap/extension-table-row';
import { TableHeader } from '@tiptap/extension-table-header';
import { TableCell } from '@tiptap/extension-table-cell';
import Image from '@tiptap/extension-image';
import Link from '@tiptap/extension-link';
// NodeSelection 会通过动态导入或从 editor 中获取
import { useEffect, useMemo, useState, useRef } from 'react';
import { marked } from 'marked';
import styles from './RichTextEditor.module.css';

interface RichTextEditorProps {
  content: string;
  onChange: (content: string) => void;
  placeholder?: string;
  editable?: boolean;
  toolbarOnly?: boolean;
  hideToolbar?: boolean;
  className?: string;
  onToolbarRef?: (toolbar: HTMLDivElement | null) => void;
}

const RichTextEditor: React.FC<RichTextEditorProps> = ({
  content,
  onChange,
  placeholder = '开始编辑...',
  editable = true,
  toolbarOnly = false,
  hideToolbar = false,
  className,
  onToolbarRef,
}) => {
  // 检测内容是否为 Markdown 格式，如果是则转换为 HTML
  const processedContent = useMemo(() => {
    if (!content) return '';

    // 如果内容以 HTML 标签开头，直接当 HTML 处理，不做 Markdown 检测
    // 避免 HTML 中的 `> ` `**` 等被误判为 Markdown 语法
    const trimmed = content.trim();
    const isHtml = /^<[a-z!]/i.test(trimmed);

    if (!isHtml) {
      // 检测是否为 Markdown（包含常见的 Markdown 标记）
      const isMarkdown = /(?:^|\n)(?:#{1,6}\s|[-*+]\s|```|> |\*\*|__|~~)/.test(content);

      if (isMarkdown) {
        try {
          // 移除 Markdown 中的分割线（--- 或 ***）
          const contentWithoutHR = content.replace(/^[\s]*[-*]{3,}[\s]*$/gm, '');

          // 将 Markdown 转换为 HTML
          const htmlResult = marked(contentWithoutHR, {
            breaks: true, // 支持换行
            gfm: true, // 支持 GitHub Flavored Markdown
          });

          // marked 可能返回 string 或 Promise<string>
          const html = typeof htmlResult === 'string' ? htmlResult : String(htmlResult);

          // 移除 HTML 中的 <hr> 标签（以防万一）
          return html.replace(/<hr\s*\/?>/gi, '');
        } catch (error) {
          console.error('Markdown 解析错误:', error);
          return content; // 如果解析失败，返回原始内容
        }
      }
    }

    // 已经是 HTML 格式，移除 <hr> 标签
    return content.replace(/<hr\s*\/?>/gi, '');
  }, [content]);

  const [showColorPicker, setShowColorPicker] = useState(false);
  const [showFloatingToolbar, setShowFloatingToolbar] = useState(false);
  const [showImageToolbar, setShowImageToolbar] = useState(false);
  const [selectedImageNode, setSelectedImageNode] = useState<any>(null);
  const [toolbarPosition, setToolbarPosition] = useState({ top: 0, left: 0 });
  const toolbarRef = useRef<HTMLDivElement>(null);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: {
          levels: [1, 2, 3],
        },
      }),
      Placeholder.configure({
        placeholder,
      }),
      Highlight.configure({
        multicolor: true,
      }),
      Table.configure({
        resizable: true,
        HTMLAttributes: {
          class: 'tiptap-table',
        },
      }),
      TableRow,
      TableHeader,
      TableCell,
      Image.configure({
        inline: true,
        allowBase64: true,
        HTMLAttributes: {
          style: 'max-width: 100%; height: auto;',
        },
      }),
      Link.configure({
        openOnClick: false, // 禁用 TipTap 自带的链接点击，由外层 onClick 统一处理
        autolink: false,
        HTMLAttributes: {
          class: 'editor-link',
        },
      }),
    ],
    content: processedContent,
    editable,
    onUpdate: ({ editor }) => {
      const html = editor.getHTML();
      onChange(html);
      // 内容更新时也检查图片选择
      setTimeout(() => {
        updateFloatingToolbar(editor);
      }, 10);
    },
    onSelectionUpdate: ({ editor }) => {
      // 当选择变化时更新浮动工具栏
      updateFloatingToolbar(editor);
    },
    editorProps: {
      handlePaste: (view, event) => {
        const items = event.clipboardData?.items;
        if (!items) return false;

        // 检查是否有图片
        for (let i = 0; i < items.length; i++) {
          const item = items[i];
          if (item.type.indexOf('image') !== -1) {
            event.preventDefault();
            const file = item.getAsFile();
            if (file) {
              // 将图片转换为 base64
              const reader = new FileReader();
              reader.onload = (event) => {
                const base64 = event.target?.result as string;
                if (base64 && editor) {
                  // 插入图片到编辑器
                  editor.chain().focus().setImage({ src: base64 }).run();
                }
              };
              reader.readAsDataURL(file);
            }
            return true;
          }
        }
        return false; // 使用默认粘贴行为
      },
      handleClick: (view, pos, event) => {
        // 检测是否点击了图片
        const $pos = view.state.doc.resolve(pos);
        let imageNode: any = null;
        let imagePos: number | null = null;
        
        // 检查点击位置的节点
        const nodeAfter = $pos.nodeAfter;
        const nodeBefore = $pos.nodeBefore;
        
        if (nodeAfter?.type.name === 'image') {
          imageNode = nodeAfter;
          imagePos = pos;
        } else if (nodeBefore?.type.name === 'image') {
          imageNode = nodeBefore;
          imagePos = pos - nodeBefore.nodeSize;
        } else {
          // 检查父节点
          const parent = $pos.parent;
          if (parent?.type.name === 'image') {
            imageNode = parent;
            imagePos = $pos.start($pos.depth);
          } else {
            // 在文档中查找图片节点
            view.state.doc.nodesBetween(Math.max(0, pos - 10), Math.min(view.state.doc.content.size, pos + 10), (node: any, nodePos: number) => {
              if (node.type.name === 'image') {
                imageNode = node;
                imagePos = nodePos;
                return false;
              }
            });
          }
        }
        
        if (imageNode && imagePos !== null && editor) {
          // 选中图片节点 - 使用 setTextSelection 定位到图片位置
          editor.chain().setTextSelection(imagePos).run();
          
          // 更新工具栏
          setTimeout(() => {
            if (editor) {
              updateFloatingToolbar(editor);
            }
          }, 10);
        }
        return false;
      },
    },
  });

  // 辅助函数：更新图片属性
  const updateImageAttributes = (newStyle: string) => {
    if (!editor || !selectedImageNode) {
      console.warn('无法更新图片属性：editor 或 selectedImageNode 为空');
      return;
    }
    
    try {
      const tr = editor.state.tr;
      
      // 直接更新节点属性（不需要先选中）
      const attrs = { ...selectedImageNode.node.attrs, style: newStyle };
      tr.setNodeMarkup(selectedImageNode.pos, undefined, attrs);
      
      // 应用更改
      editor.view.dispatch(tr);
      
      // 触发更新
      editor.chain().focus().run();
      
      // 更新 selectedImageNode 引用
      const updatedNode = tr.doc.nodeAt(selectedImageNode.pos);
      if (updatedNode) {
        setSelectedImageNode({ node: updatedNode, pos: selectedImageNode.pos });
      }
    } catch (error) {
      console.error('更新图片属性失败:', error);
    }
  };

  // 更新浮动工具栏的位置
  const updateFloatingToolbar = (editor: any) => {
    if (!editable || hideToolbar) {
      setShowFloatingToolbar(false);
      setShowImageToolbar(false);
      setSelectedImageNode(null);
      return;
    }

    const { from, to } = editor.state.selection;
    const { view } = editor;

    // 检查是否选中了图片节点（NodeSelection）
    const selection = editor.state.selection;
    let imageNode: any = null;
    let imagePos: number | null = null;

    // 方法1: 检查是否是 NodeSelection 且选中了图片
    try {
      const nodeSelection = selection as any;
      if (nodeSelection.node && nodeSelection.node.type?.name === 'image') {
        imageNode = nodeSelection.node;
        imagePos = nodeSelection.$anchor?.pos || from;
      }
    } catch (e) {
      // 忽略错误，继续其他检测方法
    }

    // 方法2: 检查当前节点
    if (!imageNode) {
      const $anchor = editor.state.selection.$anchor;
      const node = $anchor.node();
      if (node?.type.name === 'image') {
        imageNode = node;
        imagePos = from;
      } else {
        // 方法3: 检查父节点
        const parent = $anchor.parent;
        if (parent?.type.name === 'image') {
          imageNode = parent;
          imagePos = from;
        } else {
          // 方法4: 在选择范围内查找图片节点
          editor.state.doc.nodesBetween(from, to, (node: any, pos: number) => {
            if (node.type.name === 'image') {
              imageNode = node;
              imagePos = pos;
              return false; // 停止遍历
            }
          });
        }
      }
    }

    // 方法5: 如果还没找到，在整个文档中查找最近的图片（用于点击检测）
    if (!imageNode) {
      const searchRange = 50; // 搜索范围
      const startPos = Math.max(0, from - searchRange);
      const endPos = Math.min(editor.state.doc.content.size, to + searchRange);
      editor.state.doc.nodesBetween(startPos, endPos, (node: any, pos: number) => {
        if (node.type.name === 'image') {
          // 找到最近的图片
          if (!imageNode || Math.abs(pos - from) < Math.abs(imagePos! - from)) {
            imageNode = node;
            imagePos = pos;
          }
        }
      });
    }

    if (imageNode && imagePos !== null) {
      // 选中了图片，显示图片工具栏
      const coords = view.coordsAtPos(imagePos);
      const editorRect = view.dom.getBoundingClientRect();
      setToolbarPosition({ 
        top: coords.top - editorRect.top - 60, 
        left: coords.left - editorRect.left + (coords.right - coords.left) / 2
      });
      setShowImageToolbar(true);
      setShowFloatingToolbar(false);
      setSelectedImageNode({ node: imageNode, pos: imagePos });
      console.log('✅ 检测到图片，设置工具栏:', { imageNode, imagePos, coords, toolbarPosition: { top: coords.top - editorRect.top - 60, left: coords.left - editorRect.left + (coords.right - coords.left) / 2 } });
      return;
    }

    // 检查是否有文本选择
    const hasSelection = from !== to;
    if (!hasSelection) {
      setShowFloatingToolbar(false);
      setShowImageToolbar(false);
      setSelectedImageNode(null);
      return;
    }

    // 获取选中文本的位置
    const start = view.coordsAtPos(from);
    const end = view.coordsAtPos(to);

    // 计算工具栏位置（在选中文本上方居中）
    const left = (start.left + end.right) / 2;
    const top = start.top;

    setToolbarPosition({ top, left });
    setShowFloatingToolbar(true);
    setShowImageToolbar(false);
    setSelectedImageNode(null);
  };

  useEffect(() => {
    if (editor && processedContent !== editor.getHTML()) {
      editor.commands.setContent(processedContent);
    }
  }, [processedContent, editor]);

  useEffect(() => {
    if (editor) {
      editor.setEditable(editable);
    }
  }, [editable, editor]);

  // 点击外部关闭颜色选择器
  useEffect(() => {
    if (showColorPicker) {
      const handleClickOutside = (event: MouseEvent) => {
        const target = event.target as HTMLElement;
        if (!target.closest('button[title="背景色"]') && !target.closest('div[style*="gridTemplateColumns"]')) {
          setShowColorPicker(false);
        }
      };
      document.addEventListener('mousedown', handleClickOutside);
      return () => {
        document.removeEventListener('mousedown', handleClickOutside);
      };
    }
  }, [showColorPicker]);

  if (!editor) {
    return null;
  }

  const toolbar = editable && !hideToolbar && showFloatingToolbar ? (
    <div 
      className={`${styles.editorToolbar} ${styles.floatingToolbar}`}
      ref={(node) => {
        toolbarRef.current = node;
        if (onToolbarRef) {
          onToolbarRef(node);
        }
      }}
      style={{
        position: 'fixed',
        top: `${toolbarPosition.top - 60}px`, // 在选中文本上方60px
        left: `${toolbarPosition.left}px`,
        transform: 'translateX(-50%)', // 水平居中
        zIndex: 9999,
        background: '#fff',
        border: '1px solid #e8e8e8',
        borderRadius: '4px',
        boxShadow: '0 2px 12px rgba(0, 0, 0, 0.15)',
        padding: '4px 8px',
      }}
    >
      <div style={{ position: 'relative', display: 'inline-block' }}>
        <button
          onClick={() => setShowColorPicker(!showColorPicker)}
          className={editor.isActive('highlight') ? 'is-active' : ''}
          title="背景色"
        >
          背景色
        </button>
        {showColorPicker && (
          <div
            style={{
              position: 'absolute',
              top: '100%',
              left: 0,
              marginTop: '4px',
              padding: '8px',
              background: '#fff',
              border: '1px solid #e8e8e8',
              borderRadius: '0',
              display: 'grid',
              gridTemplateColumns: 'repeat(4, 1fr)',
              gap: '4px',
              zIndex: 1000,
              boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {[
              '#ffeb3b', '#ff9800', '#f44336', '#e91e63',
              '#9c27b0', '#673ab7', '#3f51b5', '#2196f3',
              '#00bcd4', '#009688', '#4caf50', '#8bc34a',
              '#cddc39', '#ffc107', '#ff5722', '#795548',
              '#9e9e9e', '#607d8b', '#000000', 'transparent',
            ].map((color) => (
              <button
                key={color}
                onClick={() => {
                  if (color === 'transparent') {
                    editor.chain().focus().unsetHighlight().run();
                  } else {
                    editor.chain().focus().toggleHighlight({ color }).run();
                  }
                  setShowColorPicker(false);
                }}
                style={{
                  width: '24px',
                  height: '24px',
                  border: '1px solid #e8e8e8',
                  background: color === 'transparent' ? 'linear-gradient(45deg, #ccc 25%, transparent 25%, transparent 75%, #ccc 75%, #ccc), linear-gradient(45deg, #ccc 25%, transparent 25%, transparent 75%, #ccc 75%, #ccc)' : color,
                  backgroundSize: color === 'transparent' ? '8px 8px' : 'auto',
                  backgroundPosition: color === 'transparent' ? '0 0, 4px 4px' : 'auto',
                  cursor: 'pointer',
                  padding: 0,
                }}
                title={color === 'transparent' ? '清除背景色' : color}
              />
            ))}
          </div>
        )}
      </div>
          <button
            onClick={() => editor.chain().focus().toggleBold().run()}
            className={editor.isActive('bold') ? 'is-active' : ''}
          >
            粗体
          </button>
          <button
            onClick={() => editor.chain().focus().toggleItalic().run()}
            className={editor.isActive('italic') ? 'is-active' : ''}
          >
            斜体
          </button>
          <button
            onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
            className={editor.isActive('heading', { level: 1 }) ? 'is-active' : ''}
          >
            H1
          </button>
          <button
            onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
            className={editor.isActive('heading', { level: 2 }) ? 'is-active' : ''}
          >
            H2
          </button>
          <button
            onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
            className={editor.isActive('heading', { level: 3 }) ? 'is-active' : ''}
          >
            H3
          </button>
          <button
            onClick={() => editor.chain().focus().toggleBulletList().run()}
            className={editor.isActive('bulletList') ? 'is-active' : ''}
          >
            列表
          </button>
          <button
            onClick={() => editor.chain().focus().toggleOrderedList().run()}
            className={editor.isActive('orderedList') ? 'is-active' : ''}
          >
            编号列表
          </button>
          <button
            onClick={() => editor.chain().focus().toggleBlockquote().run()}
            className={editor.isActive('blockquote') ? 'is-active' : ''}
          >
            引用
          </button>
          <button onClick={() => editor.chain().focus().setHorizontalRule().run()}>
            分割线
          </button>
          <button
            onClick={() => editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()}
            title="插入表格"
          >
            表格
          </button>
          {editor.isActive('table') && (
            <>
              <button onClick={() => editor.chain().focus().addColumnAfter().run()}>
                +列
              </button>
              <button onClick={() => editor.chain().focus().addRowAfter().run()}>
                +行
              </button>
              <button onClick={() => editor.chain().focus().deleteColumn().run()}>
                -列
              </button>
              <button onClick={() => editor.chain().focus().deleteRow().run()}>
                -行
              </button>
              <button onClick={() => editor.chain().focus().deleteTable().run()}>
                删表
              </button>
            </>
          )}
        </div>
  ) : null;

  // 调试：检查工具栏显示条件
  useEffect(() => {
    if (editor && showImageToolbar) {
      console.log('✅ 图片工具栏应该显示:', {
        editable,
        hideToolbar,
        showImageToolbar,
        hasSelectedImage: !!selectedImageNode,
        selectedImageNode,
        toolbarPosition,
      });
    }
  }, [editable, hideToolbar, showImageToolbar, selectedImageNode, editor, toolbarPosition]);

  // 图片格式工具栏
  const imageToolbar = editable && !hideToolbar && showImageToolbar && selectedImageNode ? (
    <div 
      className={`${styles.editorToolbar} ${styles.floatingToolbar}`}
      style={{
        position: 'absolute',
        top: `${toolbarPosition.top}px`,
        left: `${toolbarPosition.left}px`,
        transform: 'translateX(-50%)',
        zIndex: 9999,
        background: '#fff',
        border: '1px solid #e8e8e8',
        borderRadius: '4px',
        boxShadow: '0 2px 12px rgba(0, 0, 0, 0.15)',
        padding: '4px 8px',
        display: 'flex',
        gap: '4px',
        alignItems: 'center',
      }}
      onMouseDown={(e) => {
        e.preventDefault();
        e.stopPropagation();
      }}
      onClick={(e) => {
        e.stopPropagation();
        editor?.chain().focus().run();
      }}
    >
      <button
        type="button"
        onClick={() => {
          if (editor && selectedImageNode) {
            const attrs = selectedImageNode.node.attrs;
            const baseStyle = attrs.style || '';
            // 移除现有的 margin 和 display，添加居中对齐
            const newStyle = (baseStyle
              .replace(/display:\s*[^;]+;?/g, '')
              .replace(/margin:\s*[^;]+;?/g, '')
              .trim() + ' display: block; margin: 0 auto;').trim();
            updateImageAttributes(newStyle);
          }
        }}
        style={{
          padding: '4px 8px',
          border: '1px solid #d9d9d9',
          borderRadius: '4px',
          background: '#fff',
          cursor: 'pointer',
          fontSize: '12px',
        }}
        title="居中"
      >
        居中
      </button>
      <button
        type="button"
        onClick={() => {
          if (editor && selectedImageNode) {
            const attrs = selectedImageNode.node.attrs;
            const baseStyle = attrs.style || '';
            const newStyle = (baseStyle
              .replace(/display:\s*[^;]+;?/g, '')
              .replace(/margin:\s*[^;]+;?/g, '')
              .trim() + ' display: block; margin: 0 0 0 auto;').trim();
            updateImageAttributes(newStyle);
          }
        }}
        style={{
          padding: '4px 8px',
          border: '1px solid #d9d9d9',
          borderRadius: '4px',
          background: '#fff',
          cursor: 'pointer',
          fontSize: '12px',
        }}
        title="右对齐"
      >
        右对齐
      </button>
      <button
        type="button"
        onClick={() => {
          if (editor && selectedImageNode) {
            const attrs = selectedImageNode.node.attrs;
            const baseStyle = attrs.style || '';
            const newStyle = (baseStyle
              .replace(/display:\s*[^;]+;?/g, '')
              .replace(/margin:\s*[^;]+;?/g, '')
              .trim() + ' display: block; margin: 0;').trim();
            updateImageAttributes(newStyle);
          }
        }}
        style={{
          padding: '4px 8px',
          border: '1px solid #d9d9d9',
          borderRadius: '4px',
          background: '#fff',
          cursor: 'pointer',
          fontSize: '12px',
        }}
        title="左对齐"
      >
        左对齐
      </button>
      <button
        type="button"
        onClick={() => {
          if (editor && selectedImageNode) {
            const attrs = selectedImageNode.node.attrs;
            const baseStyle = attrs.style || '';
            const newStyle = (baseStyle
              .replace(/width:\s*[^;]+;?/g, '')
              .replace(/height:\s*[^;]+;?/g, '')
              .trim() + ' width: 25%; height: auto; max-width: 100%;').trim();
            updateImageAttributes(newStyle);
          }
        }}
        style={{
          padding: '4px 8px',
          border: '1px solid #d9d9d9',
          borderRadius: '4px',
          background: '#fff',
          cursor: 'pointer',
          fontSize: '12px',
        }}
        title="小 (25%)"
      >
        小
      </button>
      <button
        type="button"
        onClick={() => {
          if (editor && selectedImageNode) {
            const attrs = selectedImageNode.node.attrs;
            const baseStyle = attrs.style || '';
            const newStyle = (baseStyle
              .replace(/width:\s*[^;]+;?/g, '')
              .replace(/height:\s*[^;]+;?/g, '')
              .trim() + ' width: 50%; height: auto; max-width: 100%;').trim();
            updateImageAttributes(newStyle);
          }
        }}
        style={{
          padding: '4px 8px',
          border: '1px solid #d9d9d9',
          borderRadius: '4px',
          background: '#fff',
          cursor: 'pointer',
          fontSize: '12px',
        }}
        title="中 (50%)"
      >
        中
      </button>
      <button
        type="button"
        onClick={() => {
          if (editor && selectedImageNode) {
            const attrs = selectedImageNode.node.attrs;
            const baseStyle = attrs.style || '';
            const newStyle = (baseStyle
              .replace(/width:\s*[^;]+;?/g, '')
              .replace(/height:\s*[^;]+;?/g, '')
              .trim() + ' width: 75%; height: auto; max-width: 100%;').trim();
            updateImageAttributes(newStyle);
          }
        }}
        style={{
          padding: '4px 8px',
          border: '1px solid #d9d9d9',
          borderRadius: '4px',
          background: '#fff',
          cursor: 'pointer',
          fontSize: '12px',
        }}
        title="大 (75%)"
      >
        大
      </button>
      <button
        type="button"
        onClick={() => {
          if (editor && selectedImageNode) {
            const attrs = selectedImageNode.node.attrs;
            const baseStyle = attrs.style || '';
            const newStyle = (baseStyle
              .replace(/width:\s*[^;]+;?/g, '')
              .replace(/height:\s*[^;]+;?/g, '')
              .trim() + ' width: 100%; height: auto; max-width: 100%;').trim();
            updateImageAttributes(newStyle);
          }
        }}
        style={{
          padding: '4px 8px',
          border: '1px solid #d9d9d9',
          borderRadius: '4px',
          background: '#fff',
          cursor: 'pointer',
          fontSize: '12px',
        }}
        title="全宽 (100%)"
      >
        全宽
      </button>
      <button
        type="button"
        onClick={() => {
          if (editor && selectedImageNode) {
            const attrs = selectedImageNode.node.attrs;
            const currentStyle = attrs.style || '';
            const hasBorderRadius = currentStyle.includes('border-radius');
            const newStyle = hasBorderRadius
              ? currentStyle.replace(/border-radius:\s*[^;]+;?/g, '').trim()
              : `${currentStyle} border-radius: 8px;`.trim();
            updateImageAttributes(newStyle || 'max-width: 100%; height: auto;');
          }
        }}
        style={{
          padding: '4px 8px',
          border: '1px solid #d9d9d9',
          borderRadius: '4px',
          background: selectedImageNode?.node?.attrs?.style?.includes('border-radius') ? '#e6f7ff' : '#fff',
          cursor: 'pointer',
          fontSize: '12px',
        }}
        title="圆角"
      >
        圆角
      </button>
      <button
        type="button"
        onClick={() => {
          if (editor && selectedImageNode) {
            const attrs = selectedImageNode.node.attrs;
            const currentStyle = attrs.style || '';
            const hasBorder = currentStyle.includes('border:');
            const newStyle = hasBorder
              ? currentStyle.replace(/border:\s*[^;]+;?/g, '').trim()
              : `${currentStyle} border: 2px solid #d9d9d9;`.trim();
            updateImageAttributes(newStyle || 'max-width: 100%; height: auto;');
          }
        }}
        style={{
          padding: '4px 8px',
          border: '1px solid #d9d9d9',
          borderRadius: '4px',
          background: selectedImageNode?.node?.attrs?.style?.includes('border:') ? '#e6f7ff' : '#fff',
          cursor: 'pointer',
          fontSize: '12px',
        }}
        title="边框"
      >
        边框
      </button>
      <button
        type="button"
        onClick={() => {
          if (editor) {
            editor.chain().focus().deleteSelection().run();
          }
        }}
        style={{
          padding: '4px 8px',
          border: '1px solid #d9d9d9',
          borderRadius: '4px',
          background: '#fff',
          cursor: 'pointer',
          fontSize: '12px',
          color: '#ff4d4f',
        }}
        title="删除图片"
      >
        删除
      </button>
    </div>
  ) : null;

  if (toolbarOnly) {
    return <>{toolbar}</>;
  }

  return (
    <div className={`${styles.richTextEditor}${className ? ` ${className}` : ''}`}>
      {toolbar}
      {imageToolbar}
      <EditorContent editor={editor} className={styles.editorContent} />
    </div>
  );
};

export default RichTextEditor;
