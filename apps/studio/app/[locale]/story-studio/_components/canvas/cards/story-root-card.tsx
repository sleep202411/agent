"use client";

import { Handle, Position, type NodeProps } from "@xyflow/react";
import { IconFileText } from "@tabler/icons-react";
import { cn } from "@/lib/utils";
import { CONNECTION_PORTS } from "../ports";
import type { NarrativeNode, StoryRootDocumentSection, StoryRootOverviewCard } from "../types";

export function storyRootOverviewValue(
  cards: readonly StoryRootOverviewCard[] | undefined,
  labels: string[]
): string | null {
  if (!cards || cards.length === 0) return null;

  const normalizedLabels = labels.map((label) => label.toLowerCase());
  const card = cards.find((item) =>
    normalizedLabels.some((label) => item.label.toLowerCase().includes(label))
  );

  return card?.value?.trim() || null;
}

export function storyRootSectionText(
  sections: readonly StoryRootDocumentSection[],
  headings: string[]
): string | null {
  const normalizedHeadings = headings.map((heading) => heading.toLowerCase());
  const section = sections.find((item) =>
    normalizedHeadings.some((heading) => item.heading.toLowerCase().includes(heading))
  );

  return section?.paragraphs.join(" ").trim() || null;
}

function splitStoryRootList(value: string | null | undefined): string[] {
  if (!value) return [];

  return value
    .replace(/^locations:\s*/i, "")
    .replace(/[;；、,，]/g, " · ")
    .split(/\s*·\s*/)
    .map((item) => item.replace(/\.$/, "").trim())
    .filter(Boolean)
    .slice(0, 4);
}

function StoryRootStatTile({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-[18px] bg-white/[0.055] px-3 py-3">
      <p className="text-[22px] font-black leading-none text-white/88">{value}</p>
      <p className="mt-1 text-[11px] font-semibold text-white/36">{label}</p>
    </div>
  );
}

export function StoryRootPreviewNode({
  data,
  selected,
}: Pick<NodeProps<NarrativeNode>, "data" | "selected">) {
  const storyRootSections = data.storyRootSections ?? [];
  const overviewCards = data.storyRootOverviewCards ?? [];
  const worldview =
    storyRootOverviewValue(overviewCards, ["worldview", "世界观"]) ??
    storyRootSectionText(storyRootSections, ["worldview", "世界观"]) ??
    data.summary;
  const storyKernel =
    storyRootSectionText(storyRootSections, ["story kernel", "故事核"]) ?? data.summary;
  const locationText =
    storyRootOverviewValue(overviewCards, ["locations", "地点"]) ??
    storyRootSectionText(storyRootSections, ["locations", "地点"]);
  const locations = splitStoryRootList(locationText);
  const direction =
    storyRootOverviewValue(overviewCards, ["direction", "改编", "类型"]) ??
    storyRootSectionText(storyRootSections, ["adaptation direction", "改编方向"]) ??
    "待确认";
  const stats = data.storyRootStats ?? {
    roleCount: 0,
    plotCount: 0,
    clueCount: 0,
    endingCount: 0,
  };

  return (
    <div className="relative w-[720px] pt-10">
      <div className="absolute left-0 top-0 z-10 inline-flex h-8 items-center gap-2 rounded-full bg-[#7b4be8]/42 px-3 text-[13px] font-semibold text-white shadow-[0_10px_30px_rgba(0,0,0,0.3)] backdrop-blur-xl">
        <span className="grid size-6 place-items-center rounded-full bg-[#8f65ff]/70">
          <IconFileText className="size-3.5" stroke={2} />
        </span>
        故事总纲
      </div>

      <article
        className={cn(
          // 16:9 canvas hero — the tree of global groups fans out below it.
          "group relative h-[405px] overflow-visible rounded-[28px] bg-[linear-gradient(180deg,oklch(0.21_0_0),oklch(0.17_0_0))] p-7 shadow-[0_28px_100px_rgba(0,0,0,0.48)] transition duration-200",
          selected && "bg-[linear-gradient(180deg,oklch(0.24_0_0),oklch(0.18_0_0))]"
        )}
      >
        {/* Fan ports, top→bottom on the RIGHT edge: 角色 · 剧情 · 结局 · 线索 —
            each group hangs off its own anchor. */}
        <Handle
          id="roles"
          type="source"
          position={Position.Right}
          className="-right-1.5! z-30! size-3! border-0!"
          style={{
            top: "18%",
            backgroundColor: CONNECTION_PORTS.roles.color,
            boxShadow: `0 0 18px ${CONNECTION_PORTS.roles.glow}`,
          }}
        />
        <Handle
          id="plots"
          type="source"
          position={Position.Right}
          className="-right-1.5! z-30! size-3! border-0! bg-white/70!"
          style={{ top: "40%" }}
        />
        <Handle
          id="endings"
          type="source"
          position={Position.Right}
          className="-right-1.5! z-30! size-3! border-0! bg-white/45!"
          style={{ top: "62%" }}
        />
        <Handle
          id="clues"
          type="source"
          position={Position.Right}
          className="-right-1.5! z-30! size-3! border-0!"
          style={{
            top: "84%",
            backgroundColor: CONNECTION_PORTS.clues.color,
            boxShadow: `0 0 18px ${CONNECTION_PORTS.clues.glow}`,
          }}
        />

        <div className="flex h-full min-h-0 gap-6">
          <div className="flex min-w-0 flex-1 flex-col">
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-white/32">
              故事总纲
            </p>
            <h2 className="mt-2 line-clamp-1 text-[22px] font-semibold leading-tight tracking-tight text-white/92">
              {data.label}
            </h2>
            <p className="mt-3 line-clamp-3 text-[13px] font-medium leading-6 text-white/54">
              {data.summary}
            </p>
            <div className="mt-auto rounded-[20px] bg-black/18 p-4">
              <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-white/28">
                故事核
              </p>
              <p className="mt-2 line-clamp-2 text-[12px] font-medium leading-5 text-white/54">
                {storyKernel}
              </p>
              <p className="mt-2 line-clamp-1 text-[11px] font-medium leading-4 text-white/38">
                {worldview}
              </p>
            </div>
          </div>

          <div className="flex w-[236px] shrink-0 flex-col gap-2">
            <div className="grid grid-cols-2 gap-2">
              <StoryRootStatTile label="角色" value={stats.roleCount} />
              <StoryRootStatTile label="剧情" value={stats.plotCount} />
              <StoryRootStatTile label="线索" value={stats.clueCount} />
              <StoryRootStatTile label="结局" value={stats.endingCount} />
            </div>
            <div className="min-h-0 flex-1 rounded-[18px] bg-white/[0.045] p-3">
              <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-white/28">
                地点 · {direction}
              </p>
              <div className="mt-2 flex flex-wrap gap-1.5 overflow-hidden">
                {(locations.length > 0 ? locations : ["待生成"]).slice(0, 3).map((location) => (
                  <span
                    key={location}
                    className="max-w-full truncate rounded-full bg-white/[0.07] px-2 py-1 text-[10px] font-medium text-white/44"
                  >
                    {location}
                  </span>
                ))}
              </div>
            </div>
            <button
              type="button"
              data-testid="open-story-root-viewer"
              onClick={(event) => {
                event.stopPropagation();
                data.onViewStoryRoot?.();
              }}
              className="nodrag nopan inline-flex h-10 items-center justify-center gap-2 self-end rounded-full bg-[#E52227] px-5 text-[13px] font-medium text-white shadow-[0_12px_34px_rgba(229,34,39,0.28)] transition hover:bg-[#ff3d42] active:translate-y-0.5"
            >
              查看
              <IconFileText className="size-4" stroke={2} />
            </button>
          </div>
        </div>
      </article>
    </div>
  );
}
