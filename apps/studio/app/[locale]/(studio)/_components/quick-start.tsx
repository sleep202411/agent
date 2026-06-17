"use client";

import { Link } from "@/i18n/navigation";
import { useTranslations } from "next-intl";
import {
  IconArtboard,
  IconPhoto,
  IconVideo,
  IconVolume,
  type IconProps,
} from "@tabler/icons-react";
import type { ComponentType } from "react";
import { cn } from "@/lib/utils";

/**
 * Quick-start tools — a compact launcher row (sits under the hero CTA). Each tile
 * is a real destination; Audio is honestly marked "Soon" (no UI yet, matching the
 * sidebar) rather than dead-linked. Monochrome by design (see DESIGN.md).
 */
interface Tool {
  labelKey: string;
  href: string;
  icon: ComponentType<IconProps>;
  soon?: boolean;
}

const TOOLS: Tool[] = [
  { labelKey: "image", href: "/images", icon: IconPhoto },
  { labelKey: "video", href: "/video", icon: IconVideo },
  { labelKey: "audio", href: "/audio", icon: IconVolume, soon: true },
  { labelKey: "canvas", href: "/canvas", icon: IconArtboard },
];

function ToolItem({ tool, label, soonLabel }: { tool: Tool; label: string; soonLabel: string }) {
  const Icon = tool.icon;
  const tile = (
    <span
      className={cn(
        "relative flex size-12 items-center justify-center rounded-2xl bg-white/[0.05] ring-1 ring-white/[0.06] transition-all",
        !tool.soon &&
          "group-hover:-translate-y-0.5 group-hover:bg-white/[0.1] group-hover:ring-white/15"
      )}
    >
      <Icon
        className={cn(
          "size-5 transition-colors",
          tool.soon ? "text-white/35" : "text-white/80 group-hover:text-white"
        )}
        stroke={1.7}
      />
      {tool.soon && (
        <span className="absolute -top-2 -right-2 rounded-full bg-white/15 px-1.5 py-0.5 text-[9px] font-semibold tracking-wide text-white/80 uppercase">
          {soonLabel}
        </span>
      )}
    </span>
  );

  const labelNode = (
    <span
      className={cn(
        "text-xs font-medium transition-colors",
        tool.soon ? "text-white/40" : "text-white/70 group-hover:text-white"
      )}
    >
      {label}
    </span>
  );

  if (tool.soon) {
    return (
      <div aria-disabled="true" className="flex cursor-not-allowed flex-col items-center gap-2">
        {tile}
        {labelNode}
      </div>
    );
  }

  return (
    <Link href={tool.href} aria-label={label} className="group flex flex-col items-center gap-2">
      {tile}
      {labelNode}
    </Link>
  );
}

export function QuickStart({ className }: { className?: string }) {
  const t = useTranslations("home");
  return (
    <div className={cn("flex flex-wrap gap-4", className)}>
      {TOOLS.map((tool) => (
        <ToolItem
          key={tool.labelKey}
          tool={tool}
          label={t(`quickStart.${tool.labelKey}`)}
          soonLabel={t("quickStart.soon")}
        />
      ))}
    </div>
  );
}
