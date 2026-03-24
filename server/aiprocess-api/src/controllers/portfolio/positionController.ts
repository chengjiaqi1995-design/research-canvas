import { Request, Response } from 'express';
import * as svc from '../../services/portfolioService';

export async function list(req: Request, res: Response) {
  const userId = req.userId!;
  const positions = await svc.getAllPositions(userId, req.query as any);
  res.json({ success: true, data: positions });
}

export async function getOne(req: Request, res: Response) {
  const userId = req.userId!;
  const position = await svc.getPositionById(userId, parseInt(req.params.id));
  if (!position) return res.status(404).json({ success: false, error: 'Position not found' });
  res.json({ success: true, data: position });
}

export async function create(req: Request, res: Response) {
  const userId = req.userId!;
  const position = await svc.createPosition(userId, req.body);
  res.status(201).json({ success: true, data: position });
}

export async function update(req: Request, res: Response) {
  const userId = req.userId!;
  const position = await svc.updatePosition(userId, parseInt(req.params.id), req.body);
  if (!position) return res.status(404).json({ success: false, error: 'Position not found' });
  res.json({ success: true, data: position });
}

export async function remove(req: Request, res: Response) {
  const userId = req.userId!;
  await svc.deletePosition(userId, parseInt(req.params.id));
  res.json({ success: true });
}
