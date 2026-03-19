# 从"笔记本"到"文件管理系统"改造方案

## 一、改造目标

将 Research Canvas 从当前的"Workspace > Canvas > Module > Node"四层结构，
改为更直观的**"文件夹 > 文件/Canvas"**两层结构，侧边栏升级为文件树视图。

### 改造前后对比

```
【现在】                          【改造后】
Workspace A                       📁 文件夹A（原 Workspace A）
  ├── Canvas 1                      ├── 📄 调研笔记.txt
  │   ├── Module: 供需               ├── 📊 数据表.xlsx
  │   │   ├── 主文档 (text)          ├── 📕 报告.pdf
  │   │   ├── 数据表 (table)         ├── 📝 笔记.md
  │   │   └── 报告 (pdf)             ├── 🌐 网页.html
  │   └── Module: 成本曲线            └── 🎨 能源分析.canvas
  │       └── 主文档 (text)               (打开后是画布视图，
  └── Canvas 2                            Module名变成画布上的标题节点)
      └── ...                      📁 文件夹B（原 Workspace B）
                                     └── ...
```

## 二、核心改动点

### 1. 数据模型改造（types/index.ts）

**新增 FileItem 类型** — 独立于 Canvas 存在的文件：
```typescript
interface FileItem {
  id: string;
  folderId: string;        // 所属文件夹 ID
  type: 'text' | 'table' | 'pdf' | 'html' | 'markdown';
  title: string;
  content: string;         // HTML/markdown/url 等
  workbookData?: string;   // table 类型专用
  createdAt: string;
  updatedAt: string;
  order: number;
}
```

**Workspace 改名为 Folder**（或保留 Workspace 内部名，UI 上显示为"文件夹"）：
```typescript
interface Folder {
  id: string;
  name: string;
  icon: string;
  fileIds: string[];       // 文件和 Canvas 的 ID 列表
  canvasIds: string[];     // 保留，Canvas 也在文件夹下
  createdAt: string;
  updatedAt: string;
  order: number;
}
```

**Canvas 保持不变**，但：
- 删除 `modules[]` 字段
- Module 名称在迁移时变成画布上的「标题节点」（一个 text 类型节点，内容为 Module 名称）
- Module 下的附属文件（非 isMain 节点）提升到文件夹层级，变成独立 FileItem

### 2. 侧边栏改造（Sidebar.tsx）

**现在**：Workspace 列表 > 展开显示 Canvas 列表
**改为**：文件夹列表 > 展开显示文件树（Canvas + 独立文件混合排列）

```
📁 能源研究
  ├── 📄 算电协同调研笔记        ← 独立文件 (text)
  ├── 📊 行业数据汇总            ← 独立文件 (table)
  ├── 📕 潍柴调研报告.pdf        ← 独立文件 (pdf)
  ├── 📝 周报-2026-03-16.md     ← 独立文件 (markdown)
  └── 🎨 能源行业分析            ← Canvas（点击打开画布）
📁 工程机械
  ├── 📄 徐工分析
  └── 🎨 机械行业画布
```

**交互功能**：
- 文件夹：展开/折叠、重命名、删除、拖拽排序
- 文件：点击打开编辑器（主区域）、重命名、删除、拖拽排序
- Canvas：点击打开画布视图、重命名、删除
- 右键菜单：新建文件、新建 Canvas、导入文件
- 拖拽：文件可在文件夹之间拖动

### 3. 主区域改造（SplitWorkspace.tsx）

**现在**：ModuleColumn（左） + DetailPanel（右）
**改为**：根据选中项类型切换视图

- **选中 Canvas** → 显示画布视图（CanvasView，降级但保留）
- **选中独立文件** → 显示对应编辑器（全屏，不需要 DetailPanel 分栏）
  - text → NoteEditor（BlockNote）
  - table → SpreadsheetEditor（Univer）
  - pdf → PDF 查看器
  - markdown → NoteEditor（BlockNote，markdown→HTML）
  - html → HtmlViewer

### 4. Module 处理（迁移逻辑）

**删除 Module 系统**，迁移时：
1. 每个 Module 的 `name` → 在 Canvas 画布上创建一个**标题类型的 text 节点**
2. Module 的 `isMain` 主文档 → 与标题节点关联（连线或位置靠近）
3. Module 下的附属节点（非 isMain 的 table/pdf/md/html）→ **提升为文件夹下的独立文件**
4. 删除 `ModuleColumn.tsx`、`ModuleEditor.tsx`、`ModuleFileList.tsx`

### 5. Canvas 画布简化

- 删除 Module 相关逻辑（分组、折叠等）
- 保留核心功能：节点拖拽、连线、缩放
- Canvas 内的节点不再按 Module 分组，平铺显示
- CanvasToolbar 保留（在画布内新建/导入节点）

### 6. 新增：文件夹级别的文件操作

在侧边栏或文件夹头部增加操作按钮：
- **新建**：文本、表格、Canvas
- **导入**：Excel、PDF、Markdown、HTML
- 导入的文件直接成为该文件夹下的独立 FileItem

## 三、需要新增/修改的文件

### 新增
| 文件 | 说明 |
|------|------|
| `types/index.ts` | 新增 FileItem、Folder 类型 |
| `stores/fileStore.ts` | 独立文件的状态管理（CRUD） |
| `components/layout/FileTree.tsx` | 文件树组件（替代现有 Sidebar 内容） |
| `components/layout/FileEditor.tsx` | 独立文件编辑器路由（根据类型选择编辑器） |
| `db/apiClient.ts` | 新增 fileApi（独立文件的 CRUD API） |

### 修改
| 文件 | 改动 |
|------|------|
| `components/layout/Sidebar.tsx` | 用 FileTree 替换现有 workspace/canvas 列表 |
| `components/layout/SplitWorkspace.tsx` | 支持 Canvas 视图 / 独立文件编辑器切换 |
| `stores/workspaceStore.ts` | Workspace → Folder 概念转换，增加 fileIds 管理 |
| `stores/canvasStore.ts` | 删除 Module 相关逻辑 |
| `types/index.ts` | Canvas 删除 modules 字段 |

### 删除
| 文件 | 原因 |
|------|------|
| `components/layout/ModuleColumn.tsx` | Module 系统取消 |
| `components/layout/ModuleEditor.tsx` | Module 系统取消 |
| `components/layout/ModuleFileList.tsx` | 文件操作移到侧边栏 |

## 四、实施顺序（建议分 4 步）

### Phase 1：数据模型 + Store
1. 新增 FileItem 类型定义
2. Workspace → Folder 类型调整
3. 新建 fileStore.ts
4. 修改 workspaceStore.ts 支持 fileIds
5. 新增 fileApi 后端接口

### Phase 2：侧边栏文件树
1. 新建 FileTree.tsx 组件
2. 改造 Sidebar.tsx 使用文件树
3. 支持文件夹展开/折叠、文件点击选中
4. 支持新建文件/文件夹、导入文件
5. 支持拖拽排序和跨文件夹移动

### Phase 3：主区域视图切换
1. 改造 SplitWorkspace.tsx
2. 新建 FileEditor.tsx（独立文件编辑路由）
3. Canvas 选中 → 画布视图
4. 文件选中 → 对应类型编辑器（全屏）

### Phase 4：Module 迁移 + 清理
1. 编写迁移脚本（Module → 标题节点 + 独立文件）
2. Canvas 删除 Module 相关代码
3. 删除 ModuleColumn/ModuleEditor/ModuleFileList
4. CanvasView 清理 Module 分组逻辑

## 五、后端 API 变更

需要新增文件相关的 API 端点：
```
GET    /api/files?folderId=xxx     获取文件夹下的文件列表
GET    /api/files/:id              获取单个文件
POST   /api/files                  创建文件
PUT    /api/files/:id              更新文件
DELETE /api/files/:id              删除文件
```

Workspace API 改名或增加别名为 Folder API（向后兼容）。
