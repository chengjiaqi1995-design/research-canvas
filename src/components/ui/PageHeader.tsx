import { memo, type ReactNode } from 'react';

/**
 * Unified page / panel header bar.
 *
 * Height: 38px. White background, slate-200 bottom border, px-3 padding.
 *
 * Compose freely: pass title text, or pass arbitrary React (dropdowns,
 * tabs) as children. `right` is the trailing slot for actions.
 *
 * Examples:
 *   <PageHeader title="信息流" subtitle="128 条 · 12 未读" right={<Button/>} />
 *   <PageHeader>
 *     <select>...</select>
 *   </PageHeader>
 */
interface PageHeaderProps {
  title?: string;
  subtitle?: ReactNode;
  right?: ReactNode;
  children?: ReactNode;
  className?: string;
}

export const PageHeader = memo(function PageHeader({
  title,
  subtitle,
  right,
  children,
  className = '',
}: PageHeaderProps) {
  return (
    <div
      className={`flex items-center justify-between px-3 border-b border-slate-200 shrink-0 bg-white ${className}`}
      style={{ minHeight: 38 }}
    >
      <div className="flex items-center gap-2 min-w-0">
        {title && <h1 className="text-xs font-semibold text-slate-700 truncate">{title}</h1>}
        {subtitle && <span className="text-[11px] text-slate-400 truncate">{subtitle}</span>}
        {children}
      </div>
      {right && <div className="flex items-center gap-0.5 shrink-0">{right}</div>}
    </div>
  );
});
