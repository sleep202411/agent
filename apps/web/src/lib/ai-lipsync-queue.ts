/**
 * AI Lip-sync Queue Processor
 *
 * Mirrors ai-audio-queue.ts. Submits a lip-sync job to the Java backend
 * via long-polled HTTP and tracks progress in the Redux taskSlice so the
 * UI can reflect pending/running/completed state across dialog open/close
 * cycles.
 *
 * The endpoint itself is synchronous from the client's perspective —
 * Java holds the connection until the underlying provider returns — so
 * no separate status-poll API is needed here. The "async task"
 * architecture is purely client-side: we queue submissions, cap
 * concurrency, and record outcomes in Redux.
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
import type { LipSyncGenerateInput } from "@/src/store/slices/projectSlice";
import { env } from "@/src/env";

// Lip-sync is heavier than audio — stay conservative on concurrency.
const MAX_CONCURRENT = 2;
const QUEUE_INTERVAL = 1000;
const API_PATH = "/api/ai/video/lip/sync";

let processorTimer: ReturnType<typeof setInterval> | null = null;

function startProcessor() {
  if (processorTimer) return;

  processorTimer = setInterval(() => {
    const state = store.getState();
    const pending = selectPendingTasks(state).filter((t) => t.type === "lip_sync");
    const active = selectActiveTasks(state).filter(
      (t) => t.type === "lip_sync" && t.status === "running"
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

/**
 * Response shape varies by provider — try common keys in order.
 */
function parseLipSyncPath(result: unknown): string {
  if (typeof result === "string") return result.trim();
  if (Array.isArray(result) && result.length > 0) {
    const first = result.find(
      (item): item is string => typeof item === "string" && item.trim().length > 0
    );
    return String(first ?? "").trim();
  }
  if (result && typeof result === "object") {
    const record = result as Record<string, unknown>;
    const path = record.storagePath ?? record.filePath ?? record.path ?? record.url;
    return typeof path === "string" ? path.trim() : "";
  }
  return "";
}

async function executeTask(taskId: string) {
  const task = selectTask(store.getState(), taskId);
  if (!task || task.status !== "pending") return;

  store.dispatch(startTask(taskId));

  const input = task.input as unknown as LipSyncGenerateInput;

  try {
    const response = await backendApi.post<Record<string, unknown>>(API_PATH, {
      data: {
        shotColumnId: input.shotColumnId,
        shotId: input.shotId,
        model: input.model || undefined,
        input: {
          video_url: input.videoUrl,
          audio_url: input.audioUrl,
          ref_image_url: input.refImageUrl || undefined,
        },
        parameters: { video_extension: true },
      },
      timeout: 360_000,
    });

    const storagePath = parseLipSyncPath(response);
    if (!storagePath) {
      throw new Error("No lip-sync result returned");
    }

    const ossBase = env.OSS_BASE_URL;
    const url = storagePath.startsWith("http") ? storagePath : `${ossBase}/${storagePath}`;

    const output: TaskOutput = { url, storagePath };
    store.dispatch(completeTask({ taskId, output }));
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Lip-sync generation failed";
    store.dispatch(failTask({ taskId, error: msg }));
  }
}

export function submitLipSyncTask(input: LipSyncGenerateInput): string {
  const taskId = createTaskId();
  store.dispatch(
    addTask({
      id: taskId,
      type: "lip_sync",
      shotId: input.shotId,
      shotColumnId: input.shotColumnId,
      input: input as unknown as Record<string, unknown>,
    })
  );

  startProcessor();
  return taskId;
}

export function retryLipSyncTask(taskId: string): void {
  store.dispatch(retryTask(taskId));
  startProcessor();
}
