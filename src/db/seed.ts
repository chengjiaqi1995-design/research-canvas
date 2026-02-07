import { seedApi } from './apiClient.ts';
import { generateId } from '../utils/id.ts';
import type { Workspace, Canvas, ModuleConfig } from '../types/index.ts';

export async function seedIfEmpty() {
  const now = Date.now();
  const workspaceId = generateId();
  const canvasId = generateId();

  const workspace: Workspace = {
    id: workspaceId,
    name: '示例工作区',
    icon: '',
    description: '这是一个示例工作区',
    canvasIds: [canvasId],
    tags: ['示例'],
    createdAt: now,
    updatedAt: now,
  };

  const modules: ModuleConfig[] = [
    { id: 'supply_demand', name: '供需', order: 0 },
    { id: 'cost_curve', name: '成本曲线', order: 1 },
    { id: 'money_flow', name: 'Money Flow', order: 2 },
    { id: 'timing', name: 'Timing', order: 3 },
  ];

  const canvas: Canvas = {
    id: canvasId,
    workspaceId,
    title: '供需分析示例',
    template: 'custom',
    modules,
    nodes: [
      // === 供需模块 ===
      {
        id: generateId(),
        type: 'text',
        position: { x: 0, y: 0 },
        module: 'supply_demand',
        isMain: true,
        data: {
          type: 'text',
          title: '供需框架',
          content: '<h2>供给侧</h2><ul><li>产能扩张周期分析</li><li>在建项目梳理</li><li>供给增速预测</li></ul><h2>需求侧</h2><ul><li>需求结构拆分</li><li>增量来源分析</li></ul>',
        },
      },
      {
        id: generateId(),
        type: 'table',
        position: { x: 0, y: 0 },
        module: 'supply_demand',
        data: {
          type: 'table',
          title: '供给测算',
          sheetName: '供给表',
          columns: [
            { id: 'year', name: '年份', width: 80, colType: 'text' },
            { id: 'capacity', name: '产能', width: 100, colType: 'number' },
            { id: 'growth', name: '增速', width: 100, colType: 'percent' },
          ],
          rows: [
            { id: generateId(), cells: { year: '2022', capacity: 1200, growth: 0.08 } },
            { id: generateId(), cells: { year: '2023', capacity: 1350, growth: 0.125 } },
            { id: generateId(), cells: { year: '2024', capacity: 1500, growth: 0.111 } },
          ],
        },
      },
      {
        id: generateId(),
        type: 'text',
        position: { x: 0, y: 0 },
        module: 'supply_demand',
        data: {
          type: 'text',
          title: '需求测算笔记',
          content: '<p>需求侧补充分析。</p>',
        },
      },
      // === 成本曲线模块 ===
      {
        id: generateId(),
        type: 'text',
        position: { x: 0, y: 0 },
        module: 'cost_curve',
        isMain: true,
        data: {
          type: 'text',
          title: '成本框架',
          content: '<h2>成本结构</h2><ul><li>燃料成本</li><li>折旧</li><li>人工成本</li></ul><p>边际成本排序分析...</p>',
        },
      },
      {
        id: generateId(),
        type: 'table',
        position: { x: 0, y: 0 },
        module: 'cost_curve',
        data: {
          type: 'table',
          title: '成本测算表',
          sheetName: '成本表',
          columns: [
            { id: 'item', name: '项目', width: 120, colType: 'text' },
            { id: 'cost', name: '单位成本', width: 100, colType: 'number' },
            { id: 'ratio', name: '占比', width: 80, colType: 'percent' },
          ],
          rows: [
            { id: generateId(), cells: { item: '燃料', cost: 280, ratio: 0.45 } },
            { id: generateId(), cells: { item: '折旧', cost: 150, ratio: 0.24 } },
            { id: generateId(), cells: { item: '人工', cost: 80, ratio: 0.13 } },
          ],
        },
      },
      // === Money Flow 模块 ===
      {
        id: generateId(),
        type: 'text',
        position: { x: 0, y: 0 },
        module: 'money_flow',
        isMain: true,
        data: {
          type: 'text',
          title: '资金流框架',
          content: '<h2>资金流向</h2><p>产业链上下游资金流转分析。</p><ul><li>上游原材料采购</li><li>中游制造环节</li><li>下游销售回款</li></ul>',
        },
      },
      // === Timing 模块 ===
      {
        id: generateId(),
        type: 'text',
        position: { x: 0, y: 0 },
        module: 'timing',
        isMain: true,
        data: {
          type: 'text',
          title: '时间节点框架',
          content: '<h2>关键时点</h2><ul><li>Q1 政策窗口</li><li>Q2 产能释放</li><li>Q3 需求旺季</li></ul><p>催化剂跟踪...</p>',
        },
      },
    ],
    edges: [],
    viewport: { x: 0, y: 0, zoom: 1 },
    createdAt: now,
    updatedAt: now,
  };

  try {
    await seedApi.seed({ workspace, canvas });
  } catch (err) {
    console.error('Seed failed:', err);
  }
}
