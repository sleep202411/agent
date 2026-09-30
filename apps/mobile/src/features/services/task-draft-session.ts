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
export type TaskDraftReview = { context: string[]; assignees: string[]; customFields: string[] };
type DraftState = {
  id: number;
  state: "staged" | "creating" | "created" | "uncertain";
  taskId?: string;
  taskIds?: string[];
  error?: string;
};
export type TaskDraft = DraftState &
  (
    | { kind: "task"; input: TaskDraftInput; review: TaskDraftReview }
    | { kind: "episode"; episodeId: string; title: string; plan: EpisodeTaskPlan }
    | { kind: "canvas"; preview: CanvasTaskPreview }
  );
type Snapshot = { drafts: TaskDraft[]; busy: boolean; error?: string };
/** Memory-only working drafts. Account generations never share a queue. */
export function createTaskDraftSession(crewId: string, userId: string, generation: number) {
  let snapshot: Snapshot = { drafts: [], busy: false },
    sequence = 0;
  const listeners = new Set<() => void>();
  const current = () => generation === getAuthGeneration();
  const update = (next: Snapshot) => {
    snapshot = next;
    listeners.forEach((fn) => fn());
  };
  const change = (id: number, patch: Partial<DraftState>) =>
    update({
      ...snapshot,
      drafts: snapshot.drafts.map((row) => (row.id === id ? { ...row, ...patch } : row)),
    });
  return {
    getSnapshot: () => snapshot,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    stage(input: TaskDraftInput, review: TaskDraftReview) {
      if (!current() || snapshot.busy) return;
      update({
        ...snapshot,
        error: undefined,
        drafts: [
          ...snapshot.drafts,
          {
            id: ++sequence,
            kind: "task",
            input: taskCreateInput.parse(input),
            review: {
              context: [...review.context],
              assignees: [...review.assignees],
              customFields: [...review.customFields],
            },
            state: "staged",
          },
        ],
      });
    },
    stageEpisode(episodeId: string, title: string, plan: EpisodeTaskPlan) {
      if (!current() || snapshot.busy) return false;
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
      return true;
    },
    stageCanvas(preview: CanvasTaskPreview) {
      if (!current() || snapshot.busy) return false;
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
      return true;
    },
    remove(id: number) {
      if (!current() || snapshot.busy) return;
      update({ ...snapshot, drafts: snapshot.drafts.filter((row) => row.id !== id) });
    },
    async createAll(isActive: () => boolean) {
      if (
        !current() ||
        !isActive() ||
        snapshot.busy ||
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
          if (!access.canManage) throw new Error("Task management permission is required.");
          change(row.id, { state: "creating" });
          try {
            if (row.kind === "canvas") {
              const result = await applyCanvasTaskImport(crewId, row.preview, generation);
              if (!current()) break;
              change(row.id, { state: "created", taskIds: result.taskIds, error: undefined });
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
              change(row.id, { state: "created", taskIds: result.taskIds, error: undefined });
              continue;
            }
            const result = await createTask(crewId, row.input);
            if (!current()) break;
            // Keep the receipt if the screen backgrounded while this write was in flight.
            change(row.id, { state: "created", taskId: result.id });
          } catch (cause) {
            if (current())
              change(row.id, {
                state: row.kind !== "task" ? "staged" : "uncertain",
                error: cause instanceof Error ? cause.message : String(cause),
              });
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
