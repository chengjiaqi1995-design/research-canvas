/**
 * AI 卡片调试日志
 *
 * 所有关键事件写入 IndexedDB，跨刷新/重启保留。
 * 出现卡片丢失时可以导出日志对照时间线找原因。
 *
 * 使用：logCardEvent('type', { ... }) 随时记录
 * 查看：await getCardLogs() 读全部
 * 清空：await clearCardLogs()
 * 导出：await exportCardLogs() 返回 JSON 字符串
 */

import { get as idbGet, set as idbSet, del as idbDel } from 'idb-keyval';

const LOG_KEY = 'rc-ai-card-logs';
const MAX_LOGS = 2000;

export type CardEventType =
  | 'card_create'
  | 'card_update'
  | 'card_remove'
  | 'card_remove_all'
  | 'generate_start'
  | 'generate_chunk'        // 流式进度采样（每秒最多一次）
  | 'generate_end'
  | 'generate_abort'
  | 'generate_error'
  | 'push_start'
  | 'push_success'
  | 'push_failure'
  | 'push_skipped_unchanged'
  | 'sync_start'
  | 'sync_cloud_empty_pushed_local'
  | 'sync_merge_result'
  | 'sync_error'
  | 'hydrate_from_idb'
  | 'card_vanish_detected'  // 检测到卡片从 state 中消失
  | 'card_ressurected'      // 本地消失但又被恢复（从云端或 IDB）
  | 'manual_note';          // 用户在 UI 里手动打的标记

export interface CardLogEntry {
  t: number;                // timestamp
  type: CardEventType;
  cardId?: string;
  cardTitle?: string;
  summary?: string;         // 人类可读的一句话摘要
  detail?: Record<string, any>;
}

let _inMemoryBuffer: CardLogEntry[] = [];
let _loaded = false;
let _flushTimer: ReturnType<typeof setTimeout> | null = null;
let _lastChunkLogByCard = new Map<string, number>(); // cardId → ts，节流 chunk 日志

async function _loadFromIdb(): Promise<CardLogEntry[]> {
  try {
    const raw = await idbGet(LOG_KEY);
    if (Array.isArray(raw)) return raw;
    return [];
  } catch {
    return [];
  }
}

async function _saveToIdb() {
  try {
    await idbSet(LOG_KEY, _inMemoryBuffer);
  } catch (e) {
    console.warn('[aiCardLogger] failed to save logs to IDB', e);
  }
}

function _scheduleFlush() {
  if (_flushTimer) return;
  _flushTimer = setTimeout(async () => {
    _flushTimer = null;
    await _saveToIdb();
  }, 1000);
}

async function _ensureLoaded() {
  if (_loaded) return;
  _inMemoryBuffer = await _loadFromIdb();
  _loaded = true;
}

export function logCardEvent(
  type: CardEventType,
  payload?: { cardId?: string; cardTitle?: string; summary?: string; detail?: Record<string, any> }
) {
  // 对于 chunk 事件做节流：每张卡片每秒最多一条
  if (type === 'generate_chunk' && payload?.cardId) {
    const now = Date.now();
    const last = _lastChunkLogByCard.get(payload.cardId) || 0;
    if (now - last < 1000) return;
    _lastChunkLogByCard.set(payload.cardId, now);
  }

  const entry: CardLogEntry = {
    t: Date.now(),
    type,
    cardId: payload?.cardId,
    cardTitle: payload?.cardTitle,
    summary: payload?.summary,
    detail: payload?.detail,
  };

  // 无锁入队：先在内存追加，异步落盘
  if (!_loaded) {
    // 还没加载完，先在内存缓冲，稍后合并
    _inMemoryBuffer.push(entry);
    _ensureLoaded().then(() => {
      // 合并：读到的 IDB 数据 + 中间写入的新数据（当前 buffer 已包含）
      // 不用再做合并，buffer 本身已经是最新
      if (_inMemoryBuffer.length > MAX_LOGS) {
        _inMemoryBuffer = _inMemoryBuffer.slice(-MAX_LOGS);
      }
      _scheduleFlush();
    });
    return;
  }

  _inMemoryBuffer.push(entry);
  if (_inMemoryBuffer.length > MAX_LOGS) {
    _inMemoryBuffer = _inMemoryBuffer.slice(-MAX_LOGS);
  }
  _scheduleFlush();
}

export async function getCardLogs(): Promise<CardLogEntry[]> {
  await _ensureLoaded();
  return [..._inMemoryBuffer];
}

export async function clearCardLogs() {
  _inMemoryBuffer = [];
  _lastChunkLogByCard.clear();
  try {
    await idbDel(LOG_KEY);
  } catch { /* ignore */ }
}

export async function exportCardLogs(): Promise<string> {
  const logs = await getCardLogs();
  return JSON.stringify(
    {
      exportedAt: new Date().toISOString(),
      count: logs.length,
      logs,
    },
    null,
    2
  );
}

/** 用来对比前后 state，检测"消失的卡片" */
export function detectVanishedCards(
  before: Array<{ id: string; title?: string }>,
  after: Array<{ id: string; title?: string }>,
  context: string
) {
  if (before.length === 0) return;
  const afterIds = new Set(after.map(c => c.id));
  const vanished = before.filter(c => !afterIds.has(c.id));
  if (vanished.length > 0) {
    vanished.forEach(v => {
      logCardEvent('card_vanish_detected', {
        cardId: v.id,
        cardTitle: v.title,
        summary: `卡片从 state 中消失（上下文：${context}）`,
        detail: { context, beforeCount: before.length, afterCount: after.length },
      });
    });
    // 也丢到 console 方便实时调试
    console.warn(`⚠️ [aiCardLogger] ${vanished.length} card(s) vanished during "${context}"`, vanished);
  }
}

// 暴露到全局方便控制台调试
if (typeof window !== 'undefined') {
  (window as any).__aiCardLogger = {
    get: getCardLogs,
    clear: clearCardLogs,
    export: exportCardLogs,
    log: logCardEvent,
  };
}
