"use client";

/**
 * Top-of-viewport sticky bar that announces "PREVIEW · viewer mode"
 * and exposes the identity switcher. Visible only when the URL
 * carries `?preview=pricing`; clicking the close affordance strips
 * the param so the page reloads to real mode.
 *
 * Visual treatment: amber/yellow palette to signal "this is a
 * special mode, not the real page" — matches the dev-tools aesthetic
 * (yellow bar = staging / debug).
 */

import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { IconEye, IconX } from "@tabler/icons-react";
import { useTranslations } from "@/src/i18n/i18n";
import { cn } from "@/lib/utils";
import { usePricing, type PreviewIdentity } from "./pricing-context";

const IDENTITIES: Array<{ id: PreviewIdentity; labelKey: string }> = [
  { id: "guest", labelKey: "identityGuest" },
  { id: "owns-singles", labelKey: "identityOwnsSingles" },
  { id: "owns-full", labelKey: "identityOwnsFull" },
];

export function PreviewModeBar() {
  const t = useTranslations("paywall");
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { isPreviewMode, previewIdentity, setPreviewIdentity } = usePricing();

  if (!isPreviewMode) return null;

  const exitPreview = () => {
    const next = new URLSearchParams(searchParams.toString());
    next.delete("preview");
    const qs = next.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname);
  };

  return (
    <div className="sticky top-0 z-40 border-b border-amber-400/30 bg-amber-400/15 backdrop-blur-sm">
      <div className="mx-auto flex max-w-screen-2xl flex-wrap items-center gap-3 px-4 py-2 text-xs">
        <span className="inline-flex items-center gap-1.5 font-semibold uppercase tracking-wider text-amber-400">
          <IconEye className="size-3.5" />
          {t("previewBarLabel")}
        </span>
        <span className="hidden text-muted-foreground sm:inline">{t("previewBarHint")}</span>

        <div className="ml-auto flex items-center gap-2">
          {/* Identity segmented control */}
          <div
            role="radiogroup"
            aria-label={t("identityLabel")}
            className="flex items-center gap-0.5 rounded-full border border-amber-400/30 bg-background/60 p-0.5"
          >
            {IDENTITIES.map(({ id, labelKey }) => {
              const active = previewIdentity === id;
              return (
                <button
                  key={id}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  onClick={() => setPreviewIdentity(id)}
                  className={cn(
                    "rounded-full px-3 py-1 text-[11px] font-semibold transition-colors",
                    active ? "bg-amber-400 text-amber-950" : "text-amber-400 hover:bg-amber-400/15"
                  )}
                >
                  {t(labelKey)}
                </button>
              );
            })}
          </div>

          <button
            type="button"
            onClick={exitPreview}
            aria-label={t("previewBarExit")}
            title={t("previewBarExit")}
            className="rounded-full p-1 text-amber-400 transition-colors hover:bg-amber-400/15"
          >
            <IconX className="size-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}
