"use client";

import { Handle, Position, type NodeProps } from "@xyflow/react";
import { IconRocket } from "@tabler/icons-react";
import { cn } from "@/lib/utils";
import type { NarrativeNode } from "../types";
import { CANVAS_LAYOUT } from "./kind-meta";
import { NodeEditButton, NodeTypeChip } from "./shared";

export function EndingNodeCard({
  data,
  selected,
}: Pick<NodeProps<NarrativeNode>, "data" | "selected">) {
  const endingLabel =
    data.endingType === "intervention"
      ? "中断"
      : data.endingType === "failure"
        ? "失败"
        : data.endingType === "hidden"
          ? "隐藏"
          : "主线";

  return (
    <div className="relative w-[330px] pt-10">
      <NodeTypeChip
        label="结局"
        icon={IconRocket}
        color="rgba(229,34,39,0.36)"
        iconBg="rgba(229,34,39,0.60)"
      />
      <article
        className={cn(
          "relative w-[330px] overflow-visible rounded-[26px] bg-[oklch(0.185_0_0)] p-5 shadow-[0_24px_80px_rgba(0,0,0,0.36)] transition duration-200",
          selected && "bg-[oklch(0.225_0_0)] shadow-[0_28px_90px_rgba(0,0,0,0.5)]"
        )}
        style={{ height: CANVAS_LAYOUT.endingCardHeight }}
      >
        <Handle
          id="ending-in"
          type="target"
          position={Position.Left}
          className="-left-1.5! z-20! size-3! border-0! bg-white/72!"
          style={{ top: 44 }}
        />

        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <span className="grid size-11 shrink-0 place-items-center rounded-full bg-white/12 text-white/86">
              <IconRocket className="size-5" stroke={1.8} />
            </span>
            <div className="min-w-0">
              <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-white/34">
                {data.eyebrow}
              </p>
              <h3 className="mt-1 line-clamp-2 text-[20px] font-black leading-tight text-white/92">
                {data.label}
              </h3>
            </div>
          </div>
          <span className="shrink-0 rounded-full bg-white/[0.075] px-2.5 py-1 text-[10px] font-black text-white/58">
            {endingLabel}
          </span>
        </div>

        <p className="mt-4 line-clamp-2 text-[13px] font-semibold leading-6 text-white/56">
          {data.summary}
        </p>

        <div className="mt-4">
          <div className="rounded-[18px] bg-black/18 p-3">
            <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-white/28">
              达成方式
            </p>
            <p className="mt-1 line-clamp-2 text-[11px] font-semibold leading-5 text-white/50">
              {data.endingTrigger ?? "由剧情出口触发。"}
            </p>
          </div>
        </div>

        <div className="absolute inset-x-5 bottom-5 flex items-center justify-between gap-3">
          <div className="flex min-w-0 flex-wrap gap-1.5">
            {(data.chips ?? []).slice(0, 2).map((chip) => (
              <span
                key={chip}
                className="rounded-full bg-white/[0.065] px-2.5 py-1 text-[10px] font-semibold text-white/48"
              >
                {chip}
              </span>
            ))}
          </div>
          <NodeEditButton onClick={data.onEditNode} />
        </div>
      </article>
    </div>
  );
}
