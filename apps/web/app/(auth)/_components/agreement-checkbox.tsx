"use client";

import { useMemo } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import { useTranslations, useLocale } from "@/src/i18n/i18n";
import { localizePath } from "@/src/i18n/locale-url";
import type { Locale } from "@/src/i18n/config";

/**
 * Terms-of-service / privacy-policy acknowledgement. Ported from the
 * legacy fizzdragon-web login & register pages — submit is blocked
 * until this is checked. Links open the in-app legal routes in a new
 * tab, locale-prefixed so the page matches the user's current language.
 */
export function AgreementCheckbox({
  id = "auth-agreement",
  checked,
  onCheckedChange,
}: {
  id?: string;
  checked: boolean;
  onCheckedChange: (next: boolean) => void;
}) {
  const t = useTranslations("auth");
  const locale = useLocale() as Locale;
  const urls = useMemo(
    () => ({
      terms: localizePath("/terms-of-service", locale),
      privacy: localizePath("/privacy-policy", locale),
    }),
    [locale]
  );

  return (
    <label
      htmlFor={id}
      className="flex cursor-pointer items-start gap-2 text-xs text-muted-foreground"
    >
      <Checkbox
        id={id}
        checked={checked}
        onCheckedChange={(value) => onCheckedChange(value === true)}
        className="mt-0.5"
      />
      <span className="leading-relaxed">
        {t("agreePrefix")}{" "}
        <a
          href={urls.terms}
          target="_blank"
          rel="noopener noreferrer"
          onClick={stop}
          className="font-medium text-foreground underline-offset-2 hover:underline"
        >
          {t("terms")}
        </a>{" "}
        {t("and")}{" "}
        <a
          href={urls.privacy}
          target="_blank"
          rel="noopener noreferrer"
          onClick={stop}
          className="font-medium text-foreground underline-offset-2 hover:underline"
        >
          {t("privacy")}
        </a>
      </span>
    </label>
  );
}

function stop(event: React.MouseEvent) {
  event.stopPropagation();
}
