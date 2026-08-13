import type { AgentModeDefinition } from "../../types.js";

export const PLATFORM_STORYBOARD_MODE = {
  projectKind: "platform",
  mode: "storyboard",
  name: "Storyboard workbench",
  description: "Characters + storyboard shot writes for the storyboard workbench.",
  instructions: `## Workbench: STORYBOARD

Current workbench is the shot list + film strip. Authoritative shot writes use
storyboard_* tools only. Do NOT call canvas_read / canvas_applyPatch here —
those tools are not the storyboard write path (and may not be mounted).

## Write-intent gate (workbench-local)

A bare phrase, poem, mood line, or candidate title is NOT "add a shot".
Examples that must stay chat-only with zero tools:
- "随笔爱你吧"
- "雨夜"
- "soft light on her face"
Only proceed to storyboard_listShots / storyboard_upsertShots when the user
explicitly asks to add/create/insert/write/拆分镜/加镜头 (or similar).

When the user EXPLICITLY asks to add ONE new shot:
1. storyboard_listShots → baseRevision.
2. storyboard_upsertShots with ONLY the new shot, intent "create", a new stable id
   (e.g. shot-04). Do NOT resubmit existing shots with intent create (SHOT_EXISTS).
3. Summarize the new id from the tool result.
Do not draft multi-step "I'll create shot-04 with this prompt" monologues before
the write tools run — call tools when intent is clear, else chat only.

When extracting characters from a script (user asked to extract cast / characters):
1. If attachmentId(s) are provided, read with script_readSection.
2. If only pasted text and no attachment, call script_store once, then use the returned attachmentId.
3. Call characters_list for baseRevision.
4. Call characters_upsert with structured cast (stable ascii ids).
5. Summarize character ids from the tool result.

When breaking a script into many storyboard shots (user asked to storyboard / 拆分镜):
1. Read via script_readSection (or script_store if text-only).
2. Call storyboard_listShots for baseRevision.
3. Propose ordered shots (id, title, cinematic prompt, notes).
4. Call storyboard_upsertShots with the new shots (intent create for new ids).
5. Summarize shot ids from the tool result.

When updating existing shots: list first, then upsert only those ids with intent "replace".

When deleting shots (remove last shot, drop ids, clear selection):
1. Call storyboard_listShots for baseRevision and to confirm ids.
2. Call storyboard_deleteShots with shotIds + baseRevision.
   Prefer delete over re-upserting the remaining list.
3. Summarize deleted ids from the tool result.

If both characters and shots are requested, refresh baseRevision between writes
(use projectRevision from the previous write as the next baseRevision).

Prefer small, correct writes. When intent is ambiguous, ask once — do not write.`,
  toolIds: [
    "characters.list",
    "characters.upsert",
    "storyboard.listShots",
    "storyboard.upsertShots",
    "storyboard.deleteShots",
  ],
} as const satisfies AgentModeDefinition<"storyboard">;
