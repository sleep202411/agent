"use client";
import { useEffect, useRef, useState } from "react";
import { adminUiApiPath, parseAdminEnvelope } from "@/lib/admin-api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { recordWithdrawalBatch, type BatchResult, type BatchWithdrawal } from "./withdrawal-batch";

export function WithdrawalBatchDialog({
  rows,
  adminId,
  money,
  onClose,
}: {
  rows: BatchWithdrawal[];
  adminId: string;
  money: (amount: string, currency: string) => string;
  onClose: () => void;
}) {
  const [files, setFiles] = useState<Record<string, File>>({});
  const proofs = useRef<Record<string, { file: File; id: string }>>({});
  const [references, setReferences] = useState<Record<string, string>>({});
  const [results, setResults] = useState<Record<string, BatchResult>>({});
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const operation = useRef<AbortController | null>(null);
  useEffect(() => () => operation.current?.abort(), []);
  const remaining = rows.filter((row) => results[row.id]?.status !== "paid");
  const done = rows.length - remaining.length;
  const ready =
    remaining.length > 0 &&
    remaining.every((row) => references[row.id]?.trim() && files[row.id]) &&
    confirmed;
  async function record() {
    if (operation.current || !ready) return;
    const controller = new AbortController();
    operation.current = controller;
    setBusy(true);
    setError("");
    try {
      await recordWithdrawalBatch({
        rows: remaining,
        references,
        ensureProof: async (id, signal) => {
          const file = files[id];
          if (!file) throw new Error("Upload payment proof for this withdrawal.");
          if (proofs.current[id]?.file === file) return proofs.current[id].id;
          const form = new FormData();
          form.set("file", file);
          const result = await parseAdminEnvelope<{ id: string }>(
            await fetch(adminUiApiPath(`/api/admin/creator-withdrawals/${id}/proofs`), {
              method: "POST",
              body: form,
              signal,
              cache: "no-store",
            })
          );
          signal.throwIfAborted();
          proofs.current[id] = { file, id: result.id };
          return result.id;
        },
        adminId,
        signal: controller.signal,
        api: async <T,>(path: string, signal: AbortSignal, body?: unknown) =>
          parseAdminEnvelope<T>(
            await fetch(adminUiApiPath(`/api/admin/creator-withdrawals${path}`), {
              method: body === undefined ? "GET" : "POST",
              signal,
              cache: "no-store",
              headers: { "Content-Type": "application/json" },
              body: body === undefined ? undefined : JSON.stringify(body),
            })
          ),
        onResult: (id, result) => {
          if (!controller.signal.aborted) setResults((previous) => ({ ...previous, [id]: result }));
        },
      });
    } catch (e) {
      if (!controller.signal.aborted) setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (!controller.signal.aborted) {
        operation.current = null;
        setBusy(false);
      }
    }
  }
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <DialogContent
        className="sm:max-w-2xl max-h-[85dvh] overflow-y-auto"
        showCloseButton={!busy}
        onEscapeKeyDown={(event) => {
          if (busy) event.preventDefault();
        }}
        onInteractOutside={(event) => {
          if (busy) event.preventDefault();
        }}
      >
        <DialogHeader>
          <DialogTitle>Record batch payments</DialogTitle>
          <DialogDescription>
            Confirm completed bank transfers for each request. This records payments; it does not
            send money. Attach payment proof for each request; the recipient can view it after
            payment.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          {rows.map((row) => (
            <div key={row.id} className="space-y-2 border-b pb-3">
              <div className="flex flex-wrap justify-between gap-2 text-sm">
                <span>{row.recipientLabel}</span>
                <strong className="tabular-nums">{money(row.amountMinor, row.currency)}</strong>
              </div>
              <p className="break-all text-xs text-muted-foreground">
                Request {row.id} · Creator {row.userId}
              </p>
              <label className="block text-sm" htmlFor={`batch-reference-${row.id}`}>
                Transfer reference{" "}
                <span className="text-destructive" aria-hidden="true">
                  *
                </span>
              </label>
              <Input
                id={`batch-reference-${row.id}`}
                aria-label={`Transfer reference for ${row.id}`}
                required
                maxLength={180}
                disabled={busy || results[row.id]?.status === "paid"}
                value={references[row.id] ?? ""}
                onChange={(event) => {
                  setReferences((previous) => ({ ...previous, [row.id]: event.target.value }));
                  setConfirmed(false);
                }}
              />
              <label className="block text-sm" htmlFor={`batch-proof-${row.id}`}>
                Payment proof *
              </label>
              <Input
                id={`batch-proof-${row.id}`}
                type="file"
                required
                accept=".pdf,.jpg,.jpeg,.png"
                disabled={busy || results[row.id]?.status === "paid"}
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  delete proofs.current[row.id];
                  setConfirmed(false);
                  const valid = file && file.size > 0 && file.size <= 10 * 1024 * 1024;
                  setFiles((previous) => {
                    const next = { ...previous };
                    if (valid) next[row.id] = file;
                    else delete next[row.id];
                    return next;
                  });
                  setError(
                    file && !valid ? "Upload a PDF, JPG or PNG payment proof up to 10 MB." : ""
                  );
                  if (file && !valid) event.target.value = "";
                }}
              />
              {results[row.id]?.status === "paid" && <p className="text-sm">Payment recorded</p>}
              {results[row.id]?.status === "failed" && (
                <p role="alert" className="text-sm text-destructive">
                  {results[row.id].message}
                </p>
              )}
            </div>
          ))}
          <p role="status" className="text-sm">
            {done} of {rows.length} payments recorded{busy ? " · Recording…" : ""}
          </p>
          {remaining.length > 0 && (
            <label className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                checked={confirmed}
                disabled={busy}
                onChange={(event) => setConfirmed(event.target.checked)}
                className="mt-1"
              />
              I confirm these bank transfers have already completed and the references are correct.
            </label>
          )}
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" disabled={busy} onClick={onClose}>
            {done === rows.length ? "Done" : "Close and refresh"}
          </Button>
          {remaining.length > 0 && (
            <Button disabled={busy || !ready} onClick={() => void record()}>
              {busy
                ? "Recording…"
                : Object.keys(results).length
                  ? "Retry remaining payments"
                  : "Confirm paid"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
