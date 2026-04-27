"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import {
  IconGripVertical,
  IconLoader2,
  IconPencil,
  IconRowInsertBottom,
  IconRowInsertTop,
  IconTrash,
} from "@tabler/icons-react";
import { DragDropProvider } from "@dnd-kit/react";
import { useSortable } from "@dnd-kit/react/sortable";
import {
  StoryboardCardImageActions,
  StoryboardCardVideoActions,
} from "@/app/projects/_components/storyboard-card-action-row";
import { CardImageSlot, CardVideoSlot } from "@/app/projects/_components/storyboard-card-slots";
import { StoryboardCardFieldDialog } from "@/app/projects/_components/storyboard-card-field-dialog";
import { SelectInlineField } from "@/app/projects/_components/storyboard-card-select-field";
import {
  buildMentionItems,
  renderMentionPreviewHtml,
} from "@/app/projects/_components/storyboard/cells";
import { persistValueList } from "@/app/projects/_components/storyboard/cells/cell-utils";
import { WorldAssetSelectDialog } from "@/app/projects/_components/storyboard/dialogs/world-asset-select-dialog";
import { useShotRowActions } from "@/app/projects/_components/storyboard/use-shot-row-actions";
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
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { Asset } from "@/src/store/slices/projectSlice";
import { useTranslations } from "@/src/i18n/i18n";
import { fetchProjectDictionaries } from "@/src/lib/project-dictionaries";
import { useAppSelector } from "@/src/store";
import {
  selectCurrentInstance,
  type ShotColumn,
  type ShotRow,
  type ShotValue,
} from "@/src/store/slices/projectSlice";

function arrayMove<T>(arr: T[], from: number, to: number): T[] {
  const next = [...arr];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

// Map of styleId → styleName for the project-level 画风 dictionary. Used
// as a fallback when a select column stores an id that isn't resolvable
// against its own columnOptions.
type StyleDict = Record<string, string>;

/**
 * Per-row card layout — parallel to the virtualized table view. Each card
 * is one shot rendered as:
 *
 *   [分镜图]  [分镜视频]  [其他信息 — all remaining columns flattened]
 *
 * Data shape is identical to the table view (ShotRow + ShotValue +
 * ShotColumn); difference is purely layout. Image / video / lipsync /
 * audio columns reuse the same cell components as the table so
 * interactions (upload, open, generate) stay consistent. Everything
 * else is flattened into a compact "label: value" list.
 */
export function StoryboardCardView({
  onReorder,
}: {
  onReorder?: (reordered: ShotRow[], movedShotId: string) => void;
}) {
  const t = useTranslations("storyboard");
  const columns = useAppSelector((s) => selectCurrentInstance(s).columns);
  const rows = useAppSelector((s) => selectCurrentInstance(s).rows);
  // Drag refs — same pattern as the table view; storing in refs avoids
  // re-rendering all cards on every pointer move.
  const pendingReorderRef = useRef<ShotRow[] | null>(null);
  const movedShotIdRef = useRef<string | null>(null);

  const handleDragOver = useCallback(
    (event: unknown) => {
      const op = (
        event as {
          operation?: { source?: { id: string | number }; target?: { id: string | number } };
        }
      ).operation;
      const source = op?.source;
      const target = op?.target;
      if (!source || !target || source.id === target.id) return;

      const currentList = pendingReorderRef.current ?? rows;
      const fromIndex = currentList.findIndex((r) => String(r.shotId ?? "") === String(source.id));
      const toIndex = currentList.findIndex((r) => String(r.shotId ?? "") === String(target.id));
      if (fromIndex === -1 || toIndex === -1 || fromIndex === toIndex) return;

      pendingReorderRef.current = arrayMove(currentList, fromIndex, toIndex);
      movedShotIdRef.current = String(source.id);
    },
    [rows]
  );

  const handleDragEnd = useCallback(() => {
    const reordered = pendingReorderRef.current;
    const movedShotId = movedShotIdRef.current;
    pendingReorderRef.current = null;
    movedShotIdRef.current = null;
    if (reordered && movedShotId && onReorder) {
      onReorder(reordered, movedShotId);
    }
  }, [onReorder]);
  const characters = useAppSelector((s) => selectCurrentInstance(s).characters);
  const scenes = useAppSelector((s) => selectCurrentInstance(s).scenes);
  const props = useAppSelector((s) => selectCurrentInstance(s).props);

  const mentionItems = buildMentionItems(characters, scenes, props);

  const [styleDict, setStyleDict] = useState<StyleDict>({});
  useEffect(() => {
    let active = true;
    fetchProjectDictionaries()
      .then((data) => {
        if (!active) return;
        const dict: StyleDict = {};
        for (const opt of data.styleOptions) {
          if (opt.id) dict[String(opt.id)] = String(opt.info ?? "");
        }
        setStyleDict(dict);
      })
      .catch(() => {
        // Soft-fail: card view will show raw ids for 画风 cells, same as
        // the table view does for any other unresolvable select.
      });
    return () => {
      active = false;
    };
  }, []);

  const visibleColumns = columns
    .filter((column) => !column.hide)
    .sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0));

  // Partition columns into the three slots. Image / video get their own
  // slots; text-ish columns merge into "其他信息". Media types we can't
  // show meaningfully inline (lip_sync / sound / music) and shot_no
  // (already carried in the card title) are filtered out — users edit
  // them in list view.
  const imageColumn = visibleColumns.find((c) => c.resolvedType === "image");
  const videoColumn = visibleColumns.find((c) => c.resolvedType === "video");
  const otherColumns = visibleColumns.filter((c) => {
    const type = c.resolvedType;
    return (
      type !== "image" &&
      type !== "video" &&
      type !== "shot_no" &&
      type !== "lip_sync" &&
      type !== "sound_path" &&
      type !== "music"
    );
  });

  if (rows.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <p className="text-sm text-muted-foreground">{t("noShotsData")}</p>
      </div>
    );
  }

  return (
    <DragDropProvider onDragOver={handleDragOver} onDragEnd={handleDragEnd}>
      <div className="flex-1 overflow-auto">
        <div className="flex flex-col gap-4">
          {rows.map((row, index) => (
            <StoryboardCard
              key={row.shotId ?? index}
              row={row}
              index={index}
              imageColumn={imageColumn}
              videoColumn={videoColumn}
              otherColumns={otherColumns}
              styleDict={styleDict}
              mentionItems={mentionItems}
            />
          ))}
        </div>
      </div>
    </DragDropProvider>
  );
}

function StoryboardCard({
  row,
  index,
  imageColumn,
  videoColumn,
  otherColumns,
  styleDict,
  mentionItems,
}: {
  row: ShotRow;
  index: number;
  imageColumn: ShotColumn | undefined;
  videoColumn: ShotColumn | undefined;
  otherColumns: ShotColumn[];
  styleDict: StyleDict;
  mentionItems: ReturnType<typeof buildMentionItems>;
}) {
  const tc = useTranslations("common");
  const t = useTranslations("storyboard");
  const shotId = String(row.shotId ?? "");
  const title = `Storyboard ${String(index + 1).padStart(2, "0")}`;

  // Which 其他信息 field is open in the edit dialog. Null = no dialog.
  // Only one field edits at a time — dialog closes on outside click /
  // Esc / explicit 关闭 button (all handled by the Dialog primitive).
  const [editingColumnId, setEditingColumnId] = useState<string | null>(null);
  const editingColumn =
    editingColumnId !== null
      ? otherColumns.find((c) => String(c.id ?? "") === editingColumnId)
      : undefined;

  // Per-card actions: insert above / below + delete (shared with the
  // table-view shot-no-cell so both views stay in sync).
  const { insert, remove, inserting } = useShotRowActions(row, index);
  const [deleteOpen, setDeleteOpen] = useState(false);

  // Pending (un-saved) rows can't be reordered server-side — disable
  // sortable for them, just like the table view does.
  const sortableId = shotId || `pending-${index}`;
  const { ref, handleRef, isDragging } = useSortable({
    id: sortableId,
    index,
    disabled: !shotId,
  });

  return (
    <div
      ref={ref}
      data-storyboard-shot-id={shotId}
      className={cn(
        "group relative flex flex-col rounded-lg border border-border/60 bg-muted/40 p-4 transition-shadow",
        isDragging && "z-30 opacity-60 shadow-lg"
      )}
    >
      <div className="mb-3 flex shrink-0 items-center justify-between">
        <div className="flex items-center gap-2">
          {/* Drag handle — hover-only so it doesn't crowd the title at rest. */}
          {shotId ? (
            <div
              ref={handleRef}
              className="cursor-grab touch-none rounded p-0.5 text-muted-foreground/40 opacity-0 transition-opacity hover:text-muted-foreground group-hover:opacity-100 active:cursor-grabbing"
              title="Drag to reorder"
              aria-label="Drag to reorder this shot"
            >
              <IconGripVertical className="size-4" />
            </div>
          ) : null}
          <span className="text-[14px] font-medium text-foreground/90">{title}</span>
        </div>

        {/* Row actions — flat row of three icon buttons. Hover-only so
            they don't crowd the card header at rest. Shares the same
            useShotRowActions hook as the table-view shot-no-cell. */}
        <TooltipProvider delayDuration={200}>
          <div className="flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  color="muted"
                  size="icon-xs"
                  disabled={!!inserting}
                  onClick={() => void insert("before")}
                  aria-label={t("insertAbove")}
                >
                  {inserting === "before" ? (
                    <IconLoader2 className="size-3.5 animate-spin" />
                  ) : (
                    <IconRowInsertTop className="size-3.5" />
                  )}
                </Button>
              </TooltipTrigger>
              <TooltipContent side="top">{t("insertAbove")}</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  color="muted"
                  size="icon-xs"
                  disabled={!!inserting}
                  onClick={() => void insert("after")}
                  aria-label={t("insertBelow")}
                >
                  {inserting === "after" ? (
                    <IconLoader2 className="size-3.5 animate-spin" />
                  ) : (
                    <IconRowInsertBottom className="size-3.5" />
                  )}
                </Button>
              </TooltipTrigger>
              <TooltipContent side="top">{t("insertBelow")}</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  color="destructive"
                  size="icon-xs"
                  disabled={!shotId}
                  onClick={() => setDeleteOpen(true)}
                  aria-label={tc("delete")}
                >
                  <IconTrash className="size-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="top">{tc("delete")}</TooltipContent>
            </Tooltip>
          </div>
        </TooltipProvider>

        <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{tc("confirm")}</AlertDialogTitle>
              <AlertDialogDescription>{t("confirmDeleteShot")}</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>{tc("cancel")}</AlertDialogCancel>
              <AlertDialogAction variant="solid" color="destructive" onClick={() => void remove()}>
                {tc("delete")}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>

      {/* Row height is driven by 分镜图 / 分镜视频 (slot + buttons stacked).
          其他信息 is forced not to push the row taller by absolute-positioning
          its list inside a relative wrapper — the wrapper contributes ~0
          natural height, so the row height = max(media-col, 0) = media-col.
          Change slot / button sizes and the card re-flows automatically. */}
      <div className="grid gap-4 md:grid-cols-[220px_220px_1fr]">
        <CardSlot label="Image">
          {imageColumn ? (
            <>
              <CardImageSlot cell={findCell(row, imageColumn)} />
              <StoryboardCardImageActions
                shotId={shotId}
                shotColumnId={String(imageColumn.id ?? "")}
              />
            </>
          ) : (
            <EmptySlot />
          )}
        </CardSlot>

        <CardSlot label="Video">
          {videoColumn ? (
            <>
              <CardVideoSlot cell={findCell(row, videoColumn)} />
              <StoryboardCardVideoActions
                shotId={shotId}
                shotColumnId={String(videoColumn.id ?? "")}
              />
            </>
          ) : (
            <EmptySlot />
          )}
        </CardSlot>

        <CardSlot label="Other">
          {otherColumns.length > 0 ? (
            <div className="relative flex-1">
              <div className="absolute inset-0 space-y-1 overflow-y-auto pr-1">
                {otherColumns.map((col) => {
                  const cell = findCell(row, col);
                  const key = col.id ?? col.presetColumnKey;
                  const label = getColumnLabel(col);

                  // Scene column: click → WorldAssetSelectDialog directly,
                  // same as clicking the scene cell in the list view.
                  // Skips the generic wrapper dialog.
                  if (col.resolvedType === "scene") {
                    return (
                      <SceneInlineField
                        key={key}
                        label={label}
                        row={row}
                        shotColumnId={String(col.id ?? "")}
                        cell={cell}
                      />
                    );
                  }

                  // Select column: click → inline popover with the option
                  // list; avoids the dialog-inside-dialog stacking the
                  // generic wrapper would create by nesting SelectCell.
                  if (col.resolvedType === "select") {
                    return (
                      <SelectInlineField
                        key={key}
                        label={label}
                        row={row}
                        column={col}
                        cell={cell}
                        resolvedValue={getCellDisplayText(cell, col, styleDict)}
                      />
                    );
                  }

                  // Default path: richtext/dialogue render with mention
                  // pills, everything else as plain text; click opens the
                  // generic field editor dialog.
                  const isRichText =
                    col.resolvedType === "richtext" || col.resolvedType === "dialogue";
                  const rawRichText = cell?.richText?.content ?? cell?.value ?? "";
                  const html =
                    isRichText && rawRichText
                      ? renderMentionPreviewHtml(String(rawRichText))
                      : undefined;
                  return (
                    <InlineField
                      key={key}
                      label={label}
                      value={getCellDisplayText(cell, col, styleDict)}
                      html={html}
                      onClick={() => setEditingColumnId(String(col.id ?? ""))}
                    />
                  );
                })}
              </div>
            </div>
          ) : (
            <EmptySlot />
          )}
        </CardSlot>
      </div>

      <StoryboardCardFieldDialog
        open={!!editingColumn}
        onClose={() => setEditingColumnId(null)}
        row={row}
        column={editingColumn}
        mentionItems={mentionItems}
      />
    </div>
  );
}

// ─── Slot helpers ─────────────────────────────────────────────────────

function CardSlot({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-h-0 flex-col gap-3">
      <div className="shrink-0 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      {children}
    </div>
  );
}

function EmptySlot() {
  return (
    <div className="flex h-[140px] items-center justify-center rounded-md border border-dashed border-border/40 text-xs text-muted-foreground">
      None
    </div>
  );
}

// ─── "其他信息" rendering ────────────────────────────────────────────
//
// Every non-media column is flattened to a single `<label>: <text>` line.
// Mutation is NOT supported here — card view is a read-mostly summary;
// users drop into list view (or click the row's action buttons once wired)
// to edit.

/**
 * Scene-typed 其他信息 row. Mirrors the list-view SceneReferenceCell's
 * click handler: click the line → directly opens the
 * WorldAssetSelectDialog for scenes (no intermediate wrapper dialog).
 * Persist on select goes through the same `persistValueList` path so
 * switching back to list view shows consistent state.
 */
function SceneInlineField({
  label,
  row,
  shotColumnId,
  cell,
}: {
  label: string;
  row: ShotRow;
  shotColumnId: string;
  cell: ShotValue | undefined;
}) {
  const [open, setOpen] = useState(false);
  const scenes = useAppSelector((s) => selectCurrentInstance(s).scenes);
  const selected = (cell?.scenes as Asset[] | undefined)?.[0];
  const selectedId = selected?.id ? String(selected.id) : undefined;
  const shotId = String(row.shotId ?? "");

  const handleConfirm = (item: Asset | null) => {
    const normalized = item ? { ...item } : null;
    void persistValueList(shotId, shotColumnId, normalized?.id ? [String(normalized.id)] : [], {
      scenes: normalized ? [normalized] : [],
    });
    setOpen(false);
  };

  return (
    <>
      <InlineField
        label={label}
        value={String(selected?.name ?? "")}
        onClick={() => setOpen(true)}
      />
      <WorldAssetSelectDialog
        open={open}
        onOpenChange={setOpen}
        title="Select Scene"
        kind="scene"
        items={scenes}
        selectedId={selectedId}
        onConfirm={handleConfirm}
      />
    </>
  );
}

function InlineField({
  label,
  value,
  html,
  onClick,
}: {
  label: string;
  value: string;
  /**
   * Pre-rendered HTML for rich-text / dialogue cells (includes mention
   * pills). Produced upstream by `renderMentionPreviewHtml` which
   * escapes text + whitelists `<mention>` → `<span>` pill markup, so
   * using dangerouslySetInnerHTML here is bounded and safe.
   */
  html?: string;
  onClick?: () => void;
}) {
  const hasValue = Boolean(html) || Boolean(value);
  return (
    <button
      type="button"
      onClick={onClick}
      className="group flex w-full cursor-pointer items-start gap-2 rounded px-1 py-0.5 text-left text-[13px] leading-relaxed transition-colors hover:bg-muted/40"
    >
      <span className="shrink-0 text-muted-foreground">{label}:</span>
      {html ? (
        <span className="flex-1 text-foreground/90" dangerouslySetInnerHTML={{ __html: html }} />
      ) : (
        <span
          className={hasValue ? "flex-1 text-foreground/90" : "flex-1 text-muted-foreground/60"}
        >
          {hasValue ? value : "None"}
        </span>
      )}
      <IconPencil className="mt-0.5 size-3 shrink-0 text-muted-foreground/40 opacity-0 transition-opacity group-hover:opacity-100" />
    </button>
  );
}

function findCell(row: ShotRow, col: ShotColumn): ShotValue | undefined {
  return row.shotValues?.find((value) => value.shotColumnId === col.id);
}

function getColumnLabel(col: ShotColumn): string {
  return col.columnName ?? col.presetColumnKey ?? "—";
}

/**
 * Extract a plain-text representation of a cell regardless of column type:
 *  - richtext / dialogue: strip HTML, collapse whitespace
 *  - character / scene: join names with comma
 *  - select: resolve id → option name when possible
 *  - lip_sync / sound_path / music: "已上传" when any file present, else ""
 *  - shot_no / number / text and everything else: raw value
 */
function getCellDisplayText(
  cell: ShotValue | undefined,
  col: ShotColumn,
  styleDict: StyleDict
): string {
  if (!cell) return "";

  switch (col.resolvedType) {
    case "richtext":
    case "dialogue": {
      const html = cell.richText?.content ?? cell.value ?? "";
      return stripHtml(String(html));
    }
    case "character": {
      return extractNames(cell.characters).join("、");
    }
    case "scene": {
      return extractNames(cell.scenes).join("、");
    }
    case "select": {
      if (!cell.value) return "";
      // Most select cells store the display NAME in cell.value (see
      // SelectCell.persistTextCell). Dictionary-backed columns like 画风
      // are an exception — they store the option id. Lookup order:
      //   1. column's own columnOptions (if backend embedded {id, name})
      //   2. project-level 画风 dictionary (styleDict)
      //   3. raw stored value (last resort)
      const raw = String(cell.value);
      const opts = Array.isArray(col.columnOptions) ? col.columnOptions : [];
      for (const opt of opts) {
        if (!opt || typeof opt !== "object") continue;
        const rec = opt as Record<string, unknown>;
        const optId = rec.id != null ? String(rec.id) : "";
        if (optId && optId === raw) {
          const name = rec.name ?? rec.info;
          if (typeof name === "string" && name) return name;
        }
      }
      if (styleDict[raw]) return styleDict[raw];
      return raw;
    }
    case "lip_sync":
    case "sound_path":
    case "music": {
      const files = cell.files;
      return Array.isArray(files) && files.length > 0 ? "Uploaded" : "";
    }
    default:
      return cell.richText?.content
        ? stripHtml(String(cell.richText.content))
        : String(cell.value ?? "");
  }
}

function stripHtml(input: string): string {
  return input
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractNames(list: unknown): string[] {
  if (!Array.isArray(list)) return [];
  const names: string[] = [];
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const rec = item as Record<string, unknown>;
    const name = rec.name ?? rec.roleName ?? rec.sceneName ?? rec.propName;
    if (typeof name === "string" && name.trim()) names.push(name.trim());
  }
  return names;
}
