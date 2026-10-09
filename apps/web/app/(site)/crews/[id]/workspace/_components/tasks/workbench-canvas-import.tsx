"use client";
import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useCurrentUser } from "@/src/hooks/use-user";
import { useLocale, useTranslations } from "@/src/i18n/i18n";
import { getStudioHref } from "@/src/lib/region/cell";
import { CrewApiError, crewApi } from "@/app/(site)/crews/_hooks/api";
import { crewAccountQueries, crewKeys } from "@/app/(site)/crews/_hooks/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { WorkbenchFilmPicker } from "./workbench-film-picker";
import { canvasImportProjectId } from "./canvas-import-link";
import type { WorkbenchTaskBatch } from "./workbench-task-batch";
type Preview = {
  projectId: string;
  title: string;
  importKey?: string;
  existingSourceNodeIds?: string[];
  sourceRevision: number;
  sourceHash: string;
  plotTree: { nodes: Array<{ id: string; type: string; content: { title?: string } }> };
};
export function WorkbenchCanvasImport({
  crewId,
  onStage,
}: {
  crewId: string;
  onStage?: (batch: WorkbenchTaskBatch) => void;
}) {
  const { user } = useCurrentUser();
  return user ? (
    <CanvasImportSession
      key={`${crewId}:${user.id}`}
      crewId={crewId}
      userId={user.id}
      onStage={onStage}
    />
  ) : null;
}
function CanvasImportSession({
  crewId,
  userId,
  onStage,
}: {
  crewId: string;
  userId: string;
  onStage?: (batch: WorkbenchTaskBatch) => void;
}) {
  const t = useTranslations("crewTaskProject.workbench");
  const locale = useLocale();
  const client = useQueryClient();
  const [link, setLink] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [uncertain, setUncertain] = useState(false);
  const [done, setDone] = useState(false);
  const lock = useRef(false);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const path = (id: string) =>
    `/crews/${encodeURIComponent(crewId)}/canvas-task-import/story-projects/${encodeURIComponent(id)}`;
  async function load(selectedLink = link) {
    if (lock.current || uncertain || done) return;
    const id = canvasImportProjectId(selectedLink, getStudioHref(locale));
    if (!id) {
      setError(t("invalidCanvasLink"));
      return;
    }
    lock.current = true;
    setBusy(true);
    setError(null);
    setPreview(null);
    try {
      const result = await crewApi.get<Preview>(`${path(id)}/preview`, { cache: "no-store" });
      if (alive.current) setPreview(result);
    } catch (cause) {
      if (alive.current) setError(cause instanceof Error ? cause.message : t("failed"));
    } finally {
      lock.current = false;
      if (alive.current) setBusy(false);
    }
  }
  async function confirm() {
    if (!preview || lock.current || done) return;
    if (onStage) {
      onStage({
        key: `canvas:${preview.projectId}${preview.importKey ? `:${preview.importKey}` : ""}`,
        title: preview.title,
        path: `${path(preview.projectId)}/apply`,
        body: {
          sourceRevision: preview.sourceRevision,
          sourceHash: preview.sourceHash,
          ...(preview.importKey ? { importKey: preview.importKey } : {}),
        },
        items: scenes.map((node) => ({
          title: node.content.title || node.id,
          assetCategory: "production",
        })),
      });
      setPreview(null);
      setLink("");
      return;
    }
    lock.current = true;
    setBusy(true);
    setError(null);
    try {
      await crewApi.post(`${path(preview.projectId)}/apply`, {
        body: {
          sourceRevision: preview.sourceRevision,
          sourceHash: preview.sourceHash,
          ...(preview.importKey ? { importKey: preview.importKey } : {}),
        },
      });
      if (!alive.current) return;
      setDone(true);
      setUncertain(false);
      void Promise.allSettled([
        client.invalidateQueries(crewAccountQueries(crewKeys.tasks(crewId), userId)),
        client.invalidateQueries(crewAccountQueries(crewKeys.taskSummary(crewId), userId)),
        client.invalidateQueries(crewAccountQueries(crewKeys.productionOverview(crewId), userId)),
      ]);
    } catch (cause) {
      if (alive.current) {
        const rejected =
          cause instanceof CrewApiError && [400, 401, 403, 404, 409, 422].includes(cause.status);
        setUncertain(!rejected);
        if (rejected) setPreview(null);
        setError(cause instanceof Error ? cause.message : t("failed"));
      }
    } finally {
      lock.current = false;
      if (alive.current) setBusy(false);
    }
  }
  const scenes =
    preview?.plotTree.nodes.filter(
      (node) => node.type === "scene" && !preview.existingSourceNodeIds?.includes(node.id)
    ) ?? [];
  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">{t("canvasImportHelp")}</p>
      <WorkbenchFilmPicker
        crewId={crewId}
        disabled={busy || uncertain || done}
        onSelect={(url) => {
          setLink(url);
          setPreview(null);
          setError(null);
          void load(url);
        }}
      />
      <form
        className="flex flex-wrap gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          void load();
        }}
      >
        <Input
          className="w-full min-w-0"
          aria-label={t("canvasLink")}
          placeholder={t("canvasLink")}
          value={link}
          maxLength={2048}
          disabled={busy || uncertain || done}
          onChange={(event) => {
            setLink(event.target.value);
            setPreview(null);
            setError(null);
          }}
        />
        <Button size="sm" type="submit" disabled={busy || uncertain || done || !link.trim()}>
          {t("previewImport")}
        </Button>
      </form>
      {busy ? (
        <p role="status" className="text-xs text-muted-foreground">
          {t("loading")}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      ) : null}
      {preview ? (
        <div className="space-y-2">
          <p className="break-words text-sm font-medium">{preview.title}</p>
          {!scenes.length ? (
            <p role="status" className="text-xs text-muted-foreground">
              {t(
                preview.plotTree.nodes.some((node) => node.type === "scene")
                  ? "canvasAlreadyImported"
                  : "emptyCanvas"
              )}
            </p>
          ) : null}
          <ul className="max-h-48 overflow-auto text-xs text-muted-foreground">
            {scenes.map((node) => (
              <li key={node.id} className="py-1">
                {node.content.title || node.id}
              </li>
            ))}
          </ul>
          {uncertain ? (
            <p role="status" className="text-xs">
              {t("importRetryHelp")}
            </p>
          ) : null}
          {done ? (
            <p
              role="status"
              className="rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm font-medium leading-6 text-white/80"
            >
              {t("importDone")}
            </p>
          ) : (
            <Button
              size="sm"
              disabled={busy || !scenes.length || scenes.length > 200}
              onClick={() => void confirm()}
            >
              {onStage
                ? t("stageTasks")
                : uncertain
                  ? t("retryImport")
                  : t("confirmImport", { count: scenes.length })}
            </Button>
          )}
        </div>
      ) : null}
    </div>
  );
}
