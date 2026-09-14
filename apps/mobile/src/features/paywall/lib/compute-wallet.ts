import { api } from "@/lib/api-client";

type WalletLedgerData = {
  accounts?: Array<{
    status?: string;
    availableBalance?: string;
  }>;
};

function wholePoints(value: string | undefined): string | null {
  if (!value || !/^\d+$/.test(value)) return null;
  return value;
}

/**
 * Personal compute-credit pot (`GET /aurora/billing/wallet-ledger`).
 * Returns null when unauthenticated or the ledger cannot be read — the UI
 * shows an em dash, not a fake zero.
 */
export async function fetchComputeWalletBalance(): Promise<string | null> {
  try {
    const data = await api.get<WalletLedgerData>("/billing/wallet-ledger", {
      service: "aurora",
      params: { currency: "compute_point", balanceKind: "consumable", limit: 1 },
    });
    const active = (data.accounts ?? []).filter((account) => account.status === "active");
    let total = 0n;
    for (const account of active) {
      const available = wholePoints(account.availableBalance);
      if (available) total += BigInt(available);
    }
    return total.toString();
  } catch {
    return null;
  }
}
