"use client";
import {
  IconFlask,
  IconMovie,
  IconCircleCheck,
  IconAlertCircle,
  IconScript,
} from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
import { useCurrentUser } from "@/src/hooks/use-user";
import { useTranslations } from "@/src/i18n/i18n";
import { api } from "@/src/lib/api";

export function IpProductionStage({ ipId, compact = false }: { ipId: string; compact?: boolean }) {
  const { user } = useCurrentUser();
  const t = useTranslations("ipProductionStage");
  const query = useQuery({
    queryKey: ["public-ip-production-stage", ipId, user?.id ?? "guest"],
    queryFn: ({ signal }) =>
      api.get<{ stage: "testing" | "story_testing" | "production" | "released" }>(
        `/aurora/ip-commerce/ips/${encodeURIComponent(ipId)}/production-stage`,
        { signal }
      ),
    retry: false,
    staleTime: 60_000,
  });
  if (compact) {
    const label = query.data
      ? `${t("title")}: ${t(query.data.stage)}`
      : query.error
        ? `${query.error.message || t("error")}`
        : t("loading");
    const Icon = !query.data
      ? IconAlertCircle
      : query.data.stage === "released"
        ? IconCircleCheck
        : query.data.stage === "production"
          ? IconMovie
          : query.data.stage === "story_testing"
            ? IconScript
            : IconFlask;
    return (
      <span
        id={`tv-production-stage-${ipId}`}
        role="img"
        aria-label={label}
        title={label}
        className="inline-flex shrink-0 items-center rounded px-1 py-0.5 text-white/45"
      >
        <Icon aria-hidden className="size-3.5" />
        <span className="sr-only">{label}</span>
      </span>
    );
  }
  return (
    <div className="space-y-1 text-sm text-muted-foreground" aria-label={t("title")}>
      {query.data ? (
        <p>
          {t("title")}: {t(query.data.stage)}
        </p>
      ) : query.isPending ? (
        <p role="status">{t("loading")}</p>
      ) : null}
      {query.error ? (
        <div role="alert">
          <span>{query.error.message || t("error")}</span>{" "}
          <button
            type="button"
            disabled={query.isFetching}
            onClick={() => void query.refetch()}
            className="underline"
          >
            {t("retry")}
          </button>
        </div>
      ) : null}
    </div>
  );
}
