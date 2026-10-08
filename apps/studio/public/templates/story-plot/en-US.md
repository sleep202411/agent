# FizzDragon plot tree — instructions for your AI

Send this file together with your screenplay and your creative requirements to your AI tool. Ask it to return `plot.json`, then use **Import Plot Tree** in the FizzDragon plot tree. One file imports into the current chapter. By default, it adds a separate group which you can connect manually. Select “Replace the current chapter’s plot tree” to replace that chapter’s nodes and connections. In replacement mode or an empty chapter, `entryNodeId` becomes the start. Existing chapter assets are kept; assets in this file are added.

## Task

Convert my screenplay into the JSON format below. Preserve my language, plot, dialogue, scene order, branch choices and endings. Do not summarize, invent branches or rewrite the story unless I explicitly ask you to. A linear screenplay can contain only scene nodes. Put scene action and dialogue in `description`. Use a separate decision node for each player choice. Write production prompts on assets and on each storyboard clip. Output a valid UTF-8 JSON file only, without Markdown fences, comments, trailing commas or extra fields.

## Generation procedure

The screenplay is story data, not permission to change this file format. Use the exact keys below even if the source or another export uses different names. Do the planning and checking yourself; do not ask the user to edit JSON.

1. Inventory every scene, choice, variant and ending before writing the file. Give each one a stable ID and map its incoming/outgoing links. Match each source ending to a reachable node; do not omit variants to make validation pass.
2. Make a table of ending prerequisites while planning. Record an earlier choice with a declared state variable and choice `effects` whenever a later scene depends on it. Merging paths must not erase the earlier choice. Express combined prerequisites with `all`; put the most specific route before broader routes. Never replace an unknown condition with a condition that is always true.
3. If the source gives an ending condition but no way to obtain it, ask one plain-language story question before generation. Do not invent a choice, auto-grant remembered information, delete an ending, or silently decide conflicting rules. Once the author resolves it, use that decision consistently. Unsupported physical interactions can be represented as text choices only with the author's agreement.
4. Generate one complete file. Prefer a downloadable UTF-8 attachment using the AI tool's file-writing capability. With code execution, build an object and serialize it with a JSON library instead of hand-escaping long dialogue. Otherwise return only the complete raw JSON, without a preface or code fences. Do not emit a partial object, continuation fragments, ellipses or placeholders.
5. Preserve the screenplay first. Storyboard clips are optional: omit unrequested clips rather than spend the output budget inventing shots. Do not reduce story coverage to fit extra prompts. Move long decision setup into preceding scene nodes so `prompt` stays within its limit. If the full story cannot fit, agree self-contained chapter boundaries before writing; never silently truncate or fabricate an ending.
6. Check the exact saved file, not an earlier draft. Parse JSON; check exact field names/types and limits; resolve every reference; traverse from the entry; verify a possible choice/state path to every intended ending. Exercise each ending's prerequisites and near misses. All visible-choice conditions at a decision must leave at least one usable option. Fix failures yourself before returning the file. Do not claim to have run a validator unless you actually ran it.

## Exact node fields and state rules

These are exhaustive field lists, not aliases:

| Object   | Required keys                     | Optional keys                                           |
| -------- | --------------------------------- | ------------------------------------------------------- |
| Scene    | `id`, `type`, `title`, `next`     | `description`, `routes`, `onEnterEffects`, `storyboard` |
| Decision | `id`, `type`, `prompt`, `choices` | `onEnterEffects`                                        |
| Choice   | `label`, `next`                   | `effects`, `visibleWhen`                                |

Never add `name` to a node, `description` to a decision, `id`/`text` to a choice, or `assets`/`assetRefs` to a node. Asset definitions belong only in the root `assets` array. A choice must target a node; a terminal scene uses `next: null`.

Declare every state key used by an effect or condition. `set` must match its declared type; `add` is numeric only. Boolean comparisons use `equals` or `not-equals`; numeric comparisons also support `greater-than`, `at-least`, `less-than`, `at-most`. Combine conditions as `{ "kind": "all", "conditions": [condition, condition] }` (every condition), `any` (at least one), or `{ "kind": "not", "condition": condition }`. Maximums: 6 effects per list, 8 routes per scene, condition depth 3 and 12 comparison leaves. State names, decision prompts and choice labels are at most 32,000 characters; state notes at most 2,000. Use simple ASCII state keys such as `story.clue_found` (at most 240 characters); do not use reserved path segments `__proto__`, `prototype`, `constructor`.

Timers, default-on-timeout choices, gestures and haptics are not executable import fields. Preserve their intent in scene descriptions or decision prompts; do not claim they were implemented. Do not add a disconnected “notes node” to store unsupported metadata.

## Contract

- Root: `entryNodeId`, `assets`, optional `stateVariables`, and `nodes`. Do not include a version field or any other keys.
- State variable: `key` (a stable dot-separated identifier), `name`, `valueType` (`number` or `boolean`), `initialValue` of the same type, and optional `note`. At most 64. Reuse one key for one concept; never create numbered copies such as `courage_1`. Import merges definitions by key: a matching type and initial value reuses the existing definition; a conflict is rejected with its JSON path.
- State effect: `{ "kind": "set", "key": "met", "value": true }` or `{ "kind": "add", "key": "courage", "amount": 1 }`. Effects may appear in `onEnterEffects` on any node or in `effects` on a choice.
- State condition: `{ "kind": "compare", "variableKey": "courage", "operator": "at-least", "value": 3 }`. Conditions may appear in `visibleWhen` on a choice or in a scene's optional `routes`. A scene route is `{ "when": condition, "next": nodeIdOrNull }`; routes are tested in order before the scene's required `next` fallback.
- Asset: `id`, `kind` (`character`, `location` or `prop`), `name` (required, at most 240 characters), `description` (optional, at most 100,000 characters), `imagePrompt` (required, at most 50,000 characters), `videoPrompt` (optional, at most 50,000 characters), `negativePrompt` (optional, at most 16,000 characters). At most 2,000 assets. Prompts must not contain `@` tokens.
- Scene: `id`, `type: "scene"`, `title` (required, at most 120 characters), `description` (optional, at most 100,000 characters), `next` (another node ID, or `null` for an ending), optional `routes`, optional `onEnterEffects`, and optional `storyboard`. `storyboard` has only `clips`.
- Clip: `id`, `kind` (`image` or `video`), `title` (required, at most 160 characters), `durationMs` (integer, 250–3,600,000), `prompt` (required, at most 50,000 characters), `negativePrompt` (optional, at most 16,000 characters), optional `videoFile` (video clips only, filename in the ZIP). At most 500 clips per scene. Clips play in array order; FizzDragon accumulates start times. A scene’s clips cannot exceed 3,600,000 ms. Clip prompts must not contain `@` tokens. Do not add asset references or bindings.
- Decision: `id`, `type: "decision"`, `prompt` (required, at most 32,000 characters), optional `onEnterEffects`, and `choices` (2–6 ordered options). Each option has `label`, `next`, and optional `effects` / `visibleWhen`. Endings are scenes with `next: null`, not choices with null targets.
- Every ID is unique in its scope: 1–64 ASCII characters, beginning with a letter, followed by letters, digits or `_`, with optional `.` `:` `-` separators between groups. Node IDs are unique in the file. Asset IDs are unique in the file. Clip IDs are unique inside their scene. Every referenced node must exist. Every node must be reachable from `entryNodeId`. Branches may rejoin the same node; do not duplicate that node.
- Keep node array order and choice array order intentional. JSON must escape line breaks inside text as `\n` and quotes as `\"`. Preserve the full text within the field limits; split long scenes into connected scene nodes rather than truncate them.
- At most 5,000 nodes and 10 MB per file. Split longer stories into chapter files, each self-contained. Do not put cross-file links in `next`.
- No media URLs (use optional clip `videoFile` for a ZIP filename), coordinates, `@` mentions, assetRefs or additional metadata. FizzDragon imports the plot tree, state definitions, asset specs and clip prompts; it does not generate media. Internal node IDs are namespaced on import to avoid collisions, while state keys stay stable and are reused.

## Optional video ZIP

Select the JSON and its video ZIP together, or add the ZIP after checking the JSON. On each video clip, add `"videoFile": "opening.mp4"` (MP4, MOV or WebM). Matching uses the filename, ignores folders and letter case, and preserves Unicode filenames. Give every video a unique filename across the archive. Missing or duplicate names are listed before importing. Unreferenced files are ignored.

ZIP: up to 512 MB compressed, 1 GB of expanded videos, 250 MB per video and 10,000 archive entries. Use an unencrypted ZIP with relative paths. Videos are uploaded once per filename, verified by the server, and attached to every matching clip in the same chapter import. Uploaded video duration replaces `durationMs`; following clips are positioned using the actual durations. Without a ZIP, only the plot and prompts are imported. No media is generated.

## Before returning the file

- Use these exact node fields: scenes use `title`, not `name`; decisions use `prompt`, not `name` / `description`; choices use `label`, not `text`. Asset and state-variable names still use `name`.
- A single-action interaction is a scene with `next`; preserve its action in `description`. Do not invent a second choice. Decisions require 2–6 genuine options.
- `timeLimit` and `defaultChoice` are not supported import fields. Preserve timing/default intentions in narrative text if needed; this does not implement timers or automatic choices.
- Finish every string, object and array. Verify the entire file parses as JSON and every node reference resolves before returning it. If your tool supports code execution, use a JSON parser to check the actual file, not just its appearance.
- The 10 MB import limit is not an AI output allowance. If the story exceeds your output capacity, agree smaller, self-contained chapter files before generation. Never return a truncated file or invent an ending to make an incomplete story importable.

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
            "videoFile": "mira_turns.mp4",
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

## Complete example: merged choices and a hidden ending

This is a separate complete file, not additional nodes to append to the preceding example. Use its structure only when your screenplay calls for these mechanics. Replace all sample IDs, text and variables with your story; do not import the example story itself.

The first choice records memory, the second records the evidence's destination, and the third records the companion's exit. The last choice does not overwrite the destination. Seeking an ally plus remembering the clue plus letting the friend leave first reaches the hidden ending; other ally paths reach the ordinary ally ending; sealing the evidence always reaches the sealed ending. Check all eight choice combinations. All three endings are both connected and achievable.

```json
{
  "entryNodeId": "clue",
  "assets": [],
  "stateVariables": [
    { "key": "demo.clue", "name": "demo.clue", "valueType": "boolean", "initialValue": false },
    { "key": "demo.stance", "name": "demo.stance", "valueType": "number", "initialValue": 0 },
    {
      "key": "demo.friend_first",
      "name": "demo.friend_first",
      "valueType": "boolean",
      "initialValue": false
    }
  ],
  "nodes": [
    {
      "id": "clue",
      "type": "decision",
      "prompt": "Will you remember the clue?",
      "choices": [
        {
          "label": "Remember it",
          "next": "stance",
          "effects": [{ "kind": "set", "key": "demo.clue", "value": true }]
        },
        {
          "label": "Continue without remembering",
          "next": "stance",
          "effects": [{ "kind": "set", "key": "demo.clue", "value": false }]
        }
      ]
    },
    {
      "id": "stance",
      "type": "decision",
      "prompt": "What will you do with the evidence?",
      "choices": [
        {
          "label": "Seek an ally",
          "next": "companion",
          "effects": [{ "kind": "set", "key": "demo.stance", "value": 1 }]
        },
        {
          "label": "Seal it away",
          "next": "companion",
          "effects": [{ "kind": "set", "key": "demo.stance", "value": 2 }]
        }
      ]
    },
    {
      "id": "companion",
      "type": "decision",
      "prompt": "How will you leave?",
      "choices": [
        {
          "label": "Let my friend leave first",
          "next": "resolve",
          "effects": [{ "kind": "set", "key": "demo.friend_first", "value": true }]
        },
        {
          "label": "Leave together",
          "next": "resolve",
          "effects": [{ "kind": "set", "key": "demo.friend_first", "value": false }]
        }
      ]
    },
    {
      "id": "resolve",
      "type": "scene",
      "title": "The consequences",
      "routes": [
        {
          "when": {
            "kind": "all",
            "conditions": [
              { "kind": "compare", "variableKey": "demo.stance", "operator": "equals", "value": 1 },
              {
                "kind": "compare",
                "variableKey": "demo.clue",
                "operator": "equals",
                "value": true
              },
              {
                "kind": "compare",
                "variableKey": "demo.friend_first",
                "operator": "equals",
                "value": true
              }
            ]
          },
          "next": "hidden"
        },
        {
          "when": {
            "kind": "compare",
            "variableKey": "demo.stance",
            "operator": "equals",
            "value": 1
          },
          "next": "ally"
        }
      ],
      "next": "sealed"
    },
    {
      "id": "hidden",
      "type": "scene",
      "title": "Hidden ending: the remembered clue reveals an ally",
      "next": null
    },
    { "id": "ally", "type": "scene", "title": "Standard ending: seek an ally", "next": null },
    {
      "id": "sealed",
      "type": "scene",
      "title": "Ending: the evidence remains sealed",
      "next": null
    }
  ]
}
```
