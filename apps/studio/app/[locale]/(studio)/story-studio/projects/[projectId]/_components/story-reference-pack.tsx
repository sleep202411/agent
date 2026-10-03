"use client";

import { useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  IconAlertTriangle,
  IconCheck,
  IconEdit,
  IconLoader2,
  IconPhoto,
  IconPlus,
  IconUpload,
} from "@tabler/icons-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { FrostedPanel } from "@/components/ui/frosted-panel";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { uploadFileViaSignedUrl } from "@/lib/media-upload";
import {
  approveStoryReferenceVersion,
  createStoryReferenceSlots,
  createStoryReferenceVersion,
  reviewStoryReferenceVersion,
  storyApiErrorMessage,
  updateStoryReferenceSlot,
  type StoryReferenceKind,
  type StoryReferenceReviewChecklist,
  type StoryReferenceSlot,
  type StoryReferenceSlotSpec,
  type StoryReviewChecklistValue,
  type StoryReviewDecision,
  type MediaAssetSummary,
  type StoryWorkbench,
} from "@/lib/story-projects-api";
import { useAuth } from "@/app/_components/auth-provider";
import { cn } from "@/lib/utils";

const REFERENCE_KINDS: StoryReferenceKind[] = [
  "character",
  "location",
  "prop",
  "graphic",
  "style",
  "join_frame",
  "first_frame",
  "last_frame",
];

const REVIEW_KEYS = ["technical", "identityContinuity", "rights", "safety"] as const;
const PASSING_REVIEW: StoryReferenceReviewChecklist = {
  technical: "pass",
  identityContinuity: "pass",
  rights: "pass",
  safety: "pass",
};

type ReferencePackProps = {
  projectId: string;
  workspaceId: string;
  workbench: StoryWorkbench;
  onRefresh: () => Promise<unknown>;
  apiConnected: boolean;
};

export function StoryReferencePack(props: ReferencePackProps) {
  const { user } = useAuth();
  if (!user) return null;
  const scope = JSON.stringify([
    user.id,
    props.projectId,
    props.workspaceId,
    props.apiConnected,
    [...props.workbench.project.capabilities].sort(),
  ]);
  return <StoryReferencePackBody key={scope} {...props} />;
}

function StoryReferencePackBody({
  projectId,
  workspaceId,
  workbench,
  onRefresh,
  apiConnected,
}: {
  projectId: string;
  workspaceId: string;
  workbench: StoryWorkbench;
  onRefresh: () => Promise<unknown>;
  apiConnected: boolean;
}) {
  const t = useTranslations("storyStudio.references");
  const references = workbench.references;
  const canProduce = workbench.project.capabilities.includes("story.generate");
  const canReview = workbench.project.capabilities.includes("story.review");
  const [selectedSlotId, setSelectedSlotId] = useState<string | null>(null);
  const [editorSlotId, setEditorSlotId] = useState<string | "new" | null>(null);
  const [reviewTarget, setReviewTarget] = useState<{ slotId: string; versionId: string } | null>(
    null
  );
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [confirmedUpload, setConfirmedUpload] = useState<{
    id: string;
    variantId: string;
    previewUrl: string;
  } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const selectedSlot = references.find((slot) => slot.id === selectedSlotId) ?? null;
  const existingAssets = useMemo(() => projectReferenceAssets(references), [references]);

  const lifetime = useRef<AbortController | null>(null);
  const busy = useRef(false);
  useLayoutEffect(() => {
    const owner = new AbortController();
    lifetime.current = owner;
    return () => {
      owner.abort();
      if (lifetime.current === owner) lifetime.current = null;
    };
  }, []);

  const run = async (key: string, action: (signal: AbortSignal) => Promise<unknown>) => {
    const owner = lifetime.current;
    if (!apiConnected || !owner || owner.signal.aborted || busy.current) return false;
    busy.current = true;
    setPendingKey(key);
    setError(null);
    try {
      await action(owner.signal);
      owner.signal.throwIfAborted();
      await onRefresh();
      owner.signal.throwIfAborted();
      return true;
    } catch (cause) {
      if (!owner.signal.aborted) setError(storyApiErrorMessage(cause, t("errors.action")));
      return false;
    } finally {
      if (!owner.signal.aborted) {
        busy.current = false;
        setPendingKey(null);
        setUploadProgress(null);
        if (fileInputRef.current) fileInputRef.current.value = "";
      }
    }
  };

  const attachAsset = (
    slot: StoryReferenceSlot,
    assetId: string,
    variantId: string,
    source: "upload" | "import"
  ) => {
    if (!canProduce) return Promise.resolve(false);
    return run(`version:${slot.id}`, (signal) =>
      createStoryReferenceVersion(
        projectId,
        slot.id,
        { expectedSlotVersion: slot.version, assetId, variantId, source },
        globalThis.crypto.randomUUID(),
        signal
      )
    );
  };

  const upload = async (slot: StoryReferenceSlot, file: File) => {
    if (!canProduce) return;
    await run(`upload:${slot.id}`, async (signal) => {
      setUploadProgress(0);
      const asset = await uploadFileViaSignedUrl(file, {
        kind: "ai_reference_image",
        workspaceId,
        signal,
        onProgress: (progress) => {
          if (!signal.aborted) setUploadProgress(progress);
        },
      });
      signal.throwIfAborted();
      setConfirmedUpload({
        id: asset.mediaAssetId,
        variantId: asset.variantId,
        previewUrl: asset.url,
      });
      await createStoryReferenceVersion(
        projectId,
        slot.id,
        {
          expectedSlotVersion: slot.version,
          assetId: asset.mediaAssetId,
          variantId: asset.variantId,
          source: "upload",
        },
        globalThis.crypto.randomUUID(),
        signal
      );
      signal.throwIfAborted();
      setConfirmedUpload(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
    });
  };

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="text-base font-semibold text-white">{t("title")}</h2>
          <p className="mt-1 text-xs text-white/40">{t("subtitle")}</p>
        </div>
        <div className="flex items-center gap-3">
          <p className="text-xs tabular-nums text-white/40">
            {t("approvedCount", {
              approved: references.filter((reference) => reference.status === "approved").length,
              total: references.length,
            })}
          </p>
          <Button
            size="sm"
            disabled={!apiConnected || !canProduce}
            onClick={() => setEditorSlotId("new")}
          >
            <IconPlus className="size-4" />
            {t("actions.createSlot")}
          </Button>
        </div>
      </div>

      {!apiConnected ? (
        <div className="mt-4 flex items-start gap-2 rounded-xl bg-white/[0.04] px-4 py-3 text-xs leading-5 text-white/44">
          <IconAlertTriangle className="mt-0.5 size-4 shrink-0" />
          {t("apiUnavailable")}
        </div>
      ) : null}
      {error && !selectedSlot && !editorSlotId && !reviewTarget ? (
        <p role="alert" className="mt-3 text-xs text-destructive">
          {error}
        </p>
      ) : null}

      {references.length === 0 ? (
        <FrostedPanel className="mt-5 flex min-h-56 flex-col items-center justify-center p-8 text-center">
          <IconPhoto className="size-7 text-white/22" />
          <h3 className="mt-3 text-sm font-semibold text-white/68">{t("empty.title")}</h3>
          <p className="mt-1 max-w-md text-xs leading-5 text-white/36">{t("empty.description")}</p>
        </FrostedPanel>
      ) : (
        <div className="mt-5 grid gap-3 lg:grid-cols-2 2xl:grid-cols-3">
          {references.map((slot) => (
            <ReferenceSlotCard
              key={slot.id}
              slot={slot}
              onOpen={() => setSelectedSlotId(slot.id)}
            />
          ))}
        </div>
      )}

      <Dialog
        open={Boolean(selectedSlot)}
        onOpenChange={(open) => !open && setSelectedSlotId(null)}
      >
        {selectedSlot ? (
          <DialogContent className="max-h-[86vh] max-w-[920px] overflow-y-auto rounded-[26px] bg-[oklch(0.22_0_0/0.98)] p-5 shadow-[0_30px_120px_rgba(0,0,0,0.7)] backdrop-blur-[40px]">
            <DialogHeader>
              <DialogTitle>{selectedSlot.label}</DialogTitle>
              <DialogDescription>
                {t(`kind.${selectedSlot.kind}`)} · {selectedSlot.key}
              </DialogDescription>
            </DialogHeader>
            {error && !editorSlotId && !reviewTarget ? (
              <p role="alert" className="text-xs text-destructive">
                {error}
              </p>
            ) : null}
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="max-w-xl text-xs leading-5 text-white/44">
                {selectedSlot.description || t("detail.noDescription")}
              </p>
              <Button
                size="sm"
                variant="secondary"
                disabled={!apiConnected || !canProduce}
                onClick={() => setEditorSlotId(selectedSlot.id)}
              >
                <IconEdit className="size-4" />
                {t("actions.editSlot")}
              </Button>
            </div>

            <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {selectedSlot.versions.map((version) => (
                <VersionCard
                  key={version.id}
                  version={version}
                  approved={selectedSlot.approvedVersionId === version.id}
                  canReview={apiConnected && canReview && !version.approved}
                  pending={pendingKey === `review:${version.id}`}
                  onReview={() =>
                    setReviewTarget({ slotId: selectedSlot.id, versionId: version.id })
                  }
                />
              ))}
            </div>
            {selectedSlot.versions.length === 0 ? (
              <p className="mt-4 rounded-xl bg-white/[0.035] px-4 py-5 text-center text-xs text-white/34">
                {t("detail.noVersions")}
              </p>
            ) : null}

            <div className="mt-5 rounded-[18px] bg-black/18 p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h3 className="text-xs font-semibold text-white/68">{t("assets.title")}</h3>
                  <p className="mt-1 text-[11px] text-white/34">{t("assets.description")}</p>
                </div>
                <Button
                  size="sm"
                  disabled={!apiConnected || !canProduce || pendingKey !== null}
                  onClick={() => fileInputRef.current?.click()}
                >
                  {uploadProgress !== null ? (
                    <IconLoader2 className="size-4 animate-spin" />
                  ) : (
                    <IconUpload className="size-4" />
                  )}
                  {uploadProgress === null
                    ? t("actions.upload")
                    : t("actions.uploading", { progress: uploadProgress })}
                </Button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  className="hidden"
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file) void upload(selectedSlot, file);
                  }}
                />
              </div>
              {existingAssets.length > 0 || confirmedUpload ? (
                <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
                  {confirmedUpload ? (
                    <button
                      type="button"
                      disabled={!apiConnected || !canProduce || pendingKey !== null}
                      onClick={() =>
                        void attachAsset(
                          selectedSlot,
                          confirmedUpload.id,
                          confirmedUpload.variantId,
                          "upload"
                        ).then((attached) => attached && setConfirmedUpload(null))
                      }
                      className="group w-28 shrink-0 overflow-hidden rounded-xl bg-white/[0.08] text-left transition hover:bg-white/[0.12] disabled:opacity-40"
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element -- confirmed signed media URL. */}
                      <img
                        src={confirmedUpload.previewUrl}
                        alt=""
                        className="aspect-square w-full object-cover"
                      />
                      <span className="block truncate px-2 py-1.5 text-[9px] text-white/58">
                        {t("assets.retryAttach")}
                      </span>
                    </button>
                  ) : null}
                  {existingAssets.map((asset) => (
                    <button
                      key={`${asset.asset.id}:${asset.variantId}`}
                      type="button"
                      disabled={!apiConnected || !canProduce || pendingKey !== null}
                      onClick={() =>
                        void attachAsset(selectedSlot, asset.asset.id, asset.variantId, "import")
                      }
                      className="group w-28 shrink-0 overflow-hidden rounded-xl bg-white/[0.045] text-left transition hover:bg-white/[0.08] disabled:opacity-40"
                    >
                      <AssetPreview asset={asset.asset} className="aspect-square" />
                      <span className="block truncate px-2 py-1.5 text-[9px] text-white/42">
                        {t("assets.existing")}
                      </span>
                    </button>
                  ))}
                </div>
              ) : (
                <p className="mt-3 text-[11px] text-white/32">{t("assets.empty")}</p>
              )}
            </div>
          </DialogContent>
        ) : null}
      </Dialog>

      <SlotEditorDialog
        error={error}
        key={editorSlotId ?? "closed"}
        open={editorSlotId !== null}
        slot={references.find((slot) => slot.id === editorSlotId) ?? null}
        nextRank={references.reduce((max, slot) => Math.max(max, slot.rank), 0) + 10}
        busy={pendingKey === "slot"}
        onClose={() => setEditorSlotId(null)}
        onSubmit={(spec) => {
          if (!apiConnected || !canProduce) return;
          const current = references.find((slot) => slot.id === editorSlotId);
          void run("slot", (signal) =>
            current
              ? updateStoryReferenceSlot(
                  projectId,
                  current.id,
                  {
                    expectedSlotVersion: current.version,
                    slot: spec,
                  },
                  signal
                )
              : createStoryReferenceSlots(
                  projectId,
                  { slots: [spec] },
                  globalThis.crypto.randomUUID(),
                  signal
                )
          ).then((saved) => {
            if (saved) setEditorSlotId(null);
          });
        }}
      />

      <ReferenceReviewDialog
        error={error}
        open={reviewTarget !== null}
        busy={Boolean(reviewTarget && pendingKey === `review:${reviewTarget.versionId}`)}
        onClose={() => setReviewTarget(null)}
        onSubmit={(decision, checklist, comment) => {
          const target = reviewTarget;
          const slot = references.find((candidate) => candidate.id === target?.slotId);
          const version = slot?.versions.find((candidate) => candidate.id === target?.versionId);
          if (!target || !slot || !version || !apiConnected || !canReview) return;
          void run(`review:${version.id}`, async (signal) => {
            const result = await reviewStoryReferenceVersion(
              projectId,
              slot.id,
              version.id,
              {
                expectedReviewRevision: version.reviewRevision,
                decision,
                checklist,
                comment,
              },
              signal
            );
            signal.throwIfAborted();
            if (decision === "approve") {
              await approveStoryReferenceVersion(
                projectId,
                slot.id,
                {
                  expectedSlotVersion: slot.version,
                  referenceVersionId: version.id,
                  approveReviewId: result.review.id,
                },
                signal
              );
            }
          }).then((saved) => {
            if (saved) setReviewTarget(null);
          });
        }}
      />
    </div>
  );
}

function ReferenceSlotCard({ slot, onOpen }: { slot: StoryReferenceSlot; onOpen: () => void }) {
  const t = useTranslations("storyStudio.references");
  const approved = slot.versions.find((version) => version.id === slot.approvedVersionId);
  const preview = approved ?? slot.versions[0];
  return (
    <button type="button" onClick={onOpen} className="text-left">
      <FrostedPanel className="h-full min-h-48 overflow-hidden p-0 transition hover:bg-white/[0.045]">
        <div className="grid grid-cols-[116px_1fr] gap-4 p-4">
          <AssetPreview asset={preview?.asset ?? null} className="aspect-square rounded-xl" />
          <div className="min-w-0">
            <div className="flex items-center justify-between gap-2">
              <span className="font-mono text-[9px] text-white/26">{slot.key}</span>
              <span className="rounded-full bg-white/[0.055] px-2 py-1 text-[8px] font-semibold text-white/42">
                {t(`status.${slot.status}`)}
              </span>
            </div>
            <h3 className="mt-2 truncate text-sm font-semibold text-white/80">{slot.label}</h3>
            <p className="mt-2 line-clamp-3 text-[11px] leading-4 text-white/38">
              {slot.description || t("detail.noDescription")}
            </p>
            <div className="mt-3 flex gap-2 text-[9px] text-white/28">
              <span>{t(`kind.${slot.kind}`)}</span>
              <span>·</span>
              <span>{slot.required ? t("required") : t("optional")}</span>
              <span>·</span>
              <span>{t("detail.versionCount", { count: slot.versions.length })}</span>
            </div>
          </div>
        </div>
      </FrostedPanel>
    </button>
  );
}

function VersionCard({
  version,
  approved,
  canReview,
  pending,
  onReview,
}: {
  version: StoryReferenceSlot["versions"][number];
  approved: boolean;
  canReview: boolean;
  pending: boolean;
  onReview: () => void;
}) {
  const t = useTranslations("storyStudio.references");
  return (
    <article className="overflow-hidden rounded-xl bg-white/[0.04]">
      <div className="relative">
        <AssetPreview asset={version.asset} className="aspect-square" />
        {approved ? (
          <span className="absolute top-2 left-2 flex items-center gap-1 rounded-full bg-white/90 px-2 py-1 text-[8px] font-semibold text-black">
            <IconCheck className="size-2.5" />
            {t("detail.approved")}
          </span>
        ) : null}
      </div>
      <div className="p-2.5">
        <div className="flex items-center justify-between gap-2 text-[9px] text-white/34">
          <span>{t("detail.version", { number: version.number })}</span>
          <span>{version.source}</span>
        </div>
        {!approved ? (
          <Button
            size="sm"
            variant="secondary"
            className="mt-2 w-full"
            disabled={!canReview || pending}
            onClick={onReview}
          >
            {pending ? (
              <IconLoader2 className="size-3.5 animate-spin" />
            ) : (
              <IconCheck className="size-3.5" />
            )}
            {t("actions.review")}
          </Button>
        ) : null}
      </div>
    </article>
  );
}

function AssetPreview({
  asset,
  className,
}: {
  asset: MediaAssetSummary | null;
  className?: string;
}) {
  if (!asset?.previewUrl) {
    return (
      <div className={cn("grid place-items-center bg-black/25 text-white/20", className)}>
        <IconPhoto className="size-6" />
      </div>
    );
  }
  if (asset.kind === "video") {
    return (
      <video
        src={asset.previewUrl}
        muted
        playsInline
        preload="metadata"
        className={cn("size-full object-cover", className)}
      />
    );
  }
  // eslint-disable-next-line @next/next/no-img-element -- signed media URL.
  return <img src={asset.previewUrl} alt="" className={cn("size-full object-cover", className)} />;
}

function SlotEditorDialog({
  error,
  open,
  slot,
  nextRank,
  busy,
  onClose,
  onSubmit,
}: {
  error: string | null;
  open: boolean;
  slot: StoryReferenceSlot | null;
  nextRank: number;
  busy: boolean;
  onClose: () => void;
  onSubmit: (spec: StoryReferenceSlotSpec) => void;
}) {
  const t = useTranslations("storyStudio.references");
  const [draft, setDraft] = useState<StoryReferenceSlotSpec>(() => slotSpec(slot, nextRank));
  const valid = /^[A-Z][A-Z0-9_-]{0,39}$/.test(draft.key) && draft.label.trim().length > 0;
  return (
    <Dialog open={open} onOpenChange={(value) => !value && onClose()}>
      <DialogContent className="max-w-lg rounded-[24px] bg-[oklch(0.22_0_0/0.98)] p-5">
        <DialogHeader>
          <DialogTitle>{slot ? t("editor.editTitle") : t("editor.createTitle")}</DialogTitle>
          <DialogDescription>{t("editor.description")}</DialogDescription>
        </DialogHeader>
        {error ? (
          <p role="alert" className="text-xs text-destructive">
            {error}
          </p>
        ) : null}
        <div className="grid grid-cols-2 gap-3">
          <label>
            <span className="text-[10px] font-semibold text-white/42">{t("editor.key")}</span>
            <Input
              value={draft.key}
              disabled={Boolean(slot)}
              onChange={(event) => setDraft({ ...draft, key: event.target.value.toUpperCase() })}
              className="mt-2"
            />
          </label>
          <label>
            <span className="text-[10px] font-semibold text-white/42">{t("editor.kind")}</span>
            <Select
              value={draft.kind}
              onValueChange={(kind) => setDraft({ ...draft, kind: kind as StoryReferenceKind })}
            >
              <SelectTrigger className="mt-2 w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {REFERENCE_KINDS.map((kind) => (
                  <SelectItem key={kind} value={kind}>
                    {t(`kind.${kind}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>
        </div>
        <label>
          <span className="text-[10px] font-semibold text-white/42">{t("editor.label")}</span>
          <Input
            value={draft.label}
            onChange={(event) => setDraft({ ...draft, label: event.target.value })}
            className="mt-2"
          />
        </label>
        <label>
          <span className="text-[10px] font-semibold text-white/42">
            {t("editor.descriptionLabel")}
          </span>
          <Textarea
            value={draft.description}
            onChange={(event) => setDraft({ ...draft, description: event.target.value })}
            rows={3}
            className="mt-2 resize-none"
          />
        </label>
        <label className="flex items-center gap-2 rounded-xl bg-white/[0.04] px-3 py-2.5 text-xs text-white/54">
          <input
            type="checkbox"
            checked={draft.required}
            onChange={(event) => setDraft({ ...draft, required: event.target.checked })}
          />
          {t("editor.required")}
        </label>
        <DialogFooter>
          <Button variant="secondary" onClick={onClose}>
            {t("actions.cancel")}
          </Button>
          <Button
            disabled={!valid || busy}
            onClick={() =>
              onSubmit({
                ...draft,
                key: draft.key.trim(),
                label: draft.label.trim(),
                description: draft.description.trim(),
              })
            }
          >
            {busy ? (
              <IconLoader2 className="size-4 animate-spin" />
            ) : (
              <IconCheck className="size-4" />
            )}
            {t("actions.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ReferenceReviewDialog({
  error,
  open,
  busy,
  onClose,
  onSubmit,
}: {
  error: string | null;
  open: boolean;
  busy: boolean;
  onClose: () => void;
  onSubmit: (
    decision: StoryReviewDecision,
    checklist: StoryReferenceReviewChecklist,
    comment?: string
  ) => void;
}) {
  const t = useTranslations("storyStudio.references");
  const [decision, setDecision] = useState<StoryReviewDecision>("approve");
  const [checklist, setChecklist] = useState(PASSING_REVIEW);
  const [comment, setComment] = useState("");
  return (
    <Dialog open={open} onOpenChange={(value) => !value && onClose()}>
      <DialogContent className="max-w-lg rounded-[24px] bg-[oklch(0.22_0_0/0.98)] p-5">
        <DialogHeader>
          <DialogTitle>{t("review.title")}</DialogTitle>
          <DialogDescription>{t("review.description")}</DialogDescription>
        </DialogHeader>
        {error ? (
          <p role="alert" className="text-xs text-destructive">
            {error}
          </p>
        ) : null}
        <Select
          value={decision}
          onValueChange={(value) => setDecision(value as StoryReviewDecision)}
        >
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="approve">{t("review.approve")}</SelectItem>
            <SelectItem value="request_changes">{t("review.requestChanges")}</SelectItem>
            <SelectItem value="reject">{t("review.reject")}</SelectItem>
          </SelectContent>
        </Select>
        <div className="grid grid-cols-2 gap-2">
          {REVIEW_KEYS.map((key) => (
            <label key={key} className="rounded-xl bg-white/[0.04] p-2.5 text-[10px] text-white/52">
              {t(`review.checklist.${key}`)}
              <Select
                value={checklist[key]}
                onValueChange={(value) =>
                  setChecklist({ ...checklist, [key]: value as StoryReviewChecklistValue })
                }
              >
                <SelectTrigger className="mt-2 h-8! w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="pass">{t("review.pass")}</SelectItem>
                  <SelectItem value="fail">{t("review.fail")}</SelectItem>
                  <SelectItem value="na">{t("review.na")}</SelectItem>
                </SelectContent>
              </Select>
            </label>
          ))}
        </div>
        <Textarea
          value={comment}
          onChange={(event) => setComment(event.target.value)}
          placeholder={t("review.comment")}
          rows={3}
          className="resize-none"
        />
        <DialogFooter>
          <Button variant="secondary" onClick={onClose}>
            {t("actions.cancel")}
          </Button>
          <Button
            disabled={busy}
            onClick={() => onSubmit(decision, checklist, comment.trim() || undefined)}
          >
            {busy ? (
              <IconLoader2 className="size-4 animate-spin" />
            ) : (
              <IconCheck className="size-4" />
            )}
            {t("actions.review")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function slotSpec(slot: StoryReferenceSlot | null, rank: number): StoryReferenceSlotSpec {
  return slot
    ? {
        key: slot.key,
        kind: slot.kind,
        label: slot.label,
        description: slot.description,
        required: slot.required,
        rank: slot.rank,
      }
    : { key: "", kind: "character", label: "", description: "", required: true, rank };
}

function projectReferenceAssets(
  references: StoryReferenceSlot[]
): Array<{ asset: MediaAssetSummary; variantId: string }> {
  const assets = new Map<string, { asset: MediaAssetSummary; variantId: string }>();
  references.forEach((slot) =>
    slot.versions.forEach((version) =>
      assets.set(`${version.asset.id}:${version.variantId}`, {
        asset: version.asset,
        variantId: version.variantId,
      })
    )
  );
  return [...assets.values()];
}
