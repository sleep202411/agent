/**
 * AI Fusion Queue Processor
 *
 * Manages character fusion task execution following the same pattern
 * as ai-image-queue.ts. Reads tasks from taskSlice, executes them
 * against the backend API, and updates task status on completion/failure.
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
import { buildOssUrl } from "@/src/lib/uploads/workspace-upload";
import { normalizeStoragePath, ROLE_FUSION_COLUMN_ID } from "@/src/lib/asset-paths";
import type { FusionGenerateInput } from "@/src/store/slices/projectSlice";

// ─── Constants ─────────────────────────────────────────

const MAX_CONCURRENT = 4;
const QUEUE_INTERVAL = 1000;
const API_PATH = "/api/ai/image/compose/character";

// ─── Timer Management ──────────────────────────────────

let processorTimer: ReturnType<typeof setInterval> | null = null;

function startProcessor() {
  if (processorTimer) return;

  processorTimer = setInterval(() => {
    const state = store.getState();
    const pending = selectPendingTasks(state).filter((t) => t.type === "fusion");
    const active = selectActiveTasks(state).filter(
      (t) => t.type === "fusion" && t.status === "running"
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

// ─── Task Execution ────────────────────────────────────

async function executeTask(taskId: string) {
  const task = selectTask(store.getState(), taskId);
  if (!task || task.status !== "pending") return;

  store.dispatch(startTask(taskId));

  const input = task.input as unknown as FusionGenerateInput;

  try {
    const response = await backendApi.post<string>(API_PATH, {
      data: {
        shotColumnId: ROLE_FUSION_COLUMN_ID,
        shotId: input.worldRoleId,
        worldRoleId: input.worldRoleId,
        prompt: input.prompt,
        model: input.model || undefined,
        characterImageUrl: input.characterImageUrl,
        propImageUrls: input.propImageUrls,
        costumeImageUrls: [],
        styleText: "",
        styleImageUrl: "",
      },
      timeout: 360_000,
    });

    const storagePath = normalizeStoragePath(String(response ?? ""));
    const url = buildOssUrl(storagePath);

    const output: TaskOutput = { url, storagePath };
    store.dispatch(completeTask({ taskId, output }));
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Character fusion generation failed";
    store.dispatch(failTask({ taskId, error: msg }));
  }
}

// ─── Public API ────────────────────────────────────────

/**
 * Submit a character fusion task.
 * Creates a task in taskSlice and starts the queue processor.
 */
export function submitFusionTask(input: FusionGenerateInput): string {
  const taskId = createTaskId();
  store.dispatch(
    addTask({
      id: taskId,
      type: "fusion",
      input: input as unknown as Record<string, unknown>,
    })
  );

  startProcessor();
  return taskId;
}

/**
 * Retry a failed fusion task.
 * Resets the task to pending and restarts the processor.
 */
export function retryFusionTask(taskId: string): void {
  store.dispatch(retryTask(taskId));
  startProcessor();
}
