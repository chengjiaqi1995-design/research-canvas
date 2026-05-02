import { Request, Response } from 'express';
import prisma from '../../utils/db';
import YahooFinance from 'yahoo-finance2';

const yahooFinance = new YahooFinance({
    suppressNotices: ['yahooSurvey'],
});

const DEFAULT_LOOKAHEAD_DAYS = 45;
const MAX_LOOKAHEAD_DAYS = 120;

function bbgToYahoo(bbgTicker: string): string | null {
    const parts = bbgTicker.trim().split(/\s+/);
    if (parts.length < 2) return null;
    const symbol = parts[0];
    const exchange = parts[1].toUpperCase();
    const type = (parts[2] || "").toUpperCase();
    if (type === "CURNCY" || type === "INDEX" || type === "COMDTY") return null;

    const exchangeMap: Record<string, string> = {
        "US": "", "UN": "", "UQ": "", "UP": "",
        "HK": ".HK", "JP": ".T", "KS": ".KS", "KQ": ".KQ",
        "AU": ".AX", "TT": ".TW", "IN": ".BO", "SP": ".SI",
        "LN": ".L", "GR": ".DE", "FP": ".PA", "SM": ".MC",
        "IM": ".MI", "SJ": ".JO", "SS": ".ST", "SW": ".SW",
        "LI": ".AS", "NA": ".AS", "NO": ".OL", "DC": ".CO",
        "FH": ".HE", "PW": ".WA", "CN": ".TO",
    };

    if (exchange === "CH" || exchange === "CS" || exchange === "CG") {
        if (/^6\d{5}$/.test(symbol)) return symbol + ".SS";
        if (/^[0-3]\d{5}$/.test(symbol)) return symbol + ".SZ";
        return symbol + ".SS";
    }

    const suffix = exchangeMap[exchange];
    if (suffix === undefined) return symbol;

    let sym = symbol.replace(/\//g, "-");
    if (exchange === "HK" && /^\d+$/.test(sym)) sym = sym.padStart(4, "0");
    if (exchange === "SS" && /^[A-Z]+[A-Z]$/.test(sym) && sym.length > 3) {
        sym = sym.slice(0, -1) + "-" + sym.slice(-1);
    }

    return sym + suffix;
}

export interface EarningsEvent {
    tickerBbg: string;
    nameEn: string;
    longShort: string;
    earningsDate: string; // ISO date string
    timing: string; // "BMO" | "AMC" | ""
    positionAmount: number;
}

function getLookaheadDays(value: unknown): number {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_LOOKAHEAD_DAYS;
    return Math.min(Math.floor(parsed), MAX_LOOKAHEAD_DAYS);
}

function parseYahooDate(value: unknown): Date | null {
    if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
    if (typeof value === 'number') {
        const date = new Date(value > 10_000_000_000 ? value : value * 1000);
        return Number.isNaN(date.getTime()) ? null : date;
    }
    if (typeof value === 'string') {
        const date = new Date(value);
        return Number.isNaN(date.getTime()) ? null : date;
    }
    if (value && typeof value === 'object') {
        const raw = (value as { raw?: unknown }).raw;
        if (raw !== undefined) return parseYahooDate(raw);
    }
    return null;
}

function firstEarningsDateInWindow(values: unknown, start: Date, end: Date): Date | null {
    const rawDates = Array.isArray(values) ? values : values ? [values] : [];
    const dates = rawDates
        .map(parseYahooDate)
        .filter((date): date is Date => Boolean(date))
        .filter((date) => date >= start && date <= end)
        .sort((a, b) => a.getTime() - b.getTime());
    return dates[0] || null;
}

export async function getEarnings(req: Request, res: Response) {
    const userId = req.userId!;

    try {
        const positions = await prisma.portfolioPosition.findMany({
            where: {
                userId,
                longShort: { in: ['long', 'short'] },
                positionAmount: { gt: 0 }
            },
            select: { tickerBbg: true, nameEn: true, longShort: true, positionAmount: true }
        });

        const now = new Date();
        const lookaheadDays = getLookaheadDays(req.query.days);
        const windowEnd = new Date(now);
        windowEnd.setDate(windowEnd.getDate() + lookaheadDays);

        const earningsEvents: EarningsEvent[] = [];
        const batchSize = 5;
        let failedCount = 0;
        let unmappedCount = 0;

        for (let i = 0; i < positions.length; i += batchSize) {
            const batch = positions.slice(i, i + batchSize);

            const promises = batch.map(async (pos) => {
                const yahooSymbol = bbgToYahoo(pos.tickerBbg);
                if (!yahooSymbol) {
                    unmappedCount++;
                    return null;
                }

                try {
                    const result: any = await yahooFinance.quoteSummary(yahooSymbol, {
                        modules: ["calendarEvents"],
                    });

                    const earningsDates = result?.calendarEvents?.earnings?.earningsDate;
                    const earningsDate = firstEarningsDateInWindow(earningsDates, now, windowEnd);

                    if (earningsDate) {
                        const utcHour = earningsDate.getUTCHours();
                        let timing = "";
                        if (utcHour < 14) timing = "BMO";
                        else if (utcHour >= 20) timing = "AMC";

                        return {
                            tickerBbg: pos.tickerBbg,
                            nameEn: pos.nameEn,
                            longShort: pos.longShort,
                            earningsDate: earningsDate.toISOString(),
                            timing,
                            positionAmount: pos.positionAmount,
                        };
                    }
                    return null;
                } catch (error: any) {
                    failedCount++;
                    console.warn(`Failed to fetch Yahoo earnings for ${pos.tickerBbg}: ${error?.message || error}`);
                    return null;
                }
            });

            const results = await Promise.all(promises);
            for (const r of results) {
                if (r) earningsEvents.push(r);
            }

            if (i + batchSize < positions.length) {
                await new Promise(resolve => setTimeout(resolve, 300));
            }
        }

        earningsEvents.sort((a, b) => new Date(a.earningsDate).getTime() - new Date(b.earningsDate).getTime());

        res.json({
            success: true,
            data: {
                events: earningsEvents,
                checkedAt: new Date().toISOString(),
                totalChecked: positions.length,
                failedCount,
                unmappedCount,
                lookaheadDays,
            }
        });
    } catch (error: any) {
        console.error("Failed to fetch earnings:", error);
        res.status(500).json({ success: false, error: error.message || "Failed to fetch earnings" });
    }
}
