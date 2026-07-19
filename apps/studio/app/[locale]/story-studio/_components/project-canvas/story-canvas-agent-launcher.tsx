"use client";

import { useCallback } from "react";
import {
  IconBuildingSkyscraper,
  IconEye,
  IconHeartHandshake,
  IconLayoutGrid,
  IconMoonStars,
  IconScissors,
  type Icon,
} from "@tabler/icons-react";
import { useTranslations } from "next-intl";
import { CopilotStatusNotice } from "@/components/copilot/copilot-status-notice";
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
  symmetry: IconLayoutGrid,
  relationship: IconHeartHandshake,
  dreamscape: IconMoonStars,
  mystery: IconEye,
  noir: IconBuildingSkyscraper,
  handcrafted: IconScissors,
};

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
    (copyKey: StoryCanvasSkillCopyKey, field: "title" | "description") =>
      t(`skills.${copyKey}.${field}`),
    [t]
  );
  const historyReady = session.history.status === "ready";

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
        <div className="mb-4 text-center">
          <h2 id="story-canvas-agent-title" className="text-base font-semibold text-white/92">
            <GlitchText
              speed={1.2}
              enableShadows={false}
              enableOnHover
              className="[--glitch-background:oklch(0.105_0_0)]"
            >
              {t("title")}
            </GlitchText>
          </h2>
          <p className="mt-1 text-xs leading-5 text-white/44">{t("description")}</p>
        </div>

        <StoryCanvasAssistantComposer
          session={session}
          onSubmit={submit}
          placeholder={t("placeholder")}
          autoFocus
          className="bg-[oklch(0.205_0_0)]"
          disabled={disabled}
        />

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
          <div className="grid grid-cols-3 gap-2.5">
            {STORY_CANVAS_DIRECTING_SKILLS.map((skill) => {
              const SkillIcon = SKILL_ICONS[skill.icon];
              const selected = session.selectedSkillKey === skill.key;
              return (
                <button
                  key={skill.key}
                  type="button"
                  aria-pressed={selected}
                  disabled={disabled || !historyReady || session.busy}
                  onClick={() => session.setSelectedSkillKey(selected ? null : skill.key)}
                  className={cn(
                    "min-h-24 rounded-[20px] bg-[oklch(0.205_0_0/0.88)] p-3.5 text-left shadow-[0_14px_48px_rgba(0,0,0,0.24)] backdrop-blur-[30px] transition focus-visible:ring-2 focus-visible:ring-white/35 focus-visible:outline-none",
                    selected ? "bg-[oklch(0.27_0_0/0.95)]" : "hover:bg-[oklch(0.24_0_0/0.92)]",
                    (disabled || !historyReady || session.busy) && "opacity-50"
                  )}
                >
                  <span className="flex items-center gap-2 text-white/82">
                    <SkillIcon className="size-4" stroke={1.7} />
                    <span className="text-xs font-semibold">
                      {skillCopy(skill.copyKey, "title")}
                    </span>
                  </span>
                  <span className="mt-2 block text-[11px] leading-[1.55] text-white/40">
                    {skillCopy(skill.copyKey, "description")}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
}
