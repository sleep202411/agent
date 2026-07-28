"use client";

import { useCallback } from "react";
import {
  IconAlertTriangle,
  IconLayoutGrid,
  IconLoader2,
  IconScissors,
  IconSparkles,
  type Icon,
} from "@tabler/icons-react";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import { GlassRim } from "@/components/ui/glass-rim";
import { cn } from "@/lib/utils";

import {
  STORY_CANVAS_DIRECTING_SKILLS,
  type StoryCanvasSkillCopyKey,
  type StoryCanvasSkillIcon,
} from "./story-canvas-skill-catalog";

const SKILL_ICONS: Record<StoryCanvasSkillIcon, Icon> = {
  collage: IconScissors,
  symmetry: IconLayoutGrid,
};

const NOTICE_ID = "story-canvas-first-open-agent-state";

/**
 * Whether the Studio Agent can accept an opening message right now.
 *
 * This must mirror the composer's disabled gate in
 * `story-canvas-assistant-layer.tsx`: the hero may never offer an action the
 * composer would refuse the instant the panel opens.
 */
export type StoryCanvasFirstOpenAvailability =
  | { kind: "ready" }
  | { kind: "connecting" }
  | { kind: "unavailable"; detail: string | null };

/**
 * First-open guidance for a story project that has never held a scene.
 *
 * The canvas of a brand-new project is empty by design (see the note on the
 * `firstOpen` prop in `story-project-canvas.tsx`), so this hero — not the
 * closed StoryOS panel — is what has to invite the first move. It sits over
 * React Flow as a `pointer-events-none` layer with a `pointer-events-auto`
 * card, and swallows the gestures React Flow would otherwise claim.
 *
 * The whole screen renders regardless of agent health; only the ACTIONS
 * degrade, with the reason stated inline. Guidance that vanishes when the
 * thing it points at is down leaves a blank canvas and no explanation.
 */
export function StoryCanvasFirstOpen({
  availability,
  draft,
  onStart,
  onRetry,
  className,
}: {
  availability: StoryCanvasFirstOpenAvailability;
  /** The StoryOS composer draft, so a seed never clobbers typed text. */
  draft: string;
  /** Opens StoryOS with this draft. Nothing is sent — the creator submits. */
  onStart: (nextDraft: string) => void;
  onRetry?: () => void;
  className?: string;
}) {
  const t = useTranslations("storyStudio.canvas.firstOpen");
  const ready = availability.kind === "ready";

  // The premise and the art direction are separate strings: the server stopped
  // injecting directing-skill instructions when Story Studio moved off the
  // copilot transport, so the seeded message is now the only thing that can
  // carry the look — and keeping it separable lets a creator rewrite the
  // premise without accidentally deleting the style.
  const skillSeed = useCallback(
    (copyKey: StoryCanvasSkillCopyKey) =>
      `${t(`skills.${copyKey}.prompt`)}\n\n${t(`skills.${copyKey}.styleBrief`)}`,
    [t]
  );

  const startFromSkill = (copyKey: StoryCanvasSkillCopyKey) => {
    const seeds = STORY_CANVAS_DIRECTING_SKILLS.map((skill) => skillSeed(skill.copyKey).trim());
    const current = draft.trim();
    // Only ever replace an empty draft or another card's untouched seed. Text
    // the creator typed or edited survives; they keep it and land in StoryOS.
    const replaceable = current === "" || seeds.includes(current);
    onStart(replaceable ? skillSeed(copyKey) : draft);
  };

  return (
    <section
      aria-labelledby="story-canvas-first-open-title"
      className={cn(
        "pointer-events-none absolute inset-0 z-30 flex items-center justify-center px-24 pt-16 pb-16",
        className
      )}
    >
      <div
        data-testid="story-canvas-first-open"
        className="nodrag nopan nowheel pointer-events-auto w-full max-w-[760px]"
        onDoubleClick={(event) => event.stopPropagation()}
        onContextMenu={(event) => event.stopPropagation()}
        onKeyDown={(event) => event.stopPropagation()}
      >
        <div className="text-center">
          <h2
            id="story-canvas-first-open-title"
            className="text-[32px] leading-tight font-semibold tracking-[-0.02em] text-white/92"
          >
            {t("title")}
          </h2>
          <p className="mx-auto mt-3 max-w-[520px] text-sm leading-6 text-white/50">
            {t("description")}
          </p>
        </div>

        {availability.kind === "ready" ? null : (
          <div
            id={NOTICE_ID}
            role={availability.kind === "unavailable" ? "alert" : "status"}
            className="mx-auto mt-6 flex max-w-[560px] items-start gap-2.5 rounded-2xl bg-white/[0.05] px-3.5 py-2.5 text-left text-xs leading-5 text-white/58"
          >
            {availability.kind === "connecting" ? (
              <IconLoader2
                aria-hidden="true"
                className="mt-0.5 size-3.5 shrink-0 animate-spin text-white/40 motion-reduce:animate-none"
              />
            ) : (
              <IconAlertTriangle aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
            )}
            <span className="min-w-0 flex-1">
              {availability.kind === "connecting" ? t("connecting") : t("unavailable")}
              {availability.kind === "unavailable" && availability.detail ? (
                <span className="mt-1 block text-white/38">{availability.detail}</span>
              ) : null}
            </span>
            {availability.kind === "unavailable" && onRetry ? (
              <button
                type="button"
                onClick={onRetry}
                className="shrink-0 font-medium text-white/60 transition-colors hover:text-white/90 focus-visible:ring-2 focus-visible:ring-white/35 focus-visible:outline-none"
              >
                {t("retry")}
              </button>
            ) : null}
          </div>
        )}

        <div className="mt-7 flex justify-center">
          {/* One deliberate brand-red hero CTA (DESIGN.md rule 3) — the same
              accent the Story Studio library's create action already uses. */}
          <Button
            type="button"
            variant="primary-cta"
            size="xl"
            disabled={!ready}
            aria-describedby={ready ? undefined : NOTICE_ID}
            onClick={() => onStart(draft)}
          >
            <IconSparkles aria-hidden="true" />
            {t("start")}
          </Button>
        </div>

        <div className="mt-7">
          <p className="mb-2.5 px-1 text-center text-[10px] font-semibold tracking-[0.12em] text-white/36 uppercase">
            {t("skillsTitle")}
          </p>
          <div className="grid grid-cols-2 gap-2.5">
            {STORY_CANVAS_DIRECTING_SKILLS.map((skill) => {
              const SkillIcon = SKILL_ICONS[skill.icon];
              return (
                <button
                  key={skill.key}
                  type="button"
                  data-skill={skill.key}
                  disabled={!ready}
                  aria-describedby={ready ? undefined : NOTICE_ID}
                  onClick={() => startFromSkill(skill.copyKey)}
                  className={cn(
                    "relative flex min-h-24 items-stretch overflow-hidden rounded-[20px] bg-[oklch(0.205_0_0/0.88)] text-left shadow-[0_14px_48px_rgba(0,0,0,0.24)] backdrop-blur-[30px] transition focus-visible:ring-2 focus-visible:ring-white/35 focus-visible:outline-none",
                    ready ? "hover:bg-[oklch(0.24_0_0/0.92)]" : "opacity-50"
                  )}
                >
                  {skill.illustration ? (
                    <span aria-hidden className="relative w-[30%] shrink-0 self-stretch opacity-90">
                      {/* eslint-disable-next-line @next/next/no-img-element -- bundled skill artwork */}
                      <img
                        src={skill.illustration}
                        alt=""
                        className="absolute inset-0 size-full object-contain object-left-bottom p-2.5"
                      />
                    </span>
                  ) : null}
                  <span className="min-w-0 flex-1 p-3.5 text-right">
                    <span className="flex items-center justify-end gap-2 text-white/95">
                      <SkillIcon className="size-4 shrink-0" stroke={1.7} />
                      <span className="text-sm font-semibold tracking-[-0.01em]">
                        {t(`skills.${skill.copyKey}.title`)}
                      </span>
                    </span>
                    <span className="mt-1.5 block text-[11px] leading-[1.55] text-white/42">
                      {t(`skills.${skill.copyKey}.description`)}
                    </span>
                  </span>
                  <GlassRim />
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
}
