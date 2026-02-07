import Dexie, { type Table } from 'dexie';
import type { Workspace, Canvas } from '../types/index.ts';

class ResearchCanvasDB extends Dexie {
  workspaces!: Table<Workspace>;
  canvases!: Table<Canvas>;

  constructor() {
    super('ResearchCanvasDB');
    this.version(1).stores({
      workspaces: 'id, name, *tags, updatedAt',
      canvases: 'id, workspaceId, title, template, updatedAt',
    });
  }
}

export const db = new ResearchCanvasDB();
