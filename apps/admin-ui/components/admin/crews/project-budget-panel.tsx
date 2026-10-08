"use client";
import { useEffect, useRef, useState } from "react";
import { adminUiApiPath } from "@/lib/admin-api";
import { Button } from "@/components/ui/button";
type Plan = {
  crewName: string;
  consumedPoints: string;
  committedPoints: string;
  releasedPoints: string;
  producerOptions: {
    taskId: string;
    title: string;
    userId: string;
    amountMinor: string;
    currency: string;
  }[];
  budget: null | {
    version: number;
    data: {
      durationSeconds: number;
      totalPoints: string;
      producerTaskId: string;
      producerUserId: string;
      stages: { key: string; points: number; note: string; adminId: string; at: string }[];
      settlement: null | {
        grossMinor: string;
        deductionMinor: string;
        currency: string;
        overrunPoints: string;
        note: string;
      };
    };
  };
};
export function ProjectBudgetPanel({ crewId }: { crewId: string }) {
  const [plan, setPlan] = useState<Plan>();
  const [revision, setRevision] = useState(0);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [minutes, setMinutes] = useState("");
  const [producer, setProducer] = useState("");
  const [points, setPoints] = useState("");
  const [deduction, setDeduction] = useState("0");
  const [note, setNote] = useState("");
  const [overrun, setOverrun] = useState(false);
  const operation = useRef<AbortController | null>(null);
  const releaseKey = useRef<string | null>(null);
  const endpoint = adminUiApiPath(
    `/api/admin/crew-compute-requests/${encodeURIComponent(crewId)}/budget`
  );
  useEffect(() => () => operation.current?.abort(), []);
  useEffect(() => {
    const abort = new AbortController();
    fetch(endpoint, { signal: abort.signal, cache: "no-store" })
      .then(async (res) => {
        const body = await res.json();
        if (!res.ok || body.code !== 200)
          throw Error(body.message || body.msg || "Budget could not be loaded");
        if (!abort.signal.aborted) setPlan(body.data);
      })
      .catch((e) => {
        if (!abort.signal.aborted) setError(String(e));
      });
    return () => abort.abort();
  }, [endpoint, revision]);
  async function change(input: Record<string, unknown>) {
    if (!plan || operation.current) return;
    const abort = new AbortController();
    operation.current = abort;
    setBusy(true);
    setError("");
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        signal: abort.signal,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...input, expectedVersion: plan.budget?.version ?? 0, note }),
      });
      const body = await res.json();
      if (!res.ok || body.code !== 200)
        throw Error(body.message || body.msg || "Budget update failed");
      if (!abort.signal.aborted) {
        releaseKey.current = null;
        setPlan(undefined);
        setRevision((x) => x + 1);
        setNote("");
      }
    } catch (e) {
      if (!abort.signal.aborted) setError(String(e));
    } finally {
      if (!abort.signal.aborted) {
        operation.current = null;
        setBusy(false);
      }
    }
  }
  const chosen = plan?.producerOptions.find((x) => `${x.taskId}:${x.userId}` === producer);
  const owner = plan?.producerOptions.find(
    (x) =>
      x.taskId === plan.budget?.data.producerTaskId && x.userId === plan.budget?.data.producerUserId
  );
  const closed = plan?.budget?.data.settlement;
  const style = "rounded border bg-background p-2";
  return (
    <section className="space-y-3 border-y py-4">
      <h2 className="font-semibold">Project compute budget · {plan?.crewName ?? crewId}</h2>
      <p className="text-sm text-muted-foreground">
        4,462 points per minute for the whole project. Staged releases authorize spending from its
        dedicated workspace; they do not top up the wallet. Producer deductions require documented
        FD Admin approval.
      </p>
      {error && <p role="alert">{error}</p>}
      <Button
        variant="outline"
        disabled={busy}
        onClick={() => {
          setError("");
          setPlan(undefined);
          setRevision((x) => x + 1);
        }}
      >
        Refresh budget
      </Button>
      {!plan ? (
        <p>Loading budget…</p>
      ) : (
        <fieldset disabled={busy} className="space-y-3">
          {plan.budget && (
            <p>
              Total: {plan.budget.data.totalPoints} · Released: {plan.releasedPoints} · Consumed:{" "}
              {plan.consumedPoints} · Committed including holds: {plan.committedPoints}
            </p>
          )}
          <label className="block">
            Decision reason / evidence
            <textarea
              className={`${style} block w-full`}
              value={note}
              onChange={(e) => {
                setNote(e.target.value);
                releaseKey.current = null;
              }}
            />
          </label>
          {!plan.budget ? (
            <div className="flex flex-wrap gap-3">
              <label>
                Agreed project duration (minutes)
                <input
                  className={`${style} block`}
                  type="number"
                  min="0.1"
                  step="0.1"
                  value={minutes}
                  onChange={(e) => setMinutes(e.target.value)}
                />
              </label>
              <label>
                Producer fee assignment
                <select
                  className={`${style} block`}
                  value={producer}
                  onChange={(e) => setProducer(e.target.value)}
                >
                  <option value="">Select assignment</option>
                  {plan.producerOptions.map((x) => (
                    <option key={`${x.taskId}:${x.userId}`} value={`${x.taskId}:${x.userId}`}>
                      {x.title} · {x.userId} · {x.currency}{" "}
                      {`${BigInt(x.amountMinor) / 100n}.${(BigInt(x.amountMinor) % 100n).toString().padStart(2, "0")}`}
                    </option>
                  ))}
                </select>
              </label>
              <Button
                disabled={!chosen || !(Number(minutes) > 0) || !note.trim()}
                onClick={() =>
                  void change({
                    action: "configure",
                    durationSeconds: Math.round(Number(minutes) * 60),
                    producerTaskId: chosen!.taskId,
                    producerUserId: chosen!.userId,
                  })
                }
              >
                Configure project budget
              </Button>
            </div>
          ) : closed ? (
            <div className="space-y-2">
              <p>
                Compute closed. Producer fee: {closed.grossMinor} · Deduction:{" "}
                {closed.deductionMinor} · Payable:{" "}
                {(BigInt(closed.grossMinor) - BigInt(closed.deductionMinor)).toString()} (
                {closed.currency} minor units). Overrun: {closed.overrunPoints} points.
              </p>
              <p>{closed.note}</p>
              <Button disabled={!note.trim()} onClick={() => void change({ action: "reopen" })}>
                Reopen for review before payment
              </Button>
            </div>
          ) : (
            <>
              <div className="flex flex-wrap items-end gap-3">
                <label>
                  Stage points
                  <input
                    className={`${style} block`}
                    type="number"
                    min="1"
                    step="1"
                    value={points}
                    onChange={(e) => {
                      setPoints(e.target.value);
                      releaseKey.current = null;
                    }}
                  />
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked={overrun}
                    onChange={(e) => setOverrun(e.target.checked)}
                  />{" "}
                  Explicitly authorize release beyond total budget
                </label>
                <Button
                  disabled={
                    !Number.isSafeInteger(Number(points)) || Number(points) <= 0 || !note.trim()
                  }
                  onClick={() => {
                    releaseKey.current ??= crypto.randomUUID();
                    void change({
                      action: "release",
                      requestKey: releaseKey.current,
                      points: Number(points),
                      allowOverrun: overrun,
                    });
                  }}
                >
                  Release stage
                </Button>
              </div>
              <div className="flex flex-wrap items-end gap-3">
                <label>
                  Producer deduction ({owner?.currency ?? "currency"}, cents/fen)
                  <input
                    className={`${style} block`}
                    type="number"
                    min="0"
                    step="1"
                    value={deduction}
                    onChange={(e) => setDeduction(e.target.value)}
                  />
                </label>
                <Button
                  disabled={!owner || !/^\d+$/.test(deduction) || !note.trim()}
                  onClick={() =>
                    void change({
                      action: "close",
                      expectedConsumedPoints: plan.consumedPoints,
                      expectedGrossMinor: owner!.amountMinor,
                      deductionMinor: deduction,
                    })
                  }
                >
                  Close compute and approve settlement adjustment
                </Button>
              </div>
            </>
          )}
          {plan.budget?.data.stages.map((s) => (
            <p key={s.key} className="text-sm">
              {s.points} points · {s.note} · Admin {s.adminId} · {new Date(s.at).toLocaleString()}
            </p>
          ))}
        </fieldset>
      )}
    </section>
  );
}
