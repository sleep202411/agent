"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { IconFolderPlus, IconLoader2 } from "@tabler/icons-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { getProjectCrewAssetContext } from "@/lib/collab/project-crew-assets-api";
import { CanvasMediaActionsProvider } from "./media-actions-context";

export function CrewSaveActions({
  projectId,
  documentId,
  userId,
  canEdit,
  children,
}: {
  projectId: string;
  documentId: string | null;
  userId: string;
  canEdit: boolean;
  children: ReactNode;
}) {
  const t = useTranslations("canvasNodes.crewSave");
  const client = useQueryClient();
  const pending = useRef(new Map<string, AbortController>());
  const [, render] = useState(0);
  useEffect(() => {
    const requests = pending.current;
    return () => {
      requests.forEach((controller) => controller.abort());
      requests.clear();
    };
  }, []);
  const context = useQuery({
    queryKey: ["project-crew-assets", projectId, "context", userId],
    queryFn: () => getProjectCrewAssetContext(projectId),
    enabled: Boolean(projectId && userId),
    retry: false,
  });
  return (
    <CanvasMediaActionsProvider
      value={(media) => {
        if (!canEdit || !documentId || !context.data?.canSaveFromCanvas || media.kind === "audio")
          return [];
        return [
          {
            id: "save-to-crew",
            label: t("save"),
            pending: pending.current.has(media.mediaAssetId),
            icon: pending.current.has(media.mediaAssetId) ? (
              <IconLoader2 className="size-4 animate-spin" />
            ) : (
              <IconFolderPlus className="size-4" />
            ),
            onSelect: () => {
              if (pending.current.has(media.mediaAssetId)) return;
              const controller = new AbortController();
              pending.current.set(media.mediaAssetId, controller);
              render((n) => n + 1);
              void api
                .post<{ folderName: string }>(
                  `/aurora/documents/${encodeURIComponent(documentId)}/crew-assets`,
                  {
                    data: { mediaAssetId: media.mediaAssetId },
                    signal: controller.signal,
                    requestScope: "project",
                  }
                )
                .then((result) => {
                  if (controller.signal.aborted) return;
                  toast.success(t("saved", { folder: result.folderName }));
                  void client.invalidateQueries({ queryKey: ["project-crew-assets"] });
                })
                .catch((error: unknown) => {
                  if (!controller.signal.aborted)
                    toast.error(error instanceof Error ? error.message : t("failed"));
                })
                .finally(() => {
                  if (controller.signal.aborted) return;
                  pending.current.delete(media.mediaAssetId);
                  render((n) => n + 1);
                });
            },
          },
        ];
      }}
    >
      {children}
    </CanvasMediaActionsProvider>
  );
}
