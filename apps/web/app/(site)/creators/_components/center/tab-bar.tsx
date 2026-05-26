"use client";

/**
 * Sticky scrollspy nav for the creator center's right pane.
 *
 * Behavior shift (2026-05-24): the right pane no longer swaps content
 * when a tab is clicked. All 5 sections render stacked. The tab bar
 * now acts as an anchor menu — click → smooth-scroll to the section,
 * scrolling the page → highlight the section currently in view.
 *
 * Tab order is deliberate:
 *   1. 服务包  — commercial entry, first because it's the buy CTA.
 *   2. 作品    — videos / personal works.
 *   3. 证书    — public trust signal / training completion proof.
 *   4. IP      — owned IP projects.
 *   5. 剧组    — joined crews.
 *   6. 关于    — bio, education, experience, socials.
 *
 * Keep this list short — each tab is one horizontal click cost for
 * every visitor.
 */
import { cn } from "@/lib/utils";
import { useTranslations } from "@/src/i18n/i18n";

export type CreatorTabId = "services" | "works" | "certificates" | "ips" | "crews" | "about";

export const CREATOR_TAB_ORDER: CreatorTabId[] = [
  "services",
  "works",
  "certificates",
  "ips",
  "crews",
  "about",
];

const TAB_I18N_KEY: Record<CreatorTabId, string> = {
  services: "tabs.services",
  works: "tabs.works",
  certificates: "tabs.certificates",
  ips: "tabs.ips",
  crews: "tabs.crews",
  about: "tabs.about",
};

/** DOM id prefix for each section anchor (matches creator-center.tsx). */
export const CREATOR_SECTION_ID = (id: CreatorTabId) => `creator-section-${id}`;

interface CreatorTabBarProps {
  /** ID of the section currently in view (driven by scrollspy in parent). */
  active: CreatorTabId;
  /** Click — parent scrolls the matching section into view. */
  onPick: (id: CreatorTabId) => void;
}

export function CreatorTabBar({ active, onPick }: CreatorTabBarProps) {
  const t = useTranslations("creatorCenter");
  return (
    <nav
      aria-label="creator-center-sections"
      className="flex items-center gap-2 overflow-x-auto border-b border-border"
    >
      {CREATOR_TAB_ORDER.map((id) => {
        const isActive = active === id;
        return (
          <button
            key={id}
            type="button"
            aria-current={isActive ? "true" : undefined}
            onClick={() => onPick(id)}
            className={cn(
              "relative shrink-0 px-4 py-2.5 text-sm font-medium transition-colors",
              isActive ? "text-foreground" : "text-muted-foreground hover:text-foreground/80"
            )}
          >
            {t(TAB_I18N_KEY[id])}
            {isActive ? (
              <span className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-primary" />
            ) : null}
          </button>
        );
      })}
    </nav>
  );
}
