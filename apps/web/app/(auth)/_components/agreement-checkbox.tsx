"use client";

import { useMemo } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import { useTranslations } from "@/src/i18n/i18n";

/**
 * Terms-of-service / privacy-policy acknowledgement. Ported from the
 * legacy fizzdragon-web login & register pages — submit is blocked
 * until this is checked. Links open the matching parent-site legal
 * pages in a new tab (those pages aren't hosted on the studio domain).
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
  const urls = useMemo(resolveLegalUrls, []);

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

function resolveLegalUrls(): { terms: string; privacy: string } {
  const origin = resolveParentOrigin();
  return {
    terms: `${origin}/pages/terms-of-service/terms-of-service`,
    privacy: `${origin}/pages/privacy-policy/privacy-policy`,
  };
}

/**
 * Pick the matching parent-site origin for the current studio host.
 * The parent hosts the legacy legal pages, so terms/privacy links
 * point there. Defaults to staging when we can't recognize the host
 * (local dev, preview deploys, etc.).
 */
function resolveParentOrigin(): string {
  if (typeof window === "undefined") return "https://test.fizzdragon.com";
  const host = window.location.hostname;
  if (host === "fizzstudio.fizzdragon.com") return "https://fizzdragon.com";
  if (host === "fizzstudio.fizzspace.cn") return "https://fizzdragon.fizzspace.cn";
  if (host === "studio.test.fizzdragon.com") return "https://test.fizzdragon.com";
  return "https://test.fizzdragon.com";
}
