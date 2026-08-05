"use client";

import { useId, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import {
  IconArrowLeft,
  IconChevronDown,
  IconLoader2,
  IconPhoto,
  IconRefresh,
  IconSparkles,
  IconUpload,
  IconVideo,
  IconWand,
} from "@tabler/icons-react";
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
import type { ShotSlotKind } from "./storyboard-types";
import { ShotPictureGallery } from "./shot-picture-gallery";
import { useShotPictureForm } from "./use-shot-picture-form";
import type { ShotPictureSeed, ShotRow } from "./use-storyboard";

/**
 * What the drawer can do to a picture. The storyboard hook already implements
 * all of it (`use-storyboard.ts`); this is the contract the rebuilt body will
 * call into.
 */
export interface ShotPictureDrawerActions {
  /** Creates the generation card feeding this slot, seeded with the form's
   *  current values, and returns its id so the run can start on it. */
  onGenerate: (shotId: string, modality: ShotSlotKind, seed?: ShotPictureSeed) => string | null;
  onUpload: (
    shotId: string,
    file: File,
    kind: "image" | "video",
    onProgress: (progress: number) => void
  ) => Promise<void>;
  onAttach: (shotId: string, sourceNodeId: string) => void;
  onDetach: (shotId: string, edgeId: string) => void;
  /** Mark one frame reference as the 定稿 (cover), or clear it (undefined). */
  onSetPreferredFrame: (shotId: string, edgeId: string | undefined) => void;
  onOpenOnCanvas: (nodeId: string) => void;
}

/**
 * The working panel for ONE picture cell — a master-detail companion to the
 * table, not a modal.
 *
 * It is the CELL's editor: click the frame and you get the frame, nothing else.
 * The shot's other picture is another cell with its own drawer, reached by
 * clicking it.
 *
 * A storyboard is read as a sequence, so this must not cover the shots around
 * it: the drawer sits beside the table, the table reflows, and generation
 * (which takes minutes) runs while the board stays usable. Clicking another
 * cell swaps the detail without any open/close cycle.
 *
 * The body is the picture's recipe, top to bottom: what to make (prompt), what
 * makes it (model), how (that model's own parameters). The footer commits.
 * Nothing about the RESULT lives here — that is the cell in the table, and the
 * shot node on the canvas.
 */
export function ShotPictureDrawer({
  row,
  slot,
  canEdit,
  actions,
  onClose,
}: {
  row: ShotRow;
  /** Which picture cell this drawer is editing. */
  slot: ShotSlotKind;
  canEdit: boolean;
  actions: ShotPictureDrawerActions;
  onClose: () => void;
}) {
  const t = useTranslations("storyboard");
  const { catalog } = useProjectContext();
  const promptId = useId();
  const [pickerOpen, setPickerOpen] = useState(false);
  const [view, setView] = useState<"compose" | "gallery">("compose");
  const form = useShotPictureForm(row, slot, actions.onGenerate);
  const slotLabel = t(slot === "video" ? "drawer.slotClip" : "drawer.slotFrame");

  // Every picture wired into THIS slot (multiple for image — the "图册"; one for
  // video). The preferred one is the 定稿 shown as the cover.
  const slotPictures = row.pictures.filter((candidate) => candidate.kind === slot);
  const preferredPicture =
    slotPictures.find((p) => p.edgeId === row.preferredFrameEdgeId) ?? slotPictures[0];
  const picture = preferredPicture;
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);

  const uploadFile = async (file: File | undefined) => {
    if (!file) return;
    setUploadProgress(0);
    try {
      await actions.onUpload(row.id, file, slot, (percent) => setUploadProgress(percent));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("drawer.uploadFailed"));
    } finally {
      setUploadProgress(null);
    }
  };

  return (
    <>
      <DrawerPanel.Header
        title={t("drawer.title", { index: row.number, slot: slotLabel })}
        icon={
          slot === "video" ? (
            <IconVideo className="size-4" stroke={1.8} />
          ) : (
            <IconPhoto className="size-4" stroke={1.8} />
          )
        }
        closeLabel={t("drawer.close")}
        onClose={onClose}
      />
      {view === "gallery" ? (
        <DrawerPanel.Body className="gap-3 px-4 pt-4 pb-5">
          {/* Back to compose */}
          <button
            type="button"
            onClick={() => setView("compose")}
            className="inline-flex w-fit items-center gap-1.5 rounded-lg px-1.5 py-1 text-xs text-white/70 transition-colors hover:text-white"
          >
            <IconArrowLeft className="size-3.5" stroke={1.8} />
            {t("drawer.back")}
          </button>

          <div className="flex items-center justify-between">
            <span className="text-sm font-semibold text-white/90">
              {t("drawer.galleryTitle")}
            </span>
            <span className="text-xs text-white/40">
              {t("drawer.galleryCount", { count: slotPictures.length })}
            </span>
          </div>

          <ShotPictureGallery
            pictures={slotPictures}
            preferredEdgeId={row.preferredFrameEdgeId ?? slotPictures[0]?.edgeId}
            onMarkFinalized={(edgeId) => actions.onSetPreferredFrame(row.id, edgeId)}
            onDelete={(edgeId) => actions.onDetach(row.id, edgeId)}
          />
        </DrawerPanel.Body>
      ) : (
      <DrawerPanel.Body className="gap-4 px-4 pt-4 pb-5">
        {/* ── 0. Current picture preview + upload/library ─────────── */}
        {/* The slot's current render sits at the top. Two affordances overlap its
            top-right corner: Upload (file picker) and Library (canvas sources).
            Empty/running slots show a placeholder instead of media. */}
        <div className="flex flex-col gap-2">
          <div className="relative w-full overflow-hidden rounded-xl bg-white/[0.04]">
            {picture?.url ? (
              picture.kind === "video" ? (
                <video src={picture.url} muted loop autoPlay playsInline className="block w-full" />
              ) : (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={picture.url} alt={slotLabel} className="block w-full" />
              )
            ) : (
              <div className="flex h-32 flex-col items-center justify-center gap-1.5 text-white/30">
                {picture?.status === "running" ? (
                  <IconLoader2 className="size-7 animate-spin text-white/40" stroke={1.4} />
                ) : (
                  <IconPhoto className="size-7" stroke={1.2} />
                )}
                <span className="text-[0.6875rem] font-medium">
                  {picture?.status === "running"
                    ? t("drawer.generating")
                    : picture?.status === "failed"
                      ? t("drawer.emptySlot")
                      : t("drawer.emptySlot")}
                </span>
              </div>
            )}

            {/* Top-right action stack: Upload + Library, only when editable. */}
            {canEdit ? (
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
                  onClick={() => setView("gallery")}
                  title={t("drawer.gallery")}
                  className="inline-flex size-7 items-center justify-center rounded-lg bg-black/50 text-white/80 backdrop-blur-sm transition-colors hover:bg-black/70 hover:text-white focus-visible:ring-2 focus-visible:ring-white/35 focus-visible:outline-none"
                >
                  <IconPhoto className="size-3.5" stroke={1.8} />
                </button>
              </div>
            ) : null}
          </div>

          <input
            ref={fileInputRef}
            type="file"
            accept={slot === "video" ? "video/*" : "image/*"}
            hidden
            onChange={(event) => {
              void uploadFile(event.target.files?.[0]);
              event.target.value = "";
            }}
          />
        </div>

        {/* ── 1. Model ─────────────────────────────────────────────── */}
        {/* Three states, never conflated: still loading, failed to load, and
            loaded. An empty picker used to stand for all three, which is what
            made "no models" impossible to tell from "the request died". */}
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
            // The model picker opens as a centred Radix Dialog — the imagine.art
            // replica is a 600×630 panel that can't fit inside the 420px drawer, so
            // it floats over everything instead of anchoring to the trigger.
            <Dialog open={pickerOpen} onOpenChange={setPickerOpen}>
              <DialogTrigger asChild>
                <button
                  type="button"
                  disabled={!canEdit || catalog.loading}
                  className="flex h-9 w-full items-center justify-between gap-2 rounded-xl bg-white/[0.06] px-3 text-xs text-white/80 transition-colors hover:bg-white/[0.1] focus-visible:ring-2 focus-visible:ring-white/35 focus-visible:outline-none disabled:opacity-50"
                >
                  <span className="truncate">
                    {catalog.loading
                      ? t("drawer.modelLoading")
                      : (form.model?.name ?? t("drawer.modelUnset"))}
                  </span>
                  {catalog.loading ? (
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
                  catalog={catalog.data}
                  modality={slot}
                  selectedId={form.model?.id}
                  onSelect={(model) => {
                    form.selectModel(model);
                    setPickerOpen(false);
                  }}
                  onClose={() => setPickerOpen(false)}
                />
              </DialogContent>
            </Dialog>
          )}
        </Field>

        {/* ── 2. Prompt + Enhancer ────────────────────────────────── */}
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
            {/* Enhancer — UI shell only (no prompt-enhancement backend yet). */}
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

        {/* ── 5. Quick params ─────────────────────────────────────── */}
        {/* Schema-driven: one chip per quick setting (aspect / duration /
            resolution …), each opening its own popover — imagine.art style. */}
        <Field label={t("drawer.settingsLabel")} dense>
          <QuickParamChips
            model={form.model}
            settings={form.settings}
            onChange={form.setSettings}
          />
        </Field>
      </DrawerPanel.Body>
      )}

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
