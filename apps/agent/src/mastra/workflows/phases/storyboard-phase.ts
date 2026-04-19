/**
 * storyboard_phase — per-episode storyboard generation.
 *
 * Iterates each episode, calls the storyboarder persona to produce shot
 * rows, writes a draft per episode, one HITL at the end, then commits via
 * the existing Java save endpoint (/api/ai/chat/save/storyboard, one call
 * per episode since that's the Java contract).
 */
import { randomUUID } from "node:crypto";
import { createStep, createWorkflow } from "@mastra/core/workflows";
import { z } from "zod";
import {
  deleteAllDrafts,
  listDrafts,
  markDraftCommitted,
  markDraftCommitting,
  markDraftDiscarded,
  markDraftFailed,
  putDraft,
} from "../../lib/drafts";
import { reportProgress, throwIfCancelled } from "../engine";
import { getContext, javaRequest } from "../../lib/workspace-client";

// ─── Schemas ───────────────────────────────────────────────────────────

const StoryboardRow = z.object({
  shotNumber: z.string().min(1).max(12),
  scene: z.string().min(1),
  shotType: z.string().min(1),
  cameraAngle: z.string().min(1),
  description: z.string().min(1),
  dialogue: z.string().optional().default(""),
  duration: z.number().min(1).max(120).optional(),
  videoPrompt: z.string().optional().default(""),
});

const EpisodeScriptRef = z.object({
  episodeId: z.string().min(1),
  title: z.string().min(1),
  scriptContent: z.string().min(1),
});

export const StoryboardPhaseInputSchema = z.object({
  projectId: z.string().min(1),
  /** Optional: only storyboard these episode ids (skip others). */
  onlyEpisodeIds: z.array(z.string()).optional(),
  feedback: z.string().optional(),
});

/** Internal — shape the generate step consumes. */
const ResolvedGenerateInputSchema = z.object({
  projectId: z.string(),
  episodes: z.array(EpisodeScriptRef).min(1),
  feedback: z.string().optional(),
});

export const StoryboardPhaseOutputSchema = z.object({
  outcome: z.enum(["committed", "rejected", "partial_failure"]),
  committed: z.array(z.object({ episodeId: z.string(), title: z.string(), shotCount: z.number() })),
  failed: z.array(z.object({ episodeId: z.string(), title: z.string(), reason: z.string() })),
  message: z.string(),
});

const StateSchema = z.object({
  generated: z
    .array(
      z.object({
        clientRefId: z.string(),
        episodeId: z.string(),
        title: z.string(),
        rows: z.array(StoryboardRow),
      })
    )
    .default([]),
});

const ResumeSchema = z.object({
  approved: z.boolean(),
  feedback: z.string().optional(),
  acceptedClientRefIds: z.array(z.string()).optional(),
});

const SuspendSchema = z.object({
  runId: z.string(),
  episodeCount: z.number(),
  totalShots: z.number(),
  phase: z.literal("storyboard"),
});

// ─── Step 0: resolve inputs — pull committed episodes + scripts ──────

const resolveInputStep = createStep({
  id: "resolve_input",
  inputSchema: StoryboardPhaseInputSchema,
  outputSchema: ResolvedGenerateInputSchema,
  execute: async ({ inputData, requestContext }) => {
    const ctx = getContext(requestContext);

    // 1. List episodes from Java (sorted).
    const listed = await javaRequest<{
      list?: Array<{
        id: string | number;
        title?: string;
        sort?: number;
      }>;
    }>(ctx, "/api/user/world/list/episode", {
      data: { productId: inputData.projectId, page: 1, pageSize: 999 },
    });
    const episodesMeta = (listed.list ?? [])
      .sort((a, b) => Number(a.sort ?? 0) - Number(b.sort ?? 0))
      .map((ep) => ({ id: String(ep.id), title: String(ep.title ?? "") }));

    const filter = inputData.onlyEpisodeIds?.length ? new Set(inputData.onlyEpisodeIds) : null;

    const episodes: z.infer<typeof EpisodeScriptRef>[] = [];
    for (const meta of episodesMeta) {
      if (filter && !filter.has(meta.id)) continue;
      // 2. Fetch script content per episode from Java.
      try {
        const scriptResp = await javaRequest<{
          content?: string;
          script?: string;
        }>(ctx, `/api/user/project/scripts/episode/detail/${encodeURIComponent(meta.id)}`);
        const content = (scriptResp.content ?? scriptResp.script ?? "").trim();
        if (!content) continue;
        episodes.push({
          episodeId: meta.id,
          title: meta.title,
          scriptContent: content,
        });
      } catch {
        // Skip episodes missing scripts — caller can retry after script_phase.
      }
    }
    if (episodes.length === 0) {
      throw new Error("storyboard_phase: no episodes with scripts found. Run script_phase first.");
    }
    return {
      projectId: inputData.projectId,
      episodes,
      feedback: inputData.feedback,
    };
  },
});

// ─── Step 1: generate storyboard per episode ──────────────────────────

/**
 * Episodes are storyboarded in parallel because each prompt is
 * self-contained — we only feed `ep.scriptContent` (no cross-episode
 * context), so serial order gives us no consistency benefit. At
 * concurrency=4 a 13-episode run drops from ~12 minutes to ~3 minutes.
 *
 * Concurrency is env-tunable (STORYBOARD_GENERATE_CONCURRENCY); bumping
 * it higher trades wall-clock for DeepSeek RPM pressure. 4 is a safe
 * default that stays well under any account-level limit.
 */
const STORYBOARD_GENERATE_CONCURRENCY = Math.max(
  1,
  Number(process.env.STORYBOARD_GENERATE_CONCURRENCY ?? 4)
);

const generateStep = createStep({
  id: "generate",
  inputSchema: ResolvedGenerateInputSchema,
  outputSchema: z.object({ episodeCount: z.number(), totalShots: z.number() }),
  stateSchema: StateSchema,
  execute: async ({ inputData, setState, mastra, requestContext }) => {
    const runId = requestContext?.get("runId") as string | undefined;
    if (!runId) throw new Error("runId missing");

    const storyboarder = mastra?.getAgent("storyboarder");
    if (!storyboarder) throw new Error("storyboarder agent not registered");

    const total = inputData.episodes.length;
    const concurrency = Math.min(STORYBOARD_GENERATE_CONCURRENCY, total);

    // Per-index slots preserve input order in the final `generated` array
    // regardless of which worker finishes when.
    type GeneratedEntry = z.infer<typeof StateSchema>["generated"][number];
    const generatedByIndex: Array<GeneratedEntry | null> = new Array(total).fill(null);
    const errorsByIndex: Array<string | null> = new Array(total).fill(null);

    let completedCount = 0;
    let cursor = 0;

    await reportProgress(runId, {
      stepId: "storyboard_phase.generate",
      current: 0,
      total,
      label: `分镜师开始并行出分镜（共 ${total} 集，并发 ${concurrency}）`,
    });

    const runOne = async (i: number) => {
      await throwIfCancelled(runId);
      const ep = inputData.episodes[i];
      try {
        const response = await storyboarder.generate(buildPrompt(ep), {
          structuredOutput: {
            schema: z.object({ rows: z.array(StoryboardRow).min(5) }),
            errorStrategy: "warn",
          },
        });
        const rows = (
          (response.object as { rows?: z.infer<typeof StoryboardRow>[] } | undefined)?.rows ?? []
        ).slice(0, 60);

        const clientRefId = randomUUID();
        await putDraft(runId, "shot", clientRefId, {
          episodeId: ep.episodeId,
          title: ep.title,
          rows,
        });
        generatedByIndex[i] = { clientRefId, episodeId: ep.episodeId, title: ep.title, rows };
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        errorsByIndex[i] = reason;
      } finally {
        // Increment under the single-threaded event loop — no races.
        completedCount += 1;
        await reportProgress(runId, {
          stepId: "storyboard_phase.generate",
          current: completedCount,
          total,
          label: `已出 ${completedCount}/${total} 集分镜`,
        });
      }
    };

    // Cursor-driven worker pool: each worker pulls the next unassigned
    // index until the cursor exhausts the input. Pattern matches the one
    // in lib/batch-writer.ts.
    const workers = Array.from({ length: concurrency }, async () => {
      while (true) {
        const i = cursor++;
        if (i >= total) return;
        await runOne(i);
      }
    });
    await Promise.all(workers);

    // Fail the step if ANY episode failed — current behavior matches the
    // old serial loop (which would throw on first failure). Parallel just
    // means we surface ALL failures for diagnostics, not just the first.
    const failedCount = errorsByIndex.filter((e) => e !== null).length;
    if (failedCount > 0) {
      const firstError = errorsByIndex.find((e): e is string => e !== null) ?? "unknown";
      throw new Error(
        `storyboard generation failed for ${failedCount}/${total} episodes. First error: ${firstError}`
      );
    }

    const generated = generatedByIndex.filter((g): g is GeneratedEntry => g !== null);
    const totalShots = generated.reduce((sum, g) => sum + g.rows.length, 0);

    setState({ generated });
    return { episodeCount: generated.length, totalShots };
  },
});

function buildPrompt(ep: z.infer<typeof EpisodeScriptRef>): string {
  return [
    `请把以下剧集剧本拆成分镜表，JSON 返回，字段 rows 是镜头数组。`,
    "",
    `集标题：${ep.title}`,
    "剧本：",
    "```",
    ep.scriptContent,
    "```",
    "",
    "每行 rows 严格按约定字段填（shotNumber / scene / shotType / cameraAngle / description / dialogue / duration / videoPrompt）。",
    "镜头数量 15-40 个之间。",
  ].join("\n");
}

// ─── Step 2: HITL ─────────────────────────────────────────────────────

const waitConfirmationStep = createStep({
  id: "wait_confirmation",
  inputSchema: z.object({ episodeCount: z.number(), totalShots: z.number() }),
  outputSchema: z.object({
    approved: z.boolean(),
    feedback: z.string().optional(),
    acceptedClientRefIds: z.array(z.string()).optional(),
  }),
  stateSchema: StateSchema,
  resumeSchema: ResumeSchema,
  suspendSchema: SuspendSchema,
  execute: async ({ inputData, resumeData, suspend, requestContext }) => {
    const runId = requestContext?.get("runId") as string | undefined;
    if (!runId) throw new Error("runId missing");

    if (!resumeData) {
      await reportProgress(runId, {
        stepId: "storyboard_phase.confirm",
        current: inputData.episodeCount,
        total: inputData.episodeCount,
        label: `${inputData.episodeCount} 集分镜（${inputData.totalShots} 个镜头）已就绪，等待确认`,
      });
      return await suspend({
        runId,
        episodeCount: inputData.episodeCount,
        totalShots: inputData.totalShots,
        phase: "storyboard" as const,
      });
    }
    return resumeData;
  },
});

// ─── Step 3: commit (one call per episode) ───────────────────────────

const STORYBOARD_HEADERS = [
  "shotNumber",
  "scene",
  "shotType",
  "cameraAngle",
  "description",
  "dialogue",
  "duration",
  "videoPrompt",
];

const applyDecisionStep = createStep({
  id: "apply_decision",
  inputSchema: z.object({
    approved: z.boolean(),
    feedback: z.string().optional(),
    acceptedClientRefIds: z.array(z.string()).optional(),
  }),
  outputSchema: StoryboardPhaseOutputSchema,
  stateSchema: StateSchema,
  execute: async ({ inputData, state, requestContext }) => {
    const runId = requestContext?.get("runId") as string | undefined;
    if (!runId) throw new Error("runId missing");
    await throwIfCancelled(runId);

    const ctx = getContext(requestContext);
    const generated = state.generated ?? [];

    if (!inputData.approved) {
      for (const g of generated) await markDraftDiscarded(runId, g.clientRefId);
      return {
        outcome: "rejected" as const,
        committed: [],
        failed: [],
        message: inputData.feedback
          ? `分镜阶段未通过。反馈：${inputData.feedback}`
          : "分镜阶段未通过。",
      };
    }

    const accepted = inputData.acceptedClientRefIds
      ? new Set(inputData.acceptedClientRefIds)
      : null;
    const drafts = await listDrafts<{
      episodeId: string;
      title: string;
      rows: z.infer<typeof StoryboardRow>[];
    }>(runId, { entityType: "shot", statuses: ["pending"] });
    const accepts = drafts.filter((d) => !accepted || accepted.has(d.clientRefId));

    for (const it of accepts) await markDraftCommitting(runId, it.clientRefId);

    const committed: z.infer<typeof StoryboardPhaseOutputSchema>["committed"] = [];
    const failed: z.infer<typeof StoryboardPhaseOutputSchema>["failed"] = [];

    let i = 0;
    for (const d of accepts) {
      await throwIfCancelled(runId);
      await reportProgress(runId, {
        stepId: "storyboard_phase.commit",
        current: i,
        total: accepts.length,
        label: `保存分镜：${i + 1}/${accepts.length} — ${d.data.title}`,
      });

      const rows2d = d.data.rows.map((r) =>
        STORYBOARD_HEADERS.map((h) => String((r as Record<string, unknown>)[h] ?? ""))
      );

      try {
        await javaRequest<unknown>(ctx, "/api/ai/chat/save/storyboard", {
          data: {
            episodeId: d.data.episodeId,
            datas: [STORYBOARD_HEADERS, ...rows2d],
            autoload: true,
          },
          timeoutMs: 300_000,
        });
        await markDraftCommitted(runId, d.clientRefId, d.data.episodeId);
        committed.push({
          episodeId: d.data.episodeId,
          title: d.data.title,
          shotCount: d.data.rows.length,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        await markDraftFailed(runId, d.clientRefId, message);
        failed.push({
          episodeId: d.data.episodeId,
          title: d.data.title,
          reason: message,
        });
      }
      i += 1;
    }

    const outcome: z.infer<typeof StoryboardPhaseOutputSchema>["outcome"] =
      failed.length === 0 ? "committed" : "partial_failure";

    if (failed.length === 0) await deleteAllDrafts(runId);

    await reportProgress(runId, {
      stepId: "storyboard_phase.commit",
      current: committed.length,
      total: accepts.length,
      label: `分镜保存完成：成功 ${committed.length} / 失败 ${failed.length}`,
    });

    return {
      outcome,
      committed,
      failed,
      message:
        outcome === "committed"
          ? `已保存 ${committed.length} 集分镜，主流程结束。`
          : `保存有失败：${failed.length} / ${accepts.length}。`,
    };
  },
});

// ─── Compose ──────────────────────────────────────────────────────────

export const storyboardPhaseWorkflow = createWorkflow({
  id: "storyboard_phase",
  description:
    "分镜阶段：每集调分镜师出镜头 → HITL → 批量入库。支持 fromProjectOutline 自动读已入库剧集/剧本。",
  inputSchema: StoryboardPhaseInputSchema,
  outputSchema: StoryboardPhaseOutputSchema,
  stateSchema: StateSchema,
})
  .then(resolveInputStep)
  .then(generateStep)
  .then(waitConfirmationStep)
  .then(applyDecisionStep)
  .commit();

export type StoryboardPhaseOutput = z.infer<typeof StoryboardPhaseOutputSchema>;
