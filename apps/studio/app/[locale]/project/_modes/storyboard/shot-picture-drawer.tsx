"use client";

import { useId, useState } from "react";
import { useTranslations } from "next-intl";
import {
  IconChevronDown,
  IconLoader2,
  IconPhoto,
  IconRefresh,
  IconSparkles,
  IconVideo,
} from "@tabler/icons-react";
import { useProjectContext } from "@/app/[locale]/project/_components/project-context";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { CanvasDrawerPanel } from "@/components/canvas/canvas-drawer-panel";
import { ModelPicker } from "@/components/canvas/authoring/model-picker";
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
          <Button
            className="w-full"
            size="lg"
            disabled={!form.canSubmit || form.busy}
            title={form.disabledReason ?? undefined}
            onClick={form.busy ? form.cancel : form.generate}
          >
            {form.busy ? (
              <>
                <IconLoader2 className="size-4 animate-spin" stroke={1.8} />
                {t("drawer.generating")}
              </>
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
            className="block max-h-56 min-h-24 w-full resize-none overflow-y-auto rounded-xl bg-white/[0.06] px-3 py-2.5 text-xs leading-relaxed text-white/85 outline-none transition-colors placeholder:text-white/30 focus-within:bg-white/[0.09]"
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
            // The picker is a floating panel: it anchors to this trigger, so
            // the relative wrapper is what it positions against.
            <div className="relative">
              <button
                type="button"
                disabled={!canEdit || catalog.loading}
                onClick={() => setPickerOpen((open) => !open)}
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
              {pickerOpen ? (
                <ModelPicker
                  catalog={catalog.data}
                  modality={slot}
                  selectedId={form.model?.id}
                  placement="bottom"
                  align="left"
                  onSelect={(model) => {
                    form.selectModel(model);
                    setPickerOpen(false);
                  }}
                  onClose={() => setPickerOpen(false)}
                />
              ) : null}
            </div>
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
