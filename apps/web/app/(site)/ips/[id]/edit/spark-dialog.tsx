"use client";

/**
 * Spark dialog — two-step AI-assisted IP draft.
 *
 *   step 1 "upload"     drop zone / picker (≤ SPARK_MAX_BYTES, .pdf .doc .docx .txt .md)
 *                       on file pick → auto POST /aurora/spark/analyze
 *   step 2 "review"     editable form (title / description / tags) seeded
 *                       with the AI suggestion. Apply → POST /project/update,
 *                       invalidate the project detail query (the parent
 *                       form re-syncs via its hydrate effect), close dialog.
 *
 * Field set is intentionally narrow (title / description / tags) —
 * matches the Nest endpoint's contract. Reintroduce extra fields here
 * only when the backend grows them.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import {
  IconAlertCircle,
  IconLoader2,
  IconRefresh,
  IconSparkles,
  IconUpload,
  IconX,
} from "@tabler/icons-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
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
  SPARK_MAX_BYTES,
  useIPTagList,
  useSparkAnalyze,
  useSparkGenerateBanner,
  useUpdateProject,
} from "@/app/(site)/ips/_hooks/use-ip";

const SPARK_HERO_URL = encodeURI(
  "https://static.fizzspace.cn/static/pc/ChatGPT Image 2026年4月30日 12_47_51.png"
);

const ACCEPT = ".pdf,.doc,.docx,.txt,.md,application/pdf,text/plain,text/markdown";

interface SparkDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
}

type Phase = "upload" | "analyzing" | "review" | "error";

interface DraftForm {
  name: string;
  description: string;
  /** Tag IDs picked from the backend catalog. AI returns names (strings);
   *  on analyze we fuzzy-match them to backend tags and pre-select the
   *  matched IDs. Anything that didn't match is surfaced separately
   *  as an info hint so the user knows what was dropped. */
  tagIds: number[];
  /** Hidden English image-gen prompt the AI produced alongside the
   *  metadata. Never displayed verbatim; only used as input to the
   *  banner-generation call. */
  bannerPrompt: string;
  /** OSS path of the generated banner image (relative key, not URL).
   *  Empty until the user clicks "Generate". Sent to /project/update
   *  on Apply when set. */
  bannerLink: string;
}

const EMPTY_DRAFT: DraftForm = {
  name: "",
  description: "",
  tagIds: [],
  bannerPrompt: "",
  bannerLink: "",
};

/** Case + whitespace-insensitive match. Chinese punctuation also folded
 *  in case Qwen returns "科幻、悬疑" style joined entries. */
function normalize(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .replace(/[\s　]/g, "");
}

function bytesToMB(bytes: number): string {
  return (bytes / (1024 * 1024)).toFixed(0);
}

export function SparkDialog({ open, onOpenChange, projectId }: SparkDialogProps) {
  const t = useTranslations("ipEdit");
  const tc = useTranslations("common");

  const [phase, setPhase] = useState<Phase>("upload");
  const [errorMsg, setErrorMsg] = useState<string>("");
  const [draft, setDraft] = useState<DraftForm>(EMPTY_DRAFT);
  /** Names AI proposed that didn't map to any backend tag. Surfaced as
   *  a small info hint so the user understands why their suggestion
   *  count dropped — and can ask the platform to add them later. */
  const [unmatchedTagNames, setUnmatchedTagNames] = useState<string[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const analyze = useSparkAnalyze();
  const generateBanner = useSparkGenerateBanner();
  const update = useUpdateProject();
  const { data: tagCatalog = [] } = useIPTagList();

  // Quick lookup: normalized tag name → backend id. Built once per
  // catalog change. Catalog is small (~80 entries) so the cost is
  // trivial, but the lookup runs once per AI response and once per
  // badge render, so caching matters.
  const tagByName = useMemo(() => {
    const map = new Map<string, number>();
    for (const tag of tagCatalog) map.set(normalize(tag.name), tag.id);
    return map;
  }, [tagCatalog]);

  // Reset on open. Without this, a previous Apply leaves stale draft
  // values in state when the user re-opens the dialog.
  useEffect(() => {
    if (!open) return;
    setPhase("upload");
    setErrorMsg("");
    setDraft(EMPTY_DRAFT);
    setUnmatchedTagNames([]);
  }, [open]);

  const handleFile = async (file: File) => {
    if (file.size > SPARK_MAX_BYTES) {
      toast.error(t("sparkFileTooLarge", { mb: bytesToMB(SPARK_MAX_BYTES) }));
      return;
    }
    setPhase("analyzing");
    setErrorMsg("");
    try {
      const result = await analyze.mutateAsync(file);
      // Match AI's free-form tag names against the backend catalog.
      // De-dupe and preserve the catalog's id-order on the picked set
      // so the selected badges read consistently no matter what order
      // Qwen returned them in.
      const matchedIds = new Set<number>();
      const unmatched: string[] = [];
      for (const name of result.tags ?? []) {
        const id = tagByName.get(normalize(name));
        if (id !== undefined) matchedIds.add(id);
        else if (name.trim()) unmatched.push(name.trim());
      }
      setDraft({
        name: result.name ?? "",
        description: result.description ?? "",
        tagIds: Array.from(matchedIds),
        bannerPrompt: result.bannerPrompt ?? "",
        bannerLink: "",
      });
      setUnmatchedTagNames(unmatched);
      setPhase("review");
    } catch (err) {
      setErrorMsg(err instanceof Error && err.message ? err.message : t("sparkAnalyzeFailed"));
      setPhase("error");
    }
  };

  const handleGenerateBanner = async () => {
    if (!draft.bannerPrompt) {
      toast.warning(t("sparkBannerNoPrompt"));
      return;
    }
    try {
      const link = await generateBanner.mutateAsync({
        projectId,
        prompt: draft.bannerPrompt,
      });
      if (!link) throw new Error("Empty banner");
      setDraft((d) => ({ ...d, bannerLink: link }));
    } catch (err) {
      const msg = err instanceof Error ? err.message : "";
      toast.error(msg || t("sparkBannerFailed"));
    }
  };

  const toggleTag = (id: number) => {
    setDraft((d) =>
      d.tagIds.includes(id)
        ? { ...d, tagIds: d.tagIds.filter((x) => x !== id) }
        : { ...d, tagIds: [...d.tagIds, id] }
    );
  };

  const handleApply = () => {
    const name = draft.name.trim();
    if (!name) {
      toast.warning(t("nameRequired"));
      return;
    }
    update.mutate(
      {
        id: Number(projectId),
        name,
        description: draft.description.trim(),
        // Backend expects `tag` as `JSON.stringify(numericIds[])` —
        // the same shape the manual edit page uses on Save.
        tag: JSON.stringify(draft.tagIds),
        // Only include bannerLink when the user actually generated one
        // — passing an empty string here would clear an existing banner
        // and that's never the user's intent inside Spark.
        ...(draft.bannerLink ? { bannerLink: draft.bannerLink } : {}),
      },
      {
        onSuccess: () => {
          toast.success(t("sparkApplied"));
          onOpenChange(false);
        },
        onError: (err) => {
          const msg = err instanceof Error ? err.message : "";
          toast.error(msg || t("saveFailed"));
        },
      }
    );
  };

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
              <span className="text-xs text-muted-foreground/70">
                {t("sparkDropzoneHint", { mb: bytesToMB(SPARK_MAX_BYTES) })}
              </span>
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

          {phase === "review" && (
            <div className="space-y-5">
              <div>
                <p className="text-sm font-semibold text-foreground">{t("sparkReviewTitle")}</p>
                <p className="mt-1 text-xs text-muted-foreground">{t("sparkReviewDesc")}</p>
              </div>

              <div className="space-y-2">
                <label className="block text-xs font-semibold text-foreground">
                  {t("sparkFieldName")}
                </label>
                <Input
                  value={draft.name}
                  onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value.slice(0, 80) }))}
                  className="h-10"
                />
              </div>

              <div className="space-y-2">
                <label className="block text-xs font-semibold text-foreground">
                  {t("sparkFieldDescription")}
                </label>
                <Textarea
                  value={draft.description}
                  onChange={(e) =>
                    setDraft((d) => ({ ...d, description: e.target.value.slice(0, 500) }))
                  }
                  rows={4}
                />
                <span className="block text-right text-xs text-muted-foreground">
                  {draft.description.length}/500
                </span>
              </div>

              <div className="space-y-2">
                <div className="flex items-baseline justify-between">
                  <label className="block text-xs font-semibold text-foreground">
                    {t("sparkFieldTags")}
                  </label>
                  <span className="text-xs text-muted-foreground">
                    {t("sparkTagsSelected", { count: draft.tagIds.length })}
                  </span>
                </div>
                {tagCatalog.length === 0 ? (
                  <p className="rounded-md border border-dashed border-border bg-card/40 px-3 py-2 text-xs text-muted-foreground">
                    {t("sparkTagsCatalogEmpty")}
                  </p>
                ) : (
                  <div className="max-h-44 overflow-y-auto rounded-md border border-border bg-card/40 p-2">
                    <div className="flex flex-wrap gap-1.5">
                      {tagCatalog.map((tag) => {
                        const active = draft.tagIds.includes(tag.id);
                        return (
                          <button
                            key={tag.id}
                            type="button"
                            onClick={() => toggleTag(tag.id)}
                            className={cn(
                              "rounded-full px-2.5 py-1 text-xs font-medium transition-colors",
                              active
                                ? "bg-primary/15 text-primary ring-1 ring-inset ring-primary/40"
                                : "bg-muted/40 text-muted-foreground hover:bg-muted/70 hover:text-foreground"
                            )}
                          >
                            {tag.name}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
                {unmatchedTagNames.length > 0 && (
                  <p className="text-xs text-muted-foreground">
                    {t("sparkTagsUnmatched", {
                      names: unmatchedTagNames.join("、"),
                    })}
                  </p>
                )}
              </div>

              {/* Banner — opt-in, generated from the hidden English
               *  bannerPrompt the analyzer produced. Empty preview
               *  square + button when nothing's been generated yet. */}
              <div className="space-y-2">
                <label className="block text-xs font-semibold text-foreground">
                  {t("sparkFieldBanner")}
                </label>
                <div className="flex items-start gap-3">
                  <div className="aspect-video w-44 shrink-0 overflow-hidden rounded-md border border-border bg-muted/40">
                    {draft.bannerLink ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={ipImageUrl(draft.bannerLink)}
                        alt=""
                        className="size-full object-cover"
                      />
                    ) : (
                      <div className="flex size-full items-center justify-center text-muted-foreground/50">
                        <IconSparkles className="size-6" />
                      </div>
                    )}
                  </div>
                  <div className="flex-1 space-y-2">
                    <Button
                      size="sm"
                      variant="outline"
                      color="muted"
                      onClick={handleGenerateBanner}
                      disabled={generateBanner.isPending || !draft.bannerPrompt}
                    >
                      {generateBanner.isPending ? (
                        <>
                          <IconLoader2 className="size-3.5 animate-spin" />
                          {t("sparkBannerGenerating")}
                        </>
                      ) : (
                        <>
                          <IconSparkles className="size-3.5" />
                          {draft.bannerLink ? t("sparkBannerRegenerate") : t("sparkBannerGenerate")}
                        </>
                      )}
                    </Button>
                    <p className="text-xs text-muted-foreground">{t("sparkBannerHint")}</p>
                  </div>
                </div>
              </div>

              <button
                type="button"
                onClick={() => {
                  setDraft(EMPTY_DRAFT);
                  setPhase("upload");
                }}
                className="inline-flex items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
              >
                <IconX className="size-3" />
                {t("sparkRestart")}
              </button>
            </div>
          )}
        </DialogBody>

        <DialogFooter className="sm:items-center">
          <Button
            variant="outline"
            color="muted"
            onClick={() => onOpenChange(false)}
            disabled={phase === "analyzing" || update.isPending}
          >
            {tc("cancel")}
          </Button>
          {phase === "review" && (
            <Button onClick={handleApply} disabled={update.isPending || !draft.name.trim()}>
              {update.isPending ? (
                <IconLoader2 className="size-3.5 animate-spin" />
              ) : (
                <IconSparkles className="size-3.5" />
              )}
              {t("sparkApply")}
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
