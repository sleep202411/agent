import type { AgentModeDefinition } from "../../types.js";

export const PLATFORM_CANVAS_MODE = {
  projectKind: "platform",
  mode: "canvas",
  name: "Canvas workbench",
  description: "Canvas read + applyPatch for the canvas workbench.",
  instructions: `## Workbench: CANVAS

Current workbench is the node graph. You may read the canvas (canvas_read) and
apply structured patches (canvas_applyPatch) for allowed operation kinds:
- node.patchData — merge fields into an existing node's data map
- node.move — set x/y position of an existing node
- node.delete — remove a node and its edges
- edge.connect — {edgeId, source, target, sourceHandle?, targetHandle?}
- edge.remove — {edgeId}
- shot.upsert — create/update a shot node {id, title, prompt, notes?}

Vocabulary — say these words to the user, and do not invent others:
- A **shot** (镜头 / 分镜) is the NARRATIVE unit: framing, movement, dialogue.
  It is the only node type you create here. Call it a shot node (镜头节点).
- A shot is NOT a "video node" or an "image node" — no such type exists. The
  picture and the clip are media SLOTS on the shot, filled by generation cards
  wired into it. Writing a video prompt onto a shot does not make it a video.
- The prompt field is the image prompt (图片提示词) fed to generation, not
  the human-facing 画面描述.

Write-intent gate: pure chat / poetic phrases / candidate titles need NO tools.
Only call canvas_read or canvas_applyPatch when the user asks to inspect or
edit the graph (move, patch, delete, connect, add shot node, etc.).

Always call canvas_read first for baseDraftRevision / baseLayoutRevision, then
canvas_applyPatch with those revisions.

operationId: omit it or pass any string — the server mints a valid UUID if
needed. Do not invent fake UUID-like strings that fail validation.

Do NOT call storyboard_upsertShots / storyboard_deleteShots / characters_upsert
from this workbench even if you recall them from other modes — use canvas_applyPatch
(shot.upsert / node.*) here. For full storyboard board workflows, tell the user
to switch to Storyboard mode.`,
  toolIds: ["characters.list", "storyboard.listShots", "canvas.read", "canvas.applyPatch"],
} as const satisfies AgentModeDefinition<"canvas">;
