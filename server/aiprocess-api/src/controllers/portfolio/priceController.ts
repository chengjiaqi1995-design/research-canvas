import { Request, Response } from 'express';
import * as priceService from '../../services/portfolioPriceService';

export async function updatePrices(req: Request, res: Response) {
  const data = await priceService.updatePortfolioPrices(req.userId!, req.query as any);
  res.json({ success: true, data });
}
