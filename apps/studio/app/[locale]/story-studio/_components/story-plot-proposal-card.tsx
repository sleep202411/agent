"use client";

import { useMemo, useState } from "react";
import { Controls, Handle, Position, ReactFlowProvider, type NodeProps } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import {
  IconCheck,
  IconChevronRight,
  IconClock,
  IconGitBranch,
  IconLoader2,
  IconRotateClockwise,
  IconRoute,
  IconX,
} from "@tabler/icons-react";
import { useLocale, useTranslations } from "next-intl";
import type { StoryPlotProposal } from "@repo/shared/story-agent";
import type { AgentOsArtifactStatus } from "@/components/agent-os/agent-os-timeline";
import { CanvasBackdrop } from "@/components/canvas/canvas-backdrop";
import { CanvasReactFlow } from "@/components/canvas/canvas-react-flow";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { buildStoryPlotPreviewModel, type StoryPlotPreviewNode } from "./story-plot-proposal-model";
import { StorySourceReviewNotes } from "./story-source-review-notes";

const STATUS_ICONS = {
  proposed: IconClock,
  active: IconClock,
  applying: IconLoader2,
  applied: IconCheck,
  rejected: IconRotateClockwise,
  failed: IconX,
  cancelled: IconX,
} satisfies Record<AgentOsArtifactStatus, typeof IconCheck>;

const NODE_TYPES = { storyPlotPreview: StoryPlotPreviewNodeCard };

export function StoryPlotProposalCard({
  proposal,
  status,
}: {
  proposal: StoryPlotProposal;
  status: AgentOsArtifactStatus;
}) {
  const t = useTranslations("storyStudio.authoringRun.plotCard");
  const locale = useLocale();
  const [open, setOpen] = useState(false);
  const model = useMemo(
    () => buildStoryPlotPreviewModel(proposal, locale, t("scene"), t("decision")),
    [locale, proposal, t]
  );
  const StatusIcon = STATUS_ICONS[status];

  return (
    <>
      <article data-testid="story-plot-proposal-card" className="space-y-3 py-1">
        <div className="flex items-start gap-3">
          <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-white/[0.06] text-white/72">
            <IconGitBranch className="size-4.5" stroke={1.7} />
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
              {proposal.title}
            </h3>
          </div>
        </div>

        <p className="line-clamp-2 text-sm leading-6 text-white/72">{proposal.summary}</p>
        <StorySourceReviewNotes notes={proposal.screenplay.reviewNotes} />

        <dl className="grid grid-cols-3 divide-x divide-white/[0.07] rounded-xl bg-white/[0.04] py-2.5">
          <Metric value={model.metrics.nodes} label={t("metrics.nodes")} />
          <Metric value={model.metrics.branches} label={t("metrics.branches")} />
          <Metric value={model.metrics.endings} label={t("metrics.endings")} />
        </dl>

        <div className="flex min-w-0 items-center gap-2 text-xs text-white/58">
          <IconRoute aria-hidden="true" className="size-3.5 shrink-0" stroke={1.7} />
          <span className="shrink-0">{t("entry")}</span>
          <span className="truncate font-medium text-white/78">{model.entryTitle}</span>
        </div>

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
          data-testid="story-plot-review-dialog"
          className="grid h-[min(820px,calc(100dvh-1rem))] w-[calc(100vw-1rem)] max-w-none grid-rows-[auto_minmax(0,1fr)] gap-0 overflow-hidden rounded-[22px] bg-[oklch(0.18_0_0/0.99)] p-0 text-white shadow-[0_32px_110px_rgba(0,0,0,0.78)] sm:h-[min(820px,calc(100dvh-3rem))] sm:w-[calc(100vw-3rem)] sm:max-w-6xl"
        >
          <DialogHeader className="border-b border-white/[0.07] px-5 pt-5 pr-14 pb-4 sm:px-7 sm:pt-6 sm:pr-16">
            <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
              <div className="min-w-0">
                <div className="mb-2 flex items-center gap-2 text-[11px] font-semibold tracking-[0.1em] text-white/62 uppercase">
                  <IconGitBranch className="size-3.5" stroke={1.8} />
                  {t("eyebrow")}
                </div>
                <DialogTitle className="text-xl leading-tight font-semibold tracking-[-0.02em] text-white">
                  {proposal.title}
                </DialogTitle>
                <DialogDescription className="mt-1 max-w-[72ch] text-xs leading-5 text-white/68">
                  {t("dialogDescription")}
                </DialogDescription>
              </div>
              <dl className="flex shrink-0 divide-x divide-white/[0.07] rounded-xl bg-white/[0.04] py-2">
                <Metric value={model.metrics.nodes} label={t("metrics.nodes")} compact />
                <Metric value={model.metrics.branches} label={t("metrics.branches")} compact />
                <Metric value={model.metrics.endings} label={t("metrics.endings")} compact />
              </dl>
            </div>
          </DialogHeader>

          {open ? <StoryPlotProposalCanvas model={model} ariaLabel={t("canvasRegion")} /> : null}
        </DialogContent>
      </Dialog>
    </>
  );
}

function StoryPlotProposalCanvas({
  model,
  ariaLabel,
}: {
  model: ReturnType<typeof buildStoryPlotPreviewModel>;
  ariaLabel: string;
}) {
  return (
    <div role="region" aria-label={ariaLabel} className="relative min-h-0 overflow-hidden">
      <CanvasBackdrop />
      <ReactFlowProvider>
        <CanvasReactFlow
          aria-label={ariaLabel}
          nodes={model.nodes}
          edges={model.edges}
          nodeTypes={NODE_TYPES}
          defaultTool="pan"
          colorMode="dark"
          proOptions={{ hideAttribution: true }}
          minZoom={0.18}
          maxZoom={1.5}
          defaultViewport={{ x: 72, y: 72, zoom: 0.62 }}
          nodesDraggable={false}
          nodesConnectable={false}
          edgesReconnectable={false}
          elementsSelectable={false}
          edgesFocusable={false}
          nodesFocusable
          zoomOnDoubleClick={false}
          fitView
          fitViewOptions={{ padding: 0.18, minZoom: 0.22, maxZoom: 0.92 }}
          className="relative z-10"
          style={{ backgroundColor: "transparent" }}
        >
          <Controls
            showInteractive={false}
            className="canvas-tool-controls bottom-5! left-5! m-0! overflow-hidden rounded-xl bg-[oklch(0.24_0_0/0.88)]! shadow-[0_18px_60px_rgba(0,0,0,0.35)] backdrop-blur-[30px]! [&_button]:size-9!"
          />
        </CanvasReactFlow>
      </ReactFlowProvider>
    </div>
  );
}

function StoryPlotPreviewNodeCard({ data }: NodeProps<StoryPlotPreviewNode>) {
  const t = useTranslations("storyStudio.authoringRun.plotCard");
  const isEnding =
    !data.unresolved &&
    data.kind !== "decision" &&
    data.exitKind === "auto" &&
    !data.continuationTargetNodeId;

  return (
    <article
      aria-label={data.title}
      className="relative w-[248px] overflow-visible rounded-2xl bg-[oklch(0.225_0_0/0.94)] shadow-[0_20px_65px_rgba(0,0,0,0.42)]"
    >
      <Handle
        id="in"
        type="target"
        position={Position.Left}
        isConnectable={false}
        className="-left-1.5! size-3! border-0! bg-white/72!"
      />
      <div className="px-4 py-3.5">
        <div className="flex items-center gap-2">
          <span className="min-w-0 flex-1 truncate text-[10px] font-semibold tracking-[0.08em] text-white/46 uppercase">
            {data.eyebrow}
          </span>
          {data.isEntry ? (
            <span className="rounded-md bg-white/[0.08] px-1.5 py-0.5 text-[9px] font-semibold text-white/66">
              {t("entry")}
            </span>
          ) : null}
          {isEnding ? (
            <span className="rounded-md bg-white/[0.08] px-1.5 py-0.5 text-[9px] font-semibold text-white/66">
              {t("ending")}
            </span>
          ) : null}
          {data.unresolved ? (
            <span className="text-[9px] text-white/66">{t("unresolved")}</span>
          ) : null}
        </div>
        <h3 className="mt-1.5 truncate text-sm font-semibold text-white/92">{data.title}</h3>
        {data.summary ? (
          <p className="mt-1.5 line-clamp-2 text-[11px] leading-[18px] text-white/52">
            {data.summary}
          </p>
        ) : null}
      </div>

      {data.kind === "decision" ? (
        <div className="border-t border-white/[0.07] py-1">
          {(data.choices ?? []).map((choice, index) => (
            <div
              key={choice.choiceId}
              className="relative flex min-h-9 items-center gap-2 px-4 text-[10px] text-white/56"
            >
              <span className="w-4 shrink-0 tabular-nums text-white/26">
                {String(index + 1).padStart(2, "0")}
              </span>
              <span className="min-w-0 flex-1 truncate font-medium text-white/72">
                {choice.label}
              </span>
              <span className="max-w-24 truncate text-white/34">→ {choice.targetTitle}</span>
              <Handle
                id={`choice:${choice.choiceId}`}
                type="source"
                position={Position.Right}
                isConnectable={false}
                className="-right-1.5! size-3! border-0! bg-brand-blue!"
              />
            </div>
          ))}
        </div>
      ) : data.continuationTargetNodeId ? (
        <div className="relative flex min-h-9 items-center gap-2 border-t border-white/[0.07] px-4 text-[10px] text-white/42">
          <span>{t("continues")}</span>
          <Handle
            id="completion"
            type="source"
            position={Position.Right}
            isConnectable={false}
            className="-right-1.5! top-1/2! size-3! border-0! bg-white/72!"
          />
        </div>
      ) : null}
    </article>
  );
}

function Metric({
  value,
  label,
  compact = false,
}: {
  value: number;
  label: string;
  compact?: boolean;
}) {
  return (
    <div className={cn("text-center", compact ? "min-w-16 px-3" : "px-2.5")}>
      <dd className="text-sm font-semibold tabular-nums text-white/92">{value}</dd>
      <dt className="mt-0.5 text-[10px] text-white/50">{label}</dt>
    </div>
  );
}
