# FizzDragon plot tree — instructions for your AI

Send this file together with your screenplay and your creative requirements to your AI tool. Ask it to return `plot.json`, then use **Import JSON** in the FizzDragon plot tree. One file imports into the current chapter. By default, it adds a separate group which you can connect manually. Select “Replace the current chapter’s plot tree” to replace that chapter’s nodes and connections. In replacement mode or an empty chapter, `entryNodeId` becomes the start.

## Task

Convert my screenplay into the JSON format below. Preserve my language, plot, dialogue, scene order, branch choices and endings. Do not summarize, invent branches or rewrite the story unless I explicitly ask you to. A linear screenplay can contain only scene nodes. Put scene action and dialogue in `description`. Use a separate decision node for each player choice. Output a valid UTF-8 JSON file only, without Markdown fences, comments, trailing commas or extra fields.

## Contract (version 1)

- Root: `version` (exactly `1`), `entryNodeId`, `nodes`.
- Scene: `id`, `type: "scene"`, `title` (required, at most 120 characters), `description` (optional, at most 4,000 characters), `next` (another node ID, or `null` for an ending).
- Decision: `id`, `type: "decision"`, `prompt` (required, at most 4,000 characters), `choices` (2–6 ordered options). Each option has `label` (required, at most 4,000 characters) and `next` (an existing node ID). Endings are scenes with `next: null`, not choices with null targets.
- Every node ID is unique: 1–64 ASCII characters, beginning with a letter, followed by letters, digits, `.`, `_`, `:` or `-`. Every referenced node must exist in this file. Every node must be reachable from `entryNodeId`. Branches may rejoin the same node; do not duplicate that node.
- Keep node array order and choice array order intentional. JSON must escape line breaks inside text as `\n` and quotes as `\"`. Preserve the full text within the field limits; split long scenes into connected scene nodes rather than truncate them.
- At most 1,000 nodes and 2 MB per file. Split longer stories into chapter files, each self-contained. Do not put cross-file links in `next`.
- No media URLs, generation prompts, coordinates, asset IDs or additional metadata. FizzDragon generates only the editable skeleton and lays it out automatically. Internal IDs are namespaced on import to avoid collisions with existing nodes and media bindings; text, choices and topology are preserved.

## Example

Replace this example with my story. The example text is not a required output language.

```json
{
  "version": 1,
  "entryNodeId": "arrival",
  "nodes": [
    {
      "id": "arrival",
      "type": "scene",
      "title": "The unopened letter",
      "description": "At dawn, Mira discovers a letter beneath the door.\nMira: “Who brought this?”",
      "next": "open_or_leave"
    },
    {
      "id": "open_or_leave",
      "type": "decision",
      "prompt": "What will Mira do?",
      "choices": [
        {
          "label": "Open the letter",
          "next": "truth"
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
