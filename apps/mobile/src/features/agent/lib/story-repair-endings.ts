import { z } from "zod";
import { STORY_ENDING_KINDS, StoryRouteTargetSchema } from "@repo/shared/story-stats";
import { replaceRepairTarget, type RepairContent } from "./story-repair-fields";
const object = (v: unknown): Record<string, unknown> | null =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
const schema = z
  .array(
    z
      .object({
        endingId: z
          .string()
          .refine(
            (id) =>
              StoryRouteTargetSchema.safeParse({ kind: "ending", endingId: id }).success &&
              id === id.trim()
          ),
        title: z.record(z.string().max(4000)),
        kind: z.enum(STORY_ENDING_KINDS),
      })
      .strict()
  )
  .max(64)
  .refine(
    (rows) => new Set(rows.map((v) => v.endingId)).size === rows.length,
    "Ending IDs must be unique."
  );
export function repairEndings(content: RepairContent) {
  const bible = object(content.storyBible);
  if (!bible) throw Error("The story foundation is unavailable.");
  return schema.parse(bible.endings ?? []);
}
export function createRepairEnding(
  content: RepairContent,
  nodeId: string,
  index: number,
  locale: string,
  defaultLocale: string,
  title: string
): RepairContent {
  const endings = repairEndings(content);
  if (endings.length >= 64) throw Error("A story supports at most 64 endings.");
  if (!locale.trim() || !defaultLocale.trim() || !title.trim())
    throw Error("An ending requires a title and project language.");
  let suffix = 1;
  while (endings.some((v) => v.endingId === `ending:${suffix}`)) suffix++;
  const endingId = `ending:${suffix}`;
  const next = {
    ...content,
    storyBible: {
      ...object(content.storyBible),
      endings: schema.parse([
        ...endings,
        { endingId, title: { [defaultLocale]: title, [locale]: title }, kind: "neutral" },
      ]),
    },
  };
  return replaceRepairTarget(next, nodeId, index, { kind: "ending", endingId });
}
export function renameRepairEnding(
  content: RepairContent,
  endingId: string,
  locale: string,
  title: string
): RepairContent {
  const endings = repairEndings(content);
  if (!endings.some((v) => v.endingId === endingId))
    throw Error("The selected ending is no longer available.");
  return {
    ...content,
    storyBible: {
      ...object(content.storyBible),
      endings: schema.parse(
        endings.map((v) =>
          v.endingId === endingId ? { ...v, title: { ...v.title, [locale]: title } } : v
        )
      ),
    },
  };
}
export function removeRepairEnding(content: RepairContent, endingId: string): RepairContent {
  const endings = repairEndings(content);
  if (!endings.some((v) => v.endingId === endingId))
    throw Error("The selected ending is no longer available.");
  const matches = (v: unknown) => object(v)?.kind === "ending" && object(v)?.endingId === endingId;
  // Do not silently change interactive actions while the user removes a branch ending.
  for (const node of content.graph.nodes) {
    if (Array.isArray(node.interactions))
      for (const interaction of node.interactions) {
        const outcomes = object(object(interaction)?.outcomes);
        if (
          outcomes &&
          Object.values(outcomes).some(
            (v) => object(v)?.kind === "goto" && matches(object(v)?.target)
          )
        )
          throw Error(
            "This ending is used by an interaction. Change that interaction's destination before removing it."
          );
      }
  }
  return {
    ...content,
    storyBible: {
      ...object(content.storyBible),
      endings: endings.filter((v) => v.endingId !== endingId),
    },
    graph: {
      ...content.graph,
      nodes: content.graph.nodes.map((node) => {
        const exit = object(node.exit),
          key = exit?.kind === "auto" ? "routes" : exit?.kind === "choice" ? "choices" : null;
        if (!key || !Array.isArray(exit?.[key])) return node;
        return {
          ...node,
          exit: {
            ...exit,
            [key]: (exit[key] as unknown[]).map((row) =>
              matches(object(row)?.target) ? { ...object(row), target: null } : row
            ),
          },
        };
      }),
    },
  };
}
