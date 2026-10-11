import { z } from "zod";
import { api } from "@/lib/api-client";
import { getAuthGeneration } from "@/auth/auth-store";
import { durableRecord } from "@/lib/durable-record";
import { pendingRequest } from "@/lib/pending-request";
const id = z.string().uuid(),
  version = z.number().int().nonnegative();
export const stages = ["story_testing", "production", "released"] as const;
export const gameSchema = z
  .object({
    gameId: id,
    title: z.string(),
    version,
    linked: z.boolean(),
    linkedElsewhere: z.boolean(),
  })
  .refine((value) => !(value.linked && value.linkedElsewhere), "Invalid game association state.");
export type OwnedGame = z.infer<typeof gameSchema>;
const application = z.object({
  id,
  applicantId: z.string().min(1),
  stage: z.enum(stages),
  stageVersion: version,
  reason: z.string(),
  status: z.enum(["pending", "approved", "rejected"]),
  reviewReason: z.string().nullable(),
});
const stageResult = z.object({
  state: z.object({ stage: z.enum(["testing", ...stages]), version }),
  items: z.array(application).max(20),
});
export type StageResult = z.infer<typeof stageResult>;
export const productionCommand = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("games"),
    clientKey: id,
    gameId: id,
    expectedVersion: version,
    active: z.boolean(),
  }),
  z.object({
    kind: z.literal("stages"),
    clientKey: id,
    stage: z.enum(stages),
    expectedVersion: version,
    reason: z.string().trim().min(1).max(1000),
  }),
]);
export type ProductionCommand = z.infer<typeof productionCommand>;
export type ProductionKind = ProductionCommand["kind"];
function current(generation: number, signal?: AbortSignal) {
  if (getAuthGeneration() !== generation || signal?.aborted)
    throw new Error("IP editing session expired.");
}
function path(ipId: string) {
  return `/ip-commerce/me/ips/${id.parse(ipId)}`;
}
export function productionOutbox(
  ipId: string,
  userId: string,
  generation: number,
  kind: ProductionKind
) {
  return pendingRequest(
    productionCommand.refine((command) => command.kind === kind, "IP form mismatch."),
    generation,
    durableRecord(`ip-production-${kind}`, userId, id.parse(ipId))
  );
}
export async function fetchOwnedGames(
  ipId: string,
  generation: number,
  signal: AbortSignal,
  cursor?: string
) {
  current(generation, signal);
  const result = z
    .object({ code: z.literal(200), items: z.array(gameSchema).max(20), nextCursor: id.nullable() })
    .parse(
      await api.get(`${path(ipId)}/owned-games`, {
        service: "aurora",
        raw: true,
        retry: false,
        signal,
        ...(cursor ? { params: { cursor: id.parse(cursor) } } : {}),
      })
    );
  current(generation, signal);
  if (
    new Set(result.items.map((item) => item.gameId)).size !== result.items.length ||
    (result.nextCursor &&
      (result.nextCursor === cursor || result.nextCursor !== result.items.at(-1)?.gameId))
  )
    throw new Error("Invalid game pagination. Refresh the list.");
  return result;
}
export async function fetchStageApplications(
  ipId: string,
  generation: number,
  signal: AbortSignal
) {
  current(generation, signal);
  const result = stageResult.extend({ code: z.literal(200) }).parse(
    await api.get(`${path(ipId)}/stage-applications`, {
      service: "aurora",
      raw: true,
      retry: false,
      signal,
    })
  );
  current(generation, signal);
  if (new Set(result.items.map((item) => item.id)).size !== result.items.length)
    throw new Error("Duplicate production-stage applications.");
  return result;
}
export async function saveProduction(
  ipId: string,
  userId: string,
  generation: number,
  input: ProductionCommand,
  signal: AbortSignal
) {
  current(generation, signal);
  const command = productionCommand.parse(input),
    outbox = productionOutbox(ipId, userId, generation, command.kind);
  outbox.save(command);
  // Both official endpoints replay the same request ID before checking the current version.
  // Keep the original identity and payload, including across app restarts.
  const result = await api.post(
    `${path(ipId)}/${command.kind === "games" ? `games/${command.gameId}` : "stage-applications"}`,
    {
      service: "aurora",
      raw: true,
      retry: false,
      signal,
      data:
        command.kind === "games"
          ? {
              requestId: command.clientKey,
              expectedVersion: command.expectedVersion,
              active: command.active,
            }
          : {
              id: command.clientKey,
              stage: command.stage,
              reason: command.reason,
              expectedVersion: command.expectedVersion,
            },
    }
  );
  current(generation, signal);
  if (command.kind === "games") {
    const receipt = z
      .object({ code: z.literal(200), gameId: id, version, active: z.boolean() })
      .parse(result);
    if (
      receipt.gameId !== command.gameId ||
      receipt.version !== command.expectedVersion + 1 ||
      receipt.active !== command.active
    )
      throw new Error("Game association receipt mismatch. Retry the original request.");
  } else {
    const receipt = application.extend({ code: z.literal(200) }).parse(result);
    if (
      receipt.id !== command.clientKey ||
      receipt.applicantId !== userId ||
      receipt.stage !== command.stage ||
      receipt.stageVersion !== command.expectedVersion ||
      receipt.reason !== command.reason
    )
      throw new Error("Stage application receipt mismatch. Retry the original request.");
  }
  outbox.clear(command.clientKey);
}
