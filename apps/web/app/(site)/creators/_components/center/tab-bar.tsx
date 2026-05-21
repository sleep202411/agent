"use client";

/**
 * Tab bar that runs across the top of the creator center's right pane.
 * Underline-style nav (rather than pill) so the layout reads as
 * "categories of the same identity" instead of "five separate apps".
 *
 * Tab order is deliberate:
 *   1. 服务包  — commercial entry. Default-selected. Doc § 10.1.
 *   2. 作品    — videos / personal works.
 *   3. IP      — owned IP projects.
 *   4. 剧组    — joined crews.
 *   5. 关于    — bio, education, experience, socials.
 *
 * Keep this list short. Each tab here is one **horizontal click cost
 * for every visitor**, so a tab only earns its slot if a non-trivial
 * chunk of visitors will look at it. Earnings / orders for the owner
 * live in their own routes, not as tabs here, to keep the public
 * shape symmetric.
 */
import { cn } from "@/lib/utils";
import { useTranslations } from "@/src/i18n/i18n";

export type CreatorTabId = "services" | "works" | "ips" | "crews" | "about";

const TAB_ORDER: CreatorTabId[] = ["services", "works", "ips", "crews", "about"];

const TAB_I18N_KEY: Record<CreatorTabId, string> = {
  services: "tabs.services",
  works: "tabs.works",
  ips: "tabs.ips",
  crews: "tabs.crews",
  about: "tabs.about",
};

interface CreatorTabBarProps {
  value: CreatorTabId;
  onChange: (next: CreatorTabId) => void;
}

export function CreatorTabBar({ value, onChange }: CreatorTabBarProps) {
  const t = useTranslations("creatorCenter");
  return (
    <nav
      role="tablist"
      aria-label="creator-center"
      className="flex items-center gap-2 border-b border-border"
    >
      {TAB_ORDER.map((id) => {
        const active = value === id;
        return (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(id)}
            className={cn(
              "relative px-4 py-2.5 text-sm font-medium transition-colors",
              active ? "text-foreground" : "text-muted-foreground hover:text-foreground/80"
            )}
          >
            {t(TAB_I18N_KEY[id])}
            {active ? (
              <span className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-primary" />
            ) : null}
          </button>
        );
      })}
    </nav>
  );
}
