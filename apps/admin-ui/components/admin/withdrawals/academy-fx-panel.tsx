"use client";
import { useEffect, useRef, useState } from "react";
import { adminUiApiPath, parseAdminEnvelope } from "@/lib/admin-api";
import { Button } from "@/components/ui/button";

type Rate = { rate: string; source: string; expiresAt: string; version: number };
const path = () => adminUiApiPath("/api/admin/creator-withdrawals/academy-fx");
export function AcademyFxPanel() {
  const [current, setCurrent] = useState<Rate | null>(null);
  const [rate, setRate] = useState("");
  const [source, setSource] = useState("");
  const [expiry, setExpiry] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const lock = useRef(false);
  useEffect(() => {
    const abort = new AbortController();
    fetch(path(), {
      signal: AbortSignal.any([abort.signal, AbortSignal.timeout(15000)]),
      cache: "no-store",
    })
      .then((response) => parseAdminEnvelope<Rate | null>(response))
      .then((value) => {
        if (!abort.signal.aborted) {
          setCurrent(value);
          setLoading(false);
          setError("");
        }
      })
      .catch((cause) => {
        if (!abort.signal.aborted) {
          setLoading(false);
          setError(cause instanceof Error ? cause.message : "Rate could not be loaded.");
        }
      });
    return () => abort.abort();
  }, [attempt]);
  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (lock.current || loading) return;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      const value = await parseAdminEnvelope<Rate>(
        await fetch(path(), {
          method: "POST",
          headers: { "content-type": "application/json" },
          signal: AbortSignal.timeout(15000),
          body: JSON.stringify({
            rate,
            source,
            expiresAt: new Date(expiry).toISOString(),
            expectedVersion: current?.version ?? 0,
          }),
        })
      );
      setCurrent(value);
      setRate("");
      setSource("");
      setExpiry("");
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Rate could not be saved. Refresh before retrying."
      );
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  return (
    <details className="mb-6 rounded-lg border border-slate-200 bg-white p-4">
      <summary className="cursor-pointer font-medium">Academy RMB settlement · USD/CNY</summary>
      <p className="my-3 text-sm text-slate-600">
        100 earned Academy points retain a value of US$1. Publish the payment provider’s USD/CNY
        quote below. Each withdrawal keeps its original rate; expired quotes cannot fund new Academy
        withdrawals.
      </p>
      {current ? (
        <p className="text-sm">
          1 USD = {current.rate} CNY · {current.source} · Valid until{" "}
          {new Date(current.expiresAt).toLocaleString()}
        </p>
      ) : (
        <p className="text-sm">
          No rate configured. Earned points remain in the creator’s balance.
        </p>
      )}
      {error ? (
        <p role="alert" className="mt-3 text-sm text-red-700">
          {error}
        </p>
      ) : null}
      <Button
        className="my-3"
        variant="outline"
        disabled={busy}
        onClick={() => {
          setLoading(true);
          setAttempt((value) => value + 1);
        }}
      >
        Refresh rate
      </Button>
      <form onSubmit={(event) => void save(event)} className="grid gap-3 sm:grid-cols-3">
        <label className="grid gap-1 text-sm">
          CNY per US$1
          <input
            required
            inputMode="decimal"
            pattern="[0-9]+[.][0-9]{1,6}"
            value={rate}
            onChange={(event) => setRate(event.target.value)}
            className="rounded border p-2"
            disabled={busy || loading}
          />
        </label>
        <label className="grid gap-1 text-sm">
          Provider / quote reference
          <input
            required
            minLength={3}
            maxLength={500}
            value={source}
            onChange={(event) => setSource(event.target.value)}
            className="rounded border p-2"
            disabled={busy || loading}
          />
        </label>
        <label className="grid gap-1 text-sm">
          Valid until (local time)
          <input
            required
            type="datetime-local"
            value={expiry}
            onChange={(event) => setExpiry(event.target.value)}
            className="rounded border p-2"
            disabled={busy || loading}
          />
        </label>
        <Button type="submit" disabled={busy || loading}>
          Publish exchange rate
        </Button>
      </form>
    </details>
  );
}
