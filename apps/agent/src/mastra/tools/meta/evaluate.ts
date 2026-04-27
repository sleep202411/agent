import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { listDrafts } from "../../lib/drafts";
import type { EntityType } from "../../lib/redis-keys";

/**
 * Evaluator tool — supervisor calls this to get a structured critique of a
 * workflow run's drafts (roles, episodes, scripts, storyboards). Returns
 * an overall score, concrete issues, and a feedback string that can be
 * fed back into the generator persona for a retry.
 *
 * This is the evaluator-optimizer pattern: generator produces → evaluator
 * critiques → supervisor decides (accept / revise / rework) → on rework,
 * re-invoke generator workflow with `feedback` field populated.
 */

const IssueSchema = z.object({
  severity: z.enum(["critical", "major", "minor"]),
  target: z.string(),
  problem: z.string(),
  suggestion: z.string(),
});

const ReportSchema = z.object({
  overallScore: z.number().min(0).max(100),
  verdict: z.enum(["pass", "revise", "rework"]),
  issues: z.array(IssueSchema),
  feedbackForRegeneration: z.string().default(""),
});

const EVALUATABLE_KINDS = ["role", "episode", "script", "storyboard"] as const;
type EvaluatableKind = (typeof EVALUATABLE_KINDS)[number];

function buildEvaluationPrompt(kind: EvaluatableKind, drafts: Array<{ data: unknown }>): string {
  const label =
    kind === "role"
      ? "character list"
      : kind === "episode"
        ? "episode outline"
        : kind === "script"
          ? "script"
          : "storyboard";
  return [
    `Review the following ${drafts.length} draft(s) of [${label}]. Return a report using the JSON structure defined in your system prompt.`,
    "",
    "Drafts:",
    JSON.stringify(
      drafts.map((d) => d.data),
      null,
      2
    ),
  ].join("\n");
}

export const evaluateDrafts = createTool({
  id: "evaluate",
  description:
    "Run a quality review (via the evaluator persona) over the drafts produced by a given workflow run. Returns overallScore / verdict / specific issues / feedbackForRegeneration. When verdict=rework, the feedback can be fed back into the corresponding workflow's feedback input for a retry.",
  inputSchema: z.object({
    runId: z.string().min(1),
    kind: z.enum(EVALUATABLE_KINDS),
  }),
  outputSchema: ReportSchema.extend({
    draftCount: z.number(),
    runId: z.string(),
    kind: z.enum(EVALUATABLE_KINDS),
  }),
  execute: async ({ runId, kind }, execCtx) => {
    const drafts = await listDrafts(runId, {
      entityType: kind as EntityType,
      statuses: ["pending", "committing", "committed"],
    });
    if (drafts.length === 0) {
      return {
        runId,
        kind,
        draftCount: 0,
        overallScore: 0,
        verdict: "rework" as const,
        issues: [
          {
            severity: "critical" as const,
            target: "(no drafts)",
            problem: `Run ${runId} has no ${kind} drafts to evaluate.`,
            suggestion:
              "Invoke the corresponding workflow to generate drafts first, then re-evaluate.",
          },
        ],
        feedbackForRegeneration: "",
      };
    }

    const evaluator = execCtx?.mastra?.getAgent("evaluator");
    if (!evaluator) throw new Error("evaluator agent not registered");

    const response = await evaluator.generate(buildEvaluationPrompt(kind, drafts), {
      structuredOutput: { schema: ReportSchema, errorStrategy: "warn" },
    });
    const report = response.object as z.infer<typeof ReportSchema> | undefined;

    if (!report) {
      // Evaluator failed to produce structured output — bail out with a
      // "revise, human please look" so the supervisor doesn't blindly retry.
      return {
        runId,
        kind,
        draftCount: drafts.length,
        overallScore: 75,
        verdict: "revise" as const,
        issues: [
          {
            severity: "major" as const,
            target: "(evaluator)",
            problem: "Evaluator did not return a structured report.",
            suggestion: "Recommend a manual review of the draft contents.",
          },
        ],
        feedbackForRegeneration: "",
      };
    }

    return {
      runId,
      kind,
      draftCount: drafts.length,
      ...report,
    };
  },
});
