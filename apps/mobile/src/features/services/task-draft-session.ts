import { isTaskRequestReceipt } from "./task-request-receipt";
import { assertTaskCreationRequired } from "./task-creation-required";
import { assertTaskCreationDeadline, TaskCreationDeadlineError } from "./task-creation-deadline";
import { taskWorkflowSchema } from "./task-workflow-api";
import { taskOption } from "./task-options";
import { taskMention } from "./task-mentions";
import { taskDraftStorage, type TaskDraftStorage } from "./task-draft-storage";
import { getAuthGeneration } from "@/auth/auth-store";
import { createTask, taskCreateInput } from "./task-create-api";
import { fetchTaskCommentAccess } from "./task-comment-api";
import {
  applyEpisodeTaskPlan,
  episodeTaskPlan,
  type EpisodeTaskPlan,
} from "./episode-task-template-api";
import { z } from "zod";
import {
  applyCanvasTaskImport,
  canvasTaskPreview,
  canvasScenes,
  type CanvasTaskPreview,
} from "./canvas-task-import-api";
export type TaskDraftInput = ReturnType<typeof taskCreateInput.parse>;
export type TaskDraftReview = z.infer<typeof reviewSchema>;
type DraftState = {
  id: number;
  state: "staged" | "creating" | "created" | "uncertain" | "submitted";
  taskId?: string;
  requestId?: string;
  taskIds?: string[];
  error?: string;
};
export type TaskDraft = DraftState &
  (
    | { kind: "task"; input: TaskDraftInput; review: TaskDraftReview }
    | { kind: "episode"; episodeId: string; title: string; plan: EpisodeTaskPlan }
    | { kind: "canvas"; preview: CanvasTaskPreview }
  );
type Snapshot = { drafts: TaskDraft[]; busy: boolean; error?: string; storageError?: string };
const stateSchema = z.object({
  id: z.number().int().positive(),
  state: z.enum(["staged", "creating", "created", "uncertain", "submitted"]),
  taskId: z.string().min(1).optional(),
  requestId: z.string().uuid().optional(),
  taskIds: z.array(z.string().min(1)).optional(),
  error: z.string().optional(),
});
const planningOption = z.object({ id: z.string().uuid(), name: z.string() });
const reviewSchema = z.object({
  context: z.array(z.string()),
  assignees: z.array(z.string()),
  customFields: z.array(z.string()),
  editor: z
    .object({
      planning: z.object({
        labels: z.array(planningOption),
        cycle: planningOption.nullable(),
        episode: planningOption.nullable(),
      }),
      workflow: taskWorkflowSchema.nullable(),
      parent: taskOption.nullable(),
      blockers: z.array(taskOption),
      assignees: z.array(taskMention),
    })
    .optional(),
});
const savedSchema = z.object({
  version: z.literal(1),
  drafts: z
    .array(
      z.union([
        stateSchema.extend({
          kind: z.literal("task"),
          input: taskCreateInput,
          review: reviewSchema,
        }),
        stateSchema.extend({
          kind: z.literal("episode"),
          episodeId: z.string().uuid(),
          title: z.string(),
          plan: episodeTaskPlan,
        }),
        stateSchema.extend({ kind: z.literal("canvas"), preview: canvasTaskPreview }),
      ])
    )
    .refine((rows) => new Set(rows.map((row) => row.id)).size === rows.length),
});
/** Durable account/Crew queue; auth generations never share live operations. */
export function createTaskDraftSession(
  crewId: string,
  userId: string,
  generation: number,
  storage: TaskDraftStorage = taskDraftStorage(crewId, userId)
) {
  let snapshot: Snapshot = { drafts: [], busy: false },
    sequence = 0;
  let unreadable = false;
  const restore = () => {
    try {
      const raw = storage.read();
      if (raw !== null) {
        const saved = savedSchema.parse(JSON.parse(raw));
        if (saved.drafts.some((row) => row.kind === "canvas" && row.preview.crewId !== crewId))
          throw new Error("Task draft scope mismatch");
        snapshot.drafts = saved.drafts.map((row) =>
          row.state === "creating"
            ? { ...row, state: row.kind === "task" ? "uncertain" : "staged" }
            : row
        );
        sequence = Math.max(0, ...snapshot.drafts.map((row) => row.id));
      }
      unreadable = false;
      snapshot.storageError = undefined;
    } catch (cause) {
      unreadable = true;
      snapshot.storageError = cause instanceof Error ? cause.message : String(cause);
    }
  };
  restore();
  const listeners = new Set<() => void>();
  const current = () => generation === getAuthGeneration();
  const update = (next: Snapshot) => {
    snapshot = next;
    listeners.forEach((fn) => fn());
  };
  const persist = () => {
    if (unreadable) return false;
    try {
      storage.write(JSON.stringify({ version: 1, drafts: snapshot.drafts }));
      if (snapshot.storageError) update({ ...snapshot, storageError: undefined });
      return true;
    } catch (cause) {
      update({ ...snapshot, storageError: cause instanceof Error ? cause.message : String(cause) });
      return false;
    }
  };
  const change = (id: number, patch: Partial<DraftState>) =>
    update({
      ...snapshot,
      drafts: snapshot.drafts.map((row) => (row.id === id ? { ...row, ...patch } : row)),
    });
  return {
    getSnapshot: () => snapshot,
    save: () => {
      if (!current() || snapshot.busy) return false;
      if (unreadable) {
        restore();
        update({ ...snapshot });
        return !unreadable;
      }
      return persist();
    },
    edit(id: number, input: TaskDraftInput, review: TaskDraftReview) {
      if (!current() || snapshot.busy || unreadable) return false;
      const row = snapshot.drafts.find((row) => row.id === id);
      if (!row || row.kind !== "task" || row.state !== "staged") return false;
      update({
        ...snapshot,
        drafts: snapshot.drafts.map((row) =>
          row.id === id
            ? { ...row, input: taskCreateInput.parse(input), review: reviewSchema.parse(review) }
            : row
        ),
      });
      return persist();
    },
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    stage(input: TaskDraftInput, review: TaskDraftReview) {
      if (!current() || snapshot.busy || unreadable) return false;
      update({
        ...snapshot,
        error: undefined,
        drafts: [
          ...snapshot.drafts,
          {
            id: ++sequence,
            kind: "task",
            input: taskCreateInput.parse(input),
            review: reviewSchema.parse(review),
            state: "staged",
          },
        ],
      });
      return persist();
    },
    stageEpisode(episodeId: string, title: string, plan: EpisodeTaskPlan) {
      if (!current() || snapshot.busy || unreadable) return false;
      z.string().uuid().parse(episodeId);
      const parsed = episodeTaskPlan.parse(plan);
      // A retry must retain the original versioned command. Never replace a queued batch.
      if (snapshot.drafts.some((row) => row.kind === "episode" && row.episodeId === episodeId))
        return false;
      update({
        ...snapshot,
        error: undefined,
        drafts: [
          ...snapshot.drafts,
          {
            id: ++sequence,
            kind: "episode",
            episodeId,
            title,
            plan: parsed,
            state: "staged",
          },
        ],
      });
      return persist();
    },
    stageCanvas(preview: CanvasTaskPreview) {
      if (!current() || snapshot.busy || unreadable) return false;
      const parsed = canvasTaskPreview.parse(preview);
      if (parsed.crewId !== crewId) throw new Error("Canvas import scope mismatch");
      const count = canvasScenes(parsed).length;
      if (!count || count > 200) throw new Error("Import requires between 1 and 200 scenes.");
      if (
        snapshot.drafts.some(
          (row) => row.kind === "canvas" && row.preview.projectId === parsed.projectId
        )
      )
        return false;
      update({
        ...snapshot,
        error: undefined,
        drafts: [
          ...snapshot.drafts,
          { id: ++sequence, kind: "canvas", preview: parsed, state: "staged" },
        ],
      });
      return persist();
    },
    remove(id: number) {
      if (!current() || snapshot.busy || unreadable) return false;
      update({ ...snapshot, drafts: snapshot.drafts.filter((row) => row.id !== id) });
      return persist();
    },
    async createAll(isActive: () => boolean) {
      if (
        !current() ||
        !isActive() ||
        snapshot.busy ||
        snapshot.storageError ||
        snapshot.drafts.some((row) => row.state === "uncertain")
      )
        return;
      const staged = snapshot.drafts.filter((row) => row.state === "staged");
      if (!staged.length) return;
      update({ ...snapshot, busy: true, error: undefined });
      try {
        for (const row of staged) {
          if (!current() || !isActive()) break;
          const access = await fetchTaskCommentAccess(crewId, userId, new AbortController().signal);
          if (!current() || !isActive()) break;
          if (!access.canSubmit) throw new Error("Active project membership is required.");
          if (row.kind === "task") {
            assertTaskCreationRequired(row.input);
            assertTaskCreationDeadline(row.input.dueAt);
          }
          change(row.id, { state: "creating" });
          if (!persist()) {
            change(row.id, { state: "staged" });
            break;
          }
          try {
            if (row.kind === "canvas") {
              const result = await applyCanvasTaskImport(crewId, row.preview, generation);
              if (!current()) break;
              change(
                row.id,
                isTaskRequestReceipt(result)
                  ? { state: "submitted", requestId: result.requestId, error: undefined }
                  : { state: "created", taskIds: result.taskIds, error: undefined }
              );
              if (!persist()) break;
              continue;
            }
            if (row.kind === "episode") {
              const result = await applyEpisodeTaskPlan(
                crewId,
                row.episodeId,
                row.plan,
                generation
              );
              if (!current()) break;
              change(
                row.id,
                isTaskRequestReceipt(result)
                  ? { state: "submitted", requestId: result.requestId, error: undefined }
                  : { state: "created", taskIds: result.taskIds, error: undefined }
              );
              if (!persist()) break;
              continue;
            }
            const result = await createTask(crewId, row.input);
            if (!current()) break;
            // Keep the receipt if the screen backgrounded while this write was in flight.
            change(
              row.id,
              isTaskRequestReceipt(result)
                ? { state: "submitted", requestId: result.requestId }
                : { state: "created", taskId: result.id }
            );
            if (!persist()) break;
          } catch (cause) {
            if (current())
              change(row.id, {
                state:
                  row.kind !== "task" || cause instanceof TaskCreationDeadlineError
                    ? "staged"
                    : "uncertain",
                error: cause instanceof Error ? cause.message : String(cause),
              });
            if (current()) persist();
            break; // Episode commands are replayable; single-task writes are not.
          }
        }
      } catch (cause) {
        if (current())
          update({ ...snapshot, error: cause instanceof Error ? cause.message : String(cause) });
      } finally {
        update({ ...snapshot, busy: false });
      }
    },
  };
}
let cachedGeneration: number | undefined;
const sessions = new Map<string, ReturnType<typeof createTaskDraftSession>>();
export function getTaskDraftSession(crewId: string, userId: string, generation: number) {
  if (generation !== getAuthGeneration()) throw new Error("Task draft session expired");
  if (cachedGeneration !== generation) {
    sessions.clear();
    cachedGeneration = generation;
  }
  const key = JSON.stringify([crewId, userId]);
  let session = sessions.get(key);
  if (!session) {
    session = createTaskDraftSession(crewId, userId, generation);
    sessions.set(key, session);
  }
  return session;
}
