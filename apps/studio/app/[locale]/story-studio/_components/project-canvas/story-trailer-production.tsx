"use client";

import { useId, useState } from "react";
import {
  IconCheck,
  IconChevronDown,
  IconLoader2,
  IconPlayerPlay,
  IconRefresh,
  IconStarFilled,
} from "@tabler/icons-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type {
  FilmReferenceSlot,
  FilmReviewChecklistValue,
  FilmReviewDecision,
  FilmTrailerReviewChecklist,
  FilmTrailerSummary,
  FilmTrailerTake,
} from "@/lib/story-projects-api";
import { cn } from "@/lib/utils";
import type { StoryReferenceBindingInput } from "./story-clip-reference-bindings-model";
import { validateTrailerReviewSubmission } from "./story-trailer-production-model";

const REVIEW_KEYS = [
  "technical",
  "storyFidelity",
  "identityConsistency",
  "visualConsistency",
  "pacing",
  "textReadability",
  "rights",
  "safety",
] as const satisfies readonly (keyof FilmTrailerReviewChecklist)[];

const PASSING_REVIEW: FilmTrailerReviewChecklist = {
  technical: "pass",
  storyFidelity: "pass",
  identityConsistency: "pass",
  visualConsistency: "pass",
  pacing: "pass",
  textReadability: "pass",
  rights: "pass",
  safety: "pass",
};

export interface StoryTrailerProductionProps {
  trailer: FilmTrailerSummary;
  references: FilmReferenceSlot[];
  takes: FilmTrailerTake[];
  loading: boolean;
  refreshing: boolean;
  pendingKey: string | null;
  error: string | null;
  referenceBindingsPending: boolean;
  canGenerateActions: boolean;
  generateDisabledReason: string | null;
  canReviewActions: boolean;
  reviewDisabledReason: string | null;
  onRefresh: () => void;
  onCancel: (take: FilmTrailerTake) => void;
  onRetry: (take: FilmTrailerTake) => void;
  onReview: (
    take: FilmTrailerTake,
    decision: FilmReviewDecision,
    checklist: FilmTrailerReviewChecklist,
    comment?: string
  ) => Promise<boolean>;
  onSetMaster: (take: FilmTrailerTake) => void;
  onUpdateReferenceBindings: (bindings: StoryReferenceBindingInput[]) => void;
}

export function StoryTrailerTakePanel({
  trailer,
  takes,
  loading,
  refreshing,
  pendingKey,
  error,
  canGenerateActions,
  generateDisabledReason,
  canReviewActions,
  reviewDisabledReason,
  onRefresh,
  onCancel,
  onRetry,
  onReview,
  onSetMaster,
}: StoryTrailerProductionProps) {
  const t = useTranslations("storyStudio.canvas.trailer.production");
  const permissionHelpId = useId();
  const [expanded, setExpanded] = useState(false);
  const [reviewTakeId, setReviewTakeId] = useState<string | null>(null);
  const [decision, setDecision] = useState<FilmReviewDecision>("approve");
  const [checklist, setChecklist] = useState<FilmTrailerReviewChecklist>(PASSING_REVIEW);
  const [comment, setComment] = useState("");
  const [validationError, setValidationError] = useState<string | null>(null);
  const reviewTake = reviewTakeId ? (takes.find((take) => take.id === reviewTakeId) ?? null) : null;

  const closeReview = () => {
    setReviewTakeId(null);
    setDecision("approve");
    setChecklist(PASSING_REVIEW);
    setComment("");
    setValidationError(null);
  };

  const submitReview = async () => {
    if (!reviewTake) return;
    const validation = validateTrailerReviewSubmission(decision, checklist, comment);
    if (validation) {
      setValidationError(
        t(
          validation === "comment_required"
            ? "review.commentRequired"
            : "review.approveRequirements"
        )
      );
      return;
    }
    setValidationError(null);
    const succeeded = await onReview(reviewTake, decision, checklist, comment.trim() || undefined);
    if (succeeded) closeReview();
  };

  return (
    <section className="mt-5 rounded-[18px] bg-black/18 p-3">
      <div className="flex items-center gap-2">
        <button
          type="button"
          className="flex min-w-0 flex-1 items-center justify-between gap-3 text-left"
          onClick={() => setExpanded((open) => !open)}
          aria-expanded={expanded}
        >
          <span>
            <span className="block text-[10px] font-semibold text-white/58">
              {t("takes.title")}
            </span>
            <span className="mt-0.5 block text-[9px] text-white/28">
              {t("takes.count", { count: takes.length })}
            </span>
          </span>
          <IconChevronDown
            className={cn("size-3.5 text-white/34 transition", expanded && "rotate-180")}
          />
        </button>
        {expanded ? (
          <button
            type="button"
            onClick={onRefresh}
            disabled={refreshing}
            className="grid size-8 place-items-center rounded-xl bg-white/[0.06] text-white/42"
            aria-label={t("refresh")}
          >
            <IconRefresh className={cn("size-3.5", refreshing && "animate-spin")} />
          </button>
        ) : null}
      </div>

      {!canGenerateActions || !canReviewActions ? (
        <p id={permissionHelpId} className="mt-2 text-[9px] leading-4 text-white/34">
          {[
            !canGenerateActions ? generateDisabledReason : null,
            !canReviewActions ? reviewDisabledReason : null,
          ]
            .filter(Boolean)
            .join(" ")}
        </p>
      ) : null}

      {expanded && loading ? (
        <div className="grid h-20 place-items-center">
          <IconLoader2 className="size-4 animate-spin text-white/34" />
        </div>
      ) : expanded && takes.length === 0 ? (
        <div className="mt-3 grid h-20 place-items-center rounded-xl bg-white/[0.035] text-[9px] text-white/28">
          {t("takes.empty")}
        </div>
      ) : expanded ? (
        <div className="mt-3 space-y-2">
          {takes.map((take) => {
            const master = trailer.master?.takeId === take.id;
            const running = ["queued", "running", "processing"].includes(take.status);
            return (
              <article key={take.id} className="overflow-hidden rounded-xl bg-white/[0.04]">
                <div
                  className="relative bg-black/30"
                  style={{
                    aspectRatio:
                      trailer.outputContract.aspectRatio === "9:16" ? "9 / 16" : "16 / 9",
                  }}
                >
                  {take.outputAsset?.previewUrl ? (
                    <video
                      src={take.outputAsset.previewUrl}
                      controls
                      playsInline
                      preload="metadata"
                      className="size-full object-cover"
                    />
                  ) : (
                    <div className="flex size-full flex-col items-center justify-center gap-2 text-white/26">
                      {running ? (
                        <IconLoader2 className="size-5 animate-spin" />
                      ) : (
                        <IconPlayerPlay className="size-5" />
                      )}
                      <span className="text-[9px]">{t(`statuses.${take.status}`)}</span>
                    </div>
                  )}
                  {master ? (
                    <span className="absolute top-2 left-2 flex items-center gap-1 rounded-full bg-white/90 px-2 py-1 text-[8px] font-semibold text-black">
                      <IconStarFilled className="size-2.5" />
                      {t("takes.master")}
                    </span>
                  ) : null}
                </div>
                <div className="p-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[10px] font-semibold text-white/68">
                      {t("takes.take", { number: take.number })}
                    </span>
                    <span className="text-[8px] text-white/30">{t(`statuses.${take.status}`)}</span>
                  </div>
                  <div className="mt-2 flex gap-1.5">
                    {running ? (
                      <TrailerAction
                        disabled={!canGenerateActions || pendingKey === `cancel:${take.id}`}
                        aria-describedby={!canGenerateActions ? permissionHelpId : undefined}
                        onClick={() => onCancel(take)}
                      >
                        {t("takes.cancel")}
                      </TrailerAction>
                    ) : null}
                    {take.status === "ready" && take.reviewStatus !== "approved" ? (
                      <TrailerAction
                        disabled={!canReviewActions}
                        aria-describedby={!canReviewActions ? permissionHelpId : undefined}
                        onClick={() => {
                          setValidationError(null);
                          setReviewTakeId(take.id);
                        }}
                      >
                        {t("takes.review")}
                      </TrailerAction>
                    ) : null}
                    {(take.status === "failed" || take.status === "cancelled") && (
                      <TrailerAction
                        disabled={!canGenerateActions || pendingKey === `retry:${take.id}`}
                        aria-describedby={!canGenerateActions ? permissionHelpId : undefined}
                        onClick={() => onRetry(take)}
                      >
                        {t("takes.retry")}
                      </TrailerAction>
                    )}
                    {take.reviewStatus === "approved" && !take.stale && !master ? (
                      <TrailerAction
                        emphasized
                        disabled={!canGenerateActions || pendingKey === `master:${take.id}`}
                        aria-describedby={!canGenerateActions ? permissionHelpId : undefined}
                        onClick={() => onSetMaster(take)}
                      >
                        {t("takes.setMaster")}
                      </TrailerAction>
                    ) : null}
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      ) : null}
      {expanded && error ? <p className="mt-2 text-[9px] text-destructive">{error}</p> : null}

      <Dialog
        open={Boolean(reviewTake)}
        onOpenChange={(open) => {
          if (!open && !pendingKey?.startsWith("review:")) closeReview();
        }}
      >
        <DialogContent className="max-h-[86vh] max-w-xl overflow-y-auto rounded-[24px] bg-[oklch(0.22_0_0/0.98)] p-5">
          <DialogHeader>
            <DialogTitle>{t("review.title")}</DialogTitle>
            <DialogDescription>{t("review.description")}</DialogDescription>
          </DialogHeader>
          <Select
            value={decision}
            onValueChange={(value) => setDecision(value as FilmReviewDecision)}
          >
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="approve">{t("review.decisions.approve")}</SelectItem>
              <SelectItem value="request_changes">
                {t("review.decisions.requestChanges")}
              </SelectItem>
              <SelectItem value="reject">{t("review.decisions.reject")}</SelectItem>
            </SelectContent>
          </Select>
          <div className="grid grid-cols-2 gap-2">
            {REVIEW_KEYS.map((key) => (
              <label
                key={key}
                className="rounded-xl bg-white/[0.04] p-2.5 text-[10px] text-white/52"
              >
                {t(`review.checklist.${key}`)}
                <Select
                  value={checklist[key]}
                  onValueChange={(value) =>
                    setChecklist({ ...checklist, [key]: value as FilmReviewChecklistValue })
                  }
                >
                  <SelectTrigger className="mt-2 h-8! w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="pass">{t("review.values.pass")}</SelectItem>
                    <SelectItem value="fail">{t("review.values.fail")}</SelectItem>
                    <SelectItem value="na">{t("review.values.na")}</SelectItem>
                  </SelectContent>
                </Select>
              </label>
            ))}
          </div>
          <Textarea
            value={comment}
            onChange={(event) => setComment(event.target.value)}
            placeholder={t("review.comment")}
            rows={3}
            className="resize-none"
          />
          {validationError || error ? (
            <p className="text-[10px] leading-4 text-destructive">{validationError ?? error}</p>
          ) : null}
          <DialogFooter>
            <Button
              variant="secondary"
              disabled={Boolean(reviewTake && pendingKey === `review:${reviewTake.id}`)}
              onClick={closeReview}
            >
              {t("review.cancel")}
            </Button>
            <Button
              disabled={
                !canReviewActions || !reviewTake || pendingKey === `review:${reviewTake.id}`
              }
              aria-describedby={!canReviewActions ? permissionHelpId : undefined}
              onClick={() => void submitReview()}
            >
              <IconCheck className="size-4" />
              {t("review.submit")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}

function TrailerAction({
  children,
  emphasized = false,
  ...props
}: React.ComponentProps<"button"> & { emphasized?: boolean }) {
  return (
    <button
      type="button"
      className={cn(
        "h-7 rounded-lg bg-white/[0.07] px-2.5 text-[9px] font-semibold text-white/58 disabled:opacity-40",
        emphasized && "bg-white/[0.12] text-white/78"
      )}
      {...props}
    >
      {children}
    </button>
  );
}
