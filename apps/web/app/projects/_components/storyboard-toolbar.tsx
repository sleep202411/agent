"use client";

import { useState } from "react";
import { IconDownload, IconLoader2, IconPlus, IconRefresh, IconUpload } from "@tabler/icons-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { StoryboardAiImportDialog } from "@/app/projects/_components/storyboard-ai-import-dialog";
import { StoryboardFieldSettingsPanel } from "@/app/projects/_components/storyboard-field-settings-panel";
import { StoryboardViewModeToggle } from "@/app/projects/_components/storyboard-view-mode-toggle";
import { backendApi } from "@/src/lib/api";
import { exportStoryboard } from "@/src/lib/storyboard-export";
import { useTranslations } from "@/src/i18n/i18n";
import { useAppSelector, useAppDispatch } from "@/src/store";
import {
  setRows as setRowsAction,
  touchStoryboard,
  selectCurrentInstance,
} from "@/src/store/slices/projectSlice";

function resolveShotId(result: unknown) {
  if (typeof result === "string" || typeof result === "number") {
    return String(result);
  }
  if (result && typeof result === "object") {
    const record = result as Record<string, unknown>;
    if (typeof record.id === "string" || typeof record.id === "number") {
      return String(record.id);
    }
    if (typeof record.data === "string" || typeof record.data === "number") {
      return String(record.data);
    }
  }
  return "";
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export function StoryboardToolbar() {
  const t = useTranslations("storyboard");
  const dispatch = useAppDispatch();
  const projectId = useAppSelector((s) => s.project.currentProjectId);
  const activeEpisodeId = useAppSelector((s) => selectCurrentInstance(s).activeEpisodeId);
  const columns = useAppSelector((s) => selectCurrentInstance(s).columns);
  const rows = useAppSelector((s) => selectCurrentInstance(s).rows);
  const isStoryboardLoading = useAppSelector((s) => selectCurrentInstance(s).isStoryboardLoading);
  const setRows = (v: Parameters<typeof setRowsAction>[0]) => dispatch(setRowsAction(v));

  const [addingShot, setAddingShot] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [showAiImport, setShowAiImport] = useState(false);

  const noStoryboard = !activeEpisodeId;

  const handleAddShot = async () => {
    if (!projectId || !activeEpisodeId || addingShot) return;

    setAddingShot(true);
    try {
      const result = await backendApi.post<Record<string, unknown>>("/api/user/shot/create", {
        data: { projectId, storyBoardId: activeEpisodeId, enable: true },
      });
      const shotId = resolveShotId(result);
      if (!shotId) {
        throw new Error("创建镜头失败");
      }

      setRows([...rows, { shotId, shotValues: [] }]);
      requestAnimationFrame(() => {
        const container = document.querySelector(".storyboard-table-scroll");
        if (container instanceof HTMLElement) {
          container.scrollTo({ top: container.scrollHeight, behavior: "smooth" });
        }
      });
    } catch (error) {
      console.error("[StoryboardToolbar] 创建镜头失败:", error);
      toast.error(error instanceof Error ? error.message : t("createShotFailed"));
    } finally {
      setAddingShot(false);
    }
  };

  const handleExport = async () => {
    if (!activeEpisodeId) return;

    setExporting(true);
    try {
      const blob = await exportStoryboard(activeEpisodeId);
      downloadBlob(blob, `storyboard-${new Date().toISOString().slice(0, 10)}.xlsx`);
      toast.success(t("exportSuccess"));
    } catch (error) {
      console.error("[StoryboardToolbar] 导出分镜表失败:", error);
      toast.error(t("exportFailed"));
    } finally {
      setExporting(false);
    }
  };

  return (
    <>
      <div className="flex items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-4">
          <Button
            variant="outline"
            color="primary"
            disabled={noStoryboard || isStoryboardLoading || addingShot}
            onClick={() => void handleAddShot()}
          >
            {addingShot ? (
              <IconLoader2 className="size-4 animate-spin" />
            ) : (
              <IconPlus className="size-4" />
            )}
            {t("createShot")}
          </Button>

          <Button
            variant="outline"
            color="primary"
            disabled={noStoryboard || isStoryboardLoading}
            onClick={() => setShowAiImport(true)}
          >
            <IconDownload className="size-4" />
            {t("aiImportStoryboard")}
          </Button>

          <Button
            variant="outline"
            color="primary"
            disabled={noStoryboard || isStoryboardLoading || exporting}
            onClick={() => void handleExport()}
          >
            {exporting ? (
              <IconLoader2 className="size-4 animate-spin" />
            ) : (
              <IconUpload className="size-4" />
            )}
            {t("exportStoryboard")}
          </Button>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <StoryboardViewModeToggle />
          <Button
            variant="ghost"
            size="icon"
            title={t("refreshStoryboard")}
            disabled={noStoryboard || isStoryboardLoading}
            onClick={() => dispatch(touchStoryboard())}
            className="text-muted-foreground hover:text-foreground"
          >
            <IconRefresh className="size-4" />
          </Button>
          <StoryboardFieldSettingsPanel
            storyBoardId={activeEpisodeId}
            disabled={noStoryboard || isStoryboardLoading}
          />
        </div>
      </div>

      <StoryboardAiImportDialog
        open={showAiImport}
        onOpenChange={setShowAiImport}
        storyBoardId={activeEpisodeId}
        columns={columns}
      />
    </>
  );
}
