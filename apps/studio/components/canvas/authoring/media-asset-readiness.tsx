"use client";

import { useMemo } from "react";
import { useTranslations } from "next-intl";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { MediaAssetReadinessCapability, MediaAssetReadinessResult } from "@repo/shared";
import { IconAlertTriangle, IconCheck, IconLoader2, IconShieldQuestion } from "@tabler/icons-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  getMediaAssetReadinessStatuses,
  mediaAssetReadinessKeys,
  requestMediaAssetReadinessCheck,
} from "@/lib/media-asset-readiness";

import { useCanvasDocumentId } from "./canvas-document-context";

export type MediaAssetReadinessState =
  | { kind: "active" }
  | { kind: "pending" }
  | { kind: "failed"; reason?: string | null }
  | { kind: "not_requested" }
  | { kind: "unavailable" };

export function mediaAssetReadinessState(
  status: MediaAssetReadinessResult | undefined,
  fallback?: MediaAssetReadinessState | null
): MediaAssetReadinessState | null {
  if (!status) return fallback ?? null;
  if (status.status === "active") return { kind: "active" };
  if (status.status === "failed") return { kind: "failed", reason: status.statusReason };
  if (status.status === "pending" || status.status === "processing") return { kind: "pending" };
  if (status.status === "not_requested") return { kind: "not_requested" };
  return { kind: "unavailable" };
}

export function MediaAssetReadinessChip({
  capability,
  state,
  className,
  compact = false,
}: {
  capability: MediaAssetReadinessCapability;
  state: MediaAssetReadinessState | null;
  className?: string;
  compact?: boolean;
}) {
  const t = useTranslations("canvasNodes");
  if (!state) return null;
  const copy = capabilityCopy(t, capability);

  const label =
    state.kind === "active"
      ? copy.approved
      : state.kind === "pending"
        ? copy.checking
        : state.kind === "failed"
          ? copy.failed
          : state.kind === "not_requested"
            ? copy.notRequested
            : copy.unavailable;
  const title =
    state.kind === "active"
      ? copy.approvedTitle
      : state.kind === "pending"
        ? copy.checkingTitle
        : state.kind === "failed"
          ? state.reason
            ? `${copy.failedTitle} · ${state.reason}`
            : copy.failedTitle
          : state.kind === "not_requested"
            ? copy.notRequestedTitle
            : copy.unavailableTitle;

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
        state.kind === "not_requested" && "bg-black/55 text-white/60",
        state.kind === "unavailable" && "bg-black/55 text-white/60",
        className
      )}
    >
      {state.kind === "active" && <IconCheck className="size-2.5" stroke={2.5} />}
      {state.kind === "pending" && <IconLoader2 className="size-2.5 animate-spin" stroke={2.2} />}
      {state.kind === "not_requested" && <IconShieldQuestion className="size-2.5" stroke={2.2} />}
      {(state.kind === "failed" || state.kind === "unavailable") && (
        <IconAlertTriangle className="size-2.5" stroke={2.2} />
      )}
      {!compact && label}
    </span>
  );
}

export function MediaAssetReadinessChipForAsset({
  mediaAssetId,
  capability,
  enabled = true,
  className,
  compact = false,
}: {
  mediaAssetId?: string | null;
  capability: MediaAssetReadinessCapability;
  enabled?: boolean;
  className?: string;
  compact?: boolean;
}) {
  const assetIds = useMemo(() => (mediaAssetId ? [mediaAssetId] : []), [mediaAssetId]);
  const query = useMediaAssetReadinessStatusQuery(capability, assetIds, enabled);

  if (!mediaAssetId || query.isPending) return null;
  const status = query.data?.[mediaAssetId];
  const fallback: MediaAssetReadinessState = { kind: "unavailable" };
  return (
    <MediaAssetReadinessChip
      capability={capability}
      state={mediaAssetReadinessState(status, fallback)}
      className={className}
      compact={compact}
    />
  );
}

/**
 * The sole readiness affordance shown on a canvas media node.
 *
 * A completed check is intentionally passive. Only an unchecked or failed
 * asset becomes an action; in-flight work remains a progress state. Keeping
 * those states in one fixed top-right position prevents a second toolbar
 * action from competing with the provider status.
 */
export function MediaAssetReadinessControlForAsset({
  mediaAssetId,
  capability,
  className,
}: {
  mediaAssetId?: string | null;
  capability: MediaAssetReadinessCapability;
  className?: string;
}) {
  const readiness = useMediaAssetReadinessCheck(mediaAssetId, capability);

  if (!readiness.state) return null;
  if (readiness.state.kind !== "not_requested" && readiness.state.kind !== "failed") {
    return (
      <MediaAssetReadinessChip
        capability={capability}
        state={readiness.state}
        className={className}
      />
    );
  }

  const title =
    readiness.state.kind === "failed" && readiness.state.reason
      ? `${readiness.label} · ${readiness.state.reason}`
      : readiness.label;
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      disabled={readiness.disabled}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        readiness.request();
      }}
      className={cn(
        "nodrag nopan absolute top-1 right-1 z-10 inline-flex h-5 items-center gap-1 rounded-full bg-black/65 px-1.5 text-[9px] font-medium text-white/72 backdrop-blur-xl transition-colors hover:bg-black/80 hover:text-white disabled:pointer-events-none disabled:opacity-55",
        readiness.state.kind === "failed" &&
          "bg-destructive/20 text-destructive hover:bg-destructive/30 hover:text-destructive",
        className
      )}
    >
      {readiness.checking ? (
        <IconLoader2 className="size-2.5 animate-spin" stroke={2.2} />
      ) : readiness.state.kind === "failed" ? (
        <IconAlertTriangle className="size-2.5" stroke={2.2} />
      ) : (
        <IconShieldQuestion className="size-2.5" stroke={2.2} />
      )}
      {readiness.label}
    </button>
  );
}

export function useMediaAssetReadinessCheck(
  mediaAssetId: string | null | undefined,
  capability: MediaAssetReadinessCapability
) {
  const t = useTranslations("canvasNodes");
  const copy = capabilityCopy(t, capability);
  const queryClient = useQueryClient();
  const documentId = useCanvasDocumentId();
  const assetIds = useMemo(() => (mediaAssetId ? [mediaAssetId] : []), [mediaAssetId]);
  const statusQuery = useMediaAssetReadinessStatusQuery(
    capability,
    assetIds,
    Boolean(mediaAssetId)
  );
  const status = mediaAssetId ? statusQuery.data?.[mediaAssetId] : undefined;
  const mutation = useMutation({
    mutationFn: async () => {
      if (!mediaAssetId) throw new Error(t("asset.readiness.missingAsset"));
      return requestMediaAssetReadinessCheck(mediaAssetId, capability, documentId);
    },
    onSuccess: (asset) => {
      queryClient.setQueriesData<Record<string, MediaAssetReadinessResult>>(
        { queryKey: [...mediaAssetReadinessKeys.all, capability, documentId] },
        (current) => (current?.[asset.assetId] ? { ...current, [asset.assetId]: asset } : current)
      );
      if (asset.status === "active") {
        toast.success(copy.alreadyPassed);
      } else if (asset.status === "pending" || asset.status === "processing") {
        toast.success(copy.started);
      } else {
        toast.error(asset.statusReason || copy.unavailableTitle);
      }
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : String(error));
    },
  });
  const state =
    !mediaAssetId || statusQuery.isPending
      ? null
      : mediaAssetReadinessState(status, { kind: "unavailable" });
  const checking = mutation.isPending || state?.kind === "pending";
  return {
    state,
    checking,
    disabled: !mediaAssetId || checking,
    label: state?.kind === "failed" ? copy.retryAction : copy.action,
    request: () => mutation.mutate(),
  };
}

function useMediaAssetReadinessStatusQuery(
  capability: MediaAssetReadinessCapability,
  assetIds: string[],
  enabled: boolean
) {
  const documentId = useCanvasDocumentId();
  return useQuery({
    queryKey: mediaAssetReadinessKeys.statuses(capability, assetIds, documentId),
    queryFn: () => getMediaAssetReadinessStatuses(capability, assetIds, documentId),
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
}

function capabilityCopy(
  t: ReturnType<typeof useTranslations<"canvasNodes">>,
  capability: MediaAssetReadinessCapability
) {
  switch (capability) {
    case "seedance-aigc-reference":
      return {
        approved: t("asset.readiness.seedance.approved"),
        approvedTitle: t("asset.readiness.seedance.approvedTitle"),
        checking: t("asset.readiness.seedance.checking"),
        checkingTitle: t("asset.readiness.seedance.checkingTitle"),
        failed: t("asset.readiness.seedance.failed"),
        failedTitle: t("asset.readiness.seedance.failedTitle"),
        notRequested: t("asset.readiness.seedance.notRequested"),
        notRequestedTitle: t("asset.readiness.seedance.notRequestedTitle"),
        unavailable: t("asset.readiness.seedance.unavailable"),
        unavailableTitle: t("asset.readiness.seedance.unavailableTitle"),
        action: t("asset.readiness.seedance.action"),
        retryAction: t("asset.readiness.seedance.retryAction"),
        started: t("asset.readiness.seedance.started"),
        alreadyPassed: t("asset.readiness.seedance.alreadyPassed"),
      };
  }
}
