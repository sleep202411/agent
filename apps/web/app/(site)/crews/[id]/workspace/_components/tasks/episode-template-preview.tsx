"use client";

import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { crewApi } from "@/app/(site)/crews/_hooks/api";
import { crewAccountQueries, crewKeys } from "@/app/(site)/crews/_hooks/shared";
import { useCurrentUser } from "@/src/hooks/use-user";
import { useTranslations } from "@/src/i18n/i18n";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogTitle,
} from "@/components/ui/dialog";

import type { WorkbenchTaskBatch } from "./workbench-task-batch";
type Plan = {
  templateId: string;
  templateVersion: number;
  episodeVersion: number;
  name: string;
  items: Array<{
    templateKey: string;
    title: string;
    roleRequirement: string;
    defaultDependencies: string[];
    deliveryFields: Array<{ type: string; required: boolean }>;
  }>;
};
export function EpisodeTemplatePreview({
  crewId,
  episodeId,
  onClose,
  onStage,
}: {
  crewId: string;
  episodeId: string;
  onClose: () => void;
  onStage?: (batch: WorkbenchTaskBatch) => void;
}) {
  const { user } = useCurrentUser();
  return (
    <EpisodeTemplateSession
      key={`${crewId}:${episodeId}:${user?.id ?? ""}`}
      crewId={crewId}
      episodeId={episodeId}
      userId={user?.id ?? null}
      onClose={onClose}
      onStage={onStage}
    />
  );
}
function EpisodeTemplateSession({
  crewId,
  episodeId,
  userId,
  onClose,
  onStage,
}: {
  crewId: string;
  episodeId: string;
  userId: string | null;
  onClose: () => void;
  onStage?: (batch: WorkbenchTaskBatch) => void;
}) {
  const t = useTranslations("crewTaskProject.episodeTemplate");
  const workbenchT = useTranslations("crewTaskProject.workbench");
  const client = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ taskIds: string[]; replayed: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const lock = useRef(false);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const path = `/crews/${encodeURIComponent(crewId)}/episodes/${encodeURIComponent(episodeId)}/task-template`;
  const preview = useQuery({
    queryKey: ["crew-episode-template", crewId, episodeId, userId],
    enabled: Boolean(userId),
    staleTime: 0,
    retry: false,
    queryFn: ({ signal }) => crewApi.get<Plan>(path, { signal, cache: "no-store" }),
  });
  async function confirm() {
    if (!userId || !preview.data || preview.isError || preview.isFetching || lock.current || result)
      return;
    const { templateId, templateVersion, episodeVersion } = preview.data;
    if (onStage) {
      onStage({
        key: `episode:${episodeId}`,
        title: preview.data.name,
        path,
        body: { templateId, templateVersion, episodeVersion },
        items: preview.data.items.map((item) => ({
          title: item.title,
          role: item.roleRequirement,
        })),
      });
      onClose();
      return;
    }
    lock.current = true;
    setBusy(true);
    setError(null);
    try {
      const response = await crewApi.post<{ taskIds: string[]; replayed: boolean }>(path, {
        body: { templateId, templateVersion, episodeVersion },
      });
      if (!alive.current) return;
      setResult(response);
      // Cache refresh must not turn a committed creation into a failed write.
      void Promise.allSettled([
        client.invalidateQueries(crewAccountQueries(crewKeys.tasks(crewId), userId)),
        client.invalidateQueries(crewAccountQueries(crewKeys.taskSummary(crewId), userId)),
        client.invalidateQueries({ queryKey: [...crewKeys.episodes(crewId), userId] }),
      ]);
    } catch (cause) {
      if (alive.current) setError(cause instanceof Error ? cause.message : t("failed"));
    } finally {
      lock.current = false;
      if (alive.current) setBusy(false);
    }
  }
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <DialogContent className="sm:max-w-3xl" aria-describedby={undefined}>
        <DialogTitle>{t("title")}</DialogTitle>
        <DialogBody className="max-h-[65vh] overflow-y-auto">
          <p className="mb-4 text-sm text-muted-foreground">{t("help")}</p>
          {preview.isPending ? <p>{t("loading")}</p> : null}
          {preview.isError || error ? (
            <p role="alert" className="mb-3 text-sm text-destructive">
              {error ?? preview.error?.message}
            </p>
          ) : null}
          {!result && (preview.isError || error) ? (
            <Button
              variant="outline"
              disabled={busy || preview.isFetching}
              onClick={() => {
                setError(null);
                void preview.refetch();
              }}
            >
              {t("reload")}
            </Button>
          ) : null}
          {result ? (
            <p role="status">
              {t(result.replayed ? "reused" : "created", { count: result.taskIds.length })}
            </p>
          ) : null}
          {preview.data && !preview.isError ? (
            <>
              <h3 className="mb-3 text-sm font-semibold">{preview.data.name}</h3>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr>
                      <th className="py-3">{t("task")}</th>
                      <th>{t("role")}</th>
                      <th>{t("dependencies")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.data.items.map((item) => (
                      <tr key={item.templateKey} className="border-t border-white/10">
                        <td className="py-3 pr-3">{item.title}</td>
                        <td className="pr-3">{item.roleRequirement}</td>
                        <td>
                          {item.defaultDependencies
                            .map(
                              (key) =>
                                preview.data!.items.find((task) => task.templateKey === key)
                                  ?.title ?? key
                            )
                            .join(", ") || "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          ) : null}
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" disabled={busy} onClick={onClose}>
            {t(result ? "done" : "cancel")}
          </Button>
          {!result ? (
            <Button
              className="bg-[#E52227] text-white hover:bg-[#E52227]/90"
              disabled={!userId || !preview.data || preview.isError || preview.isFetching || busy}
              onClick={() => void confirm()}
            >
              {onStage ? workbenchT("stageTemplate") : t(busy ? "creating" : "confirm")}
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
