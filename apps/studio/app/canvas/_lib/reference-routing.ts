import { defaultMode, referenceFieldsForMode, type FizzAiModel } from "./generation-api";

/**
 * Shared reference-field routing for the canvas — used both when a wire is
 * drawn (`onConnect`) and when an upstream node finishes generating (the
 * completion back-fill). Keeping one implementation means wire-time and
 * generate-time agree on which input slot a source binds to.
 *
 * Pure (no React Flow / catalog lookups): callers pass the resolved target
 * model + its current mode + its existing references.
 */

/** Map a generated output's media type to the reference `kind` it satisfies. */
export function outputKindForType(type: string | undefined): "image" | "video" | "audio" | null {
  if (type === "image") return "image";
  if (type === "video") return "video";
  if (type === "audio") return "audio";
  return null;
}

/**
 * Capability check: does this model accept a reference of `kind` in ANY of its
 * generation modes? Unlike {@link routeReferenceField} this ignores current
 * slot fullness — it answers "could a wire of this type ever bind here", which
 * the add-node menu gates on (a video can never feed an image-only model).
 */
export function modelAcceptsKind(model: FizzAiModel | undefined, kind: string): boolean {
  if (!model) return false;
  for (const mode of model.generationModes ?? []) {
    if (referenceFieldsForMode(model, mode).some((f) => f.kind === kind)) {
      return true;
    }
  }
  return false;
}

/**
 * Choose the reference field on a target generation card for an incoming
 * `kind`, switching the card's mode when the current mode has no free slot for
 * it (mirrors how dropping an image into a text-to-video card flips it to
 * image-to-video). Returns the field and, if a switch is needed, the new mode.
 */
export function routeReferenceField(
  model: FizzAiModel | undefined,
  currentMode: string | undefined,
  references: Record<string, readonly unknown[] | undefined> | undefined,
  kind: string
): { mode?: string; field: string } | undefined {
  if (!model) return undefined;
  const mode = currentMode ?? defaultMode(model);
  const refs = references ?? {};
  const inCurrent = referenceFieldsForMode(model, mode).find(
    (f) => f.kind === kind && (refs[f.field]?.length ?? 0) < f.maxItems
  );
  if (inCurrent) return { field: inCurrent.field };
  for (const m of model.generationModes ?? []) {
    const f = referenceFieldsForMode(model, m).find(
      (ff) => ff.kind === kind && (refs[ff.field]?.length ?? 0) < ff.maxItems
    );
    if (f) return { mode: m, field: f.field };
  }
  return undefined;
}
