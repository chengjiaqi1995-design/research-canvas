import { Request, Response } from 'express';
import * as eodhd from '../../services/eodhdService';
import { buildFmpEarningsTable } from '../../services/fmpEarningsTableService';
import * as fmp from '../../services/fmpService';
import * as technical from '../../services/portfolioTechnicalService';

export async function listExchanges(req: Request, res: Response) {
  if (fmp.hasFmpApiKey()) {
    return res.json({ success: true, data: fmp.listFmpExchanges(), meta: { provider: 'fmp' } });
  }
  try {
    const exchanges = await eodhd.listExchanges();
    return res.json({ success: true, data: exchanges, meta: { provider: 'eodhd' } });
  } catch (error) {
    // Do not let an unauthorized EODHD token make the screener controls unusable.
    return res.json({
      success: true,
      data: fmp.listFmpExchanges(),
      meta: {
        provider: 'static',
        warnings: [error instanceof Error ? error.message : 'EODHD exchange list unavailable'],
      },
    });
  }
}

export async function screenStocks(req: Request, res: Response) {
  const filters = req.body || {};
  const provider = String(filters.provider || 'auto').toLowerCase();
  if (provider !== 'eodhd' && fmp.hasFmpApiKey()) {
    try {
      const data = await fmp.screenStocks(filters, req.userId);
      return res.json({ success: true, data });
    } catch (error) {
      if (provider === 'fmp') throw error;
      try {
        const data = await eodhd.screenStocks(filters, req.userId);
        data.meta.warnings = [
          `FMP screener failed, used EODHD fallback: ${error instanceof Error ? error.message : String(error)}`,
          ...(data.meta.warnings || []),
        ];
        return res.json({ success: true, data });
      } catch {
        throw error;
      }
    }
  }
  const data = await eodhd.screenStocks(filters, req.userId);
  res.json({ success: true, data });
}

export async function getSymbolDetail(req: Request, res: Response) {
  const symbol = decodeURIComponent(req.params.symbol || '');
  const days = Number(req.query.days || 220);
  const provider = String(req.query.provider || 'auto').toLowerCase();
  if (provider !== 'eodhd' && fmp.hasFmpApiKey()) {
    try {
      const data = await fmp.getSymbolDetail(symbol, days);
      return res.json({ success: true, data });
    } catch (error) {
      if (provider === 'fmp') throw error;
    }
  }
  const data = await eodhd.getSymbolDetail(symbol, days);
  res.json({ success: true, data });
}

export async function analyzePortfolioTechnicals(req: Request, res: Response) {
  const data = await technical.analyzePortfolioTechnicals(req.userId!, req.query as any);
  res.json({ success: true, data });
}

export async function getFmpEarningsTable(req: Request, res: Response) {
  const data = await buildFmpEarningsTable({
    symbol: String(req.query.symbol || ''),
    fiscalYear: req.query.fiscalYear != null ? String(req.query.fiscalYear) : req.query.year != null ? String(req.query.year) : undefined,
    quarter: req.query.quarter != null ? String(req.query.quarter) : undefined,
    date: req.query.date ? String(req.query.date) : undefined,
  });
  res.json({ success: true, data });
}
