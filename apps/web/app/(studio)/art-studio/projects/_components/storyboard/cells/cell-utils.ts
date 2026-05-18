import { toast } from "sonner";
import type {
  MentionItem,
  MentionType,
} from "@/app/(studio)/art-studio/projects/_components/storyboard/editor/mention-node";
import { backendApi } from "@/src/lib/api";
import { store } from "@/src/store";
import { env } from "@/src/env";
import {
  setRows,
  touchStoryboard,
  selectCurrentInstance,
  type Asset,
  type ShotColumn,
  type ShotRow,
  type ShotValue,
} from "@/src/store/slices/projectSlice";

export const OSS_BASE = env.OSS_BASE_URL;

export function ossUrl(path?: string) {
  if (!path) return "";
  if (path.startsWith("http://") || path.startsWith("https://") || path.startsWith("blob:")) {
    return path;
  }
  return `${OSS_BASE}/${path}`;
}

export function getMentionImageUrl(asset: Asset, mentionType: MentionType) {
  if (mentionType === "character") return asset.roleImgPath?.[0] ?? "";
  if (mentionType === "scene") return asset.sceneImgPath?.[0] ?? "";
  return asset.propImgPath?.[0] ?? "";
}

export function parseOtherImgPath(value: Asset["otherImgPath"]) {
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

export function getAssetStringField(asset: Asset, field: string) {
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

export function escapeHtml(text: string) {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function sanitizeMentionTags(text: string) {
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

export function normalizeRichTextValue(value: string) {
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
    const styles = "bg-primary/10 text-primary";
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

export function getPreferredFilePath(cell?: ShotValue) {
  const files = (cell?.files as Array<{ path?: string; preferred?: boolean }> | undefined) ?? [];
  const preferred = files.find((file) => file.preferred)?.path;
  return preferred ?? files[0]?.path ?? cell?.value ?? "";
}

export function getPreferredFileSource(cell?: ShotValue) {
  const files =
    (cell?.files as Array<{ path?: string; url?: string; preferred?: boolean }> | undefined) ?? [];
  const preferred = files.find((file) => file.preferred) ?? files[0];
  return preferred?.url || preferred?.path || cell?.value || "";
}

export function getVideoThumbnail(path?: string) {
  const fullUrl = ossUrl(path);
  if (!fullUrl || fullUrl.startsWith("blob:")) return fullUrl;
  const separator = fullUrl.includes("?") ? "&" : "?";
  return `${fullUrl}${separator}x-oss-process=video/snapshot,t_0,m_fast`;
}

export function getCellDisplayValue(cell?: ShotValue) {
  return cell?.richText?.content ?? cell?.value ?? "";
}

export function normalizePromptText(text: unknown) {
  if (!text) return "";
  if (typeof text === "object" && text && "value" in text) {
    const nested = (text as { value?: unknown }).value;
    return typeof nested === "string" ? nested : "";
  }
  return typeof text === "string" ? text : "";
}

export function stripNonMentionTags(text: unknown) {
  const value = normalizePromptText(text);
  if (!value) return "";
  return value.replace(/<(?!\/?mention[\s>])[^>]+>/g, "").trim();
}

export function stripAllTags(text: unknown) {
  const value = normalizePromptText(text);
  if (!value) return "";
  return value.replace(/<[^>]+>/g, "").trim();
}

export function getProjectStylePaintingLabel(detail: Record<string, unknown> | null | undefined) {
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

export function getShotPromptContent(
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
    presetKey === "video_prompt" ||
    presetKey === "description" ||
    columnType === "RICH_TEXT" ||
    columnType === "RICHTEXT" ||
    columnType === "RICH_TEXT"
  ) {
    return stripNonMentionTags(cell.richText?.content || cell.value || "");
  }

  return stripAllTags(cell.richText?.content || cell.value || "");
}

export function buildImagePromptContext(
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

export function buildVideoPromptContext(
  row: ShotRow,
  column: ShotColumn,
  columns: ShotColumn[],
  detail?: Record<string, unknown> | null
) {
  const shotValues = row.shotValues ?? [];
  const videoPromptCell = shotValues.find((item) => item.presetColumnKey === "video_prompt");

  // The cell only exists once the user has typed into it once. Schema-
  // wise the column always exists, so fall back to it when we need the
  // id (e.g. to persist the prompt back after a generate click).
  const videoPromptColumnFromSchema = columns.find((c) => c.presetColumnKey === "video_prompt");
  const resolvedVideoPromptColumnId = videoPromptCell?.shotColumnId
    ? String(videoPromptCell.shotColumnId)
    : videoPromptColumnFromSchema?.id
      ? String(videoPromptColumnFromSchema.id)
      : "";

  if (videoPromptCell) {
    const content = getShotPromptContent(videoPromptCell, columns, videoPromptCell.shotColumnId);
    if (content && stripAllTags(content)) {
      return {
        prompt: content,
        referenceFields: [] as string[],
        videoPromptColumnId: resolvedVideoPromptColumnId,
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
      videoPromptColumnId: resolvedVideoPromptColumnId,
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
    videoPromptColumnId: resolvedVideoPromptColumnId,
  };
}

export function parseColumnOptions(column: ShotColumn) {
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

export function upsertShotCell(
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

export function resolveShotValueId(result: unknown) {
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

export async function persistTextCell(
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
    toast.error("Save failed");
    store.dispatch(touchStoryboard());
  }
}

/**
 * Write text into the shot's dialogue cell (the column with
 * `presetColumnKey === "dialogue"`). Used by the AI Voice and AI Lip Sync
 * dialogs to push their narration/prompt textarea content back into the
 * storyboard, so the three surfaces (storyboard cell, voice dialog,
 * lip-sync dialog) stay in sync via Redux + `/api/user/shotValue/input`.
 * No-ops silently when the project has no dialogue column — a plain-value
 * write with a missing column id would 500 on the backend.
 */
export async function persistDialogueText(shotId: string, text: string): Promise<void> {
  const columns = selectCurrentInstance(store.getState()).columns;
  const dialogueColumn = columns.find((c) => c.presetColumnKey === "dialogue");
  if (!dialogueColumn?.id) return;
  await persistTextCell(shotId, String(dialogueColumn.id), text, { richText: true });
}

export async function persistValueList(
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
    toast.error("Save failed");
    store.dispatch(touchStoryboard());
  }
}

export type MediaFile = {
  id?: string;
  path?: string;
  url?: string;
  name?: string;
  preferred?: boolean;
  prompt?: string;
  createTime?: string;
  updateTime?: string;
};

export function getPrimaryMediaPath(files: MediaFile[]) {
  return files.find((file) => file.preferred)?.path ?? files[0]?.path ?? "";
}
