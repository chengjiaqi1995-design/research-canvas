ALTER TABLE "PortfolioPosition"
  ADD COLUMN "longTermInvestmentLogic" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "demandChange" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "catalyst" TEXT NOT NULL DEFAULT '';
