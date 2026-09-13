"use client";
import { useQuery } from "@tanstack/react-query";
import { useCurrentUser } from "@/src/hooks/use-user";
import { useTranslations } from "@/src/i18n/i18n";
import { api } from "@/src/lib/api";

export function IpProductionStage({ ipId }: { ipId: string }) {
  const { user } = useCurrentUser();
  const t = useTranslations("ipProductionStage");
  const query = useQuery({
    queryKey: ["public-ip-production-stage", ipId, user?.id ?? "guest"],
    queryFn: ({ signal }) =>
      api.get<{ stage: "testing" | "story_testing" | "production" | "released" }>(
        `/aurora/ip-commerce/ips/${encodeURIComponent(ipId)}/production-stage`,
        { signal, raw: true }
      ),
    retry: false,
  });
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
