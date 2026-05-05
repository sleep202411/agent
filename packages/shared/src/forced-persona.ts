/**
 * Forced-persona routing — a single-message override that pins which
 * specialist the supervisor must consult, bypassing its normal routing
 * heuristics.
 *
 * Lives on `AssistantMessage.metadata.forcedPersona`. The web composer
 * sets it when the user clicks one of the persona pills; on send it
 * rides with the user message into Redis and across the wire. The Nest
 * proxy reads the field off the latest user message, validates, and
 * appends an `<FORCED_PERSONA />` XML marker into the LLM-facing copy
 * (the stored copy keeps the clean metadata). The supervisor agent
 * sees the marker and dispatches the matching `ask_*` tool.
 *
 * Why a separate module from `personas.ts`:
 *   - `PERSONAS` (persona auth identity) is the *output* side — which
 *     specialist's voice an AI message is attributed to. It includes
 *     `storyos`, `producer`, etc. that are not user-pinnable.
 *   - This module is the *input* side — the four designer roles the
 *     user can route to via the composer pill row.
 */

import { z } from "zod";

/**
 * Wire-format persona keys (snake_case to match the agent's `ask_*`
 * tool naming, e.g. `ask_character_designer`). The supervisor prompt
 * uses these verbatim when interpreting the `<FORCED_PERSONA />`
 * marker, so renaming requires a coordinated change across the prompt.
 */
export const FORCED_PERSONA_KEYS = [
  "scriptwriter",
  "episode_planner",
  "character_designer",
  "scene_designer",
  "prop_designer",
  "storyboard_designer",
] as const;

export type ForcedPersonaKey = (typeof FORCED_PERSONA_KEYS)[number];

export const ForcedPersonaKeySchema = z.enum(FORCED_PERSONA_KEYS);

export function isForcedPersonaKey(value: unknown): value is ForcedPersonaKey {
  return typeof value === "string" && (FORCED_PERSONA_KEYS as readonly string[]).includes(value);
}

/**
 * Map the wire-format key to the agent's tool name. Single source of
 * truth so the server / prompt / tests don't drift.
 */
export function forcedPersonaToToolName(key: ForcedPersonaKey): string {
  return `ask_${key}`;
}
