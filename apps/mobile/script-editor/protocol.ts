import { z } from "zod";
export const encodedScriptState = z
  .string()
  .min(4)
  .regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/);
export const scriptEditSchema = z
  .object({ clientKey: z.string().uuid(), yjsUpdateBase64: encodedScriptState })
  .strict();
export const scriptCheckpointSchema = z
  .object({ version: z.literal(1), state: encodedScriptState, pending: z.array(scriptEditSchema) })
  .strict();
const sessionId = z.string().uuid();
const remote = { snapshot: encodedScriptState.nullish(), updates: z.array(encodedScriptState) };
export const scriptHostMessage = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("init"),
      sessionId,
      checkpoint: scriptCheckpointSchema.optional(),
      editable: z.boolean(),
      ...remote,
    })
    .strict(),
  z.object({ type: z.literal("remote"), sessionId, ...remote }).strict(),
  z.object({ type: z.literal("ack"), sessionId, edit: scriptEditSchema }).strict(),
  z.object({ type: z.literal("editable"), sessionId, value: z.boolean() }).strict(),
  z
    .object({ type: z.literal("persisted"), sessionId, revision: z.number().int().nonnegative() })
    .strict(),
  z.object({ type: z.literal("hostError"), sessionId, message: z.string() }).strict(),
]);
export const scriptEditorMessage = z.discriminatedUnion("type", [
  z.object({ type: z.literal("ready"), sessionId }).strict(),
  z
    .object({
      type: z.literal("checkpoint"),
      sessionId,
      revision: z.number().int().positive(),
      checkpoint: scriptCheckpointSchema,
    })
    .strict(),
  z.object({ type: z.literal("error"), sessionId, message: z.string() }).strict(),
]);
export type ScriptHostMessage = z.infer<typeof scriptHostMessage>;
export type ScriptEditorMessage = z.infer<typeof scriptEditorMessage>;
