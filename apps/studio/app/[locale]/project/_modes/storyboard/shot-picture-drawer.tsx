"use client";

import { useId, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import {
  IconChevronDown,
  IconLayoutGrid,
  IconLoader2,
  IconPhoto,
  IconRefresh,
  IconSparkles,
  IconUpload,
  IconVideo,
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
import { CanvasDrawerPanel } from "@/components/canvas/canvas-drawer-panel";
import { ImagineModelPicker } from "@/components/canvas/authoring/imagine-model-picker";
import { ModelSettings } from "@/components/canvas/authoring/model-settings";
import { PromptTextarea } from "@/components/canvas/authoring/prompt-textarea";
import type { ShotSlotKind } from "./storyboard-types";
import { useShotPictureForm } from "./use-shot-picture-form";
import type { CanvasSource, ShotPictureSeed, ShotRow } from "./use-storyboard";

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
  sources,
  canEdit,
  actions,
  onClose,
}: {
  row: ShotRow;
  /** Which picture cell this drawer is editing. */
  slot: ShotSlotKind;
  sources: readonly CanvasSource[];
  canEdit: boolean;
  actions: ShotPictureDrawerActions;
  onClose: () => void;
}) {
  const t = useTranslations("storyboard");
  const { catalog } = useProjectContext();
  const promptId = useId();
  const [pickerOpen, setPickerOpen] = useState(false);
  const form = useShotPictureForm(row, slot, actions.onGenerate);
  const slotLabel = t(slot === "video" ? "drawer.slotClip" : "drawer.slotFrame");

  // How an EMPTY slot gets filled without generating: upload a file, or wire in
  // a picture that already lives on the canvas. Both call the actions the
  // storyboard hook already implements — no dead controls. Once the slot has a
  // picture, these give way to the recipe below.
  const picture = row.pictures.find((candidate) => candidate.kind === slot);
  const attachable = sources.filter((candidate) => candidate.kind === slot);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [sourcePickerOpen, setSourcePickerOpen] = useState(false);

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
    // The app's one drawer slot — same chrome as the canvas asset library, just
    // laid out inline so the table gives way instead of being covered.
    <CanvasDrawerPanel
      placement="inline"
      width={420}
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
      footer={
        canEdit ? (
          // The hero action: the candy `primary-cta`, full-width. `loading`
          // carries the busy state (spinner + aria-busy, blocks re-submit) —
          // no hand-rolled spinner. Busy already gated activation before, so
          // nothing regresses.
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
        ) : null
      }
    >
      <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-4 pt-4 pb-5">
        {canEdit && !picture ? (
          // Fill the slot without generating — upload a file or wire in a canvas
          // picture. Dashed tiles are the one sanctioned outline here: an upload
          // affordance (DESIGN.md "Composer drawer").
          <div className="flex flex-col gap-2">
            <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-white/15 px-4 py-7 text-center">
              <span className="grid size-12 place-items-center rounded-xl bg-white/[0.05] text-white/50">
                {uploadProgress !== null ? (
                  <IconLoader2 className="size-6 animate-spin" stroke={1.6} />
                ) : slot === "video" ? (
                  <IconVideo className="size-6" stroke={1.6} />
                ) : (
                  <IconPhoto className="size-6" stroke={1.6} />
                )}
              </span>
              <span className="text-sm font-semibold text-white/85">
                {uploadProgress !== null
                  ? t("drawer.uploading", { progress: uploadProgress })
                  : t("drawer.emptySlot")}
              </span>
              <div className="mt-1 flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploadProgress !== null}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-white/[0.08] px-3 py-1.5 text-xs font-semibold text-white/85 transition-colors hover:bg-white/[0.14] focus-visible:ring-2 focus-visible:ring-white/35 focus-visible:outline-none disabled:opacity-60"
                >
                  <IconUpload className="size-3.5" stroke={1.8} />
                  {t("drawer.upload")}
                </button>
                <button
                  type="button"
                  onClick={() => setSourcePickerOpen((open) => !open)}
                  disabled={attachable.length === 0}
                  aria-expanded={sourcePickerOpen}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-white/[0.08] px-3 py-1.5 text-xs font-semibold text-white/85 transition-colors hover:bg-white/[0.14] focus-visible:ring-2 focus-visible:ring-white/35 focus-visible:outline-none disabled:opacity-40"
                >
                  <IconLayoutGrid className="size-3.5" stroke={1.8} />
                  {t("drawer.pick")}
                </button>
              </div>
            </div>
            {sourcePickerOpen && attachable.length > 0 ? (
              <div className="grid grid-cols-4 gap-2 rounded-xl bg-white/[0.03] p-2">
                {attachable.map((source) => (
                  <button
                    key={source.nodeId}
                    type="button"
                    title={source.label}
                    onClick={() => {
                      actions.onAttach(row.id, source.nodeId);
                      setSourcePickerOpen(false);
                    }}
                    className="relative aspect-square overflow-hidden rounded-lg bg-white/[0.05] transition hover:ring-2 hover:ring-primary/50 focus-visible:ring-2 focus-visible:ring-white/35 focus-visible:outline-none"
                  >
                    {source.kind === "video" ? (
                      <video src={source.url} muted playsInline className="size-full object-cover" />
                    ) : (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={source.url} alt={source.label} className="size-full object-cover" />
                    )}
                  </button>
                ))}
              </div>
            ) : null}
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
            <div className="mt-1 h-px bg-white/[0.07]" />
          </div>
        ) : null}

        <Field label={t("drawer.promptLabel")} htmlFor={promptId} dense>
          {/* The editor ships bare — the canvas composer is what gives it a
              surface there. In a form it has to be a control: same fill, radius
              and type scale as the model trigger below, so the three fields
              read as one thing. */}
          <PromptTextarea
            id={promptId}
            value={form.prompt}
            onCommit={form.setPrompt}
            placeholder={t("drawer.promptPlaceholder")}
            rows={5}
            readOnly={!canEdit}
            aria-label={t("drawer.promptLabel")}
            className="block max-h-56 min-h-24 w-full resize-none overflow-y-auto rounded-xl bg-white/[0.06] px-3 py-2.5 text-xs leading-relaxed text-white/85 outline-none transition-colors placeholder:text-white/30 focus-within:bg-white/[0.09] focus-within:ring-2 focus-within:ring-primary/40"
          />
        </Field>

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
                // Strip the default DialogContent chrome (padding/bg/max-width) so
                // the picker's own 600×630 bordered surface shows through verbatim.
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

        {/* Schema-driven: every control comes from the selected model's own
            input schema, so a new model brings its parameters with it. */}
        <Field label={t("drawer.settingsLabel")} dense>
          <ModelSettings model={form.model} settings={form.settings} onChange={form.setSettings} />
        </Field>
      </div>
    </CanvasDrawerPanel>
  );
}
