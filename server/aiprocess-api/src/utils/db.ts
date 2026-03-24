import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient({
  log: process.env.NODE_ENV === 'development' ? ['error', 'warn'] : ['error'],
  datasources: {
    db: {
      url: process.env.DATABASE_URL,
    },
  },
});

/**
 * 重连数据库：在长时间 AI 调用后，连接可能被 Cloud SQL Proxy 断开，
 * 调用此函数先断开再重连，确保后续数据库操作正常。
 */
export async function reconnectDB() {
  try {
    await prisma.$disconnect();
  } catch (e) {
    // ignore disconnect errors
  }
  await prisma.$connect();
}

/**
 * 为长时间运行的任务创建独立的 PrismaClient。
 * 每次 DB 操作前创建新连接，操作后立即断开，
 * 避免 Cloud SQL Proxy 在长时间 AI 调用期间断开空闲连接。
 * 也不会影响其他请求使用的全局 prisma 实例。
 */
export function createTaskClient(): PrismaClient {
  return new PrismaClient({
    log: ['error'],
    datasources: {
      db: {
        url: process.env.DATABASE_URL,
      },
    },
  });
}

// 确保进程退出时断开连接，避免连接泄漏
process.on('beforeExit', async () => {
  await prisma.$disconnect();
});

export default prisma;
