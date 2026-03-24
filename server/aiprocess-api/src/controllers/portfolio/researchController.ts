import { Request, Response } from 'express';
import prisma from '../../utils/db';

export async function list(req: Request, res: Response) {
  const userId = req.userId!;
  const items = await prisma.portfolioResearch.findMany({
    where: { userId },
    include: { position: { select: { id: true, tickerBbg: true, nameEn: true, nameCn: true } } },
    orderBy: { updatedAt: 'desc' },
  });
  res.json({ success: true, data: items });
}

export async function getOne(req: Request, res: Response) {
  const userId = req.userId!;
  const positionId = parseInt(req.params.id);
  const research = await prisma.portfolioResearch.findFirst({
    where: { positionId, userId },
  });
  res.json({ success: true, data: research });
}

export async function createOrUpdate(req: Request, res: Response) {
  const userId = req.userId!;
  const positionId = parseInt(req.params.id);

  // Verify position ownership
  const position = await prisma.portfolioPosition.findFirst({ where: { id: positionId, userId } });
  if (!position) return res.status(404).json({ success: false, error: 'Position not found' });

  const research = await prisma.portfolioResearch.upsert({
    where: { positionId },
    create: { positionId, userId, ...req.body },
    update: req.body,
  });
  res.json({ success: true, data: research });
}
