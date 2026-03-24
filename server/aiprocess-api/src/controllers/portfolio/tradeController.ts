import { Request, Response } from 'express';
import prisma from '../../utils/db';
import * as svc from '../../services/portfolioService';

export async function list(req: Request, res: Response) {
  const userId = req.userId!;
  const trades = await prisma.portfolioTrade.findMany({
    where: { userId },
    include: { items: true },
    orderBy: { createdAt: 'desc' },
  });
  res.json({ success: true, data: trades });
}

export async function getOne(req: Request, res: Response) {
  const userId = req.userId!;
  const trade = await prisma.portfolioTrade.findFirst({
    where: { id: parseInt(req.params.id), userId },
    include: { items: true, snapshot: true },
  });
  if (!trade) return res.status(404).json({ success: false, error: 'Trade not found' });
  res.json({ success: true, data: trade });
}

export async function create(req: Request, res: Response) {
  const userId = req.userId!;
  const { items, note } = req.body;
  const trade = await prisma.portfolioTrade.create({
    data: {
      userId,
      note: note || '',
      items: { create: items },
    },
    include: { items: true },
  });
  res.status(201).json({ success: true, data: trade });
}

export async function update(req: Request, res: Response) {
  const userId = req.userId!;
  const id = parseInt(req.params.id);
  const existing = await prisma.portfolioTrade.findFirst({ where: { id, userId } });
  if (!existing) return res.status(404).json({ success: false, error: 'Trade not found' });

  const { status, note, items } = req.body;

  // Execute trade: update positions and create snapshot
  if (status === 'executed' && existing.status !== 'executed') {
    const tradeWithItems = await prisma.portfolioTrade.findFirst({
      where: { id, userId },
      include: { items: true },
    });

    const aum = await svc.getAum(userId);

    // Apply each trade item to positions
    for (const item of tradeWithItems!.items) {
      const position = await prisma.portfolioPosition.findFirst({
        where: { userId, tickerBbg: item.tickerBbg },
      });
      if (!position) continue;

      const gmvUsd = item.gmvUsdK === -1 ? position.positionAmount : item.gmvUsdK * 1000;
      let newAmount = position.positionAmount;

      if (item.transactionType === 'buy') {
        newAmount = position.longShort === 'short'
          ? position.positionAmount - gmvUsd
          : position.positionAmount + gmvUsd;
      } else {
        newAmount = position.longShort === 'short'
          ? position.positionAmount + gmvUsd
          : position.positionAmount - gmvUsd;
      }

      if (item.unwind || newAmount <= 0) {
        newAmount = 0;
      }

      await prisma.portfolioPosition.update({
        where: { id: position.id },
        data: {
          positionAmount: Math.max(0, newAmount),
          positionWeight: aum > 0 ? Math.max(0, newAmount) / aum : 0,
        },
      });
    }

    // Create snapshot
    const allPositions = await svc.getAllPositions(userId);
    const summary = await svc.getPortfolioSummary(userId);
    await prisma.portfolioSnapshot.create({
      data: {
        tradeId: id,
        positionsJson: JSON.stringify(allPositions),
        summaryJson: JSON.stringify(summary),
      },
    });
  }

  const trade = await prisma.portfolioTrade.update({
    where: { id },
    data: {
      ...(status && { status }),
      ...(note !== undefined && { note }),
      ...(status === 'executed' && { executedAt: new Date() }),
    },
    include: { items: true },
  });

  // Update items if provided
  if (items) {
    await prisma.portfolioTradeItem.deleteMany({ where: { tradeId: id } });
    await prisma.portfolioTradeItem.createMany({
      data: items.map((item: any) => ({ ...item, tradeId: id })),
    });
  }

  const updated = await prisma.portfolioTrade.findFirst({
    where: { id },
    include: { items: true },
  });
  res.json({ success: true, data: updated });
}

export async function remove(req: Request, res: Response) {
  const userId = req.userId!;
  const id = parseInt(req.params.id);
  const existing = await prisma.portfolioTrade.findFirst({ where: { id, userId } });
  if (!existing) return res.status(404).json({ success: false, error: 'Trade not found' });
  await prisma.portfolioTrade.delete({ where: { id } });
  res.json({ success: true });
}

export async function exportTrade(req: Request, res: Response) {
  const userId = req.userId!;
  const id = parseInt(req.params.id);
  const trade = await prisma.portfolioTrade.findFirst({
    where: { id, userId },
    include: { items: true },
  });
  if (!trade) return res.status(404).json({ success: false, error: 'Trade not found' });

  // Return trade data as JSON for now (Excel export can be added later with xlsx package)
  res.json({ success: true, data: trade });
}
