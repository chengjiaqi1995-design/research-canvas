import { createReactBlockSpec } from '@blocknote/react';
import { MermaidBlockRenderer } from './MermaidBlockRenderer.tsx';

export const MermaidBlock = createReactBlockSpec(
  {
    type: 'mermaid' as const,
    propSchema: {
      code: { default: '' },
    },
    content: 'none' as const,
  },
  {
    render: (props) => {
      const editable = props.editor.isEditable;
      return (
        <MermaidBlockRenderer
          code={props.block.props.code}
          editable={editable}
          onChangeCode={(next) => {
            try {
              props.editor.updateBlock(props.block, { props: { code: next } });
            } catch {
              // editor may not be ready
            }
          }}
        />
      );
    },
    toExternalHTML: (props) => {
      const code = props.block.props.code || '';
      return (
        <pre>
          <code className="language-mermaid">{code}</code>
        </pre>
      );
    },
    parse: (element: HTMLElement) => {
      // Explicit marker
      if (element.getAttribute('data-content-type') === 'mermaid') {
        return { code: element.getAttribute('data-code') || element.textContent || '' };
      }
      // Standard Mermaid convention: <div class="mermaid"> / <pre class="mermaid">
      // (these have no inner <code>, so the default codeBlock spec ignores them).
      if (element.classList?.contains('mermaid')) {
        return { code: element.textContent || '' };
      }
      return undefined;
    },
  }
);
