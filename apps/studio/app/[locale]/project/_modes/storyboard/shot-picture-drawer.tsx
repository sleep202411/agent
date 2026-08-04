"use client";

import { useId, useState } from "react";
import { useTranslations } from "next-intl";
import {
  IconChevronDown,
  IconLoader2,
  IconPhoto,
  IconSparkles,
  IconVideo,
} from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { CanvasDrawerPanel } from "@/components/canvas/canvas-drawer-panel";
import { ModelPicker } from "@/components/canvas/authoring/model-picker";
import { ModelSettings } from "@/components/canvas/authoring/model-settings";
import { PromptTextarea } from "@/components/canvas/authoring/prompt-textarea";
import { useAiCatalog } from "@/lib/canvas-authoring/use-ai-catalog";
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
  const { data: catalog } = useAiCatalog();
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
          <PromptTextarea
            id={promptId}
            value={form.prompt}
            onCommit={form.setPrompt}
            placeholder={t("drawer.promptPlaceholder")}
            rows={5}
            readOnly={!canEdit}
            aria-label={t("drawer.promptLabel")}
          />
        </Field>

        <Field label={t("drawer.modelLabel")} dense>
          {/* The picker is a floating panel: it anchors to this trigger, so the
              relative wrapper is what it positions against. */}
          <div className="relative">
            <button
              type="button"
              disabled={!canEdit}
              onClick={() => setPickerOpen((open) => !open)}
              className="flex h-9 w-full items-center justify-between gap-2 rounded-xl bg-white/[0.06] px-3 text-xs text-white/80 transition-colors hover:bg-white/[0.1] focus-visible:ring-2 focus-visible:ring-white/35 focus-visible:outline-none disabled:opacity-50"
            >
              <span className="truncate">{form.model?.name ?? t("drawer.modelUnset")}</span>
              <IconChevronDown className="size-3.5 shrink-0 text-white/40" stroke={2} />
            </button>
            {pickerOpen ? (
              <ModelPicker
                catalog={catalog}
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
