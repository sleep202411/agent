"use client";

import { Handle, Position, type NodeProps } from "@xyflow/react";
import { IconFileText } from "@tabler/icons-react";
import { cn } from "@/lib/utils";
import type { NarrativeNode } from "../types";
import { CharacterCardNode } from "./character-card";
import { ClueNodeCard } from "./clue-card";
import { EndingNodeCard } from "./ending-card";
import { KIND_META } from "./kind-meta";
import { PlotNodeCard } from "./plot-card";
import { NodeEditButton, NodeVisual, StatusPill } from "./shared";
import { StoryRootPreviewNode } from "./story-root-card";

export function NarrativeNodeCard({ data, selected }: NodeProps<NarrativeNode>) {
  if (data.kind === "storyRoot" || data.storyRootMode === "document") {
    return <StoryRootPreviewNode data={data} selected={selected} />;
  }

  if (data.kind === "plot") {
    return <PlotNodeCard data={data} selected={selected} />;
  }

  if (data.kind === "role") {
    return <CharacterCardNode data={data} selected={selected} />;
  }

  if (data.kind === "ending") {
    return <EndingNodeCard data={data} selected={selected} />;
  }

  if (data.kind === "clue") {
    return <ClueNodeCard data={data} selected={selected} />;
  }

  const meta = KIND_META[data.kind] ?? {
    icon: IconFileText,
    accent: "text-white",
    glow: "bg-white/14",
  };
  const Icon = meta.icon;

  return (
    <article
      className={cn(
        "group relative w-[360px] overflow-visible rounded-[26px] bg-[oklch(0.19_0_0)] p-4 shadow-[0_24px_80px_rgba(0,0,0,0.36)] transition duration-200",
        selected && "bg-[oklch(0.23_0_0)] shadow-[0_28px_90px_rgba(0,0,0,0.48)]"
      )}
    >
      <Handle
        id="node-in"
        type="target"
        position={Position.Left}
        className="-left-1.5! z-20! size-3! border-0! bg-white/45!"
      />
      <Handle
        id="node-out"
        type="source"
        position={Position.Right}
        className="-right-1.5! z-20! size-3! border-0! bg-white/55!"
      />

      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <span className={cn("grid size-8 place-items-center rounded-full", meta.glow)}>
            <Icon className={cn("size-4", meta.accent)} stroke={1.8} />
          </span>
          <div className="min-w-0">
            <p className="truncate text-[11px] font-semibold uppercase tracking-[0.16em] text-white/38">
              {data.eyebrow}
            </p>
            <h3 className="truncate text-[17px] font-semibold text-white/92">{data.label}</h3>
          </div>
        </div>
        <StatusPill status={data.status ?? "ready"} />
      </div>

      {data.image ? <NodeVisual type={data.image} /> : null}

      <p className="mt-3 line-clamp-3 text-[13px] leading-6 text-white/58">{data.summary}</p>

      <div className="mt-4 flex flex-wrap gap-1.5">
        {(data.chips ?? []).map((chip) => (
          <span
            key={chip}
            className="rounded-full bg-white/[0.065] px-2.5 py-1 text-[11px] text-white/58"
          >
            {chip}
          </span>
        ))}
      </div>

      <div className="mt-4">
        <NodeEditButton onClick={data.onEditNode} />
      </div>
    </article>
  );
}

export const NODE_TYPES = { narrative: NarrativeNodeCard };
