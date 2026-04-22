/**
 * Operator-visibility routes.
 *
 * GET /admin/hardening-stats
 *   Snapshot of the Claude hardening middleware: current queue depth,
 *   circuit state, 1-hour fallback counts. 200 with `{ enabled: false }`
 *   when the router isn't Anthropic (nothing to report).
 *
 * GET /admin/healthz
 *   Cheap boot-check. Returns 200 as soon as the Mastra server has
 *   finished initialising. Meant for orchestrators / uptime probes.
 *
 * No auth gate here — these routes expose no user data, only aggregate
 * process-local counters. If you still want to restrict access, do it at
 * the nginx layer (allow specific IPs / basic-auth). Keeping them open
 * lets a developer curl them without juggling cookies.
 */
import { registerApiRoute } from "@mastra/core/server";
import { getHardeningStats } from "../lib/model-hardening";
import { getRedis } from "../lib/redis-client";
import { setStatus, clearCancel } from "../workflows/engine/state";
import { publishWorkflowFailed } from "../lib/workflow-messages";
import type { WorkflowMeta } from "../workflows/engine/types";
import { WORKFLOW_NAMES, type WorkflowName } from "../lib/redis-keys";

export const adminRoutes = [
  registerApiRoute("/admin/hardening-stats", {
    method: "GET",
    handler: async (c) => {
      const stats = getHardeningStats();
      if (!stats) {
        return c.json({
          enabled: false,
          message:
            "Hardening not active. Either the router provider isn't Anthropic or no Claude call has fired yet.",
        });
      }
      return c.json({
        enabled: true,
        ...stats,
        now: Date.now(),
      });
    },
  }),

  registerApiRoute("/admin/healthz", {
    method: "GET",
    handler: async (c) => {
      return c.json({ ok: true, now: Date.now() });
    },
  }),

  /**
   * One-shot cleanup: scan Redis for workflow meta entries with
   * status=suspended (left behind by pre-Stage-C runs that used Mastra's
   * suspend/resume) and mark them cancelled. Publishes workflow_failed
   * events so the frontend's stale card flips to "cancelled" state.
   *
   * Safe to call repeatedly — only acts on status=suspended entries, and
   * the setStatus call is idempotent for already-cancelled runs.
   *
   * Usage: `curl -X POST http://localhost:4111/admin/cleanup-suspended`
   *
   * Optional query:
   *   - `dryRun=true` — report what would be cancelled, don't mutate
   *   - `olderThanHours=24` — only cancel runs whose updatedAt is older
   *     than N hours (default 0 = all suspended)
   */
  registerApiRoute("/admin/cleanup-suspended", {
    method: "POST",
    handler: async (c) => {
      const dryRun = c.req.query("dryRun") === "true";
      const olderThanHoursRaw = c.req.query("olderThanHours");
      const olderThanMs =
        olderThanHoursRaw && Number.isFinite(Number(olderThanHoursRaw))
          ? Number(olderThanHoursRaw) * 3600 * 1000
          : 0;
      const cutoff = Date.now() - olderThanMs;

      const redis = getRedis();
      const scanned: string[] = [];
      let cursor = "0";
      do {
        const [next, keys] = await redis.scan(
          cursor,
          "MATCH",
          "workflow:run:*:state",
          "COUNT",
          500
        );
        cursor = next;
        scanned.push(...keys);
      } while (cursor !== "0");

      const targeted: Array<{ runId: string; workflowName: string; updatedAt: number }> = [];
      const cancelled: string[] = [];
      const skipped: Array<{ runId: string; reason: string }> = [];

      for (const key of scanned) {
        const raw = await redis.get(key);
        if (!raw) continue;
        let meta: WorkflowMeta;
        try {
          meta = JSON.parse(raw) as WorkflowMeta;
        } catch {
          skipped.push({ runId: key, reason: "malformed meta" });
          continue;
        }
        if (meta.status !== "suspended") continue;
        const updatedAt = meta.updatedAt ?? meta.startedAt ?? 0;
        if (updatedAt > cutoff) {
          skipped.push({ runId: meta.runId, reason: "newer than olderThanHours" });
          continue;
        }
        targeted.push({ runId: meta.runId, workflowName: meta.workflowName, updatedAt });

        if (dryRun) continue;

        const workflowName = (WORKFLOW_NAMES as readonly string[]).includes(meta.workflowName)
          ? (meta.workflowName as WorkflowName)
          : (meta.workflowName as WorkflowName);
        try {
          await setStatus(meta.runId, "cancelled", { error: "cleanup: stale suspended run" });
          await clearCancel(meta.runId);
          await publishWorkflowFailed(meta.workspaceId, meta.runId, workflowName, {
            terminalStatus: "cancelled",
            error: "清理过期挂起的 workflow（Stage C 迁移前遗留）",
            retryable: false,
          });
          cancelled.push(meta.runId);
        } catch (err) {
          skipped.push({
            runId: meta.runId,
            reason: err instanceof Error ? err.message : String(err),
          });
        }
      }

      return c.json({
        ok: true,
        dryRun,
        olderThanHours: olderThanHoursRaw ? Number(olderThanHoursRaw) : 0,
        scanned: scanned.length,
        targetedCount: targeted.length,
        cancelledCount: cancelled.length,
        skippedCount: skipped.length,
        targeted,
        skipped,
      });
    },
  }),
];
