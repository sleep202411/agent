"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { useTranslations } from "next-intl";
import { useSiteRegion } from "@/app/_components/region-provider";
import { useProjectUIStore } from "@/app/[locale]/project/_stores/project-ui-store";
import { useCanvasGraphContext } from "@/lib/canvas-core/canvas-graph-context";
import {
  importDirectorCaptures,
  isDirectorDeskOrigin,
  requestDirectorDeskCapture,
  parseDirectorCapturesMessage,
  parseDirectorDeskCommandError,
} from "@/lib/canvas-authoring/director-desk-import";

const CAPTURE_TIMEOUT_MS = 45_000;

export function useDirectorDeskImport({
  workspaceId,
  canEdit,
}: {
  workspaceId?: string | null;
  canEdit: boolean;
}) {
  const t = useTranslations("canvasNodes.asset.directorDesk");
  const region = useSiteRegion();
  const {
    addAssets,
    addNode,
    getNodes,
    selectNodes,
    canEdit: graphCanEdit,
  } = useCanvasGraphContext();
  const seenOperations = useRef(new Set<string>());
  const importing = useRef(false);
  const timeoutRef = useRef<number | null>(null);
  const open = useProjectUIStore((s) => s.directorDeskOpen);
  const storeOpen = useProjectUIStore((s) => s.openDirectorDesk);
  const storeClose = useProjectUIStore((s) => s.closeDirectorDesk);
  const [busy, setBusy] = useState(false);

  const clearBusy = useCallback(() => {
    if (timeoutRef.current != null) {
      window.clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    importing.current = false;
    setBusy(false);
  }, []);

  const openDesk = useCallback(() => {
    if (!canEdit || !graphCanEdit) {
      toast.error(t("editRequired"));
      return;
    }
    storeOpen();
  }, [canEdit, graphCanEdit, storeOpen, t]);

  const setDialogOpen = useCallback(
    (next: boolean) => {
      if (!next) {
        clearBusy();
        storeClose();
        return;
      }
      storeOpen();
    },
    [clearBusy, storeClose, storeOpen]
  );

  const capture = useCallback(
    (target: Window | null | undefined) => {
      if (busy || importing.current) return;
      setBusy(true);
      timeoutRef.current = window.setTimeout(() => {
        timeoutRef.current = null;
        importing.current = false;
        setBusy(false);
        toast.error(t("captureTimeout"));
      }, CAPTURE_TIMEOUT_MS);
      requestDirectorDeskCapture(target, region);
    },
    [busy, region, t]
  );

  useEffect(() => {
    if (!canEdit || !graphCanEdit) return;

    const onMessage = (event: MessageEvent) => {
      if (!isDirectorDeskOrigin(event.origin)) return;
      const commandError = parseDirectorDeskCommandError(event.data);
      if (commandError) {
        clearBusy();
        toast.error(commandError);
        return;
      }
      const parsed = parseDirectorCapturesMessage(event.data);
      if (!parsed || seenOperations.current.has(parsed.payload.operationId)) return;
      seenOperations.current.add(parsed.payload.operationId);
      if (importing.current) return;
      importing.current = true;
      setBusy(true);
      void importDirectorCaptures({
        captures: parsed.payload.captures,
        workspaceId,
      })
        .then((assets) => {
          if (assets.length === 0) return;
          addAssets(assets);
          const origin = getNodes().length;
          const ids = assets.map((asset, index) => {
            const id = crypto.randomUUID();
            addNode({
              id,
              type: "image",
              position: {
                x: 80 + (origin + index) * 36,
                y: 80 + (origin + index) * 36,
              },
              data: {
                src: asset.url,
                mediaAssetId: asset.mediaAssetId,
                label: asset.name,
              },
            });
            return id;
          });
          selectNodes(ids);
          setDialogOpen(false);
          toast.success(t("imported", { count: assets.length }));
        })
        .catch((error) => {
          seenOperations.current.delete(parsed.payload.operationId);
          toast.error(error instanceof Error ? error.message : t("importFailed"));
        })
        .finally(() => {
          clearBusy();
        });
    };

    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [
    addAssets,
    addNode,
    canEdit,
    clearBusy,
    getNodes,
    graphCanEdit,
    selectNodes,
    setDialogOpen,
    t,
    workspaceId,
  ]);

  return { open: openDesk, isOpen: open, setOpen: setDialogOpen, busy, capture };
}
