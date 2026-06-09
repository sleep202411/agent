# AI Prompt Reference Protocol

This protocol defines how FizzDragon handles rich prompts, reference images,
style references, and provider-specific model inputs. It is mandatory for image,
video, and canvas generation surfaces.

## Principles

- The user's intent is stored as a structured `promptDocument`, never as raw UI
  markup that providers are expected to understand.
- Provider prompts are compiled deterministically. The compiler may normalize
  reference labels, but it must not rewrite meaning, assign roles, translate the
  prompt, or infer subject/style/background intent.
- Reference images are model inputs, not prompt-only text. They must be sent via
  each provider's documented image field, in the same order frozen in the job
  snapshot.
- The job freezes both views: `promptDisplayText` for user-facing history and
  `compiledPrompt` for provider execution and audit.
- Provider adapters own provider syntax. If a provider requires `{{Image 1}}`,
  that translation happens in the adapter layer, not in the web UI.

## Canonical Shape

```ts
type PromptNode =
  | { type: "text"; text: string }
  | { type: "asset_ref"; refId: string; label?: string }
  | { type: "style_ref"; refId: string; label?: string };

type PromptDocument = {
  version: 1;
  nodes: PromptNode[];
};

type ReferenceBinding = {
  refId: string;
  kind: "image";
  label: string;
  order: number;
  url?: string;
  assetId?: string;
  role?: string;
  weight?: number;
};
```

## Compilation Rules

For a prompt such as:

```text
@Reference 1 runs quickly inside @Reference 2
```

the provider prompt must be compiled to:

```text
[Image 1] runs quickly inside [Image 2]

Reference images are supplied separately in this order:
[Image 1]: provided reference image 1
[Image 2]: provided reference image 2
```

The image URL list sent to the provider must be:

```json
["url-for-reference-1", "url-for-reference-2"]
```

If the user attaches reference images without inline mentions, the compiler may
append only this neutral instruction:

```text
Use the supplied reference images as visual references.
```

It must not invent role-specific instructions such as "use image 1 as the main
subject" unless the user explicitly selected or wrote that role.

## Storage And Audit

Each `AiJob` stores:

- `promptDocument`: the structured user expression.
- `promptDisplayText`: the prompt shown in user history.
- `promptSearchText`: normalized text for search and moderation workflows.
- `compiledPrompt`: exact model-facing text before provider-specific mapping.
- `referenceSnapshot`: immutable ordered reference bindings.
- `styleSnapshot`: immutable style bindings.

`normalizedInput.prompt` is the provider-ready prompt. `AiJob.prompt` remains the
user-facing prompt for history and gallery UI.

## UI Requirements

- The web composer must never expose provider syntax such as raw
  `{{Image 1}}` to users.
- Uploaded references must be rendered from real user-selected assets only; mock
  references are not allowed in production paths.
- The reference stack displays visual order. Removing an image changes the order
  and the next submit freezes the new order.
- Typing `@` in the prompt composer must open a reference picker for the
  currently attached reference assets. Selecting an option inserts a readable
  UI token such as `@Reference 1` while preserving the underlying asset binding.
- Inline `@` insertion, style chips, and asset chips must write structured nodes
  and bindings, not mutate plain prompt text as the only source of truth.
- The order in the picker, prompt document, and final provider image URL list
  must always match the visual reference stack order.

## Provider Adapter Requirements

- Adapters receive a compiled prompt and ordered reference URLs.
- Adapters must map reference URLs to the provider's documented field:
  `image_urls`, `image_input`, `input_images`, `image`, multipart file fields, or
  equivalent.
- Adapters may translate `[Image 1]` to provider-required exact syntax only when
  the provider documentation requires it.
- Adapters must not parse UI-only tokens or make semantic prompt rewrites.
