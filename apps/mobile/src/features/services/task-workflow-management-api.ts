import { z } from "zod";
import { api } from "@/lib/api-client";
import { getAuthGeneration } from "@/auth/auth-store";
import { fetchTaskCommentAccess } from "./task-comment-api";

export const workflowSemantic = z.enum([
  "open",
  "in_progress",
  "submitted",
  "revision_requested",
  "approved",
  "cancelled",
]);
export const workflowSettings = z
  .object({
    name: z.string().trim().min(1).max(80),
    color: z
      .string()
      .trim()
      .regex(/^#[0-9a-fA-F]{6}$/)
      .transform((v) => v.toUpperCase()),
  })
  .strict();
export const workflowCreation = workflowSettings.extend({
  semantic: workflowSemantic,
  afterStateId: z.string().uuid().nullable(),
});
export const managedWorkflow = workflowSettings
  .extend({
    id: z.string().uuid(),
    crewId: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/),
    semantic: workflowSemantic,
    systemKey: z.string().nullable(),
    archived: z.boolean(),
    position: z.number().int().nonnegative(),
    version: z.number().int().positive(),
    taskCount: z.number().int().nonnegative().optional(),
  })
  .strip();
export type ManagedWorkflow = z.infer<typeof managedWorkflow>;
export type WorkflowCreation = z.infer<typeof workflowCreation>;
function current(generation: number, signal?: AbortSignal) {
  if (generation !== getAuthGeneration() || signal?.aborted)
    throw new Error("Workflow session expired or request cancelled.");
}
async function authorize(crewId: string, userId: string, generation: number, signal: AbortSignal) {
  managedWorkflow.shape.crewId.parse(crewId);
  current(generation, signal);
  const access = await fetchTaskCommentAccess(crewId, userId, signal);
  current(generation, signal);
  if (!access.canManage) throw new Error("Task management permission is required.");
}
function scoped(value: unknown, crewId: string) {
  const rows = z.array(managedWorkflow).parse(value);
  if (rows.some((r) => r.crewId !== crewId) || new Set(rows.map((r) => r.id)).size !== rows.length)
    throw new Error("Workflow scope mismatch.");
  return rows;
}
export async function fetchManagedWorkflows(
  crewId: string,
  userId: string,
  generation: number,
  signal: AbortSignal
) {
  await authorize(crewId, userId, generation, signal);
  const project = z
    .object({ workflowStates: z.unknown() })
    .parse(await api.get(`/crews/${crewId}/task-project`, { service: "aurora", signal }));
  current(generation, signal);
  const rows = scoped(project.workflowStates, crewId);
  if (rows.some((r) => r.taskCount === undefined))
    throw new Error("Workflow task counts are missing. Refresh the project.");
  return rows;
}
function verify(ok: boolean) {
  if (!ok) throw new Error("Workflow change could not be verified. Refresh before trying again.");
}
export async function createManagedWorkflow(
  crewId: string,
  userId: string,
  generation: number,
  value: WorkflowCreation
) {
  const input = workflowCreation.parse(value);
  const rows = await fetchManagedWorkflows(
    crewId,
    userId,
    generation,
    new AbortController().signal
  );
  if (rows.filter((r) => !r.archived).length >= 24)
    throw new Error("A workflow can contain up to 24 active columns.");
  if (rows.some((r) => r.name.toLowerCase() === input.name.toLowerCase()))
    throw new Error("A workflow column with this name already exists.");
  const after = rows.find((r) => r.id === input.afterStateId && !r.archived);
  if (input.afterStateId && !after) throw new Error("Insertion column is no longer available.");
  current(generation);
  const result = managedWorkflow.parse(
    await api.post(`/crews/${crewId}/task-workflow-states`, { service: "aurora", data: input })
  );
  current(generation);
  verify(
    result.crewId === crewId &&
      !rows.some((r) => r.id === result.id) &&
      !result.archived &&
      result.systemKey === null &&
      result.name === input.name &&
      result.color === input.color &&
      result.semantic === input.semantic
  );
  return result;
}
export async function updateManagedWorkflow(
  snapshot: ManagedWorkflow,
  userId: string,
  generation: number,
  value: z.infer<typeof workflowSettings>
) {
  const state = managedWorkflow.parse(snapshot),
    input = workflowSettings.parse(value);
  const changes = Object.fromEntries(
    Object.entries(input).filter(([k, v]) => state[k as keyof typeof input] !== v)
  );
  current(generation);
  if (!Object.keys(changes).length) return state;
  await authorize(state.crewId, userId, generation, new AbortController().signal);
  return patch(state, generation, changes);
}
async function patch(
  state: ManagedWorkflow,
  generation: number,
  changes: { name?: string; color?: string; archived?: boolean; replacementStateId?: string }
) {
  current(generation);
  const result = managedWorkflow.parse(
    await api.patch(`/crew-task-workflow-states/${state.id}`, {
      service: "aurora",
      data: { ...changes, expectedVersion: state.version },
    })
  );
  current(generation);
  verify(
    result.id === state.id &&
      result.crewId === state.crewId &&
      result.version === state.version + 1 &&
      result.semantic === state.semantic &&
      result.systemKey === state.systemKey &&
      result.name === (changes.name ?? state.name) &&
      result.color === (changes.color ?? state.color) &&
      result.archived === (changes.archived ?? state.archived)
  );
  return result;
}
export async function setWorkflowArchived(
  snapshot: ManagedWorkflow,
  userId: string,
  generation: number,
  archived: boolean,
  replacementStateId?: string
) {
  const state = managedWorkflow.parse(snapshot);
  if (archived === state.archived) throw new Error("Workflow already has this archive state.");
  const rows = await fetchManagedWorkflows(
    state.crewId,
    userId,
    generation,
    new AbortController().signal
  );
  const fresh = rows.find((r) => r.id === state.id);
  if (!fresh || fresh.version !== state.version)
    throw new Error("Workflow changed. Refresh before continuing.");
  const active = rows.filter((r) => !r.archived);
  if (archived && active.length <= 1) throw new Error("Keep at least one active workflow column.");
  if (!archived && active.length >= 24)
    throw new Error("A workflow can contain up to 24 active columns.");
  if (archived && ((fresh.taskCount ?? 0) > 0 || replacementStateId)) {
    if (
      !active.some(
        (r) => r.id === replacementStateId && r.id !== state.id && r.semantic === state.semantic
      )
    )
      throw new Error("Choose an active replacement column with the same workflow status.");
  }
  return patch(state, generation, {
    archived,
    ...(archived && replacementStateId ? { replacementStateId } : {}),
  });
}
export async function reorderManagedWorkflows(
  crewId: string,
  userId: string,
  generation: number,
  ordered: ManagedWorkflow[]
) {
  const rows = scoped(ordered, crewId);
  if (!rows.length || rows.length > 24 || rows.some((r) => r.archived))
    throw new Error("Order must contain all active workflow columns.");
  await authorize(crewId, userId, generation, new AbortController().signal);
  const result = scoped(
    await api.post(`/crews/${crewId}/task-workflow-states/reorder`, {
      service: "aurora",
      data: { states: rows.map((r) => ({ id: r.id, expectedVersion: r.version })) },
    }),
    crewId
  );
  current(generation);
  const active = result.filter((r) => !r.archived);
  verify(
    active.length === rows.length &&
      rows.every((r, i) => {
        const saved = active.find((s) => s.id === r.id);
        return (
          !!saved &&
          saved.position === i &&
          saved.version === r.version + 1 &&
          saved.name === r.name &&
          saved.color === r.color &&
          saved.semantic === r.semantic &&
          saved.systemKey === r.systemKey
        );
      })
  );
  return result;
}
export async function deleteManagedWorkflow(
  snapshot: ManagedWorkflow,
  userId: string,
  generation: number
) {
  const state = managedWorkflow.parse(snapshot);
  if (state.systemKey !== null || !state.archived)
    throw new Error("Only archived custom workflow columns can be deleted.");
  const rows = await fetchManagedWorkflows(
    state.crewId,
    userId,
    generation,
    new AbortController().signal
  );
  const fresh = rows.find((r) => r.id === state.id);
  if (!fresh || fresh.version !== state.version || !fresh.archived || fresh.systemKey !== null)
    throw new Error("Workflow changed. Refresh before deleting.");
  if (fresh.taskCount !== 0) throw new Error("This column still contains tasks.");
  current(generation);
  // DELETE has no version parameter. The server rechecks all task references, including deleted tasks.
  await api.delete(`/crew-task-workflow-states/${state.id}`, { service: "aurora" });
  current(generation);
}
