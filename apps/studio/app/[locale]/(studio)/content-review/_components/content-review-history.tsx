"use client";

import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { IconLoader2 } from "@tabler/icons-react";
import { useAuth } from "@/app/_components/auth-provider";
import { useActiveWorkspaceId } from "@/app/_components/workspace-context";
import {
  listContentReviewRecords,
  type ContentReviewRecordSummary,
} from "@/lib/content-review-api";
import { formatReviewTimecode } from "@/lib/content-review-findings";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export const CONTENT_REVIEW_RECORDS_QUERY_KEY = "content-review-records";

export function ContentReviewHistory({
  selectedId,
  onOpen,
  formatSuggestion,
}: {
  selectedId: string | null;
  onOpen: (id: string) => void;
  formatSuggestion: (value: string | null | undefined) => string;
}) {
  const t = useTranslations("studioModes.contentReview");
  const common = useTranslations("common");
  const { user } = useAuth();
  const workspaceId = useActiveWorkspaceId();
  const query = useQuery({
    queryKey: [CONTENT_REVIEW_RECORDS_QUERY_KEY, workspaceId, user?.id ?? null],
    queryFn: ({ signal }) => listContentReviewRecords(signal),
    enabled: Boolean(workspaceId && user),
    staleTime: 15_000,
  });
  const items = query.data ?? [];
  if (!workspaceId || !user) return null;

  return (
    <section className="mt-8">
      <div className="mb-3">
        <h2 className="text-sm font-medium text-white">{t("historyTitle")}</h2>
        <p className="mt-1 text-xs text-muted-foreground">{t("historySubtitle")}</p>
      </div>
      {query.isPending ? (
        <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
          <IconLoader2 className="size-4 animate-spin" stroke={1.8} />
          <span>{t("historyLoading")}</span>
        </div>
      ) : query.isError ? (
        <div role="alert" className="space-y-3 py-6">
          <p className="break-words text-sm text-muted-foreground">
            {query.error instanceof Error && query.error.message.trim()
              ? query.error.message
              : t("historyUnavailable")}
          </p>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={query.isFetching}
            onClick={() => void query.refetch()}
          >
            {query.isFetching ? common("loading") : common("retry")}
          </Button>
        </div>
      ) : items.length === 0 ? (
        <p className="py-6 text-sm text-muted-foreground">{t("historyEmpty")}</p>
      ) : (
        <ul className="divide-y divide-white/8 rounded-2xl bg-white/[0.04]">
          {items.map((item) => (
            <HistoryRow
              key={item.id}
              item={item}
              active={item.id === selectedId}
              isYou={user?.id != null && String(user.id) === item.createdByUserId}
              onOpen={onOpen}
              formatSuggestion={formatSuggestion}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

function HistoryRow({
  item,
  active,
  isYou,
  onOpen,
  formatSuggestion,
}: {
  item: ContentReviewRecordSummary;
  active: boolean;
  isYou: boolean;
  onOpen: (id: string) => void;
  formatSuggestion: (value: string | null | undefined) => string;
}) {
  const t = useTranslations("studioModes.contentReview");
  const suggestion = item.suggestion?.trim().toLowerCase();
  return (
    <li>
      <button
        type="button"
        onClick={() => onOpen(item.id)}
        className={cn(
          "flex w-full flex-col gap-1 px-4 py-3 text-left transition-colors",
          active ? "bg-white/[0.08]" : "hover:bg-white/[0.04]"
        )}
      >
        <span className="flex items-center justify-between gap-3">
          <span className="truncate text-sm text-white">{item.fileName}</span>
          <span
            className={cn(
              "shrink-0 text-xs font-medium",
              suggestion === "block"
                ? "text-red-400"
                : suggestion === "review"
                  ? "text-amber-300"
                  : suggestion === "pass"
                    ? "text-emerald-300"
                    : "text-muted-foreground"
            )}
          >
            {formatSuggestion(item.suggestion)}
          </span>
        </span>
        <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
          <span>{formatReviewTimecode(item.durationSeconds)}</span>
          <span>{t("historyFindings", { count: item.findingCount })}</span>
          <span>{t("creditsCharged", { credits: item.creditsCharged })}</span>
          <span>{isYou ? t("historyYou") : t("historyMember")}</span>
          <span>{formatRecordTime(item.createdAt)}</span>
        </span>
      </button>
    </li>
  );
}

function formatRecordTime(value: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return value;
  return date.toLocaleString();
}
