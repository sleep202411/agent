import { createTool } from "@mastra/core/tools";
import { z } from "zod";

/**
 * Generic "ask user for some params" HITL. Used by the supervisor when it
 * needs concrete generation settings (episode count, shot count per episode,
 * style, dialogue language, episode length) before kicking off a pipeline —
 * replaces the legacy `require_project_params` flow that persisted to the
 * Java project table.
 *
 * **Values are conversation-scoped**: no Redis, no Java write-back. The
 * supervisor holds onto them via its own chat history, then passes them
 * into subsequent `invoke_workflow` calls as inputData fields. See the
 * storyos prompt's "配置参数" section for the canonical 5-field shape.
 *
 * Execution: no `execute` — frontend `ToolParamsCard` renders the form,
 * user submits, result is replayed to Mastra via `applyToolResult`. The
 * supervisor sees `{confirmed: true, values: {...}}` on the next turn.
 */
export const configureParams = createTool({
  id: "configure_params",
  description:
    'Show the user a multi-field form to collect generation parameters for this session — typically the 5 fields targetEpisodeCount / chapterLength / shotsPerEpisode / stylePainting / dialogLanguage. **Does NOT** write to the Java project and **does NOT** touch workspaceContext — purely conversation-scoped. After the user submits, carry the 5 values forward by including them in subsequent invoke_workflow inputData; each phase workflow consumes them itself. Call once when starting a new project (after analyzing material, before kicking off generation). To change any of the values later, either call this tool again or accept a natural-language change ("switch art style to X") and re-call this tool on the spot.',
  inputSchema: z.object({
    title: z.string().describe("Title, 5-15 chars. e.g. 'Creation parameters'"),
    description: z
      .string()
      .optional()
      .describe("One-sentence subtitle (<= 50 chars) explaining why these params are needed"),
    fields: z
      .array(
        z.object({
          key: z
            .string()
            .describe(
              "Field id. Use the canonical names targetEpisodeCount / chapterLength / shotsPerEpisode / stylePainting / dialogLanguage — downstream workflows read inputData by these keys"
            ),
          label: z.string().describe("Human-readable field name, 5-8 chars"),
          type: z.enum(["number", "text", "select"]),
          defaultValue: z.union([z.string(), z.number()]).describe("Initial value"),
          options: z
            .array(z.object({ label: z.string(), value: z.string() }))
            .optional()
            .describe("Options when type=select"),
          min: z.number().optional(),
          max: z.number().optional(),
          suffix: z.string().optional().describe("Unit suffix, e.g. 'episodes' / 'minutes'"),
        })
      )
      .min(1)
      .max(8),
  }),
  outputSchema: z.object({
    confirmed: z.boolean(),
    /**
     * Values submitted by the user. Keys match fields[].key. The supervisor
     * carries these forward into subsequent invoke_workflow inputData calls
     * verbatim.
     */
    values: z.record(z.string(), z.union([z.string(), z.number()])).optional(),
  }),
  // No execute — client-side HITL. Frontend's ToolParamsCard renders the
  // form; user submission posts back via applyToolResult, which re-streams
  // the conversation with `{confirmed: true, values: {...}}`.
});
