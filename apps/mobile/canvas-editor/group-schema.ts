import { z } from "zod";
/** Web canvas-core/types.ts; colors describe groups, not app theme surfaces. */
export const CANVAS_GROUP_COLORS = [
  "slate",
  "red",
  "orange",
  "amber",
  "green",
  "cyan",
  "blue",
  "indigo",
  "pink",
] as const;
const id = z.string().min(1);
const members = z
  .array(id)
  .min(1)
  .refine((ids) => new Set(ids).size === ids.length, "Select each node once.");
export const canvasGroupEditSchema = z.discriminatedUnion("operation", [
  z
    .object({
      operation: z.literal("create"),
      groupId: z
        .string()
        .regex(/^group-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i),
      nodeIds: members.refine((ids) => ids.length >= 2, "Select at least two nodes."),
    })
    .strict(),
  z.object({ operation: z.literal("add"), groupId: id, nodeIds: members }).strict(),
  z.object({ operation: z.literal("remove"), nodeIds: members }).strict(),
  z.object({ operation: z.literal("ungroup"), groupId: id }).strict(),
  z
    .object({ operation: z.literal("color"), groupId: id, color: z.enum(CANVAS_GROUP_COLORS) })
    .strict(),
  z
    .object({
      operation: z.literal("move"),
      groupId: id,
      delta: z.object({ x: z.number().finite(), y: z.number().finite() }).strict(),
    })
    .strict(),
]);
export type CanvasGroupEdit = z.infer<typeof canvasGroupEditSchema>;
export type CanvasGroup = {
  id: string;
  nodeIds: string[];
  color: (typeof CANVAS_GROUP_COLORS)[number];
};

/** Mirrors Web readAllGroups + reconcileCanvasGroups, including deterministic
 * ownership of duplicate memberships before undersized groups dissolve. */
export function canvasGroups(
  values: Record<string, unknown>,
  nodeIds: Iterable<string>
): CanvasGroup[] {
  const existing = new Set(nodeIds),
    claimed = new Set<string>();
  const groups: CanvasGroup[] = [];
  for (const [id, raw] of Object.entries(values).sort(([a], [b]) => a.localeCompare(b))) {
    if (!raw || typeof raw !== "object") continue;
    const value = raw as { nodeIds?: unknown; color?: unknown };
    const members: string[] = [];
    for (const member of Array.isArray(value.nodeIds) ? value.nodeIds : []) {
      if (typeof member !== "string" || !existing.has(member) || claimed.has(member)) continue;
      claimed.add(member);
      members.push(member);
    }
    if (members.length < 2) continue;
    const color = CANVAS_GROUP_COLORS.find((color) => color === value.color) ?? "slate";
    groups.push({ id, nodeIds: members, color });
  }
  return groups;
}
