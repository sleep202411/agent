import { z } from "zod";
import { StoryStateKeySchema, MAX_STORY_STATE_VARIABLES } from "@repo/shared/story-stats";
import type { RepairContent } from "./story-repair-fields";
import { removeRepairVariableReferences } from "./story-repair-variable-references";
export const repairVariableSchema = z
  .object({
    key: z.string().refine((value) => StoryStateKeySchema.safeParse(value).success),
    name: z.record(z.string().max(4000)),
    valueType: z.enum(["number", "boolean"]),
    initialValue: z.union([z.number().finite(), z.boolean()]),
    note: z.string().max(2000).optional(),
  })
  .strict()
  .refine(
    (value) => typeof value.initialValue === value.valueType,
    "Initial value must match the variable type."
  );
export const repairVariableListSchema = z
  .array(repairVariableSchema)
  .max(MAX_STORY_STATE_VARIABLES)
  .refine(
    (rows) => new Set(rows.map((v) => v.key)).size === rows.length,
    "State variable keys must be unique."
  );
export type RepairVariable = z.infer<typeof repairVariableSchema>;
export function readRepairVariables(content: RepairContent): RepairVariable[] {
  const bible = content.storyBible;
  if (!bible || typeof bible !== "object" || Array.isArray(bible))
    throw Error("The story foundation is unavailable.");
  return repairVariableListSchema.parse((bible as Record<string, unknown>).stateVariables ?? []);
}
export function allocateRepairVariableKey(variables: readonly { key: string }[]) {
  const keys = new Set(variables.map((v) => v.key));
  for (let i = 1; ; i++) if (!keys.has(`state_${i}`)) return `state_${i}`;
}
export function replaceRepairVariables(
  content: RepairContent,
  expected: unknown,
  value: unknown,
  defaultLocale: string
): RepairContent {
  const previous = readRepairVariables(content);
  if (JSON.stringify(previous) !== JSON.stringify(expected))
    throw Error("State variables changed. Reopen the editor before applying changes.");
  const rows = repairVariableListSchema.parse(value);
  if (!defaultLocale.trim() || rows.some((v) => !v.name[defaultLocale]?.trim()))
    throw Error("Every state variable needs a name in the project's default language.");
  const removed = new Set(
    previous.filter((v) => !rows.some((next) => next.key === v.key)).map((v) => v.key)
  );
  return {
    ...removeRepairVariableReferences(content, removed),
    storyBible: { ...(content.storyBible as Record<string, unknown>), stateVariables: rows },
  };
}
