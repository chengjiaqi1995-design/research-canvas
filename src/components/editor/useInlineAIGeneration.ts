import { useCallback, useRef, useEffect } from 'react';
import { aiApi } from '../../db/apiClient.ts';
import { useInlineAIStore } from './inlineAIStore.ts';

// Strip HTML tags to get plain text
function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<\/div>/gi, '\n')
    .replace(/<\/li>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

interface UseInlineAIGenerationOptions {
  editor: any; // BlockNoteEditor
  blockId: string;
  onContentUpdate: (content: string) => void;
  onStatusChange: (status: 'idle' | 'generating' | 'done' | 'error', errorMessageOrContent?: string) => void;
}

export function useInlineAIGeneration({
  editor,
  blockId,
  onContentUpdate,
  onStatusChange,
}: UseInlineAIGenerationOptions) {
  const { startStreaming, appendContent, getContent, stopStreaming } = useInlineAIStore.getState();
  const isStreamingRef = useRef(false);

  // Subscribe to streaming state for this block
  const isStreaming = useInlineAIStore((s) => s.streamingBlocks.get(blockId)?.isStreaming || false);

  useEffect(() => {
    isStreamingRef.current = isStreaming;
  }, [isStreaming]);

  const generate = useCallback(
    async (
      prompt: string, 
      model: string, 
      skillContent?: string,
      sourceConfig?: {
        sourceWorkspaceIds: string[];
        sourceCanvasIds: string[];
        sourceDateFrom: string;
        sourceDateTo: string;
        sourceDateField: string;
      },
      formatContent?: string
    ) => {
      if (!prompt.trim() && !skillContent && !formatContent) return;
      if (isStreamingRef.current) return;

      // Extract context from backend or local note
      let context = '';
      try {
        const hasExternalFilters =
          (sourceConfig?.sourceWorkspaceIds && sourceConfig.sourceWorkspaceIds.length > 0) ||
          (sourceConfig?.sourceCanvasIds && sourceConfig.sourceCanvasIds.length > 0) ||
          sourceConfig?.sourceDateFrom ||
          sourceConfig?.sourceDateTo;

        if (hasExternalFilters) {
          const { notesApi } = await import('../../db/apiClient.ts');
          const result = await notesApi.query(
            sourceConfig.sourceWorkspaceIds || [],
            sourceConfig.sourceCanvasIds || [],
            sourceConfig.sourceDateFrom,
            sourceConfig.sourceDateTo,
            (sourceConfig.sourceDateField as any) || 'occurred'
          );
          context = result.notes
            .map((n: any, i: number) => `[REF${i + 1}] ${n.title}\n${stripHtml(n.content || '')}`)
            .join('\n\n---\n\n');
        } else {
          // Fallback to local document context
          const allBlocks = editor.document;
          // Filter out the current AI inline block
          const otherBlocks = allBlocks.filter(
            (b: any) => !(b.type === 'aiInline' && b.props?.blockId === blockId)
          );
          if (otherBlocks.length > 0) {
            const html = await editor.blocksToHTMLLossy(otherBlocks);
            context = stripHtml(html);
          }
        }
      } catch (err) {
        console.warn('Failed to extract note context:', err);
      }

      // Build the full prompt with context
      let fullPrompt: string = prompt.trim();
      if (prompt.includes('{context}')) {
        fullPrompt = prompt.replace('{context}', context || '（无内容）');
      } else if (context) {
        fullPrompt = fullPrompt ? `${fullPrompt}\n\n---\n以下是当前笔记的内容作为参考资料：\n\n${context}` : `以下是当前笔记的内容作为参考资料：\n\n${context}`;
      }

      // Append skill/methodology if provided
      if (skillContent) {
        fullPrompt += `\n\n## 必须遵循的方法论 (Skill)\n${skillContent}`;
      }

      // Append format requirements if provided
      if (formatContent) {
        fullPrompt += `\n\n## 必须遵循的输出格式 (Format)\n${formatContent}`;
      }

      // Start streaming
      const controller = startStreaming(blockId);
      onStatusChange('generating');

      try {
        const systemPrompt =
          '你是一位专业的研究分析助理。基于用户提供的笔记内容和指令，生成高质量的分析内容。请用中文回答，除非用户要求用其他语言。';

        const stream = aiApi.chatStream({
          model: model || 'gemini-3-flash-preview',
          messages: [{ role: 'user', content: fullPrompt }],
          systemPrompt,
        });

        for await (const event of stream) {
          if (controller.signal.aborted) break;
          if (event.type === 'text' && event.content) {
            appendContent(blockId, event.content);
            const accumulated = getContent(blockId);
            onContentUpdate(accumulated);
          }
        }

        if (!controller.signal.aborted) {
          const finalContent = getContent(blockId);
          onContentUpdate(finalContent);
          onStatusChange('done', finalContent);
        }
      } catch (err: any) {
        if (err?.name !== 'AbortError') {
          console.error('Inline AI generation error:', err);
          onStatusChange('error', err?.message || '生成失败');
        }
      } finally {
        stopStreaming(blockId);
      }
    },
    [editor, blockId, onContentUpdate, onStatusChange, startStreaming, appendContent, getContent, stopStreaming]
  );

  const abort = useCallback(() => {
    const state = useInlineAIStore.getState().streamingBlocks.get(blockId);
    if (state?.abortController) {
      state.abortController.abort();
    }
    stopStreaming(blockId);
    onStatusChange('done');
  }, [blockId, stopStreaming, onStatusChange]);

  return { generate, abort, isStreaming };
}
