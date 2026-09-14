"use client";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
export function ExpenseReceiptLink({
  draftId,
  id,
  version,
  index,
}: {
  draftId: string;
  id: string;
  version: number;
  index: number;
}) {
  const [url, setUrl] = useState<string | null>(null),
    [error, setError] = useState<string | null>(null),
    [busy, setBusy] = useState(false);
  const active = useRef<AbortController | null>(null);
  useEffect(() => () => active.current?.abort(), []);
  async function read() {
    if (active.current) return;
    const controller = new AbortController();
    active.current = controller;
    setBusy(true);
    setError(null);
    setUrl(null);
    try {
      const response = await fetch(
        `/api/admin/crew-expense-submissions/${encodeURIComponent(draftId)}/receipts/${encodeURIComponent(id)}/read?version=${version}`,
        { cache: "no-store", signal: controller.signal }
      );
      const body = await response.json();
      if (!response.ok) throw Error(body.message ?? `Request failed (${response.status})`);
      if (new URL(body.url).protocol !== "https:") throw Error("Invalid receipt URL");
      if (!controller.signal.aborted) setUrl(body.url);
    } catch (e) {
      if (!controller.signal.aborted) setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (active.current === controller) {
        active.current = null;
        if (!controller.signal.aborted) setBusy(false);
      }
    }
  }
  return (
    <div>
      <Button disabled={busy} onClick={() => void read()}>
        Receipt {index}
      </Button>
      {url ? (
        <a href={url} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer">
          Open receipt
        </a>
      ) : null}
      {error ? <p role="alert">{error}</p> : null}
    </div>
  );
}
