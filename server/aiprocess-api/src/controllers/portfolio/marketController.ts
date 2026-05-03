import { Request, Response } from 'express';
import * as eodhd from '../../services/eodhdService';
import * as technical from '../../services/portfolioTechnicalService';

function eodhdTokenFromRequest(req: Request): string | undefined {
  const header = req.headers['x-eodhd-api-token'];
  const token = Array.isArray(header) ? header[0] : header;
  if (typeof token === 'string' && token.trim() && !token.includes('****')) return token.trim();
  return undefined;
}

export async function listExchanges(req: Request, res: Response) {
  const exchanges = await eodhd.listExchanges(eodhdTokenFromRequest(req));
  res.json({ success: true, data: exchanges });
}

export async function screenStocks(req: Request, res: Response) {
  const data = await eodhd.screenStocks(req.body || {}, req.userId, eodhdTokenFromRequest(req));
  res.json({ success: true, data });
}

export async function getSymbolDetail(req: Request, res: Response) {
  const symbol = decodeURIComponent(req.params.symbol || '');
  const days = Number(req.query.days || 220);
  const data = await eodhd.getSymbolDetail(symbol, days, eodhdTokenFromRequest(req));
  res.json({ success: true, data });
}

export async function analyzePortfolioTechnicals(req: Request, res: Response) {
  const data = await technical.analyzePortfolioTechnicals(req.userId!, req.query as any, eodhdTokenFromRequest(req));
  res.json({ success: true, data });
}
