import { create } from 'zustand';

/**
 * 移动端侧栏开关的跨组件通道。
 *
 * MainLayout 的 Header 始终渲染在顶部。其他 view（如 AI 卡片、Portfolio、Tracker 等）
 * 的侧栏由 ResponsiveLayout 管理，不属于 MainLayout。为了让 Header 左上角的 Menu
 * 按钮也能打开这些 view 自己的侧栏抽屉，ResponsiveLayout 把它的 setDrawerOpen
 * 注册到这里；Header 作为兜底读取。
 */
interface MobileSidebarState {
  opener: (() => void) | null;
  setOpener: (fn: (() => void) | null) => void;
}

export const useMobileSidebarStore = create<MobileSidebarState>((set) => ({
  opener: null,
  setOpener: (fn) => set({ opener: fn }),
}));
