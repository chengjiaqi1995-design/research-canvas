import React, { useMemo, useRef } from 'react';
import { useMermaidRender } from '../../hooks/useMermaidRender.ts';
import { markdownToHtmlWithMath, replaceMathDelimitersWithSpans } from '../../utils/mathMarkdown.ts';


interface MarkdownViewerProps {
    content: string;
}

const MarkdownViewer: React.FC<MarkdownViewerProps> = ({ content }) => {
    const contentRef = useRef<HTMLDivElement>(null);
    useMermaidRender(contentRef, [content]);

    const htmlContent = useMemo(() => {
        if (!content) return '';

        // 复用原来 RichTextEditor 里面的判断逻辑
        const isMarkdown = /^[\s\S]*(?:#{1,6}\s|[-*+]\s|```|`|\[.*\]\(.*\)|> |\*\*|__|~~)/.test(content);

        if (isMarkdown) {
            try {
                const contentWithoutHR = content.replace(/^[\s]*[-*]{3,}[\s]*$/gm, '');
                const htmlResult = markdownToHtmlWithMath(contentWithoutHR, {
                    breaks: true,
                    gfm: true,
                });
                return htmlResult.replace(/<hr\s*\/?>/gi, '');
            } catch (error) {
                console.error('Markdown 解析错误:', error);
                return content;
            }
        }

        return replaceMathDelimitersWithSpans(content).replace(/<hr\s*\/?>/gi, '');
    }, [content]);

    return (
        <div
            ref={contentRef}
            className="ProseMirror markdown-preview"
            dangerouslySetInnerHTML={{ __html: htmlContent }}
        />
    );
};

export default MarkdownViewer;
