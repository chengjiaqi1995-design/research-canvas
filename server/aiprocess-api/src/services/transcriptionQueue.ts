/**
 * 转录任务双队列系统
 *
 * DashScope 转录队列（并发数 2）：避免超出 API Key 并发限制导致 DECODE_ERROR
 * Gemini 后处理队列（并发数 2）：总结 + 元数据提取，与转录流水线并行
 * 每个任务 10 分钟超时保护，超时后释放队列槽位并标记任务失败
 */

type QueueTask = () => Promise<void>;

const TASK_TIMEOUT_MS = 10 * 60 * 1000; // 10 分钟

function createConcurrentQueue(name: string, concurrency: number) {
  const queue: Array<{ task: QueueTask; label: string; onTimeout?: () => void }> = [];
  let running = 0;

  function processNext(): void {
    if (running >= concurrency || queue.length === 0) return;
    running++;
    const { task, label, onTimeout } = queue.shift()!;
    let settled = false;

    const timeoutId = setTimeout(() => {
      if (settled) return;
      settled = true;
      console.error(`⏰ [${name}] 任务超时（10分钟）: ${label}`);
      onTimeout?.();
      running--;
      console.log(`📋 [${name}] 超时释放槽位，剩余队列: ${queue.length}，运行中: ${running}/${concurrency}`);
      processNext();
    }, TASK_TIMEOUT_MS);

    task()
      .catch((error: any) => {
        console.error(`⚠️ [${name}] 任务失败: ${label}`, error?.message || error);
      })
      .finally(() => {
        if (settled) return; // 已被超时处理，避免双重 running--
        settled = true;
        clearTimeout(timeoutId);
        running--;
        console.log(`📋 [${name}] 任务完成，剩余队列: ${queue.length}，运行中: ${running}/${concurrency}`);
        processNext();
      });

    processNext(); // 尝试填满并发槽位
  }

  return {
    enqueue(task: QueueTask, label: string = '未知任务', onTimeout?: () => void): void {
      queue.push({ task, label, onTimeout });
      console.log(`📋 [${name}] 入队: ${label}，队列: ${queue.length}，运行中: ${running}/${concurrency}`);
      processNext();
    },
  };
}

// DashScope 转录队列：并发数 2（避免 DECODE_ERROR，同时提升吞吐量）
export const transcriptionQueue = createConcurrentQueue('DashScope转录', 2);

// Gemini 后处理队列：并发数 2（总结 + 元数据，与转录流水线并行）
export const postProcessQueue = createConcurrentQueue('Gemini后处理', 2);

// 兼容旧接口
export function enqueueTranscription(task: QueueTask): void {
  transcriptionQueue.enqueue(task, '转录任务');
}
