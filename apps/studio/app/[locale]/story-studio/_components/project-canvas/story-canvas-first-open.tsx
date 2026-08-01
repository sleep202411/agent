"use client";

import { useCallback, useEffect, useRef } from "react";
import {
  IconAlertTriangle,
  IconLayoutGrid,
  IconLoader2,
  IconScissors,
  type Icon,
} from "@tabler/icons-react";
import { useTranslations } from "next-intl";

import {
  STUDIO_AGENT_ATTACHMENT_ACCEPT,
  StudioAgentComposer,
  formatStudioAgentFileSize,
  type StudioAgentCanonicalAttachment,
  type StudioAgentComposerAttachmentQueue,
} from "@/components/studio-agent";
import { GlassRim } from "@/components/ui/glass-rim";
import { GlitchText } from "@/components/ui/glitch-text";
import type { StudioAgentDocumentAnalysisMap } from "@/lib/studio-agent";
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
const redRgba = (alpha: number) => `rgba(229, 34, 39, ${alpha})`;
const SELECTED_SKILL_RIM = `conic-gradient(from 288deg, ${redRgba(0.55)} 0%, ${redRgba(0.28)} 30%, ${redRgba(0.22)} 55%, ${redRgba(0.22)} 80%, ${redRgba(0.55)} 100%)`;

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
  attachmentQueue,
  documentAnalysis,
  onDraftChange,
  onSubmit,
  submitting = false,
  onRetry,
  className,
}: {
  availability: StoryCanvasFirstOpenAvailability;
  /** Shared with the StoryOS panel, so opening it never loses typed text. */
  draft: string;
  /** Shared upload queue; attachments survive the transition into StoryOS. */
  attachmentQueue: StudioAgentComposerAttachmentQueue;
  /** Live document-analysis state for the queued attachments. */
  documentAnalysis?: StudioAgentDocumentAnalysisMap;
  onDraftChange: (nextDraft: string) => void;
  /** Sends the first creator-authored message and opens the StoryOS transcript. */
  onSubmit: (
    text: string,
    attachments: readonly StudioAgentCanonicalAttachment[]
  ) => void | Promise<void>;
  submitting?: boolean;
  onRetry?: () => void;
  className?: string;
}) {
  const t = useTranslations("storyStudio.canvas.firstOpen");
  const agentT = useTranslations("storyStudio.canvas.studioAgent");
  const ready = availability.kind === "ready";
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (ready) inputRef.current?.focus();
  }, [ready]);

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
    // the creator typed or edited survives.
    const replaceable = current === "" || seeds.includes(current);
    onDraftChange(replaceable ? skillSeed(copyKey) : draft);
    requestAnimationFrame(() => inputRef.current?.focus());
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

        <div className="mt-7">
          <StudioAgentComposer
            value={draft}
            inputRef={inputRef}
            deliveryMode="send"
            onDeliveryModeChange={() => undefined}
            onValueChange={onDraftChange}
            onSubmit={(text, _mode, attachments) => onSubmit(text, attachments)}
            isSubmitting={submitting}
            disabled={!ready}
            className="bg-[oklch(0.22_0_0_/_0.96)] shadow-[inset_0_1px_0_rgba(255,255,255,0.11),0_22px_70px_rgba(0,0,0,0.45)]"
            attachments={{
              items: attachmentQueue.items,
              accept: STUDIO_AGENT_ATTACHMENT_ACCEPT,
              onAddFiles: attachmentQueue.addFiles,
              onRetry: attachmentQueue.retry,
              onRemove: attachmentQueue.remove,
              analysis: documentAnalysis,
            }}
            labels={{
              input: t("start"),
              placeholder: t("start"),
              stop: agentT("composer.stop"),
              stopping: agentT("composer.stopping"),
              queued: (count) => agentT("composer.queued", { count }),
              deliveryModeMenu: agentT("composer.deliveryModeMenu"),
              deliveryMode: {
                send: {
                  label: agentT("composer.delivery.send.label"),
                  description: agentT("composer.delivery.send.description"),
                },
                steer: {
                  label: agentT("composer.delivery.steer.label"),
                  description: agentT("composer.delivery.steer.description"),
                },
                enqueue: {
                  label: agentT("composer.delivery.enqueue.label"),
                  description: agentT("composer.delivery.enqueue.description"),
                },
                stop_and_send: {
                  label: agentT("composer.delivery.stopAndSend.label"),
                  description: agentT("composer.delivery.stopAndSend.description"),
                },
              },
              attachments: {
                add: agentT("composer.attachments.add"),
                drop: agentT("composer.attachments.drop"),
                remove: (fileName) => agentT("composer.attachments.remove", { fileName }),
                retry: (fileName) => agentT("composer.attachments.retry", { fileName }),
                uploading: (progress) => agentT("composer.attachments.uploading", { progress }),
                processing: (progress) => agentT("composer.attachments.processing", { progress }),
                ready: agentT("composer.attachments.ready"),
                failed: agentT("composer.attachments.failed"),
                fileSize: formatStudioAgentFileSize,
                analysis: {
                  region: agentT("attachmentAnalysis.region"),
                  queued: agentT("attachmentAnalysis.queued"),
                  mapping: (progress) => agentT("attachmentAnalysis.mapping", { progress }),
                  reducing: (progress) => agentT("attachmentAnalysis.reducing", { progress }),
                  succeeded: agentT("attachmentAnalysis.succeeded"),
                  failed: agentT("attachmentAnalysis.failed"),
                  cancelled: agentT("attachmentAnalysis.cancelled"),
                },
              },
            }}
          />
        </div>

        <div className="mt-7">
          <p className="mb-2.5 px-1 text-center text-[10px] font-semibold tracking-[0.12em] text-white/36 uppercase">
            {t("skillsTitle")}
          </p>
          <div className="grid grid-cols-2 gap-2.5">
            {STORY_CANVAS_DIRECTING_SKILLS.map((skill) => {
              const SkillIcon = SKILL_ICONS[skill.icon];
              const selected = draft.trim() === skillSeed(skill.copyKey).trim();
              return (
                <button
                  key={skill.key}
                  type="button"
                  data-skill={skill.key}
                  aria-pressed={selected}
                  disabled={!ready}
                  aria-describedby={ready ? undefined : NOTICE_ID}
                  onClick={() => startFromSkill(skill.copyKey)}
                  className={cn(
                    "relative flex min-h-24 items-stretch overflow-hidden rounded-[20px] bg-[oklch(0.205_0_0/0.88)] text-left shadow-[0_14px_48px_rgba(0,0,0,0.24)] backdrop-blur-[30px] transition focus-visible:ring-2 focus-visible:ring-white/35 focus-visible:outline-none",
                    selected
                      ? "bg-[#E52227]/[0.07]"
                      : ready
                        ? "hover:bg-[oklch(0.24_0_0/0.92)]"
                        : "opacity-50"
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
                      <SkillIcon
                        className={cn("size-4 shrink-0", selected && "text-[#E52227]")}
                        stroke={1.7}
                      />
                      <span className="text-sm font-semibold tracking-[-0.01em]">
                        {t(`skills.${skill.copyKey}.title`)}
                      </span>
                    </span>
                    <span className="mt-1.5 block text-[11px] leading-[1.55] text-white/42">
                      {t(`skills.${skill.copyKey}.description`)}
                    </span>
                  </span>
                  <GlassRim gradient={selected ? SELECTED_SKILL_RIM : undefined} />
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
}
