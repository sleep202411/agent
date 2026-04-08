import { Logger } from '@nestjs/common';

const logger = new Logger('RetryUtil');

/**
 * Retry a function with exponential backoff.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: {
    maxRetries?: number;
    baseDelayMs?: number;
    label?: string;
  } = {},
): Promise<T> {
  const { maxRetries = 3, baseDelayMs = 2000, label = 'operation' } = options;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      if (attempt === maxRetries) {
        logger.error(
          `${label} failed after ${maxRetries + 1} attempts: ${error}`,
        );
        throw error;
      }
      const delay = baseDelayMs * 2 ** attempt;
      logger.warn(
        `${label} attempt ${attempt + 1} failed, retrying in ${delay}ms: ${error}`,
      );
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  throw new Error('Unreachable');
}

/**
 * Run async tasks with concurrency control.
 * Returns results in the same order as the input tasks.
 */
export async function runWithConcurrency<T>(
  tasks: (() => Promise<T>)[],
  concurrency: number,
): Promise<T[]> {
  const results: T[] = new Array(tasks.length);
  let nextIndex = 0;

  async function worker(): Promise<void> {
    while (nextIndex < tasks.length) {
      const index = nextIndex++;
      results[index] = await tasks[index]();
    }
  }

  const workers = Array.from(
    { length: Math.min(concurrency, tasks.length) },
    () => worker(),
  );

  await Promise.all(workers);
  return results;
}
