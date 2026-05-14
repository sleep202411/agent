/**
 * batch_create_episode — direct-commit batch tool for episodes.
 *
 * Sister of `batch_create_character` / `_scene` / `_prop` for the
 * narrative-unit half of the project. Without this tool the supervisor
 * could not save N proposed episode outlines: the workflow engine that
 * used to own `invoke_workflow('episode_phase')` was removed
 * 2026-05-05, and the only remaining episode CRUD tools (`update_episode`,
 * `delete_episode`) work on a single episode at a time. The supervisor
 * was falling back to `batch_create_character` and writing episode-
 * shaped data into the worldrole table — see project memory entry
 * `project_episode_save_misroute.md`.
 *
 * Java contract: POST `/api/user/world/batch/updateOrAdd/episode` with
 * `{ datas: [{ title, introduction, frontPrompt, behindPrompt, projectId,
 * sort }] }`. Episodes don't have a single-create endpoint, so we hit
 * the batch endpoint as one call (consistent with how `episode_phase`
 * used to commit drafts — see `workflows/phases/episode-phase.ts`
 * around line 430 for the reference implementation).
 */
import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { getContext, javaRequest } from "../../lib/workspace-client";
import { publishEntityEvent } from "../../lib/entity-events";

/**
 * Sort gap between consecutive episodes — leaves room to insert
 * episodes between existing ones later without renumbering. Mirrors
 * `episode_phase`'s SORT_GAP so the two paths produce sort values that
 * sit in the same lattice.
 */
const SORT_GAP = 1024;

const EpisodeItemSchema = z.object({
  title: z.string().min(1).max(120).describe("Episode title (e.g. '第1集 荧惑守心')"),
  introduction: z
    .string()
    .min(1)
    .describe("Episode synopsis — a 1-3 sentence summary of what happens in this episode"),
  frontPrompt: z
    .string()
    .optional()
    .describe(
      "Prefix prepended to every shot's video prompt in this episode (e.g. tone / lighting style)"
    ),
  behindPrompt: z.string().optional().describe("Suffix appended to every shot's video prompt"),
});

const InputSchema = z.object({
  items: z
    .array(EpisodeItemSchema)
    .min(1)
    .max(50)
    .describe(
      "Episodes to create. Order matters — they're persisted with a sort field derived from array index, so position N becomes episode N."
    ),
});

const OutputSchema = z.object({
  ok: z.boolean(),
  created: z
    .array(z.object({ title: z.string(), id: z.string() }))
    .describe("Episodes that landed in Java (title echoed verbatim, id assigned by Java)"),
  failed: z.array(z.object({ title: z.string(), reason: z.string() })),
  /**
   * Pre-existing episodes auto-deleted as part of the commit because
   * they looked like Java's untouched-default placeholder rows (empty
   * introduction). Surfaced so the supervisor's recap can mention it
   * ("saved 8 episodes, removed 1 default placeholder") and so test
   * runs can assert the cleanup actually fired.
   */
  cleanedDefaults: z
    .array(z.object({ id: z.string(), title: z.string() }))
    .describe("Empty default episodes that were deleted as part of this commit."),
  cleanedDefaultShots: z
    .array(z.object({ episodeId: z.string(), shotId: z.string() }))
    .describe(
      "Empty default shot rows that were deleted from just-created episodes (Java seeds one stub shot per new episode)."
    ),
  message: z.string(),
});

type EpisodeItem = z.infer<typeof EpisodeItemSchema>;

interface JavaEpisodeCreatePayload {
  title: string;
  introduction: string;
  frontPrompt: string;
  behindPrompt: string;
  projectId: string;
  sort: number;
}

interface JavaEpisodeListResponse {
  list?: Array<{
    id: string | number;
    sort?: number;
    title?: string;
    introduction?: string;
  }>;
}

function buildPayload(projectId: string, items: EpisodeItem[]): JavaEpisodeCreatePayload[] {
  return items.map((it, idx) => ({
    title: it.title,
    introduction: it.introduction,
    frontPrompt: it.frontPrompt ?? "",
    behindPrompt: it.behindPrompt ?? "",
    projectId,
    sort: (idx + 1) * SORT_GAP,
  }));
}

export const batchCreateEpisode = createTool({
  id: "batch_create_episode",
  description:
    'Batch-create episodes (worldepisode) in the current project — direct write, no user confirmation needed. Use when the user has already confirmed they want to save N new episode outlines (typical trigger: user clicked the "save" button on an episode-planner proposal, or said "就这么定 / 继续 / 保存这 N 集"). Each episode needs a `title` and `introduction` (synopsis); `frontPrompt` / `behindPrompt` are optional style modifiers applied to every shot in that episode. **Do not use** for renaming a single episode — use `update_episode` instead. **Do not use** for character / scene / prop saves — those have their own batch_create_* tools. Sister tool of batch_create_character / _scene / _prop, mirroring the same direct-commit pattern. **Auto-cleanup** (two passes, both opportunistic): (1) deletes pre-existing episodes whose title still matches the bare Java-seed pattern (`第N集` with no extra content) AND whose introduction is blank — never touches anything renamed by the user or with any intro filled in. Reported in `cleanedDefaults`; (2) for each just-created episode, lists its shots and deletes the ones with blank `description` (Java also seeds a single empty stub shot per new episode), reported in `cleanedDefaultShots`. Mention either in your recap when non-zero ("saved 8 episodes, removed 1 default placeholder, removed 8 empty default shots") so the user knows their counts match what they asked for.',
  inputSchema: InputSchema,
  outputSchema: OutputSchema,
  execute: async ({ items }, execCtx) => {
    const ctx = getContext(
      (execCtx?.requestContext ?? undefined) as Parameters<typeof getContext>[0]
    );
    const projectId = ctx.projectId;
    if (!projectId) {
      return {
        ok: false,
        created: [],
        failed: items.map((it) => ({
          title: it.title,
          reason: "projectId missing from context",
        })),
        cleanedDefaults: [],
        cleanedDefaultShots: [],
        message: "This project is missing projectId — cannot commit episodes.",
      };
    }

    const datas = buildPayload(projectId, items);

    try {
      // Single batch call. Java's `updateOrAdd/episode` upserts; passing
      // fresh items (no `id` field) creates new rows. Timeout is generous
      // because Java may seed scene/prop rows in the same transaction
      // for downstream phases — typically 2-5s, can spike to 30s.
      await javaRequest<unknown>(ctx, "/api/user/world/batch/updateOrAdd/episode", {
        data: { datas },
        timeoutMs: 120_000,
      });
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      return {
        ok: false,
        created: [],
        failed: items.map((it) => ({ title: it.title, reason })),
        cleanedDefaults: [],
        cleanedDefaultShots: [],
        message: `Java batch write failed: ${reason}`,
      };
    }

    // Java's batch endpoint doesn't return the new IDs — list episodes
    // and resolve by sort (we control sort, so it's a deterministic key
    // that survives concurrent writes by other clients). Same trick
    // `episode_phase.applyEpisodeDrafts` uses; kept consistent so any
    // downstream tooling that reads `ep.sort` interprets both paths the
    // same way.
    const created: { title: string; id: string }[] = [];
    const failed: { title: string; reason: string }[] = [];
    let listedEpisodes: NonNullable<JavaEpisodeListResponse["list"]> = [];
    try {
      const listed = await javaRequest<JavaEpisodeListResponse>(
        ctx,
        "/api/user/world/list/episode",
        {
          data: { productId: projectId, page: 1, pageSize: 999 },
        }
      );
      listedEpisodes = listed.list ?? [];
      const bySort = new Map(listedEpisodes.map((ep) => [Number(ep.sort ?? 0), String(ep.id)]));
      for (let i = 0; i < items.length; i++) {
        const expectedSort = (i + 1) * SORT_GAP;
        const id = bySort.get(expectedSort);
        if (id) {
          created.push({ title: items[i].title, id });
        } else {
          failed.push({
            title: items[i].title,
            reason: "Java write succeeded but id lookup missed (sort-key mismatch)",
          });
        }
      }
    } catch (err) {
      // Java accepted the write but listing failed. The episodes likely
      // landed; we just can't confirm IDs and we can't run cleanup.
      // Surface as a soft warning rather than failing the whole call.
      const reason = err instanceof Error ? err.message : String(err);
      return {
        ok: true,
        created: [],
        failed: [],
        cleanedDefaults: [],
        cleanedDefaultShots: [],
        message: `Saved ${items.length} episodes (id lookup deferred: ${reason}).`,
      };
    }

    // ─── Cleanup: drop Java's untouched-default placeholders ───────────
    //
    // Java auto-creates a stub episode when a project is initialised
    // with a default title shaped like "第N集" and an empty
    // introduction. If the user never edits it, it sits alongside the
    // real episodes as an orphan. We delete it on commit.
    //
    // Two AND-ed signals are required:
    //   1. introduction is empty after trim
    //   2. title matches the bare Java-seed pattern /^第\s*\d+\s*集\s*$/
    //
    // Both gates exist because seeing only an empty intro caused
    // collateral damage in the past — a user's prior batch_create
    // commit had episodes with intros that *became* empty on the Java
    // side (separate bug), and the cleanup nuked them on the next
    // batch. Requiring the title to also look like Java's default
    // makes this near-impossible to misfire: any user-edited title
    // (e.g. "第1集 荧惑守心" or "Pilot") is automatically protected.
    const DEFAULT_TITLE_PATTERN = /^第\s*\d+\s*集\s*$/;
    const justCommittedIds = new Set(created.map((c) => c.id));
    const cleanedDefaults: { id: string; title: string }[] = [];
    for (const ep of listedEpisodes) {
      const id = String(ep.id);
      if (justCommittedIds.has(id)) continue;
      const intro = String(ep.introduction ?? "").trim();
      if (intro !== "") continue;
      const title = String(ep.title ?? "").trim();
      if (!DEFAULT_TITLE_PATTERN.test(title)) continue;
      try {
        await javaRequest<unknown>(
          ctx,
          `/api/user/world/delete/episode?id=${encodeURIComponent(id)}`
        );
        cleanedDefaults.push({ id, title: String(ep.title ?? "") });
      } catch (err) {
        // Soft-fail per candidate: cleanup is opportunistic, not a
        // contract. Log so it shows up in dev logs but don't fail the
        // whole tool — the user still got their N episodes saved.
        const reason = err instanceof Error ? err.message : String(err);
        console.warn(
          `[batch_create_episode] failed to drop empty default episode id=${id} title="${ep.title ?? ""}": ${reason}`
        );
      }
    }

    // ─── Cleanup: drop Java's auto-seeded stub shots ───────────────────
    //
    // Whenever Java creates an episode it seeds a single empty shot row
    // (no scene / no description / no prompts) — presumably so the
    // storyboard table renders a "click to fill" line. Once the user
    // commits real shots via the produce pipeline / add_shot / batch
    // update, the stub stays as row #1 forever, polluting the table.
    // Same recipe as the empty-episode cleanup above: list shots per
    // just-created episode, delete the ones whose `description` value
    // is blank. Conservative on purpose — we only touch episodes we
    // ourselves just created, never pre-existing ones (those might
    // have user's intentionally-empty in-progress rows).
    type ShotRow = {
      shotId?: string | number;
      shotValues?: Array<{ presetColumnKey?: string; value?: string }>;
    };
    const cleanedDefaultShots: { episodeId: string; shotId: string }[] = [];
    for (const c of created) {
      try {
        const shotsResp = await javaRequest<{ list?: ShotRow[] }>(ctx, "/api/user/shot/queryPage", {
          data: {
            storyBoardId: c.id,
            page: 1,
            pageSize: 999,
            shotIds: [],
            presetColumnKeys: [],
          },
        });
        const shots = shotsResp.list ?? [];
        for (const shot of shots) {
          const shotId = shot.shotId == null ? "" : String(shot.shotId);
          if (!shotId) continue;
          const description = String(
            shot.shotValues?.find((v) => v.presetColumnKey === "description")?.value ?? ""
          ).trim();
          if (description !== "") continue;
          try {
            await javaRequest(ctx, `/api/user/shot/delete/${encodeURIComponent(shotId)}`);
            cleanedDefaultShots.push({ episodeId: c.id, shotId });
          } catch (err) {
            const reason = err instanceof Error ? err.message : String(err);
            console.warn(
              `[batch_create_episode] failed to drop empty default shot id=${shotId} in episode ${c.id}: ${reason}`
            );
          }
        }
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        console.warn(
          `[batch_create_episode] failed to list shots for cleanup in episode ${c.id}: ${reason}`
        );
      }
    }

    if (created.length > 0 || cleanedDefaults.length > 0 || cleanedDefaultShots.length > 0) {
      // Wakes the workspace sidebar's red-dot indicator + triggers the
      // Episodes panel refetch, same channel scene/prop/role use.
      // Fired even when only cleanup happened so the panel drops the
      // deleted placeholder without needing a manual refresh.
      await publishEntityEvent(ctx, {
        entity: "episode",
        action: "batch_created",
        source: "batch_create_episode",
      });
      if (cleanedDefaultShots.length > 0) {
        // Storyboard tab red-dot driver — fire one storyboard event so
        // the affected episodes' storyboard view re-fetches and the
        // stub shot disappears in real time.
        await publishEntityEvent(ctx, {
          entity: "storyboard",
          action: "batch_deleted",
          source: "batch_create_episode.cleanup_default_shots",
        });
      }
    }

    const baseMessage =
      failed.length === 0
        ? `Saved ${created.length} episodes`
        : `Saved ${created.length}, failed ${failed.length}: ${failed
            .map((f) => `${f.title} (${f.reason})`)
            .join("; ")}`;
    const parts: string[] = [];
    if (cleanedDefaults.length > 0) {
      parts.push(
        `removed ${cleanedDefaults.length} empty default episode${cleanedDefaults.length === 1 ? "" : "s"}`
      );
    }
    if (cleanedDefaultShots.length > 0) {
      parts.push(
        `removed ${cleanedDefaultShots.length} empty default shot${cleanedDefaultShots.length === 1 ? "" : "s"}`
      );
    }
    const cleanupSuffix = parts.length > 0 ? ` (${parts.join(", also ")})` : "";

    return {
      ok: failed.length === 0,
      created,
      failed,
      cleanedDefaults,
      cleanedDefaultShots,
      message: `${baseMessage}${cleanupSuffix}.`,
    };
  },
});
