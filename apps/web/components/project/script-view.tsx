"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import mammoth from "mammoth";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import {
  IconArrowBackUp,
  IconArrowForwardUp,
  IconBold,
  IconCloudUpload,
  IconDeviceFloppy,
  IconH1,
  IconH2,
  IconH3,
  IconItalic,
  IconList,
  IconListNumbers,
  IconLoader2,
  IconPlus,
  IconQuote,
  IconSeparator,
  IconSparkles,
  IconStrikethrough,
  IconTrash,
} from "@tabler/icons-react";
import { toast } from "sonner";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
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
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { backendApi } from "@/src/lib/api";
import { pipelineStream } from "@/src/lib/pipeline-stream";
import { saveStoryboardTableWithBackfill } from "@/src/lib/storyboard-save";
import { useRawAiModels } from "@/src/hooks/use-ai-models";
import { AI_MODEL_PATHS } from "@/src/lib/ai-model-paths";
import { useAppSelector, useAppDispatch } from "@/src/store";
import { touchStoryboard, selectCurrentInstance } from "@/src/store/slices/projectSlice";
import { Field, FieldLabel } from "@/components/ui/field";

const PIPELINE_RUN_PATH = "/api/ai/forward/run";
function escapeHtml(input: string) {
  return input
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function textToHtml(text: string) {
  return text
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)
    .map((paragraph) => `<p>${escapeHtml(paragraph).replaceAll("\n", "<br />")}</p>`)
    .join("");
}

function parseCsvLine(line: string) {
  const cells: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"') {
      if (inQuotes && line[index + 1] === '"') {
        current += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === "," && !inQuotes) {
      cells.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }

  cells.push(current.trim());
  return cells;
}

function parseCsvToTable(csvText: string) {
  const lines = csvText
    .trim()
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length < 2) {
    return { headers: [] as string[], rows: [] as string[][] };
  }

  const headers = parseCsvLine(lines[0]);
  const rows = lines
    .slice(1)
    .map(parseCsvLine)
    .filter((row) => row.some(Boolean));
  return { headers, rows };
}

function getColumnWidth(header: string) {
  const widthMap: Record<string, string> = {
    图片描述: "minmax(220px, 1.5fr)",
    视频描述: "minmax(220px, 1.5fr)",
    运镜方式: "minmax(140px, 1fr)",
    画风: "minmax(140px, 1fr)",
    对白: "minmax(180px, 1fr)",
    "分镜时长（秒）": "minmax(120px, 0.8fr)",
    分镜时长: "minmax(120px, 0.8fr)",
    视角: "minmax(140px, 1fr)",
    景别: "minmax(120px, 0.8fr)",
  };
  return widthMap[header] ?? "minmax(160px, 1fr)";
}

export function ScriptView() {
  const t = useTranslations("script");
  const tc = useTranslations("common");
  const ts = useTranslations("storyboard");
  const activeEpisodeId = useAppSelector((s) => selectCurrentInstance(s).activeEpisodeId);
  const episodesVersion = useAppSelector((s) => selectCurrentInstance(s).episodesVersion);
  const projectId = useAppSelector((s) => s.project.currentProjectId);
  const worldId = useAppSelector((s) => selectCurrentInstance(s).worldId);
  const detail = useAppSelector((s) => selectCurrentInstance(s).detail);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const abortRef = useRef<(() => void) | null>(null);

  const [originalContent, setOriginalContent] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [changed, setChanged] = useState(false);
  const [showReplaceConfirm, setShowReplaceConfirm] = useState(false);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [showGenerateForm, setShowGenerateForm] = useState(false);
  const [generateShotsCount, setGenerateShotsCount] = useState(30);
  const [generateWithAssets, setGenerateWithAssets] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [storyboardModel, setStoryboardModel] = useState("");
  const [showStoryboardResult, setShowStoryboardResult] = useState(false);
  const [storyboardHeaders, setStoryboardHeaders] = useState<string[]>([]);
  const [storyboardRows, setStoryboardRows] = useState<string[][]>([]);
  const [autoload, setAutoload] = useState(false);
  const [applyingStoryboard, setApplyingStoryboard] = useState(false);

  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit,
      Placeholder.configure({
        placeholder: t("placeholder"),
        emptyEditorClass:
          "before:content-[attr(data-placeholder)] before:text-muted-foreground/40 before:float-left before:h-0 before:pointer-events-none",
      }),
    ],
    editorProps: {
      attributes: {
        class:
          "prose prose-invert prose-sm max-w-none min-h-[calc(100vh-300px)] px-8 py-6 focus:outline-none",
      },
    },
    onUpdate: ({ editor: instance }) => {
      setChanged(instance.getHTML() !== originalContent);
    },
  });

  const { models: storyboardChatModels } = useRawAiModels(AI_MODEL_PATHS.storyboardChat);

  useEffect(() => {
    if (storyboardChatModels.length === 0) return;
    const defaultModel =
      storyboardChatModels.find((item) => item.isDefault) ?? storyboardChatModels[0];
    if (defaultModel?.serviceCode) {
      setStoryboardModel(defaultModel.serviceCode);
    }
  }, [storyboardChatModels]);

  useEffect(() => {
    if (!activeEpisodeId || !editor) return;
    // Skip reload if user has unsaved edits (avoid overwriting)
    if (changed) return;

    setLoading(true);
    abortRef.current?.();

    backendApi
      .post<{ content?: string }>(`/api/user/project/scripts/episode/detail/${activeEpisodeId}`)
      .then((data) => {
        const content = data?.content ?? "";
        setOriginalContent(content);
        editor.commands.setContent(content || "<p></p>");
      })
      .catch((error) => {
        console.error("[ScriptView] 加载剧本失败:", error);
        toast.error(t("loadFailed"));
      })
      .finally(() => setLoading(false));
  }, [activeEpisodeId, episodesVersion, editor]);

  useEffect(() => {
    return () => {
      abortRef.current?.();
    };
  }, []);

  const handleSave = useCallback(async () => {
    if (!activeEpisodeId || !changed || !editor) return;
    setSaving(true);

    try {
      const content = editor.getHTML();
      await backendApi.post("/api/user/project/scripts/episode/createOrUpdate", {
        data: { episodeId: activeEpisodeId, content },
      });
      setOriginalContent(content);
      setChanged(false);
      toast.success(t("saved"));
    } catch (error) {
      console.error("[ScriptView] 保存剧本失败:", error);
      toast.error(t("saveFailed"));
    } finally {
      setSaving(false);
    }
  }, [activeEpisodeId, changed, editor]);

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key === "s") {
        event.preventDefault();
        void handleSave();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [handleSave]);

  const processFile = useCallback(
    async (file: File) => {
      const extension = file.name.slice(file.name.lastIndexOf(".")).toLowerCase();
      setUploading(true);

      try {
        if (extension === ".txt") {
          const content = await file.text();
          editor?.commands.setContent(textToHtml(content));
          setChanged(true);
          toast.success(t("importedTxt"));
        } else if (extension === ".doc" || extension === ".docx") {
          const arrayBuffer = await file.arrayBuffer();
          const result = await mammoth.extractRawText({ arrayBuffer });
          editor?.commands.setContent(textToHtml(result.value || ""));
          setChanged(true);
          toast.success(t("importedWord"));
        } else {
          toast.error(t("unsupportedFormat"));
        }
      } catch (error) {
        console.error("[ScriptView] 导入文件失败:", error);
        toast.error(t("importFailed"));
      } finally {
        setUploading(false);
      }
    },
    [editor]
  );

  const handleImportClick = () => {
    fileInputRef.current?.click();
  };

  const handleBeforeImport = async (file: File) => {
    if (file.size > 5 * 1024 * 1024) {
      toast.error(t("fileSizeLimit"));
      return;
    }

    if (editor && editor.getText({ blockSeparator: "\n\n" }).trim()) {
      setPendingFile(file);
      setShowReplaceConfirm(true);
      return;
    }

    await processFile(file);
  };

  const handleGenerateStoryboard = () => {
    if (!editor) return;
    const content = editor.getText({ blockSeparator: "\n\n" }).trim();
    if (!content) {
      toast.warning(t("emptyScript"));
      return;
    }
    setShowGenerateForm(true);
  };

  const runGenerateStoryboard = () => {
    if (!editor || !projectId) {
      toast.error(t("missingProjectInfo"));
      return;
    }

    const screenplay = editor.getText({ blockSeparator: "\n\n" }).trim();
    if (!screenplay) {
      toast.warning(t("emptyScript"));
      return;
    }

    setShowGenerateForm(false);
    setGenerating(true);

    const steps = generateWithAssets
      ? ["extract-assets", "qc-assets", "storyboard"]
      : ["storyboard"];
    let latestText = "";

    abortRef.current = pipelineStream(
      PIPELINE_RUN_PATH,
      {
        screenplay,
        projectId,
        steps,
        shotsPerMin: generateShotsCount,
        model: storyboardModel || undefined,
      },
      {
        onEvent: (event) => {
          if (event.type === "chunk" && event.content) {
            latestText += String(event.content);
          } else if (event.type === "step_complete" && event.result) {
            latestText =
              typeof event.result === "string" ? event.result : JSON.stringify(event.result);
          } else if (event.type === "done" && event.fullText) {
            latestText = String(event.fullText);
          } else if (event.type === "pipeline_complete") {
            const storyboardCsv =
              typeof event.results?.storyboard === "string" ? event.results.storyboard : latestText;
            const { headers, rows } = parseCsvToTable(storyboardCsv);
            if (rows.length > 0) {
              setStoryboardHeaders(headers);
              setStoryboardRows(rows);
              setShowStoryboardResult(true);
              toast.success(t("storyboardGenerated"));
            } else {
              toast.warning(t("noStoryboardContent"));
            }
          } else if (event.type === "error") {
            toast.error(String(event.error ?? event.message ?? t("generateFailed")));
          }
        },
        onDone: (completed) => {
          setGenerating(false);
          abortRef.current = null;

          if (!completed && latestText) {
            const { headers, rows } = parseCsvToTable(latestText);
            if (rows.length > 0) {
              setStoryboardHeaders(headers);
              setStoryboardRows(rows);
              setShowStoryboardResult(true);
              toast.warning(t("generateAborted"));
            }
          }
        },
        onError: (error) => {
          console.error("[ScriptView] 生成分镜失败:", error);
          setGenerating(false);
          abortRef.current = null;
          toast.error(t("generateFailed"));
        },
      }
    );
  };

  const handleApplyStoryboard = async () => {
    if (!activeEpisodeId) {
      toast.error(ts("selectEpisodeFirst"));
      return;
    }

    if (storyboardRows.length === 0) {
      toast.warning(t("noContentToApply"));
      return;
    }

    setApplyingStoryboard(true);
    try {
      const result = await saveStoryboardTableWithBackfill({
        episodeId: activeEpisodeId,
        table: {
          headers: storyboardHeaders,
          rows: storyboardRows,
        },
        worldId,
        stylePaintingName:
          typeof detail?.stylePaintingName === "string" ? detail.stylePaintingName : "",
        autoload,
        replaceExisting: true,
      });
      touchStoryboard();
      setShowStoryboardResult(false);
      if (result.warning) {
        toast.warning(result.warning);
      } else {
        toast.success(t("storyboardApplied"));
      }
    } catch (error) {
      console.error("[ScriptView] 应用分镜失败:", error);
      toast.error(error instanceof Error ? error.message : t("applyFailed"));
    } finally {
      setApplyingStoryboard(false);
    }
  };

  const storyboardGridColumns = useMemo(
    () => storyboardHeaders.map((header) => getColumnWidth(header)).join(" ") + " 72px",
    [storyboardHeaders]
  );

  if (!activeEpisodeId) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-sm text-muted-foreground">{ts("episodeNotSelected")}</p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <IconLoader2 className="size-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <>
      <div className="flex h-full flex-col">
        <input
          ref={fileInputRef}
          type="file"
          hidden
          accept=".txt,.doc,.docx"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) {
              void handleBeforeImport(file);
            }
            event.target.value = "";
          }}
        />

        <div className="flex items-center justify-end border-b border-border px-3 py-2.5">
          <Button onClick={handleGenerateStoryboard} disabled={generating}>
            {generating ? (
              <IconLoader2 className="size-3.5 animate-spin" />
            ) : (
              <IconSparkles className="size-3.5" />
            )}
            {generating ? tc("generating") : t("generateStoryboard")}
          </Button>
        </div>

        <div className="flex items-center gap-0.5 border-b border-border px-3 py-1.5">
          <ToolbarButton
            icon={<IconBold className="size-4" />}
            active={editor?.isActive("bold")}
            onClick={() => editor?.chain().focus().toggleBold().run()}
          />
          <ToolbarButton
            icon={<IconItalic className="size-4" />}
            active={editor?.isActive("italic")}
            onClick={() => editor?.chain().focus().toggleItalic().run()}
          />
          <ToolbarButton
            icon={<IconStrikethrough className="size-4" />}
            active={editor?.isActive("strike")}
            onClick={() => editor?.chain().focus().toggleStrike().run()}
          />
          <ToolbarSep />
          <ToolbarButton
            icon={<IconH1 className="size-4" />}
            active={editor?.isActive("heading", { level: 1 })}
            onClick={() => editor?.chain().focus().toggleHeading({ level: 1 }).run()}
          />
          <ToolbarButton
            icon={<IconH2 className="size-4" />}
            active={editor?.isActive("heading", { level: 2 })}
            onClick={() => editor?.chain().focus().toggleHeading({ level: 2 }).run()}
          />
          <ToolbarButton
            icon={<IconH3 className="size-4" />}
            active={editor?.isActive("heading", { level: 3 })}
            onClick={() => editor?.chain().focus().toggleHeading({ level: 3 }).run()}
          />
          <ToolbarSep />
          <ToolbarButton
            icon={<IconList className="size-4" />}
            active={editor?.isActive("bulletList")}
            onClick={() => editor?.chain().focus().toggleBulletList().run()}
          />
          <ToolbarButton
            icon={<IconListNumbers className="size-4" />}
            active={editor?.isActive("orderedList")}
            onClick={() => editor?.chain().focus().toggleOrderedList().run()}
          />
          <ToolbarButton
            icon={<IconQuote className="size-4" />}
            active={editor?.isActive("blockquote")}
            onClick={() => editor?.chain().focus().toggleBlockquote().run()}
          />
          <ToolbarButton
            icon={<IconSeparator className="size-4" />}
            onClick={() => editor?.chain().focus().setHorizontalRule().run()}
          />
          <ToolbarSep />
          <ToolbarButton
            icon={<IconArrowBackUp className="size-4" />}
            onClick={() => editor?.chain().focus().undo().run()}
            disabled={!editor?.can().undo()}
          />
          <ToolbarButton
            icon={<IconArrowForwardUp className="size-4" />}
            onClick={() => editor?.chain().focus().redo().run()}
            disabled={!editor?.can().redo()}
          />

          <div className="ml-auto flex items-center gap-2">
            <Button
              variant="outline"
              color="muted"
              size="sm"
              onClick={handleImportClick}
              disabled={uploading}
            >
              {uploading ? (
                <IconLoader2 className="size-3.5 animate-spin" />
              ) : (
                <IconCloudUpload className="size-3.5" />
              )}
              {tc("import")}
            </Button>
            <Button size="sm" disabled={!changed || saving} onClick={() => void handleSave()}>
              {saving ? (
                <IconLoader2 className="size-3.5 animate-spin" />
              ) : (
                <IconDeviceFloppy className="size-3.5" />
              )}
              {tc("save")}
            </Button>
          </div>
        </div>

        <div className="flex-1 overflow-auto">
          <div className="mx-auto max-w-4xl">
            <EditorContent editor={editor} />
          </div>
        </div>
      </div>

      <Dialog open={showGenerateForm} onOpenChange={setShowGenerateForm}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("generateStoryboard")}</DialogTitle>
            <DialogDescription>{t("breakdownScript")}</DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <Field>
              <FieldLabel>{t("shotsPerMinute")}</FieldLabel>
              <Input
                type="number"
                min={1}
                max={200}
                value={String(generateShotsCount)}
                onChange={(event) =>
                  setGenerateShotsCount(
                    Math.max(1, Math.min(200, Number(event.target.value || 30)))
                  )
                }
              />
            </Field>

            <Field orientation="horizontal" className="w-auto">
              <Checkbox
                checked={generateWithAssets}
                onCheckedChange={(checked) => setGenerateWithAssets(checked === true)}
              />
              <FieldLabel>{t("analyzeAssets")}</FieldLabel>
            </Field>
          </div>

          <DialogFooter>
            <Button variant="outline" color="muted" onClick={() => setShowGenerateForm(false)}>
              {tc("cancel")}
            </Button>
            <Button onClick={runGenerateStoryboard} disabled={generating}>
              {generating ? <IconLoader2 className="size-3.5 animate-spin" /> : null}
              {tc("generate")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showReplaceConfirm} onOpenChange={setShowReplaceConfirm}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{tc("replace")}</DialogTitle>
            <DialogDescription>{t("replaceConfirmDesc")}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              color="muted"
              onClick={() => {
                setShowReplaceConfirm(false);
                setPendingFile(null);
              }}
            >
              {tc("cancel")}
            </Button>
            <Button
              onClick={async () => {
                setShowReplaceConfirm(false);
                if (pendingFile) {
                  await processFile(pendingFile);
                  setPendingFile(null);
                }
              }}
            >
              {tc("confirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showStoryboardResult} onOpenChange={setShowStoryboardResult}>
        <DialogContent className="max-w-[96vw]">
          <DialogHeader>
            <DialogTitle>{t("aiStoryboardResult")}</DialogTitle>
            <DialogDescription>{t("aiStoryboardResultDesc")}</DialogDescription>
          </DialogHeader>

          {storyboardRows.length > 0 ? (
            <div className="space-y-4">
              <div className="max-h-[68vh] overflow-auto rounded-2xl border border-border">
                <div
                  className="grid min-w-full"
                  style={{ gridTemplateColumns: storyboardGridColumns }}
                >
                  {storyboardHeaders.map((header) => (
                    <div
                      key={`header-${header}`}
                      className="border-b border-r border-border bg-muted/50 px-3 py-2 text-sm font-medium"
                    >
                      {header}
                    </div>
                  ))}
                  <div className="border-b border-border bg-muted/50 px-3 py-2 text-sm font-medium">
                    {tc("more")}
                  </div>

                  {storyboardRows.map((row, rowIndex) => (
                    <FragmentRow
                      key={`row-${rowIndex}`}
                      headers={storyboardHeaders}
                      row={row}
                      rowIndex={rowIndex}
                      onChange={(cellIndex, value) => {
                        setStoryboardRows((current) =>
                          current.map((item, index) =>
                            index === rowIndex
                              ? item.map((cell, innerIndex) =>
                                  innerIndex === cellIndex ? value : cell
                                )
                              : item
                          )
                        );
                      }}
                      onDelete={() =>
                        setStoryboardRows((current) =>
                          current.length > 1
                            ? current.filter((_, index) => index !== rowIndex)
                            : current
                        )
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
                  <FieldLabel>{t("autoAssociate")}</FieldLabel>
                </Field>

                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    color="muted"
                    onClick={() =>
                      setStoryboardRows((current) => [...current, storyboardHeaders.map(() => "")])
                    }
                  >
                    <IconPlus className="size-3.5" />
                    {t("addRow")}
                  </Button>
                  <Button
                    variant="outline"
                    color="muted"
                    onClick={() => setShowStoryboardResult(false)}
                  >
                    {tc("close")}
                  </Button>
                  <Button
                    onClick={() => void handleApplyStoryboard()}
                    disabled={applyingStoryboard}
                  >
                    {applyingStoryboard ? (
                      <IconLoader2 className="size-3.5 animate-spin" />
                    ) : (
                      <IconSparkles className="size-3.5" />
                    )}
                    {t("applyToStoryboard")}
                  </Button>
                </div>
              </div>
            </div>
          ) : (
            <div className="rounded-2xl border border-dashed border-border px-6 py-16 text-center text-sm text-muted-foreground">
              {t("noStoryboardPreview")}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

function ToolbarButton({
  icon,
  active,
  disabled,
  onClick,
}: {
  icon: React.ReactNode;
  active?: boolean;
  disabled?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "flex size-8 items-center justify-center rounded transition-colors",
        active
          ? "bg-muted text-foreground"
          : "text-muted-foreground hover:bg-muted/50 hover:text-foreground",
        disabled && "pointer-events-none opacity-30"
      )}
    >
      {icon}
    </button>
  );
}

function ToolbarSep() {
  return <div className="mx-1 h-5 w-px bg-border" />;
}

function FragmentRow({
  headers,
  row,
  rowIndex,
  onChange,
  onDelete,
}: {
  headers: string[];
  row: string[];
  rowIndex: number;
  onChange: (cellIndex: number, value: string) => void;
  onDelete: () => void;
}) {
  return (
    <>
      {headers.map((header, cellIndex) => (
        <div key={`${header}-${rowIndex}`} className="border-r border-t border-border p-2">
          <Textarea
            value={row[cellIndex] ?? ""}
            onChange={(event) => onChange(cellIndex, event.target.value)}
            className="min-h-16 resize-y"
          />
        </div>
      ))}

      <div className="border-t border-border p-2">
        <Button variant="ghost" color="muted" size="icon-xs" onClick={onDelete}>
          <IconTrash className="size-3.5" />
        </Button>
      </div>
    </>
  );
}
