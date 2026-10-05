"use client";
import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useAuth } from "@/app/_components/auth-provider";
import { useOptionalProjectContext } from "../../_components/project-context";
import { useOptionalCanvasConnection } from "../../_components/canvas-connection-context";
import type { DocumentProvider } from "@/lib/collab/document-provider";
import { api, ApiRequestError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

type Job = {
  id: string;
  sequence: number;
  width: number;
  height: number;
  status: "queued" | "running" | "completed" | "failed" | "cancelled" | "expired";
  error: string | null;
  createdAt: string;
  expiresAt: string;
};
type Submission = {
  requestId: string;
  documentId: string;
  expectedSequence: number;
  width: number;
  height: number;
};
const ROOT = "/aurora/storyboard-exports";
export function StoryboardExport({ disabled }: { disabled: boolean }) {
  const connection = useOptionalCanvasConnection();
  const project = useOptionalProjectContext();
  const { user } = useAuth();
  if (project?.owner.kind === "story_project") return null;
  if (!connection?.documentId || !connection.provider || !user) return null;
  return (
    <ExportDialog
      key={`${user.id}:${connection.documentId}`}
      documentId={connection.documentId}
      provider={connection.provider}
      userId={String(user.id)}
      disabled={disabled}
    />
  );
}
function ExportDialog({
  documentId,
  provider,
  userId,
  disabled,
}: {
  documentId: string;
  provider: DocumentProvider;
  userId: string;
  disabled: boolean;
}) {
  const t = useTranslations("storyboard.export");
  const { isCurrentAccount } = useAuth();
  const client = useQueryClient();
  const key = ["storyboard-exports", userId, documentId];
  const [open, setOpen] = useState(false);
  const [format, setFormat] = useState("1280x720");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(false);
  const pending = useRef<Submission | null>(null);
  const operation = useRef<AbortController | null>(null);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      operation.current?.abort();
    };
  }, []);
  const jobs = useQuery({
    queryKey: key,
    queryFn: ({ signal }) =>
      api.get<Job[]>(ROOT, { params: { documentId }, signal, requestScope: "user" }),
    enabled: open,
    refetchInterval: (query) =>
      query.state.data?.some((job) => job.status === "queued" || job.status === "running")
        ? 3000
        : 60000,
  });
  const current = () => alive.current && isCurrentAccount(userId);
  const act = async (name: string, run: (signal: AbortSignal) => Promise<void>) => {
    if (operation.current || !current()) return;
    const controller = new AbortController();
    operation.current = controller;
    setBusy(name);
    setError(null);
    try {
      await run(controller.signal);
    } catch (cause) {
      if (current() && !controller.signal.aborted)
        setError(cause instanceof Error ? cause.message : t("failed"));
    } finally {
      if (current()) {
        setBusy(null);
        operation.current = null;
      }
    }
  };
  const create = () =>
    act("create", async (signal) => {
      if (!pending.current) {
        const sequence = provider.getSavedSequence();
        if (sequence === null) throw new Error(t("waitForSave"));
        const [width, height] = format.split("x").map(Number);
        pending.current = {
          requestId: crypto.randomUUID(),
          documentId,
          expectedSequence: sequence,
          width: width!,
          height: height!,
        };
      }
      try {
        await api.post<Job>(ROOT, { data: pending.current, signal, requestScope: "user" });
        if (!current()) return;
        pending.current = null;
        setRetry(false);
        await client.invalidateQueries({ queryKey: key });
      } catch (cause) {
        if (current()) {
          // A lost response may hide an accepted job. Repeat its exact request.
          if (cause instanceof ApiRequestError && [400, 401, 403, 404, 409].includes(cause.status))
            pending.current = null;
          setRetry(pending.current !== null);
          void client.invalidateQueries({ queryKey: key });
        }
        throw cause;
      }
    });
  const cancel = (job: Job) =>
    act(job.id, async (signal) => {
      await api.post(`${ROOT}/${job.id}/cancel`, { signal, requestScope: "user" });
      if (current()) await client.invalidateQueries({ queryKey: key });
    });
  const download = (job: Job) =>
    act(job.id, async (signal) => {
      const result = await api.post<{ url: string; expiresAt: string }>(
        `${ROOT}/${job.id}/download`,
        { signal, requestScope: "user" }
      );
      if (!current()) return;
      const url = new URL(result.url);
      if (
        url.protocol !== "https:" ||
        url.username ||
        url.password ||
        !(Date.parse(result.expiresAt) > Date.now())
      )
        throw new Error(t("invalidDownload"));
      const anchor = document.createElement("a");
      anchor.href = url.href;
      anchor.download = "storyboard.mp4";
      anchor.target = "_blank";
      anchor.rel = "noopener noreferrer";
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
    });
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="secondary">
          {t("open")}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-lg">
        <DialogTitle>{t("title")}</DialogTitle>
        <DialogDescription className="text-sm text-muted-foreground">
          {t("description")}
        </DialogDescription>
        <label className="grid gap-2 text-sm">
          {t("format")}
          <select
            className="rounded-lg bg-muted p-2"
            value={format}
            disabled={!!busy || retry}
            onChange={(event) => setFormat(event.target.value)}
          >
            {["1280x720", "1920x1080", "720x1280", "1080x1920"].map((value) => (
              <option key={value} value={value}>
                {value.replace("x", " × ")}
              </option>
            ))}
          </select>
        </label>
        <Button disabled={!!busy || (disabled && !retry)} onClick={() => void create()}>
          {busy === "create" ? t("submitting") : retry ? t("retry") : t("create")}
        </Button>
        {retry && <p className="text-xs text-muted-foreground">{t("uncertain")}</p>}
        {(error || jobs.error) && (
          <p role="alert" className="text-sm text-destructive">
            {error || jobs.error?.message}
          </p>
        )}
        {jobs.isPending && (
          <p role="status" className="text-sm text-muted-foreground">
            {t("loading")}
          </p>
        )}
        {jobs.isError && (
          <Button variant="secondary" onClick={() => void jobs.refetch()}>
            {t("refresh")}
          </Button>
        )}
        {jobs.data?.length === 0 && <p className="text-sm text-muted-foreground">{t("empty")}</p>}
        <ul className="grid gap-3" aria-label={t("history")}>
          {jobs.data?.map((job) => (
            <li key={job.id} className="flex flex-wrap items-center gap-2 rounded-lg bg-muted p-3">
              <div className="min-w-0 flex-1">
                <p className="text-sm">
                  {job.width} × {job.height} · {t(job.status)}
                </p>
                <p className="text-xs text-muted-foreground">
                  {new Date(job.createdAt).toLocaleString()}
                </p>
                {job.error && <p className="mt-1 text-xs text-destructive">{job.error}</p>}
              </div>
              {(job.status === "queued" || job.status === "running") && (
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={!!busy}
                  onClick={() => void cancel(job)}
                >
                  {t("cancel")}
                </Button>
              )}
              {job.status === "completed" && (
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={!!busy}
                  onClick={() => void download(job)}
                >
                  {t("download")}
                </Button>
              )}
            </li>
          ))}
        </ul>
      </DialogContent>
    </Dialog>
  );
}
