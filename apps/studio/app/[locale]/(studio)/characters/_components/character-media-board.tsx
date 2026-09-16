"use client";

import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { useAuth } from "@/app/_components/auth-provider";
import { useTranslations } from "next-intl";
import {
  IconAlertTriangle,
  IconCheck,
  IconChevronLeft,
  IconChevronRight,
  IconLoader2,
  IconMusic,
  IconPhotoStar,
  IconPlus,
  IconTrash,
  IconX,
} from "@tabler/icons-react";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { ApiRequestError } from "@/lib/api";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { SectionHeading } from "@/components/ui/section-heading";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { isUploadAbort, uploadFileViaSignedUrl } from "@/lib/media-upload";
import {
  attachCharacterMedia,
  characterApiErrorCode,
  CHARACTER_MEDIA_CAPS,
  characterMediaContentUrl,
  removeCharacterMedia,
  reorderCharacterMedia,
  updateCharacter,
  type CharacterDetail,
  type CharacterMediaItem,
  type CharacterMediaKind,
  type CharacterMediaMirror,
} from "@/lib/characters-api";
import { charactersKeys } from "../_lib/use-characters";

/** Server upload kinds for character reference media (same SAS pipeline the
 *  generation composers use — see use-reference-uploads.ts). */
const UPLOAD_KIND: Record<CharacterMediaKind, string> = {
  image: "ai_reference_image",
  video: "ai_reference_video",
  audio: "ai_reference_audio",
};

/** Mirrors the server's UPLOAD_KIND_POLICY content types for each kind. */
const ACCEPT: Record<CharacterMediaKind, string> = {
  image: "image/jpeg,image/png,image/webp",
  video: "video/mp4,video/quicktime",
  audio: "audio/mpeg,audio/wav,audio/x-wav",
};

const KINDS: CharacterMediaKind[] = ["image", "video", "audio"];

/** Per-kind toast key for files skipped because the kind's cap is reached. */
const OVERFLOW_KEY: Record<CharacterMediaKind, string> = {
  image: "overflowImages",
  video: "overflowVideos",
  audio: "overflowAudio",
};

interface PendingUpload {
  id: string;
  kind: CharacterMediaKind;
  file: File;
  /** Local object URL for the thumbnail (revoked on remove/unmount). */
  previewUrl: string;
  progress: number;
  phase: "uploading" | "attaching" | "failed";
  /** Set once the storage upload confirmed — a failed attach retries without
   *  re-uploading the bytes. */
  mediaAssetId?: string;
  error?: string;
}

function MediaPreview({ item }: { item: CharacterMediaItem }) {
  const url = characterMediaContentUrl(item.mediaAssetId);
  if (item.mediaKind === "audio") {
    return (
      <span className="flex size-full items-center justify-center bg-white/[0.02]">
        <IconMusic className="size-8 text-white/35" stroke={1.5} />
      </span>
    );
  }
  if (item.mediaKind === "video") {
    return (
      <video src={url} muted playsInline preload="metadata" className="size-full object-cover" />
    );
  }
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={url} alt="" className="size-full object-cover" />;
}

function UploadPreview({ upload }: { upload: PendingUpload }) {
  if (upload.kind === "audio") {
    return (
      <span className="flex size-full items-center justify-center bg-white/[0.02]">
        <IconMusic className="size-8 text-white/35" stroke={1.5} />
      </span>
    );
  }
  if (upload.kind === "video") {
    return <video src={upload.previewUrl} muted playsInline className="size-full object-cover" />;
  }
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={upload.previewUrl} alt={upload.file.name} className="size-full object-cover" />;
}

/**
 * Provider-mirror state overlay for one tile — rendered for ANY media item
 * that carries a `mirror` (real_person liveness faces AND virtual images that
 * get an AIGC digital-human certification so Seedance's real-person risk
 * control accepts a photorealistic AI face). Absence of `mirror` = no mirror
 * plane, render nothing. The `labels` are supplied context-aware by kind.
 * Leave-and-notify: states refresh live via `character_media_updated` events;
 * no polling, no blocking spinner. Failed rows show the typed upstream verdict;
 * there is no client-side retry route yet, so no dead retry affordance is drawn.
 */
function MirrorState({
  mirror,
  labels,
}: {
  mirror: CharacterMediaMirror;
  labels: {
    pending: string;
    processing: string;
    active: string;
    disabled: string;
    deleted: string;
    failed: string;
    reason: (statusReason: string | null | undefined) => string;
  };
}) {
  if (mirror.status === "failed") {
    return (
      <div className="pointer-events-none absolute inset-x-0 top-0 bg-gradient-to-b from-black/80 to-transparent p-1.5 pb-6">
        <span className="flex items-start gap-1 text-[10px] leading-snug font-medium text-destructive">
          <IconAlertTriangle className="mt-px size-3 shrink-0" stroke={2} />
          <span className="line-clamp-3">{labels.reason(mirror.statusReason)}</span>
        </span>
      </div>
    );
  }
  if (mirror.status === "active") {
    return (
      <span
        title={labels.active}
        aria-label={labels.active}
        className="pointer-events-none absolute top-1.5 right-1.5 grid size-5 place-items-center rounded-full bg-black/55 text-white/70 backdrop-blur-xl"
      >
        <IconCheck className="size-3" stroke={2.5} />
      </span>
    );
  }
  const spinning = mirror.status === "pending" || mirror.status === "processing";
  const label =
    mirror.status === "pending"
      ? labels.pending
      : mirror.status === "processing"
        ? labels.processing
        : mirror.status === "disabled"
          ? labels.disabled
          : labels.deleted;
  return (
    <span
      className={cn(
        "pointer-events-none absolute top-1.5 right-1.5 inline-flex items-center gap-1 rounded-full bg-black/55 px-1.5 py-0.5 text-[9px] font-medium backdrop-blur-xl",
        spinning ? "text-white/85" : "text-white/55"
      )}
    >
      {spinning && <IconLoader2 className="size-2.5 animate-spin" stroke={2.2} />}
      {label}
    </span>
  );
}

/** Small round icon button used in tile hover overlays. */
function TileAction({
  label,
  onClick,
  disabled,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={disabled}
      className="flex size-6 items-center justify-center rounded-full bg-black/55 text-white/80 backdrop-blur-xl transition hover:text-white disabled:opacity-35"
    >
      {children}
    </button>
  );
}

/**
 * Per-kind reference-media board for one character: ordered tiles with
 * reorder / set-as-cover / remove, live upload tiles (progress, typed
 * failures with retry), and cap-aware add slots (9 images / 3 videos /
 * 3 audio — the Seedance reference limits enforced server-side).
 */
export function CharacterMediaBoard({
  character,
  onDetail,
}: {
  character: CharacterDetail;
  onDetail: (detail: CharacterDetail) => void;
}) {
  const { user } = useAuth();
  const viewerId = user?.id == null ? "" : String(user.id);
  if (!viewerId) return null;
  return (
    <MediaBoardContent
      key={JSON.stringify([viewerId, character.id, character.workspaceId])}
      character={character}
      onDetail={onDetail}
      viewerId={viewerId}
    />
  );
}
function MediaBoardContent({
  character,
  onDetail,
  viewerId,
}: {
  character: CharacterDetail;
  onDetail: (detail: CharacterDetail) => void;
  viewerId: string;
}) {
  const t = useTranslations("characters");
  const tc = useTranslations("common");
  const queryClient = useQueryClient();

  const [uploads, setUploads] = useState<PendingUpload[]>([]);
  const [removing, setRemoving] = useState<CharacterMediaItem | null>(null);
  /** Serializes order/cover/remove mutations so optimistic order rewrites
   *  never race each other. */
  const [boardBusy, setBoardBusy] = useState(false);
  const mounted = useRef(false);
  const boardClaim = useRef<AbortController | null>(null);
  useLayoutEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      boardClaim.current?.abort();
      boardClaim.current = null;
    };
  }, []);
  const beginBoard = () => {
    if (!mounted.current || boardClaim.current || aborts.current.size > 0) return null;
    const claim = new AbortController();
    boardClaim.current = claim;
    setBoardBusy(true);
    return claim;
  };
  const currentBoard = (claim: AbortController) => mounted.current && boardClaim.current === claim;
  const finishBoard = (claim: AbortController) => {
    if (currentBoard(claim)) {
      boardClaim.current = null;
      setBoardBusy(false);
    }
  };
  const aborts = useRef(new Map<string, AbortController>());
  const uploadsRef = useRef(uploads);
  const inputRefs = useRef(new Map<CharacterMediaKind, HTMLInputElement>());

  useLayoutEffect(
    () => () => {
      uploadsRef.current.forEach((upload) => URL.revokeObjectURL(upload.previewUrl));
      uploadsRef.current = [];
      aborts.current.forEach((controller) => controller.abort());
      aborts.current.clear();
    },
    []
  );

  /** Reconcile to server truth (refetch the detail) — used whenever a
   *  mutation's outcome is ambiguous (failed reorder, failed/duplicate attach). */
  const invalidateDetail = useCallback(
    () =>
      void queryClient.invalidateQueries({
        queryKey: charactersKeys.viewerDetail(character.id, viewerId),
      }),
    [queryClient, character.id, viewerId]
  );

  const updateUpload = useCallback((id: string, patch: Partial<PendingUpload>) => {
    if (!mounted.current) return;
    uploadsRef.current = uploadsRef.current.map((upload) =>
      upload.id === id ? { ...upload, ...patch } : upload
    );
    setUploads(uploadsRef.current);
  }, []);

  const dropUpload = useCallback((id: string) => {
    aborts.current.get(id)?.abort();
    aborts.current.delete(id);
    const dropped = uploadsRef.current.find((upload) => upload.id === id);
    if (dropped) URL.revokeObjectURL(dropped.previewUrl);
    uploadsRef.current = uploadsRef.current.filter((upload) => upload.id !== id);
    if (mounted.current) setUploads(uploadsRef.current);
  }, []);

  const runUpload = useCallback(
    async (id: string, kind: CharacterMediaKind, file: File, existingAssetId?: string) => {
      if (!mounted.current || boardClaim.current || aborts.current.has(id)) return;
      const controller = new AbortController();
      aborts.current.set(id, controller);
      const owned = () => mounted.current && aborts.current.get(id) === controller;
      const current = () => owned() && !controller.signal.aborted;
      let attaching = false;
      try {
        let assetId = existingAssetId;
        if (!assetId) {
          const result = await uploadFileViaSignedUrl(file, {
            kind: UPLOAD_KIND[kind],
            workspaceId: character.workspaceId,
            signal: controller.signal,
            onProgress: (percent) => {
              if (current()) updateUpload(id, { progress: percent });
            },
          });
          if (!current()) return;
          assetId = result.mediaAssetId;
          updateUpload(id, { phase: "attaching", progress: 100, mediaAssetId: assetId });
        }
        if (!current()) return;
        attaching = true;
        const detail = await attachCharacterMedia(character.id, assetId, controller.signal);
        if (!current()) return;
        onDetail(detail);
        dropUpload(id);
      } catch (error) {
        if (!owned()) return;
        if (controller.signal.aborted || isUploadAbort(error)) {
          dropUpload(id);
          return;
        }
        if (
          error instanceof ApiRequestError &&
          error.status === 409 &&
          characterApiErrorCode(error) === "CHARACTER_MEDIA_DUPLICATE"
        ) {
          // Already attached (a retry raced an attach that actually landed) —
          // that IS success: reconcile to server truth and clear the tile.
          // Other 409s (CHARACTER_MEDIA_LIMIT, ENROLLMENT_REQUIRED) are real
          // refusals and fall through to the failure path below.
          invalidateDetail();
          dropUpload(id);
          return;
        }
        // A failed attach may still have landed server-side — reconcile.
        if (attaching) invalidateDetail();
        updateUpload(id, {
          phase: "failed",
          error: error instanceof Error ? error.message : t("uploadFailed"),
        });
      } finally {
        if (aborts.current.get(id) === controller) aborts.current.delete(id);
      }
    },
    [character.id, character.workspaceId, onDetail, updateUpload, dropUpload, invalidateDetail, t]
  );

  const media = [...character.media].sort((a, b) => a.sortOrder - b.sortOrder);
  const byKind = (kind: CharacterMediaKind) => media.filter((item) => item.mediaKind === kind);
  const pendingCount = (kind: CharacterMediaKind) =>
    uploadsRef.current.filter((upload) => upload.kind === kind && upload.phase !== "failed").length;
  /** An attach landing mid-reorder would race the optimistic order rewrite, so
   *  moves also wait for in-flight uploads (failed tiles don't block). */
  const uploadsInFlight = uploads.some((upload) => upload.phase !== "failed");

  const addFiles = (kind: CharacterMediaKind, files: File[]) => {
    if (!mounted.current || boardClaim.current) return;
    const room = Math.max(0, CHARACTER_MEDIA_CAPS[kind] - byKind(kind).length - pendingCount(kind));
    const accepted = files.slice(0, room);
    const skipped = files.length - accepted.length;
    if (skipped > 0) {
      toast.info(t(OVERFLOW_KEY[kind], { skipped, max: CHARACTER_MEDIA_CAPS[kind] }));
    }
    for (const file of accepted) {
      const id = crypto.randomUUID();
      uploadsRef.current = [
        ...uploadsRef.current,
        {
          id,
          kind,
          file,
          previewUrl: URL.createObjectURL(file),
          progress: 0,
          phase: "uploading",
        },
      ];
      setUploads(uploadsRef.current);
      void runUpload(id, kind, file);
    }
  };

  const retryUpload = (upload: PendingUpload) => {
    if (
      !mounted.current ||
      boardClaim.current ||
      aborts.current.has(upload.id) ||
      !uploadsRef.current.some((item) => item.id === upload.id && item.phase === "failed")
    )
      return;
    updateUpload(upload.id, {
      phase: upload.mediaAssetId ? "attaching" : "uploading",
      progress: upload.mediaAssetId ? 100 : 0,
      error: undefined,
    });
    void runUpload(upload.id, upload.kind, upload.file, upload.mediaAssetId);
  };

  /** Swap the item with its same-kind neighbor and persist the full order
   *  (the server rewrites sortOrder from the complete id list). */
  const move = async (item: CharacterMediaItem, direction: -1 | 1) => {
    if (boardBusy || uploadsInFlight) return;
    const index = media.findIndex((entry) => entry.id === item.id);
    if (index === -1) return;
    let neighbor = index + direction;
    while (
      neighbor >= 0 &&
      neighbor < media.length &&
      media[neighbor].mediaKind !== item.mediaKind
    ) {
      neighbor += direction;
    }
    if (neighbor < 0 || neighbor >= media.length) return;
    const next = [...media];
    [next[index], next[neighbor]] = [next[neighbor], next[index]];
    const claim = beginBoard();
    if (!claim) return;
    // Optimistic: the tiles snap immediately; the server response reconciles.
    onDetail({ ...character, media: next.map((entry, i) => ({ ...entry, sortOrder: i })) });
    try {
      const detail = await reorderCharacterMedia(
        character.id,
        next.map((entry) => entry.id),
        claim.signal
      );
      if (currentBoard(claim)) onDetail(detail);
    } catch (error) {
      if (!currentBoard(claim)) return;
      // Don't write the captured pre-move snapshot back (it may itself be
      // stale) — reconcile to server truth instead.
      invalidateDetail();
      toast.error(error instanceof Error ? error.message : tc("error"));
    } finally {
      finishBoard(claim);
    }
  };

  const setCover = async (item: CharacterMediaItem) => {
    if (boardBusy) return;
    const claim = beginBoard();
    if (!claim) return;
    try {
      const detail = await updateCharacter(
        character.id,
        { coverAssetId: item.mediaAssetId },
        claim.signal
      );
      if (currentBoard(claim)) onDetail(detail);
    } catch (error) {
      if (!currentBoard(claim)) return;
      toast.error(error instanceof Error ? error.message : tc("error"));
    } finally {
      finishBoard(claim);
    }
  };

  const confirmRemove = async () => {
    if (!removing || boardBusy) return;
    const claim = beginBoard();
    if (!claim) return;
    try {
      const detail = await removeCharacterMedia(character.id, removing.id, claim.signal);
      if (!currentBoard(claim)) return;
      onDetail(detail);
      setRemoving(null);
    } catch (error) {
      if (!currentBoard(claim)) return;
      toast.error(error instanceof Error ? error.message : tc("error"));
    } finally {
      finishBoard(claim);
    }
  };

  const sectionTitle: Record<CharacterMediaKind, string> = {
    image: t("sectionImages"),
    video: t("sectionVideos"),
    audio: t("sectionAudio"),
  };
  const addLabel: Record<CharacterMediaKind, string> = {
    image: t("addImage"),
    video: t("addVideo"),
    audio: t("addAudio"),
  };

  // Same mirror plane, two meanings by kind: real_person = liveness-face
  // registration ("Verified"); virtual = AIGC digital-human certification
  // ("Certified — safe to generate video"). Copy is context-aware.
  const isRealPerson = character.kind === "real_person";
  const mirrorLabels = {
    pending: isRealPerson ? t("mirrorPending") : t("mirrorCertifying"),
    processing: isRealPerson ? t("mirrorProcessing") : t("mirrorCertifying"),
    active: isRealPerson ? t("mirrorActive") : t("mirrorCertified"),
    disabled: t("mirrorDisabled"),
    deleted: t("mirrorDeleted"),
    failed: isRealPerson ? t("mirrorFailed") : t("mirrorCertifyFailed"),
    /** Typed upstream verdicts get honest copy; unknown codes pass verbatim.
     *  face_mismatch/multi_face are real_person-only; virtual failures are
     *  moderation (reads as a real person) or stale (timed out). */
    reason: (statusReason: string | null | undefined): string => {
      if (isRealPerson) {
        switch (statusReason) {
          case "face_mismatch":
            return t("mirrorReasonFaceMismatch");
          case "multi_face":
            return t("mirrorReasonMultiFace");
          case "moderation":
            return t("mirrorReasonModeration");
          case "stale":
            return t("mirrorReasonStale");
          default:
            return statusReason || t("mirrorFailed");
        }
      }
      switch (statusReason) {
        case "moderation":
          return t("mirrorReasonAigcModeration");
        case "stale":
          return t("mirrorReasonStale");
        default:
          return statusReason || t("mirrorCertifyFailed");
      }
    },
  };

  return (
    <section className="mt-10">
      <SectionHeading title={t("mediaHeading")} subtitle={t("mediaSubheading")} />

      <div className="mt-6 space-y-8">
        {KINDS.map((kind) => {
          const items = byKind(kind);
          const kindUploads = uploads.filter((upload) => upload.kind === kind);
          const cap = CHARACTER_MEDIA_CAPS[kind];
          const occupied =
            items.length +
            uploads.filter((upload) => upload.kind === kind && upload.phase !== "failed").length;
          const full = occupied >= cap;

          return (
            <div key={kind}>
              <div className="flex items-baseline justify-between">
                <h3 className="text-sm font-medium">{sectionTitle[kind]}</h3>
                <span
                  className={cn(
                    "text-xs tabular-nums",
                    full ? "text-white/60" : "text-muted-foreground"
                  )}
                >
                  {occupied}/{cap}
                </span>
              </div>

              {/* Hidden picker for this kind's accept list. */}
              <input
                ref={(el) => {
                  if (el) inputRefs.current.set(kind, el);
                  else inputRefs.current.delete(kind);
                }}
                type="file"
                accept={ACCEPT[kind]}
                multiple={cap - occupied > 1}
                className="sr-only"
                onChange={(event) => {
                  const files = Array.from(event.target.files ?? []);
                  event.target.value = "";
                  if (files.length) addFiles(kind, files);
                }}
              />

              <div className="mt-3 grid grid-cols-[repeat(auto-fill,minmax(132px,1fr))] gap-3">
                {items.map((item, position) => {
                  const isCover = item.mediaAssetId === character.coverAssetId;
                  return (
                    <div
                      key={item.id}
                      className="group/tile relative aspect-square overflow-hidden rounded-2xl bg-white/[0.03]"
                    >
                      <MediaPreview item={item} />

                      <span className="pointer-events-none absolute bottom-1.5 left-1.5 rounded bg-black/60 px-1.5 py-0.5 text-[9px] font-medium text-white/90 tabular-nums">
                        {position + 1}
                      </span>
                      {/* A failed mirror owns the tile's top edge — the cover
                          badge yields to the verdict there. */}
                      {isCover && item.mirror?.status !== "failed" && (
                        <span className="pointer-events-none absolute top-1.5 left-1.5 rounded-full bg-black/60 px-2 py-0.5 text-[9px] font-semibold tracking-wide text-white/90 uppercase backdrop-blur-xl">
                          {t("coverBadge")}
                        </span>
                      )}
                      {item.mirror && <MirrorState mirror={item.mirror} labels={mirrorLabels} />}

                      {/* Hover actions — legibility scrim over the media. */}
                      <div className="absolute inset-x-0 bottom-0 flex items-center justify-end gap-1 bg-gradient-to-t from-black/70 to-transparent p-1.5 pt-6 opacity-0 transition-opacity group-hover/tile:opacity-100">
                        <TileAction
                          label={t("moveEarlier")}
                          onClick={() => void move(item, -1)}
                          disabled={boardBusy || uploadsInFlight || position === 0}
                        >
                          <IconChevronLeft className="size-3.5" stroke={2} />
                        </TileAction>
                        <TileAction
                          label={t("moveLater")}
                          onClick={() => void move(item, 1)}
                          disabled={boardBusy || uploadsInFlight || position === items.length - 1}
                        >
                          <IconChevronRight className="size-3.5" stroke={2} />
                        </TileAction>
                        {kind === "image" && !isCover && (
                          <TileAction
                            label={t("setAsCover")}
                            onClick={() => void setCover(item)}
                            disabled={boardBusy}
                          >
                            <IconPhotoStar className="size-3.5" stroke={2} />
                          </TileAction>
                        )}
                        <TileAction
                          label={t("removeMedia")}
                          onClick={() => setRemoving(item)}
                          disabled={boardBusy}
                        >
                          <IconTrash className="size-3.5" stroke={2} />
                        </TileAction>
                      </div>
                    </div>
                  );
                })}

                {kindUploads.map((upload) => (
                  <div
                    key={upload.id}
                    className="relative aspect-square overflow-hidden rounded-2xl bg-white/[0.03]"
                    title={upload.error ?? upload.file.name}
                  >
                    <UploadPreview upload={upload} />
                    {upload.phase === "uploading" && (
                      <span className="absolute inset-0 flex items-center justify-center bg-black/55 text-xs font-medium text-white tabular-nums">
                        {upload.progress}%
                      </span>
                    )}
                    {upload.phase === "attaching" && (
                      <span className="absolute inset-0 flex items-center justify-center bg-black/55">
                        <IconLoader2 className="size-5 animate-spin text-white/80" stroke={1.8} />
                      </span>
                    )}
                    {upload.phase === "failed" && (
                      <span className="absolute inset-0 flex flex-col items-center justify-center gap-1.5 bg-destructive/25 px-2 text-center backdrop-blur-sm">
                        <span className="line-clamp-3 text-[11px] leading-snug font-medium text-white">
                          {upload.error ?? t("uploadFailed")}
                        </span>
                        <span className="flex items-center gap-1">
                          <Button size="sm" variant="secondary" onClick={() => retryUpload(upload)}>
                            {tc("retry")}
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => dropUpload(upload.id)}>
                            <IconX className="size-3.5" stroke={2} />
                          </Button>
                        </span>
                      </span>
                    )}
                  </div>
                ))}

                {full ? (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      {/* Focusable (not native-disabled) so the reason tooltip
                          stays reachable — same pattern as the nav rail. */}
                      <button
                        type="button"
                        aria-disabled="true"
                        onClick={(event) => event.preventDefault()}
                        className="flex aspect-square cursor-not-allowed flex-col items-center justify-center gap-1.5 rounded-2xl bg-white/[0.02] text-white/25"
                      >
                        <IconPlus className="size-6" stroke={1.8} />
                        <span className="text-xs font-medium">{t("limitReached")}</span>
                      </button>
                    </TooltipTrigger>
                    <TooltipContent>
                      {t("capReached", { count: occupied, max: cap })}
                    </TooltipContent>
                  </Tooltip>
                ) : (
                  <button
                    type="button"
                    onClick={() => inputRefs.current.get(kind)?.click()}
                    className="flex aspect-square flex-col items-center justify-center gap-1.5 rounded-2xl bg-white/[0.04] text-white/55 transition hover:bg-white/[0.07] hover:text-white"
                  >
                    <IconPlus className="size-6" stroke={1.8} />
                    <span className="text-xs font-medium">{addLabel[kind]}</span>
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <Dialog open={removing !== null} onOpenChange={(open) => !open && setRemoving(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{t("removeMediaTitle")}</DialogTitle>
            <DialogDescription>{t("removeMediaDescription")}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setRemoving(null)} disabled={boardBusy}>
              {tc("cancel")}
            </Button>
            <Button variant="destructive" onClick={() => void confirmRemove()} disabled={boardBusy}>
              {tc("remove")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
