"use client";

/**
 * 1:1 replica preview of imagine.art's model selector panel.
 *
 * Evaluation-only: this page exists so the imagine.art picker UI can be seen
 * against real catalog data before deciding what (if anything) to fold back
 * into the studio's real `ModelPicker`. It deliberately ignores DESIGN.md.
 *
 * Open at /<locale>/dev/model-picker-preview.
 */

import { useState } from "react";
import { ImagineModelPickerConnected } from "@/components/canvas/authoring/imagine-model-picker";
import type { FizzAiModel } from "@/lib/canvas-authoring/generation-api";

export default function ModelPickerPreviewPage() {
  const [modality, setModality] = useState<"image" | "video">("image");
  const [selected, setSelected] = useState<FizzAiModel | undefined>(undefined);

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-8 bg-background p-8">
      <div className="flex flex-col items-center gap-2 text-center">
        <h1 className="text-lg font-semibold text-foreground">imagine.art Model Picker — 1:1 replica</h1>
        <p className="max-w-md text-sm text-muted-foreground">
          Evaluation artifact. Real catalog data, transplanted UI. Not the studio
          design language.
        </p>
        <div className="mt-2 flex gap-2">
          {(["image", "video"] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => {
                setModality(m);
                setSelected(undefined);
              }}
              className={
                "rounded-md border border-border px-3 py-1.5 text-sm " +
                (modality === m ? "bg-foreground text-background" : "text-muted-foreground")
              }
            >
              {m}
            </button>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">
          selected: {selected ? selected.name : "—"}
        </p>
      </div>

      <ImagineModelPickerConnected
        modality={modality}
        selectedId={selected?.id}
        onSelect={setSelected}
      />
    </main>
  );
}
