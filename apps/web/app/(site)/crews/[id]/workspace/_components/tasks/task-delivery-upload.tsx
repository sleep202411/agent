"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { IconUpload } from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import { useTranslations } from "@/src/i18n/i18n";
import { uploadFileViaSignedUrl, type UploadFileCheckpoint } from "@/src/lib/media-upload";
import { crewApi } from "@/app/(site)/crews/_hooks/api";
import { crewKeys } from "@/app/(site)/crews/_hooks/shared";
import {
  attachCrewAssetFile,
  useCrewAssetContext,
  type CrewAssetNodeDTO,
} from "../../_hooks/use-crew-assets";

type Job = {
  file: File;
  parentId: string | null;
  checkpoint?: UploadFileCheckpoint;
  mediaAssetId?: string;
};

/** Each mounted field owns its retry receipt; changing task/account/template remounts it. */
export function TaskDeliveryUpload({
  crewId,
  taskId,
  parentId,
  label,
  disabled,
  onUploaded,
  onBusyChange,
}: {
  crewId: string;
  taskId?: string;
  parentId: string | null;
  label: string;
  disabled: boolean;
  onUploaded: (asset: CrewAssetNodeDTO) => void;
  onBusyChange: (busy: boolean) => void;
}) {
  const t = useTranslations("crewDeliveryTemplate");
  const context = useCrewAssetContext(crewId);
  const client = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const request = useRef<AbortController | null>(null);
  const job = useRef<Job | null>(null);
  const callbacks = useRef({ onUploaded, onBusyChange });
  useLayoutEffect(() => {
    callbacks.current = { onUploaded, onBusyChange };
  });
  const [fileName, setFileName] = useState("");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const allowed =
    !context.isError &&
    context.data?.storageAvailable === true &&
    context.data.capabilities.upload === true;
  useLayoutEffect(
    () => () => {
      request.current?.abort();
      request.current = null;
    },
    []
  );

  async function run(file?: File) {
    if (disabled || !allowed || request.current) return;
    if (file) job.current = { file, parentId };
    const current = job.current;
    if (!current) return;
    const controller = new AbortController();
    request.current = controller;
    setFileName(current.file.name);
    setBusy(true);
    setError(null);
    callbacks.current.onBusyChange(true);
    try {
      if (taskId && !current.parentId) {
        const task = await crewApi.put<{ deliveryFolder: { id: string } | null }>(
          `/crew-tasks/${encodeURIComponent(taskId)}/delivery-folder`,
          { body: { deliveryFolderId: null }, signal: controller.signal }
        );
        if (controller.signal.aborted) return;
        if (!task.deliveryFolder?.id) throw new Error(t("uploadFailed"));
        current.parentId = task.deliveryFolder.id;
        void client.invalidateQueries({ queryKey: crewKeys.task(taskId) }).catch(() => undefined);
      }
      if (!current.mediaAssetId) {
        const uploaded = await uploadFileViaSignedUrl(current.file, {
          kind: "crew_asset_file",
          scope: { crewId },
          signal: controller.signal,
          resumeFrom: current.checkpoint,
          onProgress: (value) => {
            if (!controller.signal.aborted) setProgress(value);
          },
          onCheckpoint: (checkpoint) => {
            current.checkpoint = checkpoint;
          },
        });
        current.mediaAssetId = uploaded.mediaAssetId;
      }
      if (controller.signal.aborted) return;
      // Attachment retries reuse the confirmed media ID; the server returns the same node.
      const node = await attachCrewAssetFile(
        crewId,
        {
          name: current.file.name,
          parentId: current.parentId,
          mediaAssetId: current.mediaAssetId,
        },
        controller.signal
      );
      if (controller.signal.aborted) return;
      callbacks.current.onUploaded(node);
      job.current = null;
      setProgress(0);
      void client.invalidateQueries({ queryKey: crewKeys.assets(crewId) }).catch(() => undefined);
    } catch (cause) {
      if (!controller.signal.aborted)
        setError(cause instanceof Error ? cause.message : t("uploadFailed"));
    } finally {
      if (!controller.signal.aborted) {
        request.current = null;
        setBusy(false);
        callbacks.current.onBusyChange(false);
      }
    }
  }

  return (
    <div className="space-y-2">
      <Button
        variant="outline"
        size="sm"
        disabled={disabled || busy || !allowed || Boolean(error)}
        icon={<IconUpload />}
        onClick={() => input.current?.click()}
      >
        {busy ? t("uploadProgress", { percent: Math.round(progress) }) : t("uploadFile")}
      </Button>
      <input
        ref={input}
        type="file"
        hidden
        aria-label={`${t("uploadFile")}: ${label}`}
        disabled={disabled || busy || !allowed || Boolean(error)}
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file) void run(file);
        }}
      />
      {!allowed ? <p className="text-xs text-muted-foreground">{t("uploadUnavailable")}</p> : null}
      {busy ? (
        <p role="status" className="text-xs">
          {fileName}
        </p>
      ) : null}
      {error ? (
        <div role="alert" className="space-y-2 text-xs text-destructive">
          <p>
            {fileName}: {error}
          </p>
          <Button
            variant="outline"
            size="sm"
            disabled={disabled || busy || !allowed}
            onClick={() => void run()}
          >
            {t("retry")}
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={disabled || busy}
            onClick={() => {
              if (request.current) return;
              job.current = null;
              setFileName("");
              setProgress(0);
              setError(null);
            }}
          >
            {t("clearFailedUpload")}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
