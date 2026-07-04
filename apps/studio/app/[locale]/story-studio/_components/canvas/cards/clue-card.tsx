"use client";

import { Handle, Position, type NodeProps } from "@xyflow/react";
import { IconFingerprint } from "@tabler/icons-react";
import { cn } from "@/lib/utils";
import { CONNECTION_PORTS } from "../ports";
import type { NarrativeNode } from "../types";
import { NodeEditButton, NodeTypeChip } from "./shared";

export function ClueNodeCard({
  data,
  selected,
}: Pick<NodeProps<NarrativeNode>, "data" | "selected">) {
  return (
    <div className="relative w-[300px] pt-10">
      <NodeTypeChip
        label="线索"
        icon={IconFingerprint}
        color="rgba(91,157,255,0.38)"
        iconBg="rgba(91,157,255,0.62)"
      />
      <article
        className={cn(
          "relative w-[300px] overflow-visible rounded-[24px] bg-[oklch(0.18_0_0)] p-4 shadow-[0_20px_64px_rgba(0,0,0,0.34)] transition duration-200",
          selected && "bg-[oklch(0.22_0_0)] shadow-[0_24px_76px_rgba(0,0,0,0.48)]"
        )}
      >
        <Handle
          id="clue-in"
          type="target"
          position={Position.Left}
          className="-left-1.5! z-20! size-3! border-0!"
          style={{
            top: 44,
            backgroundColor: CONNECTION_PORTS.clues.color,
            boxShadow: `0 0 18px ${CONNECTION_PORTS.clues.glow}`,
          }}
        />

        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-start gap-3">
            <span className="grid size-10 shrink-0 place-items-center rounded-full bg-[#5b9dff]/14 text-[#9dc5ff]">
              <IconFingerprint className="size-5" stroke={1.8} />
            </span>
            <div className="min-w-0">
              <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-white/34">
                {data.eyebrow}
              </p>
              <h3 className="mt-1 line-clamp-2 text-[18px] font-black leading-tight text-white/92">
                {data.label}
              </h3>
            </div>
          </div>
          <span className="shrink-0 rounded-full bg-[#5b9dff]/12 px-2 py-1 text-[10px] font-black text-[#9dc5ff]">
            {data.clueType ?? "线索"}
          </span>
        </div>

        <p className="mt-4 line-clamp-2 text-[12px] font-semibold leading-5 text-white/54">
          {data.summary}
        </p>

        <div className="mt-4 grid grid-cols-2 gap-2">
          {[
            ["归属", data.clueSource ?? "归属故事线索库"],
            ["用途", data.clueUse ?? "作为后续追问、推理或出口条件的证据状态。"],
          ].map(([label, value]) => (
            <div key={label} className="rounded-[16px] bg-black/18 p-3">
              <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-white/28">
                {label}
              </p>
              <p className="mt-1 line-clamp-1 text-[11px] font-semibold leading-5 text-white/48">
                {value}
              </p>
            </div>
          ))}
        </div>

        <p className="mt-2 line-clamp-2 rounded-[16px] bg-black/18 p-3 text-[11px] font-semibold leading-5 text-white/46">
          <span className="mr-2 text-white/28">AI 约束</span>
          {data.clueRule ?? "未解锁前不能被 AI 当作已知事实引用。"}
        </p>

        <div className="mt-4 flex flex-wrap gap-1.5">
          {(data.chips ?? []).slice(0, 3).map((chip) => (
            <span
              key={chip}
              className="rounded-full bg-white/[0.065] px-2.5 py-1 text-[10px] font-semibold text-white/48"
            >
              {chip}
            </span>
          ))}
        </div>

        <div className="mt-4">
          <NodeEditButton onClick={data.onEditNode} />
        </div>
      </article>
    </div>
  );
}
