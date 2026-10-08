"use client";

/**
 * Creator-section navigation for the right pane.
 *
 * Public creator pages use it as a scrollspy anchor menu. The private
 * `/profile` creator center uses the same visual treatment as an accessible
 * tablist that swaps a single content panel.
 *
 * Services lead per Pax’s October 5 profile feedback.
 * Service packages remain accessible to both owners and visitors.
 *
 * About (bio / education / experience / socials) was lifted out of the
 * tab bar entirely and now lives in the left rail — identity content
 * belongs alongside the avatar, not behind a tab click. Tab bar stays
 * focused on portfolio surfaces.
 *
 * Keep this list short — each tab is one horizontal click cost for
 * every visitor.
 */
import { cn } from "@/lib/utils";
import { useTranslations } from "@/src/i18n/i18n";

export type CreatorTabId = "works" | "certificates" | "ips" | "services";

// Pax: hide profile crew listings until this surface is reopened.
export const CREATOR_TAB_ORDER: CreatorTabId[] = ["services", "ips", "works", "certificates"];

const TAB_I18N_KEY: Record<CreatorTabId, string> = {
  services: "tabs.services",
  works: "tabs.works",
  certificates: "tabs.certificates",
  ips: "tabs.ips",
};

/** DOM id prefix for each section anchor (matches creator-center.tsx). */
export const CREATOR_SECTION_ID = (id: CreatorTabId) => `creator-section-${id}`;
export const CREATOR_TAB_ID = (id: CreatorTabId) => `creator-tab-${id}`;

interface CreatorTabBarProps {
  /** ID of the section currently in view or the selected tab panel. */
  active: CreatorTabId;
  mode?: "sections" | "tabs";
  onPick: (id: CreatorTabId) => void;
}

export function CreatorTabBar({ active, mode = "sections", onPick }: CreatorTabBarProps) {
  const t = useTranslations("creatorCenter");

  const handleTabKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>, id: CreatorTabId) => {
    if (mode !== "tabs") return;

    const currentIndex = CREATOR_TAB_ORDER.indexOf(id);
    let nextIndex: number | undefined;
    if (event.key === "ArrowRight") nextIndex = (currentIndex + 1) % CREATOR_TAB_ORDER.length;
    if (event.key === "ArrowLeft") {
      nextIndex = (currentIndex - 1 + CREATOR_TAB_ORDER.length) % CREATOR_TAB_ORDER.length;
    }
    if (event.key === "Home") nextIndex = 0;
    if (event.key === "End") nextIndex = CREATOR_TAB_ORDER.length - 1;
    if (nextIndex === undefined) return;

    event.preventDefault();
    const nextId = CREATOR_TAB_ORDER[nextIndex];
    onPick(nextId);
    requestAnimationFrame(() => document.getElementById(CREATOR_TAB_ID(nextId))?.focus());
  };

  return (
    <nav
      aria-label="creator-center-sections"
      role={mode === "tabs" ? "tablist" : undefined}
      className="flex items-center gap-2 overflow-x-auto border-b border-border"
    >
      {CREATOR_TAB_ORDER.map((id) => {
        const isActive = active === id;
        return (
          <button
            key={id}
            id={mode === "tabs" ? CREATOR_TAB_ID(id) : undefined}
            type="button"
            role={mode === "tabs" ? "tab" : undefined}
            aria-current={mode === "sections" && isActive ? "true" : undefined}
            aria-selected={mode === "tabs" ? isActive : undefined}
            aria-controls={mode === "tabs" ? CREATOR_SECTION_ID(id) : undefined}
            tabIndex={mode === "tabs" ? (isActive ? 0 : -1) : undefined}
            onClick={() => onPick(id)}
            onKeyDown={(event) => handleTabKeyDown(event, id)}
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
