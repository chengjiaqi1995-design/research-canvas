import { useRef, useCallback } from 'react';
import { useCanvasStore } from '../stores/canvasStore.ts';
import { aiApi } from '../db/apiClient.ts';
import type { AICardNodeData } from '../types/index.ts';

/** Extract text content from a node's data for use as AI context */
function extractNodeContent(data: { type: string; title: string; content?: string; columns?: Array<{ name: string }>; rows?: Array<{ cells: Record<string, unknown> }> }): string {
  if (data.type === 'table' && data.columns && data.rows) {
    const headers = data.columns.map((c) => c.name).join(' | ');
    const rows = data.rows.map((r) =>
      data.columns!.map((c) => {
        const v = r.cells[c.name] ?? r.cells[Object.keys(r.cells)[data.columns!.indexOf(c)]] ?? '';
        return typeof v === 'object' && v !== null ? JSON.stringify(v) : String(v ?? '');
      }).join(' | ')
    ).join('\n');
    return `${headers}\n${rows}`;
  }
  if (data.content) {
    // Strip HTML tags for context
    return data.content.replace(/<[^>]*>/g, '').trim();
  }
  return '';
}

export function useAICardGeneration(nodeId: string) {
  const abortRef = useRef<AbortController | null>(null);
  const nodes = useCanvasStore((s) => s.nodes);
  const updateNodeData = useCanvasStore((s) => s.updateNodeData);
  const appendAICardContent = useCanvasStore((s) => s.appendAICardContent);
  const setAICardStreaming = useCanvasStore((s) => s.setAICardStreaming);

  const generate = useCallback(async () => {
    const node = useCanvasStore.getState().nodes.find((n) => n.id === nodeId);
    if (!node || node.data.type !== 'ai_card') return;

    const cardData = node.data as AICardNodeData;
    if (!cardData.prompt.trim()) return;

    // Abort any existing stream
    if (abortRef.current) abortRef.current.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    // Clear previous content and start streaming
    updateNodeData(nodeId, { generatedContent: '', editedContent: '', error: undefined } as Partial<AICardNodeData>);
    setAICardStreaming(nodeId, true);

    try {
      // Build context from selected source nodes
      let context = '';
      if (cardData.config.sourceMode !== 'web' && cardData.config.sourceNodeIds.length > 0) {
        const allNodes = useCanvasStore.getState().nodes;
        const sourceNodes = cardData.config.sourceNodeIds
          .map((id) => allNodes.find((n) => n.id === id))
          .filter(Boolean);

        context = sourceNodes
          .map((n) => `## ${n!.data.title}\n${extractNodeContent(n!.data as Parameters<typeof extractNodeContent>[0])}`)
          .join('\n\n---\n\n');
      }

      // Build the full user message
      const promptWithContext = cardData.prompt.includes('{context}')
        ? cardData.prompt.replace('{context}', context || '（无提供内容）')
        : context
          ? `${cardData.prompt}\n\n---\n\n以下是参考资料：\n\n${context}`
          : cardData.prompt;

      // System prompt
      const systemPrompt = cardData.config.sourceMode === 'web'
        ? '你是一位专业的研究助理。请搜索互联网获取最新公开数据来回答问题。引用数据时请标注来源。用中文回答。'
        : cardData.config.sourceMode === 'notes_web'
          ? '你是一位专业的研究助理。请结合提供的笔记资料和互联网公开数据进行分析。引用数据时请标注来源。用中文回答。'
          : '你是一位专业的研究助理。请基于提供的资料进行分析。用中文回答。';

      // Build tools for web search (Gemini grounding)
      const isGemini = cardData.config.model.startsWith('gemini');
      const tools = (cardData.config.sourceMode === 'web' || cardData.config.sourceMode === 'notes_web') && isGemini
        ? [{ google_search: {} }]
        : undefined;

      // Stream the response
      const stream = aiApi.chatStream({
        model: cardData.config.model,
        messages: [{ role: 'user', content: promptWithContext }],
        systemPrompt,
        tools,
      });

      for await (const event of stream) {
        if (controller.signal.aborted) break;
        if (event.type === 'text' && event.content) {
          appendAICardContent(nodeId, event.content);
        } else if (event.type === 'error') {
          updateNodeData(nodeId, { error: event.content || '生成失败' } as Partial<AICardNodeData>);
          break;
        }
      }
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        updateNodeData(nodeId, { error: (err as Error).message } as Partial<AICardNodeData>);
      }
    } finally {
      setAICardStreaming(nodeId, false);
      abortRef.current = null;
    }
  }, [nodeId, updateNodeData, appendAICardContent, setAICardStreaming]);

  const stop = useCallback(() => {
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }
    setAICardStreaming(nodeId, false);
  }, [nodeId, setAICardStreaming]);

  const currentNode = nodes.find((n) => n.id === nodeId);
  const isStreaming = currentNode?.data.type === 'ai_card' ? (currentNode.data as AICardNodeData).isStreaming : false;

  return { generate, stop, isStreaming };
}
