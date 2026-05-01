/**
 * parse_script — slice a user-uploaded 剧本 into N episode entries + script
 * content, commit to Java.
 *
 * Use case: user uploaded a finished script (not a novel/synopsis). We
 * don't want to re-write it through script_breakdown → episode_phase →
 * script_phase (which would *generate* new text from scratch and drop
 * the user's original). Instead, keep the original verbatim; just split
 * it into episodes along natural 章/场/幕 boundaries.
 *
 * Flow:
 *   1. resolve_input     — echo through + number source lines
 *   2. split             — scriptSplitter persona returns
 *                          [{title, introduction, startLine, endLine}]
 *   3. collect_drafts    — slice source by line ranges, write one draft
 *                          per episode (title + intro + verbatim content)
 *   4. wait_confirmation — HITL (user can rename / drop splits)
 *   5. apply_decision    — Java: batch/updateOrAdd/episode + then
 *                          scripts/episode/batch/createOrUpdate
 *
 * Distinct from episode_phase + script_phase because:
 *   - no LLM creative writing (content is verbatim from source)
 *   - no story outline required (no Redis outline:{projectId} dependency)
 *   - one HITL gate instead of two (episode + script combined)
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
} from "../lib/drafts";
import { reportProgress, throwIfCancelled } from "./engine";
import { getContext, javaRequest } from "../lib/workspace-client";
import { putOutline, type StoryOutline } from "../lib/outline";
import { putArtifact } from "../lib/artifact-store";
import {
  publishWorkflowCompleted,
  publishWorkflowFailed,
  publishWorkflowProgress,
  publishWorkflowSuspended,
} from "../lib/workflow-messages";
import { PRICES, deductCredits, phaseDeductKey } from "../lib/billing";

// ─── Schemas ───────────────────────────────────────────────────────────

export const ParseScriptInputSchema = z.object({
  projectId: z.string().min(1),
  /** Raw script text. Resolved from textRef by invoke_workflow. */
  text: z.string().min(1),
  /** Target number of episodes to split into. */
  targetEpisodeCount: z.number().int().min(1).max(60).default(10),
  /** Optional user feedback for a revise pass. */
  feedback: z.string().optional(),
});

const SplitEntry = z.object({
  title: z.string().min(1).max(30),
  introduction: z.string().min(1).max(400),
  /** 1-based inclusive line number (into the source). */
  startLine: z.coerce.number().int().min(1),
  endLine: z.coerce.number().int().min(1),
});

export const ParseScriptOutputSchema = z.object({
  outcome: z.enum(["committed", "rejected", "partial_failure"]),
  committed: z.array(z.object({ serverId: z.string(), title: z.string(), chars: z.number() })),
  failed: z.array(z.object({ clientRefId: z.string(), title: z.string(), reason: z.string() })),
  message: z.string(),
});

const DraftShape = z.object({
  title: z.string(),
  introduction: z.string(),
  content: z.string(),
  sortHint: z.number(),
});

const StateSchema = z.object({
  draftClientRefIds: z.array(z.string()).default([]),
});

const ResumeSchema = z.object({
  approved: z.boolean(),
  feedback: z.string().optional(),
  acceptedClientRefIds: z.array(z.string()).optional(),
  /**
   * When true, apply_decision deletes the project's existing episodes
   * (and their downstream scripts/storyboards as Java cascades) before
   * persisting this batch. Surfaced via the HITL card's "替换 / 追加"
   * toggle, populated only when the suspend payload reported a non-
   * zero `existingEpisodeCount`.
   */
  replaceExisting: z.boolean().optional(),
});

const SuspendSchema = z.object({
  runId: z.string(),
  episodeCount: z.number(),
  /** Echoed for the HITL UI so the toggle binds without an extra fetch. */
  existingEpisodeCount: z.number().optional(),
  phase: z.literal("parse_script"),
});

// ─── Step 1: split (LLM) ──────────────────────────────────────────────

const splitStep = createStep({
  id: "split",
  inputSchema: ParseScriptInputSchema,
  outputSchema: z.object({ draftCount: z.number() }),
  stateSchema: StateSchema,
  execute: async ({ inputData, setState, mastra, requestContext }) => {
    const runId = requestContext?.get("runId") as string | undefined;
    if (!runId) throw new Error("runId missing");
    await throwIfCancelled(runId);
    const ctx = getContext(requestContext);

    const splitter = mastra?.getAgent("scriptSplitter");
    if (!splitter) throw new Error("scriptSplitter agent not registered");

    // Normalize line endings, trim trailing whitespace per line (preserves
    // intentional blank-line paragraphs which carry structural meaning).
    const rawLines = inputData.text.replace(/\r\n/g, "\n").split("\n");
    const totalLines = rawLines.length;

    const startLabel = `Script splitter starting (${totalLines} lines → target ${inputData.targetEpisodeCount} episodes)`;
    await reportProgress(runId, {
      stepId: "parse_script.split",
      current: 0,
      total: inputData.targetEpisodeCount,
      label: startLabel,
    });
    await publishWorkflowProgress(ctx.projectId, runId, "parse_script", "planning", {
      current: 0,
      total: inputData.targetEpisodeCount,
      label: startLabel,
    });

    const numbered = rawLines.map((l, i) => `${i + 1}: ${l}`).join("\n");
    const feedbackBlock = inputData.feedback
      ? `\n\n[User feedback (must be followed)]\n${inputData.feedback}\n`
      : "";
    const prompt = [
      `Target episode count: ${inputData.targetEpisodeCount}`,
      `Total lines (totalLines): ${totalLines}`,
      "",
      "Full script with line numbers:",
      "```",
      numbered,
      "```",
      feedbackBlock,
      "",
      `Return exactly ${inputData.targetEpisodeCount} episodes. Every entry's startLine/endLine must be inclusive, strictly contiguous, and land in [1, ${totalLines}].`,
    ]
      .filter(Boolean)
      .join("\n");

    const personaProvider = process.env.STORYOS_PERSONA_PROVIDER ?? "(unset)";
    const personaModel = process.env.STORYOS_PERSONA_MODEL ?? "(default)";
    console.log(
      `[parse-script] split.start runId=${runId} provider=${personaProvider} model=${personaModel} promptChars=${prompt.length} totalLines=${totalLines} target=${inputData.targetEpisodeCount}`
    );

    let response;
    try {
      response = await splitter.generate(prompt, {
        structuredOutput: {
          schema: z.object({ episodes: z.array(SplitEntry) }),
          errorStrategy: "strict",
        },
      });
    } catch (err) {
      const detail = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
      const stack = err instanceof Error ? err.stack : undefined;
      const cause =
        err instanceof Error && (err as { cause?: unknown }).cause
          ? JSON.stringify((err as { cause?: unknown }).cause, null, 2).slice(0, 800)
          : undefined;
      console.error(
        `[parse-script] split.LLM_FAILED runId=${runId} provider=${personaProvider} model=${personaModel} → ${detail}`
      );
      if (cause) console.error(`[parse-script] split.LLM_FAILED cause: ${cause}`);
      if (stack) console.error(`[parse-script] split.LLM_FAILED stack:\n${stack}`);
      throw err;
    }

    const rawEpisodes =
      (response.object as { episodes?: z.infer<typeof SplitEntry>[] } | undefined)?.episodes ?? [];
    console.log(
      `[parse-script] split.LLM_OK runId=${runId} returnedEpisodes=${rawEpisodes.length} sampleTitle=${JSON.stringify(rawEpisodes[0]?.title ?? "")}`
    );
    if (rawEpisodes.length === 0) {
      console.error(
        `[parse-script] split.NO_EPISODES runId=${runId} response.text=${JSON.stringify(
          (response as { text?: string }).text?.slice(0, 500) ?? "(no .text)"
        )}`
      );
      throw new Error("scriptSplitter returned no episodes");
    }

    // Clamp line ranges to [1, totalLines] and enforce strict ordering —
    // DeepSeek occasionally returns overlapping / reversed ranges when
    // the script is dense with scene headers.
    const clamped = rawEpisodes
      .map((e) => ({
        title: e.title.trim(),
        introduction: e.introduction.trim(),
        startLine: Math.max(1, Math.min(totalLines, Math.floor(e.startLine))),
        endLine: Math.max(1, Math.min(totalLines, Math.floor(e.endLine))),
      }))
      .filter((e) => e.endLine >= e.startLine)
      .sort((a, b) => a.startLine - b.startLine)
      .slice(0, inputData.targetEpisodeCount);

    if (clamped.length === 0) {
      throw new Error("All returned episode line ranges were invalid; split failed");
    }

    // Stitch gaps: if episode i ends before episode i+1 starts - 1, extend
    // i's endLine to cover the gap. If i ends past i+1's start, trim i
    // back to i+1.startLine - 1. First episode always starts at 1; last
    // always ends at totalLines (no missing trailer).
    const stitched: Array<{
      title: string;
      introduction: string;
      startLine: number;
      endLine: number;
    }> = [];
    for (let i = 0; i < clamped.length; i++) {
      const ep = { ...clamped[i] };
      if (i === 0) ep.startLine = 1;
      if (i === clamped.length - 1) ep.endLine = totalLines;
      if (i > 0) {
        const prev = stitched[i - 1];
        if (ep.startLine <= prev.endLine) ep.startLine = prev.endLine + 1;
        if (ep.endLine < ep.startLine) ep.endLine = ep.startLine;
      }
      stitched.push(ep);
    }
    // Second pass: make sure each ep's start is exactly prev.end + 1 (no gaps).
    for (let i = 1; i < stitched.length; i++) {
      const prev = stitched[i - 1];
      const curr = stitched[i];
      if (curr.startLine > prev.endLine + 1) {
        prev.endLine = curr.startLine - 1;
      }
    }

    // Slice + persist drafts.
    const draftClientRefIds: string[] = [];
    for (let i = 0; i < stitched.length; i++) {
      const ep = stitched[i];
      // rawLines is 0-indexed; startLine/endLine are 1-based inclusive.
      const content = rawLines
        .slice(ep.startLine - 1, ep.endLine)
        .join("\n")
        .trim();
      const clientRefId = randomUUID();
      await putDraft(runId, "episode", clientRefId, {
        title: ep.title,
        introduction: ep.introduction,
        content,
        sortHint: i,
      });
      draftClientRefIds.push(clientRefId);
    }

    setState({ draftClientRefIds });

    const doneLabel = `Split into ${stitched.length} episode drafts — awaiting confirmation`;
    await reportProgress(runId, {
      stepId: "parse_script.split",
      current: stitched.length,
      total: stitched.length,
      label: doneLabel,
    });
    await publishWorkflowProgress(ctx.projectId, runId, "parse_script", "planning", {
      current: stitched.length,
      total: stitched.length,
      label: doneLabel,
    });

    return { draftCount: stitched.length };
  },
});

// ─── Step 2: HITL ─────────────────────────────────────────────────────

const waitConfirmationStep = createStep({
  id: "wait_confirmation",
  inputSchema: z.object({ draftCount: z.number() }),
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
    const ctx = getContext(requestContext);

    if (!resumeData) {
      await reportProgress(runId, {
        stepId: "parse_script.confirm",
        current: inputData.draftCount,
        total: inputData.draftCount,
        label: `${inputData.draftCount} episodes split — awaiting confirmation`,
      });
      const drafts = await listDrafts<z.infer<typeof DraftShape>>(runId, {
        entityType: "episode",
        statuses: ["pending"],
      });
      // Query Java for the project's current episode count so the HITL
      // card can offer an append-vs-replace toggle. Test sessions tend
      // to accumulate stale episodes from earlier parse_script runs;
      // without surfacing the count, users have no way to clear them
      // beyond manually deleting episode-by-episode in the studio.
      // Soft-fail: a Java hiccup just hides the toggle (UI defaults to
      // append, which is the legacy behaviour).
      let existingEpisodeCount = 0;
      try {
        const listed = await javaRequest<{ list?: Array<{ id: string | number }> }>(
          ctx,
          "/api/user/world/list/episode",
          { data: { productId: ctx.projectId, page: 1, pageSize: 999 } }
        );
        existingEpisodeCount = (listed.list ?? []).length;
      } catch (err) {
        console.warn(
          `[parse-script] existing episode count lookup failed: ${err instanceof Error ? err.message : String(err)}`
        );
      }
      // No nextAction — after approval parse_script's completion emits a
      // 2-option nextSteps card (full-asset path vs straight-to-storyboard)
      // for the user to pick downstream. The suspended card button should
      // just be "Done · N credits" (approve current drafts + commit), not
      // "Continue …" which misleads into thinking the next phase runs
      // immediately.
      await publishWorkflowSuspended(ctx.projectId, runId, "parse_script", {
        draftGroups: [
          {
            entityType: "episode",
            count: drafts.length,
            items: drafts.map((d) => ({
              clientRefId: d.clientRefId,
              data: d.data as unknown as Record<string, unknown>,
            })),
          },
        ],
        totalDraftCount: drafts.length,
        estimatedCost: drafts.length * PRICES.parseScriptPerEpisode,
        ...(existingEpisodeCount > 0 ? { existingEpisodeCount } : {}),
      });
      return await suspend({
        runId,
        episodeCount: inputData.draftCount,
        existingEpisodeCount,
        phase: "parse_script" as const,
      });
    }
    return resumeData;
  },
});

// ─── Step 3: commit (episodes + scripts, batched) ─────────────────────

const SORT_GAP = 1024;

function scriptToTiptapHtml(text: string): string {
  if (!text) return "";
  const escaped = (s: string): string =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const paragraphs = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => `<p>${escaped(line)}</p>`);
  return paragraphs.join("\n");
}

/**
 * Synthesize a minimal StoryOutline from a successfully-parsed user
 * script so downstream phases (script_phase / role_phase /
 * episode_phase / prop_phase / scene_phase) that hard-depend on
 * `getOutline(projectId)` don't blow up with "no story outline cached"
 * the moment a user takes the docx-direct path.
 *
 * The shape is intentionally skeletal — we only know what parse_script
 * gave us (a list of episode titles + introductions + raw source text).
 * Cast / settings / props stay empty; downstream phases that need richer
 * fields can either run brief_analyzer to enrich, or fall back to the
 * empty default. The artifact's `source: "parse_script"` lets any future
 * enrichment step detect synthetic outlines vs. real story_outline runs.
 */
function buildSyntheticOutline(
  committed: Array<{ serverId: string; title: string }>,
  rawText: string,
  episodeMeta: Map<string, { introduction: string }>
): StoryOutline {
  const trimmedText = rawText.trim();
  // Cap at 500 chars so the summary stays card-friendly. The real
  // story_outline persona produces something tighter, but a verbatim
  // head of the source is at least faithful to the user's input.
  const summary = trimmedText.length > 500 ? `${trimmedText.slice(0, 500).trim()}…` : trimmedText;

  return {
    storySummary: summary,
    genre: "",
    tone: "",
    structure: committed.map((ep, idx) => ({
      chapterId: ep.serverId,
      title: ep.title,
      summary: episodeMeta.get(ep.serverId)?.introduction ?? "",
      keyEvents: [],
      emotion: "",
      hookToNext: idx < committed.length - 1 ? committed[idx + 1].title : undefined,
    })),
    threads: { main: "", subs: [] },
    cast: [],
    settings: [],
    props: [],
  };
}

const applyDecisionStep = createStep({
  id: "apply_decision",
  inputSchema: z.object({
    approved: z.boolean(),
    feedback: z.string().optional(),
    acceptedClientRefIds: z.array(z.string()).optional(),
    replaceExisting: z.boolean().optional(),
  }),
  outputSchema: ParseScriptOutputSchema,
  stateSchema: StateSchema,
  execute: async ({ inputData, state, requestContext, getInitData }) => {
    const runId = requestContext?.get("runId") as string | undefined;
    if (!runId) throw new Error("runId missing");
    await throwIfCancelled(runId);

    const ctx = getContext(requestContext);
    const rawInput = getInitData<z.infer<typeof ParseScriptInputSchema>>();
    const projectId = rawInput.projectId || ctx.projectId;
    const draftClientRefIds = state.draftClientRefIds ?? [];

    // Charge regardless of approved/rejected — LLM cost incurred at split.
    if (draftClientRefIds.length > 0) {
      await deductCredits(ctx, {
        amount: draftClientRefIds.length * PRICES.parseScriptPerEpisode,
        reason: `parse_script ${draftClientRefIds.length} drafts (approved=${inputData.approved})`,
        idempotencyKey: phaseDeductKey(runId, "parse_script"),
      });
    }

    if (!inputData.approved) {
      for (const id of draftClientRefIds) await markDraftDiscarded(runId, id);
      await publishWorkflowFailed(ctx.projectId, runId, "parse_script", {
        terminalStatus: "cancelled",
        error: inputData.feedback
          ? `User requested changes: ${inputData.feedback}`
          : "User rejected.",
        retryable: false,
      });
      return {
        outcome: "rejected" as const,
        committed: [],
        failed: [],
        message: inputData.feedback
          ? `Parse rejected. Feedback: ${inputData.feedback}`
          : "Parse rejected.",
      };
    }

    const accepted = new Set(inputData.acceptedClientRefIds ?? draftClientRefIds);
    const drafts = await listDrafts<z.infer<typeof DraftShape>>(runId, {
      entityType: "episode",
      statuses: ["pending"],
    });
    const accepts = drafts
      .filter((d) => accepted.has(d.clientRefId))
      .sort((a, b) => a.data.sortHint - b.data.sortHint);

    for (const it of accepts) await markDraftCommitting(runId, it.clientRefId);

    // ── Phase A0 (optional): wipe existing episodes when user opted in ──
    // Triggered from the HITL card's "替换" toggle (vs the default
    // "追加"). We delete every existing episode before the upsert so
    // the project ends with exactly the new batch. Soft-fails per
    // record: a Java hiccup on one delete doesn't cascade — the new
    // batch still upserts and the user gets an explanatory warning
    // line in the workflow's progress label. Java's downstream
    // tables (scripts / storyboards / shots) cascade-delete with the
    // episode, so this fully clears the old run.
    if (inputData.replaceExisting) {
      try {
        const listed = await javaRequest<{ list?: Array<{ id: string | number }> }>(
          ctx,
          "/api/user/world/list/episode",
          { data: { productId: projectId, page: 1, pageSize: 999 } }
        );
        const ids = (listed.list ?? []).map((e) => String(e.id)).filter(Boolean);
        const totalToDelete = ids.length;
        if (totalToDelete > 0) {
          const wipeLabel = `Replacing existing episodes: 0/${totalToDelete}`;
          await reportProgress(runId, {
            stepId: "parse_script.commit.wipe",
            current: 0,
            total: totalToDelete,
            label: wipeLabel,
          });
          await publishWorkflowProgress(ctx.projectId, runId, "parse_script", "committing", {
            current: 0,
            total: totalToDelete,
            label: wipeLabel,
          });
          let wiped = 0;
          let wipeFailed = 0;
          for (const epId of ids) {
            try {
              await javaRequest<unknown>(
                ctx,
                `/api/user/world/delete/episode?id=${encodeURIComponent(epId)}`
              );
              wiped += 1;
            } catch (err) {
              wipeFailed += 1;
              console.warn(
                `[parse-script] replaceExisting: delete episode ${epId} failed: ${err instanceof Error ? err.message : String(err)}`
              );
            }
            await publishWorkflowProgress(ctx.projectId, runId, "parse_script", "committing", {
              current: wiped + wipeFailed,
              total: totalToDelete,
              label: `Replacing existing episodes: ${wiped + wipeFailed}/${totalToDelete}`,
            });
          }
          console.log(
            `[parse-script] replaceExisting: wiped ${wiped}/${totalToDelete} (failed=${wipeFailed})`
          );
        }
      } catch (err) {
        // Listing failed — skip wipe, proceed with append (safer
        // default than aborting the whole commit). Surface in logs
        // so the divergence from user intent is auditable.
        console.warn(
          `[parse-script] replaceExisting: list lookup failed, falling back to append: ${err instanceof Error ? err.message : String(err)}`
        );
      }
    }

    // ── Phase A: batch upsert episode metadata ──
    const episodeStartLabel = `Saving metadata for ${accepts.length} episodes…`;
    await reportProgress(runId, {
      stepId: "parse_script.commit.episodes",
      current: 0,
      total: accepts.length,
      label: episodeStartLabel,
    });
    await publishWorkflowProgress(ctx.projectId, runId, "parse_script", "committing", {
      current: 0,
      total: accepts.length,
      label: episodeStartLabel,
    });

    const episodeDatas = accepts.map((d, idx) => ({
      title: d.data.title,
      introduction: d.data.introduction,
      frontPrompt: "",
      behindPrompt: "",
      projectId,
      sort: (idx + 1) * SORT_GAP,
    }));

    const committed: z.infer<typeof ParseScriptOutputSchema>["committed"] = [];
    const failed: z.infer<typeof ParseScriptOutputSchema>["failed"] = [];
    const serverIdByDraftRef = new Map<string, string>();

    try {
      await javaRequest<unknown>(ctx, "/api/user/world/batch/updateOrAdd/episode", {
        data: { datas: episodeDatas },
        timeoutMs: 120_000,
      });
      const listed = await javaRequest<{ list?: Array<{ id: string | number; sort?: number }> }>(
        ctx,
        "/api/user/world/list/episode",
        { data: { productId: projectId, page: 1, pageSize: 999 } }
      );
      const bySort = new Map(
        (listed.list ?? []).map((ep) => [Number(ep.sort ?? 0), String(ep.id)])
      );
      for (let i = 0; i < accepts.length; i++) {
        const d = accepts[i];
        const sortKey = (i + 1) * SORT_GAP;
        const serverId = bySort.get(sortKey);
        if (serverId) {
          serverIdByDraftRef.set(d.clientRefId, serverId);
        } else {
          await markDraftFailed(
            runId,
            d.clientRefId,
            "Episode insert succeeded but id lookup missed"
          );
          failed.push({
            clientRefId: d.clientRefId,
            title: d.data.title,
            reason: "id lookup missed",
          });
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      for (const d of accepts) {
        await markDraftFailed(runId, d.clientRefId, message);
        failed.push({
          clientRefId: d.clientRefId,
          title: d.data.title,
          reason: message,
        });
      }
    }

    // ── Phase B: batch upsert script content (only for episodes that got
    // a serverId in Phase A) ──
    const toScript = accepts.filter((d) => serverIdByDraftRef.has(d.clientRefId));
    if (toScript.length > 0) {
      const scriptStartLabel = `Saving script body for ${toScript.length} episodes…`;
      await reportProgress(runId, {
        stepId: "parse_script.commit.scripts",
        current: 0,
        total: toScript.length,
        label: scriptStartLabel,
      });
      await publishWorkflowProgress(ctx.projectId, runId, "parse_script", "committing", {
        current: 0,
        total: toScript.length,
        label: scriptStartLabel,
      });

      const episodeIds = toScript.map((d) => serverIdByDraftRef.get(d.clientRefId)!);
      const contents = toScript.map((d) => scriptToTiptapHtml(d.data.content));

      try {
        await javaRequest<unknown>(ctx, "/api/user/project/scripts/episode/batch/createOrUpdate", {
          data: { projectId, episodeIds, contents },
          timeoutMs: 300_000,
        });
        for (const d of toScript) {
          const serverId = serverIdByDraftRef.get(d.clientRefId)!;
          await markDraftCommitted(runId, d.clientRefId, serverId);
          committed.push({
            serverId,
            title: d.data.title,
            chars: d.data.content.length,
          });
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        for (const d of toScript) {
          await markDraftFailed(runId, d.clientRefId, `script save failed: ${message}`);
          failed.push({
            clientRefId: d.clientRefId,
            title: d.data.title,
            reason: `script save failed: ${message}`,
          });
        }
      }
    }

    const outcome: z.infer<typeof ParseScriptOutputSchema>["outcome"] =
      failed.length === 0
        ? "committed"
        : committed.length === 0
          ? "partial_failure"
          : "partial_failure";

    if (failed.length === 0) await deleteAllDrafts(runId);

    // Synthesize a skeleton story outline so downstream phases (which all
    // gate on `getOutline(projectId)`) find SOMETHING when the user takes
    // the docx-direct path. Best-effort: a failure here must not roll back
    // the parse_script commit. See `buildSyntheticOutline` for shape and
    // why most fields end up empty.
    if (committed.length > 0) {
      try {
        const introByServerId = new Map(
          accepts
            .filter((d) => serverIdByDraftRef.has(d.clientRefId))
            .map((d) => [
              serverIdByDraftRef.get(d.clientRefId)!,
              { introduction: d.data.introduction },
            ])
        );
        const synthetic = buildSyntheticOutline(committed, rawInput.text, introByServerId);
        await putOutline(projectId, synthetic, {
          runId,
          // Distinct hash so a real story_outline run later can detect
          // "this outline came from parse_script, please overwrite".
          sourceHash: `parse_script:${runId}`,
        });
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn(
          `[parse_script] synthetic outline write failed (non-fatal):`,
          err instanceof Error ? err.message : err
        );
      }

      // Persist the raw user-uploaded source as a `user_doc` artifact so
      // downstream stages and the supervisor can detect "this project's
      // material came from a docx upload" — useful for analytics, future
      // enrichment passes (e.g. brief_analyzer running over the original
      // text), and for letting the supervisor explain provenance to the
      // user. Independent of the synthetic outline above; either may
      // succeed without the other.
      try {
        await putArtifact({
          projectId,
          kind: "user_doc",
          source: "parse_script",
          content: {
            text: rawInput.text,
            episodeCount: committed.length,
            committedEpisodeIds: committed.map((c) => c.serverId),
          },
          meta: { runId },
        });
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn(
          `[parse_script] user_doc artifact write failed (non-fatal):`,
          err instanceof Error ? err.message : err
        );
      }
    }

    const endLabel = `Split committed: ${committed.length} ok / ${failed.length} failed`;
    await reportProgress(runId, {
      stepId: "parse_script.commit",
      current: committed.length,
      total: accepts.length,
      label: endLabel,
    });
    await publishWorkflowProgress(ctx.projectId, runId, "parse_script", "committing", {
      current: committed.length,
      total: accepts.length,
      label: endLabel,
    });

    // Emit a locale-agnostic i18n key + params for the UI. The internal
    // `message` on the tool return stays a plain English log string — it
    // only ends up in server logs / worker metrics, never rendered to the
    // user.
    const summaryKey =
      outcome === "committed" ? "parseScriptSummaryCommitted" : "parseScriptSummaryPartial";
    const summaryParams =
      outcome === "committed"
        ? { count: committed.length }
        : { failed: failed.length, total: accepts.length };
    const logMessage =
      outcome === "committed"
        ? `committed ${committed.length} episodes`
        : `partial failure: ${failed.length}/${accepts.length}`;

    // After parse_script, user picks the downstream path:
    //   - Full assets (role → scene → prop → storyboard) via story_outline
    //   - Straight to storyboard (skip role/scene/prop assets) via storyboard_phase
    // Replaces the former script_import_flow / script_to_storyboard_flow
    // parent workflows — LLM or button decides which branch.
    await publishWorkflowCompleted(ctx.projectId, runId, "parse_script", {
      committed: committed.map((c) => ({ serverId: c.serverId, title: c.title })),
      failed: failed.map((f) => ({ clientRefId: f.clientRefId, reason: f.reason })),
      summaryKey,
      summaryParams,
      nextSteps: [
        {
          workflowName: "story_outline",
          labelKey: "workflowNextContinueToFullAssets",
          variant: "primary",
        },
        {
          workflowName: "storyboard_phase",
          labelKey: "workflowNextContinueToStoryboard",
          variant: "secondary",
          // Only storyboard the episodes we just imported, not every
          // episode with a script in the project (there may be older
          // imports / generated scripts the user isn't asking to redo).
          inputData: { onlyEpisodeIds: committed.map((c) => c.serverId) },
        },
      ],
    });

    return {
      outcome,
      committed,
      failed,
      message: logMessage,
    };
  },
});

// ─── Compose ──────────────────────────────────────────────────────────

export const parseScriptWorkflow = createWorkflow({
  id: "parse_script",
  description:
    "Script slicing: split a user-uploaded complete script into N episodes along natural scene/act/chapter boundaries → HITL → commit episode + script (verbatim source). Skips script_breakdown / script_phase.",
  inputSchema: ParseScriptInputSchema,
  outputSchema: ParseScriptOutputSchema,
  stateSchema: StateSchema,
})
  .then(splitStep)
  .then(waitConfirmationStep)
  .then(applyDecisionStep)
  .commit();

export type ParseScriptOutput = z.infer<typeof ParseScriptOutputSchema>;
