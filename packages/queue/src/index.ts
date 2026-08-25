import { DelayedError, Queue, type QueueOptions, Worker, type WorkerOptions } from "bullmq";
import { Redis } from "ioredis";

export function createRedisConnection(url: string): Redis {
  return new Redis(url, {
    maxRetriesPerRequest: null,
    enableReadyCheck: true,
    lazyConnect: true,
  });
}

export function createQueue<TData>(
  name: string,
  connection: Redis,
  options: Omit<QueueOptions, "connection"> = {},
) {
  return new Queue<TData>(name, {
    ...options,
    connection,
    defaultJobOptions: {
      attempts: 5,
      backoff: { type: "exponential", delay: 1_000 },
      removeOnComplete: { age: 86_400, count: 1_000 },
      removeOnFail: { age: 604_800, count: 5_000 },
      ...options.defaultJobOptions,
    },
  });
}

export function createWorker<TData, TResult>(
  name: string,
  connection: Redis,
  processor: (
    data: TData,
    control: { deferUntil(retryAt: Date): Promise<never> },
  ) => Promise<TResult>,
  options: Omit<WorkerOptions, "connection"> = {},
) {
  return new Worker<TData, TResult>(
    name,
    (job, token) =>
      processor(job.data, {
        deferUntil: async (retryAt) => {
          const timestamp = retryAt.getTime();
          if (!Number.isFinite(timestamp)) throw new Error("queue deferral timestamp is invalid");
          await job.moveToDelayed(Math.max(timestamp, Date.now() + 1), token);
          throw new DelayedError();
        },
      }),
    {
    ...options,
    connection,
    },
  );
}

export async function pingRedis(connection: Redis): Promise<void> {
  if (connection.status === "wait") {
    await connection.connect();
  }
  await connection.ping();
}
