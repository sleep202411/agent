# AI Model Protocol v1

This is the product contract between FizzDragon UI, NestJS AI Job, provider
adapters, billing, queueing, and observability.

Provider names such as Microsoft Foundry, fal.ai, Replicate, DashScope, or a
self-hosted model are implementation details. Product UI must render from this
protocol and submit through AI Job. It must not branch on provider-native
payloads.

## Goals

- Add or remove providers without rewriting Art Studio pages.
- Keep model form fields stable even when provider parameter names differ.
- Validate model input before queue submission and again before provider calls.
- Freeze routing, quota, membership, campaign, and queue decisions per job.
- Store durable OSS/Azure output URLs, never provider-expiring URLs.
- Support simple product presets and advanced direct-model mode.

## Public Catalog

`GET /aurora/ai/models` returns a catalog envelope:

```ts
interface AiModelCatalogResponse {
  dialect: "https://fizzdragon.com/schemas/ai/model/v1";
  version: string;
  region: string;
  context?: AiCatalogContext;
  presets: AiModelPresetDefinition[];
  models: AiModelDefinition[];
  campaigns?: AiCampaignPolicy[];
}
```

The current endpoint keeps backward compatibility by still including `models`
at the same location. New clients should read the envelope fields first.

`context` is the sanitized request geo context used to build this catalog. It
does not need to expose raw IP:

```ts
interface AiCatalogContext {
  cell: string; // cn, com, global, future global-azure-sg/eu/us
  country: string; // CN, US, SG, DE...
  ip?: {
    country?: string;
    region?: string;
    city?: string;
    source?: "cdn" | "proxy" | "maxmind" | "manual" | "unknown" | string;
    confidence?: "high" | "medium" | "low" | string;
  };
}
```

Model, preset, billing, subscription, and payment policy should consume the
same server-side `GeoContext`. Do not re-parse CDN/IP headers inside individual
modules.

## Model Definition

`AiModelDefinition` is the provider-neutral model contract.

Required responsibilities:

- `family` is the coarse product family: image, video, audio, text, or
  multimodal.
- `generationModes` is the concrete interaction capability, such as
  `text_to_image`, `image_to_image`, `text_to_video`,
  `first_last_frame_to_video`, or `video_to_video`.
- `capability_matrix` describes what the model can actually do.
- `input_schema` drives UI rendering and client-side validation.
- `output_schema` describes normalized FizzDragon outputs.
- `provider_output_schema` describes raw provider output before normalization.
- `provider_binding` is backend-only metadata used by provider adapters.
- `cost_estimate` and `billing_policy` describe preflight and final billing.
- `queue` and `queue_policy` describe scheduling capacity.
- `membership` and `membership_policy` describe access gates.

The frontend can render `input_schema` and `x-ui`. It must not use
`provider_binding` to call providers directly.

Do not use one field to mean both product family and generation mode. For
example, a video model family can support several modes:

```ts
{
  family: "video",
  generationModes: [
    "text_to_video",
    "image_to_video",
    "first_last_frame_to_video"
  ]
}
```

The older `capability: "video_generation"` style is compatibility metadata
only. New routing and UI logic should use `family` and `generationModes`.

## Presets

Presets are product-level choices such as:

- Fast
- Standard
- Professional
- Campaign exclusive

Each preset routes to one or more concrete models. The routing service decides
which provider/model is used at submission time and stores the decision on the
job as `routingSnapshot`.

`AI_MODEL_PRESETS` is the primary backend configuration source. If it is empty,
the server derives safe defaults from enabled models:

- `image.fast`, `image.standard`, `image.professional`
- `video.fast`, `video.standard`, `video.professional`

Configured presets override derived defaults by id. `AI_MODEL_ROUTES` is still
accepted as a legacy alias during migration.

The server implementation uses `AiModelPresetRegistryService` as the single
configuration boundary. Today it reads env JSON; later an operations/admin
backend can persist presets and campaigns in Postgres by replacing that source.
Routing, catalog response shape, quota charging, and worker execution should
continue to consume the same registry contract.

Presets can carry region policy:

```json
{
  "presetId": "image.fast",
  "modelIds": ["fal/fal-ai/flux/schnell"],
  "regionPolicy": {
    "allowedCells": ["global", "com", "global-azure-sg"],
    "blockedCountries": ["CN"],
    "preferredProviderRegions": ["southeastasia"]
  }
}
```

The catalog endpoint marks blocked presets/models disabled with a reason. Submit
re-validates the same policy before accepting the job.

Example:

```json
[
  {
    "presetId": "image.fast",
    "label": "Fast",
    "description": "Lower latency and lower cost for everyday generation.",
    "type": "image",
    "family": "image",
    "generationModes": ["text_to_image", "image_to_image"],
    "modelIds": ["fal/fal-ai/flux/schnell"],
    "strategy": "priority_fallback",
    "fallbackAllowed": true,
    "billingPolicy": {
      "mode": "charge",
      "unit": "bubble",
      "displayCurrency": "BUBBLES",
      "preflightCost": 1,
      "finalCostSource": "fixed_table",
      "refundPolicy": "refund_on_final_failure"
    },
    "sortOrder": 10
  },
  {
    "presetId": "campaign.aliyun-2026",
    "label": "Event exclusive",
    "description": "Free campaign model for the Alibaba Cloud event.",
    "type": "image",
    "family": "image",
    "generationModes": ["text_to_image"],
    "modelIds": ["dashscope/wanx2.1-t2i-turbo"],
    "strategy": "campaign_locked",
    "campaignId": "aliyun-competition-2026",
    "billingPolicy": {
      "mode": "free",
      "unit": "bubble",
      "displayCurrency": "BUBBLES",
      "preflightCost": 0,
      "finalCostSource": "campaign",
      "refundPolicy": "no_refund"
    },
    "sortOrder": 5
  }
]
```

`AI_FREE_CAMPAIGNS` carries campaign limits and dates:

```json
[
  {
    "id": "aliyun-competition-2026",
    "label": "Alibaba Cloud event",
    "active": true,
    "startsAt": "2026-06-01T00:00:00.000Z",
    "endsAt": "2026-06-30T23:59:59.999Z",
    "modelIds": ["dashscope/wanx2.1-t2i-turbo"],
    "perUserLimit": 200,
    "totalLimit": 100000
  }
]
```

## Submit Contract

The frontend submits intent, not a provider request:

```ts
interface AiSubmitJobBody {
  modelId?: string;
  presetId?: string;
  campaignId?: string;
  schemaVersion?: string;
  input?: Record<string, unknown>;
  idempotencyKey?: string;
}
```

Rules:

- Simple mode should submit `presetId`.
- Advanced mode may submit `modelId`.
- Campaign mode must submit `campaignId` and a campaign-allowed preset/model.
- Backend validates schema version, membership, quota, queue limits, and input.
- Backend maps normalized input to provider payload inside the provider adapter.

## Provider Adapter Boundary

Every provider implements the same backend adapter contract:

- `listModels`
- `getModel`
- `normalizeInput`
- `startGeneration`
- `pollStatus` for async providers
- `parseWebhook` when webhook callbacks are supported
- `mapError`

Provider adapters own:

- auth and endpoint selection
- provider-native field mapping
- queue submit / status polling / cancel
- provider error classification
- raw output parsing

They do not own:

- product UI layout
- user membership rules
- quota charging and refunds
- campaign eligibility
- queue fairness
- persistent output storage policy

## fal.ai Provider

The fal.ai integration follows the same provider boundary. It is split into
separate backend components:

- `FalConfigService`: reads provider enablement, keys, model allowlist, queue
  limits, and versioned model configs.
- `FalCatalogService`: exposes configured fal models as `AiModelDefinition`.
- `FalSchemaMapper`: converts model configs into FizzDragon input/output
  schemas.
- `FalRequestMapper`: maps normalized product input into fal request payloads.
- `FalClient`: owns fal queue submit/status/response/cancel HTTP calls.
- `FalProviderAdapter`: implements the generic `ProviderAdapter` contract.
- `FalErrorMapper`: maps fal HTTP/provider failures into `AiJobError`.

Current fal catalog is config-driven on purpose. We should not render raw fal
OpenAPI schemas directly in the product UI; provider schemas must first be
normalized into this protocol. Automated fal OpenAPI ingestion can be added
behind `FalSchemaMapper` later without changing frontend or worker contracts.

Relevant env vars:

```text
FAL_ENABLED=true
FAL_API_KEY=...
FAL_MODEL_ALLOWLIST=fal-ai/flux/schnell,fal-ai/wan/v2.2-a14b/text-to-video
FAL_MODEL_CONFIGS=[...]
FAL_IMAGE_GLOBAL_CONCURRENCY=12
FAL_VIDEO_GLOBAL_CONCURRENCY=4
FAL_PER_USER_IMAGE_RUNNING=2
FAL_PER_USER_VIDEO_RUNNING=1
FAL_PER_USER_QUEUED_TOTAL=10
FAL_POLL_DELAY_MS=5000
FAL_REQUEST_TIMEOUT_MS=300000
```

## Routing Snapshot

Every accepted job stores an immutable routing snapshot. This is required for
audits, retries, refunds, and debugging.

The snapshot must contain:

- route id and strategy
- requested preset/model
- selected provider/model/deployment
- schema/input mapper version
- quota and billing policy
- membership tier policy
- queue and concurrency policy
- campaign policy when applicable
- selected timestamp

Do not recompute old job policy during retry/refund/audit. Use the snapshot.

## Billing And Free Campaigns

Free models and free campaigns are policy states, not separate codepaths.

Required controls:

- per-user campaign limit
- campaign total limit or budget limit
- start/end time
- allowed model/preset list
- explicit refund behavior

Normal billing should be driven by `billing_policy`, not hardcoded `image: 1`.

## Frontend Rendering

The Art Studio UI should be schema-driven:

- Render visible fields from `input_schema.properties`.
- Use `x-ui` for control type, order, grouping, labels, hints, and visibility.
- Validate required fields, enum values, ranges, media constraints, and rules.
- Hide advanced fields unless advanced mode is enabled.
- Show locked fields/options based on membership policy.
- Show preflight cost, estimated queue time, and final job status.

Frontend adapter code adapts this protocol to React components. It must not
adapt directly to fal.ai, DashScope, Replicate, or Foundry payloads.

## Error Contract

All job errors should map into product-level codes:

- validation
- schema version mismatch
- membership required or expired
- quota insufficient
- queue limit exceeded
- provider rate limited
- provider timeout
- provider content filter
- output fetch/upload failed
- cancelled
- unknown

Provider-native errors can be kept in internal logs/attempt rows, but user
responses should expose a stable product error code and actionable message.

## Migration Rule

Existing Microsoft Foundry code is only the first provider implementation.
Do not let its naming or request shape define the product protocol.

During migration, legacy `Foundry*` names can remain as compatibility aliases.
New shared contracts, public endpoint envelopes, and cross-provider logic should
use `Ai*` protocol names.
