import { Request, Response, NextFunction } from 'express';

type AsyncFn = (req: Request, res: Response, next: NextFunction) => Promise<any>;

export const asyncHandler = (fn: AsyncFn) =>
  (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(async (error) => {
      if (
        !res.headersSent &&
        ['GET', 'HEAD', 'OPTIONS'].includes(req.method) &&
        error instanceof Error
      ) {
        try {
          const { isPrismaEngineDisconnected, reconnectDB } = await import('../utils/db');
          if (!isPrismaEngineDisconnected(error)) return next(error);
          await reconnectDB();
          return await fn(req, res, next);
        } catch (retryError) {
          return next(retryError);
        }
      }
      return next(error);
    });
  };
