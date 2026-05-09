import type { Transcription } from '../types';

export type NoteTypeFilter = 'earnings' | 'management' | 'sellside' | 'expert';
export type GenerationMethodFilter = 'merged_text' | 'audio_upload' | 'podcast' | 'manual_note' | 'ai_generated';

export const NOTE_TYPE_OPTIONS: Array<{ value: NoteTypeFilter; label: string }> = [
  { value: 'earnings', label: 'Earnings' },
  { value: 'management', label: 'Management' },
  { value: 'sellside', label: 'Sellside' },
  { value: 'expert', label: 'Expert' },
];

export const GENERATION_METHOD_OPTIONS: Array<{ value: GenerationMethodFilter; label: string }> = [
  { value: 'merged_text', label: '合并文本' },
  { value: 'audio_upload', label: '上传录音' },
  { value: 'podcast', label: 'Podcast' },
  { value: 'manual_note', label: '手动笔记' },
  { value: 'ai_generated', label: 'AI 生成' },
];

const NOTE_TYPE_LABELS: Record<NoteTypeFilter, string> = Object.fromEntries(
  NOTE_TYPE_OPTIONS.map((option) => [option.value, option.label])
) as Record<NoteTypeFilter, string>;

const GENERATION_METHOD_LABELS: Record<GenerationMethodFilter, string> = Object.fromEntries(
  GENERATION_METHOD_OPTIONS.map((option) => [option.value, option.label])
) as Record<GenerationMethodFilter, string>;

function normalizeText(value: unknown): string {
  return String(value ?? '').trim().toLowerCase();
}

function unique<T>(values: T[]): T[] {
  return Array.from(new Set(values));
}

function addNoteTypeFromToken(token: string, result: NoteTypeFilter[]) {
  const raw = token.trim();
  const normalized = raw.toLowerCase();
  const compact = normalized.replace(/[\s_\-./|,，、;；:：()[\]{}]+/g, '');

  if (!compact) return;

  if (
    compact === 'company' ||
    compact === 'companies' ||
    compact === 'earning' ||
    compact === 'earnings' ||
    compact === 'earningsreview' ||
    compact === '公司点评' ||
    compact === '业绩' ||
    compact === '业绩点评' ||
    compact === '财报'
  ) {
    result.push('earnings');
  }
  if (compact === 'management' || compact === 'mgmt' || compact === '管理层') {
    result.push('management');
  }
  if (compact === 'sellside' || compact === 'sellside研究' || compact === '卖方' || compact === '卖方研报') {
    result.push('sellside');
  }
  if (compact === 'expert' || compact === 'experts' || compact === '专家' || compact === '专家访谈') {
    result.push('expert');
  }

  // Some legacy rows have compact values like "managementsellside".
  if (compact.length > 8) {
    if (compact.includes('management') || compact.includes('管理层')) result.push('management');
    if (compact.includes('sellside') || compact.includes('卖方')) result.push('sellside');
    if (compact.includes('expert') || compact.includes('专家')) result.push('expert');
    if (compact.includes('company') || compact.includes('earnings') || compact.includes('公司点评') || compact.includes('业绩')) {
      result.push('earnings');
    }
  }
}

export function getNoteTypesFromValue(value?: string | null): NoteTypeFilter[] {
  const result: NoteTypeFilter[] = [];
  const raw = String(value ?? '').trim();
  if (!raw || raw === '未知') return result;

  addNoteTypeFromToken(raw, result);
  raw.split(/[\s_\-./|,，、;；:：()[\]{}]+/).forEach((token) => addNoteTypeFromToken(token, result));

  return unique(result);
}

export function getTranscriptionNoteTypes(transcription: Transcription): NoteTypeFilter[] {
  const result: NoteTypeFilter[] = [];
  result.push(...getNoteTypesFromValue(transcription.participants));

  for (const tag of transcription.tags || []) {
    result.push(...getNoteTypesFromValue(tag));
  }

  return unique(result).length ? unique(result) : ['management'];
}

export function formatNoteTypeDisplay(value?: string | null): string {
  const types = getNoteTypesFromValue(value);
  if (!types.length) return 'Management';
  return unique(types).map((type) => NOTE_TYPE_LABELS[type]).join('/');
}

export function normalizeNoteTypeForSave(value?: string | null): string {
  const types = getNoteTypesFromValue(value);
  return types[0] || '';
}

export function getGenerationMethod(transcription: Transcription): GenerationMethodFilter {
  const searchable = [
    transcription.type,
    transcription.fileName,
    transcription.filePath,
    ...(transcription.tags || []),
  ].map(normalizeText).join(' ');

  if (searchable.includes('podcast') || searchable.includes('podwise') || searchable.includes('播客')) {
    return 'podcast';
  }
  if (transcription.type === 'merge' || searchable.includes('skill-merge') || searchable.includes('合并')) {
    return 'merged_text';
  }
  if (transcription.type === 'weekly-summary' || transcription.type === 'daily-summary' || searchable.includes('ai-generated') || searchable.includes('ai生成')) {
    return 'ai_generated';
  }
  if (transcription.type === 'note') {
    return 'manual_note';
  }
  return 'audio_upload';
}

export function formatGenerationMethod(value: GenerationMethodFilter): string {
  return GENERATION_METHOD_LABELS[value] || value;
}
