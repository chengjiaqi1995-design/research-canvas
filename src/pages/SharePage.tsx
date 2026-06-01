import { useEffect, useState } from 'react';
import { markdownToHtmlWithMath, replaceMathDelimitersWithSpans } from '../utils/mathMarkdown.ts';

interface ShareData {
  title: string;
  content: string;
  createdAt: string;
}

type CanvasAttachmentFormat = 'markdown' | 'html';

/** 将 markdown 转为 HTML（如果看起来像 markdown） */
function toHtml(text: string): string {
  if (!text) return '';
  if (text.trim().startsWith('<') && /<\/(p|h[1-6]|ul|ol|li|div)>/i.test(text)) {
    return replaceMathDelimitersWithSpans(text);
  }
  return markdownToHtmlWithMath(text);
}

function htmlAttachmentSrcDoc(content: string): string {
  if (/^\s*(<!doctype|<html)/i.test(content)) return content;
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <style>
    body {
      margin: 0;
      padding: 28px;
      color: #334155;
      background: #fff;
      font: 14px/1.8 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    }
    h1, h2, h3, h4, h5, h6 { color: #1e293b; line-height: 1.35; }
    h1 { font-size: 24px; }
    h2 { font-size: 20px; }
    h3 { font-size: 17px; }
    table { border-collapse: collapse; margin: 1em 0; max-width: 100%; }
    th, td { border: 1px solid #dbe6f4; padding: 8px 12px; text-align: left; }
    th { background: #f1f7ff; font-weight: 700; }
    code { background: #f1f5f9; border-radius: 4px; padding: 1px 4px; }
    pre { background: #0f172a; color: #e2e8f0; border-radius: 8px; padding: 12px; overflow: auto; }
    blockquote { border-left: 3px solid #cbd5e1; color: #64748b; margin: 1em 0; padding-left: 12px; }
    .ref-link, [data-ref] {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-width: 18px;
      height: 18px;
      padding: 0 6px;
      margin: 0 2px;
      border-radius: 999px;
      background: #eff6ff;
      border: 1px solid #bfdbfe;
      color: #1d4ed8;
      font-size: 11px;
      font-weight: 700;
      text-decoration: none;
    }
  </style>
</head>
<body>${content}</body>
</html>`;
}

export default function SharePage({ token }: { token: string }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [title, setTitle] = useState('');
  const [summary, setSummary] = useState('');
  const [translatedSummary, setTranslatedSummary] = useState('');
  const [attachmentContent, setAttachmentContent] = useState('');
  const [attachmentFormat, setAttachmentFormat] = useState<CanvasAttachmentFormat>('markdown');

  useEffect(() => {
    setLoading(true);
    setError('');
    setTitle('');
    setSummary('');
    setTranslatedSummary('');
    setAttachmentContent('');
    setAttachmentFormat('markdown');

    const baseUrl = import.meta.env.VITE_API_BASE_URL || '/api';
    fetch(`${baseUrl}/share/${token}`)
      .then(r => r.json())
      .then((res) => {
        if (!res.success) {
          setError(res.error || '获取分享内容失败');
          return;
        }
        const data: ShareData = res.data;
        setTitle(data.title || '');

        // 尝试解析 JSON 格式（新版：包含 summary + translatedSummary）
        try {
          const parsed = JSON.parse(data.content);
          if (parsed.type === 'summary') {
            setSummary(parsed.summary || '');
            setTranslatedSummary(parsed.translatedSummary || '');
            return;
          }
          if (parsed.type === 'canvas-attachment') {
            setAttachmentContent(parsed.content || '');
            setAttachmentFormat(parsed.format === 'html' ? 'html' : 'markdown');
            return;
          }
        } catch {
          // 不是 JSON，当作旧版纯文本处理
        }
        // 旧版分享：content 就是摘要文本
        setTranslatedSummary(data.content);
      })
      .catch(() => setError('网络异常，请稍后重试'))
      .finally(() => setLoading(false));
  }, [token]);

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', color: '#94a3b8', fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif' }}>
        加载中...
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif' }}>
        <div style={{ textAlign: 'center', color: '#64748b' }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>🔗</div>
          <div style={{ fontSize: 16, fontWeight: 500, marginBottom: 8, color: '#334155' }}>{error}</div>
          <div style={{ fontSize: 13 }}>该链接可能已过期或不存在</div>
        </div>
      </div>
    );
  }

  return (
    <div style={{ height: '100vh', overflow: 'auto', background: '#fafbfc', fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif' }}>
      <div style={{ padding: '40px 32px 80px' }}>
        {/* 标题 */}
        {title && (
          <h1 style={{ fontSize: 22, fontWeight: 600, color: '#1e293b', marginBottom: 32, paddingBottom: 16, borderBottom: '1px solid #e2e8f0' }}>
            {title}
          </h1>
        )}

        {/* Canvas 附件 */}
        {attachmentContent && (
          <section style={{ marginBottom: 40 }}>
            {attachmentFormat === 'html' ? (
              <iframe
                className="share-html-frame"
                title={title || 'Canvas HTML 附件'}
                srcDoc={htmlAttachmentSrcDoc(attachmentContent)}
                sandbox="allow-scripts allow-popups"
              />
            ) : (
              <div
                className="share-content"
                dangerouslySetInnerHTML={{ __html: toHtml(attachmentContent) }}
              />
            )}
          </section>
        )}

        {/* 中文摘要 */}
        {translatedSummary && (
          <section style={{ marginBottom: 40 }}>
            {summary && <h2 style={{ fontSize: 14, fontWeight: 500, color: '#64748b', marginBottom: 16, textTransform: 'uppercase', letterSpacing: 1 }}>中文摘要</h2>}
            <div
              className="share-content"
              dangerouslySetInnerHTML={{ __html: toHtml(translatedSummary) }}
            />
          </section>
        )}

        {/* 英文摘要 */}
        {summary && (
          <section>
            {translatedSummary && <h2 style={{ fontSize: 14, fontWeight: 500, color: '#64748b', marginBottom: 16, textTransform: 'uppercase', letterSpacing: 1 }}>Summary</h2>}
            <div
              className="share-content"
              dangerouslySetInnerHTML={{ __html: toHtml(summary) }}
            />
          </section>
        )}

        {/* 底部提示 */}
        <div style={{ marginTop: 48, paddingTop: 16, borderTop: '1px solid #e2e8f0', textAlign: 'center', fontSize: 12, color: '#94a3b8' }}>
          此内容通过 Research Canvas 分享
        </div>
      </div>

      <style>{`
        .share-content {
          font-size: 14px;
          line-height: 1.8;
          color: #334155;
          overflow-x: auto;
          -webkit-overflow-scrolling: touch;
        }
        .share-content h1, .share-content h2, .share-content h3,
        .share-content h4, .share-content h5, .share-content h6 {
          color: #1e293b;
          margin-top: 1.5em;
          margin-bottom: 0.5em;
          font-weight: 600;
        }
        .share-content h3 { font-size: 16px; }
        .share-content h4 { font-size: 15px; }
        .share-content p { margin-bottom: 0.8em; }
        .share-content ul, .share-content ol {
          padding-left: 1.5em;
          margin-top: 0.35em;
          margin-bottom: 0.8em;
        }
        .share-content ul { list-style-type: disc; }
        .share-content ol { list-style-type: decimal; }
        .share-content ul ul { list-style-type: circle; }
        .share-content ul ul ul { list-style-type: square; }
        .share-content ol ol { list-style-type: lower-alpha; }
        .share-content li {
          display: list-item;
          margin-bottom: 0.3em;
          padding-left: 0.15em;
        }
        .share-content li::marker {
          color: #64748b;
          font-size: 0.9em;
        }
        .share-content li > p {
          margin: 0.15em 0;
        }
        .share-content strong { font-weight: 600; color: #1e293b; }
        .share-content blockquote {
          border-left: 3px solid #cbd5e1;
          padding-left: 12px;
          margin: 0.8em 0;
          color: #64748b;
        }
        .share-content code {
          background: #f1f5f9;
          padding: 1px 4px;
          border-radius: 3px;
          font-size: 13px;
        }
        .share-content table {
          display: inline-table;
          width: auto;
          max-width: none;
          border-collapse: collapse;
          margin: 1em 0;
        }
        .share-content th, .share-content td {
          border: 1px solid #e2e8f0;
          padding: 8px 12px;
          text-align: left;
          font-size: 13px;
        }
        .share-content th { background: #f8fafc; font-weight: 600; }
        .share-content .ref-link, .share-content [data-ref] {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          min-width: 18px;
          height: 18px;
          padding: 0 6px;
          margin: 0 2px;
          border-radius: 999px;
          background: #eff6ff;
          border: 1px solid #bfdbfe;
          color: #1d4ed8;
          font-size: 11px;
          font-weight: 700;
          text-decoration: none;
          vertical-align: baseline;
        }
        .share-html-frame {
          width: 100%;
          min-height: calc(100vh - 210px);
          border: 1px solid #e2e8f0;
          border-radius: 10px;
          background: #fff;
        }
      `}</style>
    </div>
  );
}
