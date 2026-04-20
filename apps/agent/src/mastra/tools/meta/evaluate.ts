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
      ? "角色清单"
      : kind === "episode"
        ? "分集大纲"
        : kind === "script"
          ? "剧本"
          : "分镜";
  return [
    `请评审以下 ${drafts.length} 条【${label}】草稿，按你 system prompt 规定的 JSON 结构返回报告。`,
    "",
    "草稿内容：",
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
    "对某个 workflow run 产出的 draft 做质量评审（调 evaluator persona），拿到 overallScore / verdict / 具体 issues / feedbackForRegeneration。verdict=rework 时可以把 feedback 塞回对应 workflow 的 feedback 参数重跑一轮。",
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
            problem: `Run ${runId} 下没有 ${kind} 草稿可评。`,
            suggestion: "先 invoke 对应 workflow 生成草稿再评审。",
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
            problem: "Evaluator 未返回结构化报告。",
            suggestion: "建议人工检查草稿内容。",
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
