import { z } from "zod";
import { api } from "@/lib/api-client";
import { getAuthGeneration } from "@/auth/auth-store";
import { fetchTaskCommentAccess } from "./task-comment-api";
export function cycleDateText(value: string) {
  const d = new Date(value),
    pad = (n: number) => String(n).padStart(2, "0");
  return `${String(d.getFullYear()).padStart(4, "0")}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
export function parseCycleDate(value: string, end: boolean, original?: string) {
  if (original && value === cycleDateText(original)) return original;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error("Enter a date as YYYY-MM-DD.");
  const date = new Date(`${value}T${end ? "23:59:59.999" : "00:00:00"}`);
  if (!Number.isFinite(date.getTime()) || cycleDateText(date.toISOString()) !== value)
    throw new Error("Invalid cycle date.");
  return date.toISOString();
}
const settings = z
  .object({
    name: z.string().trim().min(1).max(100),
    goal: z.string().trim().max(2000),
    startAt: z.string().datetime({ offset: true }),
    endAt: z.string().datetime({ offset: true }),
    status: z.enum(["planned", "active", "completed", "cancelled"]),
  })
  .strict();
const validRange = (v: { startAt: string; endAt: string }) =>
  Date.parse(v.endAt) > Date.parse(v.startAt);
export const cycleSettings = settings.refine(validRange, "Cycle end must be after its start.");
export const cycleCreateInput = settings
  .omit({ status: true })
  .refine(validRange, "Cycle end must be after its start.");
export type CycleSettings = z.infer<typeof cycleSettings>;
export type CycleCreateInput = z.infer<typeof cycleCreateInput>;
export const managedCycle = settings
  .extend({
    id: z.string().uuid(),
    crewId: z.string().min(1).max(64),
    number: z.number().int().positive(),
    updatedAt: z.string().datetime({ offset: true }),
  })
  .strip()
  .refine(validRange, "Cycle dates are inconsistent.");
export type ManagedCycle = z.infer<typeof managedCycle>;
function current(generation: number) {
  if (generation !== getAuthGeneration()) throw new Error("Task cycle session expired");
}
async function authorize(crewId: string, userId: string, generation: number, signal: AbortSignal) {
  z.string()
    .regex(/^[A-Za-z0-9_-]{1,64}$/)
    .parse(crewId);
  current(generation);
  const access = await fetchTaskCommentAccess(crewId, userId, signal);
  current(generation);
  if (signal.aborted) throw new Error("Task cycle request cancelled");
  if (!access.canManage) throw new Error("Task management permission is required.");
}
export async function fetchManagedCycles(
  crewId: string,
  userId: string,
  generation: number,
  signal: AbortSignal
) {
  await authorize(crewId, userId, generation, signal);
  const { cycles } = z
    .object({ cycles: z.array(managedCycle) })
    .parse(await api.get(`/crews/${crewId}/task-project`, { service: "aurora", signal }));
  current(generation);
  if (signal.aborted) throw new Error("Task cycle request cancelled");
  if (
    cycles.some((row) => row.crewId !== crewId) ||
    new Set(cycles.map((row) => row.id)).size !== cycles.length ||
    new Set(cycles.map((row) => row.number)).size !== cycles.length
  )
    throw new Error("Task cycle scope mismatch");
  return cycles;
}
function same(key: string, a: string, b: string) {
  return key === "startAt" || key === "endAt" ? Date.parse(a) === Date.parse(b) : a === b;
}
export function cycleChanges(cycle: ManagedCycle, value: CycleSettings) {
  const input = cycleSettings.parse(value);
  return Object.fromEntries(
    Object.entries(input).filter(([key, v]) => !same(key, v, cycle[key as keyof CycleSettings]))
  ) as Partial<CycleSettings>;
}
export async function createTaskCycle(
  crewId: string,
  userId: string,
  generation: number,
  value: CycleCreateInput
) {
  const input = cycleCreateInput.parse(value);
  const cycles = await fetchManagedCycles(crewId, userId, generation, new AbortController().signal);
  current(generation);
  const result = managedCycle.parse(
    await api.post(`/crews/${crewId}/task-cycles`, { service: "aurora", data: input })
  );
  current(generation);
  if (
    result.crewId !== crewId ||
    cycles.some((row) => row.id === result.id || row.number === result.number) ||
    Object.keys(cycleChanges(result, { ...input, status: "planned" })).length
  )
    throw new Error(
      "Task cycle creation could not be verified. Refresh the list before trying again."
    );
  return result;
}
export async function updateTaskCycle(
  snapshot: ManagedCycle,
  userId: string,
  generation: number,
  value: CycleSettings
) {
  const cycle = managedCycle.parse(snapshot),
    changes = cycleChanges(cycle, value);
  current(generation);
  if (!Object.keys(changes).length) return cycle;
  await authorize(cycle.crewId, userId, generation, new AbortController().signal);
  // The server checks the captured version and enforces one active cycle under a Crew lock.
  const result = managedCycle.parse(
    await api.patch(`/crew-task-cycles/${cycle.id}`, {
      service: "aurora",
      data: { ...changes, expectedUpdatedAt: cycle.updatedAt },
    })
  );
  current(generation);
  if (
    result.id !== cycle.id ||
    result.crewId !== cycle.crewId ||
    result.number !== cycle.number ||
    result.updatedAt === cycle.updatedAt ||
    Object.entries(changes).some(([key, v]) => !same(key, result[key as keyof CycleSettings], v!))
  )
    throw new Error(
      "Task cycle update could not be verified. Refresh the list before trying again."
    );
  return result;
}
export async function deleteTaskCycle(snapshot: ManagedCycle, userId: string, generation: number) {
  const cycle = managedCycle.parse(snapshot);
  const cycles = await fetchManagedCycles(
    cycle.crewId,
    userId,
    generation,
    new AbortController().signal
  );
  const fresh = cycles.find((row) => row.id === cycle.id);
  const { name, goal, startAt, endAt, status } = cycle;
  if (
    !fresh ||
    fresh.number !== cycle.number ||
    fresh.updatedAt !== cycle.updatedAt ||
    Object.keys(cycleChanges(fresh, { name, goal, startAt, endAt, status })).length
  )
    throw new Error("Task cycle changed. Refresh and review it before deleting.");
  current(generation);
  // DELETE has no version parameter. Server clears task links and view filters atomically.
  await api.delete(`/crew-task-cycles/${cycle.id}`, { service: "aurora" });
  current(generation);
}
