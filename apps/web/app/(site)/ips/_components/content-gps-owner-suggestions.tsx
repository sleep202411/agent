"use client";
import { type ContentGpsOwnerSuggestions } from "@repo/shared/content-gps";
import { useLocale, useTranslations } from "@/src/i18n/i18n";
import { useContentGpsOwnerSuggestions } from "../_hooks/use-content-gps-owner-suggestions";
import { useContentGpsAnalysis } from "../_hooks/use-content-gps-analysis";
import { Button } from "@/components/ui/button";

type Suggestion = ContentGpsOwnerSuggestions["locations"][number];
export function ContentGpsOwnerSuggestionsPanel({
  ipId,
  userId,
  ownerVersion,
  disabled,
  existing,
  onAdd,
  onDenied,
}: {
  ipId: string;
  userId: string;
  ownerVersion: number;
  disabled: boolean;
  existing: { kind: string; label: string }[];
  onAdd: (location: Suggestion) => void;
  onDenied: (error: unknown) => void;
}) {
  const locale = useLocale();
  const t = useTranslations("contentGpsSuggestions");
  const { data, error, busy, load } = useContentGpsOwnerSuggestions(ipId, locale, onDenied);
  const analysis = useContentGpsAnalysis(ipId, userId, locale, onDenied, () => void load());
  return (
    <section className="space-y-3 rounded-xl bg-muted/20 p-4" aria-label={t("title")}>
      <h4 className="font-medium">{t("title")}</h4>
      <p className="text-xs text-muted-foreground">{t("description")}</p>
      <p className="text-xs text-muted-foreground">{t("analysisDescription")}</p>
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="outline"
          disabled={disabled || busy || analysis.busy || !analysis.canAnalyze}
          onClick={() => void analysis.analyze()}
        >
          {t(analysis.notFound ? "retryAnalysis" : "analyze")}
        </Button>
        {analysis.request && (
          <Button
            type="button"
            variant="soft"
            disabled={disabled || busy || analysis.busy}
            onClick={() => void analysis.check()}
          >
            {t("checkAnalysis")}
          </Button>
        )}
      </div>
      {analysis.busy && <p role="status">{t("checkingAnalysis")}</p>}
      {analysis.request && (
        <p className="break-all text-xs text-muted-foreground">
          {t("request", { id: analysis.request.requestId })}
        </p>
      )}
      {analysis.receipt && <p role="status">{t(`analysis_${analysis.receipt.status}`)}</p>}
      {analysis.request && !analysis.receipt && !analysis.busy && (
        <p role="status">{t("analysisUnknown")}</p>
      )}
      {analysis.error && (
        <p role="alert" className="break-words">
          {analysis.error}
        </p>
      )}
      <Button
        type="button"
        variant="outline"
        disabled={disabled || busy || analysis.busy}
        onClick={() => void load()}
      >
        {busy ? t("loading") : t("load")}
      </Button>
      {error && (
        <p role="alert" className="break-words">
          {error}
        </p>
      )}
      {data && data.state !== "ready" && <p role="status">{t(data.state)}</p>}
      {data?.state === "ready" && (
        <>
          <p className="text-xs text-muted-foreground">
            {t("analyzed", { at: data.analyzedAt ?? "", version: data.analysisVersion ?? "" })}
          </p>
          {data.ownerVersion !== ownerVersion && <p role="alert">{t("ownerChanged")}</p>}
          {data.locations.length === 0 && <p>{t("empty")}</p>}
          {data.locations.map((location) => {
            const already = existing.some(
              (row) =>
                row.kind === location.kind &&
                row.label.normalize("NFKC").toLowerCase() ===
                  location.label.normalize("NFKC").toLowerCase()
            );
            return (
              <article key={location.id} className="space-y-2 py-3">
                <p className="font-medium">{location.label}</p>
                <p className="text-xs text-muted-foreground">
                  {t(location.kind)} · {t(location.status)}
                </p>
                {location.point && (
                  <p className="text-xs tabular-nums">
                    {location.point.latitude}, {location.point.longitude} ·{" "}
                    {location.point.coordinateSystem}
                  </p>
                )}
                {location.evidence.map((evidence, index) => (
                  <blockquote
                    key={index}
                    className="break-words border-l border-white/20 pl-3 text-xs"
                  >
                    <p>{evidence.quote}</p>
                    <footer className="mt-1 text-muted-foreground">
                      {t(evidence.sourceType)} ·{" "}
                      {t(evidence.field === "description" ? "descriptionField" : "summary")}
                    </footer>
                  </blockquote>
                ))}
                <Button
                  type="button"
                  variant="soft"
                  disabled={
                    disabled ||
                    analysis.busy ||
                    already ||
                    existing.length >= 100 ||
                    data.ownerVersion !== ownerVersion
                  }
                  onClick={() => onAdd(location)}
                >
                  {already ? t("already") : t("add")}
                </Button>
              </article>
            );
          })}
        </>
      )}
    </section>
  );
}
