"use client";

import { IconGitBranch, IconLoader2, IconMovie, IconSparkles } from "@tabler/icons-react";
import { useTranslations } from "next-intl";
import type { StoryPatchProposal } from "@repo/shared/story-agent";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { storyAuthoringProposalReview, storyLocalizedText } from "./story-authoring-proposal";

export function StoryAuthoringProposalDialog({
  open,
  proposal,
  applying,
  discarding,
  onOpenChange,
  onApply,
  onDiscard,
}: {
  open: boolean;
  proposal: StoryPatchProposal;
  applying: boolean;
  discarding: boolean;
  onOpenChange: (open: boolean) => void;
  onApply: () => void;
  onDiscard: () => void;
}) {
  const t = useTranslations("storyStudio.authoringRun");
  const review = storyAuthoringProposalReview(proposal);
  const busy = applying || discarding;
  const sceneNames = new Map(
    review.scenes.map((scene) => [scene.nodeId, scene.name?.trim() || scene.nodeId])
  );

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => !busy && onOpenChange(nextOpen)}>
      <DialogContent
        showCloseButton={!busy}
        className="max-h-[calc(100dvh-1rem)] w-[calc(100vw-1rem)] max-w-none grid-rows-[auto_minmax(0,1fr)_auto] gap-0 overflow-hidden rounded-[22px] bg-[oklch(0.18_0_0/0.99)] p-0 text-white shadow-[0_32px_110px_rgba(0,0,0,0.78)] sm:max-h-[calc(100dvh-3rem)] sm:w-[min(760px,calc(100vw-3rem))] sm:max-w-[760px]"
        onEscapeKeyDown={(event) => {
          if (busy) event.preventDefault();
        }}
        onPointerDownOutside={(event) => {
          if (busy) event.preventDefault();
        }}
      >
        <DialogHeader className="border-b border-white/[0.07] px-5 pt-5 pr-14 pb-4 sm:px-7 sm:pt-7 sm:pr-16">
          <div className="mb-2 flex items-center gap-2 text-[10px] font-semibold tracking-[0.12em] text-white/45 uppercase">
            <IconSparkles className="size-3.5" stroke={1.8} />
            {t("proposal.eyebrow")}
          </div>
          <DialogTitle className="text-xl leading-tight font-semibold tracking-[-0.02em] text-white">
            {proposal.title}
          </DialogTitle>
          <DialogDescription className="max-w-[66ch] text-xs leading-5 text-white/55">
            {t("proposal.description")}
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="min-h-0">
          <div className="space-y-7 px-5 py-5 sm:px-7 sm:py-6">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Metric value={review.metrics.scenes} label={t("proposal.metrics.scenes")} />
              <Metric value={review.metrics.branches} label={t("proposal.metrics.branches")} />
              <Metric value={review.metrics.endings} label={t("proposal.metrics.endings")} />
              <Metric
                value={review.metrics.interactions}
                label={t("proposal.metrics.interactions")}
              />
            </div>

            <ReviewSection title={t("proposal.sections.summary")}>
              <p className="whitespace-pre-wrap text-sm leading-6 text-white/88">
                {proposal.summary}
              </p>
              {review.logline && review.logline !== proposal.summary ? (
                <p className="mt-3 border-l-2 border-white/18 pl-3 text-xs leading-5 text-white/62">
                  {review.logline}
                </p>
              ) : null}
              {review.synopsis ? (
                <p className="mt-3 whitespace-pre-wrap text-xs leading-6 text-white/68">
                  {review.synopsis}
                </p>
              ) : null}
            </ReviewSection>

            {review.characters.length > 0 ? (
              <ReviewSection title={t("proposal.sections.characters")}>
                <div className="grid gap-2 sm:grid-cols-2">
                  {review.characters.map((character) => (
                    <div
                      key={character.id}
                      className="rounded-xl bg-white/[0.045] px-3.5 py-3 ring-1 ring-inset ring-white/[0.065]"
                    >
                      <p className="text-xs font-semibold text-white/90">
                        {storyLocalizedText(character.name)}
                      </p>
                      {character.summary ? (
                        <p className="mt-1 text-[11px] leading-5 text-white/55">
                          {character.summary}
                        </p>
                      ) : null}
                    </div>
                  ))}
                </div>
              </ReviewSection>
            ) : null}

            <ReviewSection title={t("proposal.sections.structure")}>
              {review.scenes.length > 0 ? (
                <div className="space-y-2">
                  {review.scenes.map((scene, index) => (
                    <article
                      key={scene.nodeId}
                      className="rounded-2xl bg-white/[0.04] p-4 ring-1 ring-inset ring-white/[0.065]"
                    >
                      <div className="flex items-start gap-3">
                        <span className="grid size-7 shrink-0 place-items-center rounded-lg bg-white/[0.07] text-[10px] font-semibold text-white/62">
                          {index + 1}
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                            <h4 className="text-xs font-semibold text-white/92">
                              {scene.name?.trim() || t("proposal.untitledScene")}
                            </h4>
                            <span className="truncate font-mono text-[9px] text-white/28">
                              {scene.nodeId}
                            </span>
                          </div>
                          {scene.description ? (
                            <p className="mt-1.5 whitespace-pre-wrap text-[11px] leading-5 text-white/60">
                              {scene.description}
                            </p>
                          ) : null}

                          {scene.exit.kind === "choice" ? (
                            <div className="mt-3 rounded-xl bg-black/20 p-3">
                              <p className="flex items-center gap-1.5 text-[11px] font-medium text-white/72">
                                <IconGitBranch className="size-3.5" stroke={1.8} />
                                {storyLocalizedText(scene.exit.prompt)}
                              </p>
                              <ul className="mt-2 space-y-1.5">
                                {scene.exit.choices.map((choice) => (
                                  <li
                                    key={choice.choiceId}
                                    className="flex items-start gap-2 text-[10px] leading-4 text-white/52"
                                  >
                                    <span className="mt-1.5 size-1 shrink-0 rounded-full bg-white/35" />
                                    <span className="min-w-0">
                                      <span className="text-white/72">
                                        {storyLocalizedText(choice.label)}
                                      </span>
                                      <span className="px-1.5 text-white/28">→</span>
                                      {sceneNames.get(choice.nextNodeId) ?? choice.nextNodeId}
                                    </span>
                                  </li>
                                ))}
                              </ul>
                            </div>
                          ) : (
                            <p className="mt-3 flex items-center gap-1.5 text-[10px] text-white/38">
                              <IconMovie className="size-3.5" stroke={1.8} />
                              {scene.exit.nextNodeId
                                ? t("proposal.continuesTo", {
                                    scene:
                                      sceneNames.get(scene.exit.nextNodeId) ??
                                      scene.exit.nextNodeId,
                                  })
                                : t("proposal.ending")}
                            </p>
                          )}
                        </div>
                      </div>
                    </article>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-white/42">{t("proposal.noScenes")}</p>
              )}
            </ReviewSection>

            {review.productionNotes.length > 0 ? (
              <ReviewSection title={t("proposal.sections.productionNotes")}>
                <ul className="space-y-2">
                  {review.productionNotes.map((note, index) => (
                    <li
                      key={`${index}:${note}`}
                      className="flex gap-2 text-xs leading-5 text-white/62"
                    >
                      <span className="mt-2 size-1 shrink-0 rounded-full bg-white/35" />
                      <span>{note}</span>
                    </li>
                  ))}
                </ul>
              </ReviewSection>
            ) : null}
          </div>
        </ScrollArea>

        <DialogFooter className="shrink-0 border-t border-white/[0.07] bg-black/15 px-5 py-4 sm:flex-row sm:justify-between sm:px-7">
          <Button
            type="button"
            variant="ghost"
            size="lg"
            disabled={busy}
            className="text-white/48 hover:text-white/80"
            onClick={onDiscard}
          >
            {discarding ? <IconLoader2 className="size-4 animate-spin" /> : null}
            {t("discard")}
          </Button>
          <Button type="button" size="lg" disabled={busy} className="sm:min-w-44" onClick={onApply}>
            {applying ? <IconLoader2 className="size-4 animate-spin" /> : null}
            {t("apply")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Metric({ value, label }: { value: number; label: string }) {
  return (
    <div className="rounded-xl bg-white/[0.045] px-3 py-3 ring-1 ring-inset ring-white/[0.06]">
      <p className="text-lg font-semibold tracking-[-0.02em] text-white">{value}</p>
      <p className="mt-0.5 text-[10px] text-white/42">{label}</p>
    </div>
  );
}

function ReviewSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="mb-2.5 text-[10px] font-semibold tracking-[0.1em] text-white/42 uppercase">
        {title}
      </h3>
      {children}
    </section>
  );
}
