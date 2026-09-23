"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { StageApplication } from "@/lib/admin-ip-commerce";
import { requestEnvelope, toErrorMessage } from "./shared";
const labels: Record<string, string> = {
  story_testing: "Story testing",
  production: "Formal production",
  released: "Released",
};
export function StageApplicationReviews({
  ipId,
  initial,
  canReview,
}: {
  ipId: string;
  initial: StageApplication[];
  canReview: boolean;
}) {
  const router = useRouter();
  const [reviewed, setReviewed] = useState<StageApplication | null>(null);
  // Server refreshes own the list. Keep a completed local review visible while
  // its refresh is in flight, without masking newer server decisions.
  const items = initial.map((item) =>
    item.status === "pending" && item.id === reviewed?.id ? reviewed : item
  );
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const active = useRef<AbortController | null>(null);
  const pendingId = items.find((item) => item.status === "pending")?.id ?? null;
  const [reasonFor, setReasonFor] = useState(pendingId);
  if (reasonFor !== pendingId) {
    setReasonFor(pendingId);
    setReason("");
    setError(null);
  }
  useEffect(
    () => () => {
      active.current?.abort();
      active.current = null;
    },
    []
  );
  async function review(id: string, decision: "approved" | "rejected") {
    if (active.current || !reason.trim() || !canReview) return;
    const controller = new AbortController();
    active.current = controller;
    setPending(true);
    setError(null);
    try {
      const item = await requestEnvelope<StageApplication>(
        `/api/admin/ip-commerce/ips/${encodeURIComponent(ipId)}/stage-applications/${encodeURIComponent(id)}/review`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          signal: controller.signal,
          body: JSON.stringify({ decision, reason: reason.trim() }),
        }
      );
      if (!controller.signal.aborted) {
        setReviewed(item);
        setReason("");
        router.refresh();
      }
    } catch (e) {
      if (!controller.signal.aborted) setError(toErrorMessage(e));
    } finally {
      if (active.current === controller) {
        active.current = null;
        setPending(false);
      }
    }
  }
  return (
    <section className="space-y-3 border-y border-slate-200 py-4">
      <h2 className="font-semibold">Recent stage applications (up to 20)</h2>
      {error ? (
        <p role="alert" className="text-red-700">
          {error}
        </p>
      ) : null}
      {!items.length ? <p>No applications yet.</p> : null}
      {items.map((item) => (
        <article key={item.id} className="space-y-2 py-2 text-sm">
          <h3 className="font-medium">
            {labels[item.stage] ?? item.stage} · {item.status}
          </h3>
          <p className="text-xs text-slate-500">Applicant: {item.applicantId}</p>
          <p className="whitespace-pre-wrap">{item.reason}</p>
          {item.reviewReason ? (
            <p className="whitespace-pre-wrap">Review: {item.reviewReason}</p>
          ) : null}
          {item.status === "pending" && canReview ? (
            <>
              <label className="block">
                Review reason
                <textarea
                  className="mt-1 block w-full rounded border border-slate-300 p-2"
                  value={reason}
                  maxLength={1000}
                  onChange={(e) => setReason(e.target.value)}
                  disabled={pending}
                />
              </label>
              <div className="flex gap-3">
                <button
                  type="button"
                  disabled={pending || !reason.trim()}
                  onClick={() => void review(item.id, "approved")}
                  className="rounded bg-slate-900 px-3 py-2 text-white disabled:opacity-50"
                >
                  Approve application
                </button>
                <button
                  type="button"
                  disabled={pending || !reason.trim()}
                  onClick={() => void review(item.id, "rejected")}
                  className="rounded border border-slate-300 px-3 py-2 disabled:opacity-50"
                >
                  Reject application
                </button>
              </div>
            </>
          ) : null}
        </article>
      ))}
    </section>
  );
}
