"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { formatReviewTimecode, type ReviewFinding } from "@/lib/content-review-findings";

export function ContentReviewSidebar({
  findings,
  selectedId,
  onSelect,
  playheadSeconds,
  currentUserId,
  canComment,
  commentBusy,
  commentFocusToken,
  emptyLabel,
  onComment,
}: {
  findings: ReviewFinding[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  playheadSeconds: number;
  currentUserId?: string | number | null;
  canComment: boolean;
  commentBusy: boolean;
  commentFocusToken: number;
  emptyLabel?: string;
  onComment: (body: string) => Promise<boolean> | boolean;
}) {
  const t = useTranslations("studioModes.contentReview");
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const [draft, setDraft] = useState("");

  useEffect(() => {
    if (!commentFocusToken) return;
    inputRef.current?.focus();
  }, [commentFocusToken]);

  const submit = async () => {
    const body = draft.trim();
    if (!body || commentBusy || !canComment) return;
    const saved = await onComment(body);
    if (saved) setDraft("");
  };

  return (
    <aside className="flex min-h-0 flex-col rounded-2xl bg-card lg:min-h-[min(62dvh,760px)] lg:max-h-[min(82dvh,920px)]">
      <header className="flex items-center justify-between px-4 py-3">
        <h2 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
          {t("findingsTitle")}
        </h2>
        <span className="text-[11px] text-muted-foreground">{findings.length}</span>
      </header>
      {findings.length === 0 ? (
        <p className="px-4 pb-4 text-sm text-muted-foreground">
          {emptyLabel ?? t("findingsEmpty")}
        </p>
      ) : (
        <ul className="min-h-0 flex-1 space-y-1 overflow-y-auto px-2 pb-3">
          {findings.map((finding, index) => {
            const active = finding.id === selectedId;
            const mine =
              currentUserId != null &&
              finding.createdByUserId != null &&
              String(currentUserId) === finding.createdByUserId;
            return (
              <li key={finding.id}>
                <button
                  type="button"
                  onClick={() => onSelect(finding.id)}
                  className={cn(
                    "flex w-full gap-3 rounded-xl px-2.5 py-2 text-left transition-colors",
                    active ? "bg-white/[0.08]" : "hover:bg-white/[0.04]"
                  )}
                >
                  <span
                    className={cn(
                      "mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold",
                      finding.source === "comment"
                        ? "bg-white/10 text-[var(--brand-blue)]"
                        : finding.source === "audio"
                          ? "bg-white/10 text-white/80"
                          : "bg-primary/20 text-primary"
                    )}
                  >
                    {index + 1}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2 text-[11px] text-muted-foreground">
                      <span className="tabular-nums">
                        {finding.seconds != null
                          ? formatReviewTimecode(finding.seconds)
                          : t("untimed")}
                      </span>
                      <span>{sourceLabel(finding.source, t)}</span>
                      {mine ? <span>{t("commentYou")}</span> : null}
                    </span>
                    <span className="mt-0.5 block truncate text-sm text-white">
                      {finding.label || finding.description || t("findingUntitled")}
                    </span>
                    {finding.description && finding.label ? (
                      <span className="mt-0.5 line-clamp-2 block text-xs text-white/60">
                        {finding.description}
                      </span>
                    ) : null}
                    {finding.audioText ? (
                      <span className="mt-0.5 line-clamp-2 block text-xs text-white/50">
                        {finding.audioText}
                      </span>
                    ) : null}
                  </span>
                  {finding.frameUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={finding.frameUrl}
                      alt=""
                      className="size-12 shrink-0 rounded-md object-cover"
                    />
                  ) : null}
                </button>
              </li>
            );
          })}
        </ul>
      )}
      <form
        className="mt-auto border-t border-white/10 px-3 py-3"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <p className="mb-2 text-[11px] text-muted-foreground">
          {t("commentAt", { time: formatReviewTimecode(playheadSeconds) })}
        </p>
        <textarea
          ref={inputRef}
          value={draft}
          disabled={commentBusy}
          placeholder={t("commentPlaceholder")}
          rows={2}
          className="w-full resize-none rounded-xl bg-white/[0.06] px-3 py-2 text-sm text-white outline-none placeholder:text-white/35 disabled:opacity-60"
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              void submit();
            }
          }}
        />
        {!canComment ? (
          <p className="mt-2 text-[11px] text-muted-foreground">{t("commentNeedReview")}</p>
        ) : null}
        <button
          type="submit"
          disabled={!canComment || commentBusy || !draft.trim()}
          className="mt-2 rounded-full bg-white/10 px-3 py-1.5 text-xs font-medium text-white hover:bg-white/16 disabled:opacity-40"
        >
          {t("commentSubmit")}
        </button>
      </form>
    </aside>
  );
}

function sourceLabel(
  source: ReviewFinding["source"],
  t: ReturnType<typeof useTranslations>
): string {
  if (source === "audio") return t("sourceAudio");
  if (source === "frame") return t("sourceFrame");
  if (source === "comment") return t("sourceComment");
  return t("sourceOther");
}
