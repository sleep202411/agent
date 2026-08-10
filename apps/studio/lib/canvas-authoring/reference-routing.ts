import {
  defaultMode,
  referenceFieldsForMode,
  type FizzAiModel,
  type FizzAiReferenceKind,
} from "./generation-api";

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

export type ReferenceRoutingIssue =
  | { code: "model_unavailable" }
  | {
      code: "current_mode_unsupported";
      kind: FizzAiReferenceKind;
    }
  | { code: "unsupported_kind"; kind: FizzAiReferenceKind }
  | {
      code: "reference_limit";
      kind: FizzAiReferenceKind;
      limit: number;
    };

export type ReferenceRoutingResult =
  | { ok: true; field: string }
  | { ok: false; issue: ReferenceRoutingIssue };

/**
 * Validate and choose a field in the card's CURRENT mode only.
 *
 * `reservedCount` represents valid incoming wires whose source has not produced
 * a durable URL yet. Those wires still own capacity: otherwise ten unfinished
 * image nodes could all be connected to a nine-image slot and the last wire
 * would become an orphan when generation completed.
 */
export function evaluateReferenceField(
  model: FizzAiModel | undefined,
  currentMode: string | undefined,
  references: Record<string, readonly unknown[] | undefined> | undefined,
  kind: FizzAiReferenceKind,
  reservedCount = 0
): ReferenceRoutingResult {
  if (!model) return { ok: false, issue: { code: "model_unavailable" } };

  const mode = currentMode ?? defaultMode(model);
  const fields = referenceFieldsForMode(model, mode);
  const matching = fields.filter((field) => field.kind === kind);
  if (matching.length === 0) {
    return modelAcceptsKind(model, kind)
      ? { ok: false, issue: { code: "current_mode_unsupported", kind } }
      : { ok: false, issue: { code: "unsupported_kind", kind } };
  }

  const refs = references ?? {};
  let reservations = Math.max(0, Math.floor(reservedCount));
  for (const field of matching) {
    const boundCount = refs[field.field]?.length ?? 0;
    const available = Math.max(0, field.maxItems - boundCount);
    if (reservations < available) return { ok: true, field: field.field };
    reservations -= available;
  }

  return {
    ok: false,
    issue: {
      code: "reference_limit",
      kind,
      limit: matching.reduce((sum, field) => sum + field.maxItems, 0),
    },
  };
}

/**
 * Choose a reference field on the target card's current mode. Connecting a
 * wire never changes the selected mode: an unsupported kind or a full slot is
 * rejected so the user's explicit model settings remain stable.
 */
export function routeReferenceField(
  model: FizzAiModel | undefined,
  currentMode: string | undefined,
  references: Record<string, readonly unknown[] | undefined> | undefined,
  kind: FizzAiReferenceKind,
  reservedCount = 0
): { field: string } | undefined {
  const result = evaluateReferenceField(model, currentMode, references, kind, reservedCount);
  return result.ok ? { field: result.field } : undefined;
}
