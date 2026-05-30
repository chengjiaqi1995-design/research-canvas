type MermaidApi = typeof import('mermaid').default;

const MERMAID_LANGUAGE_RE = /(?:^|\s)(?:language-)?mermaid(?:\s|$)/i;
const MERMAID_START_RE =
  /^(?:flowchart|graph|sequenceDiagram|classDiagram|stateDiagram(?:-v2)?|erDiagram|journey|gantt|pie|mindmap|timeline|gitGraph|quadrantChart|requirementDiagram|C4Context|C4Container|C4Component|C4Dynamic|sankey-beta|xychart-beta|block-beta|packet-beta|architecture-beta|kanban)\b/i;

let mermaidPromise: Promise<MermaidApi> | null = null;
let renderCounter = 0;

type RenderRoot = Document | Element | DocumentFragment;

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function getDocument(root: RenderRoot): Document {
  if ((root as Node).nodeType === Node.DOCUMENT_NODE) return root as Document;
  return root.ownerDocument || document;
}

function getMermaid(): Promise<MermaidApi> {
  if (!mermaidPromise) {
    mermaidPromise = import('mermaid').then((mod) => {
      const mermaid = mod.default;
      mermaid.initialize({
        startOnLoad: false,
        securityLevel: 'strict',
        theme: 'base',
        themeVariables: {
          fontFamily: 'Inter, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
          primaryColor: '#eff6ff',
          primaryTextColor: '#0f172a',
          primaryBorderColor: '#60a5fa',
          lineColor: '#64748b',
          secondaryColor: '#f8fafc',
          tertiaryColor: '#ffffff',
          noteBkgColor: '#fff7ed',
          noteTextColor: '#7c2d12',
        },
      });
      return mermaid;
    });
  }
  return mermaidPromise;
}

export function looksLikeMermaid(source: string): boolean {
  const trimmed = source.trimStart();
  if (!trimmed) return false;
  return MERMAID_START_RE.test(trimmed);
}

function isMermaidCode(code: HTMLElement): boolean {
  const className = code.className || '';
  return MERMAID_LANGUAGE_RE.test(className) || looksLikeMermaid(code.textContent || '');
}

function installMermaidStyles(doc: Document) {
  if (doc.getElementById('rc-mermaid-render-style')) return;
  const style = doc.createElement('style');
  style.id = 'rc-mermaid-render-style';
  style.textContent = `
    .rc-mermaid {
      display: inline-block;
      width: fit-content;
      max-width: 100%;
      margin: 18px 0;
      padding: 16px;
      border: 1px solid #dbeafe;
      border-radius: 10px;
      background: #ffffff;
      overflow-x: auto;
      box-shadow: 0 1px 2px rgba(15, 23, 42, 0.04);
    }
    .rc-mermaid svg {
      display: block;
      width: auto !important;
      max-width: none;
      height: auto;
      margin: 0 auto;
    }
    .rc-mermaid-preview {
      margin-top: 8px;
    }
    .rc-mermaid-error {
      border-color: #fecaca;
      background: #fff7f7;
      color: #991b1b;
    }
    .rc-mermaid-error pre {
      margin: 10px 0 0;
      white-space: pre-wrap;
      word-break: break-word;
      color: #334155;
      background: #fff;
    }
  `;
  (doc.head || doc.documentElement).appendChild(style);
}

function createMermaidContainer(doc: Document, source: string, extraClass = '') {
  const div = doc.createElement('div');
  div.className = `rc-mermaid${extraClass ? ` ${extraClass}` : ''}`;
  div.dataset.mermaid = encodeURIComponent(source);
  div.textContent = '正在渲染图表...';
  return div;
}

function collectTargets(root: RenderRoot): HTMLElement[] {
  const doc = getDocument(root);
  const targets: HTMLElement[] = [];

  root.querySelectorAll<HTMLElement>('.rc-mermaid[data-mermaid]').forEach((element) => {
    const state = element.dataset.rcMermaidState;
    if (state !== 'rendered' && state !== 'rendering' && state !== 'error') {
      targets.push(element);
    }
  });

  root.querySelectorAll<HTMLElement>('pre > code').forEach((code) => {
    if (!isMermaidCode(code)) return;
    const pre = code.closest('pre') as HTMLElement | null;
    if (!pre || pre.dataset.rcMermaidProcessed === '1') return;

    const source = code.textContent || '';
    if (!source.trim()) return;
    const editable = Boolean(code.closest('[contenteditable="true"]'));
    const container = createMermaidContainer(doc, source, editable ? 'rc-mermaid-preview' : '');
    pre.dataset.rcMermaidProcessed = '1';

    if (editable) {
      pre.insertAdjacentElement('afterend', container);
    } else {
      pre.replaceWith(container);
    }
    targets.push(container);
  });

  // Standard Mermaid convention: <div class="mermaid"> / <pre class="mermaid">
  // (most common markup an LLM emits in raw HTML reports).
  root.querySelectorAll<HTMLElement>('.mermaid').forEach((element) => {
    if (element.classList.contains('rc-mermaid')) return;
    if (element.dataset.rcMermaidProcessed === '1') return;
    // Skip if this element merely wraps an inner code block we already handled.
    if (element.querySelector('.rc-mermaid')) return;

    const source = (element.dataset.mermaidSource || element.textContent || '').trim();
    if (!source) return;
    const editable = Boolean(element.closest('[contenteditable="true"]'));
    const container = createMermaidContainer(doc, source, editable ? 'rc-mermaid-preview' : '');
    element.dataset.rcMermaidProcessed = '1';

    if (editable) {
      // Preserve original source for editing; show the rendered preview below.
      element.dataset.mermaidSource = source;
      element.insertAdjacentElement('afterend', container);
    } else {
      element.replaceWith(container);
    }
    targets.push(container);
  });

  return targets;
}

async function renderTarget(mermaid: MermaidApi, target: HTMLElement) {
  const encoded = target.dataset.mermaid || '';
  const source = decodeURIComponent(encoded);
  if (!source.trim()) return;

  target.dataset.rcMermaidState = 'rendering';
  try {
    const id = `rc-mermaid-${Date.now()}-${renderCounter++}`;
    const result = await mermaid.render(id, source);
    target.innerHTML = result.svg;
    result.bindFunctions?.(target);
    target.dataset.rcMermaidState = 'rendered';
  } catch (error) {
    target.dataset.rcMermaidState = 'error';
    target.classList.add('rc-mermaid-error');
    target.innerHTML = `<div>Mermaid 图表渲染失败，请检查语法。</div><pre>${escapeHtml(source)}</pre>`;
    console.warn('Mermaid render failed:', error);
  }
}

export async function renderMermaidInElement(root: RenderRoot | null | undefined) {
  if (!root || typeof document === 'undefined') return;
  const targets = collectTargets(root);
  if (targets.length === 0) return;

  installMermaidStyles(getDocument(root));
  const mermaid = await getMermaid();
  await Promise.all(targets.map((target) => renderTarget(mermaid, target)));
}
