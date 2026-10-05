"use client";
import { useEffect, useRef, useState } from "react";
import { crewApi } from "./api";
import { attachmentFileError, validEvidenceUrl } from "./use-case-attachments";

type Placement = {
  url: string;
  method: string;
  headers: Record<string, string>;
  expiresAt: string;
};
type InitialEvidence = {
  id: string;
  file: File;
  stage: "prepare" | "put" | "confirm" | "ready";
  placement?: Placement;
};
// Owned by the form session, so collapsing the form preserves upload recovery.
export function useInitialCaseEvidence(
  taskId: string,
  caseId: string,
  disabled: boolean,
  t: (key: string, values?: Record<string, string | number>) => string
) {
  const [items, setItems] = useState<InitialEvidence[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const alive = useRef(true),
    pending = useRef(false),
    abort = useRef<AbortController | null>(null);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      abort.current?.abort();
    };
  }, []);
  const base = `/crew-tasks/${encodeURIComponent(taskId)}/dispute-drafts/${encodeURIComponent(caseId)}/attachments`;
  async function run(item: InitialEvidence) {
    if (disabled || pending.current || !alive.current || item.stage === "ready") return;
    pending.current = true;
    setBusy(true);
    setError("");
    const controller = new AbortController();
    abort.current = controller;
    let current = item;
    const save = () => {
      if (alive.current)
        setItems((previous) => previous.map((row) => (row.id === current.id ? current : row)));
    };
    try {
      if (current.stage === "prepare") {
        const placement = await crewApi.post<Placement>(`${base}/${current.id}`, {
          signal: controller.signal,
          body: {
            name: current.file.name,
            contentType: current.file.type,
            sizeBytes: current.file.size,
          },
        });
        if (!alive.current) return;
        current = { ...current, placement, stage: "put" };
        save();
      }
      if (current.stage === "put") {
        const placement = current.placement!;
        if (!validEvidenceUrl(placement.url) || placement.method !== "PUT")
          throw new Error(t("invalidUrl"));
        if (
          !Number.isFinite(Date.parse(placement.expiresAt)) ||
          Date.parse(placement.expiresAt) <= Date.now()
        )
          throw new Error(t("expired"));
        const response = await fetch(placement.url, {
          method: "PUT",
          headers: placement.headers,
          body: current.file,
          credentials: "omit",
          referrerPolicy: "no-referrer",
          signal: controller.signal,
        });
        if (!response.ok) throw new Error(t("uploadFailed", { status: response.status }));
        if (!alive.current) return;
        current = { ...current, stage: "confirm" };
        save();
      }
      await crewApi.post(`${base}/${current.id}/confirm`, { signal: controller.signal });
      current = { ...current, stage: "ready" };
      save();
    } catch (err) {
      if (alive.current) setError(err instanceof Error ? err.message : t("failed"));
    } finally {
      pending.current = false;
      if (alive.current) setBusy(false);
    }
  }
  return {
    items,
    busy,
    error,
    unresolved: items.some((item) => item.stage !== "ready"),
    ids: items.filter((item) => item.stage === "ready").map((item) => item.id),
    add(file: File) {
      if (
        disabled ||
        pending.current ||
        items.length >= 5 ||
        items.some((item) => item.stage !== "ready")
      )
        return;
      if (attachmentFileError(file)) {
        setError(t("fileInvalid"));
        return;
      }
      const item: InitialEvidence = { id: crypto.randomUUID(), file, stage: "prepare" };
      setItems((previous) => [...previous, item]);
      void run(item);
    },
    retry(item: InitialEvidence, confirmOnly = false) {
      void run(confirmOnly ? { ...item, stage: "confirm" } : item);
    },
    remove(id: string) {
      if (disabled || pending.current) return;
      setItems((previous) => previous.filter((item) => item.id !== id));
      setError("");
    },
  };
}
