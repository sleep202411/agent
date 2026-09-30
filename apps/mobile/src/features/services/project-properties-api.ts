import { z } from "zod";
import { api } from "@/lib/api-client";
import { getAuthGeneration } from "@/auth/auth-store";
import { fetchCrewMemberPage, type CrewMember } from "./crew-members-api";
const id = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);
export const projectStatuses = [
  "backlog",
  "planned",
  "in_progress",
  "completed",
  "cancelled",
] as const;
export const projectPriorities = ["low", "normal", "high", "urgent"] as const;
export const projectGranularities = ["day", "month", "quarter", "half_year", "year"] as const;
const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((v) => {
    const d = new Date(`${v}T00:00:00Z`);
    return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === v;
  }, "Enter a real calendar date as YYYY-MM-DD.");
const fields = z.object({
  status: z.enum(projectStatuses),
  priority: z.enum(projectPriorities).nullable(),
  leadMemberId: id.nullable(),
  startDate: date.nullable(),
  startDateGranularity: z.enum(projectGranularities),
  targetDate: date.nullable(),
  targetDateGranularity: z.enum(projectGranularities),
});
function validDates(v: z.infer<typeof fields>) {
  for (const key of ["start", "target"] as const) {
    const value = v[`${key}Date`],
      g = v[`${key}DateGranularity`];
    if (!value || g === "day") continue;
    const [, month, day] = value.split("-").map(Number);
    if (
      day !== 1 ||
      (g === "quarter" && (month! - 1) % 3 !== 0) ||
      (g === "half_year" && month !== 1 && month !== 7) ||
      (g === "year" && month !== 1)
    )
      return false;
  }
  if (v.startDate && v.targetDate) {
    const end = new Date(`${v.targetDate}T00:00:00Z`);
    const g = v.targetDateGranularity;
    if (g !== "day") {
      end.setUTCMonth(end.getUTCMonth() + { month: 1, quarter: 3, half_year: 6, year: 12 }[g]);
      end.setUTCDate(0);
    }
    if (end.getTime() < Date.parse(`${v.startDate}T00:00:00Z`)) return false;
  }
  return true;
}
export const projectValues = fields
  .extend({
    labelIds: z
      .array(z.string().uuid())
      .max(100)
      .refine((v) => new Set(v).size === v.length),
  })
  .strict()
  .refine(
    validDates,
    "Dates must align with their periods, and the target period cannot end before the start date."
  );
export type ProjectValues = z.infer<typeof projectValues>;
const project = fields.extend({ crewId: id, version: z.number().int().positive() });
const label = z.object({ id: z.string().uuid(), crewId: id, name: z.string(), color: z.string() });
const resultSchema = z.object({ project, labels: z.array(label) });
const overviewSchema = resultSchema.extend({
  labelOptions: z.array(label),
  capabilities: z.object({ manage: z.boolean() }),
});
export type ProjectSnapshot = z.infer<typeof resultSchema>;
export type ProjectContext = z.infer<typeof overviewSchema> & {
  members: CrewMember[];
  canChooseLead: boolean;
};
function current(generation: number, signal?: AbortSignal) {
  if (getAuthGeneration() !== generation || signal?.aborted)
    throw new Error("Project session expired or request cancelled.");
}
async function access(crewId: string, userId: string, generation: number, signal: AbortSignal) {
  id.parse(crewId);
  current(generation, signal);
  const v = z
    .object({ userId: z.string(), permissions: z.array(z.string()) })
    .parse(await api.get(`/crews/${crewId}/members/me`, { service: "aurora", signal }));
  current(generation, signal);
  if (v.userId !== userId) throw new Error("Crew membership account mismatch.");
  if (!v.permissions.includes("production.view")) throw new Error("Production access is required.");
  return v.permissions;
}
function scoped(v: ProjectSnapshot, crewId: string) {
  if (
    v.project.crewId !== crewId ||
    v.labels.some((l) => l.crewId !== crewId) ||
    new Set(v.labels.map((l) => l.id)).size !== v.labels.length
  )
    throw new Error("Project scope mismatch.");
  return v;
}
export function valuesOf(v: ProjectSnapshot): ProjectValues {
  const { crewId: _crewId, version: _version, ...values } = v.project;
  return { ...values, labelIds: v.labels.map((l) => l.id) };
}
export function projectChanges(before: ProjectSnapshot, value: ProjectValues) {
  const data = projectValues.parse(value),
    old = valuesOf(before);
  return Object.fromEntries(
    Object.entries(data).filter(([key, v]) =>
      key === "labelIds"
        ? [...data.labelIds].sort().join() !== [...old.labelIds].sort().join()
        : old[key as keyof ProjectValues] !== v
    )
  ) as Partial<ProjectValues>;
}
export async function fetchProjectProperties(
  crewId: string,
  userId: string,
  generation: number,
  signal: AbortSignal
): Promise<ProjectContext> {
  const permissions = await access(crewId, userId, generation, signal);
  const data = overviewSchema.parse(
    await api.get(`/crews/${crewId}/production-overview`, { service: "aurora", signal })
  );
  current(generation, signal);
  scoped(data, crewId);
  if (
    data.labelOptions.some((l) => l.crewId !== crewId) ||
    new Set(data.labelOptions.map((l) => l.id)).size !== data.labelOptions.length
  )
    throw new Error("Project label scope mismatch.");
  const members: CrewMember[] = [];
  const seen = new Set<string>();
  let cursor: string | null = null;
  const canChooseLead = permissions.includes("members.view");
  if (canChooseLead)
    do {
      const page = await fetchCrewMemberPage(crewId, userId, generation, cursor, signal);
      if (page.items.some((m) => members.some((old) => old.id === m.id || old.userId === m.userId)))
        throw new Error("Crew members changed. Refresh the project.");
      members.push(...page.items);
      cursor = page.nextCursor;
      if (cursor && seen.has(cursor)) throw new Error("Crew member pagination did not advance.");
      if (cursor) seen.add(cursor);
    } while (cursor);
  current(generation, signal);
  return {
    ...data,
    capabilities: { manage: data.capabilities.manage && permissions.includes("production.manage") },
    members,
    canChooseLead,
  };
}
export async function updateProjectProperties(
  crewId: string,
  userId: string,
  generation: number,
  snapshot: ProjectSnapshot,
  value: ProjectValues
) {
  const before = resultSchema.parse(snapshot);
  scoped(before, crewId);
  const changes = projectChanges(before, value);
  if (!Object.keys(changes).length) throw new Error("No project properties changed.");
  const fresh = await fetchProjectProperties(
    crewId,
    userId,
    generation,
    new AbortController().signal
  );
  if (!fresh.capabilities.manage) throw new Error("Production management permission is required.");
  if (fresh.project.version !== before.project.version)
    throw new Error("Project changed. Refresh before saving.");
  if (
    changes.leadMemberId &&
    (!fresh.canChooseLead || !fresh.members.some((m) => m.id === changes.leadMemberId))
  )
    throw new Error("Select an active Crew member as project lead.");
  if (changes.labelIds?.some((id) => !fresh.labelOptions.some((l) => l.id === id)))
    throw new Error("A selected label is no longer available.");
  current(generation);
  const result = resultSchema.parse(
    await api.patch(`/crews/${crewId}/production-overview/properties`, {
      service: "aurora",
      data: { ...changes, expectedVersion: before.project.version },
    })
  );
  current(generation);
  scoped(result, crewId);
  if (
    result.project.version !== before.project.version + 1 ||
    Object.keys(projectChanges(result, value)).length
  )
    throw new Error("Project update could not be verified. Refresh before another attempt.");
  return result;
}
