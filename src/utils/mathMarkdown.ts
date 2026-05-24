import { marked } from 'marked';
import katex from 'katex';

type MarkedOptions = Parameters<typeof marked.parse>[1];

interface MathSegment {
  placeholder: string;
  latex: string;
  display: boolean;
}

const CODE_PLACEHOLDER_PREFIX = '\uE000RC_CODE_';
const MATH_PLACEHOLDER_PREFIX = '\uE000RC_MATH_';
const PLACEHOLDER_SUFFIX = '\uE001';

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function decodeCommonEntities(value: string): string {
  return value
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function maskCode(content: string): { text: string; restore: (text: string) => string } {
  const codeSegments: string[] = [];
  const text = content.replace(/```[\s\S]*?```|`[^`\n]+`/g, (match) => {
    const index = codeSegments.push(match) - 1;
    return `${CODE_PLACEHOLDER_PREFIX}${index}${PLACEHOLDER_SUFFIX}`;
  });
  return {
    text,
    restore: (value: string) => value.replace(
      new RegExp(`${CODE_PLACEHOLDER_PREFIX}(\\d+)${PLACEHOLDER_SUFFIX}`, 'g'),
      (_match, index) => codeSegments[Number(index)] || '',
    ),
  };
}

function looksLikeInlineMath(latex: string): boolean {
  const trimmed = latex.trim();
  if (!trimmed || /\n/.test(trimmed)) return false;
  if (/^[\d\s,，.]+$/.test(trimmed)) return false;
  return /\\|[_^{}=<>]|[A-Za-z]\s*[_^]|[+\-*/]=?|≤|≥|≈|×|÷/.test(trimmed);
}

function toMathSpan(segment: MathSegment): string {
  const latex = decodeCommonEntities(segment.latex).trim();
  const display = segment.display ? 'true' : 'false';
  const fallback = segment.display ? `$$${latex}$$` : `\\(${latex}\\)`;
  let rendered = escapeHtml(fallback);
  try {
    rendered = katex.renderToString(latex, {
      displayMode: segment.display,
      throwOnError: false,
      strict: 'ignore',
      output: 'htmlAndMathml',
    });
  } catch {
    // Keep the original formula readable if KaTeX cannot parse it.
  }
  return `<span data-inline-content-type="mathFormula" data-latex="${escapeHtml(latex)}" data-display="${display}" class="math-formula-source">${rendered}</span>`;
}

function extractMathSegments(content: string): { text: string; segments: MathSegment[] } {
  const segments: MathSegment[] = [];
  const pushSegment = (latex: string, display: boolean) => {
    const placeholder = `${MATH_PLACEHOLDER_PREFIX}${segments.length}${PLACEHOLDER_SUFFIX}`;
    segments.push({ placeholder, latex, display });
    return placeholder;
  };

  let text = content
    .replace(/\$\$([\s\S]+?)\$\$/g, (_match, latex) => pushSegment(String(latex), true))
    .replace(/\\\[([\s\S]+?)\\\]/g, (_match, latex) => pushSegment(String(latex), true))
    .replace(/\\\(([\s\S]+?)\\\)/g, (_match, latex) => pushSegment(String(latex), false));

  text = text.replace(/(^|[^\\$])\$([^\n$]+?)\$(?!\$)/g, (match, prefix, latex) => {
    const rawLatex = String(latex);
    if (!looksLikeInlineMath(rawLatex)) return match;
    return `${prefix}${pushSegment(rawLatex, false)}`;
  });

  return { text, segments };
}

function injectMathSpans(content: string, segments: MathSegment[]): string {
  return segments.reduce(
    (html, segment) => html.replaceAll(segment.placeholder, toMathSpan(segment)),
    content,
  );
}

export function containsMathDelimiters(content: string): boolean {
  return /\$\$[\s\S]+?\$\$|\\\[[\s\S]+?\\\]|\\\([\s\S]+?\\\)/.test(content) ||
    /(^|[^\\$])\$[^\n$]+?\$(?!\$)/.test(content);
}

export function replaceMathDelimitersWithSpans(content: string): string {
  if (!content || !containsMathDelimiters(content)) return content;
  const masked = maskCode(content);
  const extracted = extractMathSegments(masked.text);
  return masked.restore(injectMathSpans(extracted.text, extracted.segments));
}

export function markdownToHtmlWithMath(content: string, options?: MarkedOptions): string {
  if (!content) return '';
  const masked = maskCode(content);
  const extracted = extractMathSegments(masked.text);
  const markdown = masked.restore(extracted.text);
  const html = marked.parse(markdown, { ...options, async: false }) as string;
  return injectMathSpans(html, extracted.segments);
}
