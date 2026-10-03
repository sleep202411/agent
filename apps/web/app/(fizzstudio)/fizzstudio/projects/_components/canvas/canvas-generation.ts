import {
  isFizzAiModelUsable,
  type FizzAiCatalog,
  type FizzAiJobType,
  type FizzAiModel,
  type ModelSettings,
} from "../../../../_lib/generation-api";

type FizzAiSchemaProperty = NonNullable<FizzAiModel["input_schema"]["properties"]>[string];

export type CanvasGenerationDraft = {
  schemaVersion?: string;
  prompt: string;
  modelId: string;
  settings: ModelSettings;
  referenceField: string;
};

export type CanvasGenerationRequest = {
  modelId: string;
  schemaVersion: string;
  input: Record<string, unknown>;
};

export function canvasImageReferenceFields(model: FizzAiModel | undefined) {
  return Object.entries(model?.input_schema.properties ?? {}).filter(
    ([name, prop]) =>
      prop["x-ui"]?.mediaKind === "image" ||
      ["referenceImages", "startFrame", "endFrame", "input_reference"].includes(name)
  );
}

function referenceValue(prop: FizzAiSchemaProperty, url: string): unknown {
  if (prop.type === "array") return [referenceValue(prop.items ?? { type: "object" }, url)];
  return prop.type === "string" ? url : { url };
}

export function canvasGenerationInput(
  model: FizzAiModel,
  draft: CanvasGenerationDraft,
  referenceUrl?: string
) {
  const input: Record<string, unknown> = { ...draft.settings, prompt: draft.prompt.trim() };
  if (draft.referenceField) {
    const prop = canvasImageReferenceFields(model).find(
      ([name]) => name === draft.referenceField
    )?.[1];
    if (prop && referenceUrl) input[draft.referenceField] = referenceValue(prop, referenceUrl);
  }
  return input;
}

/** Revalidate the exact reviewed model before a charged command; never fall back. */
export function currentCanvasGenerationModel(
  catalog: FizzAiCatalog,
  type: FizzAiJobType,
  request: CanvasGenerationRequest
): FizzAiModel | null {
  return (
    catalog.models.find(
      (model) =>
        model.id === request.modelId &&
        model.type === type &&
        isFizzAiModelUsable(model) &&
        model.schemaVersion === request.schemaVersion
    ) ?? null
  );
}

/** Keep obsolete saved settings visible as errors instead of silently dropping them. */
export function invalidCanvasGenerationFields(
  model: FizzAiModel,
  input: Record<string, unknown>
): string[] {
  const props = model.input_schema.properties ?? {};
  const invalid = new Set<string>();
  for (const field of model.input_schema.required ?? []) {
    const value = input[field];
    if (
      value === undefined ||
      value === null ||
      value === "" ||
      (Array.isArray(value) && value.length === 0)
    )
      invalid.add(field);
  }
  for (const [name, value] of Object.entries(input)) {
    const prop = props[name];
    if (!prop) {
      if (model.input_schema.additionalProperties !== true) invalid.add(name);
      continue;
    }
    if (prop.enum && !prop.enum.includes(value)) invalid.add(name);
    if (
      (prop.type === "integer" || prop.type === "number") &&
      (typeof value !== "number" ||
        !Number.isFinite(value) ||
        (prop.type === "integer" && !Number.isInteger(value)) ||
        (prop.minimum !== undefined && value < prop.minimum) ||
        (prop.maximum !== undefined && value > prop.maximum))
    )
      invalid.add(name);
    if (prop.type === "boolean" && typeof value !== "boolean") invalid.add(name);
    if (
      prop.type === "string" &&
      (typeof value !== "string" || (prop.maxLength !== undefined && value.length > prop.maxLength))
    )
      invalid.add(name);
  }
  return [...invalid];
}
