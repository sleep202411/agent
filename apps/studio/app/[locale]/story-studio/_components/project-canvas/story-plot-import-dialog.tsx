"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import {
  IconCheck,
  IconDownload,
  IconFileImport,
  IconFileZip,
  IconLoader2,
  IconX,
} from "@tabler/icons-react";
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
import {
  extractStoryPlotVideo,
  matchStoryPlotVideos,
  readStoryPlotArchive,
  StoryPlotArchiveError,
  storyPlotVideoReferences,
  type StoryPlotArchive,
  type StoryPlotMediaBinding,
} from "@/lib/story-plot-media";
import { uploadFileViaSignedUrl } from "@/lib/media-upload";
import { addStoryCandidateAsset } from "@/lib/story-projects-api";

type ImportStatus =
  | {
      phase: "preparing" | "uploading" | "confirming";
      current: number;
      total: number;
      percent: number;
    }
  | { phase: "saving" };

export function StoryPlotImportDialog({
  disabled,
  hasNodes,
  projectId,
  onImport,
}: {
  disabled: boolean;
  hasNodes: boolean;
  projectId: string;
  onImport: (
    plot: StoryPlotImport,
    mode: StoryPlotImportMode,
    media?: StoryPlotMediaBinding[]
  ) => void | Promise<void>;
}) {
  const t = useTranslations("storyStudio.canvas.plotImport");
  const locale = useLocale();
  const [open, setOpen] = useState(false);
  const [selection, setSelection] = useState<{ name: string; plot: StoryPlotImport } | null>(null);
  const [archive, setArchive] = useState<StoryPlotArchive | null>(null);
  const [replace, setReplace] = useState(false);
  const [reading, setReading] = useState(false);
  const [status, setStatus] = useState<ImportStatus | null>(null);
  const importing = status !== null;
  const saving = status?.phase === "saving";
  const progress = status && status.phase !== "saving" ? status : null;
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<{ message: string; blocksImport: boolean } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const zipInputRef = useRef<HTMLInputElement>(null);
  const readVersion = useRef(0);
  const submitted = useRef(false);
  const dragDepth = useRef(0);
  const uploadController = useRef<AbortController | null>(null);
  // Keep confirmed uploads across attachment and draft retries.
  const uploaded = useRef(new Map<string, { mediaAssetId: string; attached: boolean }>());
  useEffect(
    () => () => {
      readVersion.current++;
      uploadController.current?.abort();
    },
    []
  );
  const templateLocale = ["en-US", "zh-CN", "zh-HK"].includes(locale) ? locale : "en-US";
  const references = useMemo(
    () => (selection ? storyPlotVideoReferences(selection.plot) : []),
    [selection]
  );
  const matches = useMemo(
    () => (selection && archive ? matchStoryPlotVideos(selection.plot, archive) : []),
    [selection, archive]
  );
  const unmatched = matches.filter((match) => match.status !== "matched");

  const changeOpen = (next: boolean) => {
    readVersion.current++;
    uploadController.current?.abort();
    setReading(false);
    setStatus(null);
    setSelection(null);
    setArchive(null);
    uploaded.current.clear();
    setReplace(false);
    setError(null);
    setDragging(false);
    dragDepth.current = 0;
    submitted.current = !next;
    setOpen(next);
  };
  const showError = (cause: unknown, blocksImport = false) =>
    setError({
      message:
        cause instanceof StoryPlotImportError || cause instanceof StoryPlotArchiveError
          ? t(`errors.${cause.code}`, {
              path: cause instanceof StoryPlotImportError ? cause.path : "$",
            })
          : cause instanceof Error && cause.message
            ? cause.message
            : t("errors.read"),
      blocksImport,
    });
  const readFiles = async (files: File[]) => {
    if (!files.length || disabled || importing || submitted.current) return;
    const version = ++readVersion.current;
    const json = files.filter((file) => file.name.toLowerCase().endsWith(".json"));
    const zip = files.filter((file) => file.name.toLowerCase().endsWith(".zip"));
    if (json.length > 1 || zip.length > 1 || json.length + zip.length !== files.length) {
      setSelection(null);
      setReading(false);
      setError({
        message: t(files.length > 1 ? "errors.singleFile" : "errors.fileType"),
        blocksImport: true,
      });
      return;
    }
    setError(null);
    setReading(true);
    if (json.length) setSelection(null);
    if (zip.length) {
      setArchive(null);
      uploaded.current.clear();
    }
    try {
      const [nextPlot, nextArchive] = await Promise.all([
        json[0]
          ? (async () => {
              if (json[0]!.size > MAX_PLOT_IMPORT_BYTES) throw new StoryPlotImportError("size");
              return { name: json[0]!.name, plot: parseStoryPlotImport(await json[0]!.text()) };
            })()
          : null,
        zip[0] ? readStoryPlotArchive(zip[0]) : null,
      ]);
      if (version !== readVersion.current) return;
      if (nextPlot) setSelection(nextPlot);
      if (nextArchive) setArchive(nextArchive);
    } catch (cause) {
      if (version === readVersion.current) showError(cause, true);
    } finally {
      if (version === readVersion.current) setReading(false);
    }
  };

  const submit = async () => {
    if (
      !selection ||
      disabled ||
      reading ||
      importing ||
      submitted.current ||
      unmatched.length ||
      error?.blocksImport
    )
      return;
    submitted.current = true;
    setStatus({ phase: "saving" });
    setError(null);
    const version = readVersion.current;
    const controller = new AbortController();
    uploadController.current = controller;
    try {
      const media: StoryPlotMediaBinding[] = [];
      if (archive && matches.length) {
        const entries = [...new Set(matches.map((match) => match.entry!))];
        for (const [index, entry] of entries.entries()) {
          if (version !== readVersion.current || controller.signal.aborted) return;
          setStatus({
            phase: uploaded.current.has(entry) ? "confirming" : "preparing",
            current: index + 1,
            total: entries.length,
            percent: uploaded.current.has(entry) ? 100 : 0,
          });
          if (!uploaded.current.has(entry)) {
            const file = await extractStoryPlotVideo(archive, entry, controller.signal);
            if (controller.signal.aborted || version !== readVersion.current) return;
            const result = await uploadFileViaSignedUrl(file, {
              kind: "ai_reference_video",
              scope: { storyProjectId: projectId },
              signal: controller.signal,
              onProgress: (percent: number) => {
                if (version === readVersion.current && !controller.signal.aborted)
                  setStatus({
                    phase: "uploading",
                    current: index + 1,
                    total: entries.length,
                    percent,
                  });
              },
              onConfirming: () => {
                if (version === readVersion.current && !controller.signal.aborted)
                  setStatus({
                    phase: "confirming",
                    current: index + 1,
                    total: entries.length,
                    percent: 100,
                  });
              },
            });
            if (controller.signal.aborted || version !== readVersion.current) return;
            uploaded.current.set(entry, { mediaAssetId: result.mediaAssetId, attached: false });
          }
          const receipt = uploaded.current.get(entry)!;
          if (!receipt.attached) {
            await addStoryCandidateAsset(projectId, receipt.mediaAssetId, controller.signal);
            if (controller.signal.aborted || version !== readVersion.current) return;
            receipt.attached = true;
          }
        }
        matches.forEach((match) =>
          media.push({
            nodeId: match.nodeId,
            clipId: match.clipId,
            mediaAssetId: uploaded.current.get(match.entry!)!.mediaAssetId,
          })
        );
      }
      if (version !== readVersion.current || controller.signal.aborted) return;
      setStatus({ phase: "saving" });
      const mode: StoryPlotImportMode = hasNodes && replace ? "replace" : "append";
      if (media.length) await onImport(selection.plot, mode, media);
      else await onImport(selection.plot, mode);
      if (version === readVersion.current) changeOpen(false);
    } catch (cause) {
      if (version !== readVersion.current) return;
      submitted.current = false;
      setStatus(null);
      showError(cause);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (next || !saving) changeOpen(next);
      }}
    >
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm" disabled={disabled}>
          <IconFileImport className="size-4" />
          {t("title")}
        </Button>
      </DialogTrigger>
      <DialogContent
        className="max-h-[90dvh] gap-5 overflow-y-auto p-6 sm:max-w-xl"
        aria-busy={importing}
        showCloseButton={!saving}
        onEscapeKeyDown={(event) => {
          if (saving) event.preventDefault();
        }}
        onPointerDownOutside={(event) => {
          if (importing) event.preventDefault();
        }}
        onDragOver={(event) => {
          if (event.dataTransfer.types.includes("Files")) event.preventDefault();
        }}
        onDrop={(event) => event.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>{t("title")}</DialogTitle>
          <DialogDescription>{t("description")}</DialogDescription>
        </DialogHeader>
        <input
          ref={inputRef}
          type="file"
          accept=".json,.zip,application/json,application/zip"
          multiple
          hidden
          aria-label={t("choose")}
          onChange={(event) => {
            const files = Array.from(event.currentTarget.files ?? []);
            event.currentTarget.value = "";
            void readFiles(files);
          }}
        />
        <input
          ref={zipInputRef}
          type="file"
          accept=".zip,application/zip"
          hidden
          aria-label={t("chooseZip")}
          onChange={(event) => {
            const files = Array.from(event.currentTarget.files ?? []);
            event.currentTarget.value = "";
            void readFiles(files);
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
            if (!reading && !importing && !disabled)
              void readFiles(Array.from(event.dataTransfer.files));
          }}
        >
          <button
            type="button"
            aria-label={t("choose")}
            disabled={reading || importing || disabled}
            onClick={() => inputRef.current?.click()}
            className={cn(
              "flex min-h-40 w-full flex-col items-center justify-center gap-2 rounded-2xl bg-input/20 px-6 py-7 text-center transition-colors hover:bg-input/30 focus-visible:ring-2 focus-visible:ring-brand-blue focus-visible:outline-none disabled:opacity-50",
              dragging && "bg-muted"
            )}
          >
            {reading ? (
              <IconLoader2 className="mb-2 size-7 animate-spin text-muted-foreground" />
            ) : selection ? (
              <IconCheck className="mb-2 size-7 text-foreground" stroke={1.5} />
            ) : (
              <IconFileImport className="mb-2 size-7 text-muted-foreground" stroke={1.5} />
            )}
            <span className="w-full truncate text-sm font-medium">
              {reading ? t("reading") : dragging ? t("drop") : (selection?.name ?? t("dropHint"))}
            </span>
            <span aria-live="polite" className="text-xs leading-5 text-muted-foreground">
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
        <div className="flex flex-wrap items-center justify-start gap-2 text-xs">
          <Button variant="ghost" size="sm" asChild>
            <a
              href={`/templates/story-plot/${templateLocale}.md`}
              download="fizzdragon-plot-template.md"
            >
              <IconDownload className="size-3.5 text-primary/80" />
              {t("download")}
            </a>
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={reading || importing || disabled}
            onClick={() => zipInputRef.current?.click()}
          >
            <IconFileZip className="size-3.5 text-primary/80" />
            {archive ? t("replaceZip") : t("chooseZip")}
          </Button>
        </div>
        {archive && (
          <section className="space-y-3 rounded-xl bg-input/20 p-4" aria-label={t("zipTitle")}>
            <div className="flex min-w-0 items-center gap-2">
              <IconFileZip className="size-4 shrink-0 text-muted-foreground" />
              <span className="flex-1 truncate text-sm" title={archive.name}>
                {archive.name}
              </span>
              <button
                type="button"
                aria-label={t("removeZip")}
                disabled={importing || reading}
                onClick={() => {
                  setArchive(null);
                  uploaded.current.clear();
                  setError(null);
                }}
                className="grid size-7 place-items-center rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground"
              >
                <IconX className="size-4" />
              </button>
            </div>
            <p className="text-xs text-muted-foreground" role="status">
              {!selection
                ? t("zipWaiting")
                : t("zipSummary", {
                    matched: matches.length - unmatched.length,
                    total: references.length,
                  })}
            </p>
            {unmatched.length > 0 && (
              <ul
                className="max-h-28 space-y-1.5 overflow-y-auto text-xs"
                aria-label={t("zipIssues")}
              >
                {unmatched.map((match) => (
                  <li
                    key={`${match.nodeId}/${match.clipId}`}
                    className="flex justify-between gap-3 text-destructive"
                  >
                    <span className="min-w-0 break-all">{match.filename}</span>
                    <span className="shrink-0">{t(match.status)}</span>
                  </li>
                ))}
              </ul>
            )}
            {selection && !references.length && (
              <p className="text-xs text-muted-foreground">{t("noVideoReferences")}</p>
            )}
          </section>
        )}
        {!archive && references.length > 0 && (
          <p className="text-xs leading-5 text-muted-foreground">
            {t("zipOptional", { count: references.length })}
          </p>
        )}
        {error && (
          <p role="alert" className="break-words text-sm text-destructive">
            {error.message}
          </p>
        )}
        <div className="space-y-2">
          {hasNodes && (
            <label className="flex cursor-pointer items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={replace}
                disabled={disabled || importing}
                onChange={(event) => setReplace(event.currentTarget.checked)}
                className="size-4 shrink-0 accent-primary"
              />
              {t("replaceLabel")}
            </label>
          )}
          <p className="text-xs leading-5 text-muted-foreground" aria-live="polite">
            {t(hasNodes ? (replace ? "replaceHint" : "appendHint") : "emptyHint")}
          </p>
        </div>
        {progress && (
          <div role="status" className="space-y-2">
            <p className="text-xs text-muted-foreground">
              {t(
                progress.phase === "preparing"
                  ? "preparingVideo"
                  : progress.phase === "confirming"
                    ? "confirmingVideo"
                    : "uploadProgress",
                progress
              )}
            </p>
            <progress
              value={progress.phase === "uploading" ? progress.percent : undefined}
              max={100}
              aria-label={t("uploadProgress", progress)}
              className="h-1 w-full overflow-hidden rounded-full bg-muted appearance-none [&::-moz-progress-bar]:bg-foreground/80 [&::-webkit-progress-bar]:bg-muted [&::-webkit-progress-value]:rounded-full [&::-webkit-progress-value]:bg-foreground/80"
            />
          </div>
        )}
        {saving && (
          <p role="status" className="text-xs text-muted-foreground">
            {t("saving")}
          </p>
        )}
        <DialogFooter>
          <Button variant="ghost" disabled={saving} onClick={() => changeOpen(false)}>
            {t(importing && !saving ? "cancelUpload" : "cancel")}
          </Button>
          <Button
            disabled={
              !selection ||
              reading ||
              importing ||
              disabled ||
              unmatched.length > 0 ||
              error?.blocksImport
            }
            onClick={() => void submit()}
          >
            {importing && <IconLoader2 className="size-4 animate-spin" />}
            {saving ? t("saving") : importing ? t("importing") : t("confirm")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
