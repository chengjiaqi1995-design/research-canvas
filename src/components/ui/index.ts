/**
 * Barrel export for the app's unified design-system primitives.
 *
 * These are PascalCase on purpose — they sit alongside the lowercase
 * shadcn/ui primitives (button.tsx, input.tsx, dialog.tsx, …) which are
 * only used by the Portfolio views. Everything else in the app should
 * reach for these.
 *
 * Design rules in one breath:
 *   - blue = single accent, slate = neutrals
 *   - amber=warning, emerald=success, red=destructive (use sparingly)
 *   - 4 font sizes: text-[11px] / xs / sm / base
 *   - 38px page headers, px-2 py-1 list rows, rounded (4px) everywhere
 *   - active state: bg-blue-100 text-blue-800 font-medium
 */
export { PageHeader } from './PageHeader';
export { ListItem } from './ListItem';
export { IconButton } from './IconButton';
export { PrimaryButton } from './PrimaryButton';
export { SegmentedToggle } from './SegmentedToggle';
export { SectionLabel } from './SectionLabel';
export { TextInput } from './TextInput';
