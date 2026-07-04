"use client";

import { Handle, Position, type NodeProps } from "@xyflow/react";
import { IconUserCircle, IconUsersGroup } from "@tabler/icons-react";
import { cn } from "@/lib/utils";
import { CONNECTION_PORTS } from "../ports";
import type { NarrativeNode } from "../types";
import {
  ROLE_CARD_HEIGHT,
  ROLE_CARD_WIDTH,
  ROLE_PORTRAIT_HEIGHT,
  ROLE_PORTRAIT_WIDTH,
} from "./kind-meta";
import { CharacterPortrait, NodeTypeChip } from "./shared";

export function CharacterCardNode({
  data,
  selected,
}: Pick<NodeProps<NarrativeNode>, "data" | "selected">) {
  const roleLabel = data.characterMode === "protagonist" ? "主角" : "角色";

  return (
    <div className="relative pt-10" style={{ width: ROLE_CARD_WIDTH }}>
      <NodeTypeChip
        label="角色"
        icon={IconUsersGroup}
        color="rgba(167,139,250,0.40)"
        iconBg="rgba(167,139,250,0.65)"
      />
      <article
        className={cn(
          "group relative overflow-visible rounded-[22px] bg-[oklch(0.18_0_0)] p-2.5 shadow-[0_18px_58px_rgba(0,0,0,0.32)] transition duration-200",
          selected && "bg-[oklch(0.215_0_0)] shadow-[0_22px_70px_rgba(0,0,0,0.44)]"
        )}
        style={{ width: ROLE_CARD_WIDTH, height: ROLE_CARD_HEIGHT }}
      >
        <Handle
          id="role-in"
          type="target"
          position={Position.Left}
          className="-left-1.5! z-30! size-3! border-0!"
          style={{
            top: 44,
            backgroundColor: CONNECTION_PORTS.roles.color,
            boxShadow: `0 0 18px ${CONNECTION_PORTS.roles.glow}`,
          }}
        />
        <div
          className="grid h-full gap-3"
          style={{ gridTemplateColumns: `${ROLE_PORTRAIT_WIDTH}px 1fr` }}
        >
          <CharacterPortrait
            portrait={data.characterPortrait ?? "neutral"}
            compact
            sizes={`${ROLE_PORTRAIT_WIDTH}px`}
            className="rounded-[18px]"
            style={{ width: ROLE_PORTRAIT_WIDTH, height: ROLE_PORTRAIT_HEIGHT }}
          />
          <div className="flex min-w-0 flex-col py-1">
            <div className="mb-1.5 flex items-center">
              <span className="rounded-full bg-white/[0.08] px-2 py-0.5 text-[10px] font-semibold text-white/50">
                {roleLabel}
              </span>
            </div>
            <h3 className="line-clamp-1 text-[15px] font-semibold leading-5 text-white/88">
              {data.label}
            </h3>
            <p className="mt-2 line-clamp-2 text-[11px] font-medium leading-4 text-white/48">
              {data.summary}
            </p>
            <div className="mt-auto flex items-center">
              <button
                type="button"
                data-testid={`open-character-viewer-${data.label}`}
                onClick={(event) => {
                  event.stopPropagation();
                  data.onViewCharacter?.();
                }}
                className="nodrag nopan inline-flex h-7 items-center gap-1.5 rounded-full bg-white px-2.5 text-[11px] font-semibold text-black transition hover:bg-white/88 active:translate-y-0.5"
              >
                查看
                <IconUserCircle className="size-3.5" stroke={2} />
              </button>
            </div>
          </div>
        </div>
      </article>
    </div>
  );
}
