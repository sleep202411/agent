"use client";

import type { CSSProperties } from "react";
import Image from "next/image";
import { IconEdit, IconPackage, IconPlayerPlay, type Icon } from "@tabler/icons-react";
import { cn } from "@/lib/utils";
import type { CharacterPortraitKey, NarrativeNodeData } from "../types";
import { CHARACTER_PORTRAITS } from "./kind-meta";

export function NodeEditButton({
  onClick,
  className,
  label = "编辑",
}: {
  onClick?: () => void;
  className?: string;
  label?: string;
}) {
  if (!onClick) {
    return null;
  }

  return (
    <button
      type="button"
      onClick={(event) => {
        event.stopPropagation();
        onClick();
      }}
      className={cn(
        "nodrag nopan inline-flex h-9 items-center gap-1.5 rounded-full bg-white/[0.075] px-3 text-xs font-semibold text-white/62 transition hover:bg-white/12 hover:text-white active:translate-y-0.5",
        className
      )}
    >
      <IconEdit className="size-3.5" stroke={2} />
      {label}
    </button>
  );
}

export function NodeTypeChip({
  label,
  icon: ChipIcon,
  color,
  iconBg,
}: {
  label: string;
  icon: Icon;
  color: string;
  iconBg: string;
}) {
  return (
    <div
      className="absolute top-0 left-0 z-10 inline-flex h-8 items-center gap-2 rounded-full px-3 text-[13px] font-semibold text-white shadow-[0_10px_30px_rgba(0,0,0,0.3)] backdrop-blur-xl"
      style={{ backgroundColor: color }}
    >
      <span
        className="grid size-6 place-items-center rounded-full"
        style={{ backgroundColor: iconBg }}
      >
        <ChipIcon className="size-3.5" stroke={2} />
      </span>
      {label}
    </div>
  );
}

export function StatusPill({ status }: { status: NonNullable<NarrativeNodeData["status"]> }) {
  const label = status === "working" ? "生成中" : status === "review" ? "待审阅" : "已就绪";
  return (
    <span
      className={cn(
        "rounded-full px-2 py-1 text-[10px] font-semibold tracking-[0.08em]",
        status === "working" && "bg-white/10 text-white/64",
        status === "review" && "bg-[#e0c27a]/16 text-[#e0c27a]",
        status === "ready" && "bg-white/12 text-white/78"
      )}
    >
      {label}
    </span>
  );
}

export function CharacterPortrait({
  portrait = "neutral",
  compact = false,
  className,
  sizes,
  style,
}: {
  portrait?: CharacterPortraitKey;
  compact?: boolean;
  className?: string;
  sizes?: string;
  style?: CSSProperties;
}) {
  // Persisted drafts are untyped at runtime — an unknown key (e.g. a portrait
  // that no longer exists) must degrade to the neutral placeholder, not crash.
  const asset = CHARACTER_PORTRAITS[portrait] ?? CHARACTER_PORTRAITS.neutral;

  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-[24px] bg-[linear-gradient(180deg,oklch(0.28_0_0),oklch(0.12_0_0))] shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]",
        compact ? "aspect-[9/16] w-full" : "aspect-[9/16] w-full",
        className
      )}
      style={style}
    >
      <Image
        src={asset.src}
        alt={asset.alt}
        fill
        unoptimized
        loading="eager"
        sizes={sizes ?? (compact ? "96px" : "340px")}
        className="object-cover"
        draggable={false}
      />
      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(180deg,rgba(255,255,255,0.04),transparent_32%,rgba(0,0,0,0.24))]" />
    </div>
  );
}

export function NodeVisual({ type }: { type: NonNullable<NarrativeNodeData["image"]> }) {
  if (type === "avatar") {
    return (
      <div className="grid h-44 place-items-center rounded-[20px] bg-[oklch(0.235_0_0)]">
        <div className="relative size-28 rounded-full bg-white/10">
          <div className="absolute left-1/2 top-7 size-14 -translate-x-1/2 rounded-full bg-white/28" />
          <div className="absolute bottom-4 left-1/2 h-12 w-20 -translate-x-1/2 rounded-[999px_999px_40px_40px] bg-white/18" />
          <div className="absolute left-7 top-12 size-2 rounded-full bg-black/70" />
          <div className="absolute right-7 top-12 size-2 rounded-full bg-black/70" />
        </div>
      </div>
    );
  }

  if (type === "item") {
    return (
      <div className="relative h-36 overflow-hidden rounded-[20px] bg-[linear-gradient(180deg,oklch(0.255_0_0),oklch(0.145_0_0))] p-4">
        <div className="absolute left-7 top-7 h-20 w-14 rotate-[-6deg] rounded-[10px] bg-white/14 shadow-[0_16px_34px_rgba(0,0,0,0.28)]" />
        <div className="absolute left-12 top-11 h-16 w-20 rotate-[5deg] rounded-[12px] bg-white/10 shadow-[0_16px_34px_rgba(0,0,0,0.28)]" />
        <div className="absolute bottom-5 left-6 right-6 h-px bg-white/20" />
        <div className="absolute bottom-4 left-4 inline-flex items-center gap-2 rounded-full bg-black/24 px-3 py-1 text-[10px] font-semibold text-white/52">
          <IconPackage className="size-3.5" />
          Item
        </div>
      </div>
    );
  }

  if (type === "video") {
    return (
      <div className="relative h-44 overflow-hidden rounded-[20px] bg-[oklch(0.235_0_0)] p-3">
        <div className="grid h-full grid-cols-[1fr_72px] gap-3">
          <div className="relative overflow-hidden rounded-[16px] bg-[linear-gradient(180deg,oklch(0.31_0_0),oklch(0.13_0_0))]">
            <div className="absolute left-4 top-5 h-20 w-12 rounded-t-xl bg-white/12" />
            <div className="absolute bottom-4 left-4 right-4 h-px bg-white/22" />
            <span className="absolute left-1/2 top-1/2 grid size-11 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-white text-black">
              <IconPlayerPlay className="size-5" />
            </span>
          </div>
          <div className="grid gap-2">
            {[1, 2, 3].map((shot) => (
              <div key={shot} className="rounded-[12px] bg-white/[0.075]" />
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="grid h-36 place-items-center rounded-[20px] bg-[oklch(0.235_0_0)]">
      <div className="grid size-20 place-items-center rounded-3xl bg-white/10 text-[26px]">◇</div>
    </div>
  );
}
