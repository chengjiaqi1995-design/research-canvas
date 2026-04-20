import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';

/**
 * Square ghost icon button — sidebars, toolbars, inline actions.
 *
 * Variant controls the hover accent. `subtle` is default (slate hover).
 * Use colored variants only for semantic actions (destructive=red,
 * success=emerald, warning=amber, accent=blue).
 */
type Variant = 'subtle' | 'blue' | 'red' | 'emerald' | 'amber';

const VARIANTS: Record<Variant, string> = {
  subtle: 'text-slate-400 hover:bg-slate-200 hover:text-slate-600',
  blue: 'text-slate-400 hover:bg-blue-50 hover:text-blue-500',
  red: 'text-slate-400 hover:bg-red-50 hover:text-red-500',
  emerald: 'text-slate-400 hover:bg-emerald-50 hover:text-emerald-500',
  amber: 'text-slate-400 hover:bg-amber-50 hover:text-amber-500',
};

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  children: ReactNode;
  variant?: Variant;
  active?: boolean;
}

const ACTIVE_COLORS: Record<Variant, string> = {
  subtle: 'text-slate-700 bg-slate-200',
  blue: 'text-blue-600 bg-blue-50',
  red: 'text-red-500 bg-red-50',
  emerald: 'text-emerald-500 bg-emerald-50',
  amber: 'text-amber-500 bg-amber-50',
};

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { children, variant = 'subtle', active = false, className = '', ...rest },
  ref,
) {
  const colors = active ? ACTIVE_COLORS[variant] : VARIANTS[variant];
  return (
    <button
      ref={ref}
      className={`p-1 rounded transition-colors ${colors} disabled:opacity-40 disabled:cursor-not-allowed ${className}`}
      {...rest}
    >
      {children}
    </button>
  );
});
