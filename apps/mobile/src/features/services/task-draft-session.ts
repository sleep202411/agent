import { getAuthGeneration } from "@/auth/auth-store";
import { createTask, taskCreateInput } from "./task-create-api";
import { fetchTaskCommentAccess } from "./task-comment-api";
export type TaskDraftInput = ReturnType<typeof taskCreateInput.parse>;
export type TaskDraftReview = { context: string[]; assignees: string[]; customFields: string[] };
export type TaskDraft = {
  id: number;
  input: TaskDraftInput;
  review: TaskDraftReview;
  state: "staged" | "creating" | "created" | "uncertain";
  taskId?: string;
  error?: string;
};
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
  const change = (id: number, patch: Partial<TaskDraft>) =>
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
            const result = await createTask(crewId, row.input);
            if (!current()) break;
            // Keep the receipt if the screen backgrounded while this write was in flight.
            change(row.id, { state: "created", taskId: result.id });
          } catch (cause) {
            if (current())
              change(row.id, {
                state: "uncertain",
                error: cause instanceof Error ? cause.message : String(cause),
              });
            break; // No idempotency contract: never retry an uncertain creation.
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
