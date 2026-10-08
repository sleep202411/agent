"use client";

import { ProjectBudgetPanel } from "./project-budget-panel";
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

type ComputeRequest = {
  id: string;
  crewId: string;
  crewName: string;
  taskId: string;
  taskTitle: string;
  workspaceId: string;
  userId: string;
  points: number;
  reason: string;
  status: "pending" | "approved" | "rejected";
  createdAt: string;
  decidedByAdminId: string | null;
  decidedByUserId: string | null;
  decisionNote: string | null;
  decidedAt: string | null;
};
type Queue = { items: ComputeRequest[]; nextCursor: string | null };

async function request<T>(path: string, signal: AbortSignal, body?: unknown): Promise<T> {
  const response = await fetch(adminUiApiPath(`/api/admin/crew-compute-requests${path}`), {
    method: body ? "POST" : "GET",
    signal,
    cache: "no-store",
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const result = await response.json().catch(() => null);
  if (!response.ok || result?.code !== 200) {
    throw new Error(result?.msg || result?.message || `Request failed (${response.status})`);
  }
  return result.data as T;
}

export function ComputeRequestsPanel() {
  const [query, setQuery] = useState({ status: "pending", cursor: "", revision: 0 });
  const [queue, setQueue] = useState<Queue>({ items: [], nextCursor: null });
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<ComputeRequest | null>(null);
  const [budgetCrew, setBudgetCrew] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const action = useRef<AbortController | null>(null);

  useEffect(() => () => action.current?.abort(), []);
  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams();
    if (query.status) params.set("status", query.status);
    if (query.cursor) params.set("cursor", query.cursor);
    request<Queue>(`?${params}`, controller.signal)
      .then((data) => {
        if (!controller.signal.aborted) {
          setQueue(data);
          setLoading(false);
        }
      })
      .catch((err) => {
        if (!controller.signal.aborted) {
          setError(err instanceof Error ? err.message : String(err));
          setLoading(false);
        }
      });
    return () => controller.abort();
  }, [query]);

  const load = (status = query.status, cursor = "") => {
    setQueue({ items: [], nextCursor: null });
    setLoading(true);
    setError("");
    setSelected(null);
    setNote("");
    setQuery((previous) => ({ status, cursor, revision: previous.revision + 1 }));
  };
  const decide = async (status: "approved" | "rejected") => {
    if (!selected || action.current) return;
    const controller = new AbortController();
    action.current = controller;
    setPending(true);
    setError("");
    try {
      await request(
        `/${encodeURIComponent(selected.crewId)}/${encodeURIComponent(selected.id)}/decision`,
        controller.signal,
        { status, note }
      );
      if (!controller.signal.aborted) load();
    } catch (err) {
      if (!controller.signal.aborted) setError(err instanceof Error ? err.message : String(err));
    } finally {
      if (!controller.signal.aborted) {
        action.current = null;
        setPending(false);
      }
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold">Compute requests</h1>
        <p className="text-sm text-muted-foreground">
          Admin review authorizes task spending from the linked workspace balance. Approval does not
          add points.
        </p>
      </div>
      {budgetCrew && <ProjectBudgetPanel key={budgetCrew} crewId={budgetCrew} />}
      <div className="flex flex-wrap gap-2">
        {["pending", "approved", "rejected", ""].map((status) => (
          <Button
            key={status}
            variant={query.status === status ? "default" : "outline"}
            disabled={pending || loading}
            onClick={() => load(status)}
          >
            {status || "All"}
          </Button>
        ))}
        <Button variant="outline" disabled={pending} onClick={() => load()}>
          Refresh
        </Button>
      </div>
      {error && <p role="alert">{error}</p>}
      {loading ? (
        <p role="status">Loading requests…</p>
      ) : (
        <>
          {selected && (
            <section className="space-y-3 rounded-md border p-4" aria-label="Review request">
              <h2 className="font-semibold">
                {selected.crewName} · {selected.taskTitle} · {selected.points.toLocaleString()}{" "}
                points
              </h2>
              <p className="text-sm">
                Applicant: {selected.userId} · Workspace: {selected.workspaceId}
              </p>
              <p className="whitespace-pre-wrap break-words">{selected.reason}</p>
              <Textarea
                aria-label="Decision note"
                placeholder="Decision note"
                maxLength={2000}
                disabled={pending}
                value={note}
                onChange={(event) => setNote(event.target.value)}
              />
              <div className="flex gap-2">
                <Button disabled={pending} onClick={() => void decide("approved")}>
                  Approve allowance
                </Button>
                <Button
                  variant="outline"
                  disabled={pending}
                  onClick={() => void decide("rejected")}
                >
                  Reject
                </Button>
                <Button variant="outline" disabled={pending} onClick={() => setSelected(null)}>
                  Cancel
                </Button>
              </div>
            </section>
          )}
          <Table>
            <TableHeader>
              <TableRow>
                {["Crew / task", "Applicant", "Points", "Status", "Decision", "Action"].map(
                  (label) => (
                    <TableHead key={label}>{label}</TableHead>
                  )
                )}
              </TableRow>
            </TableHeader>
            <TableBody>
              {queue.items.map((row) => (
                <TableRow key={row.id}>
                  <TableCell>
                    {row.crewName}
                    <p>{row.taskTitle}</p>
                    <p className="text-xs text-muted-foreground">
                      {row.crewId} · {new Date(row.createdAt).toLocaleString()}
                    </p>
                  </TableCell>
                  <TableCell>{row.userId}</TableCell>
                  <TableCell>{row.points.toLocaleString()}</TableCell>
                  <TableCell>{row.status}</TableCell>
                  <TableCell>
                    {row.decidedByAdminId
                      ? `Admin: ${row.decidedByAdminId}`
                      : row.decidedByUserId
                        ? `Historical user: ${row.decidedByUserId}`
                        : "—"}
                    <p className="whitespace-pre-wrap">{row.decisionNote}</p>
                    {row.decidedAt && <p>{new Date(row.decidedAt).toLocaleString()}</p>}
                  </TableCell>
                  <TableCell>
                    <Button variant="outline" onClick={() => setBudgetCrew(row.crewId)}>
                      Project budget
                    </Button>
                    {row.status === "pending" && (
                      <Button
                        variant="outline"
                        disabled={pending}
                        onClick={() => {
                          setSelected(row);
                          setNote("");
                        }}
                      >
                        Review
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {!queue.items.length && <p>No requests.</p>}
          <div className="flex gap-2">
            {query.cursor && (
              <Button variant="outline" disabled={pending} onClick={() => load()}>
                Latest
              </Button>
            )}
            {queue.nextCursor && (
              <Button
                variant="outline"
                disabled={pending}
                onClick={() => load(query.status, queue.nextCursor!)}
              >
                Older
              </Button>
            )}
          </div>
        </>
      )}
    </div>
  );
}
