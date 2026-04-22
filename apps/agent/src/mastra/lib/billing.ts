/**
 * Credit-deduction billing for generative workflows.
 *
 * Strategy (decided 2026-04-21):
 *   - **Generation cost is incurred when LLM produces drafts**, so we
 *     charge at `applyDecisionStep` time regardless of user approval.
 *     Rejecting drafts still costs credits because the LLM call already
 *     burned tokens. Only a workflow that THROWS before applyDecisionStep
 *     (generation failed, process crashed, HITL TTL expired) escapes free.
 *   - **Image phases are NOT our concern** — Java handles image-gen
 *     deduction directly. Same for generate_project_cover.
 *   - **No pending / reconciliation / refund** book-keeping. If deduct
 *     returns 402 or Java is down, we log and proceed (content already
 *     produced → user gets a freebie for that call). The preflight gate
 *     catches the common "not enough credits" case upstream, so this
 *     edge only hits when balance drops during HITL wait.
 *
 * Java contract (to be confirmed with backend):
 *   POST /api/user/credits/deduct
 *     { userId, amount, reason, idempotencyKey }
 *     → 200 { success: true, remainingBalance }
 *     → 402 { error: "INSUFFICIENT", currentBalance }
 *   GET  /user/query/user/info
 *     → { scoreBalance, ... }   (already exists — see apps/web/src/services/user.ts)
 *
 * `deductCredits` is currently a STUB that logs-and-succeeds so we can
 * ship billing UX / HITL button labels / preflight on the agent side
 * before Java delivers the endpoint. Flip `BILLING_DEDUCT_STUBBED` to
 * false once the real endpoint lands.
 */
import { getContext, javaRequest, type StoryosContext } from "./workspace-client";
import type { ProjectParamsDetail } from "@repo/shared/project-params";
import type { WorkflowName } from "./redis-keys";

// ─── Price table ───────────────────────────────────────────────────────
//
// Units are "credits per successfully generated draft" unless noted.
// Values are placeholders — business to finalise. Changing these only
// affects new workflow runs; historical runs keep whatever was charged.
// Image phases and generate_project_cover are intentionally absent —
// Java charges those itself.

export const PRICES = {
  parseScriptPerEpisode: 1,
  storyOutlineRun: 5, // fixed (no HITL draft count to multiply)
  rolePerUnit: 2,
  scenePerUnit: 2,
  propPerUnit: 1,
  episodePerUnit: 2,
  scriptPerEpisode: 8,
  storyboardPerEpisode: 15,
  scriptEditRun: 10,
  roleDesignPerUnit: 2,
  sceneDesignPerUnit: 2,
  propDesignPerUnit: 1,
} as const;

// ─── Balance read ──────────────────────────────────────────────────────

/**
 * Returns current score balance from Java. If the call fails we return
 * Infinity so the preflight gate doesn't falsely block users on a
 * transient Java outage — deduction later will log the miss.
 */
export async function getUserBalance(ctx: StoryosContext): Promise<number> {
  try {
    // Java may return `null` for dev/anonymous users — treat as
    // "unknown, don't block" by returning Infinity.
    const info = (await javaRequest<{ scoreBalance?: number } | null>(
      ctx,
      "/user/query/user/info",
      { method: "GET" }
    )) as { scoreBalance?: number } | null;
    if (!info) {
      console.warn(
        "[billing] getUserBalance: Java returned null info (dev user?); assuming Infinity"
      );
      return Number.POSITIVE_INFINITY;
    }
    const v = Number(info.scoreBalance ?? 0);
    return Number.isFinite(v) ? v : 0;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[billing] getUserBalance failed (assuming Infinity): ${msg}`);
    return Number.POSITIVE_INFINITY;
  }
}

// ─── Deduction ─────────────────────────────────────────────────────────

export interface DeductResult {
  success: boolean;
  remainingBalance?: number;
  insufficient?: boolean;
  error?: string;
}

export interface DeductArgs {
  amount: number;
  /** Human-readable reason; maps to Java's `input` field. */
  reason: string;
  /**
   * Stable within-a-run key so a retried call doesn't double-charge.
   * Convention: `${runId}:${phase}:generation`. Java must treat this as
   * a uniqueness constraint and return the first result on collision.
   */
  idempotencyKey: string;
}

/**
 * Deducts `amount` credits from the active user against Java's
 * `POST /api/ai/chat/credits/deduct` endpoint. Returns success/failure
 * without throwing — the caller's contract is "log and continue on miss",
 * because generation cost has already been incurred by the time we get here.
 *
 * Fields on the Java side:
 *   - model: fixed "STORY_OS" (marks this deduct as coming from storyos)
 *   - input: our `reason` string
 *   - amount: credits to deduct
 *   - worldId: pulled from requestContext (required)
 *   - idempotencyKey: for retry safety
 */
export async function deductCredits(ctx: StoryosContext, args: DeductArgs): Promise<DeductResult> {
  if (args.amount <= 0) return { success: true, remainingBalance: undefined };

  // Java endpoint needs worldId. Missing it means the workflow is running
  // in a project without a world — shouldn't happen for generative phases,
  // but don't block generation on the deduct call: log + no-op.
  if (!ctx.worldId) {
    console.warn(
      `[billing] deduct skipped (no worldId) userId=${ctx.userId} amount=${args.amount} reason="${args.reason}"`
    );
    return { success: false, error: "missing worldId" };
  }

  try {
    const resp = await javaRequest<{ remainingBalance?: number } | null>(
      ctx,
      "/api/ai/chat/credits/deduct",
      {
        method: "POST",
        data: {
          model: "STORY_OS",
          input: args.reason,
          amount: args.amount,
          worldId: Number(ctx.worldId),
          idempotencyKey: args.idempotencyKey,
        },
      }
    );
    // javaRequest already threw on non-success. We only land here when
    // the deduct went through; balance may or may not be returned.
    return {
      success: true,
      remainingBalance: resp?.remainingBalance,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // Best-effort heuristic — Java signals insufficient credits via a
    // specific code in the message. Keep the check loose so we still
    // classify correctly if the exact wording shifts.
    const insufficient = /insufficient|不足|余额/i.test(msg);
    if (insufficient) {
      console.warn(
        `[billing] deduct INSUFFICIENT userId=${ctx.userId} needed=${args.amount} reason="${args.reason}": ${msg}`
      );
      return { success: false, insufficient: true, error: msg };
    }
    console.warn(
      `[billing] deduct failed userId=${ctx.userId} amount=${args.amount} reason="${args.reason}": ${msg}`
    );
    return { success: false, error: msg };
  }
}

// ─── Cost estimation ───────────────────────────────────────────────────
//
// Used by preflight (invoke_workflow) to show "this run will cost ~X" and
// reject with INSUFFICIENT_CREDITS before any LLM fires. Real charge is
// exact (based on generated draft counts); estimate is a conservative
// upper bound so users don't hit insufficient mid-run.

/**
 * Rough per-workflow cost estimate, in credits. Caller passes the user's
 * chosen target episode count (from ctx.targetEpisodeCount) so estimation
 * matches what the workflow will actually slice; without it we fall back
 * to "typical 10-episode project" assumption. Project detail is still
 * accepted for historic callers / future per-style surcharges.
 */
export function estimateWorkflowCost(
  name: WorkflowName,
  detail: ProjectParamsDetail | null,
  targetEpisodeCount?: number | null
): number {
  const n = Math.max(
    1,
    typeof targetEpisodeCount === "number" && targetEpisodeCount > 0 ? targetEpisodeCount : 10
  );
  void detail; // Reserved for future per-style/per-duration surcharges.
  switch (name) {
    case "parse_script":
      return n * PRICES.parseScriptPerEpisode;
    case "story_outline":
      return PRICES.storyOutlineRun;
    case "role_phase":
      return n * PRICES.rolePerUnit;
    case "scene_phase":
      return n * PRICES.scenePerUnit;
    case "prop_phase":
      return Math.ceil(n / 2) * PRICES.propPerUnit;
    case "episode_phase":
      return n * PRICES.episodePerUnit;
    case "script_phase":
      return n * PRICES.scriptPerEpisode;
    case "storyboard_phase":
      return n * PRICES.storyboardPerEpisode;
    case "script_edit":
      return PRICES.scriptEditRun;
    case "role_design":
      return n * PRICES.roleDesignPerUnit;
    case "scene_design":
      return n * PRICES.sceneDesignPerUnit;
    case "prop_design":
      return Math.ceil(n / 2) * PRICES.propDesignPerUnit;
    case "role_image_phase":
    case "scene_image_phase":
    case "prop_image_phase":
    case "batch_create_asset":
      return 0; // image phases + asset batch-insert are free / Java-side
    default: {
      // Exhaustive check: any new WorkflowName added to the type union
      // without a case here will turn `name` into `never` at compile
      // time, so this branch catches missed entries.
      const _exhaustive: never = name;
      void _exhaustive;
      return 0;
    }
  }
}

// ─── Convenience: idempotency keys ────────────────────────────────────

/**
 * Per-phase deduct key. `{runId}:{phase}:generation` is the canonical
 * shape — keeping construction centralized so naming stays consistent
 * across phase files.
 */
export function phaseDeductKey(runId: string, phase: string): string {
  return `${runId}:${phase}:generation`;
}
