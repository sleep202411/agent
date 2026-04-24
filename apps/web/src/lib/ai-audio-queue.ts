/**
 * AI Audio Queue Processor
 *
 * Manages audio generation task execution following the same pattern as ai-image-queue.ts.
 * Reads tasks from taskSlice, executes them against the backend API,
 * and updates task status on completion/failure.
 */

import { backendApi } from "@/src/lib/api";
import { store } from "@/src/store";
import {
  addTask,
  startTask,
  completeTask,
  failTask,
  retryTask,
  createTaskId,
  selectPendingTasks,
  selectActiveTasks,
  selectTask,
  type TaskOutput,
} from "@/src/store/slices/taskSlice";
import type { AudioGenerateInput } from "@/src/store/slices/projectSlice";
import { env } from "@/src/env";

const MAX_CONCURRENT = 4;
const QUEUE_INTERVAL = 1000;
const API_PATH = "/api/ai/voice/synthesize";

let processorTimer: ReturnType<typeof setInterval> | null = null;

function startProcessor() {
  if (processorTimer) return;

  processorTimer = setInterval(() => {
    const state = store.getState();
    const pending = selectPendingTasks(state).filter((t) => t.type === "audio");
    const active = selectActiveTasks(state).filter(
      (t) => t.type === "audio" && t.status === "running"
    );

    if (pending.length === 0) {
      stopProcessor();
      return;
    }

    if (active.length >= MAX_CONCURRENT) return;

    const next = pending[0];
    if (next) void executeTask(next.id);
  }, QUEUE_INTERVAL);
}

function stopProcessor() {
  if (processorTimer) {
    clearInterval(processorTimer);
    processorTimer = null;
  }
}

function parseAudioPath(result: unknown): string {
  if (Array.isArray(result) && result.length > 0) {
    const stringItems = result.filter(
      (item): item is string => typeof item === "string" && item.trim().length > 0
    );
    return String(stringItems[1] ?? stringItems[0] ?? "").trim();
  }
  if (typeof result === "string") return result.trim();
  if (result && typeof result === "object") {
    const record = result as Record<string, unknown>;
    return String(record.storagePath ?? record.filePath ?? record.path ?? record.url ?? "").trim();
  }
  return "";
}

async function executeTask(taskId: string) {
  const task = selectTask(store.getState(), taskId);
  if (!task || task.status !== "pending") return;

  store.dispatch(startTask(taskId));

  const input = task.input as unknown as AudioGenerateInput;

  try {
    const response = await backendApi.post<Record<string, unknown>>(API_PATH, {
      data: {
        shotId: input.shotId,
        shotColumnId: input.shotColumnId,
        model: input.model || undefined,
        text: input.prompt,
        voice_id: input.voiceId || undefined,
      },
      timeout: 360_000,
    });

    const storagePath = parseAudioPath(response);
    if (!storagePath) {
      throw new Error("No audio result returned");
    }

    const ossBase = env.OSS_BASE_URL;
    const url = storagePath.startsWith("http") ? storagePath : `${ossBase}/${storagePath}`;

    const output: TaskOutput = { url, storagePath };
    store.dispatch(completeTask({ taskId, output }));
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Audio generation failed";
    store.dispatch(failTask({ taskId, error: msg }));
  }
}

export function submitAudioTask(input: AudioGenerateInput): string {
  const taskId = createTaskId();
  store.dispatch(
    addTask({
      id: taskId,
      type: "audio",
      shotId: input.shotId,
      shotColumnId: input.shotColumnId,
      input: input as unknown as Record<string, unknown>,
    })
  );

  startProcessor();
  return taskId;
}

export function retryAudioTask(taskId: string): void {
  store.dispatch(retryTask(taskId));
  startProcessor();
}
