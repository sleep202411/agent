"use client";
import { useEffect, useRef, useState } from "react";
import { requestEnvelope, toErrorMessage } from "./shared";

const stages = [
  ["testing", "Testing"],
  ["story_testing", "Story testing / initial production"],
  ["production", "Formal production"],
  ["released", "Released / hot selling"],
] as const;
export function ProductionStageForm({
  ipId,
  initial,
  canApprove,
}: {
  ipId: string;
  initial: { stage: string; version: number };
  canApprove: boolean;
}) {
  const [current, setCurrent] = useState(initial);
  const [target, setTarget] = useState(initial.stage);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [saved, setSaved] = useState(false);
  const active = useRef<AbortController | null>(null);
  useEffect(
    () => () => {
      active.current?.abort();
      active.current = null;
    },
    []
  );
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (active.current || !canApprove || target === current.stage || !reason.trim()) return;
    const controller = new AbortController();
    active.current = controller;
    setPending(true);
    setError(null);
    setSaved(false);
    try {
      const data = await requestEnvelope<{ stage: string; version: number }>(
        `/api/admin/ip-commerce/ips/${encodeURIComponent(ipId)}/production-stage`,
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          signal: controller.signal,
          body: JSON.stringify({
            stage: target,
            expectedVersion: current.version,
            reason: reason.trim(),
          }),
        }
      );
      if (controller.signal.aborted) return;
      setCurrent(data);
      setReason("");
      setSaved(true);
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
      <h2 className="font-semibold">Production stage</h2>
      <p className="text-sm">
        {stages.find(([value]) => value === current.stage)?.[1]} · v{current.version}
      </p>
      {canApprove ? (
        <form onSubmit={submit} className="space-y-3">
          <label className="block text-sm">
            Approved stage
            <select
              value={target}
              onChange={(e) => setTarget(e.target.value)}
              disabled={pending}
              className="ml-3 rounded border border-slate-300 p-2"
            >
              {stages.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-sm">
            Review or correction reason
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              disabled={pending}
              required
              maxLength={1000}
              className="mt-1 block w-full rounded border border-slate-300 p-2"
            />
          </label>
          <p className="text-sm text-slate-600">
            Approval records the current evidence and your reason. It does not publish content or
            change media access.
          </p>
          <button
            type="submit"
            disabled={pending || !reason.trim() || target === current.stage}
            className="rounded bg-slate-900 px-3 py-2 text-sm text-white disabled:opacity-50"
          >
            {pending ? "Saving…" : "Approve stage change"}
          </button>
        </form>
      ) : null}
      {error ? (
        <p role="alert" className="text-sm text-red-700">
          {error}
        </p>
      ) : null}
      {saved ? (
        <p role="status" className="text-sm">
          Stage approval recorded.
        </p>
      ) : null}
    </section>
  );
}
