"use client";

import { useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
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
  const [, render] = useState(0);
  const context = useQuery({
    queryKey: ["project-crew-assets", projectId, "context", userId],
    queryFn: ({ signal }) => getProjectCrewAssetContext(projectId, signal),
    enabled: Boolean(projectId && userId),
    retry: false,
  });
  const crewId = context.data?.crew?.id;
  const canSave = Boolean(context.data?.canSaveFromCanvas);
  const scope = useMemo(
    () => ({
      projectId,
      documentId,
      userId,
      canEdit,
      crewId,
      canSave,
      pending: new Map<string, AbortController>(),
    }),
    [projectId, documentId, userId, canEdit, crewId, canSave]
  );
  const active = useRef<typeof scope | null>(scope);
  useLayoutEffect(() => {
    active.current = scope;
    return () => {
      if (active.current === scope) active.current = null;
      scope.pending.forEach((controller) => controller.abort());
      scope.pending.clear();
    };
  }, [scope]);
  return (
    <CanvasMediaActionsProvider
      value={(media) => {
        if (!canEdit || !documentId || !context.data?.canSaveFromCanvas || media.kind === "audio")
          return [];
        return [
          {
            id: "save-to-crew",
            label: t("save"),
            pending: scope.pending.has(media.mediaAssetId),
            icon: scope.pending.has(media.mediaAssetId) ? (
              <IconLoader2 className="size-4 animate-spin" />
            ) : (
              <IconFolderPlus className="size-4" />
            ),
            onSelect: () => {
              if (active.current !== scope || scope.pending.has(media.mediaAssetId)) return;
              const controller = new AbortController();
              scope.pending.set(media.mediaAssetId, controller);
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
                  if (controller.signal.aborted || active.current !== scope) return;
                  toast.success(t("saved", { folder: result.folderName }));
                  void client.invalidateQueries({ queryKey: ["project-crew-assets"] });
                })
                .catch((error: unknown) => {
                  if (!controller.signal.aborted && active.current === scope)
                    toast.error(error instanceof Error ? error.message : t("failed"));
                })
                .finally(() => {
                  if (controller.signal.aborted || active.current !== scope) return;
                  scope.pending.delete(media.mediaAssetId);
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
