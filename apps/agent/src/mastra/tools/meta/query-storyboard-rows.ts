/**
 * query_storyboard_rows — read the storyboard shot list for one episode.
 *
 * Fills a real gap in the supervisor's tool set: there was no way to
 * answer "how many shots does this episode have?" / "what's shot 5
 * about?" without dispatching `ask_storyboard_designer` (which is a
 * 30s+ LLM consult, way more expensive than a Java read). The
 * supervisor used to wave that limitation away with phrases like
 * "我无法直接看到当前集数的分镜总数" — that was true with the old
 * tool inventory. This tool closes that gap with a cheap Java query.
 *
 * Returns minimal per-shot fields (id / scene / description preview)
 * — enough to count, scan titles, and hand the supervisor a real
 * `shotId` for follow-up `update_storyboard_row` / `delete_shot`
 * calls. Heavier per-shot inspection is still the storyboarder
 * persona's job.
 */
import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { getContext, javaRequest } from "../../lib/workspace-client";

type ShotValue = { presetColumnKey?: string; value?: string };
type Shot = { shotId?: string | number; shotValues?: ShotValue[] };

export const queryStoryboardRows = createTool({
  id: "query_storyboard_rows",
  description:
    'Read the storyboard shot list for an episode (cheap Java query; do NOT use ask_storyboard_designer for this). Returns total shot count + a brief preview per shot (shotId, shotNo, scene, description preview). Call whenever the user asks "how many shots / 几个分镜", "list episode N shots", "show shot 5", "where is shot X". The returned shotId is what `update_storyboard_row`, `delete_shot`, and `add_shot` need as input. Default `episodeId` is the current focused episode from requestContext — pass it explicitly only when querying a different episode.',
  inputSchema: z.object({
    episodeId: z
      .string()
      .optional()
      .describe(
        "Episode (Java storyBoard) id. Optional — defaults to ctx.episodeId so the supervisor doesn't need to look it up when the user is already on a specific episode in the UI."
      ),
    page: z.number().int().min(1).default(1),
    pageSize: z.number().int().min(1).max(200).default(50),
    descriptionPreviewChars: z
      .number()
      .int()
      .min(0)
      .max(400)
      .default(80)
      .describe(
        "How many chars of each shot's description to return. Set to 0 for ID-only lookups (cheapest)."
      ),
  }),
  outputSchema: z.object({
    episodeId: z.string(),
    total: z.number(),
    page: z.number(),
    pageSize: z.number(),
    shots: z.array(
      z.object({
        shotId: z.string(),
        shotNo: z.string().optional(),
        scene: z.string().optional(),
        description: z.string().optional(),
        characters: z.string().optional(),
      })
    ),
  }),
  execute: async ({ episodeId, page, pageSize, descriptionPreviewChars }, execCtx) => {
    const ctx = getContext(execCtx?.requestContext);
    const targetEpisodeId = episodeId ?? ctx.episodeId;
    if (!targetEpisodeId) {
      return {
        episodeId: "",
        total: 0,
        page: page ?? 1,
        pageSize: pageSize ?? 50,
        shots: [],
      };
    }

    const previewLen = descriptionPreviewChars ?? 80;

    const resp = await javaRequest<{
      list?: Shot[];
      total?: number;
      totalCount?: number;
    }>(ctx, "/api/user/shot/queryPage", {
      data: {
        storyBoardId: targetEpisodeId,
        page: page ?? 1,
        pageSize: pageSize ?? 50,
        shotIds: [],
        presetColumnKeys: [],
      },
    });

    const list = resp?.list ?? [];
    const total = Number(resp?.totalCount ?? resp?.total ?? list.length ?? 0);

    const shots = list.map((shot) => {
      const values = shot.shotValues ?? [];
      const get = (key: string) =>
        String(values.find((v) => v.presetColumnKey === key)?.value ?? "").trim();
      const description = get("description");
      return {
        shotId: shot.shotId != null ? String(shot.shotId) : "",
        shotNo: get("shot_no") || undefined,
        scene: get("scene") || undefined,
        description:
          previewLen > 0 && description
            ? description.length > previewLen
              ? `${description.slice(0, previewLen)}…`
              : description
            : undefined,
        characters: get("characters") || undefined,
      };
    });

    return {
      episodeId: targetEpisodeId,
      total,
      page: page ?? 1,
      pageSize: pageSize ?? 50,
      shots,
    };
  },
});
