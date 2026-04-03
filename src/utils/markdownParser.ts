import { marked } from 'marked';

export function parseAIMarkdown(content: string = ''): string {
  if (!content) return '';
  
  // 1. Strip excessive `<mark>` wrappers around citations (e.g. AI generating <mark>[REF1]</mark>)
  let processed = content.replace(/<mark>\s*((\[REF\d+\]\s*)+)\s*<\/mark>/gi, '$1');
  
  // 2. Parse Markdown to HTML. Use breaks: true for GFM line breaks.
  let html = marked.parse(processed, { breaks: true, gfm: true }) as string;
  
  // 3. Formatted bidirectional links
  html = html.replace(
    /\[\[([^\]]+)\]\]/g, 
    '<span class="ref-link text-blue-500 cursor-pointer hover:underline font-medium" data-title="$1">[[$1]]</span>'
  );
  
  // 4. Formatted REF citations (Wikipedia style pills)
  html = html.replace(
    /\[REF(\d+)\]/gi, 
    '<sup class="ref-link inline-flex items-center justify-center min-w-[16px] px-1 h-[16px] text-[10px] font-semibold text-violet-600 bg-violet-50 border border-violet-200 rounded-[4px] cursor-pointer hover:bg-violet-100 hover:border-violet-300 transition-colors mx-[1px] relative -top-1" data-ref="$1">$1</sup>'
  );
  
  return html;
}
