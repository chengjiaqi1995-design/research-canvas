import { PrismaClient } from '@prisma/client';

// Append connection pool params if not already present in DATABASE_URL
function getDatabaseUrl(): string {
  const url = process.env.DATABASE_URL || '';
  // If URL already has connection_limit, use as-is
  if (url.includes('connection_limit')) return url;
  const separator = url.includes('?') ? '&' : '?';
  return `${url}${separator}connection_limit=10&pool_timeout=30`;
}

const prisma = new PrismaClient({
  log: process.env.NODE_ENV === 'development' ? ['error', 'warn'] : ['error'],
  datasources: {
    db: {
      url: getDatabaseUrl(),
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
 * 确保全局 PrismaClient 可用。
 * Cloud Run/Cloud SQL Proxy 空闲后可能让 Prisma engine 处于 disconnected 状态；
 * 普通列表接口没有长任务上下文，需要在查询前做轻量 connect 自愈。
 */
export async function ensureDBConnected() {
  try {
    await prisma.$connect();
  } catch (e) {
    await reconnectDB();
  }
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
