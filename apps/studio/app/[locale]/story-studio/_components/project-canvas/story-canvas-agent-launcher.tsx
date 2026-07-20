"use client";

import { useCallback } from "react";
import { IconLayoutGrid, IconScissors, type Icon } from "@tabler/icons-react";
import { useTranslations } from "next-intl";
import type { StoryDirectingSkillKey } from "@repo/shared/story-directing-skills";
import { CopilotStatusNotice } from "@/components/copilot/copilot-status-notice";
import { GlassRim } from "@/components/ui/glass-rim";
import { GlitchText } from "@/components/ui/glitch-text";
import { cn } from "@/lib/utils";
import {
  STORY_CANVAS_DIRECTING_SKILLS,
  type StoryCanvasSkillCopyKey,
  type StoryCanvasSkillIcon,
} from "./story-canvas-skill-catalog";
import { StoryCanvasAssistantRecoveryNotice } from "./story-canvas-assistant-recovery-notice";
import { StoryCanvasAssistantComposer } from "./story-canvas-assistant-composer";
import type { StoryCanvasAssistantSession } from "./use-story-canvas-assistant-session";

const SKILL_ICONS: Record<StoryCanvasSkillIcon, Icon> = {
  collage: IconScissors,
  symmetry: IconLayoutGrid,
};

// Selected option cards carry the brand-red rim-light (DESIGN.md rule 3).
const redRgba = (alpha: number) => `rgba(229, 34, 39, ${alpha})`;
const SELECTED_SKILL_RIM = `conic-gradient(from 288deg, ${redRgba(0.55)} 0%, ${redRgba(0.28)} 30%, ${redRgba(0.22)} 55%, ${redRgba(0.22)} 80%, ${redRgba(0.55)} 100%)`;

export function StoryCanvasAgentLauncher({
  session,
  onOpenAssistant,
  className,
  disabled = false,
}: {
  session: StoryCanvasAssistantSession;
  onOpenAssistant: () => void;
  className?: string;
  disabled?: boolean;
}) {
  const t = useTranslations("storyStudio.canvas.emptyAgent");
  const skillCopy = useCallback(
    (copyKey: StoryCanvasSkillCopyKey, field: "title" | "description" | "prompt") =>
      t(`skills.${copyKey}.${field}`),
    [t]
  );
  const historyReady = session.history.status === "ready";
  const selectedSkill = STORY_CANVAS_DIRECTING_SKILLS.find(
    (skill) => skill.key === session.selectedSkillKey
  );
  const placeholder = selectedSkill
    ? t("placeholderWithSkill", { skill: skillCopy(selectedSkill.copyKey, "title") })
    : t("placeholder");

  // Selecting a skill seeds an editable example brief (the style instruction
  // itself travels server-side with the skill key). The seed only ever
  // replaces an empty draft or another skill's untouched seed — text the
  // creator typed or edited is never clobbered, and deselecting only clears
  // its own untouched seed.
  const toggleSkill = (key: StoryDirectingSkillKey, currentlySelected: boolean) => {
    const next = currentlySelected ? null : key;
    session.setSelectedSkillKey(next);
    const seeds = STORY_CANVAS_DIRECTING_SKILLS.map((skill) =>
      skillCopy(skill.copyKey, "prompt").trim()
    );
    const draft = session.draft.trim();
    const draftIsSeed = draft === "" || seeds.includes(draft);
    if (!draftIsSeed) return;
    const nextSkill = STORY_CANVAS_DIRECTING_SKILLS.find((skill) => skill.key === next);
    session.setDraft(nextSkill ? skillCopy(nextSkill.copyKey, "prompt") : "");
  };

  const submit = async () => {
    if (await session.submit()) onOpenAssistant();
  };

  return (
    <section
      aria-labelledby="story-canvas-agent-title"
      className={cn(
        "pointer-events-none absolute inset-0 z-20 flex items-center justify-center px-24 pb-20",
        className
      )}
    >
      <div
        className="nodrag nopan nowheel pointer-events-auto w-full max-w-[820px]"
        onDoubleClick={(event) => event.stopPropagation()}
        onContextMenu={(event) => event.stopPropagation()}
        onKeyDown={(event) => event.stopPropagation()}
      >
        <div className="mb-7 text-center">
          <h2
            id="story-canvas-agent-title"
            className="text-4xl font-bold tracking-[-0.02em] text-white/92"
          >
            <GlitchText
              speed={1.2}
              enableShadows
              shadowColors={{ after: "rgba(229,34,39,0.55)", before: "#9d8cff" }}
              baseClassName="bg-gradient-to-r from-[#d67578] via-[#b482e8] to-[#9d8cff] bg-clip-text text-transparent"
              className="[--glitch-background:oklch(0.105_0_0)]"
            >
              {t("title")}
            </GlitchText>
          </h2>
          <p className="mt-3 text-sm leading-6 text-white/50">{t("description")}</p>
        </div>

        {/* The composer is this surface's hero control: elevated glass with the
            signature rim-light so it reads above the canvas, not part of it. */}
        <div className="relative rounded-[20px] shadow-[0_22px_70px_rgba(0,0,0,0.45)]">
          <StoryCanvasAssistantComposer
            session={session}
            onSubmit={submit}
            placeholder={placeholder}
            autoFocus
            className="bg-[oklch(0.24_0_0/0.96)] backdrop-blur-[30px] backdrop-saturate-150"
            disabled={disabled}
          />
          <GlassRim />
        </div>

        {session.recoveryStorageError ? (
          <div className="mt-3">
            <CopilotStatusNotice message={t("recoveryStorageError")} />
          </div>
        ) : null}

        <div className="mt-3 empty:hidden">
          <StoryCanvasAssistantRecoveryNotice
            session={session}
            onRequestNewConversation={() => void session.startNewConversation()}
          />
        </div>

        {session.history.status !== "ready" ? (
          <div className="mt-3">
            <CopilotStatusNotice
              message={
                session.history.status === "loading"
                  ? t("historyLoading")
                  : session.history.error?.message || t("historyError")
              }
              actionLabel={session.history.status === "error" ? t("retryHistory") : undefined}
              onAction={
                session.history.status === "error" ? () => void session.history.retry() : undefined
              }
            />
          </div>
        ) : null}

        <div className="mt-5">
          <p className="mb-2.5 px-1 text-[10px] font-semibold tracking-[0.12em] text-white/36 uppercase">
            {t("skillsTitle")}
          </p>
          <div className="grid grid-cols-2 gap-2.5">
            {STORY_CANVAS_DIRECTING_SKILLS.map((skill) => {
              const SkillIcon = SKILL_ICONS[skill.icon];
              const selected = session.selectedSkillKey === skill.key;
              return (
                <button
                  key={skill.key}
                  type="button"
                  aria-pressed={selected}
                  disabled={disabled || !historyReady || session.busy}
                  onClick={() => toggleSkill(skill.key, selected)}
                  className={cn(
                    "relative flex min-h-24 items-stretch overflow-hidden rounded-[20px] bg-[oklch(0.205_0_0/0.88)] text-left shadow-[0_14px_48px_rgba(0,0,0,0.24)] backdrop-blur-[30px] transition focus-visible:ring-2 focus-visible:ring-white/35 focus-visible:outline-none",
                    selected ? "bg-[oklch(0.27_0_0/0.95)]" : "hover:bg-[oklch(0.24_0_0/0.92)]",
                    (disabled || !historyReady || session.busy) && "opacity-50"
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
                        {skillCopy(skill.copyKey, "title")}
                      </span>
                    </span>
                    <span className="mt-1.5 block text-[11px] leading-[1.55] text-white/42">
                      {skillCopy(skill.copyKey, "description")}
                    </span>
                  </span>
                  {selected ? <GlassRim gradient={SELECTED_SKILL_RIM} width="1.5px" /> : null}
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
}
