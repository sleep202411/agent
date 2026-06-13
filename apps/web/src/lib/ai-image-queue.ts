/**
 * AI Image Queue Processor
 *
 * Self-contained module that manages image generation task execution.
 * Reads tasks from useTaskStore, executes them against the backend API,
 * and updates task status on completion/failure.
 */

import { backendApi, ApiRequestError } from "@/src/lib/api";
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
import { type ImageGenerateInput } from "@/src/store/slices/projectSlice";

// ─── Constants ─────────────────────────────────────────

const MAX_CONCURRENT = 4;
const QUEUE_INTERVAL = 1000;

const API_PATH_IMAGE = "/api/ai/image/generate/basic";
const API_PATH_IMAGE_EDIT = "/api/ai/image/edit/wan";

/**
 * Strip control characters (newline / carriage-return / tab / other
 * C0 chars) from a prompt before it goes to the Java image backend.
 *
 * The Java `/api/ai/image/*` handlers hand-build the JSON body sent to
 * fal (gpt-image-2) by string concatenation and do NOT escape control
 * characters, so a raw `\n` from a multi-line prompt produces invalid
 * JSON and fal rejects it with `json_invalid` ("Invalid control
 * character at") before the model ever runs. Image/video models treat
 * a newline and a space identically, so collapsing them to a single
 * space is lossless for generation while sidestepping the backend bug.
 *
 * This is a client-side stopgap scoped to the image-gen path only — the
 * real fix is to make the Java side serialize its request body properly.
 */
function sanitizePrompt(s: string | undefined | null): string {
  return (s ?? "")
    .replace(/[\u0000-\u001f]/g, " ")
    .replace(/ {2,}/g, " ")
    .trim();
}

// ─── Timer Management ──────────────────────────────────

let processorTimer: ReturnType<typeof setInterval> | null = null;

function startProcessor() {
  if (processorTimer) return;

  processorTimer = setInterval(() => {
    const state = store.getState();
    const pending = selectPendingTasks(state).filter((t) => t.type === "image");
    const active = selectActiveTasks(state).filter(
      (t) => t.type === "image" && t.status === "running"
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

  const input = task.input as unknown as ImageGenerateInput;

  try {
    const isEdit = input.mode === "edit";
    const endpoint = input.endpoint ?? (isEdit ? API_PATH_IMAGE_EDIT : API_PATH_IMAGE);

    // Newlines/control chars break the Java backend's hand-built JSON to
    // fal — strip them here before the request leaves the client.
    const prompt = sanitizePrompt(input.prompt);

    const response = isEdit
      ? await backendApi.post<string | string[]>(endpoint, {
          data: {
            shotId: input.shotId,
            shotColumnId: input.shotColumnId,
            prompt,
            images: input.images ?? [],
            model: input.model || undefined,
            size: input.size || undefined,
            n: 1,
            promptExtend: input.promptExtend ?? true,
            watermark: input.watermark ?? false,
          },
          timeout: 360_000,
        })
      : await backendApi.post<string>(endpoint, {
          data: {
            shotId: input.shotId,
            shotColumnId: input.shotColumnId,
            prompt,
            referenceImageUrl: input.referenceImageUrl || undefined,
            model: input.model || undefined,
            size: input.size || undefined,
            watermark: input.watermark ?? false,
          },
          timeout: 360_000,
        });

    const storagePath = Array.isArray(response)
      ? String(response[0] ?? "")
      : typeof response === "string"
        ? response
        : "";
    const url = buildOssUrl(storagePath);

    const output: TaskOutput = { url, storagePath };
    store.dispatch(completeTask({ taskId, output }));
  } catch (err) {
    // Preserve the full upstream payload when present so the UI can
    // hover-reveal the entire backend response, not just a short
    // summary line.
    let msg: string;
    if (err instanceof ApiRequestError) {
      msg = err.responseBody?.trim() || `${err.message} (code=${err.code}, status=${err.status})`;
    } else if (err instanceof Error) {
      msg = err.message;
    } else {
      msg = "Generation failed";
    }
    store.dispatch(failTask({ taskId, error: msg }));
  }
}

// ─── Public API ────────────────────────────────────────

/**
 * Submit an image generation task.
 * Creates a task in useTaskStore and starts the queue processor.
 */
export function submitImageTask(input: ImageGenerateInput): string {
  const taskId = createTaskId();
  store.dispatch(
    addTask({
      id: taskId,
      type: "image",
      shotId: input.shotId,
      shotColumnId: input.shotColumnId,
      input: input as unknown as Record<string, unknown>,
    })
  );

  startProcessor();
  return taskId;
}

/**
 * Retry a failed image task.
 * Resets the task to pending and restarts the processor.
 */
export function retryImageTask(taskId: string): void {
  store.dispatch(retryTask(taskId));
  startProcessor();
}
