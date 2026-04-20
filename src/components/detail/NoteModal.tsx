import { memo } from 'react';
import { X } from 'lucide-react';
import { parseAIMarkdown } from '../../utils/markdownParser.ts';
import { IconButton } from '../ui/index.ts';

interface NoteModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  content: string;
}

export const NoteModal = memo(function NoteModal({ open, onClose, title, content }: NoteModalProps) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40" onClick={onClose}>
      <div
        className="bg-white rounded-lg shadow-xl w-full max-w-[1000px] mx-4 max-h-[90vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 border-b border-slate-200 bg-slate-50 shrink-0" style={{ minHeight: 38 }}>
          <h2 className="text-xs font-semibold text-slate-700 truncate">{title}</h2>
          <IconButton onClick={onClose} title="关闭">
            <X size={13} />
          </IconButton>
        </div>

        {/* Content */}
        <div
          className="flex-1 overflow-y-auto px-8 py-6 prose prose-sm max-w-none text-slate-700 leading-relaxed [&>*:first-child]:mt-0 [&>*:last-child]:mb-0 prose-p:my-2 prose-headings:font-bold"
          dangerouslySetInnerHTML={{ __html: parseAIMarkdown(content) }}
        />
      </div>
    </div>
  );
});
