import crypto from 'crypto';
import prisma from '../utils/db';
import { postProcessQueue } from './transcriptionQueue';
import { performPostProcessing } from '../controllers/transcription/helpers';
import {
  getEarningCallTranscript,
  getEarningsCalendar,
  getStockNews,
  getTranscriptDates,
  hasFmpApiKey,
  type FmpStockNewsItem,
  type FmpTranscriptDateItem,
  type FmpTranscriptItem,
} from './fmpService';
import { bbgToFmpSymbolCandidates } from './fmpSymbolMapper';

type PortfolioSymbol = {
  positionId: number;
  symbol: string;
  tickerBbg: string;
  name: string;
  longShort: string;
  positionWeight: number;
  sectorName: string;
};

export type FmpIngestMode = 'news' | 'transcripts' | 'all';

export type FmpIngestResult = {
  mode: FmpIngestMode;
  userId: string;
  symbols: number;
  news: { fetched: number; created: number; skipped: number };
  transcripts: { checked: number; created: number; skipped: number };
  warnings: string[];
};

function isoDateDaysFromNow(days: number): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function hashKey(input: string): string {
  return crypto.createHash('sha256').update(input).digest('hex').slice(0, 24);
}

function normalizeTags(tags: string[]): string {
  return JSON.stringify(Array.from(new Set(tags.map((tag) => tag.trim()).filter(Boolean))).slice(0, 12));
}

function safeDate(value?: string): Date {
  if (!value) return new Date();
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? new Date() : date;
}

function fmpSourceUrl(symbol: string, year?: number, quarter?: number): string {
  return `fmp://earning-call-transcript/${symbol}/${year || 'unknown'}/Q${quarter || 'unknown'}`;
}

function getProviderKeysFromEnv(): Record<string, string> {
  return {
    google: process.env.GEMINI_API_KEY || '',
    dashscope: process.env.QWEN_API_KEY || '',
    openai: process.env.OPENAI_API_KEY || '',
    deepseek: process.env.DEEPSEEK_API_KEY || '',
  };
}

function hasSummaryKey(keys: Record<string, string>): boolean {
  return Boolean(keys.google || keys.dashscope || keys.openai || keys.deepseek);
}

function preferredSummaryModel(keys: Record<string, string>): string {
  if (keys.google) return 'gemini';
  if (keys.dashscope) return 'qwen';
  if (keys.openai) return 'openai';
  if (keys.deepseek) return 'deepseek';
  return 'gemini';
}

async function loadPortfolioSymbols(userId: string): Promise<PortfolioSymbol[]> {
  const positions = await prisma.portfolioPosition.findMany({
    where: { userId },
    select: {
      id: true,
      tickerBbg: true,
      nameEn: true,
      nameCn: true,
      market: true,
      longShort: true,
      positionWeight: true,
      sectorName: true,
    },
    orderBy: { positionAmount: 'desc' },
  });

  const seen = new Set<string>();
  const symbols: PortfolioSymbol[] = [];
  for (const position of positions) {
    const candidate = bbgToFmpSymbolCandidates(position.tickerBbg, position.market)[0];
    if (!candidate || seen.has(candidate)) continue;
    seen.add(candidate);
    symbols.push({
      positionId: position.id,
      symbol: candidate,
      tickerBbg: position.tickerBbg,
      name: position.nameEn || position.nameCn || position.tickerBbg,
      longShort: position.longShort,
      positionWeight: position.positionWeight,
      sectorName: position.sectorName,
    });
  }
  return symbols;
}

async function createFeedIfMissing(data: {
  userId: string;
  type: string;
  category: string;
  title: string;
  content: string;
  source: string;
  tags: string[];
  reportKey: string;
  reportType: string;
  reportTypeLabel: string;
  publishedAt?: string;
  referenceData?: unknown[];
}) {
  const existing = await prisma.feedItem.findFirst({
    where: { userId: data.userId, reportKey: data.reportKey },
    select: { id: true },
  });
  if (existing) return { created: false, id: existing.id };

  const item = await prisma.feedItem.create({
    data: {
      userId: data.userId,
      type: data.type,
      category: data.category,
      title: data.title,
      content: data.content,
      contentFormat: 'markdown',
      source: data.source,
      tags: normalizeTags(data.tags),
      reportKey: data.reportKey,
      reportVersion: new Date().toISOString(),
      reportType: data.reportType,
      reportTypeLabel: data.reportTypeLabel,
      referenceData: data.referenceData?.length ? JSON.stringify(data.referenceData) : '',
      publishedAt: safeDate(data.publishedAt),
      pushedAt: new Date(),
    },
  });
  return { created: true, id: item.id };
}

function buildNewsContent(news: FmpStockNewsItem, position?: PortfolioSymbol): string {
  const lines = [
    `**公司**：${position?.name || news.symbol || '-'}`,
    `**Ticker**：${position?.tickerBbg || news.symbol || '-'}`,
    position ? `**仓位**：${position.longShort || '/'} · ${(position.positionWeight || 0).toFixed(1)}%` : '',
    `**来源**：${news.site || 'FMP'}`,
    `**时间**：${news.publishedAt || '-'}`,
    news.url ? `**链接**：${news.url}` : '',
    '',
    news.text || 'FMP 未返回正文摘要。',
  ];
  return lines.filter(Boolean).join('\n');
}

async function ingestNews(userId: string, positions: PortfolioSymbol[], warnings: string[]) {
  let fetched = 0;
  let created = 0;
  let skipped = 0;
  const bySymbol = new Map(positions.map((position) => [position.symbol.toUpperCase(), position]));
  const chunks: PortfolioSymbol[][] = [];
  for (let i = 0; i < positions.length; i += 50) chunks.push(positions.slice(i, i + 50));

  for (const chunk of chunks) {
    try {
      const items = await getStockNews(chunk.map((position) => position.symbol), {
        from: isoDateDaysFromNow(-2),
        to: isoDateDaysFromNow(1),
        limit: 100,
      });
      fetched += items.length;
      for (const news of items) {
        const position = bySymbol.get(news.symbol.toUpperCase());
        const key = `fmp-news:${hashKey([news.symbol, news.publishedAt, news.url, news.title].join('|'))}`;
        const result = await createFeedIfMissing({
          userId,
          type: 'news',
          category: 'Portfolio News',
          title: `${news.symbol ? `${news.symbol}: ` : ''}${news.title}`,
          content: buildNewsContent(news, position),
          source: news.site || 'FMP',
          tags: ['FMP', 'portfolio-news', news.symbol, position?.sectorName || ''].filter(Boolean),
          reportKey: key,
          reportType: 'portfolio_fmp_news',
          reportTypeLabel: '组合公司新闻',
          publishedAt: news.publishedAt,
        });
        if (result.created) created += 1;
        else skipped += 1;
      }
    } catch (error) {
      warnings.push(`FMP news chunk failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  return { fetched, created, skipped };
}

function transcriptTitle(position: PortfolioSymbol, transcript: FmpTranscriptItem) {
  const period = transcript.year && transcript.quarter ? `${transcript.year} Q${transcript.quarter}` : (transcript.date || 'Earnings Call');
  return `${position.name} ${period} Earnings Call Transcript`;
}

function buildTranscriptFeedContent(position: PortfolioSymbol, transcriptionId: string, transcript: FmpTranscriptItem) {
  return [
    `**公司**：${position.name}`,
    `**Ticker**：${position.tickerBbg} / ${position.symbol}`,
    `**业绩会**：${transcript.year || '-'} Q${transcript.quarter || '-'} · ${transcript.date || '-'}`,
    `**仓位**：${position.longShort || '/'} · ${(position.positionWeight || 0).toFixed(1)}%`,
    '',
    `已从 FMP 获取 earnings call transcript，并创建 AI Process note：${transcriptionId}。`,
    '系统会在后台生成总结和元数据；如果 summary 暂时为空，稍后刷新 AI Process 即可看到结果。',
  ].join('\n');
}

async function createTranscriptNote(userId: string, position: PortfolioSymbol, transcript: FmpTranscriptItem) {
  const sourceUrl = fmpSourceUrl(position.symbol, transcript.year, transcript.quarter);
  const existing = await prisma.transcription.findFirst({
    where: { userId, filePath: sourceUrl },
    select: { id: true },
  });
  if (existing) return { created: false, id: existing.id };

  const providerKeys = getProviderKeysFromEnv();
  const shouldSummarize = hasSummaryKey(providerKeys);
  const title = transcriptTitle(position, transcript);
  const actualDate = transcript.date ? safeDate(transcript.date) : null;
  const transcription = await prisma.transcription.create({
    data: {
      fileName: title.slice(0, 180),
      filePath: sourceUrl,
      fileSize: Buffer.byteLength(transcript.content, 'utf8'),
      aiProvider: 'text',
      status: shouldSummarize ? 'processing' : 'completed',
      processingStep: shouldSummarize ? 'summarizing' : null,
      transcriptText: transcript.content,
      type: 'note',
      tags: normalizeTags(['FMP', 'earnings-call', position.symbol]),
      organization: position.name,
      participants: 'earnings',
      eventDate: transcript.date || '',
      actualDate,
      userId,
    } as any,
  });

  if (shouldSummarize) {
    const transcriptTextJson = JSON.stringify({ text: transcript.content, segments: [] });
    const customPrompt = [
      '请把这份 earnings call transcript 总结成适合买方投资研究的信息卡。',
      '必须包含：业绩/指引变化、需求变化、毛利率/成本、资本开支、管理层语气、对组合仓位的可能影响。',
      '用中文输出，保留关键英文专有名词。不要编造 transcript 里没有的信息。',
    ].join('\n');
    const metadataFillPrompt = [
      '请输出 JSON 元数据字段：',
      '{"topic":"业绩会主题","organization":"公司名","industry":"行业","country":"国家","participants":"earnings","eventDate":"业绩会日期","speaker":"管理层/公司"}',
    ].join('\n');
    postProcessQueue.enqueue(
      () => performPostProcessing(
        transcription.id,
        transcript.content,
        transcriptTextJson,
        providerKeys.google,
        customPrompt,
        preferredSummaryModel(providerKeys),
        undefined,
        metadataFillPrompt,
        providerKeys,
      ),
      `FMP earnings transcript 后处理: ${transcription.id}`,
      async () => {
        await prisma.transcription.updateMany({
          where: { id: transcription.id, status: 'processing' },
          data: { status: 'failed', errorMessage: 'FMP transcript 后处理超时（10分钟）', processingStep: null },
        }).catch(() => {});
      },
    );
  }

  return { created: true, id: transcription.id };
}

function isRecentTranscript(item: FmpTranscriptDateItem): boolean {
  const date = safeDate(item.date);
  const min = safeDate(isoDateDaysFromNow(-7));
  const max = safeDate(isoDateDaysFromNow(1));
  return date >= min && date <= max;
}

async function ingestTranscripts(userId: string, positions: PortfolioSymbol[], warnings: string[]) {
  let checked = 0;
  let created = 0;
  let skipped = 0;
  const bySymbol = new Map(positions.map((position) => [position.symbol.toUpperCase(), position]));
  let nearSymbols = new Set<string>();

  try {
    const calendar = await getEarningsCalendar(isoDateDaysFromNow(-3), isoDateDaysFromNow(1));
    for (const item of calendar) {
      const symbol = item.symbol.toUpperCase();
      if (bySymbol.has(symbol)) nearSymbols.add(symbol);
    }
  } catch (error) {
    warnings.push(`FMP earnings calendar failed: ${error instanceof Error ? error.message : String(error)}`);
  }

  if (nearSymbols.size === 0) {
    nearSymbols = new Set(positions.slice(0, 30).map((position) => position.symbol.toUpperCase()));
    warnings.push('FMP earnings calendar did not identify near-term portfolio calls; checked top 30 portfolio symbols for recent transcripts.');
  }

  for (const symbol of nearSymbols) {
    const position = bySymbol.get(symbol);
    if (!position) continue;
    checked += 1;
    try {
      const dates = (await getTranscriptDates(symbol)).filter(isRecentTranscript);
      const latest = dates[0];
      if (!latest?.quarter || !latest.year) {
        skipped += 1;
        continue;
      }
      const transcript = await getEarningCallTranscript(symbol, latest.quarter, latest.year);
      if (!transcript?.content) {
        skipped += 1;
        continue;
      }
      const note = await createTranscriptNote(userId, position, {
        ...transcript,
        date: transcript.date || latest.date,
        quarter: transcript.quarter || latest.quarter,
        year: transcript.year || latest.year,
      });
      if (note.created) {
        created += 1;
        await createFeedIfMissing({
          userId,
          type: 'podcast',
          category: 'Earnings Call Transcript',
          title: transcriptTitle(position, transcript),
          content: buildTranscriptFeedContent(position, note.id, transcript),
          source: 'FMP',
          tags: ['FMP', 'earnings-call', position.symbol, position.sectorName].filter(Boolean),
          reportKey: `fmp-transcript:${position.symbol}:${latest.year}:Q${latest.quarter}`,
          reportType: 'fmp_earnings_transcript',
          reportTypeLabel: '业绩会 Transcript',
          publishedAt: transcript.date || latest.date,
          referenceData: [{
            refNumber: 1,
            ref: 'REF1',
            id: note.id,
            title: transcriptTitle(position, transcript),
            organization: position.name,
            date: transcript.date || latest.date,
            sourceType: 'transcription',
          }],
        });
      } else {
        skipped += 1;
      }
    } catch (error) {
      skipped += 1;
      warnings.push(`FMP transcript failed for ${symbol}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  return { checked, created, skipped };
}

export async function runFmpPortfolioIngest(userId: string, mode: FmpIngestMode = 'all'): Promise<FmpIngestResult> {
  if (!hasFmpApiKey()) {
    const err = new Error('FMP_API_KEY is not configured');
    (err as any).status = 500;
    throw err;
  }

  const positions = await loadPortfolioSymbols(userId);
  const warnings: string[] = [];
  const result: FmpIngestResult = {
    mode,
    userId,
    symbols: positions.length,
    news: { fetched: 0, created: 0, skipped: 0 },
    transcripts: { checked: 0, created: 0, skipped: 0 },
    warnings,
  };

  if (mode === 'news' || mode === 'all') {
    result.news = await ingestNews(userId, positions, warnings);
  }
  if (mode === 'transcripts' || mode === 'all') {
    result.transcripts = await ingestTranscripts(userId, positions, warnings);
  }
  return result;
}
