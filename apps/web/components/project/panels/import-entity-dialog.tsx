"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import * as XLSX from "xlsx";
import {
  IconDownload,
  IconLoader2,
  IconPlus,
  IconTrash,
  IconUpload,
  IconX,
} from "@tabler/icons-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { batchCreateImportedEntities, formatImportedEntityExcel } from "@/src/lib/import-entity";
import type { ImportEntityType } from "@/src/types/workspace";

type PreviewState = {
  headers: string[];
  rows: string[][];
};

const ENTITY_CONFIG: Record<
  ImportEntityType,
  {
    title: string;
    previewTitle: string;
    emptyText: string;
    templateFileName: string;
    templateRows: string[][];
  }
> = {
  role: {
    title: "",
    previewTitle: "",
    emptyText: "",
    templateFileName: "role_template.xlsx",
    templateRows: [
      ["name", "description", "prompt"],
      ["艾拉", "精灵族弓箭手，性格冷静", "一位身穿绿色斗篷的精灵女弓箭手，银白色长发，蓝色眼睛"],
      ["雷克斯", "人类骑士，正义感强", "一位身穿银色铠甲的人类男骑士，短黑发，棕色眼睛，手持长剑"],
    ],
  },
  scene: {
    title: "",
    previewTitle: "",
    emptyText: "",
    templateFileName: "scene_template.xlsx",
    templateRows: [
      ["name", "description", "prompt"],
      [
        "魔法森林",
        "充满魔法能量的古老森林",
        "一片神秘的古老森林，树木高大茂密，空中飘浮着发光的魔法粒子",
      ],
      ["王城广场", "繁华的城市中心广场", "中世纪风格的城市广场，石板地面，周围有商铺和喷泉"],
    ],
  },
  prop: {
    title: "",
    previewTitle: "",
    emptyText: "",
    templateFileName: "prop_template.xlsx",
    templateRows: [
      ["name", "description", "prompt"],
      ["光之剑", "传说中的圣剑，可释放光芒", "一把发出金色光芒的长剑，剑柄镶嵌蓝色宝石"],
      ["治愈药水", "恢复生命值的魔法药水", "一瓶发着淡绿色光芒的药水，装在透明玻璃瓶中"],
    ],
  },
};

function arrayToPreview(rows: string[][]): PreviewState | null {
  if (!Array.isArray(rows) || rows.length < 2) return null;
  const headers = rows[0]?.map((item) => String(item ?? "")) ?? [];
  const body = rows.slice(1).map((row) => headers.map((_, index) => String(row?.[index] ?? "")));
  return {
    headers,
    rows: body.length > 0 ? body : [headers.map(() => "")],
  };
}

function formatFileSize(size?: number) {
  if (!size) return "";
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

export function ImportEntityDialog({
  open,
  onOpenChange,
  entityType,
  worldId,
  onSuccess,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  entityType: ImportEntityType;
  worldId: string;
  onSuccess?: () => void;
}) {
  const ti = useTranslations("importDialog");
  const tc = useTranslations("common");
  const config = ENTITY_CONFIG[entityType];
  const titleMap: Record<ImportEntityType, string> = {
    role: ti("importCharacter"),
    scene: ti("importScene"),
    prop: ti("importProp"),
  };
  const previewTitleMap: Record<ImportEntityType, string> = {
    role: ti("importCharacterPreview"),
    scene: ti("importScenePreview"),
    prop: ti("importPropPreview"),
  };
  const emptyTextMap: Record<ImportEntityType, string> = {
    role: ti("noCharacterData"),
    scene: ti("noSceneData"),
    prop: ti("noPropData"),
  };
  const localizedTitle = titleMap[entityType];
  const localizedPreviewTitle = previewTitleMap[entityType];
  const localizedEmptyText = emptyTextMap[entityType];
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [importing, setImporting] = useState(false);
  const [preview, setPreview] = useState<PreviewState | null>(null);
  const [applying, setApplying] = useState(false);
  const [editingCell, setEditingCell] = useState<{ rowIndex: number; cellIndex: number } | null>(
    null
  );

  useEffect(() => {
    if (open) return;
    setFile(null);
    setImporting(false);
  }, [open]);

  const closeUploadDialog = () => {
    setFile(null);
    setImporting(false);
    onOpenChange(false);
  };

  const closePreviewDialog = () => {
    setPreview(null);
    setEditingCell(null);
    setApplying(false);
  };

  const handleSelectFile = (nextFile?: File | null) => {
    if (!nextFile) return;
    if (!/\.(xls|xlsx|csv)$/i.test(nextFile.name)) {
      toast.warning(ti("selectFileFormat"));
      return;
    }
    if (nextFile.size > 10 * 1024 * 1024) {
      toast.warning(ti("fileSizeLimit"));
      return;
    }
    setFile(nextFile);
  };

  const handleImport = async () => {
    if (!file) {
      toast.warning(tc("selectFile"));
      return;
    }

    setImporting(true);
    try {
      const formatted = await formatImportedEntityExcel(entityType, file);
      const nextPreview = arrayToPreview(formatted);
      if (!nextPreview) {
        toast.error(tc("parseFailed"));
        return;
      }
      setPreview(nextPreview);
      setEditingCell(null);
      closeUploadDialog();
    } catch (error) {
      console.error("[ImportEntityDialog] AI 导入失败:", error);
      toast.error(error instanceof Error ? error.message : tc("importFailed"));
    } finally {
      setImporting(false);
    }
  };

  const handleApply = async () => {
    if (!preview || !worldId) return;
    setApplying(true);
    try {
      await batchCreateImportedEntities(entityType, {
        worldId,
        datas: [preview.headers, ...preview.rows],
      });
      toast.success(ti("importedCount", { count: preview.rows.length }));
      closePreviewDialog();
      onSuccess?.();
    } catch (error) {
      console.error("[ImportEntityDialog] 批量创建失败:", error);
      toast.error(error instanceof Error ? error.message : tc("importFailed"));
    } finally {
      setApplying(false);
    }
  };

  const previewColumnTemplate = useMemo(
    () => (preview ? `repeat(${preview.headers.length}, minmax(180px, 1fr)) 72px` : undefined),
    [preview]
  );

  return (
    <>
      <Dialog
        open={open}
        onOpenChange={(nextOpen) => (nextOpen ? onOpenChange(true) : closeUploadDialog())}
      >
        <DialogContent showCloseButton={false} className="sm:max-w-[640px]">
          <DialogHeader className="flex-row items-start justify-between gap-4 border-b border-border/70 pb-4">
            <div>
              <DialogTitle>{localizedTitle}</DialogTitle>
              <DialogDescription>{ti("uploadDescription")}</DialogDescription>
            </div>
            <Button variant="ghost" color="muted" size="icon-sm" onClick={closeUploadDialog}>
              <IconX className="size-4" />
            </Button>
          </DialogHeader>

          <div className="space-y-4">
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => {
                event.preventDefault();
                handleSelectFile(event.dataTransfer.files?.[0] ?? null);
              }}
              className="flex h-56 w-full flex-col items-center justify-center rounded-2xl border border-dashed border-border bg-muted/20 text-muted-foreground transition-colors hover:border-primary/50 hover:bg-primary/5 hover:text-foreground"
            >
              <IconUpload className="mb-4 size-10" />
              <div className="text-base font-medium">{ti("clickOrDragUpload")}</div>
              <div className="mt-2 text-sm text-muted-foreground">{ti("fileFormatHint")}</div>
            </button>

            {file ? (
              <div className="flex items-center gap-3 rounded-xl border border-border bg-muted/30 px-4 py-3">
                <div className="flex size-11 items-center justify-center rounded-lg bg-emerald-500 text-xs font-semibold uppercase text-white">
                  {file.name.split(".").pop()?.toLowerCase() || "file"}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{file.name}</div>
                  <div className="text-xs text-muted-foreground">{formatFileSize(file.size)}</div>
                </div>
                <Button variant="ghost" color="muted" size="icon-xs" onClick={() => setFile(null)}>
                  <IconX className="size-3.5" />
                </Button>
              </div>
            ) : null}

            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <div>{ti("templateHint")}</div>
              <Button
                type="button"
                variant="ghost"
                color="muted"
                size="sm"
                onClick={() => {
                  const worksheet = XLSX.utils.aoa_to_sheet(config.templateRows);
                  worksheet["!cols"] = [{ wch: 14 }, { wch: 28 }, { wch: 40 }];
                  const workbook = XLSX.utils.book_new();
                  XLSX.utils.book_append_sheet(workbook, worksheet, "Template");
                  XLSX.writeFile(workbook, config.templateFileName);
                }}
              >
                <IconDownload className="size-3.5" />
                {ti("downloadTemplate")}
              </Button>
            </div>

            <input
              ref={fileRef}
              type="file"
              accept=".xls,.xlsx,.csv"
              className="hidden"
              onChange={(event) => {
                handleSelectFile(event.target.files?.[0] ?? null);
                event.target.value = "";
              }}
            />

            <div className="flex justify-end gap-2 border-t border-border/70 pt-4">
              <Button variant="outline" color="muted" onClick={closeUploadDialog}>
                {tc("cancel")}
              </Button>
              <Button onClick={() => void handleImport()} disabled={!file || importing}>
                {importing ? <IconLoader2 className="size-3.5 animate-spin" /> : null}
                {tc("import")}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(preview)}
        onOpenChange={(nextOpen) => (!nextOpen ? closePreviewDialog() : undefined)}
      >
        <DialogContent showCloseButton={false} className="max-w-[95vw]">
          <DialogHeader className="flex-row items-start justify-between gap-4 border-b border-border/70 pb-4">
            <div>
              <DialogTitle>{localizedPreviewTitle}</DialogTitle>
              <DialogDescription>{ti("previewEditHint")}</DialogDescription>
            </div>
            <Button variant="ghost" color="muted" size="icon-sm" onClick={closePreviewDialog}>
              <IconX className="size-4" />
            </Button>
          </DialogHeader>

          {preview ? (
            <div className="space-y-4">
              <div className="max-h-[68vh] overflow-auto rounded-2xl border border-border">
                <div
                  className="grid min-w-full"
                  style={{ gridTemplateColumns: previewColumnTemplate }}
                >
                  {preview.headers.map((header, index) => (
                    <div
                      key={`header-${header}-${index}`}
                      className="border-b border-r border-border bg-muted/50 px-3 py-2 text-sm font-medium"
                    >
                      {header}
                    </div>
                  ))}
                  <div className="border-b border-border bg-muted/50 px-3 py-2 text-sm font-medium">
                    {ti("actionColumn")}
                  </div>

                  {preview.rows.map((row, rowIndex) => (
                    <PreviewRow
                      key={`row-${rowIndex}`}
                      headers={preview.headers}
                      row={row}
                      rowIndex={rowIndex}
                      editingCell={editingCell}
                      onStartEdit={(cellIndex) => setEditingCell({ rowIndex, cellIndex })}
                      onStopEdit={() => setEditingCell(null)}
                      onChange={(cellIndex, value) =>
                        setPreview((current) =>
                          current
                            ? {
                                ...current,
                                rows: current.rows.map((item, index) =>
                                  index === rowIndex
                                    ? item.map((cell, innerIndex) =>
                                        innerIndex === cellIndex ? value : cell
                                      )
                                    : item
                                ),
                              }
                            : current
                        )
                      }
                      onDelete={() =>
                        setPreview((current) => {
                          if (!current) return current;
                          if (current.rows.length <= 1) {
                            toast.warning(tc("atLeastOne"));
                            return current;
                          }
                          return {
                            ...current,
                            rows: current.rows.filter((_row, index) => index !== rowIndex),
                          };
                        })
                      }
                    />
                  ))}
                </div>
              </div>

              <div className="flex items-center justify-between gap-3">
                <div className="text-sm text-muted-foreground">{localizedEmptyText}</div>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    color="muted"
                    onClick={() =>
                      setPreview((current) =>
                        current
                          ? {
                              ...current,
                              rows: [...current.rows, current.headers.map(() => "")],
                            }
                          : current
                      )
                    }
                  >
                    <IconPlus className="size-3.5" />
                    {ti("addRow")}
                  </Button>
                  <Button variant="outline" color="muted" onClick={closePreviewDialog}>
                    {tc("close")}
                  </Button>
                  <Button onClick={() => void handleApply()} disabled={applying}>
                    {applying ? <IconLoader2 className="size-3.5 animate-spin" /> : null}
                    {ti("apply")}
                  </Button>
                </div>
              </div>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  );
}

function PreviewRow({
  headers,
  row,
  rowIndex,
  editingCell,
  onStartEdit,
  onStopEdit,
  onChange,
  onDelete,
}: {
  headers: string[];
  row: string[];
  rowIndex: number;
  editingCell: { rowIndex: number; cellIndex: number } | null;
  onStartEdit: (cellIndex: number) => void;
  onStopEdit: () => void;
  onChange: (cellIndex: number, value: string) => void;
  onDelete: () => void;
}) {
  return (
    <>
      {headers.map((header, cellIndex) => {
        const isEditing =
          editingCell?.rowIndex === rowIndex && editingCell?.cellIndex === cellIndex;
        return (
          <div
            key={`${header}-${rowIndex}-${cellIndex}`}
            className="border-r border-t border-border p-2"
          >
            {isEditing ? (
              <Textarea
                autoFocus
                value={row[cellIndex] ?? ""}
                onChange={(event) => onChange(cellIndex, event.target.value)}
                onBlur={onStopEdit}
                className="min-h-16 resize-y"
              />
            ) : (
              <button
                type="button"
                onClick={() => onStartEdit(cellIndex)}
                className="flex min-h-16 w-full items-start rounded-lg px-1 py-1 text-left text-sm text-foreground hover:bg-white/5"
              >
                <span className="whitespace-pre-wrap break-words">{row[cellIndex] || "-"}</span>
              </button>
            )}
          </div>
        );
      })}

      <div className="border-t border-border p-2">
        <Button variant="ghost" color="muted" size="icon-xs" onClick={onDelete}>
          <IconTrash className="size-3.5" />
        </Button>
      </div>
    </>
  );
}
