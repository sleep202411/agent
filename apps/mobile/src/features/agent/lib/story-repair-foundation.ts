import type { RepairContent } from "./story-repair-fields";
export const foundationLimits = { logline: 1000, synopsis: 20000 } as const;
export type FoundationField = keyof typeof foundationLimits;
export function readRepairFoundation(content: RepairContent) {
  const bible = content.storyBible;
  if (bible !== undefined && (!bible || typeof bible !== "object" || Array.isArray(bible)))
    throw Error("The story overview is malformed. Reload the chapter before editing.");
  const record = (bible ?? {}) as Record<string, unknown>;
  for (const field of ["logline", "synopsis"] as const) {
    if (record[field] !== undefined && typeof record[field] !== "string")
      throw Error("The story overview is malformed. Reload the chapter before editing.");
  }
  return { logline: (record.logline ?? "") as string, synopsis: (record.synopsis ?? "") as string };
}
export function updateRepairFoundation(
  content: RepairContent,
  field: FoundationField,
  value: string
): RepairContent {
  readRepairFoundation(content);
  if (value.length > foundationLimits[field])
    throw Error(`The ${field} exceeds ${foundationLimits[field]} characters.`);
  return {
    ...content,
    storyBible: { ...(content.storyBible as Record<string, unknown>), [field]: value },
  };
}
