import { memo, type ReactNode } from 'react';

/**
 * Segmented tab control (e.g. 数据矩阵 / 行业百科, 周/月/季/年).
 *
 * Container: bg-slate-100 p-0.5 rounded. Active tab = bg-white text-blue-700
 * shadow-sm, inactive = text-slate-500 hover:text-slate-700.
 *
 * Generic over the option value so callers get type-safe onChange.
 */
interface Option<V> {
  value: V;
  label: ReactNode;
  icon?: ReactNode;
}

interface SegmentedToggleProps<V extends string> {
  value: V;
  options: Option<V>[];
  onChange: (v: V) => void;
  className?: string;
}

function SegmentedToggleInner<V extends string>({
  value,
  options,
  onChange,
  className = '',
}: SegmentedToggleProps<V>) {
  return (
    <div className={`flex items-center bg-slate-100 p-0.5 rounded ${className}`}>
      {options.map((opt) => {
        const active = value === opt.value;
        return (
          <button
            key={opt.value}
            onClick={() => onChange(opt.value)}
            className={`flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded transition-colors ${
              active
                ? 'bg-white text-blue-700 shadow-sm'
                : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            {opt.icon}
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

// `memo` doesn't preserve the generic, so expose a typed cast.
export const SegmentedToggle = memo(SegmentedToggleInner) as <V extends string>(
  props: SegmentedToggleProps<V>,
) => JSX.Element;
