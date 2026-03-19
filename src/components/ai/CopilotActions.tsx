import { useCopilotAction, useCopilotReadable } from '@copilotkit/react-core';
import { useWorkspaceStore } from '../../stores/workspaceStore.ts';
import { useCanvasStore } from '../../stores/canvasStore.ts';

/**
 * CopilotActions — defines all actions the AI assistant can perform.
 * This component renders nothing; it only registers actions via hooks.
 */
export function CopilotActions() {
  const workspaces = useWorkspaceStore((s) => s.workspaces);
  const canvases = useWorkspaceStore((s) => s.canvases);
  const currentWorkspaceId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const createWorkspace = useWorkspaceStore((s) => s.createWorkspace);
  const deleteWorkspace = useWorkspaceStore((s) => s.deleteWorkspace);
  const renameWorkspace = useWorkspaceStore((s) => s.renameWorkspace);
  const createCanvas = useWorkspaceStore((s) => s.createCanvas);
  const deleteCanvas = useWorkspaceStore((s) => s.deleteCanvas);
  const renameCanvas = useWorkspaceStore((s) => s.renameCanvas);
  const setCurrentWorkspace = useWorkspaceStore((s) => s.setCurrentWorkspace);
  const setCurrentCanvas = useWorkspaceStore((s) => s.setCurrentCanvas);
  const nodes = useCanvasStore((s) => s.nodes);

  // ─── Readable context: let AI know current state ─────────
  useCopilotReadable({
    description: '当前所有文件夹列表',
    value: workspaces.map((w) => ({ id: w.id, name: w.name })),
  });

  useCopilotReadable({
    description: '当前文件夹下的画布列表',
    value: canvases.map((c) => ({ id: c.id, title: c.title })),
  });

  useCopilotReadable({
    description: '当前选中的文件夹 ID',
    value: currentWorkspaceId,
  });

  // ─── Action: 批量创建文件夹 ──────────────────────────────
  useCopilotAction({
    name: 'createFolders',
    description: '创建一个或多个文件夹。用户可能说"帮我创建 XX、YY、ZZ 文件夹"',
    parameters: [
      {
        name: 'names',
        type: 'string[]',
        description: '要创建的文件夹名称列表',
        required: true,
      },
    ],
    handler: async ({ names }: { names: string[] }) => {
      const existing = new Set(workspaces.map((w) => w.name));
      const created: string[] = [];
      const skipped: string[] = [];

      for (const name of names) {
        const trimmed = name.trim();
        if (!trimmed) continue;
        if (existing.has(trimmed)) {
          skipped.push(trimmed);
          continue;
        }
        await createWorkspace(trimmed, '📁');
        existing.add(trimmed);
        created.push(trimmed);
      }

      let msg = '';
      if (created.length > 0) msg += `已创建 ${created.length} 个文件夹：${created.join('、')}。`;
      if (skipped.length > 0) msg += `跳过 ${skipped.length} 个已存在：${skipped.join('、')}。`;
      return msg || '没有需要创建的文件夹。';
    },
  });

  // ─── Action: 重命名文件夹 ────────────────────────────────
  useCopilotAction({
    name: 'renameFolder',
    description: '重命名一个文件夹',
    parameters: [
      { name: 'oldName', type: 'string', description: '当前文件夹名称', required: true },
      { name: 'newName', type: 'string', description: '新名称', required: true },
    ],
    handler: async ({ oldName, newName }: { oldName: string; newName: string }) => {
      const ws = workspaces.find((w) => w.name === oldName);
      if (!ws) return `找不到名为"${oldName}"的文件夹。`;
      await renameWorkspace(ws.id, newName.trim());
      return `已将"${oldName}"重命名为"${newName}"。`;
    },
  });

  // ─── Action: 删除文件夹 ──────────────────────────────────
  useCopilotAction({
    name: 'deleteFolder',
    description: '删除一个文件夹（需要用户确认）',
    parameters: [
      { name: 'name', type: 'string', description: '要删除的文件夹名称', required: true },
    ],
    handler: async ({ name }: { name: string }) => {
      const ws = workspaces.find((w) => w.name === name);
      if (!ws) return `找不到名为"${name}"的文件夹。`;
      await deleteWorkspace(ws.id);
      return `已删除文件夹"${name}"。`;
    },
  });

  // ─── Action: 创建画布 ────────────────────────────────────
  useCopilotAction({
    name: 'createCanvas',
    description: '在指定文件夹下创建一个新画布',
    parameters: [
      { name: 'folderName', type: 'string', description: '文件夹名称', required: true },
      { name: 'canvasTitle', type: 'string', description: '画布标题', required: true },
    ],
    handler: async ({ folderName, canvasTitle }: { folderName: string; canvasTitle: string }) => {
      const ws = workspaces.find((w) => w.name === folderName);
      if (!ws) return `找不到名为"${folderName}"的文件夹。`;
      await createCanvas(ws.id, canvasTitle.trim());
      return `已在"${folderName}"下创建画布"${canvasTitle}"。`;
    },
  });

  // ─── Action: 重命名画布 ──────────────────────────────────
  useCopilotAction({
    name: 'renameCanvas',
    description: '重命名一个画布',
    parameters: [
      { name: 'oldTitle', type: 'string', description: '当前画布标题', required: true },
      { name: 'newTitle', type: 'string', description: '新标题', required: true },
    ],
    handler: async ({ oldTitle, newTitle }: { oldTitle: string; newTitle: string }) => {
      const c = canvases.find((c) => c.title === oldTitle);
      if (!c) return `找不到名为"${oldTitle}"的画布。`;
      await renameCanvas(c.id, newTitle.trim());
      return `已将画布"${oldTitle}"重命名为"${newTitle}"。`;
    },
  });

  // ─── Action: 切换文件夹 ──────────────────────────────────
  useCopilotAction({
    name: 'switchFolder',
    description: '切换到指定文件夹',
    parameters: [
      { name: 'name', type: 'string', description: '文件夹名称', required: true },
    ],
    handler: async ({ name }: { name: string }) => {
      const ws = workspaces.find((w) => w.name === name);
      if (!ws) return `找不到名为"${name}"的文件夹。`;
      setCurrentWorkspace(ws.id);
      return `已切换到文件夹"${name}"。`;
    },
  });

  // ─── Action: 切换画布 ────────────────────────────────────
  useCopilotAction({
    name: 'switchCanvas',
    description: '打开指定画布',
    parameters: [
      { name: 'title', type: 'string', description: '画布标题', required: true },
    ],
    handler: async ({ title }: { title: string }) => {
      const c = canvases.find((c) => c.title === title);
      if (!c) return `在当前文件夹中找不到名为"${title}"的画布。`;
      setCurrentCanvas(c.id);
      return `已打开画布"${title}"。`;
    },
  });

  // ─── Action: 列出文件夹 ──────────────────────────────────
  useCopilotAction({
    name: 'listFolders',
    description: '列出所有文件夹',
    parameters: [],
    handler: async () => {
      if (workspaces.length === 0) return '目前没有任何文件夹。';
      return `共 ${workspaces.length} 个文件夹：${workspaces.map((w) => w.name).join('、')}`;
    },
  });

  // ─── Action: 列出当前文件夹下的画布 ──────────────────────
  useCopilotAction({
    name: 'listCanvases',
    description: '列出当前文件夹下的所有画布',
    parameters: [],
    handler: async () => {
      if (canvases.length === 0) return '当前文件夹下没有画布。';
      return `共 ${canvases.length} 个画布：${canvases.map((c) => c.title).join('、')}`;
    },
  });

  // This component renders nothing — it only registers hooks
  return null;
}
