import fs from 'fs';
import path from 'path';
import { TranscriptionRecord } from './types.js';

const DATA_DIR = path.resolve(process.cwd(), process.env.DATA_DIR || './data');
const AUDIO_DIR = path.join(DATA_DIR, 'audio');
const DB_FILE = path.join(DATA_DIR, 'transcriptions.json');

export function ensureDataDirs() {
  fs.mkdirSync(AUDIO_DIR, { recursive: true });
  if (!fs.existsSync(DB_FILE)) fs.writeFileSync(DB_FILE, '[]\n', 'utf8');
}

function readAll(): TranscriptionRecord[] {
  ensureDataDirs();
  try {
    return JSON.parse(fs.readFileSync(DB_FILE, 'utf8')) as TranscriptionRecord[];
  } catch {
    return [];
  }
}

function writeAll(records: TranscriptionRecord[]) {
  ensureDataDirs();
  fs.writeFileSync(DB_FILE, JSON.stringify(records, null, 2), 'utf8');
}

export function listTranscriptions() {
  return readAll().sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function getTranscription(id: string) {
  return readAll().find((record) => record.id === id) || null;
}

export function createTranscription(input: Pick<TranscriptionRecord, 'fileName' | 'aiProvider'>) {
  const now = new Date().toISOString();
  const record: TranscriptionRecord = {
    id: crypto.randomUUID(),
    fileName: input.fileName,
    filePath: '',
    fileSize: 0,
    duration: 0,
    aiProvider: input.aiProvider,
    status: 'processing',
    transcriptText: '',
    createdAt: now,
    updatedAt: now,
  };
  const records = readAll();
  records.unshift(record);
  writeAll(records);
  return record;
}

export function updateTranscription(id: string, patch: Partial<TranscriptionRecord>) {
  const records = readAll();
  const index = records.findIndex((record) => record.id === id);
  if (index < 0) return null;
  records[index] = {
    ...records[index],
    ...patch,
    updatedAt: new Date().toISOString(),
  };
  writeAll(records);
  return records[index];
}

export function getAudioDir() {
  ensureDataDirs();
  return AUDIO_DIR;
}

export function resolveAudioPath(filePath: string) {
  const safeName = path.basename(filePath);
  return path.join(AUDIO_DIR, safeName);
}

