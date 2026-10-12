"use client";
import { useEffect, useRef, useState } from "react";
import { adminUiApiPath } from "@/lib/admin-api";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
type Request = {
  id: string;
  crewName: string;
  requesterId: string;
  kind: string;
  input: unknown;
  review: unknown;
  createdAt: string;
};
type Queue = { items: Request[]; nextCursor: string | null };
async function request<T>(path: string, signal: AbortSignal, body?: unknown): Promise<T> {
  const response = await fetch(adminUiApiPath(`/api/admin/crew-task-requests${path}`), {
    method: body ? "POST" : "GET",
    signal,
    cache: "no-store",
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await response.json();
  if (!response.ok || data?.code !== 200)
    throw new Error(data?.message || data?.msg || `Request failed (${response.status})`);
  return data.data;
}
const fieldLabels: Record<string, string> = {
  title: "Task",
  description: "Description",
  taskKind: "Category",
  assignees: "Assigned creators",
  userId: "Creator",
  rewardUsdMinor: "Agreed fee (minor currency units)",
  rewardCurrency: "Currency",
  profitShareBps: "Revenue share (basis points)",
  computeBudgetPoints: "Initial points per assignee",
  dueAt: "Deadline",
  evidence: "Source excerpt",
  requiredSkills: "Required skills",
  positionRole: "Required role",
  deliveryFields: "Delivery requirements",
  error: "Source unavailable",
};
function ReviewFields({ value }: { value: unknown }) {
  if (value === null || value === undefined) return <span>—</span>;
  if (Array.isArray(value))
    return (
      <ol className="list-decimal space-y-3 pl-5">
        {value.map((item, index) => (
          <li key={index}>
            <ReviewFields value={item} />
          </li>
        ))}
      </ol>
    );
  if (typeof value === "object")
    return (
      <dl className="space-y-2">
        {Object.entries(value).map(([key, item]) => (
          <div key={key} className="grid gap-1 sm:grid-cols-[180px_minmax(0,1fr)]">
            <dt className="text-sm text-muted-foreground">
              {fieldLabels[key] ?? key.replace(/([A-Z])/g, " $1")}
            </dt>
            <dd className="min-w-0 whitespace-pre-wrap break-words text-sm">
              <ReviewFields value={item} />
            </dd>
          </div>
        ))}
      </dl>
    );
  return <span>{String(value)}</span>;
}
export function TaskRequestsPanel() {
  const [queue, setQueue] = useState<Queue>({ items: [], nextCursor: null });
  const [cursor, setCursor] = useState("");
  const [revision, setRevision] = useState(0);
  const [selected, setSelected] = useState<Request | null>(null);
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const decision = useRef<AbortController | null>(null);
  useEffect(() => () => decision.current?.abort(), []);
  useEffect(() => {
    const controller = new AbortController();
    request<Queue>(cursor ? `?cursor=${encodeURIComponent(cursor)}` : "", controller.signal)
      .then((result) => {
        if (!controller.signal.aborted) setQueue(result);
      })
      .catch((cause) => {
        if (!controller.signal.aborted) setError(String(cause.message));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [cursor, revision]);
  async function decide(value: "approved" | "rejected") {
    if (!selected || decision.current) return;
    const controller = new AbortController();
    decision.current = controller;
    setBusy(true);
    setError("");
    try {
      await request(`/${encodeURIComponent(selected.id)}/decision`, controller.signal, {
        decision: value,
        note,
      });
      if (!controller.signal.aborted) {
        setSelected(null);
        setNote("");
        setLoading(true);
        setError("");
        setCursor("");
        setRevision((r) => r + 1);
      }
    } catch (cause) {
      if (!controller.signal.aborted)
        setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      decision.current = null;
      if (!controller.signal.aborted) setBusy(false);
    }
  }
  return (
    <section className="space-y-4">
      <h1 className="text-xl font-semibold">Task requests</h1>
      <p>
        YH reviews all task submissions, including generated batches. Approval creates the tasks and
        any agreed initial allowances. Rejection creates neither.
      </p>
      <Button
        disabled={busy}
        onClick={() => {
          setLoading(true);
          setError("");
          setCursor("");
          setRevision((r) => r + 1);
        }}
      >
        Refresh
      </Button>
      {error && <p role="alert">{error}</p>}
      {loading ? (
        <p role="status">Loading…</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              {["Project", "Applicant", "Source", "Submitted", "Review"].map((label) => (
                <TableHead key={label}>{label}</TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {queue.items.map((row) => (
              <TableRow key={row.id}>
                <TableCell>{row.crewName}</TableCell>
                <TableCell>{row.requesterId}</TableCell>
                <TableCell>{row.kind}</TableCell>
                <TableCell>{row.createdAt}</TableCell>
                <TableCell>
                  <Button
                    disabled={busy}
                    onClick={() => {
                      setSelected(row);
                      setNote("");
                    }}
                  >
                    Review
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      {!loading && !error && queue.items.length === 0 && <p>No pending task requests.</p>}
      {queue.nextCursor && (
        <Button
          disabled={busy || loading}
          onClick={() => {
            setLoading(true);
            setError("");
            setCursor(queue.nextCursor!);
          }}
        >
          Next page
        </Button>
      )}
      {selected && (
        <section aria-label="Review task request" className="space-y-3">
          <h2 className="font-semibold">
            {selected.crewName} · {selected.id}
          </h2>
          <div className="max-h-96 space-y-4 overflow-auto rounded bg-muted p-3">
            <h3 className="font-medium">Submitted task requirements</h3>
            <ReviewFields value={selected.input} />
            {selected.kind !== "manual" && (
              <>
                <h3 className="font-medium">Proposed work</h3>
                <ReviewFields value={selected.review} />
              </>
            )}
          </div>
          <label className="block">
            Decision note
            <Textarea
              value={note}
              maxLength={2000}
              disabled={busy}
              onChange={(e) => setNote(e.target.value)}
            />
          </label>
          <div className="flex gap-2">
            <Button disabled={busy} onClick={() => void decide("approved")}>
              Approve and create tasks
            </Button>
            <Button disabled={busy} variant="outline" onClick={() => void decide("rejected")}>
              Reject
            </Button>
            <Button disabled={busy} variant="outline" onClick={() => setSelected(null)}>
              Cancel
            </Button>
          </div>
        </section>
      )}
    </section>
  );
}
