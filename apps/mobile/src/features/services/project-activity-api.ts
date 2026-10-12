import { z } from "zod";
import { api } from "@/lib/api-client";
import { getAuthGeneration } from "@/auth/auth-store";
import {
  CrewProductionActivityContentSchema,
  CrewProductionDocumentSchema,
  productionDocumentPlainText,
} from "./production-document-schema";
export const projectHealth = ["on_track", "at_risk", "off_track"] as const;
export const projectActivity = z.object({
  id: z.string().uuid(),
  crewId: z.string().min(1),
  kind: z.enum([
    "comment",
    "update",
    "project_created",
    "properties_changed",
    "labels_changed",
    "resource_added",
    "resource_removed",
  ]),
  health: z.enum(projectHealth).nullable(),
  content: CrewProductionDocumentSchema.nullable(),
  plainText: z.string(),
  progress: z.number().int().min(0).max(100).nullable(),
  payload: z.unknown(),
  createdByUserId: z.string().min(1),
  createdAt: z.string().datetime(),
});
export type ProjectActivity = z.infer<typeof projectActivity>;
export const projectActivityInput = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("comment"), content: CrewProductionActivityContentSchema }).strict(),
  z
    .object({
      kind: z.literal("update"),
      health: z.enum(projectHealth),
      content: CrewProductionActivityContentSchema,
      progress: z.number().int().min(0).max(100).nullable().optional(),
    })
    .strict(),
]);
export type ProjectActivityInput = z.infer<typeof projectActivityInput>;
function path(crewId: string) {
  z.string()
    .regex(/^[A-Za-z0-9_-]{1,64}$/)
    .parse(crewId);
  return `/crews/${encodeURIComponent(crewId)}`;
}
function current(generation: number, signal?: AbortSignal) {
  if (generation !== getAuthGeneration() || signal?.aborted)
    throw new Error("Project activity session expired");
}
export async function fetchProjectActivityAccess(
  crewId: string,
  userId: string,
  generation: number,
  signal: AbortSignal
) {
  current(generation, signal);
  const membership = z
    .object({ userId: z.string(), permissions: z.array(z.string()) })
    .parse(await api.get(`${path(crewId)}/members/me`, { service: "aurora", signal }));
  current(generation, signal);
  if (membership.userId !== userId) throw new Error("Crew membership account mismatch");
  return {
    view: membership.permissions.includes("production.view"),
    manage: membership.permissions.includes("production.manage"),
  };
}
export async function fetchProjectActivityPage(
  crewId: string,
  generation: number,
  cursor: string | null,
  signal: AbortSignal
) {
  current(generation, signal);
  if (cursor !== null) z.string().uuid().parse(cursor);
  const result = z
    .object({ items: z.array(projectActivity), nextCursor: z.string().uuid().nullable() })
    .parse(
      await api.get(`${path(crewId)}/production-activity`, {
        service: "aurora",
        signal,
        params: { limit: 30, ...(cursor ? { cursor } : {}) },
      })
    );
  current(generation, signal);
  if (result.items.some((row) => row.crewId !== crewId))
    throw new Error("Project activity scope mismatch");
  if (new Set(result.items.map((row) => row.id)).size !== result.items.length)
    throw new Error("Duplicate project activity");
  if (
    result.nextCursor &&
    (result.nextCursor === cursor || result.items.at(-1)?.id !== result.nextCursor)
  )
    throw new Error("Project activity pagination did not advance");
  return result;
}
/** Distinguish failure before a write from an ambiguous response after POST. */
export class ProjectActivityPostError extends Error {
  constructor(
    message: string,
    readonly uncertain: boolean
  ) {
    super(message);
    this.name = "ProjectActivityPostError";
  }
}
export async function postProjectActivity(
  crewId: string,
  userId: string,
  generation: number,
  value: ProjectActivityInput,
  signal: AbortSignal
) {
  // Validation and refreshed permission checks cannot create a post.
  const input = projectActivityInput.parse(value);
  const access = await fetchProjectActivityAccess(crewId, userId, generation, signal);
  if (!(input.kind === "update" ? access.manage : access.view))
    throw new ProjectActivityPostError("Project activity permission is required.", false);
  current(generation, signal);
  try {
    // Do not abort an in-flight POST when the screen leaves: retain its receipt.
    const result = projectActivity.parse(
      await api.post(`${path(crewId)}/production-activity`, { service: "aurora", data: input })
    );
    if (
      result.crewId !== crewId ||
      result.createdByUserId !== userId ||
      result.kind !== input.kind ||
      result.plainText !== productionDocumentPlainText(input.content).trim() ||
      (input.kind === "comment" && (result.health !== null || result.progress !== null)) ||
      (input.kind === "update" &&
        (result.health !== input.health || result.progress !== (input.progress ?? null)))
    )
      throw new Error("Project activity receipt mismatch");
    return result;
  } catch (cause) {
    // The server can commit before its broadcast/response fails. Never blind-retry.
    throw new ProjectActivityPostError(
      cause instanceof Error ? cause.message : String(cause),
      true
    );
  }
}
