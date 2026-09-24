# FizzDragon plot tree — instructions for your AI

Send this file together with your screenplay and your creative requirements to your AI tool. Ask it to return `plot.json`, then use **Import Plot Tree** in the FizzDragon plot tree. One file imports into the current chapter. By default, it adds a separate group which you can connect manually. Select “Replace the current chapter’s plot tree” to replace that chapter’s nodes and connections. In replacement mode or an empty chapter, `entryNodeId` becomes the start. Existing chapter assets are kept; assets in this file are added.

## Task

Convert my screenplay into the JSON format below. Preserve my language, plot, dialogue, scene order, branch choices and endings. Do not summarize, invent branches or rewrite the story unless I explicitly ask you to. A linear screenplay can contain only scene nodes. Put scene action and dialogue in `description`. Use a separate decision node for each player choice. Write production prompts on assets and on each storyboard clip. Output a valid UTF-8 JSON file only, without Markdown fences, comments, trailing commas or extra fields.

## Contract

- Root: `entryNodeId`, `assets`, optional `stateVariables`, and `nodes`. Do not include a version field or any other keys.
- State variable: `key` (a stable dot-separated identifier), `name`, `valueType` (`number` or `boolean`), `initialValue` of the same type, and optional `note`. At most 64. Reuse one key for one concept; never create numbered copies such as `courage_1`. Import merges definitions by key: a matching type and initial value reuses the existing definition; a conflict is rejected with its JSON path.
- State effect: `{ "kind": "set", "key": "met", "value": true }` or `{ "kind": "add", "key": "courage", "amount": 1 }`. Effects may appear in `onEnterEffects` on any node or in `effects` on a choice.
- State condition: `{ "kind": "compare", "variableKey": "courage", "operator": "at-least", "value": 3 }`. Conditions may appear in `visibleWhen` on a choice or in a scene's optional `routes`. A scene route is `{ "when": condition, "next": nodeIdOrNull }`; routes are tested in order before the scene's required `next` fallback.
- Asset: `id`, `kind` (`character`, `location` or `prop`), `name` (required, at most 240 characters), `description` (optional, at most 4,000 characters), `imagePrompt` (required, at most 12,000 characters), `videoPrompt` (optional, at most 12,000 characters), `negativePrompt` (optional, at most 4,000 characters). At most 500 assets. Prompts must not contain `@` tokens.
- Scene: `id`, `type: "scene"`, `title` (required, at most 120 characters), `description` (optional, at most 4,000 characters), `next` (another node ID, or `null` for an ending), optional `routes`, optional `onEnterEffects`, and optional `storyboard`. `storyboard` has only `clips`.
- Clip: `id`, `kind` (`image` or `video`), `title` (required, at most 160 characters), `durationMs` (integer, 250–3,600,000), `prompt` (required, at most 12,000 characters), `negativePrompt` (optional, at most 4,000 characters). At most 100 clips per scene. Clips play in array order; FizzDragon accumulates start times. A scene’s clips cannot exceed 3,600,000 ms. Clip prompts must not contain `@` tokens. Do not add asset references or bindings.
- Decision: `id`, `type: "decision"`, `prompt` (required, at most 4,000 characters), optional `onEnterEffects`, and `choices` (2–6 ordered options). Each option has `label`, `next`, and optional `effects` / `visibleWhen`. Endings are scenes with `next: null`, not choices with null targets.
- Every ID is unique in its scope: 1–64 ASCII characters, beginning with a letter, followed by letters, digits or `_`, with optional `.` `:` `-` separators between groups. Node IDs are unique in the file. Asset IDs are unique in the file. Clip IDs are unique inside their scene. Every referenced node must exist. Every node must be reachable from `entryNodeId`. Branches may rejoin the same node; do not duplicate that node.
- Keep node array order and choice array order intentional. JSON must escape line breaks inside text as `\n` and quotes as `\"`. Preserve the full text within the field limits; split long scenes into connected scene nodes rather than truncate them.
- At most 500 nodes and 2 MB per file. Split longer stories into chapter files, each self-contained. Do not put cross-file links in `next`.
- No media URLs, coordinates, `@` mentions, assetRefs or additional metadata. FizzDragon imports the plot tree, state definitions, asset specs and clip prompts; it does not generate media. Internal node IDs are namespaced on import to avoid collisions, while state keys stay stable and are reused.

## Example

Replace this example with my story. The example text is not a required output language.

```json
{
  "entryNodeId": "arrival",
  "stateVariables": [
    {
      "key": "courage",
      "name": "Courage",
      "valueType": "number",
      "initialValue": 0,
      "note": "Confidence built through difficult choices."
    }
  ],
  "assets": [
    {
      "id": "mira",
      "kind": "character",
      "name": "Mira",
      "description": "A courier who finds a letter at dawn.",
      "imagePrompt": "Cinematic portrait of Mira, early thirties, dark coat, dawn light on her face.",
      "videoPrompt": "Mira stands still, coat shifting in a cold breeze.",
      "negativePrompt": "cartoon, extra fingers"
    },
    {
      "id": "hallway",
      "kind": "location",
      "name": "Boarding-house hallway",
      "imagePrompt": "Narrow wooden hallway at dawn, a sealed letter under the door."
    }
  ],
  "nodes": [
    {
      "id": "arrival",
      "type": "scene",
      "title": "The unopened letter",
      "description": "At dawn, Mira discovers a letter beneath the door.\nMira: “Who brought this?”",
      "next": "open_or_leave",
      "storyboard": {
        "clips": [
          {
            "id": "letter_still",
            "kind": "image",
            "title": "Letter under the door",
            "durationMs": 2000,
            "prompt": "A sealed letter on worn floorboards in dawn light."
          },
          {
            "id": "mira_turns",
            "kind": "video",
            "title": "Mira looks down",
            "durationMs": 4000,
            "prompt": "Mira looks down at the letter, then toward the empty hallway."
          }
        ]
      }
    },
    {
      "id": "open_or_leave",
      "type": "decision",
      "prompt": "What will Mira do?",
      "choices": [
        {
          "label": "Open the letter",
          "next": "truth",
          "effects": [{ "kind": "add", "key": "courage", "amount": 1 }]
        },
        {
          "label": "Leave it unopened",
          "next": "departure"
        }
      ]
    },
    {
      "id": "truth",
      "type": "scene",
      "title": "The truth",
      "description": "The letter reveals who has been waiting for her.",
      "next": null
    },
    {
      "id": "departure",
      "type": "scene",
      "title": "A fresh start",
      "description": "Mira leaves town without looking back.",
      "next": null
    }
  ]
}
```
