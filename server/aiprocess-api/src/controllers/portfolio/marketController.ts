import { Request, Response } from 'express';
import * as eodhd from '../../services/eodhdService';
import * as technical from '../../services/portfolioTechnicalService';

export async function listExchanges(req: Request, res: Response) {
  const exchanges = await eodhd.listExchanges();
  res.json({ success: true, data: exchanges });
}

export async function screenStocks(req: Request, res: Response) {
  const data = await eodhd.screenStocks(req.body || {}, req.userId);
  res.json({ success: true, data });
}

export async function getSymbolDetail(req: Request, res: Response) {
  const symbol = decodeURIComponent(req.params.symbol || '');
  const days = Number(req.query.days || 220);
  const data = await eodhd.getSymbolDetail(symbol, days);
  res.json({ success: true, data });
}

export async function analyzePortfolioTechnicals(req: Request, res: Response) {
  const data = await technical.analyzePortfolioTechnicals(req.userId!, req.query as any);
  res.json({ success: true, data });
}
