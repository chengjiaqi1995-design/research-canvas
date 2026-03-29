import { useEffect, useState } from 'react';
import { marked } from 'marked';

interface ShareData {
  title: string;
  content: string;
  createdAt: string;
}

/** 将 markdown 转为 HTML（如果看起来像 markdown） */
function toHtml(text: string): string {
  if (!text) return '';
  if (text.trim().startsWith('<') && /<\/(p|h[1-6]|ul|ol|li|div)>/i.test(text)) return text;
  return marked.parse(text, { async: false }) as string;
}

export default function SharePage({ token }: { token: string }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [title, setTitle] = useState('');
  const [summary, setSummary] = useState('');
  const [translatedSummary, setTranslatedSummary] = useState('');

  useEffect(() => {
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
          margin-bottom: 0.8em;
        }
        .share-content li { margin-bottom: 0.3em; }
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
          width: 100%;
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
      `}</style>
    </div>
  );
}
