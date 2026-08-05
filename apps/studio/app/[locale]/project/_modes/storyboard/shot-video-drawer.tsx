"use client";

import { useId, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import {
  IconArrowLeft,
  IconChevronDown,
  IconLoader2,
  IconRefresh,
  IconSparkles,
  IconUpload,
  IconVideo,
  IconWand,
} from "@tabler/icons-react";
import type { FizzAiModel } from "@/lib/canvas-authoring/generation-api";
import { useProjectContext } from "@/app/[locale]/project/_components/project-context";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { DrawerPanel } from "@/components/ui/drawer-panel";
import { ImagineModelPicker } from "@/components/canvas/authoring/imagine-model-picker";
import { QuickParamChips } from "@/components/canvas/authoring/quick-param-chips";
import { PromptTextarea } from "@/components/canvas/authoring/prompt-textarea";
import type { ShotPictureDrawerActions } from "./shot-picture-drawer";
import { ShotPictureGallery } from "./shot-picture-gallery";
import type { ShotPictureForm } from "./use-shot-picture-form";
import { useShotPictureForm } from "./use-shot-picture-form";
import type { ShotPicture, ShotRow } from "./use-storyboard";

/**
 * The working panel for a shot's VIDEO (clip) cell.
 *
 * One file, three components: the shell (`ShotVideoDrawer` — owns DrawerPanel,
 * form, actions, view-switch) and two views (`VideoComposeView` /
 * `VideoGalleryView`). The shell passes data down; each view owns its own
 * rendering.
 */
export function ShotVideoDrawer({
  row,
  canEdit,
  actions,
  onClose,
}: {
  row: ShotRow;
  canEdit: boolean;
  actions: ShotPictureDrawerActions;
  onClose: () => void;
}) {
  const form = useShotPictureForm(row, "video", actions.onGenerate);
  const [view, setView] = useState<"compose" | "gallery">("compose");

  const slotPictures = row.pictures.filter((p) => p.kind === "video");
  const preferredEdgeId = row.preferredFrameEdgeId ?? slotPictures[0]?.edgeId;

  return (
    <>
      {view === "gallery" ? (
        <VideoGalleryView
          pictures={slotPictures}
          preferredEdgeId={preferredEdgeId}
          onClose={onClose}
          onBack={() => setView("compose")}
          onMarkFinalized={(edgeId) => actions.onSetPreferredFrame(row.id, edgeId)}
          onDelete={(edgeId) => actions.onDetach(row.id, edgeId)}
        />
      ) : (
        <VideoComposeView
          row={row}
          canEdit={canEdit}
          actions={actions}
          form={form}
          onClose={onClose}
          onOpenGallery={() => setView("gallery")}
        />
      )}
    </>
  );
}

// ── Compose view: video preview + model + prompt + params ───────────────────

function VideoComposeView({
  row,
  canEdit,
  actions,
  form,
  onClose,
  onOpenGallery,
}: {
  row: ShotRow;
  canEdit: boolean;
  actions: ShotPictureDrawerActions;
  form: ShotPictureForm;
  onClose: () => void;
  onOpenGallery: () => void;
}) {
  const t = useTranslations("storyboard");
  const { catalog } = useProjectContext();
  const promptId = useId();
  const [pickerOpen, setPickerOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);

  const slotPictures = row.pictures.filter((p) => p.kind === "video");
  const picture =
    slotPictures.find((p) => p.edgeId === row.preferredFrameEdgeId) ?? slotPictures[0];

  const uploadFile = async (file: File | undefined) => {
    if (!file) return;
    setUploadProgress(0);
    try {
      await actions.onUpload(row.id, file, "video", (percent) => setUploadProgress(percent));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("drawer.uploadFailed"));
    } finally {
      setUploadProgress(null);
    }
  };

  return (
    <>
    <DrawerPanel.Header
      title={t("drawer.title", { index: row.number, slot: t("drawer.slotClip") })}
      icon={<IconVideo className="size-4" stroke={1.8} />}
      closeLabel={t("drawer.close")}
      onClose={onClose}
    />
    <DrawerPanel.Body className="gap-4 px-4 pt-4 pb-5">
      {/* Video result preview + upload/gallery */}
      <div className="flex flex-col gap-2">
        <div className="relative w-full overflow-hidden rounded-xl bg-white/[0.04]">
          {picture?.url ? (
            <video src={picture.url} muted loop autoPlay playsInline className="block w-full" />
          ) : (
            <div className="flex aspect-video w-full flex-col items-center justify-center gap-1.5 text-white/30">
              {picture?.status === "running" ? (
                <IconLoader2 className="size-7 animate-spin text-white/40" stroke={1.4} />
              ) : (
                <IconVideo className="size-7" stroke={1.2} />
              )}
              <span className="text-[0.6875rem] font-medium">
                {picture?.status === "running" ? t("drawer.generating") : t("drawer.emptySlot")}
              </span>
            </div>
          )}
          {canEdit && (
            <div className="absolute right-2 top-2 z-10 flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploadProgress !== null}
                title={t("drawer.upload")}
                className="inline-flex size-7 items-center justify-center rounded-lg bg-black/50 text-white/80 backdrop-blur-sm transition-colors hover:bg-black/70 hover:text-white focus-visible:ring-2 focus-visible:ring-white/35 focus-visible:outline-none disabled:opacity-50"
              >
                {uploadProgress !== null ? (
                  <IconLoader2 className="size-3.5 animate-spin" stroke={1.8} />
                ) : (
                  <IconUpload className="size-3.5" stroke={1.8} />
                )}
              </button>
              <button
                type="button"
                onClick={onOpenGallery}
                title={t("drawer.gallery")}
                className="inline-flex size-7 items-center justify-center rounded-lg bg-black/50 text-white/80 backdrop-blur-sm transition-colors hover:bg-black/70 hover:text-white focus-visible:ring-2 focus-visible:ring-white/35 focus-visible:outline-none"
              >
                <IconVideo className="size-3.5" stroke={1.8} />
              </button>
            </div>
          )}
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept="video/*"
          hidden
          onChange={(event) => {
            void uploadFile(event.target.files?.[0]);
            event.target.value = "";
          }}
        />
      </div>

      {/* Model */}
      <Field label={t("drawer.modelLabel")} dense>
        {catalog.error ? (
          <button
            type="button"
            onClick={catalog.retry}
            className="flex h-9 w-full items-center justify-between gap-2 rounded-xl bg-destructive/10 px-3 text-xs text-destructive transition-colors hover:bg-destructive/15 focus-visible:ring-2 focus-visible:ring-white/35 focus-visible:outline-none"
          >
            <span className="truncate">{t("drawer.modelLoadFailed")}</span>
            <IconRefresh className="size-3.5 shrink-0" stroke={1.8} />
          </button>
        ) : (
          <ModelPickerButton
            open={pickerOpen}
            onOpenChange={setPickerOpen}
            disabled={!canEdit || catalog.loading}
            loading={catalog.loading}
            modelName={form.model?.name}
            modality="video"
            catalog={catalog.data}
            selectedId={form.model?.id}
            onSelect={form.selectModel}
          />
        )}
      </Field>

      {/* Prompt + Enhancer */}
      <Field label={t("drawer.promptLabel")} htmlFor={promptId} dense>
        <div className="relative">
          <PromptTextarea
            id={promptId}
            value={form.prompt}
            onCommit={form.setPrompt}
            placeholder={t("drawer.promptPlaceholder")}
            rows={5}
            readOnly={!canEdit}
            aria-label={t("drawer.promptLabel")}
            className="block max-h-56 min-h-24 w-full resize-none overflow-y-auto rounded-xl bg-white/[0.06] px-3 py-2.5 pr-20 text-xs leading-relaxed text-white/85 outline-none transition-colors placeholder:text-white/30 focus-within:bg-white/[0.09] focus-within:ring-2 focus-within:ring-primary/40"
          />
          <button
            type="button"
            disabled
            title={t("drawer.enhancerComingSoon")}
            className="absolute right-2 top-2 inline-flex items-center gap-1 rounded-md bg-white/[0.08] px-2 py-1 text-[0.625rem] font-medium text-white/60 backdrop-blur-sm disabled:opacity-60"
          >
            <IconWand className="size-3" stroke={1.8} />
            {t("drawer.enhancer")}
          </button>
        </div>
      </Field>

      {/* Quick params */}
      <Field label={t("drawer.settingsLabel")} dense>
        <QuickParamChips model={form.model} settings={form.settings} onChange={form.setSettings} />
      </Field>
    </DrawerPanel.Body>

      {canEdit && (
        <DrawerPanel.Footer>
          <Button
            variant="primary-cta"
            block
            size="lg"
            loading={form.busy}
            disabled={!form.canSubmit}
            title={form.disabledReason ?? undefined}
            onClick={form.generate}
          >
            {form.busy ? (
              t("drawer.generating")
            ) : (
              <>
                <IconSparkles className="size-4" stroke={1.8} />
                {t("drawer.generate")}
              </>
            )}
          </Button>
        </DrawerPanel.Footer>
      )}
    </>
  );
}

// ── Gallery view: masonry list of video candidates ──────────────────────────

function VideoGalleryView({
  pictures,
  preferredEdgeId,
  onClose,
  onBack,
  onMarkFinalized,
  onDelete,
}: {
  pictures: ShotPicture[];
  preferredEdgeId?: string;
  onClose: () => void;
  onBack: () => void;
  onMarkFinalized: (edgeId: string) => void;
  onDelete: (edgeId: string) => void;
}) {
  const t = useTranslations("storyboard");
  return (
    <>
    <DrawerPanel.Header
      title={t("drawer.clipGalleryTitle")}
      icon={
        <button
          type="button"
          onClick={onBack}
          aria-label={t("drawer.back")}
          className="text-white/68 transition-colors hover:text-white"
        >
          <IconArrowLeft className="size-4" stroke={1.8} />
        </button>
      }
      closeLabel={t("drawer.close")}
      onClose={onClose}
    />
    <DrawerPanel.Body className="gap-3 px-4 pt-4 pb-5">
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold text-white/90">{t("drawer.clipGalleryTitle")}</span>
        <span className="text-xs text-white/40">
          {t("drawer.clipGalleryCount", { count: pictures.length })}
        </span>
      </div>
      <ShotPictureGallery
        pictures={pictures}
        preferredEdgeId={preferredEdgeId}
        onMarkFinalized={onMarkFinalized}
        onDelete={onDelete}
      />
    </DrawerPanel.Body>
    </>
  );
}

// ── Shared: model picker trigger button + Dialog ────────────────────────────
// (image and video drawer both use this; lives here until lifted to a shared
// module if a third consumer appears.)

function ModelPickerButton({
  open,
  onOpenChange,
  disabled,
  loading,
  modelName,
  modality,
  catalog,
  selectedId,
  onSelect,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  disabled: boolean;
  loading: boolean;
  modelName?: string;
  modality: "image" | "video";
  catalog: ReturnType<typeof useProjectContext>["catalog"]["data"];
  selectedId?: string;
  onSelect: (model: FizzAiModel) => void;
}) {
  const t = useTranslations("storyboard");
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          className="flex h-9 w-full items-center justify-between gap-2 rounded-xl bg-white/[0.06] px-3 text-xs text-white/80 transition-colors hover:bg-white/[0.1] focus-visible:ring-2 focus-visible:ring-white/35 focus-visible:outline-none disabled:opacity-50"
        >
          <span className="truncate">
            {loading ? t("drawer.modelLoading") : (modelName ?? t("drawer.modelUnset"))}
          </span>
          {loading ? (
            <IconLoader2 className="size-3.5 shrink-0 animate-spin text-white/40" />
          ) : (
            <IconChevronDown className="size-3.5 shrink-0 text-white/40" stroke={2} />
          )}
        </button>
      </DialogTrigger>
      <DialogContent
        showCloseButton={false}
        overlayClassName="bg-black/60 backdrop-blur-sm"
        className="grid-cols-none gap-0 overflow-visible rounded-2xl border-0 bg-transparent p-0 text-foreground shadow-none sm:max-w-none w-fit"
      >
        <DialogTitle className="sr-only">{t("drawer.selectModelTitle")}</DialogTitle>
        <ImagineModelPicker
          catalog={catalog}
          modality={modality}
          selectedId={selectedId}
          onSelect={(model) => {
            onSelect(model);
            onOpenChange(false);
          }}
          onClose={() => onOpenChange(false)}
        />
      </DialogContent>
    </Dialog>
  );
}
