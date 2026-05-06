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
    'Batch-create episodes (worldepisode) in the current project — direct write, no user confirmation needed. Use when the user has already confirmed they want to save N new episode outlines (typical trigger: user clicked the "save" button on an episode-planner proposal, or said "就这么定 / 继续 / 保存这 N 集"). Each episode needs a `title` and `introduction` (synopsis); `frontPrompt` / `behindPrompt` are optional style modifiers applied to every shot in that episode. **Do not use** for renaming a single episode — use `update_episode` instead. **Do not use** for character / scene / prop saves — those have their own batch_create_* tools. Sister tool of batch_create_character / _scene / _prop, mirroring the same direct-commit pattern. **Auto-cleanup**: after the commit, this tool deletes any pre-existing episodes whose introduction is empty (Java auto-creates a default stub on project init that often becomes an orphan). The deletion is opportunistic and reported in `cleanedDefaults`; mention it in your recap if it happened ("saved 8 episodes, removed 1 default placeholder") so the user knows their episode count matches what they asked for.',
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
        message: `Saved ${items.length} episodes (id lookup deferred: ${reason}).`,
      };
    }

    // ─── Cleanup: drop Java's untouched-default placeholders ───────────
    //
    // Java auto-creates a stub episode when a project is initialised. If
    // the user never edited it (introduction stayed empty), it'll sit
    // alongside the freshly-saved real episodes as an orphan "第N+1集".
    // Detect any pre-existing episode whose introduction is empty/blank
    // and isn't one we just wrote, then DELETE it. Conservative on
    // purpose: we only check `introduction` — empty title alone isn't
    // enough signal (Java often picks "第1集" by default which a user
    // might genuinely keep), and we don't query storyboard rows because
    // (a) it costs an extra Java round-trip per candidate, and (b)
    // empty-intro is already a strong "untouched" signal in practice.
    const justCommittedIds = new Set(created.map((c) => c.id));
    const cleanedDefaults: { id: string; title: string }[] = [];
    for (const ep of listedEpisodes) {
      const id = String(ep.id);
      if (justCommittedIds.has(id)) continue;
      const intro = String(ep.introduction ?? "").trim();
      if (intro !== "") continue;
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

    if (created.length > 0 || cleanedDefaults.length > 0) {
      // Wakes the workspace sidebar's red-dot indicator + triggers the
      // Episodes panel refetch, same channel scene/prop/role use.
      // Fired even when only cleanup happened so the panel drops the
      // deleted placeholder without needing a manual refresh.
      await publishEntityEvent(ctx, {
        entity: "episode",
        action: "batch_created",
        source: "batch_create_episode",
      });
    }

    const baseMessage =
      failed.length === 0
        ? `Saved ${created.length} episodes`
        : `Saved ${created.length}, failed ${failed.length}: ${failed
            .map((f) => `${f.title} (${f.reason})`)
            .join("; ")}`;
    const cleanupSuffix =
      cleanedDefaults.length > 0
        ? ` (also removed ${cleanedDefaults.length} empty default placeholder${
            cleanedDefaults.length === 1 ? "" : "s"
          })`
        : "";

    return {
      ok: failed.length === 0,
      created,
      failed,
      cleanedDefaults,
      message: `${baseMessage}${cleanupSuffix}.`,
    };
  },
});
