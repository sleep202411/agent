/**
 * Local fallback model used only when `/aurora/foundry/models` is not
 * reachable in development. Keep this intentionally close to the server
 * factory so the schema renderer does not need a separate demo path.
 */

import type {
  FoundryAvailability,
  FoundryCapabilityMatrix,
  FoundryCostEstimate,
  FoundryDocumentationLink,
  FoundryObjectSchema,
  FoundryObservabilityContract,
  FoundryPreflightEstimator,
  FoundryProviderBinding,
} from "@repo/shared";

/** Mirror of AiAccessDecision from the server. */
export interface AiAccess {
  allowed: boolean;
  reason?: "membership_required" | "membership_expired" | "denied";
  requiredTier?: string | null;
}

export interface AiModel {
  id: string;
  type: "image" | "video";
  name: string;
  description: string;
  enabled: boolean;
  disabledReason?: string;
  schemaDialect: string;
  schemaVersion: string;
  documentation: FoundryDocumentationLink[];
  capability_matrix: FoundryCapabilityMatrix;
  availability: FoundryAvailability;
  cost_estimate: FoundryCostEstimate;
  preflight_estimator?: FoundryPreflightEstimator;
  observability: FoundryObservabilityContract;
  input_schema: FoundryObjectSchema;
  output_schema: FoundryObjectSchema;
  provider_binding?: FoundryProviderBinding;
  /**
   * Server-resolved tier gating decision for the current user. Server
   * is the source of truth; UI only mirrors it for lock badges and to
   * pre-empt obviously-blocked submits. Undefined when running in
   * fallback / preview mode (no backend).
   */
  access?: AiAccess;
}

function mediaReferenceSchema(title: string): FoundryObjectSchema {
  return {
    type: "object",
    title,
    required: ["url"],
    additionalProperties: false,
    properties: {
      url: {
        type: "string",
        title,
        titleKey: "foundry.schema.media.url.title",
        format: "uri",
      },
      mimeType: {
        type: "string",
        title: "MIME type",
        titleKey: "foundry.schema.media.mimeType.title",
      },
      name: {
        type: "string",
        title: "File name",
        titleKey: "foundry.schema.media.name.title",
      },
      bytes: {
        type: "integer",
        title: "Bytes",
        titleKey: "foundry.schema.media.bytes.title",
        minimum: 0,
      },
    },
  };
}

const GPT_IMAGE_2_DOCS: FoundryDocumentationLink[] = [
  {
    title: "GPT Image 2 model",
    url: "https://developers.openai.com/api/docs/models/gpt-image-2",
    source: "official",
    scope: "model",
    provider: "openai",
  },
  {
    title: "Image generation guide",
    url: "https://developers.openai.com/api/docs/guides/image-generation",
    source: "official",
    scope: "guide",
    provider: "openai",
  },
  {
    title: "Images API reference",
    url: "https://developers.openai.com/api/reference/resources/images/methods/generate",
    source: "official",
    scope: "api_reference",
    provider: "openai",
  },
];

const GPT_IMAGE_2_MATRIX: FoundryCapabilityMatrix = {
  source: "official",
  inputModalities: ["text", "image"],
  outputModalities: ["image"],
  generationModes: ["text_to_image", "image_to_image"],
  supportedParameters: [
    "prompt",
    "size",
    "quality",
    "n",
    "reference_images",
    "background",
    "output_format",
    "output_compression",
    "moderation",
    "stream",
    "partial_images",
  ],
  unsupportedParameters: ["response_format", "input_fidelity", "seed"],
  features: {
    customSize: true,
    streaming: true,
    transparentBackground: false,
    revisedPrompt: false,
    providerUrlOutput: false,
    base64Output: true,
    highFidelityImageInput: true,
    cancel: false,
  },
  limits: {
    maxOutputs: 10,
    maxReferenceImages: 16,
    maxPartialImages: 3,
    maxPromptCharacters: 32000,
    sizeMultipleOf: 16,
    maxEdgePixels: 3840,
    minOutputPixels: 655360,
    maxOutputPixels: 8294400,
    maxAspectRatio: "3:1",
  },
};

const GPT_IMAGE_2_INPUT: FoundryObjectSchema = {
  type: "object",
  required: ["prompt"],
  additionalProperties: false,
  "x-ui": {
    groups: [
      {
        id: "prompt",
        title: "Prompt",
        titleKey: "foundry.schema.group.prompt.title",
        order: 10,
      },
      {
        id: "generation",
        title: "Generation",
        titleKey: "foundry.schema.group.generation.title",
        order: 20,
      },
      {
        id: "references",
        title: "References",
        titleKey: "foundry.schema.group.references.title",
        order: 30,
        collapsible: true,
      },
      {
        id: "output",
        title: "Output",
        titleKey: "foundry.schema.group.output.title",
        order: 40,
        collapsible: true,
        defaultCollapsed: true,
      },
      {
        id: "advanced",
        title: "Advanced",
        titleKey: "foundry.schema.group.advanced.title",
        order: 90,
        collapsible: true,
        defaultCollapsed: true,
      },
    ],
  },
  "x-rules": [
    {
      id: "compression-requires-lossy-format",
      when: {
        field: "output_format",
        operator: "notIn",
        values: ["jpeg", "webp"],
      },
      effect: "forbid",
      fields: ["output_compression"],
      message: "Compression is only supported when Output format is jpeg or webp.",
    },
    {
      id: "partial-images-require-stream",
      when: { field: "stream", operator: "notEquals", value: true },
      effect: "forbid",
      fields: ["partial_images"],
      message: "Partial images can only be requested when streaming is enabled.",
    },
  ],
  properties: {
    prompt: {
      type: "string",
      title: "Prompt",
      titleKey: "foundry.schema.field.prompt.title",
      maxLength: 32000,
      description: "Text description of the desired image or image edit.",
      descriptionKey: "foundry.gptImage2.prompt.description",
      "x-ui": {
        control: "textarea",
        group: "prompt",
        importance: "primary",
        order: 10,
        rows: 7,
        labelKey: "foundry.schema.field.prompt.label",
      },
      "x-provider": { parameter: "prompt" },
    },
    aspect_ratio: {
      type: "string",
      title: "Aspect ratio",
      titleKey: "foundry.schema.field.aspectRatio.title",
      enum: ["1:1", "3:2", "2:3", "16:9", "9:16", "4:3", "3:4"],
      default: "1:1",
      "x-ui": {
        control: "select",
        group: "generation",
        importance: "primary",
        order: 20,
        options: [
          { value: "1:1", label: "1:1" },
          { value: "3:2", label: "3:2" },
          { value: "2:3", label: "2:3" },
          { value: "16:9", label: "16:9" },
          { value: "9:16", label: "9:16" },
          { value: "4:3", label: "4:3" },
          { value: "3:4", label: "3:4" },
        ],
        labelKey: "foundry.schema.field.aspectRatio.label",
      },
    },
    resolution_tier: {
      type: "string",
      title: "Resolution",
      titleKey: "foundry.schema.field.resolutionTier.title",
      enum: ["hd", "fhd", "uhd"],
      default: "hd",
      "x-ui": {
        control: "segmented",
        group: "generation",
        importance: "primary",
        order: 25,
        options: [
          { value: "hd", label: "HD", tier: null },
          { value: "fhd", label: "FHD", tier: "VIP1" },
          { value: "uhd", label: "4K", tier: "VIP2" },
        ],
        labelKey: "foundry.schema.field.resolutionTier.label",
      },
    },
    quality: {
      type: "string",
      title: "Quality",
      titleKey: "foundry.schema.field.quality.title",
      enum: ["auto", "low", "medium", "high"],
      default: "auto",
      "x-ui": {
        control: "segmented",
        group: "generation",
        importance: "primary",
        order: 30,
        labelKey: "foundry.schema.field.quality.label",
      },
    },
    n: {
      type: "integer",
      title: "Outputs",
      titleKey: "foundry.schema.field.outputs.title",
      minimum: 1,
      maximum: 10,
      default: 1,
      "x-ui": {
        control: "stepper",
        group: "generation",
        importance: "primary",
        order: 40,
        labelKey: "foundry.schema.field.outputs.label",
      },
    },
    reference_images: {
      type: "array",
      title: "Reference images",
      titleKey: "foundry.schema.field.referenceImages.title",
      description:
        "Input images for edit/reference workflows. GPT Image 2 accepts up to 16 input images.",
      descriptionKey: "foundry.gptImage2.referenceImages.description",
      items: mediaReferenceSchema("Reference image URL"),
      maxItems: 16,
      "x-ui": {
        control: "image_upload",
        group: "references",
        importance: "secondary",
        order: 50,
        accept: "image/jpeg,image/png,image/webp",
        labelKey: "foundry.schema.field.referenceImages.label",
      },
    },
    background: {
      type: "string",
      title: "Background",
      titleKey: "foundry.schema.field.background.title",
      description:
        "GPT Image 2 currently supports automatic or opaque backgrounds; transparent output is not supported.",
      descriptionKey: "foundry.gptImage2.background.description",
      enum: ["auto", "opaque"],
      default: "auto",
      "x-ui": {
        control: "segmented",
        group: "output",
        importance: "advanced",
        order: 60,
        labelKey: "foundry.schema.field.background.label",
      },
    },
    output_format: {
      type: "string",
      title: "Output format",
      titleKey: "foundry.schema.field.outputFormat.title",
      enum: ["png", "jpeg", "webp"],
      default: "png",
      "x-ui": {
        control: "segmented",
        group: "output",
        importance: "secondary",
        order: 70,
        labelKey: "foundry.schema.field.outputFormat.label",
      },
    },
    output_compression: {
      type: "integer",
      title: "Compression",
      titleKey: "foundry.schema.field.outputCompression.title",
      description: "Compression level for jpeg or webp output.",
      descriptionKey: "foundry.schema.field.outputCompression.description",
      minimum: 0,
      maximum: 100,
      "x-ui": {
        control: "slider",
        group: "output",
        importance: "advanced",
        order: 80,
        labelKey: "foundry.schema.field.outputCompression.label",
        showWhen: {
          field: "output_format",
          operator: "in",
          values: ["jpeg", "webp"],
        },
        enabledWhen: {
          field: "output_format",
          operator: "in",
          values: ["jpeg", "webp"],
        },
      },
    },
    moderation: {
      type: "string",
      title: "Moderation",
      titleKey: "foundry.schema.field.moderation.title",
      enum: ["auto", "low"],
      default: "auto",
      "x-ui": {
        control: "segmented",
        group: "advanced",
        importance: "advanced",
        order: 90,
        labelKey: "foundry.schema.field.moderation.label",
      },
    },
    stream: {
      type: "boolean",
      title: "Stream partial images",
      titleKey: "foundry.schema.field.stream.title",
      default: false,
      "x-ui": {
        control: "switch",
        group: "advanced",
        importance: "advanced",
        order: 100,
        labelKey: "foundry.schema.field.stream.label",
      },
    },
    partial_images: {
      type: "integer",
      title: "Partial images",
      titleKey: "foundry.schema.field.partialImages.title",
      description: "Number of partial images to request for streaming.",
      descriptionKey: "foundry.schema.field.partialImages.description",
      minimum: 0,
      maximum: 3,
      "x-ui": {
        control: "stepper",
        group: "advanced",
        importance: "advanced",
        order: 110,
        labelKey: "foundry.schema.field.partialImages.label",
        showWhen: { field: "stream", operator: "equals", value: true },
        enabledWhen: { field: "stream", operator: "equals", value: true },
      },
    },
  },
};

const GPT_IMAGE_2_ESTIMATOR: FoundryPreflightEstimator = {
  kind: "token_heuristic",
  label: "Estimated credits",
  labelKey: "foundry.schema.preflight.estimatedCredits",
  confidence: "low",
  currency: "CREDITS",
  promptField: "prompt",
  sizeField: "size",
  qualityField: "quality",
  countField: "n",
  referenceImagesField: "reference_images",
  charsPerTextToken: 4,
  minTextTokens: 16,
  imageInputTokensPerReference: 512,
  defaultSize: "1024x1024",
  autoSize: "1024x1024",
  defaultQuality: "auto",
  defaultCount: 1,
  baseOutputTokens: 1024,
  outputTokensPerMegapixel: 2048,
  qualityMultipliers: { auto: 1.15, low: 0.65, medium: 1, high: 1.6 },
  inputCostPerMillion: 1000,
  outputCostPerMillion: 6500,
  minimumAmount: 24,
  rounding: "ceil",
  notes: [
    "Heuristic only. GPT Image 2 authoritative token usage is available after provider execution.",
  ],
};

export const MOCK_AI_MODEL: AiModel = {
  id: "foundry/gpt-image-2",
  type: "image",
  name: "GPT Image 2",
  description: "High-fidelity image generation and reference-guided editing.",
  enabled: true,
  schemaDialect: "https://fizzdragon.com/schemas/foundry/model/v1",
  schemaVersion: "2026-05-16",
  documentation: GPT_IMAGE_2_DOCS,
  capability_matrix: GPT_IMAGE_2_MATRIX,
  availability: {
    currentRegion: "global",
    regions: [
      {
        region: "global",
        status: "available",
      },
    ],
  },
  cost_estimate: {
    billingMode: "token",
    currency: "USD",
    meters: [
      {
        meter: "text_input_tokens",
        unit: "token",
        usagePath: "usage.input_tokens_details.text_tokens",
      },
      {
        meter: "image_input_tokens",
        unit: "token",
        usagePath: "usage.input_tokens_details.image_tokens",
      },
      {
        meter: "image_output_tokens",
        unit: "token",
        usagePath: "usage.output_tokens_details.image_tokens",
      },
    ],
    pricingUrl: "https://platform.openai.com/pricing",
    calculatorUrl: "https://platform.openai.com/tokenizer?view=image",
    supportsPreflightEstimate: false,
    finalCostSource: "provider_usage",
  },
  preflight_estimator: GPT_IMAGE_2_ESTIMATOR,
  observability: {
    requestId: {
      jobField: "id",
      inboundHeader: "x-request-id",
      outboundHeader: "x-request-id",
      providerResponseHeader: "x-request-id",
    },
    logging: {
      events: [],
      redactInputFields: ["prompt", "reference_images"],
      redactProviderFields: ["b64_json", "image", "mask"],
    },
    metrics: [],
  },
  input_schema: GPT_IMAGE_2_INPUT,
  output_schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      images: {
        type: "array",
        title: "Images",
        titleKey: "foundry.schema.output.images.title",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["url"],
          properties: {
            url: { type: "string", title: "URL", format: "uri" },
          },
        },
      },
    },
  },
  provider_binding: {
    provider: "openai-compatible-images",
    endpoint: "images.generate",
    apiVersion: "v1",
    requestContentType: "multipart/form-data",
    operationSelector: {
      field: "reference_images",
      emptyEndpoint: "images.generate",
      presentEndpoint: "images.edit",
    },
    passthroughUserId: true,
  },
  // Preview / offline fallback assumes access; real backend always
  // overwrites this with a fresh decision keyed to the current user.
  access: { allowed: true, requiredTier: null },
};
