import { parseAIMarkdown } from '../utils/markdownParser.ts';
import { stripHtml } from './feedItemModel.ts';

export type FeedNote = {
  id: string;
  canvasId: string;
  title: string;
  content: string;
  workspaceId: string;
  workspaceName: string;
  date: string | null;
  metadata?: Record<string, string>;
  sourceType?: string;
};

export interface ReferencePreviewState {
  itemTitle: string;
  refNumber: number;
  refText: string;
  loading: boolean;
  matches: FeedNote[];
  canOpenInCanvas: boolean;
  canOpenInAIProcess?: boolean;
  error?: string;
}

export function cleanReferenceText(text: string, refNumber?: number) {
  const refPattern = refNumber ? new RegExp(`\\[\\s*REF\\s*${refNumber}\\s*\\]`, 'i') : /\[\s*REF\s*\d+\s*\]/gi;
  return stripHtml(text)
    .replace(refPattern, '')
    .replace(/^[-–—\s:：|]+/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeForSearch(value: string) {
  return cleanReferenceText(value)
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]+/gi, '');
}

export function extractReferenceTextFromContent(content: string, refNumber: number) {
  if (!content) return `[REF${refNumber}]`;

  if (typeof DOMParser !== 'undefined' && /<[^>]+>/.test(content)) {
    try {
      const doc = new DOMParser().parseFromString(content, 'text/html');
      const refNode = doc.getElementById(`ref${refNumber}`);
      if (refNode?.textContent) return refNode.textContent.trim();
    } catch {
      // fall through to text matching
    }
  }

  const pattern = new RegExp(`\\[\\s*REF\\s*${refNumber}\\s*\\]\\s*([^\\n]+)`, 'i');
  const match = content.match(pattern);
  return match ? `[REF${refNumber}] ${match[1].trim()}` : `[REF${refNumber}]`;
}

export function findBestNoteMatches(notes: FeedNote[], refText: string, limit = 1) {
  const clean = cleanReferenceText(refText);
  const candidates = [clean, ...clean.split('|').map((part) => part.trim())]
    .map((part) => part.replace(/^[-–—\s:：]+/, '').trim())
    .filter((part) => part.length >= 4);
  const normalizedCandidates = Array.from(
    new Set(candidates.map(normalizeForSearch).filter((part) => part.length >= 4)),
  );

  return notes
    .map((note) => {
      const title = normalizeForSearch(note.title || '');
      const content = normalizeForSearch((note.content || '').slice(0, 3000));
      let score = 0;

      for (const candidate of normalizedCandidates) {
        if (!candidate) continue;
        if (title === candidate) score = Math.max(score, 100);
        else if (title.includes(candidate)) score = Math.max(score, 90);
        else if (candidate.includes(title) && title.length >= 6) score = Math.max(score, 75);
        else if (content.includes(candidate)) score = Math.max(score, 40);
      }

      return { note, score };
    })
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((entry) => entry.note);
}

export function renderReferenceContent(content: string) {
  const trimmed = content?.trim();
  if (!trimmed) return '<p class="text-slate-400">暂无内容</p>';
  return parseAIMarkdown(trimmed);
}
