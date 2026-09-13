"use client";
import { useEffect, useRef, useState } from "react";
import { crewApi } from "@/app/(site)/crews/_hooks/api";
import { useTranslations } from "@/src/i18n/i18n";
import { Button } from "@/components/ui/button";
export function ReceiptLink({ path, index }: { path: string; index: number }) {
  const t = useTranslations("crewExpenses");
  const [url, setUrl] = useState<string | null>(null),
    [error, setError] = useState<string | null>(null),
    [busy, setBusy] = useState(false);
  const active = useRef<AbortController | null>(null);
  useEffect(
    () => () => {
      active.current?.abort();
    },
    []
  );
  async function read() {
    if (active.current) return;
    const controller = new AbortController();
    active.current = controller;
    setBusy(true);
    setError(null);
    setUrl(null);
    try {
      const value = await crewApi.get<{ url: string }>(path, { signal: controller.signal });
      if (new URL(value.url).protocol !== "https:") throw Error("Invalid receipt URL");
      if (!controller.signal.aborted) setUrl(value.url);
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
    <div className="space-x-2">
      <Button disabled={busy} onClick={() => void read()}>
        {t("receipt")} {index}
      </Button>
      {url ? (
        <a href={url} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer">
          {t("openReceipt")}
        </a>
      ) : null}
      {error ? <p role="alert">{error}</p> : null}
    </div>
  );
}
