import { memo, type ReactNode } from 'react';

/**
 * Tiny uppercase section heading — used between list groups in sidebars.
 *
 *   <SectionLabel>目录 Index</SectionLabel>
 *   <SectionLabel trailing={<IconButton size={10}><Plus/></IconButton>}>类型</SectionLabel>
 */
interface SectionLabelProps {
  children: ReactNode;
  trailing?: ReactNode;
  className?: string;
}

export const SectionLabel = memo(function SectionLabel({
  children,
  trailing,
  className = '',
}: SectionLabelProps) {
  return (
    <div className={`flex items-center justify-between px-2 pt-1 pb-1 ${className}`}>
      <h3 className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">{children}</h3>
      {trailing}
    </div>
  );
});
