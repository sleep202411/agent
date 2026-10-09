"use client";
import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useCurrentUser } from "@/src/hooks/use-user";
import { useTranslations } from "@/src/i18n/i18n";
import { CrewApiError, crewApi } from "@/app/(site)/crews/_hooks/api";
import { crewAccountQueries, crewKeys } from "@/app/(site)/crews/_hooks/shared";
import { Button } from "@/components/ui/button";

type Preview = {
  id: string;
  status: string;
  createdAt?: string;
  tasks: Array<{ title: string; description: string; category: string; evidence: string }>;
  taskIds: string[];
};
export function WorkbenchPdfImport({ crewId }: { crewId: string }) {
  const { user } = useCurrentUser();
  return user ? <PdfSession key={`${crewId}:${user.id}`} crewId={crewId} userId={user.id} /> : null;
}
function PdfSession({ crewId, userId }: { crewId: string; userId: string }) {
  const t = useTranslations("crewTaskProject.workbench");
  const client = useQueryClient();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [selection, setSelection] = useState<number[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [uncertain, setUncertain] = useState(false);
  const [hasRequest, setHasRequest] = useState(false);
  const request = useRef<string | null>(null);
  const guard = useRef(false);
  const recoveredSelection = useRef<number[] | null>(null);
  const recoveryKey = `crew-pdf-import:${crewId}:${userId}`;
  function persist(id: string, indices?: number[]) {
    try {
      localStorage.setItem(recoveryKey, JSON.stringify({ id, indices }));
    } catch {
      /* Storage can be disabled; the current session remains usable. */
    }
  }
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(recoveryKey) ?? "null") as {
        id?: string;
        indices?: number[];
      } | null;
      if (saved?.id && /^[a-f0-9-]{36}$/i.test(saved.id)) {
        request.current = saved.id;
        recoveredSelection.current = Array.isArray(saved.indices) ? saved.indices : null;
        // eslint-disable-next-line react-hooks/set-state-in-effect -- Restore browser-only persisted state after hydration.
        setHasRequest(true);
      }
    } catch {
      /* Ignore unavailable or invalid recovery storage. */
    }
  }, [crewId, recoveryKey]);
  const base = `/crews/${encodeURIComponent(crewId)}/pdf-task-imports`;
  async function refresh() {
    await Promise.all(
      [
        crewKeys.tasks(crewId),
        crewKeys.taskSummary(crewId),
        crewKeys.productionOverview(crewId),
      ].map((key) => client.invalidateQueries(crewAccountQueries(key, userId)))
    );
  }
  function receive(value: Preview) {
    setPreview(value);
    if (value.status === "ready") setSelection(value.tasks.map((_, index) => index));
  }
  async function analyze(check = false) {
    if (guard.current || (!file && !check)) return;
    guard.current = true;
    setBusy(true);
    setError(null);
    try {
      if (!check && preview?.status === "failed") request.current = null;
      request.current ??= crypto.randomUUID();
      setHasRequest(true);
      persist(request.current);
      if (check) {
        receive(await crewApi.get<Preview>(`${base}/${request.current}`));
        return;
      }
      const data = new FormData();
      data.append("file", file!);
      const response = await fetch(`/aurora${base}/${request.current}/analyze`, {
        method: "POST",
        credentials: "include",
        body: data,
      });
      const text = await response.text();
      let body: unknown;
      try {
        body = JSON.parse(text);
      } catch {
        body = text;
      }
      if (!response.ok) {
        if ([400, 401, 403, 409, 413, 415, 422].includes(response.status)) {
          request.current = null;
          setHasRequest(false);
          try {
            localStorage.removeItem(recoveryKey);
          } catch {
            /* Optional storage. */
          }
        }
        if (response.status >= 500) {
          try {
            receive(await crewApi.get<Preview>(`${base}/${request.current}`));
          } catch {
            /* Keep original error. */
          }
        }
        throw new CrewApiError(response.status, body);
      }
      if (!body || typeof body !== "object" || !Array.isArray((body as Preview).tasks))
        throw new CrewApiError(502, body);
      receive(body as Preview);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      guard.current = false;
      setBusy(false);
    }
  }
  useEffect(() => {
    if (
      !hasRequest ||
      busy ||
      uncertain ||
      preview?.status === "ready" ||
      preview?.status === "applied" ||
      preview?.status === "failed"
    )
      return;
    let active = true;
    const id = request.current;
    let pending = false;
    const poll = () => {
      if (!id || pending || request.current !== id) return;
      pending = true;
      void crewApi
        .get<Preview>(`${base}/${id}`)
        .then((value) => {
          if (active && request.current === id) {
            setError(null);
            receive(value);
            if (value.status === "ready" && recoveredSelection.current) {
              setSelection(recoveredSelection.current);
              recoveredSelection.current = null;
              setUncertain(true);
            }
          }
        })
        .catch((cause) => {
          if (active && request.current === id) {
            setError(cause instanceof Error ? cause.message : String(cause));
            if (cause instanceof CrewApiError && [400, 401, 403, 404, 410].includes(cause.status)) {
              request.current = null;
              recoveredSelection.current = null;
              setHasRequest(false);
              try {
                localStorage.removeItem(recoveryKey);
              } catch {
                /* Optional storage. */
              }
            }
          }
        })
        .finally(() => {
          pending = false;
        });
    };
    if (!preview?.status) void poll();
    const timer = setInterval(poll, 2000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [hasRequest, busy, preview?.status, uncertain, base, recoveryKey]);
  async function apply() {
    if (guard.current || !preview || !selection.length) return;
    guard.current = true;
    setBusy(true);
    setError(null);
    setUncertain(true);
    persist(preview.id, selection);
    try {
      const result = await crewApi.post<{ taskIds: string[] }>(`${base}/${preview.id}/apply`, {
        body: { indices: selection },
      });
      setPreview({ ...preview, status: "applied", taskIds: result.taskIds });
      setUncertain(false);
      persist(preview.id);
      await refresh();
    } catch (cause) {
      if (cause instanceof CrewApiError && [400, 403, 404, 409].includes(cause.status)) {
        setUncertain(false);
        persist(preview.id);
      }
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      guard.current = false;
      setBusy(false);
    }
  }
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">{t("pdfHelp")}</p>
      <label className="block rounded-sm border border-dashed border-white/20 p-5 text-sm">
        <span className="mb-3 block font-semibold">{t("pdfChoose")}</span>
        <input
          type="file"
          accept="application/pdf,.pdf,.doc,.docx,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
          disabled={busy || uncertain}
          onChange={(event) => {
            const next = event.target.files?.[0] ?? null;
            setError(null);
            setPreview(null);
            request.current = null;
            recoveredSelection.current = null;
            setHasRequest(false);
            try {
              localStorage.removeItem(recoveryKey);
            } catch {
              /* Optional storage. */
            }
            if (next && next.size > 5 * 1024 * 1024) {
              setFile(null);
              setError(t("pdfTooLarge"));
              return;
            }
            setFile(next);
          }}
        />
      </label>
      <div className="flex flex-wrap gap-2">
        <Button
          disabled={
            !file ||
            busy ||
            uncertain ||
            ["queued", "analyzing", "ready", "applied"].includes(preview?.status ?? "")
          }
          onClick={() => void analyze()}
        >
          {busy ? t("pdfWorking") : t("pdfAnalyze")}
        </Button>
        {preview?.status === "failed" && (
          <Button
            variant="outline"
            disabled={busy}
            onClick={() => {
              request.current = null;
              setHasRequest(false);
              try {
                localStorage.removeItem(recoveryKey);
              } catch {
                /* Optional storage. */
              }
              setPreview(null);
            }}
          >
            {t("pdfNewAnalysis")}
          </Button>
        )}
      </div>
      {error && (
        <p role="alert" className="text-sm text-red-400">
          {error}
        </p>
      )}
      {["queued", "analyzing"].includes(preview?.status ?? "") && (
        <p role="status">
          {t(preview?.status === "queued" ? "documentQueued" : "documentAnalyzing", {
            seconds: Math.max(
              0,
              Math.floor((now - new Date(preview?.createdAt ?? now).getTime()) / 1000)
            ),
          })}
        </p>
      )}
      {preview?.status === "failed" && <p role="status">{t("pdfFailed")}</p>}
      {preview?.status === "applied" && (
        <p role="status">{t("pdfCreated", { count: preview.taskIds.length })}</p>
      )}
      {preview?.status === "ready" && (
        <>
          <p className="text-sm">{t("pdfReview", { count: preview.tasks.length })}</p>
          <div className="max-h-[45vh] space-y-2 overflow-y-auto">
            {preview.tasks.map((task, index) => (
              <label key={index} className="flex gap-3 rounded-sm border border-white/10 p-3">
                <input
                  type="checkbox"
                  checked={selection.includes(index)}
                  disabled={busy || uncertain}
                  onChange={(event) =>
                    setSelection((current) =>
                      event.target.checked
                        ? [...current, index]
                        : current.filter((item) => item !== index)
                    )
                  }
                />
                <span className="min-w-0">
                  <strong className="block text-sm">{task.title}</strong>
                  <span className="mt-1 block whitespace-pre-wrap text-sm text-muted-foreground">
                    {task.description}
                  </span>
                  <q className="mt-2 block text-xs text-muted-foreground">{task.evidence}</q>
                </span>
              </label>
            ))}
          </div>
          {uncertain && (
            <p role="status" className="text-sm">
              {t("pdfRetryHelp")}
            </p>
          )}
          <Button disabled={busy || !selection.length} onClick={() => void apply()}>
            {t(uncertain ? "pdfRetry" : "pdfCreate", { count: selection.length })}
          </Button>
        </>
      )}
    </div>
  );
}
