import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';

/**
 * The app's one opinionated text button.
 *
 * Size: text-xs, px-3 py-1, rounded (4px).
 * Variants:
 *   primary   = bg-blue-500 → hover bg-blue-600, white text (CTA)
 *   secondary = white bg, slate border, slate-600 text (cancel / neutral)
 *   destructive = bg-red-50 text-red-600 border, hover fills red
 *
 * For ghost icon-only buttons use <IconButton/> instead.
 */
type Variant = 'primary' | 'secondary' | 'destructive';

const VARIANTS: Record<Variant, string> = {
  primary: 'bg-blue-500 hover:bg-blue-600 text-white font-medium',
  secondary: 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50 font-medium',
  destructive:
    'bg-red-50 text-red-600 border border-red-200 hover:bg-red-500 hover:text-white font-medium',
};

interface PrimaryButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  children: ReactNode;
  variant?: Variant;
  size?: 'sm' | 'md';
  icon?: ReactNode;
}

export const PrimaryButton = forwardRef<HTMLButtonElement, PrimaryButtonProps>(
  function PrimaryButton({ children, variant = 'primary', size = 'md', icon, className = '', ...rest }, ref) {
    const sizing = size === 'sm' ? 'px-2 py-0.5 text-xs' : 'px-3 py-1 text-xs';
    return (
      <button
        ref={ref}
        className={`inline-flex items-center justify-center gap-1 rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${sizing} ${VARIANTS[variant]} ${className}`}
        {...rest}
      >
        {icon}
        {children}
      </button>
    );
  },
);
