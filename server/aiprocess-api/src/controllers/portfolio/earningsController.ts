import { Request, Response } from 'express';
import prisma from '../../utils/db';
import yahooFinance from 'yahoo-finance2';

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

// Ensure Yahoo suppresses irrelevant notices (removed due to TS scope)

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
        const twoWeeksLater = new Date();
        twoWeeksLater.setDate(twoWeeksLater.getDate() + 14);

        const earningsEvents: EarningsEvent[] = [];
        const batchSize = 5;

        for (let i = 0; i < positions.length; i += batchSize) {
            const batch = positions.slice(i, i + batchSize);

            const promises = batch.map(async (pos) => {
                const yahooSymbol = bbgToYahoo(pos.tickerBbg);
                if (!yahooSymbol) return null;

                try {
                    const result: any = await yahooFinance.quoteSummary(yahooSymbol, {
                        modules: ["calendarEvents"],
                    });

                    const earningsDates = result?.calendarEvents?.earnings?.earningsDate;
                    if (!earningsDates || earningsDates.length === 0) return null;

                    const earningsDate = new Date(earningsDates[0]);

                    if (earningsDate >= now && earningsDate <= twoWeeksLater) {
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
                } catch {
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
            }
        });
    } catch (error: any) {
        console.error("Failed to fetch earnings:", error);
        res.status(500).json({ success: false, error: error.message || "Failed to fetch earnings" });
    }
}
