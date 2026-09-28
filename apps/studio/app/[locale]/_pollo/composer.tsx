"use client";

/**
 * FizzStudio hero — three tabs:
 *   • Agent (kind "agent") — chat-first guided entry (default).
 *   • Creative Studio (kind "compose") — the REAL image/video generation
 *     composer: the home's modality rail + frosted panel wired to the shared
 *     generation engine (see `_home/creative-composer.tsx`). Create submits and
 *     navigates to /images or /video to watch the result.
 *   • Project Studio (kind "project") — entry to the project/canvas workspace.
 *
 * Marketing/Commerce stay in STUDIOS as `hidden` (kept, not deleted) — re-enable
 * by dropping `hidden`; as `kind: "compose"` they render the same CreativeComposer.
 * Themed via the `theme` prop; tabs reverse-engineered from pollo.ai.
 */

import { useEffect, useRef, useState } from "react";
import { IconLayoutGrid, IconRobot, IconSparkles, type Icon } from "@tabler/icons-react";
import { useTranslations } from "next-intl";
import { EASE, type Theme } from "./theme";
import { GradientRing } from "./glyphs";
import { ProjectStudio } from "./project-studio";
import { AgentStudio } from "./agent-studio";
import { CreativeComposer } from "../_home/creative-composer";

type Studio = {
  id: string;
  labelKey: string;
  kind: "compose" | "project" | "agent";
  icon: Icon;
  /** Kept-but-hidden (not deleted). Re-enable by removing this flag. */
  hidden?: boolean;
};

const STUDIOS: Studio[] = [
  // chat-first guided entry — placed first so the homepage defaults to it.
  { id: "agent", labelKey: "studioTabs.agent", kind: "agent", icon: IconRobot },
  { id: "creative", labelKey: "studioTabs.creative", kind: "compose", icon: IconSparkles },
  { id: "project", labelKey: "studioTabs.project", kind: "project", icon: IconLayoutGrid },
  // ---- hidden (kept, not deleted) — verticals we can't back yet ----
  {
    id: "marketing",
    labelKey: "studioTabs.marketing",
    kind: "compose",
    icon: IconSparkles,
    hidden: true,
  },
  {
    id: "commerce",
    labelKey: "studioTabs.commerce",
    kind: "compose",
    icon: IconSparkles,
    hidden: true,
  },
];

const VISIBLE_STUDIOS = STUDIOS.filter((s) => !s.hidden);

// The mode switcher (Agent / Creative / Project) is hidden on the homepage for
// now — the design is intentionally kept intact; flip this to `true` to restore
// the pill tabs. With it hidden the page shows the default studio (index 0).
const SHOW_STUDIO_TABS = false;

export function Composer({ theme: t }: { theme: Theme }) {
  const th = useTranslations("home");
  // Default to the Creative composer — the homepage's primary create surface.
  const [studioIdx, setStudioIdx] = useState(() =>
    Math.max(
      0,
      VISIBLE_STUDIOS.findIndex((s) => s.id === "creative")
    )
  );
  const studio = VISIBLE_STUDIOS[studioIdx];

  // sliding tab ring measured from the active tab button.
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const [tabInd, setTabInd] = useState<{ left: number; width: number } | null>(null);
  useEffect(() => {
    const measure = () => {
      const el = tabRefs.current[studioIdx];
      if (el) setTabInd({ left: el.offsetLeft, width: el.offsetWidth });
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [studioIdx]);

  return (
    <div className="flex w-full flex-col items-center">
      {/* headline — static tagline (the tabs are modes, not audiences) */}
      <h1 className="text-center text-[30px] font-medium leading-[40px] tracking-tight md:text-[34px] md:leading-[44px]">
        {th("heroComposer.headlinePrefix")}{" "}
        <span className="bg-clip-text text-transparent" style={{ backgroundImage: t.word }}>
          {th("heroComposer.headlineHighlight")}
        </span>
      </h1>
      <p className="mt-3 text-center text-[15px] text-white/45">{th("heroComposer.subtitle")}</p>

      {/* studio tabs — Agent + Creative + Project (Marketing/Commerce hidden).
          Whole switcher hidden via SHOW_STUDIO_TABS — design kept intact. */}
      {SHOW_STUDIO_TABS && (
        <div className="relative mt-9 flex w-fit items-center gap-1 rounded-full border border-white/[0.04] bg-white/[0.05] p-1">
          {tabInd ? (
            <span
              aria-hidden
              className="pointer-events-none absolute top-1 bottom-1 left-0 rounded-[32px]"
              style={{
                width: tabInd.width,
                transform: `translateX(${tabInd.left}px)`,
                boxShadow: t.tabGlow,
                transition: `transform 0.3s ${EASE}, width 0.3s ${EASE}`,
              }}
            >
              <GradientRing padding="1px" gradient={t.tabRing} />
            </span>
          ) : null}
          {VISIBLE_STUDIOS.map((s, i) => {
            const active = studioIdx === i;
            const TabIcon = s.icon;
            return (
              <button
                key={s.id}
                ref={(el) => {
                  tabRefs.current[i] = el;
                }}
                type="button"
                onClick={() => setStudioIdx(i)}
                className={[
                  "relative z-10 flex h-10 items-center gap-2 rounded-[32px] px-5 text-[15px] transition-colors",
                  active ? "" : "text-white/55 hover:text-white/80",
                ].join(" ")}
              >
                <TabIcon
                  className="size-[18px]"
                  stroke={1.8}
                  style={active ? { color: t.activeIcon } : undefined}
                />
                {active ? (
                  <span
                    className="bg-clip-text text-transparent"
                    style={{ backgroundImage: t.accentText }}
                  >
                    {th(s.labelKey)}
                  </span>
                ) : (
                  th(s.labelKey)
                )}
              </button>
            );
          })}
        </div>
      )}

      {/* body — crossfades on tab switch */}
      <div
        key={studioIdx}
        className={SHOW_STUDIO_TABS ? "w-full" : "mt-6 w-full"}
        style={{ animation: `polloFade 0.3s ${EASE} both` }}
      >
        {studio.kind === "agent" ? (
          <AgentStudio theme={t} />
        ) : studio.kind === "project" ? (
          <ProjectStudio theme={t} />
        ) : (
          <CreativeComposer />
        )}
      </div>
    </div>
  );
}
