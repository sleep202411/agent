"use client";

import { useState } from "react";
import {
  IconCheck,
  IconChevronRight,
  IconClock,
  IconFileDescription,
  IconLoader2,
  IconRotateClockwise,
  IconX,
} from "@tabler/icons-react";
import { useTranslations } from "next-intl";
import { storyScreenplayDocument, type StoryScreenplayProposal } from "@repo/shared/story-agent";
import type { AgentOsArtifactStatus } from "@/components/agent-os/agent-os-timeline";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { StoryScreenplayDocumentView } from "./story-screenplay-document-view";

const STATUS_ICONS = {
  proposed: IconClock,
  active: IconClock,
  applying: IconLoader2,
  applied: IconCheck,
  rejected: IconRotateClockwise,
  failed: IconX,
  cancelled: IconX,
} satisfies Record<AgentOsArtifactStatus, typeof IconCheck>;

export function StoryScreenplayProposalCard({
  proposal,
  status,
}: {
  proposal: StoryScreenplayProposal;
  status: AgentOsArtifactStatus;
}) {
  const t = useTranslations("storyStudio.authoringRun.screenplayCard");
  const [open, setOpen] = useState(false);
  const document = storyScreenplayDocument(proposal);
  const choiceCount = proposal.screenplay.scenes.reduce(
    (total, scene) => total + (scene.exit.kind === "choice" ? scene.exit.choices.length : 0),
    0
  );
  const StatusIcon = STATUS_ICONS[status];

  return (
    <>
      <article data-testid="story-screenplay-proposal-card" className="space-y-3 py-1">
        <div className="flex items-start gap-3">
          <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-white/[0.06] text-white/72">
            <IconFileDescription className="size-4.5" stroke={1.7} />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-center justify-between gap-3">
              <p className="text-[11px] font-semibold tracking-[0.09em] text-white/58 uppercase">
                {t("eyebrow")}
              </p>
              <span className="flex shrink-0 items-center gap-1 text-[11px] text-white/58">
                <StatusIcon
                  className={status === "applying" ? "size-3.5 animate-spin" : "size-3.5"}
                  stroke={1.8}
                />
                {t(`status.${status}`)}
              </span>
            </div>
            <h3 className="mt-1 text-base leading-6 font-semibold tracking-[-0.01em] text-white">
              {proposal.screenplay.title}
            </h3>
          </div>
        </div>

        <p className="line-clamp-3 text-sm leading-6 text-white/72">{proposal.summary}</p>

        <dl className="grid grid-cols-3 divide-x divide-white/[0.07] rounded-xl bg-white/[0.04] py-2.5">
          <Metric value={proposal.screenplay.scenes.length} label={t("metrics.scenes")} />
          <Metric value={proposal.screenplay.characters.length} label={t("metrics.characters")} />
          <Metric value={choiceCount} label={t("metrics.choices")} />
        </dl>

        <Button
          type="button"
          variant="secondary"
          className="h-10 w-full justify-between px-3.5 text-xs font-medium"
          onClick={() => setOpen(true)}
        >
          {t("review")}
          <IconChevronRight className="size-4 text-white/58" stroke={1.8} />
        </Button>
      </article>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          data-testid="story-screenplay-review-dialog"
          className="max-h-[calc(100dvh-1rem)] w-[calc(100vw-1rem)] max-w-none grid-rows-[auto_minmax(0,1fr)] gap-0 overflow-hidden rounded-[22px] bg-[oklch(0.18_0_0/0.99)] p-0 text-white shadow-[0_32px_110px_rgba(0,0,0,0.78)] sm:max-h-[calc(100dvh-3rem)] sm:w-[min(760px,calc(100vw-3rem))] sm:max-w-[760px]"
        >
          <DialogHeader className="border-b border-white/[0.07] px-5 pt-5 pr-14 pb-4 sm:px-7 sm:pt-7 sm:pr-16">
            <div className="mb-2 flex items-center gap-2 text-[11px] font-semibold tracking-[0.1em] text-white/62 uppercase">
              <IconFileDescription className="size-3.5" stroke={1.8} />
              {t("eyebrow")}
            </div>
            <DialogTitle className="text-xl leading-tight font-semibold tracking-[-0.02em] text-white">
              {proposal.screenplay.title}
            </DialogTitle>
            <DialogDescription className="max-w-[66ch] text-xs leading-5 text-white/68">
              {t("dialogDescription")}
            </DialogDescription>
          </DialogHeader>
          <ScrollArea
            className="min-h-0"
            viewportProps={{ tabIndex: 0, "aria-label": t("reviewRegion") }}
          >
            <StoryScreenplayDocumentView document={document} />
          </ScrollArea>
        </DialogContent>
      </Dialog>
    </>
  );
}

function Metric({ value, label }: { value: number; label: string }) {
  return (
    <div className="px-2.5 text-center">
      <dd className="text-sm font-semibold tabular-nums text-white/92">{value}</dd>
      <dt className="mt-0.5 text-[10px] text-white/50">{label}</dt>
    </div>
  );
}
