"use client";

import { useEffect, useMemo, useState } from "react";
import {
  IconDownload,
  IconLoader2,
  IconPencil,
  IconPlus,
  IconRefresh,
  IconUpload,
} from "@tabler/icons-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ProjectEditorDialog } from "@/app/(project)/_components/project-editor-dialog";
import { StoryboardAiImportDialog } from "@/app/(project)/_components/storyboard-ai-import-dialog";
import { StoryboardFieldSettingsPanel } from "@/app/(project)/_components/storyboard-field-settings-panel";
import { backendApi } from "@/src/lib/api";
import { exportStoryboard } from "@/src/lib/storyboard-export";
import { fetchProjectDictionaries } from "@/src/lib/project-dictionaries";
import type { ProjectOptionItem } from "@/src/types/workspace";
import { useTranslations } from "@/src/i18n/i18n";
import { useAppSelector, useAppDispatch } from "@/src/store";
import {
  setRows as setRowsAction,
  setDetail as setDetailAction,
  touchProjectList as touchProjectListAction,
  touchStoryboard,
  selectCurrentInstance,
} from "@/src/store/slices/projectSlice";

function formatProjectSize(size?: string | null) {
  if (!size) return "";
  return String(size).replace(/^_+/, "").replace(/_/g, ":");
}

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
  const tc = useTranslations("common");
  const dispatch = useAppDispatch();
  const detail = useAppSelector((s) => selectCurrentInstance(s).detail);
  const projectId = useAppSelector((s) => s.project.currentProjectId);
  const worldId = useAppSelector((s) => selectCurrentInstance(s).worldId);
  const activeEpisodeId = useAppSelector((s) => selectCurrentInstance(s).activeEpisodeId);
  const columns = useAppSelector((s) => selectCurrentInstance(s).columns);
  const rows = useAppSelector((s) => selectCurrentInstance(s).rows);
  const isStoryboardLoading = useAppSelector((s) => selectCurrentInstance(s).isStoryboardLoading);
  const setRows = (v: Parameters<typeof setRowsAction>[0]) => dispatch(setRowsAction(v));
  const setDetail = (v: Parameters<typeof setDetailAction>[0]) => dispatch(setDetailAction(v));
  const touchProjectList = () => dispatch(touchProjectListAction());

  const [addingShot, setAddingShot] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [showAiImport, setShowAiImport] = useState(false);
  const [showProjectEditor, setShowProjectEditor] = useState(false);
  const [stylePaintingName, setStylePaintingName] = useState("");

  const noStoryboard = !activeEpisodeId;
  const detailStylePainting = detail?.stylePainting;
  const detailStylePaintingName = detail?.stylePaintingName;
  const formattedProjectSize = formatProjectSize(
    String(detail?.aspectRatioType ?? detail?.aspectRatio ?? "")
  );

  useEffect(() => {
    let active = true;

    fetchProjectDictionaries()
      .then((data) => {
        if (!active) return;
        const style = data.styleOptions.find(
          (item) => String(item.id ?? "") === String(detailStylePainting ?? "")
        );
        const nextStyleName = style?.info ?? "";
        setStylePaintingName(nextStyleName);
        if (detail && nextStyleName && detailStylePaintingName !== nextStyleName) {
          setDetail({ ...detail, stylePaintingName: nextStyleName });
        }
      })
      .catch((error) => {
        console.error("[StoryboardToolbar] 加载画风字典失败:", error);
        if (active) {
          setStylePaintingName("");
        }
      });

    return () => {
      active = false;
    };
  }, [detailStylePainting]); // eslint-disable-line react-hooks/exhaustive-deps

  const styleTagText = useMemo(() => {
    if (stylePaintingName) return stylePaintingName;
    if (detailStylePainting) return String(detailStylePainting);
    return "";
  }, [detailStylePainting, stylePaintingName]);

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

  const handleProjectSaved = (saved?: ProjectOptionItem | null) => {
    if (detail) {
      // Merge saved data with detail; saved from API may be partial,
      // so we also accept the full form payload via onSaved
      setDetail({ ...detail, ...(saved ?? {}) });
    }
    touchProjectList();
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

          {formattedProjectSize ? (
            <Button
              type="button"
              variant="soft"
              color="muted"
              onClick={() => setShowProjectEditor(true)}
            >
              <span>{`${t("projectSize")}: ${formattedProjectSize}`}</span>
              <IconPencil className="size-3.5" />
            </Button>
          ) : null}

          {styleTagText ? (
            <Button
              type="button"
              variant="soft"
              color="muted"
              size="lg"
              onClick={() => setShowProjectEditor(true)}
            >
              <span>{styleTagText}</span>
              <IconPencil className="size-3.5" />
            </Button>
          ) : null}
        </div>

        <div className="flex shrink-0 items-center gap-1">
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

      <ProjectEditorDialog
        open={showProjectEditor}
        worldId={String(worldId ?? "")}
        project={detail as ProjectOptionItem | null}
        onOpenChange={setShowProjectEditor}
        onSaved={handleProjectSaved}
      />
    </>
  );
}
