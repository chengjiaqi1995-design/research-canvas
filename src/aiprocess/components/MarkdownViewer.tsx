import React, { useMemo } from 'react';
import { marked } from 'marked';


interface MarkdownViewerProps {
    content: string;
}

const MarkdownViewer: React.FC<MarkdownViewerProps> = ({ content }) => {
    const htmlContent = useMemo(() => {
        if (!content) return '';

        // 复用原来 RichTextEditor 里面的判断逻辑
        const isMarkdown = /^[\s\S]*(?:#{1,6}\s|[-*+]\s|```|`|\[.*\]\(.*\)|> |\*\*|__|~~)/.test(content);

        if (isMarkdown) {
            try {
                const contentWithoutHR = content.replace(/^[\s]*[-*]{3,}[\s]*$/gm, '');
                const htmlResult = marked(contentWithoutHR, {
                    breaks: true,
                    gfm: true,
                });
                const html = typeof htmlResult === 'string' ? htmlResult : String(htmlResult);
                return html.replace(/<hr\s*\/?>/gi, '');
            } catch (error) {
                console.error('Markdown 解析错误:', error);
                return content;
            }
        }

        return content.replace(/<hr\s*\/?>/gi, '');
    }, [content]);

    return (
        <div
            className="ProseMirror markdown-preview"
            dangerouslySetInnerHTML={{ __html: htmlContent }}
        />
    );
};

export default MarkdownViewer;
