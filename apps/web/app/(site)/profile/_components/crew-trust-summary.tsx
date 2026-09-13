"use client";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/src/lib/api";
import { useTranslations } from "@/src/i18n/i18n";
type Trust = { points: string; taskCount: string; onTime: string; late: string };
export function CrewTrustSummary({ userId }: { userId: string }) {
  const t = useTranslations("crewTrust");
  const query = useQuery({
    queryKey: ["crew-trust", userId],
    queryFn: ({ signal }) => api.get<Trust>("/aurora/me/crew-trust", { signal }),
    retry: false,
  });
  return (
    <section className="mx-auto w-full max-w-6xl space-y-2 px-6 py-4" aria-label={t("title")}>
      <h2 className="text-base font-semibold">{t("title")}</h2>
      {query.isPending && <p role="status">{t("loading")}</p>}
      {query.data && (
        <dl className="flex flex-wrap gap-6">
          {(["points", "taskCount", "onTime", "late"] as const).map((key) => (
            <div key={key}>
              <dt className="text-sm text-muted-foreground">{t(key)}</dt>
              <dd className="font-semibold tabular-nums">{query.data[key]}</dd>
            </div>
          ))}
        </dl>
      )}
      {query.isError && (
        <div role="alert">
          <p>{t("failed")}</p>
          <button
            type="button"
            disabled={query.isFetching}
            className="min-h-11 underline"
            onClick={() => void query.refetch()}
          >
            {t("retry")}
          </button>
        </div>
      )}
      <p className="text-sm text-muted-foreground">{t("note")}</p>
    </section>
  );
}
