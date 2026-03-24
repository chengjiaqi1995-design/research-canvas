import { Request, Response } from 'express';
import * as svc from '../../services/portfolioService';

export async function getSummary(req: Request, res: Response) {
  const userId = req.userId!;
  const summary = await svc.getPortfolioSummary(userId);
  res.json({ success: true, data: summary });
}
