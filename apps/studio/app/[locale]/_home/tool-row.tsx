"use client";

/**
 * The home tool shortcuts under the composer. We only wire what we actually
 * back (Image, Video → their studios); everything else is an honest, clearly
 * labelled "Soon" tile — disabled, never a dead link (DESIGN.md: don't fake UI
 * for absent backends). Monochrome icons per our zero-chroma design language.
 */

import {
  IconArrowsDiagonal,
  IconPhoto,
  IconVideo,
  IconVolume,
  IconWand,
  type Icon as TablerIcon,
} from "@tabler/icons-react";
import { Link } from "@/i18n/navigation";

type Tool = {
  id: string;
  label: string;
  Icon: TablerIcon;
  href?: string;
  soon?: boolean;
};

const TOOLS: Tool[] = [
  { id: "image", label: "Image", Icon: IconPhoto, href: "/images" },
  { id: "video", label: "Video", Icon: IconVideo, href: "/video" },
  { id: "audio", label: "Audio", Icon: IconVolume, soon: true },
  { id: "edit", label: "Edit", Icon: IconWand, soon: true },
  { id: "upscale", label: "Upscale", Icon: IconArrowsDiagonal, soon: true },
];

export function ToolRow() {
  return (
    <div className="mt-7 flex flex-wrap items-start justify-center gap-1">
      {TOOLS.map((tool) =>
        tool.soon ? <SoonTile key={tool.id} tool={tool} /> : <LinkTile key={tool.id} tool={tool} />
      )}
    </div>
  );
}

function LinkTile({ tool }: { tool: Tool }) {
  const { Icon, label, href } = tool;
  return (
    <Link
      href={href!}
      className="group flex w-[88px] flex-col items-center gap-2 rounded-2xl px-2 py-2 transition-colors"
    >
      <span className="grid size-12 place-items-center rounded-2xl bg-white/[0.06] text-white/80 transition-colors group-hover:bg-white/[0.1] group-hover:text-white">
        <Icon className="size-[22px]" stroke={1.6} />
      </span>
      <span className="text-[13px] text-white/65 transition-colors group-hover:text-white/90">
        {label}
      </span>
    </Link>
  );
}

function SoonTile({ tool }: { tool: Tool }) {
  const { Icon, label } = tool;
  return (
    <div
      title="Coming soon"
      aria-disabled="true"
      className="relative flex w-[88px] cursor-not-allowed flex-col items-center gap-2 px-2 py-2"
    >
      <span className="absolute top-1 right-2.5 z-10 rounded-full bg-white/[0.1] px-1.5 py-px text-[9px] font-semibold tracking-wide text-white/55 uppercase">
        Soon
      </span>
      <span className="grid size-12 place-items-center rounded-2xl bg-white/[0.035] text-white/40">
        <Icon className="size-[22px]" stroke={1.6} />
      </span>
      <span className="text-[13px] text-white/40">{label}</span>
    </div>
  );
}
