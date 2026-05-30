import { looksLikeMermaid } from '../../utils/mermaidRenderer.ts';

function blockPlainText(block: any): string {
  const content = block?.content;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content.map((c: any) => (typeof c?.text === 'string' ? c.text : '')).join('');
  }
  return '';
}

/**
 * BlockNote parses ```mermaid fences into a generic codeBlock. Convert those
 * (and any code that clearly is Mermaid) into our custom `mermaid` block so the
 * diagram renders instead of showing raw source. ProseMirror strips foreign DOM
 * injected into the editor, so a real custom block is the reliable approach.
 *
 * Used by every editor that parses note HTML into BlockNote blocks
 * (DetailPanel's NoteEditor and the SplitWorkspace ModuleEditor).
 */
export function convertMermaidBlocks(blocks: any[]): any[] {
  return blocks.map((block) => {
    const children = Array.isArray(block?.children) && block.children.length
      ? convertMermaidBlocks(block.children)
      : block?.children;
    if (block?.type === 'codeBlock') {
      const language = String(block?.props?.language || '').toLowerCase();
      const text = blockPlainText(block);
      if (language === 'mermaid' || looksLikeMermaid(text)) {
        return { type: 'mermaid', props: { code: text.replace(/\n+$/, '') } };
      }
    }
    return children === block?.children ? block : { ...block, children };
  });
}
