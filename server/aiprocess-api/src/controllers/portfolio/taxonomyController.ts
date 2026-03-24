import { Request, Response } from 'express';
import * as svc from '../../services/portfolioService';

export async function list(req: Request, res: Response) {
  const userId = req.userId!;
  const type = req.query.type as string | undefined;
  const items = await svc.getAllTaxonomies(userId, type);
  res.json({ success: true, data: items });
}

export async function create(req: Request, res: Response) {
  const userId = req.userId!;
  const item = await svc.createTaxonomy(userId, req.body);
  res.status(201).json({ success: true, data: item });
}

export async function update(req: Request, res: Response) {
  const userId = req.userId!;
  const item = await svc.updateTaxonomy(userId, parseInt(req.params.id), req.body);
  if (!item) return res.status(404).json({ success: false, error: 'Taxonomy not found' });
  res.json({ success: true, data: item });
}

export async function remove(req: Request, res: Response) {
  const userId = req.userId!;
  await svc.deleteTaxonomy(userId, parseInt(req.params.id));
  res.json({ success: true });
}
