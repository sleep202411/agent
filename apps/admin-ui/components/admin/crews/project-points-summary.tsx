"use client";
import { useEffect, useState } from "react";
import { adminUiApiPath } from "@/lib/admin-api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type Project = {
  crewId: string;
  crewName: string;
  producerUserId: string | null;
  durationSeconds: number | null;
  pointsPerMinute: number;
  calculatedPoints: string | null;
  appliedPoints: string;
  approvedPoints: string;
  pendingPoints: string;
  creditedPoints: string;
  differencePoints: string | null;
  warning: boolean;
  closed: boolean;
};
type Page = { items: Project[]; nextCursor: string | null };
const number = (value: string | null) => (value === null ? "—" : BigInt(value).toLocaleString());

export function ProjectPointsSummary({
  revision,
  onDetails,
}: {
  revision: number;
  onDetails: (crewId: string) => void;
}) {
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState({ search: "", state: "", cursor: "" });
  const requestKey = JSON.stringify({ query, revision });
  const [result, setResult] = useState<{ key: string; page?: Page; error?: string }>();
  const page = result?.key === requestKey ? result.page : undefined;
  const error = result?.key === requestKey ? result.error : undefined;
  useEffect(() => {
    const abort = new AbortController();
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) if (value) params.set(key, value);
    fetch(adminUiApiPath(`/api/admin/crew-compute-requests/projects?${params}`), {
      signal: abort.signal,
      cache: "no-store",
    })
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok || body.code !== 200)
          throw Error(body.msg || body.message || "Project summary could not be loaded");
        if (!abort.signal.aborted) setResult({ key: requestKey, page: body.data });
      })
      .catch((cause) => {
        if (!abort.signal.aborted)
          setResult({
            key: requestKey,
            error: cause instanceof Error ? cause.message : String(cause),
          });
      });
    return () => abort.abort();
  }, [query, revision, requestKey]);
  const sum = (key: "calculatedPoints" | "differencePoints") =>
    (page?.items ?? [])
      .reduce((total, row) => total + BigInt(row[key] ?? 0), BigInt(0))
      .toLocaleString();
  function exportPage() {
    if (!page) return;
    const escape = (value: unknown) => {
      const text = String(value ?? "");
      return `"${(/^[=+@\-\t\r]/.test(text) ? "'" + text : text).replaceAll('"', '""')}"`;
    };
    const rows = [
      [
        "Project",
        "Producer",
        "Minutes",
        "Points/min",
        "Calculated points",
        "Applied points",
        "Difference",
        "Wallet credited",
        "Warning",
      ],
      ...page.items.map((row) => [
        row.crewName,
        row.producerUserId,
        row.durationSeconds === null ? "" : row.durationSeconds / 60,
        row.pointsPerMinute,
        row.calculatedPoints,
        row.appliedPoints,
        row.differencePoints,
        row.creditedPoints,
        row.warning ? "Over 20% difference" : "",
      ]),
    ];
    const url = URL.createObjectURL(
      new Blob(["\uFEFF" + rows.map((row) => row.map(escape).join(",")).join("\r\n")], {
        type: "text/csv;charset=utf-8",
      })
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = "project-points.csv";
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return (
    <section className="space-y-4" aria-label="Project points summary">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">Project points summary</h2>
        <form
          className="flex flex-wrap gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            setQuery((q) => ({ ...q, search: search.trim(), cursor: "" }));
          }}
        >
          <Input
            aria-label="Project name"
            placeholder="Project name"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-48"
          />
          <select
            aria-label="Budget status"
            className="rounded border bg-background px-2"
            value={query.state}
            onChange={(e) => setQuery((q) => ({ ...q, state: e.target.value, cursor: "" }))}
          >
            <option value="">All budgets</option>
            <option value="over">Over budget</option>
            <option value="under">Within budget</option>
          </select>
          <Button type="submit" variant="outline">
            Search
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={!page?.items.length}
            onClick={exportPage}
          >
            Export page CSV
          </Button>
        </form>
      </div>
      <p className="text-sm text-muted-foreground">
        Calculated points use the project’s approved duration and rate. Applied points include
        pending and approved allowances and top-ups, excluding rejected requests. A difference above
        ±20% is flagged. Totals below cover this page.
      </p>
      {error && (
        <p role="alert">
          {error}
          <Button variant="outline" onClick={() => setQuery((q) => ({ ...q }))}>
            Retry
          </Button>
        </p>
      )}
      {!page && !error && <p role="status">Loading project summaries…</p>}
      {page && (
        <>
          <dl className="grid gap-3 sm:grid-cols-4">
            {[
              ["Projects", page.items.length],
              [
                "Production minutes",
                (
                  page.items.reduce((n, row) => n + (row.durationSeconds ?? 0), 0) / 60
                ).toLocaleString(),
              ],
              ["Calculated points", sum("calculatedPoints")],
              ["Difference points", sum("differencePoints")],
            ].map(([label, value]) => (
              <div key={label} className="rounded-md border p-4">
                <dt className="text-xs text-muted-foreground">{label}</dt>
                <dd className="text-xl font-semibold tabular-nums">{value}</dd>
              </div>
            ))}
          </dl>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {page.items.map((row) => {
              const over = BigInt(row.differencePoints ?? 0) > BigInt(0);
              const percent =
                row.calculatedPoints && BigInt(row.calculatedPoints) > BigInt(0)
                  ? Number((BigInt(row.appliedPoints) * BigInt(100)) / BigInt(row.calculatedPoints))
                  : 0;
              return (
                <article key={row.crewId} className="space-y-3 rounded-md border p-4">
                  <div className="flex justify-between gap-2">
                    <div>
                      <h3 className="font-semibold">{row.crewName}</h3>
                      <p className="text-xs text-muted-foreground">
                        Producer: {row.producerUserId ?? "—"}
                      </p>
                    </div>
                    <span className={over ? "text-destructive" : "text-muted-foreground"}>
                      {row.calculatedPoints === null
                        ? "Unconfigured"
                        : over
                          ? "Over budget"
                          : "Within budget"}
                      {row.closed ? " · Closed" : ""}
                    </span>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">
                      Applied / calculated: {row.calculatedPoints ? `${percent}%` : "—"}
                    </p>
                    <progress className="h-2 w-full" max={100} value={Math.min(100, percent)} />
                  </div>
                  <dl className="grid grid-cols-2 gap-3 text-sm">
                    {[
                      [
                        "Production minutes",
                        row.durationSeconds === null
                          ? "—"
                          : (row.durationSeconds / 60).toLocaleString(),
                      ],
                      ["Points/min", row.pointsPerMinute.toLocaleString()],
                      ["Calculated", number(row.calculatedPoints)],
                      ["Applied", number(row.appliedPoints)],
                      ["Difference", number(row.differencePoints)],
                      ["Wallet credited", number(row.creditedPoints)],
                    ].map(([label, value]) => (
                      <div key={label}>
                        <dt className="text-xs text-muted-foreground">{label}</dt>
                        <dd className="font-medium tabular-nums">{value}</dd>
                      </div>
                    ))}
                  </dl>
                  {row.warning && <p className="text-sm text-amber-700">Difference exceeds ±20%</p>}
                  <Button variant="outline" onClick={() => onDetails(row.crewId)}>
                    View details / configure
                  </Button>
                </article>
              );
            })}
          </div>
          {!page.items.length && <p>No matching projects.</p>}
          <div className="flex gap-2">
            {query.cursor && (
              <Button variant="outline" onClick={() => setQuery((q) => ({ ...q, cursor: "" }))}>
                First page
              </Button>
            )}
            {page.nextCursor && (
              <Button
                variant="outline"
                onClick={() => setQuery((q) => ({ ...q, cursor: page.nextCursor! }))}
              >
                Next page
              </Button>
            )}
          </div>
        </>
      )}
    </section>
  );
}
