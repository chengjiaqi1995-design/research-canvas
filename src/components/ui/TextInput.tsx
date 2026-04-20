import { forwardRef, type InputHTMLAttributes } from 'react';

/**
 * Compact single-line input — inline filters, search boxes, row-level editors.
 *
 * Sizing: text-xs, px-2 py-1, rounded (4px).
 * Resting: bg-slate-50 border-slate-200. Focus: white bg + blue-400 border.
 *
 * Named TextInput (not Input) to avoid case-collision with the shadcn
 * primitive `input.tsx` on macOS's case-insensitive filesystem.
 */
interface TextInputProps extends InputHTMLAttributes<HTMLInputElement> {
  invalid?: boolean;
}

export const TextInput = forwardRef<HTMLInputElement, TextInputProps>(function TextInput(
  { invalid = false, className = '', ...rest },
  ref,
) {
  const border = invalid
    ? 'border-red-300 focus:border-red-400'
    : 'border-slate-200 focus:border-blue-400';
  return (
    <input
      ref={ref}
      className={`px-2 py-1 text-xs bg-slate-50 focus:bg-white border ${border} rounded outline-none transition-colors placeholder:text-slate-400 disabled:opacity-50 disabled:cursor-not-allowed ${className}`}
      {...rest}
    />
  );
});
