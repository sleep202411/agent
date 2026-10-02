"use client";

import { useEffect, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { IconDownload, IconFileImport } from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  MAX_PLOT_IMPORT_BYTES,
  parseStoryPlotImport,
  StoryPlotImportError,
  type StoryPlotImport,
  type StoryPlotImportMode,
} from "@/lib/story-plot-import";

export function StoryPlotImportDialog({
  disabled,
  hasNodes,
  onImport,
}: {
  disabled: boolean;
  hasNodes: boolean;
  onImport: (plot: StoryPlotImport, mode: StoryPlotImportMode) => void | Promise<void>;
}) {
  const t = useTranslations("storyStudio.canvas.plotImport");
  const locale = useLocale();
  const [open, setOpen] = useState(false);
  const [selection, setSelection] = useState<{ name: string; plot: StoryPlotImport } | null>(null);
  const [replace, setReplace] = useState(false);
  const [reading, setReading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const readVersion = useRef(0);
  const submitted = useRef(false);
  const dragDepth = useRef(0);
  useEffect(
    () => () => {
      readVersion.current++;
    },
    []
  );
  const templateLocale = ["en-US", "zh-CN", "zh-HK"].includes(locale) ? locale : "en-US";

  const changeOpen = (next: boolean) => {
    readVersion.current++;
    setReading(false);
    setImporting(false);
    setSelection(null);
    setReplace(false);
    setError(null);
    setDragging(false);
    dragDepth.current = 0;
    submitted.current = !next;
    setOpen(next);
  };
  const showError = (cause: unknown) => {
    setError(
      cause instanceof StoryPlotImportError
        ? t(`errors.${cause.code}`, { path: cause.path })
        : cause instanceof Error && cause.message
          ? cause.message
          : t("errors.read")
    );
  };
  const readFile = async (file: File) => {
    const version = ++readVersion.current;
    setSelection(null);
    setError(null);
    setReading(true);
    try {
      if (file.size > MAX_PLOT_IMPORT_BYTES) throw new StoryPlotImportError("size");
      const source = await file.text();
      if (version !== readVersion.current) return;
      setSelection({ name: file.name, plot: parseStoryPlotImport(source) });
    } catch (cause) {
      if (version === readVersion.current) showError(cause);
    } finally {
      if (version === readVersion.current) setReading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={changeOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm" disabled={disabled}>
          <IconFileImport className="size-4" />
          {t("title")}
        </Button>
      </DialogTrigger>
      <DialogContent
        className="gap-5 p-6 sm:max-w-md"
        onDragOver={(event) => {
          if (event.dataTransfer.types.includes("Files")) {
            event.preventDefault();
            event.stopPropagation();
          }
        }}
        onDrop={(event) => {
          event.preventDefault();
          event.stopPropagation();
        }}
      >
        <DialogHeader>
          <DialogTitle className="text-xl">{t("title")}</DialogTitle>
          <DialogDescription>{t("description")}</DialogDescription>
        </DialogHeader>
        <a
          href={`/templates/story-plot/${templateLocale}.md`}
          download="fizzdragon-plot-template.md"
          className="flex w-fit items-center gap-2 text-sm text-foreground underline-offset-4 hover:underline focus-visible:underline"
        >
          <IconDownload className="size-4" />
          {t("download")}
        </a>
        <div className="space-y-3">
          <input
            ref={inputRef}
            type="file"
            accept=".json,application/json"
            hidden
            aria-label={t("choose")}
            onChange={(event) => {
              const file = event.currentTarget.files?.[0];
              event.currentTarget.value = "";
              if (file) void readFile(file);
            }}
          />
          <div
            onDragEnter={(event) => {
              if (!event.dataTransfer.types.includes("Files")) return;
              event.preventDefault();
              event.stopPropagation();
              if (reading || importing || disabled) return;
              dragDepth.current++;
              setDragging(true);
            }}
            onDragLeave={(event) => {
              event.preventDefault();
              event.stopPropagation();
              dragDepth.current = Math.max(0, dragDepth.current - 1);
              if (!dragDepth.current) setDragging(false);
            }}
            onDragOver={(event) => {
              event.preventDefault();
              event.stopPropagation();
              event.dataTransfer.dropEffect = reading || importing || disabled ? "none" : "copy";
            }}
            onDrop={(event) => {
              event.preventDefault();
              event.stopPropagation();
              dragDepth.current = 0;
              setDragging(false);
              if (reading || importing || disabled) return;
              const files = Array.from(event.dataTransfer.files);
              if (!files.length) return;
              if (files.length !== 1 || !files[0]!.name.toLowerCase().endsWith(".json")) {
                setSelection(null);
                setError(t(files.length !== 1 ? "errors.singleFile" : "errors.fileType"));
                return;
              }
              void readFile(files[0]!);
            }}
          >
            <button
              type="button"
              aria-label={t("choose")}
              disabled={reading || importing || disabled}
              onClick={() => inputRef.current?.click()}
              className={cn(
                "flex min-h-36 w-full flex-col items-center justify-center gap-2 rounded-xl border border-dashed px-5 py-6 text-center transition-colors focus-visible:ring-2 focus-visible:ring-brand-blue focus-visible:outline-none disabled:opacity-50",
                dragging && !reading && !importing && !disabled
                  ? "border-brand-blue bg-muted"
                  : "border-border bg-input/20 hover:bg-input/30"
              )}
            >
              <IconFileImport className="mb-1 size-6 text-muted-foreground" stroke={1.5} />
              <span className="w-full truncate text-sm text-foreground">
                {reading ? t("reading") : dragging ? t("drop") : (selection?.name ?? t("dropHint"))}
              </span>
              <span aria-live="polite" className="text-xs text-muted-foreground">
                {selection
                  ? t("summary", {
                      scenes: selection.plot.nodes.filter((node) => node.type === "scene").length,
                      decisions: selection.plot.nodes.filter((node) => node.type === "decision")
                        .length,
                      assets: selection.plot.assets.length,
                      variables: selection.plot.stateVariables.length,
                      clips: selection.plot.nodes.reduce(
                        (count, node) =>
                          count + (node.type === "scene" ? node.storyboard.clips.length : 0),
                        0
                      ),
                    })
                  : t("limits")}
              </span>
            </button>
          </div>
          {error ? (
            <p role="alert" className="break-words text-sm text-destructive">
              {error}
            </p>
          ) : null}
        </div>
        <div className="space-y-2">
          {hasNodes ? (
            <label className="flex cursor-pointer items-center gap-2 text-sm text-foreground">
              <input
                type="checkbox"
                checked={replace}
                disabled={disabled || importing}
                onChange={(event) => setReplace(event.currentTarget.checked)}
                className="size-4 shrink-0 accent-primary"
              />
              {t("replaceLabel")}
            </label>
          ) : null}
          <p className="text-sm text-muted-foreground" aria-live="polite">
            {t(hasNodes ? (replace ? "replaceHint" : "appendHint") : "emptyHint")}
          </p>
        </div>
        <DialogFooter>
          <Button variant="ghost" disabled={importing} onClick={() => changeOpen(false)}>
            {t("cancel")}
          </Button>
          <Button
            disabled={!selection || reading || importing || disabled}
            onClick={() => {
              if (!selection || disabled || importing || submitted.current) return;
              submitted.current = true;
              setImporting(true);
              const plot = selection.plot;
              const version = readVersion.current;
              const mode: StoryPlotImportMode = hasNodes && replace ? "replace" : "append";
              void Promise.resolve()
                .then(() => onImport(plot, mode))
                .then(() => {
                  if (version !== readVersion.current) return;
                  changeOpen(false);
                })
                .catch((cause: unknown) => {
                  if (version !== readVersion.current) return;
                  submitted.current = false;
                  setImporting(false);
                  showError(cause);
                });
            }}
          >
            {importing ? t("importing") : t("confirm")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
