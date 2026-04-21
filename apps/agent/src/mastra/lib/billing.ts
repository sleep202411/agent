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
    const info = await javaRequest<{ scoreBalance?: number }>(ctx, "/user/query/user/info", {
      method: "GET",
    });
    const v = Number(info.scoreBalance ?? 0);
    return Number.isFinite(v) ? v : 0;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[billing] getUserBalance failed (assuming Infinity): ${msg}`);
    return Number.POSITIVE_INFINITY;
  }
}

// ─── Deduction (stubbed) ───────────────────────────────────────────────

const BILLING_DEDUCT_STUBBED = true;

export interface DeductResult {
  success: boolean;
  remainingBalance?: number;
  insufficient?: boolean;
  error?: string;
}

export interface DeductArgs {
  amount: number;
  reason: string;
  /**
   * Stable within-a-run key so a retried call doesn't double-charge.
   * Convention: `${runId}:${phase}:generation`. Java must treat this as
   * a uniqueness constraint and return the first result on collision.
   */
  idempotencyKey: string;
}

/**
 * Deducts `amount` credits from the active user. Returns success/failure
 * without throwing — the caller's contract is "log and continue on miss".
 *
 * While stubbed (BILLING_DEDUCT_STUBBED = true) this only logs; flip the
 * flag once Java's endpoint is ready and replace the body with the real
 * javaRequest call.
 */
export async function deductCredits(ctx: StoryosContext, args: DeductArgs): Promise<DeductResult> {
  if (args.amount <= 0) return { success: true, remainingBalance: undefined };

  if (BILLING_DEDUCT_STUBBED) {
    console.log(
      `[billing:stub] deduct userId=${ctx.userId} amount=${args.amount} reason="${args.reason}" key=${args.idempotencyKey}`
    );
    return { success: true };
  }

  // Real implementation — enable after Java endpoint ships.
  try {
    const resp = await javaRequest<{
      success?: boolean;
      remainingBalance?: number;
      error?: string;
      currentBalance?: number;
    }>(ctx, "/api/user/credits/deduct", {
      method: "POST",
      data: {
        userId: ctx.userId,
        amount: args.amount,
        reason: args.reason,
        idempotencyKey: args.idempotencyKey,
      },
    });
    if (resp.error === "INSUFFICIENT") {
      console.warn(
        `[billing] deduct INSUFFICIENT userId=${ctx.userId} needed=${args.amount} balance=${resp.currentBalance} reason="${args.reason}"`
      );
      return {
        success: false,
        insufficient: true,
        remainingBalance: resp.currentBalance,
      };
    }
    return {
      success: resp.success === true,
      remainingBalance: resp.remainingBalance,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
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
 * Rough per-workflow cost estimate, in credits. Passing the project
 * detail lets us size by episode count; without it we fall back to a
 * "typical 10-episode project" assumption.
 */
export function estimateWorkflowCost(
  name: WorkflowName,
  detail: ProjectParamsDetail | null
): number {
  const n = Math.max(1, detail?.chapterLength ?? 10);
  switch (name) {
    case "main_flow":
      // Novel → full pipeline. Assume #roles ≈ #scenes ≈ n (good for
      // dramas with rotating locations) and #props ≈ n/2. Storyboard is
      // the heavyweight (15 × n) so it dominates the estimate.
      return (
        PRICES.storyOutlineRun +
        n * PRICES.rolePerUnit +
        n * PRICES.scenePerUnit +
        Math.ceil(n / 2) * PRICES.propPerUnit +
        n * PRICES.episodePerUnit +
        n * PRICES.scriptPerEpisode +
        n * PRICES.storyboardPerEpisode
      );
    case "script_to_storyboard_flow":
      // Parse + storyboard only. No roles/scenes/props/scripts.
      return n * PRICES.parseScriptPerEpisode + n * PRICES.storyboardPerEpisode;
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
