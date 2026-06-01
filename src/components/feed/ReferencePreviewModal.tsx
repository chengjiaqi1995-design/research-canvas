import { useRef } from 'react';
import { ExternalLink, Loader2, X } from 'lucide-react';
import { useMermaidRender } from '../../hooks/useMermaidRender.ts';
import type { FeedNote, ReferencePreviewState } from '../../feed/feedReference.ts';
import { cleanReferenceText, renderReferenceContent } from '../../feed/feedReference.ts';

export function ReferencePreviewModal({
  preview,
  onClose,
  onOpenNote,
}: {
  preview: ReferencePreviewState | null;
  onClose: () => void;
  onOpenNote: (note: FeedNote) => void;
}) {
  const matchesRef = useRef<HTMLDivElement>(null);
  const matchesSignature = preview?.matches.map((note) => `${note.id}:${note.content.length}`).join('|') || '';
  useMermaidRender(matchesRef, [matchesSignature]);

  if (!preview) return null;

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-950/40 px-5 py-5">
      <div className="flex h-[90vh] w-full max-w-[1240px] flex-col overflow-hidden rounded-lg bg-white shadow-2xl">
        <div className="flex shrink-0 items-start justify-between gap-3 border-b border-slate-200 px-5 py-3.5">
          <div className="min-w-0">
            <div className="text-[11px] font-medium text-violet-600">REF{preview.refNumber}</div>
            <h3 className="truncate text-base font-semibold text-slate-950">{preview.itemTitle}</h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
            title="关闭"
          >
            <X size={16} />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          <div className="rounded border border-violet-100 bg-violet-50 px-3 py-2 text-sm leading-6 text-slate-800">
            {cleanReferenceText(preview.refText, preview.refNumber) || `[REF${preview.refNumber}]`}
          </div>

          {preview.loading ? (
            <div className="flex items-center gap-2 py-6 text-sm text-slate-500">
              <Loader2 size={16} className="animate-spin" />
              正在查找对应笔记...
            </div>
          ) : preview.error ? (
            <div className="py-4 text-sm text-red-600">{preview.error}</div>
          ) : preview.matches.length ? (
            <div ref={matchesRef} className="mt-4 space-y-4">
              {preview.matches.map((note) => (
                <div key={`${note.sourceType || 'note'}:${note.canvasId}:${note.id}`} className="rounded border border-slate-200 bg-white">
                  <div className="flex flex-wrap items-start justify-between gap-2 border-b border-slate-100 px-4 py-3">
                    <div className="min-w-0">
                      <div className="font-medium text-slate-950">{note.title}</div>
                      <div className="mt-1 flex flex-wrap items-center gap-2">
                        {note.workspaceName && <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-500">{note.workspaceName}</span>}
                        {note.metadata?.industry && <span className="rounded bg-blue-50 px-1.5 py-0.5 text-[11px] text-blue-700">{note.metadata.industry}</span>}
                        {note.metadata?.organization && <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-600">{note.metadata.organization}</span>}
                        {note.sourceType === 'aiprocess-transcription' && <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-[11px] text-emerald-700">AI Process 来源</span>}
                        {note.date && <span className="text-[11px] text-slate-400">{note.date}</span>}
                      </div>
                    </div>
                    {preview.canOpenInCanvas ? (
                      <button
                        type="button"
                        onClick={() => onOpenNote(note)}
                        className="inline-flex shrink-0 items-center gap-1 rounded border border-slate-200 px-2 py-1 text-xs text-slate-600 hover:bg-slate-50 hover:text-slate-900"
                      >
                        <ExternalLink size={12} />
                        打开笔记
                      </button>
                    ) : (
                      <span className="shrink-0 rounded border border-slate-200 px-2 py-1 text-xs text-slate-400">
                        来源预览
                      </span>
                    )}
                  </div>
                  <div
                    className="prose prose-sm max-w-none overflow-visible px-5 py-4 leading-relaxed text-slate-800 prose-headings:text-slate-950 prose-headings:font-bold prose-p:my-2 prose-ul:my-2 prose-ol:my-2 prose-li:my-1 prose-strong:text-slate-950 prose-hr:my-5"
                    dangerouslySetInnerHTML={{ __html: renderReferenceContent(note.content || '') }}
                  />
                </div>
              ))}
            </div>
          ) : (
            <div className="py-4 text-sm text-slate-500">
              未自动匹配到完整笔记。当前报告只提供了 REF 文本，缺少稳定的 note id。
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
