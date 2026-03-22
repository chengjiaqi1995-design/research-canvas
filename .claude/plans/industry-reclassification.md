# 行业重分类计划

## 目标
1. 前端 UI 用「大分类」对小行业 workspace 进行视觉分组（不改数据模型）
2. 后端一次性迁移脚本，按用户给定的分类创建/合并 workspace 和公司文件夹
3. 每个小行业下创建「行业研究」「Expert」「Sellside」三个子文件夹

## 不改动的部分
- Workspace 数据模型不变（parentId 保持一级嵌套）
- 大分类不入库，只是前端常量

---

## Step 1: 新增前端常量 — 大分类→小分类映射

文件: `src/constants/industryCategories.ts`（新建）

定义 `INDUSTRY_CATEGORY_MAP`:
```ts
export const INDUSTRY_CATEGORY_MAP: { label: string; icon: string; subCategories: string[] }[] = [
  { label: '农业', icon: '🌾', subCategories: ['农用机械'] },
  { label: '工业', icon: '🏭', subCategories: ['五金工具', '军工', '卡车', '基建地产链条', '工程机械/矿山机械', '机器人/工业自动化', '泛工业', '自动驾驶', '航空航天', '钠电', '锂电', '零部件'] },
  { label: '建设', icon: '🏗️', subCategories: ['EPC', '设备租赁'] },
  { label: '消费', icon: '🛒', subCategories: ['两轮车/全地形车', '创新消费品', '报废车', '汽车'] },
  { label: '物流和运输', icon: '🚢', subCategories: ['车运/货代', '造船'] },
  { label: '电力', icon: '⚡', subCategories: ['bitcoin miner', '天然气发电', '核电', '电力运营商', '电网设备', '风光储'] },
  { label: '科技和互联网', icon: '💻', subCategories: ['互联网/大模型', '工业软件', '数据中心设备'] },
  { label: '能源', icon: '🛢️', subCategories: ['LNG'] },
  { label: '资源', icon: '⛏️', subCategories: ['战略金属', '稀土', '铜金', '铝'] },
  { label: '政治', icon: '🏛️', subCategories: ['宏观'] },
  { label: '未分大类', icon: '📁', subCategories: ['有色金属', '未归类', '金属与矿业'] },
];
```

同时定义完整的公司列表映射（小分类 → 公司名列表），用于迁移脚本。

## Step 2: 修改 FolderColumn — 用大分类分组显示

文件: `src/components/layout/FolderColumn.tsx`

在「行业」分类下，不直接平铺所有小行业 workspace，而是：
- 读取 `INDUSTRY_CATEGORY_MAP`
- 把小行业 workspace 按大分类分组
- 渲染为：大分类标题（可折叠）→ 小行业文件夹列表 → 公司子文件夹
- 不在映射里的小行业归入「未分大类」

## Step 3: 后端迁移 API

文件: `server/server.js`

新增 `POST /api/migrate/reorganize` 端点：

1. **读取所有 workspace**
2. **确保所有小分类 workspace 存在**（不存在则创建）
3. **在每个小分类下创建「行业研究」「Expert」「Sellside」子文件夹**（若不存在）
4. **按用户给定的公司列表，确保每个公司文件夹存在**于正确的小分类下
5. **处理公司迁移/合并**：
   - 如果某公司已存在于其他小分类下，将其 canvas 移动到目标文件夹，删除空的原文件夹
   - 如果同一公司有重复文件夹（如 `Mitsubishi Heavy Industries Ltd` 和 `Mitsubishi Heavy Industries Ltd.`），合并 canvas
6. **不删除任何 canvas**，只移动
7. 返回操作日志

## Step 4: 前端触发迁移

在 SyncDialog 或设置里加一个「重新组织文件夹」按钮，调用迁移 API。

---

## 安全保障
- 迁移前先快照所有 workspace 数据到日志
- 只移动，不删除 canvas
- 空文件夹在迁移完成后才清理
- 返回详细的操作报告供确认
