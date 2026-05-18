/**
 * Build-time cell identifier.
 *
 * A "cell" is a fully self-contained deployment of the platform with its
 * own data plane (DB, object storage, realtime, secrets). We run exactly
 * two cells in production:
 *
 *   - "com" — Azure Singapore, serves all non-China traffic (US/EU/JP/...)
 *   - "cn"  — Alibaba Mainland, serves China traffic only
 *
 * The cells are intentionally **isolated** — no shared data, no
 * cross-cell sync. PIPL + 网络安全法 mandate this for the cn side; the
 * com side is unitary even across countries because cross-region
 * isolation isn't a legal requirement outside China.
 *
 * Differences *within* the com cell (e.g., GDPR cookie banner for EU
 * users, Stripe-vs-local-payment for US users) are handled per-request
 * via the Country layer (see `country.ts`), not via additional cells.
 *
 * "global" is the local-dev fallback when no env var is set. Treat it
 * as the most permissive cell — all features enabled — so dev can
 * exercise code paths that gate to either real cell.
 */

export const CELLS = ["com", "cn", "global"] as const;
export type Cell = (typeof CELLS)[number];

export const CURRENT_CELL: Cell = (() => {
  const raw = process.env.NEXT_PUBLIC_SITE_REGION;
  if (raw === "com" || raw === "cn") return raw;
  return "global";
})();

// ─── Currency policy ─────────────────────────────────────
//
// Mirrors `apps/server/src/crews/currency.ts` — the server is the
// last word, but exposing the same policy here lets dialogs hide
// disabled options pre-emptively (e.g. CN cell shows CNY only, no
// "currency picker" rendered at all).

import { ALL_CURRENCIES, type CurrencyCode } from "@repo/shared/crew";

/** Whitelist of currencies allowed in the current cell. */
export function allowedCurrenciesForCell(): readonly CurrencyCode[] {
  if (CURRENT_CELL === "cn") return ["CNY"];
  return ALL_CURRENCIES;
}

/** Default currency to pre-fill new forms with. */
export function defaultCurrencyForCell(): CurrencyCode {
  return CURRENT_CELL === "cn" ? "CNY" : "USD";
}
