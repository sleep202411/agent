"use client";
import { useEffect, useState } from "react";
import { requestEnvelope, toErrorMessage } from "./shared";
import { useAdminOperation } from "../use-admin-operation";
type Entry = { workId: string; title: string; status: string; version: number };
type LoadState = {
  requestKey: string;
  items: Entry[];
  nextCursor: string | null;
  error: string | null;
};
export function IpSubmissionsPanel({ ipId }: { ipId: string }) {
  const [cursor, setCursor] = useState<string | undefined>();
  const [refresh, setRefresh] = useState(0);
  const [actionError, setActionError] = useState<string | null>(null);
  const [loadState, setLoadState] = useState<LoadState>({
    requestKey: "",
    items: [],
    nextCursor: null,
    error: null,
  });
  const { busy, begin } = useAdminOperation();
  const endpoint = `/api/admin/ip-commerce/ips/${encodeURIComponent(ipId)}/submissions`;
  const requestUrl = endpoint + (cursor ? `?cursor=${encodeURIComponent(cursor)}` : "");
  const requestKey = `${requestUrl}#${refresh}`;
  const loading = loadState.requestKey !== requestKey;
  const error = actionError ?? (loading ? null : loadState.error);
  useEffect(() => {
    const controller = new AbortController();
    requestEnvelope<{ items: Entry[]; nextCursor?: string | null }>(requestUrl, {
      signal: controller.signal,
    })
      .then((data) => {
        if (!controller.signal.aborted) {
          setLoadState({
            requestKey,
            items: data.items,
            nextCursor: data.nextCursor ?? null,
            error: null,
          });
        }
      })
      .catch((e) => {
        if (!controller.signal.aborted) {
          setLoadState({
            requestKey,
            items: [],
            nextCursor: null,
            error: toErrorMessage(e),
          });
        }
      });
    return () => controller.abort();
  }, [requestKey, requestUrl]);
  async function decide(entry: Entry, status: "approved" | "rejected") {
    const op = begin();
    if (!op) return;
    setActionError(null);
    try {
      await requestEnvelope(endpoint, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        signal: op.signal,
        body: JSON.stringify({ workId: entry.workId, status, expectedVersion: entry.version }),
      });
      if (op.current()) setRefresh((x) => x + 1);
    } catch (e) {
      if (op.current()) setActionError(toErrorMessage(e));
    } finally {
      op.finish();
    }
  }
  return (
    <section className="space-y-2 border-t border-slate-200 pt-3">
      <h3 className="text-sm font-semibold">Community submissions / 社区投稿</h3>
      {error && (
        <p role="alert" className="text-sm text-red-700">
          {error}
        </p>
      )}
      {loading ? (
        <p>Loading…</p>
      ) : (
        <>
          <ul className="space-y-2">
            {loadState.items.map((entry) => (
              <li key={entry.workId} className="flex items-center gap-2 text-sm">
                <span className="flex-1">
                  {entry.title} · {entry.status}
                </span>
                {entry.status === "pending" && (
                  <>
                    <button
                      disabled={busy}
                      onClick={() => void decide(entry, "approved")}
                      className="rounded border px-2 py-1"
                    >
                      Approve
                    </button>
                    <button
                      disabled={busy}
                      onClick={() => void decide(entry, "rejected")}
                      className="rounded border px-2 py-1"
                    >
                      Reject
                    </button>
                  </>
                )}
              </li>
            ))}
          </ul>
          {!loadState.error && !loadState.items.length && (
            <p className="text-sm text-slate-500">No submissions.</p>
          )}
        </>
      )}
      <div className="flex gap-2">
        {!loading && loadState.error && (
          <button
            disabled={busy}
            onClick={() => {
              setActionError(null);
              setRefresh((x) => x + 1);
            }}
            className="text-sm underline"
          >
            Retry
          </button>
        )}
        <button
          disabled={busy || loading}
          onClick={() => {
            setActionError(null);
            setCursor(undefined);
            setRefresh((x) => x + 1);
          }}
          className="text-sm underline"
        >
          Refresh
        </button>
        {loadState.nextCursor && (
          <button
            disabled={busy || loading}
            onClick={() => {
              setActionError(null);
              setCursor(loadState.nextCursor ?? undefined);
            }}
            className="text-sm underline"
          >
            Next page
          </button>
        )}
      </div>
    </section>
  );
}
