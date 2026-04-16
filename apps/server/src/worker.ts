/**
 * Standalone worker process for pipeline tasks.
 *
 * Run this separately from the main NestJS server to offload
 * heavy AI processing (analyze, generate scripts, storyboard).
 *
 * Usage:
 *   node dist/worker.js
 *
 * Requires:
 *   REDIS_URL — same Redis as the API server
 *   AI_MODEL — LLM model ID (default: qwen3-max)
 *   DASHSCOPE_API_KEY — API key for the LLM
 */
import 'dotenv/config';
import { Logger } from '@nestjs/common';
import { TaskService } from './pipeline/task/task.service';
import { TaskQueue } from './pipeline/task/task.queue';
import { TaskWorker } from './pipeline/task/task.worker';
import { ScriptAgentService } from './pipeline/script-agent.service';
import { AiService } from './ai/ai.service';

const logger = new Logger('WorkerProcess');
const SHUTDOWN_TIMEOUT_MS = 30_000;

async function bootstrap() {
  logger.log('Starting pipeline worker...');

  const ai = new AiService();
  const taskService = new TaskService();
  const taskQueue = new TaskQueue();
  const scriptAgent = new ScriptAgentService();

  const worker = new TaskWorker(
    taskService,
    () => ai.getModel(),
    (sessionId, state) => scriptAgent.saveState(sessionId, state),
  );

  taskQueue.startWorker(worker);

  logger.log('Pipeline worker ready. Waiting for tasks...');

  // Graceful shutdown — wait for in-flight jobs before exiting
  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.log(`${signal} received. Waiting for in-flight jobs to finish...`);

    // Force exit after timeout
    const forceTimer = setTimeout(() => {
      logger.error(
        `Shutdown timeout (${SHUTDOWN_TIMEOUT_MS}ms). Force exiting.`,
      );
      process.exit(1);
    }, SHUTDOWN_TIMEOUT_MS);

    try {
      await taskQueue.onModuleDestroy();
      await taskService.onModuleDestroy();
      logger.log('Worker shut down gracefully.');
    } catch (error) {
      logger.error(`Shutdown error: ${error}`);
    } finally {
      clearTimeout(forceTimer);
      process.exit(0);
    }
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

void bootstrap();
