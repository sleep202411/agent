"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  IconLoader2,
  IconSparkles,
  IconUpload,
  IconRefresh,
  IconAlertCircle,
} from "@tabler/icons-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHero,
} from "@/components/ui/dialog";
import { useTranslations } from "@/src/i18n/i18n";
import { cn } from "@/lib/utils";
import {
  ipImageUrl,
  useSparkAnalyze,
  useSparkGenerateBanner,
  type SparkDraft,
} from "@/app/(site)/ips/_hooks/use-ip";

const SPARK_HERO_URL = encodeURI(
  "https://static.fizzspace.cn/static/pc/ChatGPT Image 2026年4月30日 12_47_51.png"
);

const ACCEPT = ".pdf,.doc,.docx,.txt,.md,application/pdf,text/plain,text/markdown";
const MAX_BYTES = 20 * 1024 * 1024;

/** Snapshot of the current form values the dialog needs to diff against
 *  the AI suggestion, plus the slot Spark fills if the user generates a
 *  banner. The dialog is read-only against this snapshot — the parent
 *  applies the chosen patch on Apply via `onApply`. */
export interface SparkCurrent {
  name: string;
  description: string;
  background: string;
  story: string;
  whyThisIP: string;
  tags: string[];
  bannerLink: string;
}

/** Keys the dialog can apply onto the parent's form state. Banner is a
 *  separate field because Spark uploads its generated image to OSS and
 *  surfaces only the wire `bannerLink` (an OSS key, not a full URL). */
export type SparkPatch = Partial<{
  name: string;
  description: string;
  background: string;
  story: string;
  whyThisIP: string;
  tags: string[];
  bannerLink: string;
}>;

interface SparkDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  current: SparkCurrent;
  onApply: (patch: SparkPatch) => void;
}

type Phase = "upload" | "analyzing" | "review" | "error";

interface FieldRow {
  key: keyof SparkCurrent;
  labelKey: string;
  current: string | string[];
  suggested: string | string[];
  /** True when the suggestion is non-empty AND differs from current. */
  hasChange: boolean;
}

function eqValue(a: string | string[], b: string | string[]): boolean {
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    return a.every((v, i) => v === b[i]);
  }
  return a === b;
}

function isEmpty(v: string | string[]): boolean {
  if (Array.isArray(v)) return v.length === 0;
  return !v.trim();
}

function buildRows(current: SparkCurrent, draft: SparkDraft): FieldRow[] {
  const map: Array<[keyof SparkCurrent, string, string | string[], string | string[] | undefined]> =
    [
      ["name", "sparkFieldName", current.name, draft.name],
      ["description", "sparkFieldDescription", current.description, draft.description],
      ["background", "sparkFieldBackground", current.background, draft.background],
      ["story", "sparkFieldStory", current.story, draft.story],
      ["whyThisIP", "sparkFieldWhyThisIP", current.whyThisIP, draft.whyThisIP],
      ["tags", "sparkFieldTags", current.tags, draft.tags],
    ];
  return map.map(([key, labelKey, cur, sug]) => {
    const suggested = sug ?? (Array.isArray(cur) ? [] : "");
    return {
      key,
      labelKey,
      current: cur,
      suggested,
      hasChange: !isEmpty(suggested) && !eqValue(cur, suggested),
    };
  });
}

export function SparkDialog({ open, onOpenChange, projectId, current, onApply }: SparkDialogProps) {
  const t = useTranslations("ipEdit");
  const tc = useTranslations("common");

  const [phase, setPhase] = useState<Phase>("upload");
  const [errorMsg, setErrorMsg] = useState<string>("");
  const [draft, setDraft] = useState<SparkDraft | null>(null);
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [generatedBanner, setGeneratedBanner] = useState<string>("");
  const [includeBanner, setIncludeBanner] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const analyze = useSparkAnalyze();
  const generateBanner = useSparkGenerateBanner();

  // Reset on open. The parent unmounts the dialog when closed via key,
  // but we also reset internal state so re-opening starts fresh.
  useEffect(() => {
    if (!open) return;
    setPhase("upload");
    setErrorMsg("");
    setDraft(null);
    setSelected({});
    setGeneratedBanner("");
    setIncludeBanner(false);
  }, [open]);

  const rows = useMemo<FieldRow[]>(() => {
    if (!draft) return [];
    return buildRows(current, draft);
  }, [current, draft]);

  // Default-check every field that actually carries a change. Empty
  // suggestions or unchanged ones default to off so the user isn't
  // tricked into a no-op apply.
  useEffect(() => {
    if (!draft) return;
    const next: Record<string, boolean> = {};
    for (const row of rows) next[row.key] = row.hasChange;
    setSelected(next);
  }, [draft, rows]);

  const handleFile = async (file: File) => {
    if (file.size > MAX_BYTES) {
      toast.error(tc("uploadTooLarge"));
      return;
    }
    setPhase("analyzing");
    setErrorMsg("");
    try {
      const result = await analyze.mutateAsync(file);
      setDraft(result);
      setPhase("review");
    } catch (err) {
      setErrorMsg(err instanceof Error && err.message ? err.message : t("sparkAnalyzeFailed"));
      setPhase("error");
    }
  };

  const handleGenerateBanner = async () => {
    if (!draft?.bannerPrompt) return;
    try {
      const banner = await generateBanner.mutateAsync({
        projectId,
        prompt: draft.bannerPrompt,
      });
      if (!banner) throw new Error("Empty banner");
      setGeneratedBanner(banner);
      setIncludeBanner(true);
    } catch (err) {
      toast.error(err instanceof Error && err.message ? err.message : t("sparkBannerFailed"));
    }
  };

  const applicableCount = useMemo(() => {
    let n = 0;
    for (const row of rows) {
      if (selected[row.key] && row.hasChange) n++;
    }
    if (includeBanner && generatedBanner) n++;
    return n;
  }, [rows, selected, includeBanner, generatedBanner]);

  const handleApply = () => {
    if (applicableCount === 0) {
      toast.warning(t("sparkNoSelection"));
      return;
    }
    const patch: SparkPatch = {};
    for (const row of rows) {
      if (!selected[row.key] || !row.hasChange) continue;
      const v = row.suggested;
      switch (row.key) {
        case "name":
        case "description":
        case "background":
        case "story":
        case "whyThisIP":
          if (typeof v === "string") patch[row.key] = v;
          break;
        case "tags":
          if (Array.isArray(v)) patch.tags = v;
          break;
        case "bannerLink":
          // handled separately
          break;
      }
    }
    if (includeBanner && generatedBanner) patch.bannerLink = generatedBanner;
    onApply(patch);
    toast.success(t("sparkApplied", { count: applicableCount }));
    onOpenChange(false);
  };

  const hasAnySuggestion = rows.some((r) => r.hasChange) || !!draft?.bannerPrompt;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="overflow-hidden p-0 sm:max-w-2xl">
        <DialogHero
          src={SPARK_HERO_URL}
          eyebrow={t("spark")}
          title={t("sparkDialogTitle")}
          description={t("sparkDialogDescription")}
        />

        <DialogBody className="max-h-[60vh] overflow-y-auto py-4">
          {phase === "upload" && (
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              onDragOver={(e) => {
                e.preventDefault();
                setDragOver(true);
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragOver(false);
                const file = e.dataTransfer.files?.[0];
                if (file) void handleFile(file);
              }}
              className={cn(
                "flex w-full flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-border bg-card/40 px-6 py-12 text-muted-foreground transition-colors hover:border-primary/50 hover:bg-card/60",
                dragOver && "border-primary/60 bg-primary/5 text-primary"
              )}
            >
              <IconUpload className="size-8" />
              <span className="text-sm font-medium">{t("sparkDropzoneTitle")}</span>
              <span className="text-xs text-muted-foreground/70">{t("sparkDropzoneHint")}</span>
            </button>
          )}

          {phase === "analyzing" && (
            <div className="flex flex-col items-center justify-center gap-3 py-16 text-muted-foreground">
              <IconSparkles className="size-8 animate-pulse text-primary" />
              <span className="text-sm font-medium text-foreground">{t("sparkAnalyzing")}</span>
              <span className="text-xs">{t("sparkAnalyzingHint")}</span>
            </div>
          )}

          {phase === "error" && (
            <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
              <IconAlertCircle className="size-8 text-destructive" />
              <span className="text-sm font-medium text-foreground">{t("sparkAnalyzeFailed")}</span>
              <span className="text-xs text-muted-foreground">{errorMsg}</span>
              <Button variant="outline" color="muted" size="sm" onClick={() => setPhase("upload")}>
                <IconRefresh className="size-3.5" />
                {t("sparkRetry")}
              </Button>
            </div>
          )}

          {phase === "review" && draft && (
            <div className="space-y-4">
              {!hasAnySuggestion ? (
                <div className="rounded-xl border border-dashed border-border bg-card/40 px-4 py-10 text-center text-sm text-muted-foreground">
                  {t("sparkNoSuggestions")}
                </div>
              ) : (
                <>
                  <div>
                    <p className="text-sm font-semibold text-foreground">{t("sparkReviewTitle")}</p>
                    <p className="mt-1 text-xs text-muted-foreground">{t("sparkReviewDesc")}</p>
                  </div>

                  <div className="space-y-2">
                    {rows.map((row) => (
                      <FieldDiffRow
                        key={row.key as string}
                        row={row}
                        checked={!!selected[row.key]}
                        onCheckedChange={(c) =>
                          setSelected((s) => ({ ...s, [row.key]: c && row.hasChange }))
                        }
                        labels={{
                          label: t(row.labelKey),
                          current: t("sparkCurrent"),
                          suggested: t("sparkSuggested"),
                        }}
                      />
                    ))}
                  </div>

                  {!!draft.bannerPrompt && (
                    <div className="space-y-3 rounded-xl border border-border bg-card p-4">
                      <div>
                        <p className="text-sm font-semibold text-foreground">
                          {t("sparkBannerSection")}
                        </p>
                        <p className="mt-1 text-xs text-muted-foreground">{t("sparkBannerHint")}</p>
                      </div>
                      <div className="rounded-md bg-muted/40 px-3 py-2 text-xs leading-relaxed text-muted-foreground">
                        {draft.bannerPrompt}
                      </div>
                      <div className="flex items-start gap-3">
                        <div className="flex aspect-video w-32 shrink-0 items-center justify-center overflow-hidden rounded-md bg-muted/40">
                          {generatedBanner ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={ipImageUrl(generatedBanner)}
                              alt=""
                              className="size-full object-cover"
                            />
                          ) : current.bannerLink ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={ipImageUrl(current.bannerLink)}
                              alt=""
                              className="size-full object-cover opacity-50"
                            />
                          ) : (
                            <IconSparkles className="size-5 text-muted-foreground/50" />
                          )}
                        </div>
                        <div className="flex-1 space-y-2">
                          <Button
                            size="sm"
                            variant="outline"
                            color="muted"
                            onClick={handleGenerateBanner}
                            disabled={generateBanner.isPending}
                          >
                            {generateBanner.isPending ? (
                              <>
                                <IconLoader2 className="size-3.5 animate-spin" />
                                {t("sparkGeneratingBanner")}
                              </>
                            ) : (
                              <>
                                <IconSparkles className="size-3.5" />
                                {t("sparkGenerateBanner")}
                              </>
                            )}
                          </Button>
                          {generatedBanner && (
                            <label className="flex items-center gap-2 text-xs text-foreground">
                              <Checkbox
                                checked={includeBanner}
                                onCheckedChange={(c) => setIncludeBanner(c === true)}
                              />
                              {t("sparkBannerReady")}
                            </label>
                          )}
                        </div>
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          )}
        </DialogBody>

        <DialogFooter className="sm:items-center">
          <Button
            variant="outline"
            color="muted"
            onClick={() => onOpenChange(false)}
            disabled={phase === "analyzing"}
          >
            {tc("cancel")}
          </Button>
          {phase === "review" && (
            <Button onClick={handleApply} disabled={applicableCount === 0}>
              <IconSparkles className="size-3.5" />
              {t("sparkApply")} {applicableCount > 0 ? `(${applicableCount})` : ""}
            </Button>
          )}
        </DialogFooter>

        <input
          ref={fileInputRef}
          type="file"
          accept={ACCEPT}
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void handleFile(file);
            e.target.value = "";
          }}
        />
      </DialogContent>
    </Dialog>
  );
}

function FieldDiffRow({
  row,
  checked,
  onCheckedChange,
  labels,
}: {
  row: FieldRow;
  checked: boolean;
  onCheckedChange: (c: boolean) => void;
  labels: { label: string; current: string; suggested: string };
}) {
  const renderValue = (v: string | string[]): string => {
    if (Array.isArray(v)) return v.length > 0 ? v.join(", ") : "—";
    return v.trim() || "—";
  };
  return (
    <div
      className={cn(
        "flex items-start gap-3 rounded-xl border p-3 transition-colors",
        row.hasChange ? "border-border bg-card" : "border-border/40 bg-card/40 opacity-60"
      )}
    >
      <Checkbox
        className="mt-0.5"
        checked={checked && row.hasChange}
        onCheckedChange={(c) => onCheckedChange(c === true)}
        disabled={!row.hasChange}
      />
      <div className="min-w-0 flex-1 space-y-2">
        <p className="text-xs font-semibold text-foreground">{labels.label}</p>
        <div className="grid grid-cols-2 gap-3 text-xs">
          <div className="space-y-1">
            <p className="text-[10px] uppercase tracking-wide text-muted-foreground/70">
              {labels.current}
            </p>
            <p className="line-clamp-3 whitespace-pre-wrap text-muted-foreground">
              {renderValue(row.current)}
            </p>
          </div>
          <div className="space-y-1">
            <p className="text-[10px] uppercase tracking-wide text-primary/70">
              {labels.suggested}
            </p>
            <p
              className={cn(
                "line-clamp-3 whitespace-pre-wrap",
                row.hasChange ? "text-foreground" : "text-muted-foreground"
              )}
            >
              {renderValue(row.suggested)}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
