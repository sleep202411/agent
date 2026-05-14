"use client";

import {
  IconBrush,
  IconCertificate,
  IconMovie,
  IconPackage,
  IconSparkles,
} from "@tabler/icons-react";
import { useTranslations } from "@/src/i18n/i18n";
import { cn } from "@/lib/utils";
import type { MerchandiseKind } from "@/app/(site)/ips/_hooks/use-merchandise";

/**
 * Kind-specific chip. Each SKU type gets its own palette + icon so
 * the list at a glance reads "digital pack / acrylic standee / fan
 * commission" without the owner having to parse text. Shared by
 * sku-card (chip overlay), sku-dialog (kind picker labels), and the
 * paywall preview if we surface kinds there later.
 */

interface KindBadgeProps {
  kind: MerchandiseKind;
  size?: "sm" | "xs";
  className?: string;
}

interface KindMeta {
  labelKey: string;
  tone: string;
  icon: React.ComponentType<{ className?: string }>;
}

const KIND_META: Record<MerchandiseKind, KindMeta> = {
  digital: {
    labelKey: "merchKindDigital",
    tone: "bg-sky-500/90 text-white ring-sky-200/30",
    icon: IconSparkles,
  },
  physical: {
    labelKey: "merchKindPhysical",
    tone: "bg-amber-500/90 text-white ring-amber-200/30",
    icon: IconPackage,
  },
  custom_content: {
    labelKey: "merchKindCustomContent",
    tone: "bg-violet-500/90 text-white ring-violet-200/30",
    icon: IconMovie,
  },
  creative_license: {
    labelKey: "merchKindCreativeLicense",
    tone: "bg-emerald-500/90 text-white ring-emerald-200/30",
    icon: IconBrush,
  },
  media_license: {
    labelKey: "merchKindMediaLicense",
    tone: "bg-rose-500/90 text-white ring-rose-200/30",
    icon: IconCertificate,
  },
};

export function KindBadge({ kind, size = "sm", className }: KindBadgeProps) {
  const t = useTranslations("ipEdit");
  const meta = KIND_META[kind];
  const Icon = meta.icon;
  const sizeCls =
    size === "xs" ? "px-1.5 py-0.5 text-[10px] gap-0.5" : "px-2.5 py-1 text-[11px] gap-1";
  const iconCls = size === "xs" ? "size-2.5" : "size-3";

  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full font-semibold shadow-sm ring-1 ring-inset backdrop-blur-md",
        sizeCls,
        meta.tone,
        className
      )}
    >
      <Icon className={iconCls} />
      {t(meta.labelKey)}
    </span>
  );
}
