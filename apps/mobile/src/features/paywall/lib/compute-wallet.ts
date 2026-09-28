import { api } from "@/lib/api-client";

type WalletLedgerData = {
  accounts?: {
    status?: unknown;
    availableBalance?: unknown;
  }[];
};

function wholePoints(value: unknown): string | null {
  return typeof value === "string" && /^\d+$/.test(value) ? value : null;
}

/**
 * Personal compute-credit pot (`GET /aurora/billing/wallet-ledger`).
 * Returns null when unauthenticated or the ledger cannot be read — the UI
 * shows an em dash, not a fake zero.
 */
export async function fetchComputeWalletBalance(signal?: AbortSignal): Promise<string | null> {
  try {
    const data = await api.get<WalletLedgerData>("/billing/wallet-ledger", {
      service: "aurora",
      signal,
      cache: "no-store",
      params: { currency: "compute_point", balanceKind: "consumable", limit: 1 },
    });
    if (!Array.isArray(data.accounts)) return null;
    let total = 0n;
    for (const account of data.accounts) {
      // Missing fields must not turn an unreadable balance into a believable
      // zero/partial total. Only known inactive accounts may be excluded.
      if (account.status === "frozen" || account.status === "closed") continue;
      if (account.status !== "active") return null;
      const available = wholePoints(account.availableBalance);
      if (available === null) return null;
      total += BigInt(available);
    }
    return total.toString();
  } catch {
    return null;
  }
}
