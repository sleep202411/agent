# Foundry Model Schema v1

Foundry model schemas are the product contract between model discovery,
automatic UI rendering, validation, queue submission, and provider execution.
The frontend renders from this contract only. Provider-specific request shapes
are owned by backend adapters.

## Goals

- Add models by shipping schema + provider binding, not custom frontend code.
- Keep product inputs stable even when provider parameter names differ.
- Use JSON Schema semantics for validation wherever possible.
- Use `x-*` extensions for FizzDragon UI and provider adapter metadata.
- Keep provider output and product output separate so OSS storage remains the
  durable public result.

## Model Contract

```ts
interface FoundryModelDefinition {
  id: string;
  provider: "microsoft-foundry";
  deployment: string;
  modelName: string;
  capability: "image_generation" | "video_generation";
  type: "image" | "video";
  enabled: boolean;
  schemaDialect: "https://fizzdragon.com/schemas/foundry/model/v1";
  schemaVersion: string;
  documentation: FoundryDocumentationLink[];
  capability_matrix: FoundryCapabilityMatrix;
  availability: FoundryAvailability;
  cost_estimate: FoundryCostEstimate;
  preflight_estimator?: FoundryPreflightEstimator;
  observability: FoundryObservabilityContract;
  capabilities: FoundryCapabilities;
  queue: FoundryQueuePolicy;
  input_schema: FoundryObjectSchema;
  output_schema: FoundryObjectSchema;
  provider_output_schema?: FoundryObjectSchema;
  stream_event_schema?: FoundryObjectSchema;
  provider_binding: FoundryProviderBinding;
}
```

## Documentation Links

Every model schema can carry source documentation. Use this for official model
docs, API references, pricing pages, changelogs, and internal implementation
notes. These links are model metadata, not UI hints, so any renderer or admin
tool can expose them consistently.

```ts
interface FoundryDocumentationLink {
  title: string;
  url: string;
  source: "official" | "provider" | "internal";
  scope:
    | "model"
    | "input_schema"
    | "output_schema"
    | "api_reference"
    | "guide"
    | "pricing"
    | "safety"
    | "changelog";
  provider?: string;
  retrievedAt?: string;
}
```

For provider-derived schemas, include at least one `official` or `provider`
documentation link whenever the source exposes public docs.

## Capability Matrix

`capability_matrix` is the authoritative model-level capability record. Do not
infer known model behavior from display names or hint strings. Hint-based
inference is allowed only for unknown catalog records and must mark
`source: "inferred"`.

```ts
interface FoundryCapabilityMatrix {
  source: "official" | "provider" | "internal" | "inferred";
  inputModalities: ("text" | "image" | "video" | "audio" | "document" | "file")[];
  outputModalities: ("text" | "image" | "video" | "audio" | "document" | "file")[];
  generationModes: (
    | "text_to_image"
    | "image_to_image"
    | "inpainting"
    | "text_to_video"
    | "image_to_video"
    | "video_to_video"
  )[];
  supportedParameters: string[];
  unsupportedParameters: string[];
  features: Record<string, boolean>;
  limits: Record<string, number | string | boolean>;
}
```

The older flat `capabilities` object exists for backwards-compatible clients;
new renderers and adapters should read `capability_matrix`.

## Availability

`availability` models region-level deployability and current-region status.
This is required because `global` and `cn` deployments use separate credentials,
providers, OSS buckets, and sometimes model availability.

```ts
interface FoundryAvailability {
  currentRegion: "global" | "cn" | string;
  regions: Array<{
    region: "global" | "cn" | string;
    status: "available" | "unavailable" | "requires_configuration" | "unknown";
    reason?: string;
    endpointEnvVars?: string[];
  }>;
}
```

## Cost Estimate

`cost_estimate` describes how cost should be estimated or finalized. It does
not need to invent prices when the provider only exposes usage after the call.
For token-billed image models, preflight estimates may be unavailable while
final cost comes from provider usage.

`supportsPreflightEstimate` means authoritative/provider-backed preflight is
available. UI-only chips such as "Generate +24" use `preflight_estimator`
instead, because those are deliberately heuristic and pessimistic.

```ts
interface FoundryCostEstimate {
  billingMode: "token" | "duration" | "request" | "credit" | "unknown";
  currency: "USD" | "CNY" | "CREDITS" | string;
  meters: Array<{
    meter:
      | "text_input_tokens"
      | "image_input_tokens"
      | "cached_input_tokens"
      | "image_output_tokens"
      | "video_seconds"
      | "request"
      | "credit";
    unit: "token" | "second" | "request" | "credit";
    pricePerMillionUsd?: number;
    pricePerUnitUsd?: number;
    usagePath?: string;
  }>;
  pricingUrl?: string;
  calculatorUrl?: string;
  supportsPreflightEstimate: boolean;
  finalCostSource: "provider_usage" | "internal_metering" | "fixed_table" | "unknown";
}
```

```ts
interface FoundryTokenHeuristicEstimator {
  kind: "token_heuristic";
  confidence: "low" | "medium" | "high";
  currency: "USD" | "CNY" | "CREDITS" | string;
  promptField: string;
  sizeField?: string;
  qualityField?: string;
  countField?: string;
  referenceImagesField?: string;
  charsPerTextToken: number;
  minTextTokens: number;
  imageInputTokensPerReference?: number;
  defaultSize: string;
  autoSize?: string;
  defaultQuality?: string;
  defaultCount?: number;
  baseOutputTokens: number;
  outputTokensPerMegapixel: number;
  qualityMultipliers: Record<string, number>;
  inputCostPerMillion?: number;
  outputCostPerMillion?: number;
  minimumAmount?: number;
  rounding?: "ceil" | "round" | "floor";
}
```

Schemas expose estimator configuration only. Renderers call the shared
`estimateFoundryPreflightCost()` helper rather than evaluating code shipped by
the API.

## JSON Schema Subset

`input_schema` and `output_schema` are object schemas. Supported field types:

- `string`
- `integer`
- `number`
- `boolean`
- `array`
- `object`

Supported standard keywords:

- `title`, `description`, `default`, `examples`
- `required`, `properties`, `additionalProperties`
- `enum`, `const`
- `format`, `pattern`, `minLength`, `maxLength`
- `minimum`, `maximum`, `exclusiveMinimum`, `exclusiveMaximum`, `multipleOf`
- `items`, `minItems`, `maxItems`, `uniqueItems`

## UI Extension

Use `x-ui` for rendering. It never maps directly to provider requests.

Object-level `x-ui` defines groups:

```json
{
  "x-ui": {
    "groups": [
      { "id": "prompt", "title": "Prompt", "order": 10 },
      { "id": "advanced", "title": "Advanced", "order": 90, "collapsible": true }
    ]
  }
}
```

Field-level `x-ui` defines controls:

```json
{
  "type": "integer",
  "title": "Outputs",
  "minimum": 1,
  "maximum": 10,
  "default": 1,
  "x-ui": {
    "control": "stepper",
    "group": "generation",
    "importance": "primary",
    "order": 40
  }
}
```

Supported controls include:

- `text`, `textarea`
- `select`, `segmented`, `radio`
- `checkbox`, `switch`
- `slider`, `stepper`
- `media_upload`, `image_upload`, `video_upload`, `audio_upload`
- `color`, `hidden`

Conditional UI uses the same condition expression format as validation rules:

```json
{
  "x-ui": {
    "visibleWhen": {
      "field": "output_format",
      "operator": "in",
      "values": ["jpeg", "webp"]
    }
  }
}
```

The three condition fields have distinct renderer semantics:

- `visibleWhen`: structural visibility. False means do not mount the field; it
  may affect layout and validation UI.
- `showWhen`: presentation visibility. False means the field may remain mounted
  and keep its value, but is visually collapsed or hidden.
- `enabledWhen`: interaction state. False means the field remains visible but
  is disabled/read-only.

## Rules Extension

Use object-level `x-rules` for cross-field behavior that plain field schemas
cannot express ergonomically.

```json
{
  "x-rules": [
    {
      "id": "compression-requires-lossy-format",
      "when": {
        "field": "output_format",
        "operator": "notIn",
        "values": ["jpeg", "webp"]
      },
      "effect": "forbid",
      "fields": ["output_compression"],
      "message": "Compression is only supported when Output format is jpeg or webp."
    }
  ]
}
```

Supported effects:

- `require`
- `forbid`
- `clear`
- `setDefault`

Supported condition operators:

- `equals`, `notEquals`
- `in`, `notIn`
- `exists`, `empty`
- `gt`, `gte`, `lt`, `lte`

Conditions can be composed with `all`, `any`, and `not`.

## Constraint Extension

Use `x-constraints` for reusable product-level validators that are too specific
for generic JSON Schema.

Current constraints:

```json
{
  "kind": "dimension2d",
  "allowAuto": true,
  "multipleOf": 16,
  "minPixels": 655360,
  "maxPixels": 8294400,
  "maxEdge": 3840,
  "maxAspectRatio": 3
}
```

This lets the frontend show good validation before submit while the backend
remains the source of truth.

## Provider Binding

`provider_binding` describes the default backend adapter target. Field-level
`x-provider` describes how product fields map to provider parameters.

```json
{
  "provider_binding": {
    "provider": "openai-compatible-images",
    "endpoint": "images.generate",
    "apiVersion": "v1",
    "requestContentType": "multipart/form-data",
    "operationSelector": {
      "field": "reference_images",
      "emptyEndpoint": "images.generate",
      "presentEndpoint": "images.edit"
    },
    "passthroughUserId": true
  }
}
```

Field binding:

```json
{
  "x-provider": {
    "parameter": "image",
    "transform": "mediaArrayToOpenAIImageInput",
    "omitIfEmpty": true
  }
}
```

Provider binding is backend-only. Frontend renderers must not special-case
provider names or endpoint names.

## Output Schema

`output_schema` describes product outputs after FizzDragon has persisted media
to OSS. Provider raw responses belong in `provider_metadata`.

```json
{
  "images": {
    "type": "array",
    "x-output": { "control": "image_gallery", "group": "media", "order": 10 },
    "items": {
      "type": "object",
      "required": ["url", "storagePath"],
      "properties": {
        "url": { "type": "string", "format": "uri" },
        "storagePath": { "type": "string" },
        "width": { "type": "integer" },
        "height": { "type": "integer" },
        "mimeType": { "type": "string" }
      }
    }
  }
}
```

`provider_output_schema` describes raw provider responses before product
normalization. For OpenAI image models this includes `b64_json`,
`revised_prompt`, `url`, and `usage`.

`stream_event_schema` describes provider streaming events. For OpenAI image
generation this includes `image_generation.partial_image` and
`image_generation.completed`.

## I18n

Every user-visible schema label should include an i18n key while retaining
English fallback text for tooling and debugging.

Supported key fields:

- Schema fields: `titleKey`, `descriptionKey`
- UI fields: `labelKey`, `placeholderKey`, `hintKey`
- UI groups: `titleKey`, `descriptionKey`
- Output UI: `labelKey`, `emptyStateKey`

Frontend renderers must prefer localized strings from message files and fall
back to the inline English text only when a translation is missing.

## Observability

`observability` defines the request ID, logging, redaction, and metrics contract
for a model. Workers should use it when emitting logs and metrics.

```ts
interface FoundryObservabilityContract {
  requestId: {
    jobField: string;
    inboundHeader?: string;
    outboundHeader?: string;
    providerResponseHeader?: string;
  };
  logging: {
    events: string[];
    redactInputFields: string[];
    redactProviderFields: string[];
  };
  metrics: Array<{
    name: string;
    unit: "ms" | "count" | "ratio" | "tokens" | "bytes";
    description?: string;
  }>;
}
```

## GPT Image 2 Policy

The `gpt-image-2` product schema intentionally omits provider parameters that
are unsupported or not stable for the model:

- `response_format`: GPT image models return base64 by default.
- `input_fidelity`: GPT Image 2 handles image inputs at high fidelity.
- `background=transparent`: GPT Image 2 currently supports automatic/opaque
  output only.
- `seed`: not exposed unless a provider contract explicitly supports it.

Provider-specific request conversion must live in an adapter, not in frontend
rendering code.
