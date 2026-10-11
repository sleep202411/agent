"use client";

import { useEffect, useRef, useState } from "react";
import { api } from "@/src/lib/api";
import { useTranslations } from "@/src/i18n/i18n";

type Document = { id: string; title: string; content: string; isPublished: boolean };
type Snapshot = { documents: Document[]; version: number };

export function AudienceKnowledgeEditor({ ipId }: { ipId: string }) {
  return <EditorSession key={ipId} ipId={ipId} />;
}

function EditorSession({ ipId }: { ipId: string }) {
  const t = useTranslations("ipKnowledgeAdmin");
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [conflict, setConflict] = useState(false);
  const controller = useRef<AbortController | null>(null);
  const inFlight = useRef(true);
  const endpoint = `/aurora/ip-commerce/me/ips/${ipId}/knowledge-documents`;

  useEffect(() => {
    inFlight.current = true;
    const request = new AbortController();
    controller.current = request;
    api
      .get<Snapshot>(endpoint, { signal: request.signal })
      .then((value) => {
        if (!request.signal.aborted) setSnapshot(value);
      })
      .catch((cause: unknown) => {
        if (!request.signal.aborted) setError(cause instanceof Error ? cause.message : t("failed"));
      })
      .finally(() => {
        if (!request.signal.aborted) {
          inFlight.current = false;
          setBusy(false);
        }
      });
    return () => {
      controller.current?.abort();
    };
  }, [endpoint, t]);

  async function request(save: boolean) {
    if (inFlight.current || (save && (!snapshot || conflict))) return;
    inFlight.current = true;
    controller.current?.abort();
    const pending = new AbortController();
    controller.current = pending;
    setBusy(true);
    setError("");
    setSaved(false);
    try {
      const value =
        save && snapshot
          ? await api.put<Snapshot>(endpoint, {
              signal: pending.signal,
              data: {
                expectedVersion: snapshot.version,
                documents: snapshot.documents.map(({ id, title, content, isPublished }) => ({
                  id,
                  title: title.trim(),
                  content: content.trim(),
                  isPublished,
                })),
              },
            })
          : await api.get<Snapshot>(endpoint, { signal: pending.signal });
      if (!pending.signal.aborted) {
        setSnapshot(value);
        setConflict(false);
        setSaved(save);
      }
    } catch (cause) {
      if (!pending.signal.aborted) {
        const stale =
          typeof cause === "object" && cause !== null && "status" in cause && cause.status === 409;
        setConflict(stale);
        setError(stale ? t("conflict") : cause instanceof Error ? cause.message : t("failed"));
      }
    } finally {
      if (!pending.signal.aborted) {
        inFlight.current = false;
        setBusy(false);
      }
    }
  }
  function update(id: string, change: Partial<Document>) {
    setSaved(false);
    setSnapshot(
      (value) =>
        value && {
          ...value,
          documents: value.documents.map((document) =>
            document.id === id ? { ...document, ...change } : document
          ),
        }
    );
  }
  const inputClass = "w-full rounded-lg border border-border bg-background px-3 py-2 text-sm";
  const buttonClass = "rounded-lg border border-border px-3 py-2 text-sm disabled:opacity-50";
  return (
    <form
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault();
        void request(true);
      }}
    >
      <p className="text-sm text-muted-foreground">{t("description")}</p>
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
      {saved ? (
        <p role="status" className="text-sm">
          {t("saved")}
        </p>
      ) : null}
      {busy ? (
        <p role="status" className="text-sm">
          {t("loading")}
        </p>
      ) : null}
      <fieldset disabled={busy || !snapshot || conflict} className="space-y-5 disabled:opacity-60">
        {snapshot?.documents.map((document, index) => (
          <div key={document.id} className="space-y-3 border-b border-border pb-5">
            <label className="block space-y-1 text-sm">
              <span>
                {t("title")} {index + 1}
              </span>
              <input
                className={inputClass}
                required
                maxLength={240}
                value={document.title}
                onChange={(event) => update(document.id, { title: event.target.value })}
              />
            </label>
            <label className="block space-y-1 text-sm">
              <span>
                {t("content")} {index + 1}
              </span>
              <textarea
                className={inputClass}
                required
                maxLength={20000}
                rows={7}
                value={document.content}
                onChange={(event) => update(document.id, { content: event.target.value })}
              />
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={document.isPublished}
                onChange={(event) => update(document.id, { isPublished: event.target.checked })}
              />
              {t("published")}
            </label>
            <button
              type="button"
              className={buttonClass}
              onClick={() => {
                setSaved(false);
                setSnapshot(
                  (value) =>
                    value && {
                      ...value,
                      documents: value.documents.filter((item) => item.id !== document.id),
                    }
                );
              }}
            >
              {t("remove")}
            </button>
          </div>
        ))}
        {snapshot?.documents.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("empty")}</p>
        ) : null}
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className={buttonClass}
            disabled={(snapshot?.documents.length ?? 0) >= 50}
            onClick={() => {
              setSaved(false);
              setSnapshot(
                (value) =>
                  value && {
                    ...value,
                    documents: [
                      ...value.documents,
                      { id: crypto.randomUUID(), title: "", content: "", isPublished: false },
                    ],
                  }
              );
            }}
          >
            {t("add")}
          </button>
          <button
            type="submit"
            className={`${buttonClass} bg-primary text-primary-foreground`}
            disabled={snapshot?.documents.some(
              (document) => !document.title.trim() || !document.content.trim()
            )}
          >
            {t("save")}
          </button>
        </div>
      </fieldset>
      <button
        type="button"
        className={buttonClass}
        disabled={busy}
        onClick={() => void request(false)}
      >
        {t("reload")}
      </button>
    </form>
  );
}
