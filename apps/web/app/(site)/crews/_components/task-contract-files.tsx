"use client";
import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { useCurrentUser } from "@/src/hooks/use-user";
import { useLocale, useTranslations } from "@/src/i18n/i18n";
import { crewApi } from "../_hooks/api";
import { TaskDeliveryUpload } from "../[id]/workspace/_components/tasks/task-delivery-upload";
import { validEvidenceUrl } from "../_hooks/use-case-attachments";
export type TaskContractFile = {
  id: string;
  name: string;
  attachedAt: string | null;
  sizeBytes: string | null;
  contentType: string | null;
  available: boolean;
};
export function ContractFileRow({ file }: { file: TaskContractFile }) {
  const t = useTranslations("taskContractFiles"),
    locale = useLocale();
  const [link, setLink] = useState<{ url: string; expiresAt: string } | null>(null);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const download = useMutation({
    mutationFn: () =>
      crewApi.get<{ url: string; expiresAt: string }>(
        `/task-contract-files/${encodeURIComponent(file.id)}/download`,
        { cache: "no-store" }
      ),
    onSuccess: (result) => {
      if (
        !validEvidenceUrl(result.url) ||
        !Number.isFinite(Date.parse(result.expiresAt)) ||
        Date.parse(result.expiresAt) <= Date.now()
      )
        throw new Error(t("invalidLink"));
      if (alive.current) setLink(result);
    },
  });
  useEffect(() => {
    if (!link) return;
    const timer = setTimeout(
      () => setLink(null),
      Math.min(2147483647, Math.max(0, Date.parse(link.expiresAt) - Date.now()))
    );
    return () => clearTimeout(timer);
  }, [link]);
  return (
    <li className="flex flex-wrap items-center gap-3 rounded-lg border border-border p-3">
      <div className="min-w-0 flex-1">
        <p className="break-all text-sm font-medium">{file.name}</p>
        <p className="text-xs text-muted-foreground">
          {file.sizeBytes
            ? new Intl.NumberFormat(locale, {
                style: "unit",
                unit: Number(file.sizeBytes) >= 1000000 ? "megabyte" : "kilobyte",
                maximumFractionDigits: 1,
              }).format(
                Number(file.sizeBytes) / (Number(file.sizeBytes) >= 1000000 ? 1000000 : 1000)
              )
            : null}
          {file.attachedAt ? ` · ${new Date(file.attachedAt).toLocaleDateString(locale)}` : null}
        </p>
      </div>
      <span className="text-xs text-muted-foreground">{t("readOnly")}</span>
      {!file.available ? (
        <span>{t("unavailable")}</span>
      ) : link ? (
        <a
          href={link.url}
          target="_blank"
          rel="noopener noreferrer"
          referrerPolicy="no-referrer"
          className="text-sm text-primary underline"
        >
          {t("openDownload")}
        </a>
      ) : (
        <Button size="sm" disabled={download.isPending} onClick={() => download.mutate()}>
          {t("download")}
        </Button>
      )}
      {download.error && (
        <p role="alert" className="w-full text-sm">
          {download.error.message}
        </p>
      )}
    </li>
  );
}
export function TaskContractFiles({
  taskId,
  crewId,
  canManage,
}: {
  taskId: string;
  crewId: string;
  canManage: boolean;
}) {
  const { user } = useCurrentUser();
  return user ? (
    <ContractSession
      key={JSON.stringify([user.id, taskId])}
      userId={user.id}
      taskId={taskId}
      crewId={crewId}
      canManage={canManage}
    />
  ) : null;
}
function ContractSession({
  userId,
  taskId,
  crewId,
  canManage,
}: {
  userId: string;
  taskId: string;
  crewId: string;
  canManage: boolean;
}) {
  const t = useTranslations("taskContractFiles"),
    client = useQueryClient();
  const [pending, setPending] = useState<{ id: string; name: string } | null>(null),
    [uploading, setUploading] = useState(false);
  const key = ["task-contract-files", userId, taskId];
  const query = useQuery({
    queryKey: key,
    retry: false,
    queryFn: ({ signal }) =>
      crewApi.get<{ items: TaskContractFile[] }>(
        `/crew-tasks/${encodeURIComponent(taskId)}/contracts`,
        { signal, cache: "no-store" }
      ),
  });
  const attach = useMutation({
    mutationFn: (assetNodeId: string) =>
      crewApi.post(`/crew-tasks/${encodeURIComponent(taskId)}/contracts`, {
        body: { assetNodeId },
      }),
    onSuccess: async () => {
      setPending(null);
      await Promise.all([
        client.invalidateQueries({ queryKey: key }),
        client.invalidateQueries({ queryKey: ["my-task-contracts"] }),
      ]);
    },
  });
  return (
    <section className="space-y-3 py-3" aria-label={t("title")}>
      <h3 className="text-sm font-semibold">{t("title")}</h3>
      <p className="text-xs text-muted-foreground">{t("lockedHint")}</p>
      {query.isPending && <p role="status">{t("loading")}</p>}
      {query.error && (
        <div role="alert">
          <p>{query.error.message}</p>
          <Button disabled={query.isFetching} onClick={() => void query.refetch()}>
            {t("retry")}
          </Button>
        </div>
      )}
      {query.isSuccess && (
        <ul className="space-y-2">
          {query.data.items.map((file) => (
            <ContractFileRow key={file.id} file={file} />
          ))}
        </ul>
      )}
      {query.isSuccess && !query.data.items.length && (
        <p className="text-sm text-muted-foreground">{t("empty")}</p>
      )}
      {canManage && query.isSuccess && (
        <>
          <TaskDeliveryUpload
            crewId={crewId}
            parentId={null}
            label={t("upload")}
            disabled={Boolean(pending) || attach.isPending}
            onBusyChange={setUploading}
            onUploaded={(asset) => setPending({ id: asset.id, name: asset.name })}
          />
          {pending && (
            <div className="space-y-2">
              <p className="break-all text-sm">{pending.name}</p>
              <p className="text-xs text-muted-foreground">{t("attachNotice")}</p>
              <Button
                disabled={attach.isPending || uploading}
                onClick={() => attach.mutate(pending.id)}
              >
                {attach.isError ? t("retryAttach") : t("attach")}
              </Button>
              <Button
                variant="ghost"
                disabled={attach.isPending || uploading}
                onClick={() => {
                  setPending(null);
                  attach.reset();
                  void query.refetch();
                }}
              >
                {t("clearSelection")}
              </Button>
            </div>
          )}
          {attach.error && <p role="alert">{attach.error.message}</p>}
        </>
      )}
    </section>
  );
}
