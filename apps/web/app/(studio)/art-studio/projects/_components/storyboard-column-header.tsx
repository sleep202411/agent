"use client";

import { useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { IconDownload, IconLoader2 } from "@tabler/icons-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { backendApi } from "@/src/lib/api";
import { useTranslations } from "@/src/i18n/i18n";
import {
  BatchGenerateConfig,
  StoryboardBatchGenerateDialog,
} from "@/app/(studio)/art-studio/projects/_components/storyboard-batch-generate-dialog";
import { useAppSelector } from "@/src/store";
import { store } from "@/src/store";
import {
  setBatchGeneratingActive,
  setBatchGenerating,
  setBatchCompleted,
  clearBatchGenerating,
  touchStoryboard,
  selectCurrentInstance,
  type ShotColumn,
  type ShotRow,
  type ShotValue,
} from "@/src/store/slices/projectSlice";
import {
  BatchVoiceConfig,
  StoryboardBatchVoiceDialog,
} from "@/app/(studio)/art-studio/projects/_components/storyboard-batch-voice-dialog";
import { Field, FieldLabel, FieldDescription } from "@/components/ui/field";
import { env } from "@/src/env";
import { downloadBatch, batchAssetName } from "./storyboard-download";

const BATCH_INTERVAL = 10_000;
const IMAGE_DEFAULT_PRESET_KEYS = ["description", "shot_size", "perspective", "style_planting"];
const VIDEO_DEFAULT_PRESET_KEYS = ["video_prompt", "movement", "style_planting"];
const ROLE_LINE_RE = /^角色\s*[：:]\s*/;
const DIALOGUE_LABEL_RE = /^(?:台词|对白)\s*[：:]\s*/;
const NARRATION_LABEL_RE = /^旁白\s*[：:]\s*/;
const SPEAKER_LABEL_RE = /^(?:台词|对白|旁白)\s*[：:]\s*/;
const AT_PREFIX_RE = /(^|[\s\n])@(?=\S)/g;

type CellFile = {
  path?: string;
  url?: string;
  preferred?: boolean;
};

type ImageBatchItem = {
  shotId: string;
  columnId: string;
  prompt: string;
};

type VideoBatchItem = {
  shotId: string;
  columnId: string;
  prompt: string;
  startImageUrl: string;
};

type VoiceBatchItem = {
  shotId: string;
  columnId: string;
  text: string;
};

const OSS_BASE = env.OSS_BASE_URL;

function ossUrl(path?: string) {
  if (!path) return "";
  if (path.startsWith("http://") || path.startsWith("https://") || path.startsWith("blob:")) {
    return path;
  }
  return `${OSS_BASE}/${path}`;
}

function normalizeText(value: unknown) {
  return String(value ?? "").replace(/\r\n?/g, "\n");
}

function stripTags(text: string) {
  if (!text) return "";
  return text.replace(/<[^>]+>/g, "").trim();
}

function stripNonMentionTags(text: string) {
  if (!text) return "";
  return text.replace(/<(?!\/?mention[\s>])[^>]+>/g, "").trim();
}

function stripDialogueMarkup(value: unknown) {
  return normalizeText(value)
    .replace(/<mention\s+[^>]*>([\s\S]*?)<\/mention>/gi, "$1")
    .replace(/<(?!br\s*\/?)[^>]+>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(AT_PREFIX_RE, "$1")
    .trim();
}

function normalizeDialoguePlainText(value: unknown) {
  return stripDialogueMarkup(value)
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .join("\n");
}

function parseSpeakerPrefix(value: unknown) {
  const match = String(value ?? "")
    .trim()
    .match(/^([^：:\n]{1,40})\s*[：:]\s*([\s\S]*)$/);
  if (!match?.[1]) return null;
  return {
    speaker: match[1].trim(),
    content: String(match[2] ?? "").trim(),
  };
}

function stripSpeakerPrefix(value: unknown) {
  const text = String(value ?? "").trim();
  if (!text) return "";
  const parsed = parseSpeakerPrefix(text);
  return parsed?.content || text;
}

function parseDialogueSections(value: unknown) {
  const lines = normalizeDialoguePlainText(value)
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  const dialogueLines: string[] = [];
  const narrationLines: string[] = [];

  lines.forEach((line) => {
    if (ROLE_LINE_RE.test(line)) return;
    if (DIALOGUE_LABEL_RE.test(line)) {
      dialogueLines.push(line.replace(DIALOGUE_LABEL_RE, "").trim());
      return;
    }
    if (NARRATION_LABEL_RE.test(line)) {
      narrationLines.push(line.replace(NARRATION_LABEL_RE, "").trim());
      return;
    }
    dialogueLines.push(line.replace(SPEAKER_LABEL_RE, "").trim());
  });

  return { dialogueLines, narrationLines };
}

function stripDialogueRoleLines(value: unknown) {
  const { dialogueLines, narrationLines } = parseDialogueSections(value);
  const normalizedLines: string[] = [];

  dialogueLines.forEach((line) => {
    const content = stripSpeakerPrefix(line);
    if (content) {
      normalizedLines.push(`台词：${content}`);
    }
  });

  narrationLines.forEach((line) => {
    if (line) {
      normalizedLines.push(`旁白：${line}`);
    }
  });

  return normalizedLines.join("\n");
}

function asCellFiles(value: unknown): CellFile[] {
  return Array.isArray(value) ? (value as CellFile[]) : [];
}

function getPreferredFile(cell?: ShotValue) {
  const files = asCellFiles(cell?.files);
  if (!files.length) return null;
  return files.find((item) => item.preferred) ?? files[0] ?? null;
}

function getCellContentForPrompt(
  cell: ShotValue | undefined,
  columnId: string,
  columnsById: Map<string, ShotColumn>
) {
  if (!cell) return "";

  const column = columnsById.get(columnId);
  const columnType = column?.columnType?.toUpperCase() ?? "";
  const presetKey = column?.presetColumnKey ?? cell.presetColumnKey ?? "";

  if (presetKey === "scene" || columnType === "SCENE") {
    if (Array.isArray(cell.scenes) && cell.scenes.length > 0) {
      const scene = cell.scenes[0] as {
        id?: string;
        name?: string;
        sceneImgPath?: string[];
      };
      const imagePath = scene.sceneImgPath?.[0] ?? "";
      return `<mention id="${scene.id ?? ""}" type="scene" imgUrl="${ossUrl(imagePath)}">${scene.name ?? ""}</mention>`;
    }
    return stripTags(cell.value ?? "");
  }

  if (presetKey === "character" || columnType === "CHARACTER") {
    if (Array.isArray(cell.characters) && cell.characters.length > 0) {
      return cell.characters
        .map((character) => {
          const item = character as {
            id?: string;
            name?: string;
            roleImgPath?: string[];
          };
          const imagePath = item.roleImgPath?.[0] ?? "";
          return `<mention id="${item.id ?? ""}" type="character" imgUrl="${ossUrl(imagePath)}">${item.name ?? ""}</mention>`;
        })
        .join(" ");
    }
    return "";
  }

  if (
    presetKey === "image_prompt" ||
    presetKey === "description" ||
    columnType === "RICH_TEXT" ||
    columnType === "RICHTEXT"
  ) {
    return stripNonMentionTags(cell.richText?.content ?? cell.value ?? "");
  }

  return stripTags(cell.richText?.content ?? cell.value ?? "");
}

function buildPromptForRow(
  row: ShotRow,
  targetColumn: ShotColumn,
  presetKeys: string[],
  columnsById: Map<string, ShotColumn>,
  stylePaintingName: string
) {
  const shotValues = row.shotValues ?? [];
  const aiRef = Array.isArray(targetColumn.aiRef) ? targetColumn.aiRef : [];

  if (aiRef.length > 0) {
    const aiRefParts: string[] = [];
    aiRef.forEach((columnId) => {
      const cell = shotValues.find((item) => item.shotColumnId === String(columnId));
      const content = getCellContentForPrompt(cell, String(columnId), columnsById);
      if (content && stripTags(content).trim()) {
        aiRefParts.push(content);
      }
    });
    if (aiRefParts.length > 0) {
      return aiRefParts.join(", ");
    }
  }

  const parts: string[] = [];
  presetKeys.forEach((presetKey) => {
    const cell = shotValues.find((item) => item.presetColumnKey === presetKey);
    let content = cell
      ? getCellContentForPrompt(cell, String(cell.shotColumnId ?? ""), columnsById)
      : "";
    if (presetKey === "style_planting" && !stripTags(content).trim()) {
      content = stylePaintingName;
    }
    if (content && stripTags(content).trim()) {
      parts.push(content);
    }
  });

  return parts.join(", ");
}

function buildImagePromptForRow(
  row: ShotRow,
  targetColumn: ShotColumn,
  columnsById: Map<string, ShotColumn>,
  stylePaintingName: string
) {
  const imagePromptCell = row.shotValues?.find((item) => item.presetColumnKey === "image_prompt");
  if (imagePromptCell) {
    const content = getCellContentForPrompt(
      imagePromptCell,
      String(imagePromptCell.shotColumnId ?? ""),
      columnsById
    );
    if (content && stripTags(content).trim()) {
      return content;
    }
  }

  return buildPromptForRow(
    row,
    targetColumn,
    IMAGE_DEFAULT_PRESET_KEYS,
    columnsById,
    stylePaintingName
  );
}

function buildVideoPromptForRow(
  row: ShotRow,
  targetColumn: ShotColumn,
  columnsById: Map<string, ShotColumn>,
  stylePaintingName: string
) {
  return buildPromptForRow(
    row,
    targetColumn,
    VIDEO_DEFAULT_PRESET_KEYS,
    columnsById,
    stylePaintingName
  );
}

function getRowImageUrl(row: ShotRow) {
  const imageCell = row.shotValues?.find((item) => item.presetColumnKey === "image_path");
  const file = getPreferredFile(imageCell);
  return ossUrl(file?.url || file?.path);
}

function sleep(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }
    const finish = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", finish);
      resolve();
    };
    const timer = setTimeout(finish, ms);
    signal.addEventListener("abort", finish, { once: true });
  });
}

interface BatchRun {
  projectId: string;
  controller: AbortController;
}

const activeBatchRuns = new Map<string, BatchRun>();

interface ColumnHeaderProps {
  column: ShotColumn;
  icon?: ReactNode;
}
export function StoryboardColumnHeader(props: ColumnHeaderProps) {
  const projectId = useAppSelector((state) => state.project.currentProjectId);
  return (
    <StoryboardColumnHeaderSession
      key={JSON.stringify([projectId, props.column.id])}
      {...props}
      projectId={projectId}
    />
  );
}

function StoryboardColumnHeaderSession({
  column,
  icon,
  projectId,
}: ColumnHeaderProps & { projectId: string | null }) {
  const t = useTranslations("storyboard");
  const tc = useTranslations("common");
  const rows = useAppSelector((state) => selectCurrentInstance(state).rows);
  const columns = useAppSelector((state) => selectCurrentInstance(state).columns);
  const detail = useAppSelector((state) => selectCurrentInstance(state).detail);
  const batchGeneratingActive = useAppSelector(
    (state) => selectCurrentInstance(state).batchGeneratingActive
  );

  const columnsById = useMemo(
    () => new Map(columns.map((item) => [String(item.id ?? ""), item])),
    [columns]
  );
  const stylePaintingName = String(detail?.stylePaintingName ?? "");

  const [showAutoloadDialog, setShowAutoloadDialog] = useState(false);
  const [recoverOldData, setRecoverOldData] = useState(false);
  const [autoloadLoading, setAutoloadLoading] = useState(false);
  const [showVoiceAutoloadDialog, setShowVoiceAutoloadDialog] = useState(false);
  const [voiceRecoverOldData, setVoiceRecoverOldData] = useState(false);
  const [voiceAutoloadLoading, setVoiceAutoloadLoading] = useState(false);
  const [showBatchGenerateDialog, setShowBatchGenerateDialog] = useState(false);
  const [showBatchVoiceDialog, setShowBatchVoiceDialog] = useState(false);

  const batchRun = useRef<BatchRun | null>(null);
  const downloadRequest = useRef<AbortController | null>(null);
  const mounted = useRef(false);
  const associationRequests = useRef(new Map<string, AbortController>());
  const currentAssociation = (kind: string, controller: AbortController) =>
    associationRequests.current.get(kind) === controller &&
    !controller.signal.aborted &&
    store.getState().project.currentProjectId === projectId;
  const isCurrent = (run: BatchRun) =>
    batchRun.current === run &&
    activeBatchRuns.get(run.projectId) === run &&
    !run.controller.signal.aborted &&
    store.getState().project.currentProjectId === run.projectId;
  const beginRun = (): BatchRun | null => {
    if (
      !projectId ||
      store.getState().project.currentProjectId !== projectId ||
      selectCurrentInstance(store.getState()).batchGeneratingActive
    )
      return null;
    activeBatchRuns.get(projectId)?.controller.abort();
    const run = { projectId, controller: new AbortController() };
    activeBatchRuns.set(projectId, run);
    batchRun.current = run;
    return run;
  };

  const showBatchGenerate =
    column.presetColumnKey === "image_path" ||
    column.presetColumnKey === "video_path" ||
    column.presetColumnKey === "sound_path";
  const isImageColumn = column.presetColumnKey === "image_path";
  const isVideoColumn = column.presetColumnKey === "video_path";
  const isImagePromptColumn = column.presetColumnKey === "image_prompt";
  const isVideoPromptColumn = column.presetColumnKey === "video_prompt";
  const isDescriptionColumn = column.presetColumnKey === "description";
  const isDialogueColumn = column.presetColumnKey === "dialogue";

  useLayoutEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      downloadRequest.current?.abort();
      downloadRequest.current = null;
      associationRequests.current.forEach((request) => request.abort());
      associationRequests.current.clear();
      const run = batchRun.current;
      if (!run) return;
      batchRun.current = null;
      run.controller.abort();
      if (activeBatchRuns.get(run.projectId) === run) {
        activeBatchRuns.delete(run.projectId);
        store.dispatch(clearBatchGenerating(run.projectId));
      }
    };
  }, [projectId, column.id]);

  const handleAutoload = async () => {
    if (
      !column.id ||
      !projectId ||
      store.getState().project.currentProjectId !== projectId ||
      associationRequests.current.has("column")
    )
      return;
    const controller = new AbortController();
    associationRequests.current.set("column", controller);
    setAutoloadLoading(true);
    try {
      await backendApi.post("/api/ai/chat/autoload/column", {
        data: { columnId: String(column.id), recoverOldData },
        timeout: 300_000,
        signal: controller.signal,
      });
      if (!currentAssociation("column", controller)) return;
      toast.success(t("autoAssociateSuccess"));
      setShowAutoloadDialog(false);
      setRecoverOldData(false);
      store.dispatch(touchStoryboard());
    } catch (error) {
      if (!currentAssociation("column", controller)) return;
      console.error("[StoryboardColumnHeader] 自动关联失败:", error);
      toast.error(t("autoAssociateFailed"));
    } finally {
      if (currentAssociation("column", controller)) {
        associationRequests.current.delete("column");
        setAutoloadLoading(false);
      }
    }
  };

  const handleVoiceAutoload = async () => {
    if (
      !column.id ||
      !projectId ||
      store.getState().project.currentProjectId !== projectId ||
      associationRequests.current.has("voice")
    )
      return;
    const controller = new AbortController();
    associationRequests.current.set("voice", controller);
    setVoiceAutoloadLoading(true);
    try {
      await backendApi.post("/api/ai/chat/autoload/voice", {
        data: { columnId: String(column.id), recoverOldData: voiceRecoverOldData },
        timeout: 300_000,
        signal: controller.signal,
      });
      if (!currentAssociation("voice", controller)) return;
      toast.success(t("associateVoiceSuccess"));
      setShowVoiceAutoloadDialog(false);
      setVoiceRecoverOldData(false);
      store.dispatch(touchStoryboard());
    } catch (error) {
      if (!currentAssociation("voice", controller)) return;
      console.error("[StoryboardColumnHeader] 一键关联角色配音失败:", error);
      toast.error(t("associateVoiceFailed"));
    } finally {
      if (currentAssociation("voice", controller)) {
        associationRequests.current.delete("voice");
        setVoiceAutoloadLoading(false);
      }
    }
  };

  const handleBatchExport = async (type: "image" | "video") => {
    if (
      !mounted.current ||
      !projectId ||
      store.getState().project.currentProjectId !== projectId ||
      downloadRequest.current
    )
      return;
    const controller = new AbortController();
    downloadRequest.current = controller;
    const current = () =>
      mounted.current &&
      downloadRequest.current === controller &&
      !controller.signal.aborted &&
      store.getState().project.currentProjectId === projectId;
    try {
      const finalAssets = rows
        .map((row, rowIndex) => {
          const cell = row.shotValues?.find((item) => item.shotColumnId === String(column.id));
          const preferredFile = getPreferredFile(cell);
          const path = preferredFile?.url || preferredFile?.path;
          if (!path) return null;
          return {
            url: ossUrl(path),
            name: batchAssetName(path, rowIndex, type),
          };
        })
        .filter((item): item is { url: string; name: string } => Boolean(item?.url));

      if (!finalAssets.length) {
        toast.warning(type === "image" ? t("noFinalizedImages") : t("noFinalizedVideos"));
        return;
      }

      toast.info(
        type === "image"
          ? t("startExportImages", { count: finalAssets.length })
          : t("startExportVideos", { count: finalAssets.length })
      );

      const successful = await downloadBatch(finalAssets, controller.signal);
      if (!current()) return;
      if (!successful) {
        toast.error(type === "image" ? t("exportImagesFailed") : t("exportVideosFailed"));
        return;
      }

      toast.success(type === "image" ? t("finalizedImagesExported") : t("finalizedVideosExported"));
    } catch (error) {
      if (!current()) return;
      console.error("[StoryboardColumnHeader] 批量导出失败:", error);
      toast.error(type === "image" ? t("exportImagesFailed") : t("exportVideosFailed"));
    } finally {
      if (downloadRequest.current === controller) downloadRequest.current = null;
    }
  };

  const handleBatchGenerateConfirm = async (config: BatchGenerateConfig) => {
    if (!column.id) return;

    const queue: Array<ImageBatchItem | VideoBatchItem> = [];
    rows.forEach((row) => {
      const shotId = String(row.shotId ?? "");
      if (!shotId) return;

      if (isVideoColumn) {
        const startImageUrl = getRowImageUrl(row);
        if (!startImageUrl) return;

        const cell = row.shotValues?.find((item) => item.shotColumnId === String(column.id));
        const hasFinalized = asCellFiles(cell?.files).some((item) => item.preferred);
        if (hasFinalized && !config.regenerateFinalized) return;

        const prompt = buildVideoPromptForRow(row, column, columnsById, stylePaintingName);
        queue.push({
          shotId,
          columnId: String(column.id),
          prompt,
          startImageUrl,
        });
      } else {
        const cell = row.shotValues?.find((item) => item.shotColumnId === String(column.id));
        const hasFinalized = asCellFiles(cell?.files).some((item) => item.preferred);
        if (hasFinalized && !config.regenerateFinalized) return;

        const prompt = buildImagePromptForRow(row, column, columnsById, stylePaintingName);
        if (!prompt || !stripTags(prompt).trim()) return;

        queue.push({
          shotId,
          columnId: String(column.id),
          prompt,
        });
      }
    });

    if (!queue.length) {
      toast.warning(t("noShotsToGenerate"));
      return;
    }

    const run = beginRun();
    if (!run) return;
    store.dispatch(setBatchGeneratingActive(true));
    queue.forEach((item) =>
      store.dispatch(
        setBatchGenerating({ shotId: item.shotId, columnId: item.columnId, generating: true })
      )
    );
    toast.info(t("startBatchGenerate", { count: queue.length }));

    try {
      let interrupted = false;
      for (let index = 0; index < queue.length; index += 1) {
        const item = queue[index];
        if (!isCurrent(run)) return;
        if (!selectCurrentInstance(store.getState()).batchGeneratingActive) {
          interrupted = true;
          break;
        }

        try {
          if ("startImageUrl" in item) {
            await backendApi.post("/api/ai/task/video/generate/basic", {
              data: {
                shotId: item.shotId,
                shotColumnId: item.columnId,
                prompt: item.prompt,
                startImageUrl: item.startImageUrl,
                modelId: config.model,
                size: config.videoSize || undefined,
                videoLength: config.videoLength || undefined,
              },
              timeout: 360_000,
              signal: run.controller.signal,
            });
          } else {
            await backendApi.post("/api/ai/image/generate/basic", {
              data: {
                shotId: item.shotId,
                shotColumnId: item.columnId,
                prompt: item.prompt,
                model: config.model,
                size: config.size,
                watermark: false,
              },
              timeout: 360_000,
              signal: run.controller.signal,
            });
          }
          if (!isCurrent(run)) return;
          store.dispatch(setBatchCompleted({ shotId: item.shotId, columnId: item.columnId }));
        } catch (error) {
          if (!isCurrent(run)) return;
          console.error("[StoryboardColumnHeader] 批量生成失败:", item.shotId, error);
        } finally {
          if (isCurrent(run))
            store.dispatch(
              setBatchGenerating({
                shotId: item.shotId,
                columnId: item.columnId,
                generating: false,
              })
            );
        }

        if (
          index < queue.length - 1 &&
          selectCurrentInstance(store.getState()).batchGeneratingActive
        ) {
          await sleep(BATCH_INTERVAL, run.controller.signal);
        }
      }

      if (!isCurrent(run)) return;
      if (interrupted) {
        toast.warning(t("batchGenerateAborted"));
      } else {
        toast.success(t("batchGenerateComplete"));
      }
    } finally {
      if (isCurrent(run)) {
        batchRun.current = null;
        activeBatchRuns.delete(run.projectId);
        store.dispatch(clearBatchGenerating());
      }
    }
  };

  const handleBatchVoiceConfirm = async (config: BatchVoiceConfig) => {
    if (!column.id) return;

    const queue: VoiceBatchItem[] = [];
    rows.forEach((row) => {
      const shotId = String(row.shotId ?? "");
      if (!shotId) return;

      const dialogueCell = row.shotValues?.find((item) => item.presetColumnKey === "dialogue");
      const text = stripDialogueRoleLines(
        dialogueCell?.richText?.content ?? dialogueCell?.value ?? ""
      ).trim();
      if (!text) return;

      queue.push({
        shotId,
        columnId: String(column.id),
        text,
      });
    });

    if (!queue.length) {
      toast.warning(t("noDialogueShotsToGenerate"));
      return;
    }

    const run = beginRun();
    if (!run) return;
    store.dispatch(setBatchGeneratingActive(true));
    queue.forEach((item) =>
      store.dispatch(
        setBatchGenerating({ shotId: item.shotId, columnId: item.columnId, generating: true })
      )
    );
    toast.info(t("startBatchVoice", { count: queue.length }));

    try {
      let interrupted = false;
      for (let index = 0; index < queue.length; index += 1) {
        const item = queue[index];
        if (!isCurrent(run)) return;
        if (!selectCurrentInstance(store.getState()).batchGeneratingActive) {
          interrupted = true;
          break;
        }

        try {
          await backendApi.post("/api/ai/voice/synthesize", {
            data: {
              shotId: item.shotId,
              shotColumnId: item.columnId,
              model: config.model,
              text: item.text,
              voice_id: config.voiceId || undefined,
            },
            timeout: 360_000,
            signal: run.controller.signal,
          });
          if (!isCurrent(run)) return;
          store.dispatch(setBatchCompleted({ shotId: item.shotId, columnId: item.columnId }));
        } catch (error) {
          if (!isCurrent(run)) return;
          console.error("[StoryboardColumnHeader] 批量配音失败:", item.shotId, error);
        } finally {
          if (isCurrent(run))
            store.dispatch(
              setBatchGenerating({
                shotId: item.shotId,
                columnId: item.columnId,
                generating: false,
              })
            );
        }

        if (
          index < queue.length - 1 &&
          selectCurrentInstance(store.getState()).batchGeneratingActive
        ) {
          await sleep(BATCH_INTERVAL, run.controller.signal);
        }
      }

      if (!isCurrent(run)) return;
      if (interrupted) {
        toast.warning(t("batchVoiceAborted"));
      } else {
        toast.success(t("batchVoiceComplete"));
      }
    } finally {
      if (isCurrent(run)) {
        batchRun.current = null;
        activeBatchRuns.delete(run.projectId);
        store.dispatch(clearBatchGenerating());
      }
    }
  };

  const headerTitle = (
    <div className="flex items-center justify-center gap-1.5">
      {icon}
      <span>{column.columnName ?? column.presetColumnKey ?? ""}</span>
    </div>
  );

  return (
    <>
      <div className="flex items-center justify-center gap-1.5">
        {showBatchGenerate ? (
          <>
            {headerTitle}
            <Button
              size="xs"
              onClick={(event) => {
                event.stopPropagation();
                if (column.presetColumnKey === "sound_path") {
                  setShowBatchVoiceDialog(true);
                } else {
                  setShowBatchGenerateDialog(true);
                }
              }}
              disabled={batchGeneratingActive}
              className="bg-[#E52227] text-white hover:bg-[#FF3D42]"
            >
              {batchGeneratingActive ? <IconLoader2 className="size-3 animate-spin" /> : null}
              {t("batchGenerate")}
            </Button>

            {isImageColumn && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    color="muted"
                    size="icon-xs"
                    onClick={(event) => {
                      event.stopPropagation();
                      void handleBatchExport("image");
                    }}
                  >
                    <IconDownload className="size-3.5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>{t("batchExportFinalizedImages")}</TooltipContent>
              </Tooltip>
            )}
            {isVideoColumn && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    color="muted"
                    size="icon-xs"
                    onClick={(event) => {
                      event.stopPropagation();
                      void handleBatchExport("video");
                    }}
                  >
                    <IconDownload className="size-3.5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>{t("batchExportFinalizedVideos")}</TooltipContent>
              </Tooltip>
            )}
          </>
        ) : (
          <>
            {headerTitle}
            {(isImagePromptColumn || isVideoPromptColumn || isDescriptionColumn) && (
              <Button
                size="xs"
                onClick={(event) => {
                  event.stopPropagation();
                  setShowAutoloadDialog(true);
                }}
                disabled={autoloadLoading}
                className="bg-[#E52227] text-white hover:bg-[#FF3D42]"
              >
                {autoloadLoading ? <IconLoader2 className="size-3 animate-spin" /> : null}
                {t("autoAssociateTitle")}
              </Button>
            )}
            {isDialogueColumn ? (
              <Button
                size="xs"
                onClick={(event) => {
                  event.stopPropagation();
                  setShowVoiceAutoloadDialog(true);
                }}
                disabled={voiceAutoloadLoading}
                className="bg-[#E52227] text-white hover:bg-[#FF3D42]"
              >
                {voiceAutoloadLoading ? <IconLoader2 className="size-3 animate-spin" /> : null}
                {t("aiVoice")}
              </Button>
            ) : null}
          </>
        )}
      </div>

      <Dialog
        open={showAutoloadDialog}
        onOpenChange={(open) => (!autoloadLoading ? setShowAutoloadDialog(open) : undefined)}
      >
        <DialogContent
          showCloseButton={!autoloadLoading}
          className="rounded-xl border border-border bg-card sm:max-w-[420px]"
        >
          <DialogHeader>
            <DialogTitle>{t("autoAssociateTitle")}</DialogTitle>
            <DialogDescription className="text-xs text-[#8F8F92]">
              {t("autoAssociateDesc")}
            </DialogDescription>
          </DialogHeader>
          <div className="p-4">
            <Field
              orientation="horizontal"
              className="items-start rounded-lg border border-white/8 bg-white/[0.03] px-4 py-3"
            >
              <Checkbox
                checked={recoverOldData}
                onCheckedChange={(checked) => setRecoverOldData(Boolean(checked))}
                disabled={autoloadLoading}
              />
              <div className="space-y-1">
                <FieldLabel className="text-sm font-medium">{t("overwriteExisting")}</FieldLabel>
                <FieldDescription className="text-xs text-[#8F8F92]">
                  {t("overwriteExistingDesc")}
                </FieldDescription>
              </div>
            </Field>
          </div>
          <DialogFooter className="border-white/10 bg-transparent">
            <Button
              variant="outline"
              color="muted"
              onClick={() => setShowAutoloadDialog(false)}
              disabled={autoloadLoading}
            >
              {tc("cancel")}
            </Button>
            <Button
              onClick={() => void handleAutoload()}
              disabled={autoloadLoading}
              className="bg-[#E52227] text-white hover:bg-[#FF3D42]"
            >
              {autoloadLoading ? <IconLoader2 className="size-4 animate-spin" /> : null}
              {tc("confirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={showVoiceAutoloadDialog}
        onOpenChange={(open) =>
          !voiceAutoloadLoading ? setShowVoiceAutoloadDialog(open) : undefined
        }
      >
        <DialogContent
          showCloseButton={!voiceAutoloadLoading}
          className="rounded-xl border border-border bg-card sm:max-w-[420px]"
        >
          <DialogHeader>
            <DialogTitle>{t("voiceAutoAssociateTitle")}</DialogTitle>
            <DialogDescription className="text-xs text-[#8F8F92]">
              {t("voiceAutoAssociateDesc")}
            </DialogDescription>
          </DialogHeader>
          <Field
            orientation="horizontal"
            className="items-start rounded-lg border border-white/8 bg-white/[0.03] px-4 py-3"
          >
            <Checkbox
              checked={voiceRecoverOldData}
              onCheckedChange={(checked) => setVoiceRecoverOldData(Boolean(checked))}
              disabled={voiceAutoloadLoading}
            />
            <div className="space-y-1">
              <FieldLabel className="text-sm font-medium">{t("overwriteExisting")}</FieldLabel>
              <FieldDescription className="text-xs text-[#8F8F92]">
                {t("voiceOverwriteDesc")}
              </FieldDescription>
            </div>
          </Field>
          <DialogFooter className="border-white/10 bg-transparent">
            <Button
              variant="outline"
              color="muted"
              onClick={() => setShowVoiceAutoloadDialog(false)}
              disabled={voiceAutoloadLoading}
            >
              {tc("cancel")}
            </Button>
            <Button
              onClick={() => void handleVoiceAutoload()}
              disabled={voiceAutoloadLoading}
              className="bg-[#E52227] text-white hover:bg-[#FF3D42]"
            >
              {voiceAutoloadLoading ? <IconLoader2 className="size-4 animate-spin" /> : null}
              {tc("confirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {showBatchGenerateDialog ? (
        <StoryboardBatchGenerateDialog
          open={showBatchGenerateDialog}
          onOpenChange={setShowBatchGenerateDialog}
          columnType={isVideoColumn ? "video" : "image"}
          projectSize={String(detail?.aspectRatioType ?? "")}
          loading={batchGeneratingActive}
          onConfirm={(config) => void handleBatchGenerateConfirm(config)}
        />
      ) : null}

      {showBatchVoiceDialog ? (
        <StoryboardBatchVoiceDialog
          open={showBatchVoiceDialog}
          onOpenChange={setShowBatchVoiceDialog}
          loading={batchGeneratingActive}
          onConfirm={(config) => void handleBatchVoiceConfirm(config)}
        />
      ) : null}
    </>
  );
}
