import { useMemo } from 'react';
import { createReactInlineContentSpec } from '@blocknote/react';
import katex from 'katex';
import 'katex/dist/katex.min.css';

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderLatex(latex: string, displayMode: boolean): string {
  const normalized = latex.trim();
  if (!normalized) return '';
  try {
    return katex.renderToString(normalized, {
      displayMode,
      throwOnError: false,
      strict: 'ignore',
      output: 'htmlAndMathml',
    });
  } catch {
    return escapeHtml(displayMode ? `$$${normalized}$$` : `\\(${normalized}\\)`);
  }
}

function MathFormulaRenderer({ inlineContent }: any) {
  const latex = String(inlineContent.props.latex || '');
  const display = inlineContent.props.display === 'true';
  const html = useMemo(() => renderLatex(latex, display), [display, latex]);

  return (
    <span
      className={`math-formula ${display ? 'math-formula-display' : 'math-formula-inline'}`}
      data-latex={latex}
      data-display={display ? 'true' : 'false'}
      title={latex}
      contentEditable={false}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

export const MathFormulaInline = createReactInlineContentSpec(
  {
    type: 'mathFormula' as const,
    propSchema: {
      latex: { default: '' },
      display: { default: 'false' },
    },
    content: 'none' as const,
  },
  {
    render: MathFormulaRenderer,
    toExternalHTML: MathFormulaRenderer,
    parse: (element: HTMLElement) => {
      const type = element.getAttribute('data-inline-content-type');
      const isMath =
        type === 'mathFormula' ||
        element.classList.contains('math-formula') ||
        element.hasAttribute('data-latex');
      if (!isMath) return undefined;
      return {
        latex: element.getAttribute('data-latex') || element.textContent?.trim() || '',
        display: element.getAttribute('data-display') || 'false',
      };
    },
  },
);
