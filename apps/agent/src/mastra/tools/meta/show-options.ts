import { createTool } from "@mastra/core/tools";
import { z } from "zod";

/**
 * Generic "let the user pick from a list" UI tool. Supervisor calls this
 * when a decision is legitimately the user's to make (not the LLM's) —
 * typically when there's a **fork in the flow** with material trade-offs:
 *
 *   - script-or-novel upload: 快速出分镜 vs 完整流程
 *   - cost / latency trade-offs the user should see
 *   - N-way branching where the supervisor can't confidently pick
 *
 * Execution semantics: no `execute` — this is a client-side HITL tool
 * just like `require_project_params`. The frontend's `ToolOptionsCard`
 * renders from the tool-call input, waits for the user to click, and
 * posts back the selectedIds via `applyToolResult`. Supervisor sees
 * the selection on the replay and routes accordingly.
 *
 * Input / output shapes are pinned to the frontend contract at
 * `apps/web/src/types/assistant-contracts.ts` — changing either side
 * without the other breaks rendering.
 *
 * WHEN NOT to call: if the user's intent is unambiguous. The supervisor
 * prompt lists keywords that bypass this tool and go straight to
 * `invoke_workflow`.
 */
export const showOptions = createTool({
  id: "show_options",
  description:
    'Have the user pick one (or several) options from a list. Use when the user\'s intent **references multiple known entities but doesn\'t pin down the target**: e.g. "add a shot to one of the episodes" without saying which (options = episode list), "jump to that character" with multiple candidates (options = role list), or a workflow fork with different cost / outcome trade-offs (full flow vs. storyboard only). **Never reply with prose like "please tell me which one"** — that\'s exactly what this card is for. When the wording is unambiguous ("storyboard only" / a single matching "episode 2"), skip this and route directly to the relevant atomic tool / invoke_workflow. Returns {selectedIds: [...]}; single-select results contain exactly one id.',
  inputSchema: z.object({
    title: z
      .string()
      .describe("Title, 5-15 chars. e.g. 'How would you like to handle this script?'"),
    description: z
      .string()
      .optional()
      .describe("One-sentence subtitle (<= 50 chars) explaining why a choice is needed"),
    options: z
      .array(
        z.object({
          id: z
            .string()
            .describe(
              "Option id, lowercase+underscore. You'll receive this id on the next turn and use it to invoke the corresponding workflow"
            ),
          label: z.string().describe("Primary button text, 8-15 chars"),
          description: z
            .string()
            .optional()
            .describe("Secondary text under the button (<= 40 chars), may include estimated cost"),
        })
      )
      .min(2)
      .max(6),
    multiple: z
      .boolean()
      .optional()
      .describe("Default false (single-select); true for multi-select"),
  }),
  outputSchema: z.object({
    selectedIds: z.array(z.string()),
    notes: z.string().optional(),
  }),
  // Intentionally NO `execute` — this is a client-side interactive tool.
  // Frontend's chat-composer.tsx renders ToolOptionsCard from the tool's
  // input; user click posts back via applyToolResult; supervisor sees
  // the result on the next turn. Same pattern as require_project_params.
});
