import { z } from "zod";
import {
  WorldSessionConnectionSchema,
  WorldStreamStatusSchema,
  WorldModelProviderKeySchema,
  type WorldSessionConnection,
  type WorldStreamStatus,
  type WorldModelProviderKey,
} from "@repo/shared/world-model-protocol";

const envelope = { sessionId: z.string().uuid(), requestId: z.string().min(1).max(100) };
const movement = z.enum([
  "none",
  "forward",
  "backward",
  "left",
  "right",
  "forward-left",
  "forward-right",
  "backward-left",
  "backward-right",
]);
const look = z.enum([
  "none",
  "up",
  "down",
  "left",
  "right",
  "up-left",
  "up-right",
  "down-left",
  "down-right",
]);
export const worldCommandSchema = z.discriminatedUnion("type", [
  z.object({ ...envelope, type: z.literal("presentation"), active: z.boolean() }).strict(),
  z
    .object({
      ...envelope,
      type: z.literal("initialize"),
      providerKey: z.custom<WorldModelProviderKey>(
        (value) => WorldModelProviderKeySchema.safeParse(value).success
      ),
      connection: z.custom<WorldSessionConnection>(
        (value) => WorldSessionConnectionSchema.safeParse(value).success
      ),
      maxExperienceSeconds: z.union([z.literal(60), z.literal(90), z.literal(120)]).nullable(),
    })
    .strict(),
  ...(["start", "pause", "resume", "end", "dispose"] as const).map((type) =>
    z.object({ ...envelope, type: z.literal(type) }).strict()
  ),
  z
    .object({
      ...envelope,
      type: z.literal("move"),
      command: z
        .object({
          movement: movement.optional(),
          look: look.optional(),
          interaction: z.enum(["none", "jump", "attack", "crouch", "sprint"]).optional(),
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      ...envelope,
      type: z.literal("instruct"),
      content: z.string().trim().min(1).max(20000),
    })
    .strict(),
  z
    .object({ ...envelope, type: z.literal("rewind"), seconds: z.number().finite().nonnegative() })
    .strict(),
  z.object({ ...envelope, type: z.literal("token"), token: z.string().min(1) }).strict(),
]);
const sessionId = z.string().uuid();
export const worldMessageSchema = z.discriminatedUnion("type", [
  z.object({ sessionId, type: z.literal("playback-blocked"), blocked: z.boolean() }).strict(),
  z.object({ sessionId, type: z.literal("ready") }).strict(),
  z
    .object({
      sessionId,
      type: z.literal("result"),
      requestId: z.string(),
      value: z.unknown().optional(),
    })
    .strict(),
  z
    .object({
      sessionId,
      type: z.literal("failure"),
      requestId: z.string(),
      message: z.string(),
      name: z.string().optional(),
    })
    .strict(),
  z
    .object({
      sessionId,
      type: z.literal("status"),
      status: z.custom<WorldStreamStatus>(
        (value) => WorldStreamStatusSchema.safeParse(value).success
      ),
    })
    .strict(),
  z.object({ sessionId, type: z.literal("frame"), url: z.string().url() }).strict(),
  z.object({ sessionId, type: z.literal("completed") }).strict(),
  z
    .object({
      sessionId,
      type: z.literal("error"),
      message: z.string(),
      name: z.string().optional(),
    })
    .strict(),
]);
export type WorldCommand = z.infer<typeof worldCommandSchema>;
export type WorldMessage = z.infer<typeof worldMessageSchema>;
