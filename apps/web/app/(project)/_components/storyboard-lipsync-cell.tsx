"use client";

import { useCallback, useRef, useState } from "react";
import { IconCircleCheck, IconLoader2, IconSparkles } from "@tabler/icons-react";
import { useTranslations } from "@/src/i18n/i18n";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { AiLipSyncGeneratorDialog } from "@/app/(project)/_components/storyboard/ai-generator";
import { useAppSelector } from "@/src/store";
import { store } from "@/src/store";
import {
  setRows,
  touchStoryboard,
  selectCurrentInstance,
  type ShotColumn,
  type ShotRow,
  type ShotValue,
} from "@/src/store/slices/projectSlice";
import { backendApi } from "@/src/lib/api";
import { toast } from "sonner";
import { env } from "@/src/env";

const OSS_BASE = env.OSS_BASE_URL;

function ossUrl(path?: string) {
  if (!path) return "";
  if (path.startsWith("http://") || path.startsWith("https://") || path.startsWith("blob:")) {
    return path;
  }
  return `${OSS_BASE}/${path}`;
}

type MediaFile = { path?: string; url?: string; preferred?: boolean; id?: string };

function getPreferredFilePath(cell?: ShotValue) {
  const files = (cell?.files as MediaFile[] | undefined) ?? [];
  const preferred = files.find((f) => f.preferred)?.path;
  return preferred ?? files[0]?.path ?? cell?.value ?? "";
}

function getPreferredFileSource(cell?: ShotValue) {
  const files = (cell?.files as MediaFile[] | undefined) ?? [];
  const preferred = files.find((f) => f.preferred) ?? files[0];
  return preferred?.url || preferred?.path || cell?.value || "";
}

interface LipSyncCellProps {
  cell?: ShotValue;
  shotId: string;
  shotColumnId: string;
  row?: ShotRow;
  column?: ShotColumn;
}

export function LipSyncCell({ cell, shotId, shotColumnId, row, column }: LipSyncCellProps) {
  const t = useTranslations("storyboard");
  const tc = useTranslations("common");
  const worldId = useAppSelector((state) => selectCurrentInstance(state).worldId);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [showDone, setShowDone] = useState(false);
  const doneTimerRef = useRef<number | null>(null);

  const files = (cell?.files as MediaFile[] | undefined) ?? [];
  const appliedPaths = files.map((f) => f.path ?? "").filter(Boolean);
  const preferredPath = files.find((f) => f.preferred)?.path ?? "";

  const updateFilesState = useCallback(
    (nextFiles: MediaFile[], cellId?: string) => {
      const currentRows = selectCurrentInstance(store.getState()).rows;
      const nextRows = currentRows.map((r) => {
        if (String(r.shotId ?? "") !== shotId) return r;
        const values = [...(r.shotValues ?? [])];
        const idx = values.findIndex((v) => String(v.shotColumnId ?? "") === shotColumnId);
        if (idx >= 0) {
          values[idx] = { ...values[idx], files: nextFiles, ...(cellId ? { id: cellId } : {}) };
        }
        return { ...r, shotValues: values };
      });
      store.dispatch(setRows(nextRows));
    },
    [shotColumnId, shotId]
  );

  const handleCollect = useCallback(
    async (item: { storagePath?: string }) => {
      const itemPath = item.storagePath ?? "";
      if (!itemPath) return;
      const nextPaths = Array.from(new Set([...appliedPaths, itemPath]));
      const nextFiles = nextPaths.map((p) => ({
        path: p,
        preferred: p === (preferredPath || nextPaths[0]),
      }));

      updateFilesState(nextFiles);

      try {
        const result = await backendApi.post("/api/user/shotValue/input", {
          data: { shotId, shotColumnId, value: "", values: nextPaths },
        });
        const nextId =
          typeof result === "string" || typeof result === "number" ? String(result) : "";
        if (nextId) updateFilesState(nextFiles, nextId);
      } catch {
        store.dispatch(touchStoryboard());
      }
    },
    [appliedPaths, preferredPath, shotColumnId, shotId, updateFilesState]
  );

  const handleSetPreferred = useCallback(
    async (item: { storagePath?: string }) => {
      const targetPath = item.storagePath ?? "";
      if (!targetPath) return;

      const nextFiles = files.map((f) => ({
        ...f,
        preferred: (f.path ?? "") === targetPath,
      }));
      if (!nextFiles.some((f) => f.path === targetPath)) {
        nextFiles.push({ path: targetPath, preferred: true });
      }
      updateFilesState(nextFiles);

      const cellId = typeof cell?.id === "string" ? cell.id : undefined;
      if (cellId) {
        try {
          await backendApi.post(`/api/user/shotValue/preferred/${cellId}`, {
            data: { value: targetPath, preferred: true },
          });
        } catch {
          store.dispatch(touchStoryboard());
        }
      }
    },
    [cell, files, updateFilesState]
  );

  const handleGenerateSuccess = useCallback(() => {
    if (!dialogOpen) {
      setShowDone(true);
      if (doneTimerRef.current) window.clearTimeout(doneTimerRef.current);
      doneTimerRef.current = window.setTimeout(() => {
        setShowDone(false);
        doneTimerRef.current = null;
      }, 2200);
    }
  }, [dialogOpen]);

  return (
    <>
      <div
        className="flex h-full w-full cursor-pointer items-center justify-center p-4"
        onClick={() => setDialogOpen(true)}
      >
        <Button
          size="sm"
          variant="soft"
          className={cn(isGenerating || showDone ? "gap-1.5" : "")}
          onClick={(e) => {
            e.stopPropagation();
            setDialogOpen(true);
          }}
        >
          {isGenerating ? (
            <IconLoader2 className="size-3.5 animate-spin" />
          ) : showDone ? (
            <IconCircleCheck className="size-3.5 text-green-500" />
          ) : (
            <IconSparkles className="size-3.5" />
          )}
          {t("aiLipSync")}
        </Button>
      </div>

      <AiLipSyncGeneratorDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        shotId={shotId}
        shotColumnId={shotColumnId}
        row={row}
        worldId={worldId ?? ""}
        defaultReferenceVideo={
          row?.shotValues?.find((v) => v.presetColumnKey === "video_path")
            ? getPreferredFileSource(
                row?.shotValues?.find((v) => v.presetColumnKey === "video_path")
              )
            : undefined
        }
        defaultReferenceAudio={
          row?.shotValues?.find((v) => v.presetColumnKey === "sound_path")
            ? getPreferredFileSource(
                row?.shotValues?.find((v) => v.presetColumnKey === "sound_path")
              )
            : undefined
        }
        appliedPaths={appliedPaths}
        preferredPath={preferredPath}
        onCollect={handleCollect}
        onSetPreferred={handleSetPreferred}
        onGeneratingChange={setIsGenerating}
        onGenerateSuccess={handleGenerateSuccess}
      />
    </>
  );
}
