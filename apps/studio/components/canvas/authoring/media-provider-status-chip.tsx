"use client";

import { useMemo } from "react";
import { useTranslations } from "next-intl";
import { useQuery } from "@tanstack/react-query";
import { IconAlertTriangle, IconCheck, IconLoader2 } from "@tabler/icons-react";
import { cn } from "@/lib/utils";
import {
  getMediaProviderAssetStatuses,
  mediaProviderAssetKeys,
  type MediaProviderAssetStatus,
} from "@/lib/media-provider-assets";

export type MediaProviderStatusState =
  | { kind: "active" }
  | { kind: "pending" }
  | { kind: "failed"; reason?: string | null }
  | { kind: "unavailable" };

export function mediaProviderStatusState(
  status: MediaProviderAssetStatus | undefined,
  fallback?: MediaProviderStatusState | null
): MediaProviderStatusState | null {
  if (!status) return fallback ?? null;
  if (status.status === "active") return { kind: "active" };
  if (status.status === "failed") return { kind: "failed", reason: status.statusReason };
  if (status.status === "pending" || status.status === "processing") return { kind: "pending" };
  return { kind: "unavailable" };
}

export function MediaProviderStatusChip({
  state,
  className,
  compact = false,
}: {
  state: MediaProviderStatusState | null;
  className?: string;
  compact?: boolean;
}) {
  const t = useTranslations("canvasNodes");
  if (!state) return null;

  const label =
    state.kind === "active"
      ? t("asset.providerStatusApproved")
      : state.kind === "pending"
        ? t("asset.providerStatusChecking")
        : state.kind === "failed"
          ? t("asset.providerStatusFailed")
          : t("asset.providerStatusUnavailable");
  const title =
    state.kind === "active"
      ? t("asset.providerStatusApprovedTitle")
      : state.kind === "pending"
        ? t("asset.providerStatusCheckingTitle")
        : state.kind === "failed"
          ? state.reason
            ? `${t("asset.providerStatusFailedTitle")} · ${state.reason}`
            : t("asset.providerStatusFailedTitle")
          : t("asset.providerStatusUnavailableTitle");

  return (
    <span
      title={title}
      aria-label={title}
      className={cn(
        "pointer-events-none absolute top-1 right-1 z-10 inline-flex h-5 items-center gap-1 rounded-full px-1.5 text-[9px] font-medium backdrop-blur-xl",
        compact && "w-5 justify-center gap-0 px-0",
        state.kind === "active" && "bg-emerald-500/20 text-emerald-100",
        state.kind === "pending" && "bg-black/55 text-white/85",
        state.kind === "failed" && "bg-destructive/20 text-destructive",
        state.kind === "unavailable" && "bg-black/55 text-white/60",
        className
      )}
    >
      {state.kind === "active" && <IconCheck className="size-2.5" stroke={2.5} />}
      {state.kind === "pending" && <IconLoader2 className="size-2.5 animate-spin" stroke={2.2} />}
      {(state.kind === "failed" || state.kind === "unavailable") && (
        <IconAlertTriangle className="size-2.5" stroke={2.2} />
      )}
      {!compact && label}
    </span>
  );
}

export function MediaProviderStatusChipForAsset({
  mediaAssetId,
  enabled = true,
  className,
  compact = false,
}: {
  mediaAssetId?: string | null;
  enabled?: boolean;
  className?: string;
  compact?: boolean;
}) {
  const assetIds = useMemo(() => (mediaAssetId ? [mediaAssetId] : []), [mediaAssetId]);
  const query = useQuery({
    queryKey: mediaProviderAssetKeys.statuses(assetIds),
    queryFn: () => getMediaProviderAssetStatuses(assetIds),
    enabled: enabled && assetIds.length > 0,
    refetchInterval: (query) => {
      const data = query.state.data;
      if (!data) return false;
      return Object.values(data).some(
        (status) => status.status === "pending" || status.status === "processing"
      )
        ? 8_000
        : false;
    },
  });

  if (!mediaAssetId) return null;
  const status = query.data?.[mediaAssetId];
  const fallback: MediaProviderStatusState = query.isError
    ? { kind: "unavailable" }
    : { kind: "pending" };
  return (
    <MediaProviderStatusChip
      state={mediaProviderStatusState(status, fallback)}
      className={className}
      compact={compact}
    />
  );
}
