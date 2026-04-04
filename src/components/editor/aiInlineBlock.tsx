import { createReactBlockSpec } from '@blocknote/react';
import { AIInlineBlockRenderer, encodeB64, decodeB64 } from './AIInlineBlockRenderer.tsx';

export const AIInlineBlock = createReactBlockSpec(
  {
    type: 'aiInline' as const,
    propSchema: {
      prompt: { default: '' },
      model: { default: '' },
      generatedContent: { default: '' }, // base64 encoded
      status: { default: 'idle' },
      errorMessage: { default: '' },
      lastGeneratedAt: { default: '' },
      blockId: { default: '' },
      collapsed: { default: 'false' },
      sourceWorkspaceIds: { default: '[]' }, // JSON stringified array of ids
      sourceCanvasIds: { default: '[]' },    // JSON stringified array of ids
      sourceDateFrom: { default: '' },
      sourceDateTo: { default: '' },
      sourceDateField: { default: 'occurred' },
      generationCount: { default: '0' },
      formatId: { default: '' },
    },
    content: 'none' as const,
  },
  {
    render: (props) => {
      // Ensure blockId is assigned on first render
      if (!props.block.props.blockId) {
        const newId = crypto.randomUUID();
        try {
          props.editor.updateBlock(props.block, {
            props: { blockId: newId },
          });
        } catch {
          // ignore if editor not ready
        }
      }

      return (
        <AIInlineBlockRenderer
          block={props.block}
          editor={props.editor}
        />
      );
    },
    toExternalHTML: (props) => {
      const p = props.block.props;
      const decodedContent = p.generatedContent ? decodeB64(p.generatedContent) : '';

      return (
        <div
          data-content-type="aiInline"
          data-ai-inline-block="true"
          data-prompt={p.prompt || ''}
          data-model={p.model || ''}
          data-generated-content={p.generatedContent || ''}
          data-status={p.status || 'idle'}
          data-error-message={p.errorMessage || ''}
          data-last-generated-at={p.lastGeneratedAt || ''}
          data-block-id={p.blockId || ''}
          data-collapsed={p.collapsed || 'false'}
          data-source-workspace-ids={p.sourceWorkspaceIds || '[]'}
          data-source-canvas-ids={p.sourceCanvasIds || '[]'}
          data-source-date-from={p.sourceDateFrom || ''}
          data-source-date-to={p.sourceDateTo || ''}
          data-source-date-field={p.sourceDateField || 'occurred'}
          data-generation-count={p.generationCount || '0'}
          data-format-id={p.formatId || ''}
          style={{
            border: '1px solid #fcd34d',
            borderRadius: '8px',
            padding: '12px',
            margin: '8px 0',
            backgroundColor: '#fffbeb',
          }}
        />
      );
    },
    parse: (element: HTMLElement) => {
      if (element.getAttribute('data-content-type') === 'aiInline' || element.getAttribute('data-ai-inline-block') === 'true') {
        return {
          prompt: element.getAttribute('data-prompt') || '',
          model: element.getAttribute('data-model') || '',
          generatedContent: element.getAttribute('data-generated-content') || '',
          status: element.getAttribute('data-status') || 'idle',
          errorMessage: element.getAttribute('data-error-message') || '',
          lastGeneratedAt: element.getAttribute('data-last-generated-at') || '',
          blockId: element.getAttribute('data-block-id') || crypto.randomUUID(),
          collapsed: element.getAttribute('data-collapsed') || 'false',
          sourceWorkspaceIds: element.getAttribute('data-source-workspace-ids') || '[]',
          sourceCanvasIds: element.getAttribute('data-source-canvas-ids') || '[]',
          sourceDateFrom: element.getAttribute('data-source-date-from') || '',
          sourceDateTo: element.getAttribute('data-source-date-to') || '',
          sourceDateField: element.getAttribute('data-source-date-field') || 'occurred',
          generationCount: element.getAttribute('data-generation-count') || '0',
          formatId: element.getAttribute('data-format-id') || '',
        };
      }
      return undefined;
    },
  }
);
