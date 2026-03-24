/**
 * 转录任务串行队列
 *
 * DashScope API 对同一 API Key 有并发任务数限制，
 * 多个转录任务同时运行会导致 DECODE_ERROR。
 * 此队列确保同一时间只有一个转录任务在执行。
 */

type QueueTask = () => Promise<void>;

const queue: QueueTask[] = [];
let running = false;

async function processQueue(): Promise<void> {
  if (running || queue.length === 0) return;

  running = true;

  while (queue.length > 0) {
    const task = queue.shift()!;
    try {
      await task();
    } catch (error) {
      // 任务内部已有 try/catch，这里是兜底
      console.error('⚠️ 队列任务执行出错:', error);
    }

    if (queue.length > 0) {
      console.log(`📋 队列中还有 ${queue.length} 个转录任务等待处理`);
    }
  }

  running = false;
}

export function enqueueTranscription(task: QueueTask): void {
  queue.push(task);
  console.log(`📋 转录任务已入队，当前队列长度: ${queue.length}，正在执行: ${running}`);
  processQueue();
}
