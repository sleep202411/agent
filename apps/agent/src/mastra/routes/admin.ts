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
];
