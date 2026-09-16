/**
 * Generative-UI action payloads emitted by supervisor inside a fenced
 * ```json {"actions":[{...}]} ``` block at the END of a text part.
 * The frontend extracts them, strips the block from the display, and
 * renders inline action buttons at the emission point.
 *
 * No cross-part coordination: every emission renders its own buttons.
 * Label uniqueness within a single emission is the supervisor's
 * responsibility (the user's click message references an action by
 * its label).
 */
import { jsonrepair } from "jsonrepair";

export interface SuggestedAction {
  label: string;
  tool: string;
  input: Record<string, unknown>;
  estimatedCost?: number;
}

/**
 * Parse JSON with a repair fallback. LLMs routinely emit Chinese prose
 * with unescaped English double quotes inside JSON string values
 * (e.g. `"description":"他理解"家"之意义"`), which breaks strict
 * JSON.parse. jsonrepair handles this + trailing commas + a handful of
 * other common model output errors. Only runs on parse failure, so the
 * happy path has zero overhead.
 */
function parseJsonWithRepair(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    const repaired = jsonrepair(raw);
    return JSON.parse(repaired);
  }
}

const FENCE_REGEX = /```json\s*\n([\s\S]*?)\n?```\s*$/;
// Streaming fallback — matches an unclosed ```json block at the tail.
// Used to hide the half-rendered code block while it's still streaming,
// before FENCE_REGEX matches.
const STREAMING_FENCE_REGEX = /```json\s*\n[\s\S]*$/;

function validateAction(raw: unknown): SuggestedAction | null {
  if (!raw || typeof raw !== "object") return null;
  const a = raw as Record<string, unknown>;
  if (
    typeof a.label !== "string" ||
    typeof a.tool !== "string" ||
    !a.input ||
    typeof a.input !== "object" ||
    Array.isArray(a.input)
  ) {
    return null;
  }
  return {
    label: a.label,
    tool: a.tool,
    input: a.input as Record<string, unknown>,
    estimatedCost:
      typeof a.estimatedCost === "number" && Number.isFinite(a.estimatedCost)
        ? a.estimatedCost
        : undefined,
  };
}

/**
 * Pull a trailing ```json {"actions":[{...}]} ``` block out of `source`.
 * Returns `{ cleanText, suggestedActions }` where `cleanText` has the
 * block stripped, and `suggestedActions` is always an array (empty if
 * no block / malformed / fails shape check).
 */
export function extractSuggestedActions(source: string): {
  cleanText: string;
  suggestedActions: SuggestedAction[];
} {
  const trimmed = source.trimEnd();
  const completeMatch = trimmed.match(FENCE_REGEX);

  if (completeMatch) {
    try {
      const parsed = parseJsonWithRepair(completeMatch[1]) as { actions?: unknown };
      if (Array.isArray(parsed?.actions)) {
        const actions: SuggestedAction[] = [];
        for (const raw of parsed.actions) {
          const validated = validateAction(raw);
          if (validated) actions.push(validated);
        }
        if (actions.length > 0) {
          const cleanText = source.slice(0, completeMatch.index).trimEnd();
          return { cleanText, suggestedActions: actions };
        }
      }
    } catch {
      // fall through to streaming check
    }
  }

  // Streaming: block opened but closing fence hasn't arrived yet.
  // Strip the half-rendered code block from display; don't emit buttons
  // until the JSON is complete.
  const streamingMatch = source.match(STREAMING_FENCE_REGEX);
  if (streamingMatch) {
    const cleanText = source.slice(0, source.length - streamingMatch[0].length).trimEnd();
    return { cleanText, suggestedActions: [] };
  }

  return { cleanText: source, suggestedActions: [] };
}
