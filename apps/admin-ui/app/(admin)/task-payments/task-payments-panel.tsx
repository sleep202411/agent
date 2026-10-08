"use client";
import { useEffect, useRef, useState } from "react";
import { adminUiApiPath, parseAdminEnvelope } from "@/lib/admin-api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
type Task = {
  id: string;
  title: string;
  version: number;
  status: string;
  assignees: {
    userId: string;
    paymentTerms: string | null;
    currency: string;
    amountMinor: string;
    releasedAt: string | null;
    deductionMinor?: string;
    budgetSettlementRequired?: boolean;
  }[];
};
export function TaskPaymentsPanel() {
  const [query, setQuery] = useState("");
  const [task, setTask] = useState<Task | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const request = useRef<AbortController | null>(null);
  const [userId, setUserId] = useState("");
  const [receipt, setReceipt] = useState("");
  const [evidence, setEvidence] = useState("");
  const [funded, setFunded] = useState(false);
  const [milestone, setMilestone] = useState(false);
  useEffect(() => () => request.current?.abort(), []);
  async function api<T>(path: string, signal: AbortSignal, body?: unknown) {
    return parseAdminEnvelope<T>(
      await fetch(adminUiApiPath("/api/admin/task-payments" + path), {
        signal,
        cache: "no-store",
        method: body ? "POST" : "GET",
        headers: body ? { "Content-Type": "application/json" } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      })
    );
  }
  async function load() {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setBusy(true);
    setError("");
    setTask(null);
    setUserId("");
    setReceipt("");
    setEvidence("");
    setFunded(false);
    setMilestone(false);
    try {
      const id = query.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i)?.[0];
      if (!id) throw Error("Enter a task ID or task link.");
      const row = await api<Task>("/" + id, controller.signal);
      if (!controller.signal.aborted) setTask(row);
    } catch (e) {
      if (!controller.signal.aborted) setError(e instanceof Error ? e.message : "Request failed");
    } finally {
      if (!controller.signal.aborted) setBusy(false);
    }
  }
  const assignee = task?.assignees.find((a) => a.userId === userId);
  const eligible =
    task &&
    ["half_upfront", "on_completion"].includes(assignee?.paymentTerms ?? "") &&
    (assignee?.paymentTerms !== "on_completion" || task.status === "approved");
  async function release() {
    if (!task || !assignee || busy) return;
    const controller = new AbortController();
    request.current = controller;
    setBusy(true);
    setError("");
    try {
      await api("/" + task.id + "/release", controller.signal, {
        userId,
        expectedVersion: task.version,
        expectedAmountMinor: assignee.amountMinor,
        expectedDeductionMinor: assignee.deductionMinor ?? "0",
        currency: assignee.currency,
        paymentTerms: assignee?.paymentTerms,
        receiptReference: receipt,
        milestoneEvidence: evidence,
        fundsReceived: funded,
        milestoneConfirmed: milestone,
      });
      const row = await api<Task>("/" + task.id, controller.signal);
      if (!controller.signal.aborted) {
        setTask(row);
        setFunded(false);
        setMilestone(false);
        setUserId("");
      }
    } catch (e) {
      if (!controller.signal.aborted) setError(e instanceof Error ? e.message : "Request failed");
    } finally {
      if (!controller.signal.aborted) setBusy(false);
    }
  }
  return (
    <section className="space-y-6">
      <h1 className="text-xl font-semibold">任务付款</h1>
      <p className="text-sm text-muted-foreground">
        确认 FizzDragon
        已收款且制作节点完成后，再把约定报酬打入创作者可提现余额。银行打款在「提现审核」单独记录。
      </p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void load();
        }}
        className="flex gap-2"
      >
        <Input
          aria-label="Task ID or link"
          placeholder="Task ID or link"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          disabled={busy}
        />
        <Button disabled={busy || !query.trim()}>Load Task</Button>
      </form>
      {error && <p role="alert">{error}</p>}
      {task && (
        <div className="space-y-4">
          <h2 className="font-semibold">{task.title}</h2>
          <p>
            {task.status} ·{" "}
            {assignee?.paymentTerms === "half_upfront"
              ? "Reward 50% Upfront"
              : assignee?.paymentTerms === "on_completion"
                ? "Reward on Completion"
                : assignee?.paymentTerms === "demo_promise"
                  ? "Demo Promise"
                  : (assignee?.paymentTerms ?? "Unspecified")}
          </p>
          {!eligible && (
            <p>
              No escrow release is available. Completion rewards require approved delivery; Demo
              Promise does not create a cash reward.
            </p>
          )}
          <label className="block">
            Creator
            <select
              aria-label="Creator"
              className="ml-3 rounded border p-2"
              value={userId}
              disabled={busy}
              onChange={(e) => {
                setUserId(e.target.value);
                setFunded(false);
                setMilestone(false);
              }}
            >
              <option value="">Select Creator</option>
              {task.assignees.map((a) => (
                <option key={a.userId} value={a.userId}>
                  {a.userId} · {a.currency}{" "}
                  {`${BigInt(a.amountMinor) / BigInt(100)}.${(BigInt(a.amountMinor) % BigInt(100)).toString().padStart(2, "0")}`}
                  {a.releasedAt ? " · Released" : ""}
                </option>
              ))}
            </select>
          </label>
          {assignee?.budgetSettlementRequired && (
            <p>
              Close the project compute budget and approve its documented producer adjustment before
              payment.
            </p>
          )}
          {assignee && (
            <p>
              Agreed fee: {assignee.amountMinor} · Approved deduction:{" "}
              {assignee.deductionMinor ?? "0"} · Payable:{" "}
              {(BigInt(assignee.amountMinor) - BigInt(assignee.deductionMinor ?? "0")).toString()} (
              {assignee.currency} cents/fen)
            </p>
          )}
          {assignee && !assignee.releasedAt && eligible && !assignee.budgetSettlementRequired && (
            <div className="space-y-4">
              <label className="block">
                Receipt reference
                <Input
                  value={receipt}
                  maxLength={180}
                  disabled={busy}
                  onChange={(e) => setReceipt(e.target.value)}
                />
              </label>
              <label className="block">
                Milestone evidence
                <textarea
                  className="block w-full rounded border p-2"
                  maxLength={2000}
                  value={evidence}
                  disabled={busy}
                  onChange={(e) => setEvidence(e.target.value)}
                />
              </label>
              <label className="block">
                <input
                  type="checkbox"
                  checked={funded}
                  disabled={busy}
                  onChange={(e) => setFunded(e.target.checked)}
                />{" "}
                I verified FD received the full agreed reward for this creator.
              </label>
              <label className="block">
                <input
                  type="checkbox"
                  checked={milestone}
                  disabled={busy}
                  onChange={(e) => setMilestone(e.target.checked)}
                />{" "}
                {assignee?.paymentTerms === "half_upfront"
                  ? "I confirm production reached 50%."
                  : "I confirm production is completed and approved."}
              </label>
              <Button
                disabled={
                  busy ||
                  !funded ||
                  !milestone ||
                  !receipt.trim() ||
                  !evidence.trim() ||
                  BigInt(assignee.amountMinor) <= BigInt(0)
                }
                onClick={() => void release()}
              >
                Release Reward
              </Button>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
