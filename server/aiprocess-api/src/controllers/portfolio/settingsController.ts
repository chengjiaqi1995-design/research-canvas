import { Request, Response } from 'express';
import * as svc from '../../services/portfolioService';

export async function getSettings(req: Request, res: Response) {
  const userId = req.userId!;
  const settings = await svc.getSettings(userId);
  res.json({ success: true, data: settings });
}

export async function updateSettings(req: Request, res: Response) {
  const userId = req.userId!;
  const settings = await svc.updateSettings(userId, req.body);
  res.json({ success: true, data: settings });
}
