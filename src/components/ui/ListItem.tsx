import { memo, type ReactNode, type MouseEvent } from 'react';

/**
 * Compact list row — the workhorse of every sidebar.
 *
 * Sizing: text-xs, px-2 py-1, rounded. Active = bg-blue-100 text-blue-800,
 * hover = bg-slate-100.
 *
 * `icon` renders before the label (color-shifted to blue when active).
 * `trailing` is a right-side slot (timestamp, count, delete button).
 * Delete/hover actions should set className="opacity-0 group-hover:opacity-100"
 * and use stopPropagation on their own click handlers.
 */
interface ListItemProps {
  active?: boolean;
  onClick?: (e: MouseEvent) => void;
  icon?: ReactNode;
  label: ReactNode;
  trailing?: ReactNode;
  className?: string;
  title?: string;
}

export const ListItem = memo(function ListItem({
  active = false,
  onClick,
  icon,
  label,
  trailing,
  className = '',
  title,
}: ListItemProps) {
  return (
    <div
      onClick={onClick}
      title={title}
      className={`flex items-center gap-1.5 px-2 py-1 rounded cursor-pointer group text-xs transition-colors ${
        active ? 'bg-blue-100 text-blue-800 font-medium' : 'text-slate-500 hover:bg-slate-100'
      } ${className}`}
    >
      {icon && <span className={`shrink-0 ${active ? 'text-blue-500' : 'text-slate-400'}`}>{icon}</span>}
      <span className="flex-1 min-w-0 truncate">{label}</span>
      {trailing}
    </div>
  );
});
