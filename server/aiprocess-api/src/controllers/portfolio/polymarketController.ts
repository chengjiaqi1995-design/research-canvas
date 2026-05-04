import { Request, Response } from 'express';
import { syncPolymarketPortfolioFeed } from '../../services/polymarketService';

export async function syncPortfolioRadar(req: Request, res: Response) {
  const userId = req.userId!;
  const result = await syncPolymarketPortfolioFeed(userId, {
    maxPositions: req.body?.maxPositions,
    maxQueries: req.body?.maxQueries,
    maxMarkets: req.body?.maxMarkets,
    minVolume: req.body?.minVolume,
    dryRun: req.body?.dryRun === true,
  });

  return res.json({
    success: true,
    data: {
      feedItem: result.feedItem ? {
        id: result.feedItem.id,
        title: result.feedItem.title,
        source: result.feedItem.source,
        reportKey: result.feedItem.reportKey,
        publishedAt: result.feedItem.publishedAt,
      } : null,
      matchedMarketCount: result.matchedMarkets.length,
      queryCount: result.queryCount,
      checkedPositionCount: result.checkedPositionCount,
      warnings: result.warnings,
      markets: result.matchedMarkets,
    },
  });
}
