"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import {
  IconCheck,
  IconCircleCheck,
  IconClock,
  IconDownload,
  IconExternalLink,
  IconLoader2,
  IconMapPin,
  IconMask,
  IconMessageCircle,
  IconMusic,
  IconPhoto,
  IconPlayerPause,
  IconPlayerPlay,
  IconPlus,
  IconRowInsertBottom,
  IconRowInsertTop,
  IconSparkles,
  IconTrash,
  IconUser,
  IconVideo,
  IconX,
} from "@tabler/icons-react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Textarea } from "@/components/ui/textarea";
import { MediaPreviewModal } from "@/components/media/media-preview-modal";
import { AssetPickerDialog } from "@/components/assets/asset-picker-dialog";
import { RichMentionEditor } from "@/components/storyboard/editor/rich-mention-editor";
import type { MentionItem, MentionType } from "@/components/storyboard/editor/mention-node";
import { WorldAssetSelectDialog } from "@/components/storyboard/dialogs/world-asset-select-dialog";
import { dispatchFocusAssetPanel } from "@/components/project/panels/asset-panel-events";
import {
  AiAudioGeneratorDialog,
  AiBasicAudioGeneratorDialog,
  AiImageGeneratorDialog,
  AiLipSyncGeneratorDialog,
  AiVideoGeneratorDialog,
} from "@/components/storyboard/ai-generator";
import { AudioWaveformBars } from "@/components/storyboard/ai-generator/audio-waveform-bars";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { buildOssImageUrl, uploadWorkspaceFile } from "@/src/lib/uploads/workspace-upload";
import { backendApi, type Paginated } from "@/src/lib/api";
import type { Comment, FileDetail } from "@/src/types/workspace";
import { getDialogueTextFromShotValues } from "@/src/lib/storyboard-dialogue";
import { useAppSelector, useAppDispatch } from "@/src/store";
import { store } from "@/src/store";
import {
  clearSingleBatchCompleted,
  setRows,
  touchStoryboard,
  setActivePanel,
  selectCurrentInstance,
  type Asset,
  type ShotColumn,
  type ShotRow,
  type ShotValue,
} from "@/src/store/slices/projectSlice";
import { type ResultItem } from "@/src/store/slices/projectSlice";

const OSS_BASE = process.env.NEXT_PUBLIC_OSS_BASE_URL ?? "";

function ossUrl(path?: string) {
  if (!path) return "";
  if (path.startsWith("http://") || path.startsWith("https://") || path.startsWith("blob:")) {
    return path;
  }
  return `${OSS_BASE}/${path}`;
}

function getMentionImageUrl(asset: Asset, mentionType: MentionType) {
  if (mentionType === "character") return asset.roleImgPath?.[0] ?? "";
  if (mentionType === "scene") return asset.sceneImgPath?.[0] ?? "";
  return asset.propImgPath?.[0] ?? "";
}

function parseOtherImgPath(value: Asset["otherImgPath"]) {
  if (!value) return {};
  if (typeof value === "string") {
    try {
      return JSON.parse(value) as Record<string, string>;
    } catch {
      return {};
    }
  }
  if (typeof value === "object") return value;
  return {};
}

function getAssetStringField(asset: Asset, field: string) {
  const value = asset[field];
  return typeof value === "string" && value.trim() ? value : undefined;
}

export function buildMentionItems(
  characters: Asset[],
  scenes: Asset[],
  props: Asset[]
): MentionItem[] {
  const items: MentionItem[] = [];

  for (const item of characters) {
    if (item.id && item.name) {
      items.push({
        id: String(item.id),
        label: String(item.name),
        mentionType: "character",
        imgUrl: ossUrl(getMentionImageUrl(item, "character")),
        voiceId: getAssetStringField(item, "voiceId"),
        model: getAssetStringField(item, "model"),
      });
    }

    const variants = parseOtherImgPath(item.otherImgPath);
    for (const [variantName, path] of Object.entries(variants)) {
      if (item.id && variantName) {
        items.push({
          id: String(item.id),
          label: variantName,
          mentionType: "character",
          imgUrl: ossUrl(path),
          voiceId: getAssetStringField(item, "voiceId"),
          model: getAssetStringField(item, "model"),
        });
      }
    }
  }

  for (const item of scenes) {
    if (item.id && item.name) {
      items.push({
        id: String(item.id),
        label: String(item.name),
        mentionType: "scene",
        imgUrl: ossUrl(getMentionImageUrl(item, "scene")),
      });
    }
  }

  for (const item of props) {
    if (item.id && item.name) {
      items.push({
        id: String(item.id),
        label: String(item.name),
        mentionType: "prop",
        imgUrl: ossUrl(getMentionImageUrl(item, "prop")),
      });
    }
  }

  return items;
}

function escapeHtml(text: string) {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function renderMentionPreviewHtml(text: string) {
  if (!text) return "";

  const normalizedText = normalizeRichTextValue(text);
  const mentionPattern = /<mention\s+([^>]*)>([\s\S]*?)<\/mention>/g;
  const placeholders: Array<{ key: string; html: string }> = [];
  let index = 0;

  const protectedText = normalizedText.replace(mentionPattern, (_match, attrStr, name) => {
    const key = `__MENTION_PLACEHOLDER_${index}__`;
    const typeMatch = String(attrStr).match(/type="([^"]*)"/);
    const type = (typeMatch?.[1] || "character") as MentionType;
    const styles =
      type === "scene"
        ? "bg-green-500/10 text-green-600 dark:text-green-400"
        : type === "prop"
          ? "bg-orange-500/10 text-orange-600 dark:text-orange-400"
          : "bg-primary/10 text-primary";
    placeholders.push({
      key,
      html: `<span class="inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium ${styles}">@${escapeHtml(String(name))}</span>`,
    });
    index += 1;
    return key;
  });

  let html = escapeHtml(protectedText).replaceAll("\n", "<br />");
  for (const placeholder of placeholders) {
    html = html.replace(placeholder.key, placeholder.html);
  }
  return html;
}

function getPreferredFilePath(cell?: ShotValue) {
  const files = (cell?.files as Array<{ path?: string; preferred?: boolean }> | undefined) ?? [];
  const preferred = files.find((file) => file.preferred)?.path;
  return preferred ?? files[0]?.path ?? cell?.value ?? "";
}

function getPreferredFileSource(cell?: ShotValue) {
  const files =
    (cell?.files as Array<{ path?: string; url?: string; preferred?: boolean }> | undefined) ?? [];
  const preferred = files.find((file) => file.preferred) ?? files[0];
  return preferred?.url || preferred?.path || cell?.value || "";
}

function getVideoThumbnail(path?: string) {
  const fullUrl = ossUrl(path);
  if (!fullUrl || fullUrl.startsWith("blob:")) return fullUrl;
  const separator = fullUrl.includes("?") ? "&" : "?";
  return `${fullUrl}${separator}x-oss-process=video/snapshot,t_0,m_fast`;
}

function getCellDisplayValue(cell?: ShotValue) {
  return cell?.richText?.content ?? cell?.value ?? "";
}

function sanitizeMentionTags(text: string) {
  return text.replace(/<mention\s+([^>]*)>([\s\S]*?)<\/mention>/gi, (_match, attrStr, label) => {
    const getAttr = (name: string) => {
      const matched = String(attrStr).match(new RegExp(`${name}="([^"]*)"`, "i"));
      return matched?.[1] ?? "";
    };

    const attrs = [
      ["id", getAttr("id")],
      ["type", getAttr("type") || "character"],
      ["imgUrl", getAttr("imgUrl")],
      ["voiceId", getAttr("voiceId")],
      ["model", getAttr("model")],
    ]
      .filter(([, value]) => value)
      .map(([name, value]) => ` ${name}="${value}"`)
      .join("");

    const cleanLabel = String(label)
      .replace(/^[🧑📍🔧]\s*/u, "")
      .trim();
    return `<mention${attrs}>${cleanLabel}</mention>`;
  });
}

function normalizeRichTextValue(value: string) {
  if (!value) return "";

  let nextValue = sanitizeMentionTags(value.trim());
  nextValue = nextValue
    .replace(/<p>\s*<\/p>/gi, "\n")
    .replace(/<p>\s*<br\s*\/?>\s*<\/p>/gi, "\n")
    .replace(/<\/p>\s*<p>/gi, "\n")
    .replace(/<p>/gi, "")
    .replace(/<\/p>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/&nbsp;/gi, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return nextValue;
}

function normalizePromptText(text: unknown) {
  if (!text) return "";
  if (typeof text === "object" && text && "value" in text) {
    const nested = (text as { value?: unknown }).value;
    return typeof nested === "string" ? nested : "";
  }
  return typeof text === "string" ? text : "";
}

function stripNonMentionTags(text: unknown) {
  const value = normalizePromptText(text);
  if (!value) return "";
  return value.replace(/<(?!\/?mention[\s>])[^>]+>/g, "").trim();
}

function stripAllTags(text: unknown) {
  const value = normalizePromptText(text);
  if (!value) return "";
  return value.replace(/<[^>]+>/g, "").trim();
}

function getProjectStylePaintingLabel(detail: Record<string, unknown> | null | undefined) {
  if (!detail) return "";

  const candidateKeys = [
    "stylePaintingName",
    "stylePaintingLabel",
    "stylePaintingInfo",
    "stylePaintingText",
  ] as const;

  for (const key of candidateKeys) {
    const value = detail[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }

  const fallback = detail.stylePainting;
  if (typeof fallback === "string" && fallback.trim() && /\D/.test(fallback)) {
    return fallback.trim();
  }

  return "";
}

function getShotPromptContent(
  cell: ShotValue | undefined,
  columns: ShotColumn[],
  columnId?: string
) {
  if (!cell) return "";

  const column = columns.find(
    (item) => String(item.id ?? "") === String(columnId ?? cell.shotColumnId ?? "")
  );
  const columnType = column?.columnType?.toUpperCase() ?? "";
  const presetKey = column?.presetColumnKey ?? cell.presetColumnKey ?? "";

  if (presetKey === "duration") {
    return cell.value ? `${cell.value}s` : "";
  }

  if (presetKey === "scene" || columnType === "SCENE") {
    const scene = (cell.scenes as Asset[] | undefined)?.[0];
    if (!scene) return "";
    const mediaUrl = ossUrl(scene.sceneImgPath?.[0] ?? "");
    return `<mention id="${scene.id ?? ""}" type="scene" imgUrl="${mediaUrl}">${scene.name ?? ""}</mention>`;
  }

  if (presetKey === "character" || columnType === "CHARACTER") {
    const characters = (cell.characters as Asset[] | undefined) ?? [];
    if (characters.length === 0) return "";
    return characters
      .map((character) => {
        const mediaUrl = ossUrl(character.roleImgPath?.[0] ?? "");
        return `<mention id="${character.id ?? ""}" type="character" imgUrl="${mediaUrl}">${character.name ?? ""}</mention>`;
      })
      .join(" ");
  }

  if (presetKey === "image_path" || columnType === "IMAGE") {
    const files =
      (cell.files as
        | Array<{ id?: string; path?: string; url?: string; name?: string; preferred?: boolean }>
        | undefined) ?? [];
    const file = files.find((item) => item.preferred) ?? files[0];
    if (!file) return "";
    const mediaUrl = file.url || ossUrl(file.path);
    const name = file.name || file.path?.split("/").pop() || "image";
    return `<mention id="${file.id ?? ""}" type="image" imgUrl="${mediaUrl}">${name}</mention>`;
  }

  if (presetKey === "video_path" || columnType === "VIDEO") {
    const files =
      (cell.files as
        | Array<{ id?: string; path?: string; url?: string; name?: string; preferred?: boolean }>
        | undefined) ?? [];
    const file = files.find((item) => item.preferred) ?? files[0];
    if (!file) return "";
    const mediaUrl = file.url || ossUrl(file.path);
    const name = file.name || file.path?.split("/").pop() || "video";
    return `<mention id="${file.id ?? ""}" type="video" videoUrl="${mediaUrl}">${name}</mention>`;
  }

  if (
    presetKey === "image_prompt" ||
    presetKey === "description" ||
    columnType === "RICH_TEXT" ||
    columnType === "RICHTEXT" ||
    columnType === "RICH_TEXT"
  ) {
    return stripNonMentionTags(cell.richText?.content || cell.value || "");
  }

  return stripAllTags(cell.richText?.content || cell.value || "");
}

function buildImagePromptContext(
  row: ShotRow,
  column: ShotColumn,
  columns: ShotColumn[],
  detail?: Record<string, unknown> | null
) {
  const shotValues = row.shotValues ?? [];
  const imagePromptCell = shotValues.find((item) => item.presetColumnKey === "image_prompt");

  if (imagePromptCell) {
    const content = getShotPromptContent(imagePromptCell, columns, imagePromptCell.shotColumnId);
    if (content && stripAllTags(content)) {
      return {
        prompt: content,
        referenceFields: [] as string[],
        imagePromptColumnId: String(imagePromptCell.shotColumnId ?? ""),
      };
    }
  }

  const referenceIds = Array.isArray(column.aiRef) ? column.aiRef.map((item) => String(item)) : [];
  if (referenceIds.length > 0) {
    const promptParts: string[] = [];
    const referenceFields: string[] = [];

    for (const columnId of referenceIds) {
      const cell = shotValues.find((item) => String(item.shotColumnId ?? "") === columnId);
      if (!cell) continue;
      const content = getShotPromptContent(cell, columns, columnId);
      if (!content || !stripAllTags(content)) continue;
      promptParts.push(content);
      const matchedColumn = columns.find((item) => String(item.id ?? "") === columnId);
      if (matchedColumn?.columnName) {
        referenceFields.push(String(matchedColumn.columnName));
      }
    }

    return {
      prompt: promptParts.join(", "),
      referenceFields,
      imagePromptColumnId: imagePromptCell?.shotColumnId
        ? String(imagePromptCell.shotColumnId)
        : "",
    };
  }

  const defaultPresetKeys = ["description", "shot_size", "perspective", "style_planting"];
  const promptParts: string[] = [];
  const referenceFields: string[] = [];
  const projectStyleLabel = getProjectStylePaintingLabel(detail);

  for (const presetKey of defaultPresetKeys) {
    const matchedCell = shotValues.find((item) => item.presetColumnKey === presetKey);
    let content = matchedCell
      ? getShotPromptContent(matchedCell, columns, matchedCell.shotColumnId)
      : "";

    if (presetKey === "style_planting" && !stripAllTags(content) && projectStyleLabel) {
      content = projectStyleLabel;
    }

    if (!content || !stripAllTags(content)) continue;
    promptParts.push(content);

    if (matchedCell) {
      const matchedColumn = columns.find(
        (item) => String(item.id ?? "") === String(matchedCell.shotColumnId ?? "")
      );
      if (matchedColumn?.columnName) {
        referenceFields.push(String(matchedColumn.columnName));
      }
    } else if (presetKey === "style_planting") {
      const fallbackColumn = columns.find((item) => item.presetColumnKey === presetKey);
      if (fallbackColumn?.columnName) {
        referenceFields.push(String(fallbackColumn.columnName));
      }
    }
  }

  return {
    prompt: promptParts.join(", "),
    referenceFields,
    imagePromptColumnId: imagePromptCell?.shotColumnId ? String(imagePromptCell.shotColumnId) : "",
  };
}

function buildVideoPromptContext(
  row: ShotRow,
  column: ShotColumn,
  columns: ShotColumn[],
  detail?: Record<string, unknown> | null
) {
  const shotValues = row.shotValues ?? [];
  const videoPromptCell = shotValues.find((item) => item.presetColumnKey === "video_prompt");

  if (videoPromptCell) {
    const content = getShotPromptContent(videoPromptCell, columns, videoPromptCell.shotColumnId);
    if (content && stripAllTags(content)) {
      return {
        prompt: content,
        referenceFields: [] as string[],
        videoPromptColumnId: String(videoPromptCell.shotColumnId ?? ""),
      };
    }
  }

  const referenceIds = Array.isArray(column.aiRef) ? column.aiRef.map((item) => String(item)) : [];
  if (referenceIds.length > 0) {
    const promptParts: string[] = [];
    const referenceFields: string[] = [];

    for (const columnId of referenceIds) {
      const cell = shotValues.find((item) => String(item.shotColumnId ?? "") === columnId);
      if (!cell) continue;
      const content = getShotPromptContent(cell, columns, columnId);
      if (!content || !stripAllTags(content)) continue;
      promptParts.push(content);
      const matchedColumn = columns.find((item) => String(item.id ?? "") === columnId);
      if (matchedColumn?.columnName) {
        referenceFields.push(String(matchedColumn.columnName));
      }
    }

    return {
      prompt: promptParts.join(", "),
      referenceFields,
      videoPromptColumnId: videoPromptCell?.shotColumnId
        ? String(videoPromptCell.shotColumnId)
        : "",
    };
  }

  const defaultPresetKeys = ["video_prompt", "movement", "style_planting"];
  const promptParts: string[] = [];
  const referenceFields: string[] = [];
  const projectStyleLabel = getProjectStylePaintingLabel(detail);

  for (const presetKey of defaultPresetKeys) {
    const matchedCell = shotValues.find((item) => item.presetColumnKey === presetKey);
    let content = matchedCell
      ? getShotPromptContent(matchedCell, columns, matchedCell.shotColumnId)
      : "";

    if (presetKey === "style_planting" && !stripAllTags(content) && projectStyleLabel) {
      content = projectStyleLabel;
    }

    if (!content || !stripAllTags(content)) continue;
    promptParts.push(content);

    if (matchedCell) {
      const matchedColumn = columns.find(
        (item) => String(item.id ?? "") === String(matchedCell.shotColumnId ?? "")
      );
      if (matchedColumn?.columnName) {
        referenceFields.push(String(matchedColumn.columnName));
      }
    } else if (presetKey === "style_planting") {
      const fallbackColumn = columns.find((item) => item.presetColumnKey === presetKey);
      if (fallbackColumn?.columnName) {
        referenceFields.push(String(fallbackColumn.columnName));
      }
    }
  }

  return {
    prompt: promptParts.join(", "),
    referenceFields,
    videoPromptColumnId: videoPromptCell?.shotColumnId ? String(videoPromptCell.shotColumnId) : "",
  };
}

function parseColumnOptions(column: ShotColumn) {
  const rawOptions = Array.isArray(column.columnOptions) ? column.columnOptions : [];
  return rawOptions
    .map((item) => {
      if (typeof item === "string") return item;
      if (typeof item === "object" && item && "name" in item) {
        return String((item as { name?: string }).name ?? "");
      }
      return String(item ?? "");
    })
    .filter(Boolean);
}

function upsertShotCell(
  rows: ShotRow[],
  shotId: string,
  shotColumnId: string,
  nextCell: Partial<ShotValue>
) {
  return rows.map((row) => {
    if (row.shotId !== shotId) return row;

    const values = [...(row.shotValues ?? [])];
    const index = values.findIndex((value) => value.shotColumnId === shotColumnId);
    if (index >= 0) {
      values[index] = { ...values[index], ...nextCell };
    } else {
      values.push({
        shotColumnId,
        ...nextCell,
      });
    }

    return { ...row, shotValues: values };
  });
}

function resolveShotValueId(result: unknown) {
  if (typeof result === "string" || typeof result === "number") {
    return String(result);
  }

  if (result && typeof result === "object") {
    if ("id" in result && (typeof result.id === "string" || typeof result.id === "number")) {
      return String(result.id);
    }

    if ("data" in result) {
      const data = result.data;
      if (typeof data === "string" || typeof data === "number") {
        return String(data);
      }
      if (data && typeof data === "object" && "id" in data) {
        const id = (data as { id?: string | number }).id;
        if (typeof id === "string" || typeof id === "number") {
          return String(id);
        }
      }
    }
  }

  return "";
}

async function persistTextCell(
  shotId: string,
  shotColumnId: string,
  value: string,
  options?: { richText?: boolean }
) {
  const currentRows = selectCurrentInstance(store.getState()).rows;
  store.dispatch(
    setRows(
      upsertShotCell(currentRows, shotId, shotColumnId, {
        value,
        richText: options?.richText ? { content: value } : undefined,
      })
    )
  );

  try {
    const result = await backendApi.post("/api/user/shotValue/input", {
      data: { shotId, shotColumnId, value },
    });
    const nextId = resolveShotValueId(result);

    if (nextId) {
      const rows = selectCurrentInstance(store.getState()).rows;
      store.dispatch(
        setRows(
          upsertShotCell(rows, shotId, shotColumnId, {
            id: nextId,
            value,
            richText: options?.richText ? { content: value } : undefined,
          })
        )
      );
    }
  } catch (error) {
    console.error("[StoryboardCells] 保存单元格失败:", error);
    toast.error("保存失败");
    store.dispatch(touchStoryboard());
  }
}

async function persistValueList(
  shotId: string,
  shotColumnId: string,
  values: string[],
  patch: Partial<ShotValue>
) {
  const currentRows = selectCurrentInstance(store.getState()).rows;
  store.dispatch(setRows(upsertShotCell(currentRows, shotId, shotColumnId, { ...patch, values })));

  try {
    const result = await backendApi.post("/api/user/shotValue/input", {
      data: { shotId, shotColumnId, value: "", values },
    });
    const nextId = resolveShotValueId(result);

    if (nextId) {
      const rows = selectCurrentInstance(store.getState()).rows;
      store.dispatch(
        setRows(upsertShotCell(rows, shotId, shotColumnId, { ...patch, id: nextId, values }))
      );
    }
  } catch (error) {
    console.error("[StoryboardCells] 保存素材失败:", error);
    toast.error("保存失败");
    store.dispatch(touchStoryboard());
  }
}

export function ShotNoCell({ row, rowIndex }: { row: ShotRow; rowIndex: number }) {
  const t = useTranslations("storyboard");
  const tc = useTranslations("common");
  const projectId = useAppSelector((s) => s.project.currentProjectId);
  const storyBoardId = useAppSelector((s) => selectCurrentInstance(s).activeEpisodeId);
  const rows = useAppSelector((s) => selectCurrentInstance(s).rows);
  const [hovered, setHovered] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [inserting, setInserting] = useState<"before" | "after" | null>(null);

  const shotId = String(row.shotId ?? "");
  const suffix = shotId ? shotId.slice(-6) : "new";

  const handleInsert = async (position: "before" | "after") => {
    if (!projectId || !storyBoardId || inserting) return;
    setInserting(position);
    try {
      let beforeTheShotId: string | undefined;
      if (position === "before") {
        beforeTheShotId = shotId || undefined;
      } else {
        beforeTheShotId = rows[rowIndex + 1]?.shotId
          ? String(rows[rowIndex + 1].shotId)
          : undefined;
      }
      const result = await backendApi.post<string | number>("/api/user/shot/create", {
        data: { projectId, storyBoardId, beforeTheShotId, enable: true },
      });
      const newShotId = String(result ?? "");
      if (newShotId) {
        const newRow: ShotRow = { shotId: newShotId, shotValues: [] };
        const insertIndex = position === "before" ? rowIndex : rowIndex + 1;
        const nextRows = [...selectCurrentInstance(store.getState()).rows];
        nextRows.splice(insertIndex, 0, newRow);
        store.dispatch(setRows(nextRows));
      }
      toast.success(t("insertedEmptyShot"));
    } catch (error) {
      console.error("[ShotNoCell] create shot failed:", error);
      toast.error(t("createShotFailed"));
    } finally {
      setInserting(null);
    }
  };

  const handleDelete = async () => {
    if (!shotId) return;
    const prevRows = selectCurrentInstance(store.getState()).rows;
    store.dispatch(setRows(prevRows.filter((r) => String(r.shotId) !== shotId)));
    try {
      await backendApi.post(`/api/user/shot/delete/${shotId}`);
    } catch (error) {
      console.error("[ShotNoCell] delete shot failed:", error);
      toast.error(t("deleteShotFailed"));
      store.dispatch(setRows(prevRows));
    }
  };

  return (
    <>
      <div
        className="relative flex h-full w-full items-center justify-center"
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
      >
        {hovered ? (
          <TooltipProvider delayDuration={200}>
            <div className="flex flex-col items-center gap-1 rounded-lg bg-background/90 p-2 shadow-lg">
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    color="muted"
                    size="icon-xs"
                    disabled={!!inserting}
                    onClick={() => void handleInsert("before")}
                  >
                    {inserting === "before" ? (
                      <IconLoader2 className="size-3.5 animate-spin" />
                    ) : (
                      <IconRowInsertTop className="size-3.5" />
                    )}
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="right">{t("insertAbove")}</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    color="muted"
                    size="icon-xs"
                    disabled={!!inserting}
                    onClick={() => setDeleteOpen(true)}
                  >
                    <IconTrash className="size-3.5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="right">{tc("delete")}</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    color="muted"
                    size="icon-xs"
                    disabled={!!inserting}
                    onClick={() => void handleInsert("after")}
                  >
                    {inserting === "after" ? (
                      <IconLoader2 className="size-3.5 animate-spin" />
                    ) : (
                      <IconRowInsertBottom className="size-3.5" />
                    )}
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="right">{t("insertBelow")}</TooltipContent>
              </Tooltip>
            </div>
          </TooltipProvider>
        ) : (
          <div className="flex flex-col items-center gap-1">
            <span className="text-sm font-semibold text-muted-foreground">#{rowIndex + 1}</span>
            <span className="font-mono text-[10px] text-muted-foreground/70">{suffix}</span>
          </div>
        )}
      </div>

      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{tc("confirm")}</AlertDialogTitle>
            <AlertDialogDescription>{t("confirmDeleteShot")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{tc("cancel")}</AlertDialogCancel>
            <AlertDialogAction
              variant="solid"
              color="destructive"
              onClick={() => void handleDelete()}
            >
              {tc("delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

export function DurationCell({
  cell,
  shotId,
  shotColumnId,
}: {
  cell?: ShotValue;
  shotId: string;
  shotColumnId: string;
}) {
  const [editing, setEditing] = useState(false);
  const display = getCellDisplayValue(cell);
  const [draft, setDraft] = useState(display);

  return editing ? (
    <div className="flex h-full items-center justify-center px-3">
      <Input
        autoFocus
        type="number"
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => {
          setEditing(false);
          if (draft !== display) {
            void persistTextCell(shotId, shotColumnId, draft);
          }
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            setDraft(display);
            setEditing(false);
          }
          if (event.key === "Enter") {
            setEditing(false);
            if (draft !== display) {
              void persistTextCell(shotId, shotColumnId, draft);
            }
          }
        }}
        className="h-8 text-center"
      />
    </div>
  ) : (
    <button
      type="button"
      onClick={() => {
        setDraft(display);
        setEditing(true);
      }}
      className="flex h-full w-full items-center justify-center gap-1 px-3 text-xs text-foreground hover:bg-muted/30"
    >
      <IconClock className="size-3.5 text-muted-foreground" />
      {display ? `${display} s` : <span className="text-muted-foreground">填写时长</span>}
    </button>
  );
}

export function RichTextCell({
  cell,
  shotId,
  shotColumnId,
  mentionItems,
  allowedMentionTypes,
  placeholder,
  showAvatar = true,
  extraFields,
}: {
  cell?: ShotValue;
  shotId: string;
  shotColumnId: string;
  mentionItems: MentionItem[];
  allowedMentionTypes?: MentionType[];
  placeholder: string;
  showAvatar?: boolean;
  extraFields?: Array<"voiceId" | "model">;
}) {
  const [editing, setEditing] = useState(false);
  const value = getCellDisplayValue(cell);

  return (
    <div className="h-full w-full px-3 py-2">
      {editing ? (
        <RichMentionEditor
          value={value}
          editing
          onChange={(nextValue) =>
            void persistTextCell(shotId, shotColumnId, normalizeRichTextValue(nextValue), {
              richText: true,
            })
          }
          onStartEdit={() => setEditing(true)}
          onStopEdit={() => setEditing(false)}
          placeholder={placeholder}
          mentionItems={mentionItems}
          mentionTypes={allowedMentionTypes}
          showAvatar={showAvatar}
          extraFields={extraFields}
        />
      ) : (
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="block h-full w-full cursor-text overflow-hidden rounded-lg text-left hover:bg-muted/20"
        >
          {value ? (
            <div
              className="line-clamp-5 text-xs leading-relaxed"
              dangerouslySetInnerHTML={{ __html: renderMentionPreviewHtml(value) }}
            />
          ) : (
            <span className="text-xs text-muted-foreground">{placeholder}</span>
          )}
        </button>
      )}
    </div>
  );
}

export function SelectCell({
  column,
  cell,
  shotId,
  shotColumnId,
}: {
  column: ShotColumn;
  cell?: ShotValue;
  shotId: string;
  shotColumnId: string;
}) {
  const options = parseColumnOptions(column);
  const display = getCellDisplayValue(cell);
  const [open, setOpen] = useState(false);
  const [inputValue, setInputValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const filteredOptions = useMemo(() => {
    const query = inputValue.trim().toLowerCase();
    if (!query) return options;
    return options.filter((opt) => opt.toLowerCase().includes(query));
  }, [options, inputValue]);

  const handleSelect = (value: string) => {
    if (value !== display) {
      void persistTextCell(shotId, shotColumnId, value);
    }
    setOpen(false);
    setInputValue("");
  };

  const handleClear = () => {
    if (display) {
      void persistTextCell(shotId, shotColumnId, "");
    }
    setOpen(false);
    setInputValue("");
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && inputValue.trim()) {
      e.preventDefault();
      handleSelect(inputValue.trim());
    }
    if (e.key === "Escape") {
      setOpen(false);
      setInputValue("");
    }
  };

  return (
    <div className="flex h-full w-full items-center px-2">
      <Popover
        open={open}
        onOpenChange={(v) => {
          setOpen(v);
          if (!v) setInputValue("");
        }}
      >
        <PopoverTrigger asChild>
          <button
            type="button"
            className="flex h-7 w-full items-center rounded-md px-2 text-xs hover:bg-muted/30"
          >
            <span className={display ? "text-foreground" : "text-muted-foreground"}>
              {display || "选择"}
            </span>
          </button>
        </PopoverTrigger>
        <PopoverContent
          align="start"
          side="bottom"
          className="w-48 p-0"
          onOpenAutoFocus={() => setTimeout(() => inputRef.current?.focus(), 0)}
        >
          <div className="p-1.5">
            <input
              ref={inputRef}
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="搜索或输入..."
              className="w-full rounded-md border border-border bg-transparent px-2 py-1.5 text-xs outline-none placeholder:text-muted-foreground focus:border-primary/40 focus:ring-1 focus:ring-primary/20"
            />
          </div>
          <div className="max-h-40 overflow-auto p-1">
            {filteredOptions.map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => handleSelect(option)}
                className={cn(
                  "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs transition-colors hover:bg-accent",
                  option === display && "text-primary"
                )}
              >
                {option === display && <IconCheck className="size-3" />}
                <span className={option === display ? "" : "pl-5"}>{option}</span>
              </button>
            ))}
            {inputValue.trim() && !options.includes(inputValue.trim()) && (
              <button
                type="button"
                onClick={() => handleSelect(inputValue.trim())}
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs text-primary transition-colors hover:bg-accent"
              >
                <IconPlus className="size-3" />
                <span>{inputValue.trim()}</span>
              </button>
            )}
            {filteredOptions.length === 0 && !inputValue.trim() && (
              <div className="px-2 py-3 text-center text-xs text-muted-foreground">无选项</div>
            )}
          </div>
          {display && (
            <div className="border-t border-border p-1">
              <button
                type="button"
                onClick={handleClear}
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-destructive"
              >
                <IconX className="size-3" />
                <span>清除</span>
              </button>
            </div>
          )}
        </PopoverContent>
      </Popover>
    </div>
  );
}

function AssetReferenceCard({
  name,
  imageUrl,
  icon,
  placeholder,
  onClick,
  onOpenPanel,
}: {
  name: string;
  imageUrl: string;
  icon: React.ReactNode;
  placeholder: string;
  onClick: () => void;
  onOpenPanel?: () => void;
}) {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onClick();
        }
      }}
      className="group flex h-full w-full cursor-pointer flex-col items-center justify-center gap-2 px-2 py-2 hover:bg-muted/30"
    >
      <div className="relative aspect-square w-full max-w-20 overflow-hidden rounded-lg bg-muted">
        {imageUrl ? (
          <img src={imageUrl} alt="" className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-muted-foreground/40">
            {icon}
          </div>
        )}
        {name && onOpenPanel ? (
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              onOpenPanel();
            }}
            className="absolute right-1 top-1 flex size-6 items-center justify-center rounded-full border border-black/20 bg-black/60 text-white opacity-0 transition-opacity hover:bg-black/75 group-hover:opacity-100"
            title="打开侧边栏资产"
          >
            <IconExternalLink className="size-3.5" />
          </button>
        ) : null}
      </div>
      {name ? (
        <span className="max-w-full truncate text-xs font-medium">{name}</span>
      ) : (
        <span className="text-xs text-muted-foreground">{placeholder}</span>
      )}
    </div>
  );
}

export function CharacterCell({
  cell,
  shotId,
  shotColumnId,
}: {
  cell?: ShotValue;
  shotId: string;
  shotColumnId: string;
}) {
  const t = useTranslations("storyboard");
  const items = useAppSelector((s) => selectCurrentInstance(s).characters);
  const [open, setOpen] = useState(false);

  const selected = (cell?.characters as Asset[] | undefined)?.[0];
  const selectedId = selected?.id ? String(selected.id) : undefined;
  const imageUrl = ossUrl(selected?.roleImgPath?.[0]);
  const handleOpenPanel = useCallback(() => {
    if (!selectedId && !selected?.name) return;
    store.dispatch(setActivePanel("characters"));
    window.setTimeout(() => {
      dispatchFocusAssetPanel({
        panel: "characters",
        assetId: selectedId,
        assetName: String(selected?.name ?? ""),
        openEditor: true,
      });
    }, 0);
  }, [selected?.name, selectedId]);

  const handleConfirm = (item: Asset | null) => {
    const normalized = item ? { ...item } : null;
    void persistValueList(shotId, shotColumnId, normalized?.id ? [String(normalized.id)] : [], {
      characters: normalized ? [normalized] : [],
    });
    setOpen(false);
  };

  return (
    <>
      <AssetReferenceCard
        name={String(selected?.name ?? "")}
        imageUrl={imageUrl}
        icon={<IconUser className="size-5" />}
        placeholder={t("selectCharacter")}
        onClick={() => setOpen(true)}
        onOpenPanel={selected ? handleOpenPanel : undefined}
      />
      <WorldAssetSelectDialog
        open={open}
        onOpenChange={setOpen}
        title={t("selectCharacter")}
        kind="character"
        items={items}
        selectedId={selectedId}
        onConfirm={handleConfirm}
      />
    </>
  );
}

export function SceneReferenceCell({
  cell,
  shotId,
  shotColumnId,
}: {
  cell?: ShotValue;
  shotId: string;
  shotColumnId: string;
}) {
  const t = useTranslations("storyboard");
  const items = useAppSelector((s) => selectCurrentInstance(s).scenes);
  const [open, setOpen] = useState(false);

  const selected = (cell?.scenes as Asset[] | undefined)?.[0];
  const selectedId = selected?.id ? String(selected.id) : undefined;
  const imageUrl = ossUrl(selected?.sceneImgPath?.[0]);
  const handleOpenPanel = useCallback(() => {
    if (!selectedId && !selected?.name) return;
    store.dispatch(setActivePanel("scenes"));
    window.setTimeout(() => {
      dispatchFocusAssetPanel({
        panel: "scenes",
        assetId: selectedId,
        assetName: String(selected?.name ?? ""),
        openEditor: true,
      });
    }, 0);
  }, [selected?.name, selectedId]);

  const handleConfirm = (item: Asset | null) => {
    const normalized = item ? { ...item } : null;
    void persistValueList(shotId, shotColumnId, normalized?.id ? [String(normalized.id)] : [], {
      scenes: normalized ? [normalized] : [],
    });
    setOpen(false);
  };

  return (
    <>
      <AssetReferenceCard
        name={String(selected?.name ?? "")}
        imageUrl={imageUrl}
        icon={<IconMapPin className="size-5" />}
        placeholder={t("selectScene")}
        onClick={() => setOpen(true)}
        onOpenPanel={selected ? handleOpenPanel : undefined}
      />
      <WorldAssetSelectDialog
        open={open}
        onOpenChange={setOpen}
        title={t("selectScene")}
        kind="scene"
        items={items}
        selectedId={selectedId}
        onConfirm={handleConfirm}
      />
    </>
  );
}

type MediaFile = {
  id?: string;
  path?: string;
  url?: string;
  name?: string;
  preferred?: boolean;
  prompt?: string;
  createTime?: string;
  updateTime?: string;
};

function getPrimaryMediaPath(files: MediaFile[]) {
  return files.find((file) => file.preferred)?.path ?? files[0]?.path ?? "";
}

type MediaManagerMode = "edit" | "review";

type UploadPreviewItem = {
  id: string;
  previewUrl: string;
  uploading: boolean;
  uploadedPath?: string;
};

function formatMediaTime(value?: string) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return `${date.toLocaleDateString()} ${date.toLocaleTimeString().slice(0, 5)}`;
}

function formatMediaBytes(bytes?: number) {
  if (!bytes || bytes <= 0) return "-";
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)}M`;
}

function getCommentChildren(comment: Comment) {
  const children = comment.replies ?? (comment.children as Comment[] | undefined) ?? [];
  return Array.isArray(children) ? children : [];
}

function flattenComments(comments: Comment[], level = 0): Array<Comment & { level: number }> {
  let result: Array<Comment & { level: number }> = [];
  for (const comment of comments) {
    result.push({ ...comment, level });
    const children = getCommentChildren(comment);
    if (children.length > 0) {
      result = result.concat(flattenComments(children, level + 1));
    }
  }
  return result;
}

function MediaReviewPanel({
  projectId,
  targetType,
  targetId,
}: {
  projectId: string;
  targetType: "IMAGE" | "VIDEO";
  targetId?: string;
}) {
  const tc = useTranslations("common");
  const [comments, setComments] = useState<Comment[]>([]);
  const [loading, setLoading] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [replyingId, setReplyingId] = useState<string | null>(null);
  const [replyDrafts, setReplyDrafts] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);

  const flatComments = useMemo(() => flattenComments(comments), [comments]);

  const loadComments = useCallback(async () => {
    if (!projectId || !targetId) {
      setComments([]);
      return;
    }
    setLoading(true);
    try {
      const data = await backendApi.post<Paginated<Comment>>("/api/user/comment/queryPage", {
        data: { projectId, targetType, targetId, page: 1, pageSize: 50 },
      });
      setComments((data?.list ?? []) as Comment[]);
    } catch (error) {
      console.error("[MediaReviewPanel] 加载评论失败:", error);
      toast.error("加载评论失败");
    } finally {
      setLoading(false);
    }
  }, [projectId, targetId, targetType]);

  useEffect(() => {
    void loadComments();
  }, [loadComments]);

  const submitComment = useCallback(
    async (content: string, parentCommentId = "-1") => {
      const trimmed = content.trim();
      if (!projectId || !targetId || !trimmed) return false;
      setSubmitting(true);
      try {
        await backendApi.post("/api/user/comment/create", {
          data: {
            projectId,
            targetType,
            targetId,
            content: trimmed,
            imagePaths: [],
            parentCommentId,
          },
        });
        await loadComments();
        return true;
      } catch (error) {
        console.error("[MediaReviewPanel] 保存评论失败:", error);
        toast.error("评论保存失败");
        return false;
      } finally {
        setSubmitting(false);
      }
    },
    [loadComments, projectId, targetId, targetType]
  );

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-white/10 px-5 py-4">
        <div className="text-sm font-medium text-white/90">评论 ({flatComments.length})</div>
      </div>

      <div className="border-b border-white/10 px-5 py-4">
        {!editing ? (
          <button
            type="button"
            onClick={() => {
              setEditing(true);
              setReplyingId(null);
            }}
            className="w-full rounded-lg border border-dashed border-white/10 px-3 py-3 text-left text-sm text-white/45 transition-colors hover:border-primary/40 hover:text-white/70"
          >
            添加评论
          </button>
        ) : (
          <div className="space-y-3">
            <Textarea
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              rows={4}
              placeholder="输入评论内容"
              className="border-white/10 bg-black/20 text-white/90 placeholder:text-white/35"
            />
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="ghost"
                color="muted"
                onClick={() => {
                  setEditing(false);
                  setDraft("");
                }}
              >
                {tc("cancel")}
              </Button>
              <Button
                type="button"
                disabled={!draft.trim() || submitting}
                onClick={async () => {
                  const success = await submitComment(draft);
                  if (success) {
                    setDraft("");
                    setEditing(false);
                  }
                }}
              >
                {submitting ? <IconLoader2 className="size-4 animate-spin" /> : null}
                发送
              </Button>
            </div>
          </div>
        )}
      </div>

      <div className="flex-1 overflow-y-auto px-5 py-4">
        {loading ? (
          <div className="flex h-full items-center justify-center text-sm text-white/45">
            <IconLoader2 className="mr-2 size-4 animate-spin" />
            加载评论中
          </div>
        ) : !targetId ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 text-center text-white/35">
            <IconMessageCircle className="size-8" />
            <span className="text-sm">请选择一个素材</span>
          </div>
        ) : flatComments.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 text-center text-white/35">
            <IconMessageCircle className="size-8" />
            <span className="text-sm">暂无评论</span>
          </div>
        ) : (
          <div className="space-y-3">
            {flatComments.map((comment) => {
              const commentId = String(comment.id ?? "");
              const replyDraft = replyDrafts[commentId] ?? "";
              return (
                <div
                  key={commentId || `${comment.nickname}-${comment.createTime}`}
                  className="space-y-2 rounded-xl border border-white/8 bg-black/15 p-3"
                  style={{ marginLeft: comment.level * 16 }}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-white/90">
                        {String(comment.nickname ?? "未知用户")}
                      </div>
                      <div className="mt-1 text-xs text-white/35">
                        {formatMediaTime(String(comment.createTime ?? ""))}
                      </div>
                    </div>
                    {commentId ? (
                      <button
                        type="button"
                        onClick={async () => {
                          try {
                            await backendApi.post(`/api/user/comment/delete/${commentId}`);
                            await loadComments();
                          } catch (error) {
                            console.error("[MediaReviewPanel] 删除评论失败:", error);
                            toast.error("删除评论失败");
                          }
                        }}
                        className="text-xs text-white/35 transition-colors hover:text-destructive"
                      >
                        {tc("delete")}
                      </button>
                    ) : null}
                  </div>

                  <div className="whitespace-pre-wrap break-words text-sm leading-6 text-white/78">
                    {String(comment.content ?? "")}
                  </div>

                  <div className="flex items-center gap-3">
                    {commentId ? (
                      <button
                        type="button"
                        onClick={() => {
                          setReplyingId((current) => (current === commentId ? null : commentId));
                          setEditing(false);
                        }}
                        className="text-xs text-white/45 transition-colors hover:text-white/80"
                      >
                        回复
                      </button>
                    ) : null}
                  </div>

                  {replyingId === commentId ? (
                    <div className="space-y-2 pt-1">
                      <Textarea
                        value={replyDraft}
                        onChange={(event) =>
                          setReplyDrafts((current) => ({
                            ...current,
                            [commentId]: event.target.value,
                          }))
                        }
                        rows={3}
                        placeholder="输入回复内容"
                        className="border-white/10 bg-black/20 text-white/90 placeholder:text-white/35"
                      />
                      <div className="flex justify-end gap-2">
                        <Button
                          type="button"
                          variant="ghost"
                          color="muted"
                          onClick={() => {
                            setReplyingId(null);
                            setReplyDrafts((current) => ({ ...current, [commentId]: "" }));
                          }}
                        >
                          取消
                        </Button>
                        <Button
                          type="button"
                          disabled={!replyDraft.trim() || submitting}
                          onClick={async () => {
                            const success = await submitComment(replyDraft, commentId);
                            if (success) {
                              setReplyingId(null);
                              setReplyDrafts((current) => ({ ...current, [commentId]: "" }));
                            }
                          }}
                        >
                          {submitting ? <IconLoader2 className="size-4 animate-spin" /> : null}
                          发送回复
                        </Button>
                      </div>
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function MediaManagerDialog({
  open,
  onOpenChange,
  mediaType,
  title,
  projectId,
  files,
  preferredPath,
  onUploaded,
  onDeletePath,
  onSetPreferred,
  onUnsetPreferred,
  onPromptSave,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mediaType: "image" | "video";
  title: string;
  projectId: string;
  files: MediaFile[];
  preferredPath: string;
  onUploaded: (path: string) => void | Promise<void>;
  onDeletePath: (path: string) => void | Promise<void>;
  onSetPreferred: (path: string) => Promise<void>;
  onUnsetPreferred: (path: string) => Promise<void>;
  onPromptSave: (fileId: string, prompt: string) => Promise<void>;
}) {
  const [mode, setMode] = useState<MediaManagerMode>("edit");
  const [activePath, setActivePath] = useState("");
  const [fileDetails, setFileDetails] = useState<FileDetail | null>(null);
  const tc = useTranslations("common");
  const [loadingDetails, setLoadingDetails] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [savingPrompt, setSavingPrompt] = useState(false);
  const [uploadingItems, setUploadingItems] = useState<UploadPreviewItem[]>([]);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [preferredLoading, setPreferredLoading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const uploadingItemsRef = useRef<UploadPreviewItem[]>([]);
  const isVideo = mediaType === "video";

  const effectiveActivePath =
    activePath && files.some((file) => file.path === activePath)
      ? activePath
      : preferredPath || files[0]?.path || "";
  const activeFile = files.find((file) => file.path === effectiveActivePath) ?? files[0];
  const activeSrc = activeFile ? ossUrl(activeFile.url || activeFile.path) : "";
  const hasPreferred = files.some((file) => file.preferred);
  const maxReached = files.length >= 10;
  const activeFileId = String(activeFile?.id ?? "");
  const detailMatchesActiveFile = String(fileDetails?.id ?? "") === activeFileId;
  const originalPrompt = String(
    (detailMatchesActiveFile ? fileDetails?.prompt : undefined) ?? activeFile?.prompt ?? ""
  );

  useEffect(() => {
    if (!open) {
      setMode("edit");
      setDeleteOpen(false);
      setPreferredLoading(false);
    }
  }, [open]);

  useEffect(() => {
    setPrompt(originalPrompt);
  }, [originalPrompt, activeFileId]);

  useEffect(() => {
    if (!activeFileId || !open) {
      setFileDetails(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      setLoadingDetails(true);
      try {
        const data = await backendApi.post<FileDetail>(`/api/user/file/detail/${activeFileId}`);
        if (!cancelled) {
          setFileDetails(data);
        }
      } catch (error) {
        console.error("[MediaManagerDialog] 获取文件详情失败:", error);
        if (!cancelled) {
          setFileDetails(null);
        }
      } finally {
        if (!cancelled) {
          setLoadingDetails(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [activeFileId, open]);

  useEffect(() => {
    if (files.length === 0) {
      setActivePath("");
    }
  }, [files.length]);

  useEffect(() => {
    if (!files.length) return;
    setUploadingItems((current) =>
      current.filter((item) => {
        if (item.uploading) return true;
        if (item.uploadedPath && files.some((file) => file.path === item.uploadedPath)) {
          URL.revokeObjectURL(item.previewUrl);
          return false;
        }
        return true;
      })
    );
  }, [files]);

  useEffect(() => {
    uploadingItemsRef.current = uploadingItems;
  }, [uploadingItems]);

  useEffect(() => {
    return () => {
      for (const item of uploadingItemsRef.current) {
        URL.revokeObjectURL(item.previewUrl);
      }
    };
  }, []);

  const handlePromptBlur = useCallback(async () => {
    if (!activeFileId || savingPrompt || prompt === originalPrompt) return;
    try {
      setSavingPrompt(true);
      await onPromptSave(activeFileId, prompt);
      setFileDetails((current) => (current ? { ...current, prompt } : current));
      toast.success(tc("saveSuccess"));
    } catch (error) {
      console.error("[MediaManagerDialog] 保存提示词失败:", error);
      toast.error(tc("saveFailed"));
    } finally {
      setSavingPrompt(false);
    }
  }, [activeFileId, onPromptSave, originalPrompt, prompt, savingPrompt]);

  const handleShare = useCallback(async () => {
    if (!activeSrc) return;
    try {
      await navigator.clipboard.writeText(activeSrc);
      toast.success(tc("copySuccess"));
    } catch (error) {
      console.error("[MediaManagerDialog] 复制链接失败:", error);
      toast.error(tc("copyFailed"));
    }
  }, [activeSrc, isVideo]);

  const handleDownload = useCallback(() => {
    if (!activeSrc) return;
    const link = document.createElement("a");
    link.href = activeSrc;
    link.download = activeFile?.name || "";
    link.target = "_blank";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }, [activeFile?.name, activeSrc]);

  const handlePreferredToggle = useCallback(async () => {
    const targetPath = activeFile?.path ?? "";
    if (!targetPath || preferredLoading) return;

    try {
      setPreferredLoading(true);
      if (activeFile?.preferred) {
        await onUnsetPreferred(targetPath);
      } else {
        await onSetPreferred(targetPath);
      }
    } finally {
      setPreferredLoading(false);
    }
  }, [activeFile?.path, activeFile?.preferred, onSetPreferred, onUnsetPreferred, preferredLoading]);

  const handleLocalUpload = useCallback(
    async (rawFile: File) => {
      if (maxReached) {
        toast.warning("最多添加 10 个素材");
        return;
      }
      const isValidType = isVideo
        ? rawFile.type.startsWith("video/")
        : rawFile.type.startsWith("image/");
      if (!isValidType) {
        toast.warning(isVideo ? "请选择视频文件" : "请选择图片文件");
        return;
      }

      const maxSize = isVideo ? 100 * 1024 * 1024 : 10 * 1024 * 1024;
      if (rawFile.size > maxSize) {
        toast.warning(`文件大小不能超过${maxSize / (1024 * 1024)}MB`);
        return;
      }

      const tempId = `uploading_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      const previewUrl = URL.createObjectURL(rawFile);
      setUploadingItems((current) => [...current, { id: tempId, previewUrl, uploading: true }]);

      try {
        const uploaded = await uploadWorkspaceFile(rawFile, {
          uploadType: isVideo ? "SHOT_VALUE_VIDEO" : "SHOT_VALUE_IMAGE",
          sourceType: "LOCAL",
          maxSize,
          accept: isVideo ? "video/*" : "image/*",
        });
        const storagePath = uploaded.path;

        setUploadingItems((current) =>
          current.map((item) =>
            item.id === tempId ? { ...item, uploading: false, uploadedPath: storagePath } : item
          )
        );
        setActivePath(storagePath);
        await onUploaded(storagePath);
        toast.success(tc("uploadSuccess"));
      } catch (error) {
        console.error("[MediaManagerDialog] 上传失败:", error);
        toast.error(tc("uploadFailed"));
        setUploadingItems((current) => {
          const target = current.find((item) => item.id === tempId);
          if (target) {
            URL.revokeObjectURL(target.previewUrl);
          }
          return current.filter((item) => item.id !== tempId);
        });
      }
    },
    [isVideo, maxReached, onUploaded]
  );

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent
          showCloseButton={false}
          className="h-[85vh] w-[90vw] max-w-[1400px] overflow-hidden border-none bg-[#1A1A1A] p-0 text-white sm:max-w-[1400px]"
        >
          <div className="relative flex h-full min-h-0">
            <span className="sr-only">{title}</span>
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              className="absolute right-4 top-4 z-20 flex size-9 items-center justify-center rounded-full text-white/90 transition-colors hover:bg-black/70"
            >
              <IconX className="size-5" />
            </button>

            <div className="flex min-h-0 flex-1 flex-col">
              <div
                className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden px-5 py-5"
                id="mediaPreviewContainer"
              >
                {activeSrc ? (
                  <>
                    {isVideo ? (
                      <video
                        key={activeSrc}
                        src={activeSrc}
                        controls
                        playsInline
                        className="max-h-full max-w-full rounded-lg object-contain"
                      />
                    ) : (
                      <img
                        src={activeSrc}
                        alt=""
                        className="max-h-full max-w-full cursor-zoom-in rounded-lg object-contain"
                        onClick={() => window.open(activeSrc, "_blank")}
                      />
                    )}

                    <div className="absolute right-5 top-5 z-10 flex items-center gap-2 rounded-lg bg-black/60 px-3 py-2 backdrop-blur-sm">
                      {activeFile?.preferred ? (
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          color="muted"
                          className="h-8 bg-primary text-white hover:bg-primary/90"
                          onClick={() => void handlePreferredToggle()}
                          disabled={preferredLoading}
                        >
                          {preferredLoading ? (
                            <IconLoader2 className="size-3.5 animate-spin" />
                          ) : (
                            <IconCircleCheck className="size-3.5" />
                          )}
                          {preferredLoading ? "处理中..." : "定稿版本"}
                        </Button>
                      ) : (
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          color="muted"
                          className="h-8 text-white hover:bg-white/10 hover:text-white"
                          onClick={() => void handlePreferredToggle()}
                          disabled={preferredLoading}
                        >
                          {preferredLoading ? (
                            <IconLoader2 className="size-3.5 animate-spin" />
                          ) : (
                            <IconCircleCheck className="size-3.5" />
                          )}
                          {preferredLoading ? "处理中..." : "设为定稿"}
                        </Button>
                      )}
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        color="muted"
                        className="size-8 text-white hover:bg-white/10 hover:text-white"
                        onClick={handleDownload}
                      >
                        <IconDownload className="size-4" />
                      </Button>
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        color="muted"
                        className="size-8 text-white hover:bg-white/10 hover:text-white"
                        onClick={() => setDeleteOpen(true)}
                        disabled={preferredLoading}
                      >
                        <IconTrash className="size-4" />
                      </Button>
                    </div>
                  </>
                ) : (
                  <div className="flex flex-col items-center gap-3 text-white/35">
                    {isVideo ? (
                      <IconVideo className="size-12" />
                    ) : (
                      <IconPhoto className="size-12" />
                    )}
                    <span className="text-sm">暂无素材</span>
                  </div>
                )}
              </div>

              <div className="border-t border-white/10 bg-[#1A1A1A] px-5 py-4">
                <div className="overflow-x-auto">
                  <div className="flex min-w-max items-center justify-center gap-3">
                    {!hasPreferred ? (
                      <div className="flex h-[72px] w-[72px] shrink-0 items-center justify-center rounded-lg bg-[#2A2A2A] px-2 text-center text-xs text-white/55">
                        暂未定稿
                      </div>
                    ) : null}

                    {files.map((file) => {
                      const filePath = file.path ?? "";
                      const active = filePath === (activeFile?.path ?? "");
                      const thumbnail = isVideo
                        ? getVideoThumbnail(file.url || file.path)
                        : ossUrl(file.url || file.path);
                      return (
                        <button
                          key={filePath}
                          type="button"
                          onClick={() => setActivePath(filePath)}
                          className={cn(
                            "relative h-[72px] w-[72px] shrink-0 overflow-hidden rounded-lg border-2 border-transparent bg-[#2A2A2A] transition-colors hover:border-white/30",
                            (active || file.preferred) && "border-primary"
                          )}
                        >
                          {thumbnail ? (
                            <img src={thumbnail} alt="" className="h-full w-full object-cover" />
                          ) : isVideo ? (
                            <div className="flex h-full w-full items-center justify-center text-white/45">
                              <IconPlayerPlay className="size-5" />
                            </div>
                          ) : null}
                          {file.preferred ? (
                            <div className="absolute right-1 top-1 flex size-[18px] items-center justify-center rounded-full bg-primary text-white">
                              <IconCheck className="size-3" />
                            </div>
                          ) : null}
                        </button>
                      );
                    })}

                    {uploadingItems.map((item) => (
                      <div
                        key={item.id}
                        className="relative h-[72px] w-[72px] shrink-0 overflow-hidden rounded-lg bg-[#2A2A2A]"
                      >
                        {!isVideo ? (
                          <img
                            src={item.previewUrl}
                            alt=""
                            className="h-full w-full object-cover"
                          />
                        ) : (
                          <div className="flex h-full w-full items-center justify-center text-white/45">
                            <IconPlayerPlay className="size-5" />
                          </div>
                        )}
                        {item.uploading ? (
                          <div className="absolute inset-0 flex items-center justify-center bg-black/60">
                            <IconLoader2 className="size-4 animate-spin text-white" />
                          </div>
                        ) : null}
                      </div>
                    ))}

                    <button
                      type="button"
                      disabled={maxReached}
                      onClick={() => fileInputRef.current?.click()}
                      className={cn(
                        "flex h-[72px] w-[72px] shrink-0 items-center justify-center rounded-lg border-2 border-dashed border-white/15 text-white/55 transition-colors hover:border-primary hover:text-primary",
                        maxReached &&
                          "cursor-not-allowed opacity-50 hover:border-white/15 hover:text-white/55"
                      )}
                    >
                      <IconPlus className="size-6" />
                    </button>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept={isVideo ? "video/*" : "image/*"}
                      className="hidden"
                      onChange={(event) => {
                        const selectedFiles = Array.from(event.target.files ?? []);
                        for (const item of selectedFiles) {
                          void handleLocalUpload(item);
                        }
                        event.target.value = "";
                      }}
                    />
                  </div>
                </div>
              </div>
            </div>

            <div className="flex w-[440px] min-h-0 shrink-0 flex-col border-l border-white/10 bg-[#1A1A1A]">
              <div className="flex items-center justify-between border-b border-white/10 px-5 py-4 pr-14">
                <div className="flex overflow-hidden rounded-md bg-[#2A2A2A]">
                  <button
                    type="button"
                    onClick={() => setMode("edit")}
                    className={cn(
                      "px-4 py-2 text-[13px] transition-colors",
                      mode === "edit" ? "bg-primary text-white" : "text-white/55 hover:text-white"
                    )}
                  >
                    编辑
                  </button>
                  <button
                    type="button"
                    onClick={() => setMode("review")}
                    className={cn(
                      "px-4 py-2 text-[13px] transition-colors",
                      mode === "review" ? "bg-primary text-white" : "text-white/55 hover:text-white"
                    )}
                  >
                    审阅
                  </button>
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  color="muted"
                  className="h-8 text-white/75 hover:bg-white/10 hover:text-white"
                  onClick={handleShare}
                >
                  <IconExternalLink className="size-4" />
                  {isVideo ? "分享视频" : "分享图片"}
                </Button>
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto">
                {mode === "review" ? (
                  <MediaReviewPanel
                    projectId={projectId}
                    targetType={isVideo ? "VIDEO" : "IMAGE"}
                    targetId={activeFileId || undefined}
                  />
                ) : (
                  <div className="space-y-6 px-5 py-5">
                    {loadingDetails ? (
                      <div className="space-y-3">
                        <div className="h-5 w-2/3 animate-pulse rounded bg-white/10" />
                        <div className="h-4 w-1/2 animate-pulse rounded bg-white/10" />
                        <div className="h-4 w-1/3 animate-pulse rounded bg-white/10" />
                      </div>
                    ) : activeFile ? (
                      <div>
                        <div className="break-all text-[15px] font-medium text-white">
                          {String(
                            (detailMatchesActiveFile ? fileDetails?.name : undefined) ??
                              activeFile.name ??
                              activeFile.path?.split("/").pop() ??
                              "未知文件"
                          )}
                        </div>
                        <div className="mt-2 flex items-center gap-2 text-xs text-white/45">
                          {String(
                            detailMatchesActiveFile ? (fileDetails?.userAvatarImagePath ?? "") : ""
                          ) ? (
                            <img
                              src={ossUrl(String(fileDetails?.userAvatarImagePath))}
                              alt=""
                              className="size-4 rounded-full object-cover"
                            />
                          ) : (
                            <IconUser className="size-4" />
                          )}
                          <span className="text-white/70">
                            {String(
                              (detailMatchesActiveFile ? fileDetails?.userName : undefined) ??
                                (detailMatchesActiveFile ? fileDetails?.nickname : undefined) ??
                                "未知用户"
                            )}
                          </span>
                          <span className="text-white/20">·</span>
                          <span>
                            更新于{" "}
                            {formatMediaTime(
                              String(
                                (detailMatchesActiveFile ? fileDetails?.updateTime : undefined) ??
                                  activeFile.updateTime ??
                                  activeFile.createTime ??
                                  ""
                              )
                            )}
                          </span>
                        </div>
                        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-white/45">
                          <span>
                            {String(
                              (detailMatchesActiveFile ? fileDetails?.type : undefined) ??
                                (isVideo ? "mp4" : "jpg")
                            )}
                          </span>
                          {(detailMatchesActiveFile ? fileDetails?.width : undefined) &&
                          (detailMatchesActiveFile ? fileDetails?.height : undefined) ? (
                            <>
                              <span className="text-white/20">|</span>
                              <span>
                                {fileDetails?.width}×{fileDetails?.height}px
                              </span>
                            </>
                          ) : null}
                          <span className="text-white/20">|</span>
                          <span>
                            {formatMediaBytes(
                              Number((detailMatchesActiveFile ? fileDetails?.size : undefined) ?? 0)
                            )}
                          </span>
                        </div>
                      </div>
                    ) : (
                      <div className="py-10 text-center text-sm text-white/35">请选择一个素材</div>
                    )}

                    <div>
                      <div className="mb-3 text-sm font-medium text-white/85">提示词</div>
                      <Textarea
                        value={prompt}
                        onChange={(event) => setPrompt(event.target.value)}
                        onBlur={() => void handlePromptBlur()}
                        rows={8}
                        placeholder="输入当前素材对应的提示词"
                        className="border-white/10 bg-black/20 text-white/90 placeholder:text-white/35"
                      />
                      <div className="mt-2 text-right text-xs text-white/35">
                        {savingPrompt ? "保存中..." : `${prompt.length}/3000`}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认删除</AlertDialogTitle>
            <AlertDialogDescription>
              {isVideo ? "确定要删除这个视频吗？" : "确定要删除这张图片吗？"}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{tc("cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (activeFile?.path) {
                  void onDeletePath(activeFile.path);
                }
              }}
            >
              {tc("delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

export function ImageCell({
  cell,
  shotId,
  shotColumnId,
  row,
  column,
}: {
  cell?: ShotValue;
  shotId: string;
  shotColumnId: string;
  row: ShotRow;
  column: ShotColumn;
}) {
  const t = useTranslations("storyboard");
  const tc = useTranslations("common");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [managerOpen, setManagerOpen] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const [isHovering, setIsHovering] = useState(false);
  const [tempPreviewUrl, setTempPreviewUrl] = useState("");
  const [showGenerateDone, setShowGenerateDone] = useState(false);
  const dragCounterRef = useRef(0);
  const doneTimerRef = useRef<number | null>(null);
  const previousGeneratingRef = useRef(false);
  const previousSuccessCountRef = useRef(0);

  const columns = useAppSelector((state) => selectCurrentInstance(state).columns);
  const detail = useAppSelector((state) => selectCurrentInstance(state).detail);
  const isBatchGeneratingCell = useAppSelector((state) =>
    Boolean(selectCurrentInstance(state).batchGeneratingCells[`${shotId}:${shotColumnId}`])
  );
  const isBatchCompletedCell = useAppSelector((state) =>
    Boolean(selectCurrentInstance(state).batchCompletedCells[`${shotId}:${shotColumnId}`])
  );
  const tasks = useAppSelector((state) => state.task.tasks);
  const aiTasks = useMemo(
    () =>
      Object.values(tasks).filter(
        (t) => t.type === "image" && t.shotId === shotId && t.shotColumnId === shotColumnId
      ),
    [tasks, shotId, shotColumnId]
  );

  const files = useMemo(() => (cell?.files as MediaFile[] | undefined) ?? [], [cell?.files]);
  const appliedPaths = files.map((file) => file.path ?? "").filter(Boolean);
  const preferredPath = files.find((file) => file.preferred)?.path ?? "";
  const src = ossUrl(getPreferredFilePath(cell));
  const thumbnailSrc = buildOssImageUrl(src, { width: 400, height: 300, mode: "fill" });
  const displayImageUrl = tempPreviewUrl || thumbnailSrc;
  const promptContext = useMemo(
    () => buildImagePromptContext(row, column, columns, detail as Record<string, unknown> | null),
    [column, columns, detail, row]
  );
  const isAiGenerating = aiTasks.some(
    (task) => task.status === "pending" || task.status === "running"
  );
  const successCount = aiTasks.filter((task) => task.status === "completed").length;

  useEffect(() => {
    if (
      previousGeneratingRef.current &&
      !isAiGenerating &&
      successCount > previousSuccessCountRef.current
    ) {
      setShowGenerateDone(true);
      if (doneTimerRef.current) {
        window.clearTimeout(doneTimerRef.current);
      }
      doneTimerRef.current = window.setTimeout(() => {
        setShowGenerateDone(false);
        doneTimerRef.current = null;
      }, 2200);
    }

    previousGeneratingRef.current = isAiGenerating;
    previousSuccessCountRef.current = successCount;
  }, [isAiGenerating, successCount]);

  useEffect(() => {
    if (tempPreviewUrl && tempPreviewUrl.startsWith("blob:") && src && src !== tempPreviewUrl) {
      URL.revokeObjectURL(tempPreviewUrl);
      setTempPreviewUrl("");
    }
  }, [src, tempPreviewUrl]);

  useEffect(() => {
    return () => {
      if (tempPreviewUrl && tempPreviewUrl.startsWith("blob:")) {
        URL.revokeObjectURL(tempPreviewUrl);
      }
      if (doneTimerRef.current) {
        window.clearTimeout(doneTimerRef.current);
      }
    };
  }, [tempPreviewUrl]);

  const updateFilesState = useCallback(
    (nextFiles: MediaFile[], nextCellId?: string) => {
      const primaryPath = getPrimaryMediaPath(nextFiles);
      const currentRows = selectCurrentInstance(store.getState()).rows;
      store.dispatch(
        setRows(
          upsertShotCell(currentRows, shotId, shotColumnId, {
            id: nextCellId ?? cell?.id,
            files: nextFiles,
            values: nextFiles.map((file) => file.path).filter(Boolean),
            value: primaryPath,
          })
        )
      );
    },
    [cell?.id, shotColumnId, shotId]
  );

  const persistImagePaths = useCallback(
    async (nextPaths: string[]) => {
      const previousFiles = files.map((file) => ({ ...file }));
      const previousCellId = cell?.id;
      const uniquePaths = Array.from(new Set(nextPaths.filter(Boolean)));
      const hasExistingPreferred =
        preferredPath &&
        uniquePaths.includes(preferredPath) &&
        files.some((file) => file.path === preferredPath && file.preferred);
      const effectivePreferredPath = hasExistingPreferred ? preferredPath : "";
      const nextFiles = uniquePaths.map((path) => {
        const existing = files.find((file) => file.path === path);
        return {
          ...(existing ?? { path }),
          path,
          preferred: effectivePreferredPath ? path === effectivePreferredPath : false,
        };
      });

      updateFilesState(nextFiles);

      try {
        const result = await backendApi.post("/api/user/shotValue/input", {
          data: { shotId, shotColumnId, value: "", values: uniquePaths },
        });
        const nextId = resolveShotValueId(result);
        updateFilesState(nextFiles, nextId || undefined);
      } catch (error) {
        console.error("[ImageCell] 保存图片失败:", error);
        updateFilesState(previousFiles, previousCellId);
        toast.error(tc("saveFailed"));
      }
    },
    [cell?.id, files, preferredPath, shotColumnId, shotId, updateFilesState]
  );

  const handleCollect = useCallback(
    (item: ResultItem) => {
      const itemPath = item.storagePath ?? "";
      if (!itemPath) return;

      const nextPaths = appliedPaths.includes(itemPath)
        ? appliedPaths.filter((path) => path !== itemPath)
        : [...appliedPaths, itemPath];

      void persistImagePaths(nextPaths);
    },
    [appliedPaths, persistImagePaths]
  );

  const handleSelect = (paths: string[]) => {
    setTempPreviewUrl(paths[0] ? ossUrl(paths[0]) : "");
    void persistImagePaths(paths);
  };

  const handleManagerAdd = async (paths: string[]) => {
    const nextPaths = [...appliedPaths];
    for (const path of paths) {
      if (!nextPaths.includes(path)) {
        nextPaths.push(path);
      }
    }
    await persistImagePaths(nextPaths);
  };

  const handleDeletePath = useCallback(
    (path: string) => {
      const nextPaths = appliedPaths.filter((item) => item !== path);
      if (displayImageUrl === ossUrl(path)) {
        setTempPreviewUrl("");
      }
      void persistImagePaths(nextPaths);
      if (nextPaths.length === 0) {
        setManagerOpen(false);
      }
    },
    [appliedPaths, displayImageUrl, persistImagePaths]
  );

  const handleUnsetPreferred = useCallback(
    async (path: string) => {
      const targetPath = path.trim();
      if (!targetPath) return;

      const latestRows = selectCurrentInstance(store.getState()).rows;
      const latestRow = latestRows.find((itemRow) => itemRow.shotId === shotId);
      const latestCell = latestRow?.shotValues?.find(
        (value) => value.shotColumnId === shotColumnId
      );
      const previousFiles = ((latestCell?.files as MediaFile[] | undefined) ?? files).map(
        (file) => ({
          ...file,
        })
      );
      const cellId = typeof latestCell?.id === "string" ? latestCell.id : cell?.id;
      if (!cellId) return;

      try {
        await backendApi.post(`/api/user/shotValue/preferred/${String(cellId)}`, {
          data: { value: targetPath, preferred: false },
        });
        const nextFiles = previousFiles.map((file) => ({
          ...file,
          preferred: false,
        }));
        updateFilesState(nextFiles, typeof latestCell?.id === "string" ? latestCell.id : undefined);
      } catch (error) {
        console.error("[ImageCell] 取消定稿失败:", error);
        toast.error("取消定稿失败");
      }
    },
    [cell?.id, files, shotColumnId, shotId, updateFilesState]
  );

  const handleSetPreferred = useCallback(
    async (item: { storagePath?: string; path?: string }) => {
      const targetPath = item.storagePath ?? item.path ?? "";
      if (!targetPath) return;

      // Toggle: if already preferred, unset it
      if (targetPath === preferredPath) {
        await handleUnsetPreferred(targetPath);
        return;
      }

      const existingPaths = files.map((file) => file.path ?? "").filter(Boolean);
      if (!existingPaths.includes(targetPath)) {
        await persistImagePaths([...existingPaths, targetPath]);
      }

      const latestRows = selectCurrentInstance(store.getState()).rows;
      const latestRow = latestRows.find((itemRow) => itemRow.shotId === shotId);
      const latestCell = latestRow?.shotValues?.find(
        (value) => value.shotColumnId === shotColumnId
      );
      const previousFiles = ((latestCell?.files as MediaFile[] | undefined) ?? files).map(
        (file) => ({
          ...file,
        })
      );
      if (!previousFiles.some((file) => file.path === targetPath)) {
        toast.error("素材加入管理失败");
        return;
      }
      const cellId = typeof latestCell?.id === "string" ? latestCell.id : cell?.id;
      if (!cellId) return;

      try {
        await backendApi.post(`/api/user/shotValue/preferred/${String(cellId)}`, {
          data: { value: targetPath, preferred: true },
        });
        const nextFiles = previousFiles.map((file) => ({
          ...file,
          preferred: file.path === targetPath,
        }));
        updateFilesState(nextFiles, typeof latestCell?.id === "string" ? latestCell.id : undefined);
      } catch (error) {
        console.error("[ImageCell] 设置定稿失败:", error);
        toast.error("设置定稿失败");
      }
    },
    [
      cell?.id,
      files,
      handleUnsetPreferred,
      persistImagePaths,
      preferredPath,
      shotColumnId,
      shotId,
      updateFilesState,
    ]
  );

  const handlePromptSave = useCallback(
    async (fileId: string, prompt: string) => {
      await backendApi.post(`/api/user/file/updatePrompt/${fileId}`, { data: { prompt } });
      updateFilesState(
        files.map((file) => (String(file.id ?? "") === String(fileId) ? { ...file, prompt } : file))
      );
    },
    [files, updateFilesState]
  );

  const handleGeneratePrompt = useCallback(
    (prompt: string) => {
      const imagePromptColumnId = promptContext.imagePromptColumnId;
      if (!imagePromptColumnId || !prompt.trim()) return;
      void persistTextCell(shotId, imagePromptColumnId, prompt.trim(), { richText: true });
    },
    [promptContext.imagePromptColumnId, shotId]
  );

  const handleUploadFile = useCallback(
    async (file: File) => {
      if (!file.type.startsWith("image/")) {
        toast.error(tc("selectImageFile"));
        return;
      }

      const localPreviewUrl = URL.createObjectURL(file);
      setTempPreviewUrl(localPreviewUrl);
      setUploading(true);

      try {
        const uploaded = await uploadWorkspaceFile(file, {
          uploadType: "SHOT_VALUE_IMAGE",
          sourceType: "LOCAL",
          accept: "image/*",
        });
        const storagePath = uploaded.path;

        URL.revokeObjectURL(localPreviewUrl);
        setTempPreviewUrl(ossUrl(storagePath));
        await persistImagePaths([storagePath]);
      } catch (error) {
        console.error("[ImageCell] 上传失败:", error);
        toast.error(tc("uploadFailed"));
        URL.revokeObjectURL(localPreviewUrl);
        setTempPreviewUrl("");
      } finally {
        setUploading(false);
      }
    },
    [persistImagePaths]
  );

  const aiButtonIcon =
    isAiGenerating || isBatchGeneratingCell ? (
      <IconLoader2 className="size-3.5 animate-spin" />
    ) : showGenerateDone || isBatchCompletedCell ? (
      <IconCircleCheck className="size-3.5 text-green-500" />
    ) : (
      <IconSparkles className="size-3.5" />
    );

  return (
    <>
      <div
        className={cn(
          "group relative flex h-full w-full items-center justify-center overflow-hidden rounded-md p-4",
          isDragOver && "border-2 border-dashed border-primary bg-primary/10"
        )}
        onDragEnter={(event) => {
          event.preventDefault();
          dragCounterRef.current += 1;
          setIsDragOver(true);
        }}
        onDragOver={(event) => event.preventDefault()}
        onDragLeave={() => {
          dragCounterRef.current = Math.max(0, dragCounterRef.current - 1);
          if (dragCounterRef.current === 0) {
            setIsDragOver(false);
          }
        }}
        onDrop={(event) => {
          event.preventDefault();
          dragCounterRef.current = 0;
          setIsDragOver(false);
          const file = event.dataTransfer?.files?.[0];
          if (file) {
            void handleUploadFile(file);
          }
        }}
        onMouseEnter={() => setIsHovering(true)}
        onMouseLeave={() => setIsHovering(false)}
      >
        {displayImageUrl ? (
          <div className="relative h-full w-full">
            <img src={displayImageUrl} alt="" className="h-full w-full rounded-md object-cover" />
            {!isBatchGeneratingCell ? (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 rounded-md bg-black/60 opacity-0 transition-opacity group-hover:opacity-100">
                <Button size="sm" variant="soft" color="muted" onClick={() => setManagerOpen(true)}>
                  图片管理
                </Button>
                <Button
                  size="sm"
                  variant="soft"
                  color="muted"
                  onClick={() => {
                    setShowGenerateDone(false);
                    if (isBatchCompletedCell) {
                      store.dispatch(
                        clearSingleBatchCompleted({ shotId: shotId, columnId: shotColumnId })
                      );
                    }
                    setAiOpen(true);
                  }}
                >
                  {aiButtonIcon}
                  {t("aiImage")}
                </Button>
              </div>
            ) : (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 rounded-md bg-black/55">
                <IconLoader2 className="size-5 animate-spin text-white/75" />
                <span className="text-[11px] font-medium text-white/80">批量生成中...</span>
              </div>
            )}
          </div>
        ) : isDragOver ? (
          <div className="flex h-full w-full items-center justify-center text-center text-xs text-primary">
            拖拽图片到这里
          </div>
        ) : isBatchGeneratingCell ? (
          <div className="flex h-full w-full flex-col items-center justify-center gap-2 text-center">
            <IconLoader2 className="size-5 animate-spin text-white/75" />
            <span className="text-[11px] font-medium text-white/80">批量生成中...</span>
          </div>
        ) : (
          <div className="flex h-full w-fit flex-col items-stretch justify-center gap-3">
            <Button size="sm" variant="soft" color="muted" onClick={() => setPickerOpen(true)}>
              选择图片
            </Button>
            <Button
              size="sm"
              variant="soft"
              color="muted"
              onClick={() => {
                setShowGenerateDone(false);
                if (isBatchCompletedCell) {
                  store.dispatch(
                    clearSingleBatchCompleted({ shotId: shotId, columnId: shotColumnId })
                  );
                }
                setAiOpen(true);
              }}
            >
              {aiButtonIcon}
              AI 生图
            </Button>
          </div>
        )}

        {(uploading || (isAiGenerating && !isHovering)) && (
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-2 rounded-md bg-black/35">
            <IconLoader2 className="size-4 animate-spin text-white/90" />
            {isAiGenerating ? (
              <span className="text-[10px] font-medium text-primary">Generating...</span>
            ) : null}
          </div>
        )}
      </div>

      <AssetPickerDialog
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        assetType="img"
        onSelect={handleSelect}
      />

      <ImageManagerDialog
        open={managerOpen}
        onOpenChange={setManagerOpen}
        projectId={String(detail?.id ?? "")}
        files={files}
        preferredPath={preferredPath}
        onUploaded={(path) => handleManagerAdd([path])}
        onDeletePath={handleDeletePath}
        onSetPreferred={(path) => handleSetPreferred({ path })}
        onUnsetPreferred={(path) => handleUnsetPreferred(path)}
        onPromptSave={handlePromptSave}
      />

      <AiImageGeneratorDialog
        open={aiOpen}
        onOpenChange={setAiOpen}
        shotId={shotId}
        shotColumnId={shotColumnId}
        defaultPrompt={promptContext.prompt}
        referenceFields={promptContext.referenceFields}
        defaultRefImage={src || undefined}
        appliedPaths={appliedPaths}
        preferredPath={preferredPath}
        onCollect={handleCollect}
        onSetPreferred={handleSetPreferred}
        onGeneratePrompt={handleGeneratePrompt}
      />
    </>
  );
}

function ImageManagerDialog({
  open,
  onOpenChange,
  projectId,
  files,
  preferredPath,
  onUploaded,
  onDeletePath,
  onSetPreferred,
  onUnsetPreferred,
  onPromptSave,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  files: MediaFile[];
  preferredPath: string;
  onUploaded: (path: string) => void | Promise<void>;
  onDeletePath: (path: string) => void;
  onSetPreferred: (path: string) => Promise<void>;
  onUnsetPreferred: (path: string) => Promise<void>;
  onPromptSave: (fileId: string, prompt: string) => Promise<void>;
}) {
  return (
    <MediaManagerDialog
      open={open}
      onOpenChange={onOpenChange}
      mediaType="image"
      title="图片管理"
      projectId={projectId}
      files={files}
      preferredPath={preferredPath}
      onUploaded={onUploaded}
      onDeletePath={onDeletePath}
      onSetPreferred={onSetPreferred}
      onUnsetPreferred={onUnsetPreferred}
      onPromptSave={onPromptSave}
    />
  );
}

function VideoManagerDialog({
  open,
  onOpenChange,
  projectId,
  files,
  preferredPath,
  onUploaded,
  onDeletePath,
  onSetPreferred,
  onUnsetPreferred,
  onPromptSave,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  files: MediaFile[];
  preferredPath: string;
  onUploaded: (path: string) => void | Promise<void>;
  onDeletePath: (path: string) => void;
  onSetPreferred: (path: string) => Promise<void>;
  onUnsetPreferred: (path: string) => Promise<void>;
  onPromptSave: (fileId: string, prompt: string) => Promise<void>;
}) {
  return (
    <MediaManagerDialog
      open={open}
      onOpenChange={onOpenChange}
      mediaType="video"
      title="视频管理"
      projectId={projectId}
      files={files}
      preferredPath={preferredPath}
      onUploaded={onUploaded}
      onDeletePath={onDeletePath}
      onSetPreferred={onSetPreferred}
      onUnsetPreferred={onUnsetPreferred}
      onPromptSave={onPromptSave}
    />
  );
}

export function MediaCell({
  cell,
  shotId,
  shotColumnId,
  type,
  row,
  column,
  defaultPrompt,
  defaultReferenceImage,
}: {
  cell?: ShotValue;
  shotId: string;
  shotColumnId: string;
  type: "video" | "audio" | "lip_sync";
  row?: ShotRow;
  column?: ShotColumn;
  defaultPrompt?: string;
  defaultReferenceImage?: string;
}) {
  const t = useTranslations("storyboard");
  const tc = useTranslations("common");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);
  const [managerOpen, setManagerOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const [isHovering, setIsHovering] = useState(false);
  const [tempPreviewUrl, setTempPreviewUrl] = useState("");
  const [isAiGenerating, setIsAiGenerating] = useState(false);
  const [showGenerateDone, setShowGenerateDone] = useState(false);
  const dragCounterRef = useRef(0);
  const doneTimerRef = useRef<number | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioProgressRafRef = useRef<number | null>(null);
  const [isAudioPlaying, setIsAudioPlaying] = useState(false);
  const [audioPlayProgress, setAudioPlayProgress] = useState(0);

  const assetType = type === "audio" ? "audio" : "video";
  const isVideoCell = type === "video";
  const isAudioCell = type === "audio";
  const audioPresetKey = String(
    column?.presetColumnKey ?? cell?.presetColumnKey ?? ""
  ).toLowerCase();
  const isMusicAudioCell = isAudioCell && audioPresetKey === "music";
  const isVoiceAudioCell = isAudioCell && !isMusicAudioCell;
  const isDraggableCell = isVideoCell || isAudioCell;
  const columns = useAppSelector((state) => selectCurrentInstance(state).columns);
  const detail = useAppSelector((state) => selectCurrentInstance(state).detail);
  const worldId = useAppSelector((state) => selectCurrentInstance(state).worldId);
  const isBatchGeneratingCell = useAppSelector((state) =>
    Boolean(selectCurrentInstance(state).batchGeneratingCells[`${shotId}:${shotColumnId}`])
  );
  const isBatchCompletedCell = useAppSelector((state) =>
    Boolean(selectCurrentInstance(state).batchCompletedCells[`${shotId}:${shotColumnId}`])
  );
  const path = getPreferredFilePath(cell);
  const src = ossUrl(path);
  const files = useMemo(() => (cell?.files as MediaFile[] | undefined) ?? [], [cell?.files]);
  const appliedPaths = files.map((file) => file.path ?? "").filter(Boolean);
  const preferredPath = files.find((file) => file.preferred)?.path ?? "";
  const displayVideoSrc = tempPreviewUrl || src;
  const displayVideoThumbnail = isVideoCell ? getVideoThumbnail(displayVideoSrc) : "";
  const promptContext = useMemo(
    () =>
      isVideoCell && row && column
        ? buildVideoPromptContext(row, column, columns, detail as Record<string, unknown> | null)
        : { prompt: defaultPrompt ?? "", referenceFields: [] as string[], videoPromptColumnId: "" },
    [column, columns, defaultPrompt, detail, isVideoCell, row]
  );
  const defaultReferenceImagePath = useMemo(() => {
    if (!isVideoCell) return defaultReferenceImage ?? "";
    const imageCell = row?.shotValues?.find((item) => item.presetColumnKey === "image_path");
    return getPreferredFileSource(imageCell) || defaultReferenceImage || "";
  }, [defaultReferenceImage, isVideoCell, row]);

  const stopAudioPlayback = useCallback(() => {
    if (audioProgressRafRef.current) {
      window.cancelAnimationFrame(audioProgressRafRef.current);
      audioProgressRafRef.current = null;
    }
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }
    setIsAudioPlaying(false);
    setAudioPlayProgress(0);
  }, []);

  const updateAudioProgress = useCallback(() => {
    const instance = audioRef.current;
    if (!instance) return;

    const duration = instance.duration || 1;
    setAudioPlayProgress(instance.currentTime / duration);
    audioProgressRafRef.current = window.requestAnimationFrame(updateAudioProgress);
  }, []);

  useEffect(() => {
    if (tempPreviewUrl && tempPreviewUrl.startsWith("blob:") && src && src !== tempPreviewUrl) {
      URL.revokeObjectURL(tempPreviewUrl);
      setTempPreviewUrl("");
    }
  }, [src, tempPreviewUrl]);

  useEffect(() => {
    if (!isAudioCell) return undefined;
    stopAudioPlayback();
    return undefined;
  }, [isAudioCell, src, stopAudioPlayback]);

  useEffect(() => {
    return () => {
      if (tempPreviewUrl && tempPreviewUrl.startsWith("blob:")) {
        URL.revokeObjectURL(tempPreviewUrl);
      }
      stopAudioPlayback();
      if (doneTimerRef.current) {
        window.clearTimeout(doneTimerRef.current);
      }
    };
  }, [stopAudioPlayback, tempPreviewUrl]);

  const updateFilesState = useCallback(
    (nextFiles: MediaFile[], nextCellId?: string) => {
      const primaryPath = getPrimaryMediaPath(nextFiles);
      const currentRows = selectCurrentInstance(store.getState()).rows;
      store.dispatch(
        setRows(
          upsertShotCell(currentRows, shotId, shotColumnId, {
            id: nextCellId ?? cell?.id,
            files: nextFiles,
            values: nextFiles.map((file) => file.path).filter(Boolean),
            value: primaryPath,
          })
        )
      );
    },
    [cell?.id, shotColumnId, shotId]
  );

  const persistMediaPaths = useCallback(
    async (nextPaths: string[]) => {
      const previousFiles = files.map((file) => ({ ...file }));
      const previousCellId = cell?.id;
      const uniquePaths = Array.from(new Set(nextPaths.filter(Boolean)));
      const hasExistingPreferred =
        preferredPath &&
        uniquePaths.includes(preferredPath) &&
        files.some((file) => file.path === preferredPath && file.preferred);
      const effectivePreferredPath = hasExistingPreferred ? preferredPath : "";
      const nextFiles = uniquePaths.map((nextPath) => {
        const existing = files.find((file) => file.path === nextPath);
        return {
          ...(existing ?? { path: nextPath }),
          path: nextPath,
          preferred: effectivePreferredPath ? nextPath === effectivePreferredPath : false,
        };
      });

      updateFilesState(nextFiles);

      try {
        const result = await backendApi.post("/api/user/shotValue/input", {
          data: { shotId, shotColumnId, value: "", values: uniquePaths },
        });
        const nextId = resolveShotValueId(result);
        updateFilesState(nextFiles, nextId || undefined);
      } catch (error) {
        console.error("[MediaCell] 保存素材失败:", error);
        updateFilesState(previousFiles, previousCellId);
        toast.error(tc("saveFailed"));
      }
    },
    [cell?.id, files, preferredPath, shotColumnId, shotId, updateFilesState]
  );

  const handleSelect = (paths: string[]) => {
    if (isVideoCell) {
      setTempPreviewUrl("");
      void persistMediaPaths(paths);
      return;
    }

    void persistValueList(shotId, shotColumnId, paths, {
      files: paths.map((selectedPath) => ({ path: selectedPath })),
    });
  };

  const handleCollect = useCallback(
    (item: { storagePath?: string }) => {
      const nextPath = item.storagePath ?? "";
      if (!nextPath) return;

      const nextPaths = appliedPaths.includes(nextPath)
        ? appliedPaths.filter((pathItem) => pathItem !== nextPath)
        : [...appliedPaths, nextPath];

      if (isVideoCell) {
        void persistMediaPaths(nextPaths);
        return;
      }

      void persistValueList(shotId, shotColumnId, nextPaths, {
        files: nextPaths.map((selectedPath) => ({ path: selectedPath })),
      });
    },
    [appliedPaths, isVideoCell, persistMediaPaths, shotColumnId, shotId]
  );

  const handleManagerAdd = useCallback(
    async (paths: string[]) => {
      const nextPaths = [...appliedPaths];
      for (const itemPath of paths) {
        if (!nextPaths.includes(itemPath)) {
          nextPaths.push(itemPath);
        }
      }
      await persistMediaPaths(nextPaths);
    },
    [appliedPaths, persistMediaPaths]
  );

  const handleDeletePath = useCallback(
    (targetPath: string) => {
      const nextPaths = appliedPaths.filter((itemPath) => itemPath !== targetPath);
      if (displayVideoSrc === ossUrl(targetPath)) {
        setTempPreviewUrl("");
      }
      void persistMediaPaths(nextPaths);
      if (nextPaths.length === 0) {
        setManagerOpen(false);
      }
    },
    [appliedPaths, displayVideoSrc, persistMediaPaths]
  );

  const handleSetPreferred = useCallback(
    async (item: { storagePath?: string; path?: string }) => {
      const targetPath = item.storagePath ?? item.path ?? "";
      if (!targetPath) return;

      const existingPaths = files.map((file) => file.path ?? "").filter(Boolean);
      if (!existingPaths.includes(targetPath)) {
        await persistMediaPaths([...existingPaths, targetPath]);
      }

      const latestRows = selectCurrentInstance(store.getState()).rows;
      const latestRow = latestRows.find((itemRow) => itemRow.shotId === shotId);
      const latestCell = latestRow?.shotValues?.find(
        (value) => value.shotColumnId === shotColumnId
      );
      const previousFiles = ((latestCell?.files as MediaFile[] | undefined) ?? files).map(
        (file) => ({
          ...file,
        })
      );
      if (!previousFiles.some((file) => file.path === targetPath)) {
        toast.error("素材加入管理失败");
        return;
      }
      const cellId = typeof latestCell?.id === "string" ? latestCell.id : cell?.id;
      if (!cellId) return;

      try {
        await backendApi.post(`/api/user/shotValue/preferred/${String(cellId)}`, {
          data: { value: targetPath, preferred: true },
        });
        const nextFiles = previousFiles.map((file) => ({
          ...file,
          preferred: file.path === targetPath,
        }));
        updateFilesState(nextFiles, typeof latestCell?.id === "string" ? latestCell.id : undefined);
      } catch (error) {
        console.error("[MediaCell] 设置定稿失败:", error);
        toast.error("设置定稿失败");
      }
    },
    [cell?.id, files, persistMediaPaths, shotColumnId, shotId, updateFilesState]
  );

  const handleUnsetPreferred = useCallback(
    async (path: string) => {
      const targetPath = path.trim();
      if (!targetPath) return;

      const latestRows = selectCurrentInstance(store.getState()).rows;
      const latestRow = latestRows.find((itemRow) => itemRow.shotId === shotId);
      const latestCell = latestRow?.shotValues?.find(
        (value) => value.shotColumnId === shotColumnId
      );
      const previousFiles = ((latestCell?.files as MediaFile[] | undefined) ?? files).map(
        (file) => ({
          ...file,
        })
      );
      const cellId = typeof latestCell?.id === "string" ? latestCell.id : cell?.id;
      if (!cellId) return;

      try {
        await backendApi.post(`/api/user/shotValue/preferred/${String(cellId)}`, {
          data: { value: targetPath, preferred: false },
        });
        const nextFiles = previousFiles.map((file) => ({
          ...file,
          preferred: false,
        }));
        updateFilesState(nextFiles, typeof latestCell?.id === "string" ? latestCell.id : undefined);
      } catch (error) {
        console.error("[MediaCell] 取消定稿失败:", error);
        toast.error("取消定稿失败");
      }
    },
    [cell?.id, files, shotColumnId, shotId, updateFilesState]
  );

  const handlePromptSave = useCallback(
    async (fileId: string, promptValue: string) => {
      await backendApi.post(`/api/user/file/updatePrompt/${fileId}`, {
        data: { prompt: promptValue },
      });
      updateFilesState(
        files.map((file) =>
          String(file.id ?? "") === String(fileId) ? { ...file, prompt: promptValue } : file
        )
      );
    },
    [files, updateFilesState]
  );

  const handleGeneratePrompt = useCallback(
    (promptValue: string) => {
      const videoPromptColumnId = promptContext.videoPromptColumnId;
      if (!videoPromptColumnId || !promptValue.trim()) return;
      void persistTextCell(shotId, videoPromptColumnId, promptValue.trim(), { richText: true });
    },
    [promptContext.videoPromptColumnId, shotId]
  );

  const handleUploadFile = useCallback(
    async (file: File) => {
      const acceptedAudioMimeTypes = new Set(["audio/mpeg", "audio/wav", "audio/x-wav"]);
      const extension = `.${String(file.name.split(".").pop() ?? "").toLowerCase()}`;
      const isAcceptedAudioFile =
        acceptedAudioMimeTypes.has(file.type) || [".mp3", ".wav"].includes(extension);

      if (isVideoCell && !file.type.startsWith("video/")) {
        toast.error("请上传视频文件");
        return;
      }

      if (isAudioCell && !isAcceptedAudioFile) {
        toast.error("请上传 mp3 或 wav 音频文件");
        return;
      }

      const localPreviewUrl = isVideoCell ? URL.createObjectURL(file) : "";
      if (localPreviewUrl) {
        setTempPreviewUrl(localPreviewUrl);
      }
      setUploading(true);

      try {
        const uploaded = await uploadWorkspaceFile(file, {
          uploadType: isAudioCell ? "SHOT_VALUE_AUDIO" : "SHOT_VALUE_VIDEO",
          sourceType: "LOCAL",
          accept: isAudioCell ? "audio/*" : "video/*",
        });
        const storagePath = uploaded.path;

        if (localPreviewUrl) {
          URL.revokeObjectURL(localPreviewUrl);
          setTempPreviewUrl(ossUrl(storagePath));
        }

        if (isVideoCell) {
          await persistMediaPaths([storagePath]);
        } else {
          await persistValueList(shotId, shotColumnId, [storagePath], {
            files: [{ path: storagePath, preferred: true }],
          });
        }
      } catch (error) {
        console.error(`[MediaCell] 上传${isAudioCell ? "音频" : "视频"}失败:`, error);
        toast.error(tc("uploadFailed"));
        if (localPreviewUrl) {
          URL.revokeObjectURL(localPreviewUrl);
          setTempPreviewUrl("");
        }
      } finally {
        setUploading(false);
      }
    },
    [isAudioCell, isVideoCell, persistMediaPaths, shotColumnId, shotId]
  );

  const handleAudioUpload = useCallback(() => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".mp3,.wav,audio/mpeg,audio/wav,audio/x-wav";
    input.onchange = (event) => {
      const target = event.target as HTMLInputElement | null;
      const file = target?.files?.[0];
      if (file) {
        void handleUploadFile(file);
      }
    };
    input.click();
  }, [handleUploadFile]);

  const handleToggleAudioPlay = useCallback(() => {
    if (!src) return;
    if (isAudioPlaying) {
      stopAudioPlayback();
      return;
    }

    stopAudioPlayback();
    const audio = new Audio(src);
    audioRef.current = audio;
    audio.addEventListener("ended", stopAudioPlayback);
    audio.addEventListener("error", stopAudioPlayback);
    void audio
      .play()
      .then(() => {
        setIsAudioPlaying(true);
        updateAudioProgress();
      })
      .catch(() => {
        stopAudioPlayback();
      });
  }, [isAudioPlaying, src, stopAudioPlayback, updateAudioProgress]);

  const handleSelectGeneratedAudio = useCallback(
    async (selectedPath: string) => {
      await persistValueList(shotId, shotColumnId, [selectedPath], {
        files: [{ path: selectedPath, preferred: true }],
      });
    },
    [shotColumnId, shotId]
  );

  const handleSelectGeneratedAudios = useCallback(
    async (selectedPaths: string[]) => {
      const normalized = selectedPaths.map((item) => item.trim()).filter(Boolean);
      if (normalized.length === 0) return;
      await persistValueList(shotId, shotColumnId, normalized, {
        files: normalized.map((item, index) => ({ path: item, preferred: index === 0 })),
      });
    },
    [shotColumnId, shotId]
  );

  const handleAiGenerate = () => {
    if (type === "audio") {
      setShowGenerateDone(false);
      if (isBatchCompletedCell) {
        store.dispatch(clearSingleBatchCompleted({ shotId: shotId, columnId: shotColumnId }));
      }
      setAiOpen(true);
      return;
    }
    if (type === "video") {
      setShowGenerateDone(false);
      if (isBatchCompletedCell) {
        store.dispatch(clearSingleBatchCompleted({ shotId: shotId, columnId: shotColumnId }));
      }
      setAiOpen(true);
      return;
    }
    if (type === "lip_sync") {
      setShowGenerateDone(false);
      setAiOpen(true);
      return;
    }
  };

  const aiButtonIcon =
    isAiGenerating || isBatchGeneratingCell ? (
      <IconLoader2 className="size-3.5 animate-spin" />
    ) : showGenerateDone || isBatchCompletedCell ? (
      <IconCircleCheck className="size-3.5 text-green-500" />
    ) : (
      <IconSparkles className="size-3.5" />
    );

  return (
    <>
      <div
        className={cn(
          "group relative flex h-full w-full items-center justify-center overflow-hidden rounded-md",
          isDraggableCell && isDragOver && "border-2 border-dashed border-primary bg-primary/10"
        )}
        onDragEnter={(event) => {
          if (!isDraggableCell) return;
          event.preventDefault();
          dragCounterRef.current += 1;
          setIsDragOver(true);
        }}
        onDragOver={(event) => {
          if (!isDraggableCell) return;
          event.preventDefault();
        }}
        onDragLeave={() => {
          if (!isDraggableCell) return;
          dragCounterRef.current = Math.max(0, dragCounterRef.current - 1);
          if (dragCounterRef.current === 0) {
            setIsDragOver(false);
          }
        }}
        onDrop={(event) => {
          if (!isDraggableCell) return;
          event.preventDefault();
          dragCounterRef.current = 0;
          setIsDragOver(false);
          const file = event.dataTransfer?.files?.[0];
          if (file) {
            void handleUploadFile(file);
          }
        }}
        onMouseEnter={() => setIsHovering(true)}
        onMouseLeave={() => setIsHovering(false)}
      >
        {type === "audio" ? (
          uploading ? (
            <div className="flex h-full w-full items-center justify-center px-4 py-3">
              <div className="flex w-full items-center gap-3 rounded-lg bg-white/[0.03] px-4 py-3">
                <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-white/5 text-white/70">
                  <IconMusic className="size-5" />
                </div>
                <div className="min-w-0 flex-1">
                  <AudioWaveformBars loading />
                </div>
                <IconLoader2 className="size-4 animate-spin text-white/70" />
              </div>
            </div>
          ) : isDragOver && !src ? (
            <div className="flex h-full w-full items-center justify-center text-center text-xs text-primary">
              拖拽音频到这里
            </div>
          ) : (
            <div
              className={cn(
                "flex h-full w-full items-center gap-3 px-4 py-3",
                !src && "justify-center"
              )}
            >
              {src ? (
                <>
                  <div className="min-w-0 flex-1">
                    <AudioWaveformBars
                      audioKey={path}
                      progress={isAudioPlaying ? audioPlayProgress : 0}
                    />
                    <div
                      className={cn(
                        "mt-2 flex gap-2 transition-all",
                        "overflow-hidden",
                        isHovering || isAiGenerating ? "max-h-12 opacity-100" : "max-h-0 opacity-0"
                      )}
                    >
                      <Button
                        size="sm"
                        variant="soft"
                        color="muted"
                        disabled={isBatchGeneratingCell}
                        onClick={handleAudioUpload}
                      >
                        上传音频
                      </Button>
                      <Button
                        size="sm"
                        variant="soft"
                        color="muted"
                        disabled={isBatchGeneratingCell}
                        onClick={handleAiGenerate}
                      >
                        {aiButtonIcon}
                        AI 生成
                      </Button>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={handleToggleAudioPlay}
                    className="flex size-10 shrink-0 items-center justify-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/20"
                  >
                    {isAudioPlaying ? (
                      <IconPlayerPause className="size-4" />
                    ) : (
                      <IconPlayerPlay className="ml-0.5 size-4" />
                    )}
                  </button>
                </>
              ) : isBatchGeneratingCell ? (
                <div className="flex h-full w-full flex-col items-center justify-center gap-2 text-center">
                  <IconLoader2 className="size-5 animate-spin text-white/75" />
                  <span className="text-[11px] font-medium text-white/80">批量生成中...</span>
                </div>
              ) : (
                <div className="flex w-fit flex-col items-stretch justify-center gap-3">
                  <Button size="sm" variant="soft" color="muted" onClick={handleAudioUpload}>
                    上传音频
                  </Button>
                  <Button size="sm" variant="soft" color="muted" onClick={handleAiGenerate}>
                    {aiButtonIcon}
                    AI 生成
                  </Button>
                </div>
              )}
            </div>
          )
        ) : isVideoCell ? (
          displayVideoSrc ? (
            <div className="relative h-full w-full p-4">
              <div className="relative h-full w-full overflow-hidden rounded-md bg-black">
                {displayVideoThumbnail && !displayVideoSrc.startsWith("blob:") ? (
                  <img src={displayVideoThumbnail} alt="" className="h-full w-full object-cover" />
                ) : (
                  <video
                    src={displayVideoSrc}
                    className="h-full w-full object-cover"
                    muted
                    playsInline
                    preload="metadata"
                  />
                )}
                <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                  <div className="flex size-10 items-center justify-center rounded-full bg-black/55 text-white">
                    <IconPlayerPlay className="ml-0.5 size-5" />
                  </div>
                </div>
                {!isBatchGeneratingCell ? (
                  <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 rounded-md bg-black/60 opacity-0 transition-opacity group-hover:opacity-100">
                    <Button
                      size="sm"
                      variant="soft"
                      color="muted"
                      onClick={() => setManagerOpen(true)}
                    >
                      视频管理
                    </Button>
                    <Button size="sm" variant="soft" color="muted" onClick={handleAiGenerate}>
                      {aiButtonIcon}
                      {t("aiVideo")}
                    </Button>
                  </div>
                ) : (
                  <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 rounded-md bg-black/55">
                    <IconLoader2 className="size-5 animate-spin text-white/75" />
                    <span className="text-[11px] font-medium text-white/80">批量生成中...</span>
                  </div>
                )}
              </div>
            </div>
          ) : isDragOver ? (
            <div className="flex h-full w-full items-center justify-center text-center text-xs text-primary">
              拖拽视频到这里
            </div>
          ) : isBatchGeneratingCell ? (
            <div className="flex h-full w-full flex-col items-center justify-center gap-2 text-center">
              <IconLoader2 className="size-5 animate-spin text-white/75" />
              <span className="text-[11px] font-medium text-white/80">批量生成中...</span>
            </div>
          ) : (
            <div className="flex h-full w-fit flex-col items-stretch justify-center gap-3">
              <Button size="sm" variant="soft" color="muted" onClick={() => setPickerOpen(true)}>
                选择视频
              </Button>
              <Button size="sm" variant="soft" color="muted" onClick={handleAiGenerate}>
                {aiButtonIcon}
                AI 生视频
              </Button>
            </div>
          )
        ) : src ? (
          <button type="button" onClick={() => setPreviewOpen(true)} className="h-full w-full">
            <video src={src} className="h-full w-full object-cover" muted preload="metadata" />
          </button>
        ) : (
          <div className="flex flex-col items-center gap-2 text-muted-foreground/40">
            {type === "lip_sync" ? (
              <IconMask className="size-6" />
            ) : (
              <IconVideo className="size-6" />
            )}
            <span className="text-[11px]">{type === "lip_sync" ? "对口型视频" : "视频素材"}</span>
          </div>
        )}

        {!isVideoCell && !isAudioCell ? (
          <div className="absolute inset-0 flex items-end justify-center gap-2 bg-gradient-to-t from-black/70 via-black/20 to-transparent p-3 opacity-0 transition-opacity group-hover:opacity-100">
            {src ? (
              <Button size="sm" variant="soft" color="muted" onClick={() => setPreviewOpen(true)}>
                <IconPlayerPlay className="size-3.5" />
                {tc("preview")}
              </Button>
            ) : null}
            <Button size="sm" onClick={() => setPickerOpen(true)}>
              <IconVideo className="size-3.5" />
              素材
            </Button>
            <Button size="sm" variant="soft" color="muted" onClick={handleAiGenerate}>
              <IconSparkles className="size-3.5" />
              {type === "lip_sync" ? t("aiLipSync") : "AI"}
            </Button>
          </div>
        ) : null}

        {isVideoCell && (uploading || (isAiGenerating && !isHovering)) ? (
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-2 rounded-md bg-black/35">
            <IconLoader2 className="size-4 animate-spin text-white/90" />
            {isAiGenerating ? (
              <span className="text-[10px] font-medium text-primary">Generating...</span>
            ) : null}
          </div>
        ) : null}
      </div>

      <AssetPickerDialog
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        assetType={assetType}
        onSelect={handleSelect}
      />

      {isVideoCell ? (
        <VideoManagerDialog
          open={managerOpen}
          onOpenChange={setManagerOpen}
          projectId={String(detail?.id ?? "")}
          files={files}
          preferredPath={preferredPath}
          onUploaded={(path) => handleManagerAdd([path])}
          onDeletePath={handleDeletePath}
          onSetPreferred={(selectedPath) => handleSetPreferred({ path: selectedPath })}
          onUnsetPreferred={(selectedPath) => handleUnsetPreferred(selectedPath)}
          onPromptSave={handlePromptSave}
        />
      ) : null}

      <MediaPreviewModal
        open={previewOpen}
        onOpenChange={setPreviewOpen}
        type={type === "audio" ? "audio" : "video"}
        src={src}
        name={type === "audio" ? "音频预览" : "视频预览"}
        link={src}
      />

      {type === "audio" && isVoiceAudioCell ? (
        <AiAudioGeneratorDialog
          open={aiOpen}
          onOpenChange={setAiOpen}
          shotId={shotId}
          shotColumnId={shotColumnId}
          row={row}
          worldId={worldId ?? ""}
          currentAudioPath={path}
          onSelectPath={handleSelectGeneratedAudio}
          onGeneratingChange={setIsAiGenerating}
          onGenerateSuccess={() => {
            setShowGenerateDone(true);
            if (doneTimerRef.current) {
              window.clearTimeout(doneTimerRef.current);
            }
            doneTimerRef.current = window.setTimeout(() => {
              setShowGenerateDone(false);
              doneTimerRef.current = null;
            }, 2200);
          }}
        />
      ) : type === "audio" && isMusicAudioCell ? (
        <AiBasicAudioGeneratorDialog
          open={aiOpen}
          onOpenChange={setAiOpen}
          shotId={shotId}
          shotColumnId={shotColumnId}
          defaultPrompt={getDialogueTextFromShotValues(row?.shotValues ?? [])}
          currentAudioPath={path}
          onSelectPaths={handleSelectGeneratedAudios}
          onGeneratingChange={setIsAiGenerating}
          onGenerateSuccess={() => {
            setShowGenerateDone(true);
            if (doneTimerRef.current) {
              window.clearTimeout(doneTimerRef.current);
            }
            doneTimerRef.current = window.setTimeout(() => {
              setShowGenerateDone(false);
              doneTimerRef.current = null;
            }, 2200);
          }}
        />
      ) : null}

      {isVideoCell ? (
        <AiVideoGeneratorDialog
          open={aiOpen}
          onOpenChange={setAiOpen}
          shotId={shotId}
          shotColumnId={shotColumnId}
          defaultPrompt={promptContext.prompt}
          defaultReferenceImage={defaultReferenceImagePath}
          referenceFields={promptContext.referenceFields}
          appliedPaths={appliedPaths}
          preferredPath={preferredPath}
          onCollect={handleCollect}
          onSetPreferred={handleSetPreferred}
          onGeneratePrompt={handleGeneratePrompt}
          onGeneratingChange={setIsAiGenerating}
          onGenerateSuccess={() => {
            setShowGenerateDone(true);
            if (doneTimerRef.current) {
              window.clearTimeout(doneTimerRef.current);
            }
            doneTimerRef.current = window.setTimeout(() => {
              setShowGenerateDone(false);
              doneTimerRef.current = null;
            }, 2200);
          }}
        />
      ) : null}

      {type === "lip_sync" ? (
        <AiLipSyncGeneratorDialog
          open={aiOpen}
          onOpenChange={setAiOpen}
          shotId={shotId}
          shotColumnId={shotColumnId}
          row={row}
          worldId={worldId ?? ""}
          defaultReferenceVideo={
            row?.shotValues?.find((item) => item.presetColumnKey === "video_path")
              ? getPreferredFileSource(
                  row?.shotValues?.find((item) => item.presetColumnKey === "video_path")
                )
              : undefined
          }
          defaultReferenceAudio={
            row?.shotValues?.find((item) => item.presetColumnKey === "sound_path")
              ? getPreferredFileSource(
                  row?.shotValues?.find((item) => item.presetColumnKey === "sound_path")
                )
              : undefined
          }
          appliedPaths={appliedPaths}
          preferredPath={preferredPath}
          onCollect={handleCollect}
          onSetPreferred={handleSetPreferred}
          onGeneratingChange={setIsAiGenerating}
          onGenerateSuccess={() => {
            setShowGenerateDone(true);
            if (doneTimerRef.current) {
              window.clearTimeout(doneTimerRef.current);
            }
            doneTimerRef.current = window.setTimeout(() => {
              setShowGenerateDone(false);
              doneTimerRef.current = null;
            }, 2200);
          }}
        />
      ) : null}
    </>
  );
}
