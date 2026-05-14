import { useCallback } from 'react';
import { message } from 'antd';
import { useCanvasStore } from '../stores/canvasStore.ts';
import { generateId } from '../utils/id.ts';
import type { CanvasAttachmentReference, CanvasNode, TextNodeData } from '../types/index.ts';

export const ATTACHMENT_REF_TOKEN_PREFIX = 'RC_REF';

export function makeAttachmentReferenceId() {
  return `ref_${generateId()}`;
}

export function attachmentReferenceToken(id: string) {
  return `{{${ATTACHMENT_REF_TOKEN_PREFIX}:${id}}}`;
}

export function extractAttachmentReferenceIds(text: string) {
  return Array.from(text.matchAll(/\{\{RC_REF:([^}]+)\}\}/g)).map((match) => match[1]).filter(Boolean);
}

export function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function stripHtml(value = '') {
  return value
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

export function truncate(value: string, maxLength = 180) {
  const text = value.replace(/\s+/g, ' ').trim();
  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
}

function sortModules(modules: ReturnType<typeof useCanvasStore.getState>['modules']) {
  return [...modules].sort((a, b) => a.order - b.order);
}

function findTargetMainNode(sourceNode: CanvasNode | undefined, nodes: CanvasNode[], modules: ReturnType<typeof useCanvasStore.getState>['modules']) {
  const sourceModule = sourceNode?.module;
  const firstModuleId = sortModules(modules)[0]?.id;
  const preferredModuleId = sourceModule || firstModuleId;
  return (
    nodes.find((node) => node.module === preferredModuleId && node.isMain && node.data.type === 'text') ||
    nodes.find((node) => node.isMain && node.data.type === 'text') ||
    null
  );
}

export function useAttachmentReferences() {
  const addReferenceToHome = useCallback((reference: CanvasAttachmentReference) => {
    const { nodes, modules, updateNodeData } = useCanvasStore.getState();
    const sourceNode = nodes.find((node) => node.id === reference.sourceNodeId);
    const mainNode = findTargetMainNode(sourceNode, nodes, modules);

    if (!mainNode || mainNode.data.type !== 'text') {
      message.warning('当前 Canvas 没有可写入引用卡片的主页模块');
      return false;
    }

    const data = mainNode.data as TextNodeData;
    const references = data.references || [];
    if (references.some((item) => item.id === reference.id)) return true;

    const token = attachmentReferenceToken(reference.id);
    const content = data.content || '';
    const nextContent = content.includes(token)
      ? content
      : `${content}${content.trim() ? '\n' : ''}<p>${escapeHtml(token)}</p>`;

    updateNodeData(mainNode.id, {
      content: nextContent,
      references: [...references, reference],
    });
    message.success('已插入 Canvas 主页引用卡片');
    return true;
  }, []);

  return { addReferenceToHome };
}
