import { useEffect, useRef, useState } from 'react';
import { Code2, Eye } from 'lucide-react';
import { renderMermaidToSvg } from '../../utils/mermaidRenderer.ts';

/**
 * Mermaid v11 emits an SVG with an inline `style="max-width:Npx"` plus fixed
 * `width`/`height` attributes — that pins the diagram to its tiny natural size
 * and makes labels unreadable. Strip those so the SVG scales to the container
 * via its viewBox.
 */
function fluidizeSvg(rawSvg: string): string {
  if (!rawSvg) return rawSvg;
  return rawSvg.replace(/<svg\b[^>]*>/i, (openTag) => {
    let tag = openTag;
    // remove fixed width/height attributes
    tag = tag.replace(/\s(width|height)="[^"]*"/gi, '');
    // strip max-width from inline style; drop the attribute if it becomes empty
    tag = tag.replace(/\sstyle="([^"]*)"/i, (_m, css) => {
      const cleaned = css
        .split(';')
        .map((d: string) => d.trim())
        .filter((d: string) => d && !/^max-width\s*:/i.test(d))
        .join('; ');
      return cleaned ? ` style="${cleaned}"` : '';
    });
    // inject our own scaling rules
    if (/\sstyle="/i.test(tag)) {
      tag = tag.replace(/\sstyle="/i, ' style="width:100%; height:auto; max-width:100%; ');
    } else {
      tag = tag.replace(/<svg\b/i, '<svg style="width:100%; height:auto; max-width:100%;"');
    }
    return tag;
  });
}

interface MermaidBlockRendererProps {
  code: string;
  editable?: boolean;
  onChangeCode?: (next: string) => void;
}

export function MermaidBlockRenderer({ code, editable = false, onChangeCode }: MermaidBlockRendererProps) {
  const [svg, setSvg] = useState<string>('');
  const [error, setError] = useState<string>('');
  const [showSource, setShowSource] = useState(false);
  const [draft, setDraft] = useState(code);
  const renderTokenRef = useRef(0);

  useEffect(() => {
    setDraft(code);
  }, [code]);

  useEffect(() => {
    const source = code.trim();
    if (!source) {
      setSvg('');
      setError('');
      return;
    }
    const token = ++renderTokenRef.current;
    let cancelled = false;
    renderMermaidToSvg(source)
      .then((result) => {
        if (cancelled || token !== renderTokenRef.current) return;
        setSvg(fluidizeSvg(result));
        setError('');
      })
      .catch((err) => {
        if (cancelled || token !== renderTokenRef.current) return;
        setSvg('');
        setError(err?.message || 'Mermaid 图表渲染失败，请检查语法。');
      });
    return () => {
      cancelled = true;
    };
  }, [code]);

  return (
    <div
      contentEditable={false}
      className="rc-mermaid-block"
      style={{
        border: '1px solid #dbeafe',
        borderRadius: '10px',
        background: '#ffffff',
        margin: '12px 0',
        boxShadow: '0 1px 2px rgba(15, 23, 42, 0.04)',
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '4px 8px',
          borderBottom: '1px solid #eff6ff',
          background: '#f8fafc',
        }}
      >
        <span style={{ fontSize: '10px', fontWeight: 600, color: '#64748b', letterSpacing: '0.04em' }}>
          MERMAID
        </span>
        <button
          type="button"
          onClick={() => setShowSource((v) => !v)}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '4px',
            fontSize: '11px',
            color: '#2563eb',
            padding: '2px 6px',
            borderRadius: '6px',
            cursor: 'pointer',
            background: 'transparent',
            border: 'none',
          }}
          title={showSource ? '查看图表' : '查看/编辑源码'}
        >
          {showSource ? <Eye size={12} /> : <Code2 size={12} />}
          {showSource ? '图表' : '源码'}
        </button>
      </div>

      {showSource ? (
        <textarea
          value={draft}
          spellCheck={false}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => {
            if (onChangeCode && draft !== code) onChangeCode(draft);
          }}
          readOnly={!editable}
          style={{
            width: '100%',
            minHeight: '160px',
            padding: '12px',
            border: 'none',
            outline: 'none',
            resize: 'vertical',
            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
            fontSize: '12px',
            lineHeight: 1.6,
            color: '#0f172a',
            background: '#0f172a05',
          }}
        />
      ) : error ? (
        <div style={{ padding: '12px', color: '#991b1b', background: '#fff7f7' }}>
          <div style={{ fontSize: '13px', marginBottom: '8px' }}>Mermaid 图表渲染失败，请检查语法。</div>
          <pre
            style={{
              margin: 0,
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
              color: '#334155',
              fontSize: '12px',
            }}
          >
            {code}
          </pre>
        </div>
      ) : svg ? (
        <div
          className="rc-mermaid-svg-host"
          style={{
            padding: '20px 24px',
            overflowX: 'auto',
            textAlign: 'center',
            width: '100%',
            minHeight: '120px',
          }}
          // eslint-disable-next-line react/no-danger
          dangerouslySetInnerHTML={{ __html: svg }}
        />
      ) : (
        <div style={{ padding: '16px', color: '#94a3b8', fontSize: '13px' }}>正在渲染图表...</div>
      )}
    </div>
  );
}
