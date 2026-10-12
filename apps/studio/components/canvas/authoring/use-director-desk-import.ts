"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { useTranslations } from "next-intl";
import { useSiteRegion } from "@/app/_components/region-provider";
import { useProjectUIStore } from "@/app/[locale]/project/_stores/project-ui-store";
import { useCanvasGraphContext } from "@/lib/canvas-core/canvas-graph-context";
import {
  importDirectorCaptures,
  directorDeskOrigin,
  DIRECTOR_DESK_STAGING_RESULT,
  type DirectorCapturesMessage,
  requestDirectorDeskCapture,
  parseDirectorCapturesMessage,
  parseDirectorDeskCommandError,
} from "@/lib/canvas-authoring/director-desk-import";

const CAPTURE_TIMEOUT_MS = 45_000;

export function useDirectorDeskImport({
  workspaceId,
  projectId,
  canEdit,
}: {
  workspaceId?: string | null;
  projectId: string;
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
  const active = useRef<{
    target: Window;
    requestId: string;
    queue: DirectorCapturesMessage[];
    seen: Set<string>;
    processing: boolean;
  } | null>(null);
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
    active.current = null;
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
      if (!open || !canEdit || !graphCanEdit || !target || active.current) return;
      const requestId = crypto.randomUUID();
      active.current = { target, requestId, queue: [], seen: new Set(), processing: false };
      setBusy(true);
      timeoutRef.current = window.setTimeout(() => {
        timeoutRef.current = null;
        active.current = null;
        setBusy(false);
        toast.error(t("captureTimeout"));
      }, CAPTURE_TIMEOUT_MS);
      requestDirectorDeskCapture(target, region, requestId);
    },
    [open, canEdit, graphCanEdit, region, t]
  );

  useEffect(() => {
    if (!open || !canEdit || !graphCanEdit) return;

    const onMessage = (event: MessageEvent) => {
      const session = active.current;
      if (
        !session ||
        event.origin !== directorDeskOrigin(region) ||
        event.source !== session.target
      )
        return;
      const staging = event.data?.type === DIRECTOR_DESK_STAGING_RESULT;
      if (staging && event.data.requestId !== session.requestId) return;
      const commandError = parseDirectorDeskCommandError(event.data);
      if (commandError) {
        if (!session.processing) clearBusy();
        toast.error(commandError);
        return;
      }
      const parsed = parseDirectorCapturesMessage(event.data);
      if (!parsed || (!staging && parsed.payload.instanceId !== projectId)) return;
      if (session.seen.has(parsed.payload.operationId)) return;
      session.seen.add(parsed.payload.operationId);
      session.queue.push(parsed);
      // The capture arrived. Upload duration is independent of the capture timeout.
      if (timeoutRef.current != null) window.clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
      if (session.processing) return;
      session.processing = true;
      void (async () => {
        let failed = false;
        let count = 0;
        while (active.current === session && session.queue.length) {
          const message = session.queue.shift()!;
          try {
            const assets = await importDirectorCaptures({
              captures: message.payload.captures,
              workspaceId,
            });
            // Closing, changing project or losing permission invalidates the session.
            if (active.current !== session) return;
            addAssets(assets);
            const origin = getNodes().length;
            const ids = assets.map((asset, index) => {
              const id = crypto.randomUUID();
              addNode({
                id,
                type: "image",
                position: { x: 80 + (origin + index) * 36, y: 80 + (origin + index) * 36 },
                data: { src: asset.url, mediaAssetId: asset.mediaAssetId, label: asset.name },
              });
              return id;
            });
            selectNodes(ids);
            count += assets.length;
          } catch (error) {
            if (active.current !== session) return;
            failed = true;
            session.seen.delete(message.payload.operationId);
            toast.error(error instanceof Error ? error.message : t("importFailed"));
          }
        }
        if (active.current !== session) return;
        clearBusy();
        if (!failed) setDialogOpen(false);
        if (count) toast.success(t("imported", { count }));
      })();
    };

    window.addEventListener("message", onMessage);
    return () => {
      window.removeEventListener("message", onMessage);
      clearBusy();
    };
  }, [
    open,
    projectId,
    region,
    workspaceId,
    canEdit,
    graphCanEdit,
    addAssets,
    addNode,
    getNodes,
    selectNodes,
    clearBusy,
    setDialogOpen,
    t,
  ]);

  return { open: openDesk, isOpen: open, setOpen: setDialogOpen, busy, capture };
}
