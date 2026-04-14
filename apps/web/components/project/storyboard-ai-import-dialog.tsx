import { useEffect, useMemo, useRef, useState } from "react";
import { IconLoader2, IconPlus, IconTrash, IconUpload, IconX } from "@tabler/icons-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import type { StoryboardImportResult } from "@/src/types/workspace";
import { saveStoryboardTableWithBackfill } from "@/src/lib/storyboard-save";
import { useTranslations } from "@/src/i18n/i18n";
import { useAppSelector, useAppDispatch } from "@/src/store";
import {
  touchStoryboard,
  selectCurrentInstance,
  type ShotColumn,
} from "@/src/store/slices/projectSlice";
import { Field, FieldLabel } from "@/components/ui/field";

type PreviewState = StoryboardImportResult | null;

async function formatStoryboardExcel(file: File): Promise<string[][]> {
  const formData = new FormData();
  formData.append("file", file);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 600_000);
  let response: Response;
  try {
    response = await fetch("/api/ai/chat/format/storyboard/excel", {
      method: "POST",
      credentials: "include",
      body: formData,
      signal: controller.signal,
    });
  } catch (error) {
    const isTimeout = error instanceof DOMException && error.name === "AbortError";
    throw new Error(isTimeout ? "请求超时" : "网络连接失败");
  } finally {
    clearTimeout(timer);
  }
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const body = await response.json();
  const isSuccess = body.success === true || body.code === 200 || body.code === "SUCCESS";
  if (!isSuccess) throw new Error(body.msg || body.message || "请求失败");
  return (body.data ?? null) as string[][];
}

function arrayToPreview(rows: string[][]): PreviewState {
  if (!Array.isArray(rows) || rows.length === 0) return null;
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

export function StoryboardAiImportDialog({
  open,
  onOpenChange,
  storyBoardId,
  columns,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  storyBoardId?: string | null;
  columns: ShotColumn[];
}) {
  const tc = useTranslations("common");
  const ts = useTranslations("storyboard");
  const [file, setFile] = useState<File | null>(null);
  const [importing, setImporting] = useState(false);
  const [applying, setApplying] = useState(false);
  const [preview, setPreview] = useState<PreviewState>(null);
  const [autoload, setAutoload] = useState(true);
  const [editingCell, setEditingCell] = useState<{ rowIndex: number; cellIndex: number } | null>(
    null
  );
  const fileRef = useRef<HTMLInputElement>(null);

  const dispatch = useAppDispatch();
  const worldId = useAppSelector((s) => selectCurrentInstance(s).worldId);
  const detail = useAppSelector((s) => selectCurrentInstance(s).detail);

  useEffect(() => {
    if (open) return;
    setFile(null);
    setImporting(false);
  }, [open]);

  const headerNameMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const column of columns) {
      if (column.presetColumnKey) {
        map.set(
          String(column.presetColumnKey),
          String(column.columnName ?? column.presetColumnKey)
        );
      }
    }
    return map;
  }, [columns]);

  const handleSelectFile = (nextFile?: File | null) => {
    if (!nextFile) return;
    if (!/\.xlsx?$/.test(nextFile.name.toLowerCase())) {
      toast.warning(ts("selectXlsFile"));
      return;
    }
    if (nextFile.size > 10 * 1024 * 1024) {
      toast.warning(ts("fileSizeLimit10"));
      return;
    }
    setFile(nextFile);
  };

  const closeUploadDialog = () => {
    setFile(null);
    setImporting(false);
    onOpenChange(false);
  };

  const closePreviewDialog = () => {
    setPreview(null);
    setEditingCell(null);
    setAutoload(true);
    setApplying(false);
  };

  const handleImport = async () => {
    if (!file) {
      toast.warning(tc("selectFile"));
      return;
    }

    setImporting(true);
    try {
      const formatted = await formatStoryboardExcel(file);
      const nextPreview = arrayToPreview(formatted);
      if (!nextPreview) {
        toast.error(tc("parseFailed"));
        return;
      }
      setEditingCell(null);
      setPreview(nextPreview);
      closeUploadDialog();
    } catch (error) {
      console.error("[StoryboardAiImportDialog] AI 导入失败:", error);
      toast.error(error instanceof Error ? error.message : ts("aiImportFailed"));
    } finally {
      setImporting(false);
    }
  };

  const handleApply = async () => {
    if (!storyBoardId || !preview) return;

    setApplying(true);
    try {
      const result = await saveStoryboardTableWithBackfill({
        episodeId: storyBoardId,
        table: preview,
        worldId,
        stylePaintingName:
          typeof detail?.stylePaintingName === "string" ? detail.stylePaintingName : "",
        autoload,
        replaceExisting: true,
      });
      dispatch(touchStoryboard());
      if (result.warning) {
        toast.warning(result.warning);
      } else {
        toast.success(ts("storyboardUpdated"));
      }
      closePreviewDialog();
    } catch (error) {
      console.error("[StoryboardAiImportDialog] 应用分镜表失败:", error);
      toast.error(error instanceof Error ? error.message : ts("applyStoryboardFailed"));
    } finally {
      setApplying(false);
    }
  };

  return (
    <>
      <Dialog
        open={open}
        onOpenChange={(nextOpen) => (nextOpen ? onOpenChange(true) : closeUploadDialog())}
      >
        <DialogContent className="sm:max-w-[640px]">
          <DialogHeader className="border-b border-border/70 pb-4">
            <DialogTitle>{ts("aiImportTitle")}</DialogTitle>
            <DialogDescription>{ts("aiImportDesc")}</DialogDescription>
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
              <div className="text-base font-medium">{ts("clickOrDragUpload")}</div>
              <div className="mt-2 text-sm text-muted-foreground">{ts("excelSizeHint")}</div>
            </button>

            {file ? (
              <div className="flex items-center gap-3 rounded-xl border border-border bg-muted/30 px-4 py-3">
                <div className="flex size-11 items-center justify-center rounded-lg bg-emerald-500 text-xs font-semibold uppercase text-white">
                  xlsx
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

            <input
              ref={fileRef}
              type="file"
              accept=".xls,.xlsx"
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
        <DialogContent className="max-w-[min(95vw,1200px)]">
          <DialogHeader className="border-b border-border/70 pb-4">
            <DialogTitle>{ts("aiImportPreviewTitle")}</DialogTitle>
            <DialogDescription>{ts("aiImportPreviewDesc")}</DialogDescription>
          </DialogHeader>

          {preview ? (
            <div className="space-y-4">
              <div className="max-h-[68vh] overflow-auto rounded-2xl border border-border">
                <div
                  className="grid"
                  style={{
                    gridTemplateColumns: `repeat(${preview.headers.length}, minmax(100px, 1fr)) 52px`,
                  }}
                >
                  {preview.headers.map((header, index) => (
                    <div
                      key={`header-${header}-${index}`}
                      className="border-b border-r border-border bg-muted/50 px-3 py-2 text-sm font-medium"
                    >
                      {headerNameMap.get(header) ?? header}
                    </div>
                  ))}
                  <div className="border-b border-border bg-muted/50 px-3 py-2 text-sm font-medium">
                    {ts("actionCol")}
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
                            rows: current.rows
                              .filter((_item, index) => index !== rowIndex)
                              .map((item) => [...item]),
                          };
                        })
                      }
                    />
                  ))}
                </div>
              </div>

              <div className="flex items-center justify-between gap-3">
                <Field orientation="horizontal" className="w-auto">
                  <Checkbox
                    checked={autoload}
                    onCheckedChange={(checked) => setAutoload(checked === true)}
                  />
                  <FieldLabel>{ts("autoAssociate")}</FieldLabel>
                </Field>

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
                    {ts("addRow")}
                  </Button>
                  <Button variant="outline" color="muted" onClick={closePreviewDialog}>
                    {tc("close")}
                  </Button>
                  <Button onClick={() => void handleApply()} disabled={applying}>
                    {applying ? <IconLoader2 className="size-3.5 animate-spin" /> : null}
                    {ts("applyToStoryboard")}
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

/** Strip HTML tags for display, keeping mention labels */
function stripTags(html: string): string {
  return html.replace(/<mention[^>]*>([^<]*)<\/mention>/gi, "@$1").replace(/<[^>]+>/g, "");
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
                className="flex max-h-40 w-full items-start overflow-hidden rounded-lg px-1 py-1 text-left text-sm text-foreground hover:bg-white/5"
              >
                <span className="line-clamp-6 whitespace-pre-wrap break-words">
                  {stripTags(row[cellIndex] || "") || "-"}
                </span>
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
