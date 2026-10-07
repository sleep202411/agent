export type BatchWithdrawal = {
  id: string;
  userId: string;
  amountMinor: string;
  currency: string;
  recipientLabel: string;
  status: string;
  processingAdminId: string | null;
};
export type BatchResult = { status: "paid" | "failed"; message?: string };
type CurrentWithdrawal = BatchWithdrawal & {
  version: number;
  paymentReference: string | null;
  paidAdminId: string | null;
};
type Api = <T>(path: string, signal: AbortSignal, body?: unknown) => Promise<T>;

/** Each item retains the normal claim/version/payment transaction. A failed or
 * interrupted batch can be reconciled from authoritative per-request state. */
export async function recordWithdrawalBatch(options: {
  rows: BatchWithdrawal[];
  references: Record<string, string>;
  adminId: string;
  ensureProof: (id: string, signal: AbortSignal) => Promise<string>;
  signal: AbortSignal;
  api: Api;
  onResult: (id: string, result: BatchResult) => void;
}) {
  const { rows, references, adminId, signal, api, onResult, ensureProof } = options;
  if (!rows.length || rows.length > 50) throw new Error("Select between 1 and 50 withdrawals.");
  if (new Set(rows.map((row) => row.id)).size !== rows.length)
    throw new Error("A withdrawal can appear only once in a batch.");
  if (rows.some((row) => !references[row.id]?.trim() || references[row.id].trim().length > 180))
    throw new Error("Enter a transfer reference for every withdrawal (up to 180 characters).");
  for (const snapshot of rows) {
    signal.throwIfAborted();
    try {
      const current = await api<CurrentWithdrawal>(`/${snapshot.id}`, signal);
      signal.throwIfAborted();
      if (
        current.id !== snapshot.id ||
        current.userId !== snapshot.userId ||
        current.amountMinor !== snapshot.amountMinor ||
        current.currency !== snapshot.currency
      )
        throw new Error("Withdrawal details changed. Refresh and review this request.");
      const paymentReference = references[snapshot.id].trim();
      if (current.status === "paid") {
        if (current.paymentReference !== paymentReference || current.paidAdminId !== adminId)
          throw new Error(
            "This withdrawal was already paid with different payment details. Review its history."
          );
      } else {
        let version = current.version;
        if (current.status === "pending") {
          const claimed = await api<{ version: number }>(`/${snapshot.id}/decision`, signal, {
            action: "process",
            expectedVersion: version,
          });
          version = claimed.version;
        } else if (current.status !== "processing" || current.processingAdminId !== adminId) {
          throw new Error("This withdrawal is no longer available to you for payment recording.");
        }
        signal.throwIfAborted();
        const paymentProofId = await ensureProof(snapshot.id, signal);
        signal.throwIfAborted();
        if (!paymentProofId) throw new Error("Upload payment proof before recording the payment.");
        await api(`/${snapshot.id}/decision`, signal, {
          action: "pay",
          paymentProofId,
          expectedVersion: version,
          paymentReference,
        });
      }
      signal.throwIfAborted();
      onResult(snapshot.id, { status: "paid" });
    } catch (error) {
      if (signal.aborted) throw error;
      onResult(snapshot.id, {
        status: "failed",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }
}
