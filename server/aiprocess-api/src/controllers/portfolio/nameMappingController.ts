import { Request, Response } from 'express';
import * as svc from '../../services/portfolioService';

export async function list(req: Request, res: Response) {
  const userId = req.userId!;
  const items = await svc.getNameMappings(userId);
  res.json({ success: true, data: items });
}

export async function create(req: Request, res: Response) {
  const userId = req.userId!;
  const item = await svc.createNameMapping(userId, req.body);
  res.status(201).json({ success: true, data: item });
}

export async function update(req: Request, res: Response) {
  const userId = req.userId!;
  const item = await svc.updateNameMapping(userId, parseInt(req.params.id), req.body);
  if (!item) return res.status(404).json({ success: false, error: 'Name mapping not found' });
  res.json({ success: true, data: item });
}

export async function remove(req: Request, res: Response) {
  const userId = req.userId!;
  await svc.deleteNameMapping(userId, parseInt(req.params.id));
  res.json({ success: true });
}
