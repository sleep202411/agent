"use client";

import { Handle, Position, type NodeProps } from "@xyflow/react";
import { IconGitBranch } from "@tabler/icons-react";
import { cn } from "@/lib/utils";
import type { NarrativeNode } from "../types";
import { NodeEditButton, NodeTypeChip, StatusPill } from "./shared";

export function PlotNodeCard({
  data,
  selected,
}: Pick<NodeProps<NarrativeNode>, "data" | "selected">) {
  return (
    <div className="relative w-[330px] pt-10">
      <NodeTypeChip
        label="剧情节点"
        icon={IconGitBranch}
        color="rgba(255,255,255,0.14)"
        iconBg="rgba(255,255,255,0.22)"
      />
      <article
        className={cn(
          "relative w-[330px] overflow-visible rounded-[28px] bg-[oklch(0.19_0_0)] p-4 shadow-[0_24px_80px_rgba(0,0,0,0.38)] transition duration-200",
          selected && "bg-[oklch(0.23_0_0)] shadow-[0_28px_90px_rgba(0,0,0,0.5)]"
        )}
      >
        {/* Anchors sit at a FIXED offset from the card top (aligned with the
          title row) — card heights vary with content, so percentage anchors
          would zigzag the lane. */}
        <Handle
          type="target"
          position={Position.Left}
          className="-left-1.5! z-20! size-3! border-0! bg-white/45!"
          style={{ top: 44 }}
        />
        <Handle
          type="source"
          position={Position.Right}
          className="-right-1.5! z-20! size-3! border-0! bg-white/62!"
          style={{ top: 44 }}
        />

        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <span className="grid size-12 shrink-0 place-items-center rounded-full bg-white text-[18px] font-black text-black">
              {data.plotStage ?? "?"}
            </span>
            <div className="min-w-0">
              <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-white/36">
                {data.eyebrow}
              </p>
              <h3 className="mt-1 line-clamp-2 text-[19px] font-black leading-tight text-white/92">
                {data.label}
              </h3>
            </div>
          </div>
          <StatusPill status={data.status ?? "ready"} />
        </div>

        <p className="mt-4 line-clamp-3 text-[13px] font-semibold leading-6 text-white/54">
          {data.summary}
        </p>

        {data.plotGoal ? (
          // Generated plots carry only the REAL analysis fields — no faked
          // action counts or media until they are actually produced.
          <div className="mt-4 rounded-[18px] bg-white/[0.06] px-3.5 py-3">
            <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-white/32">
              Entry goal
            </p>
            <p className="mt-1.5 line-clamp-2 text-[12px] font-medium leading-5 text-white/60">
              {data.plotGoal}
            </p>
          </div>
        ) : null}

        <div className="mt-4 flex flex-wrap gap-1.5 pb-11">
          {(data.chips ?? []).map((chip) => (
            <span
              key={chip}
              className="rounded-full bg-white/[0.065] px-2.5 py-1 text-[11px] font-semibold text-white/52"
            >
              {chip}
            </span>
          ))}
        </div>

        <div className="absolute bottom-4 right-4 flex items-center gap-2">
          <NodeEditButton onClick={data.onEditNode} />
        </div>
      </article>
    </div>
  );
}
