"use client";
import { Button } from "@/components/ui/button";
import { useLocale, useTranslations } from "@/src/i18n/i18n";
import { useCreatorGeocoding } from "../_hooks/use-creator-geocoding";
export function CreatorCityGeocode({
  version,
  disabled,
  onDenied,
}: {
  version: number;
  disabled: boolean;
  onDenied: (error: unknown) => void;
}) {
  const locale = useLocale();
  const t = useTranslations("creatorGeocoding");
  const { state, busy, error, check, resolve } = useCreatorGeocoding(version, locale, onDenied);
  const current = state?.version === version;
  const canResolve = current && state && ["missing", "expired"].includes(state.state);
  return (
    <section className="space-y-3 text-sm" aria-label={t("title")}>
      <h3 className="font-medium">{t("title")}</h3>
      <p className="text-muted-foreground">{t("description")}</p>
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="outline"
          className="min-h-11"
          disabled={disabled || busy}
          onClick={() => void check()}
        >
          {t("check")}
        </Button>
        <Button
          type="button"
          variant="soft"
          className="min-h-11"
          disabled={disabled || busy || !canResolve}
          onClick={() => void resolve()}
        >
          {t("resolve")}
        </Button>
      </div>
      {busy && <p role="status">{t("loading")}</p>}
      {error && (
        <p role="alert" className="break-words">
          {error}
        </p>
      )}
      {state && <p role="status">{t(current ? state.state : "changed")}</p>}
      {state?.attemptId && (
        <p className="break-all text-xs text-muted-foreground">
          {t("attempt", { id: state.attemptId })}
        </p>
      )}
    </section>
  );
}
