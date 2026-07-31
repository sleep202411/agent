import type { UIMessage } from "ai";
import { describe, expect, it } from "vitest";

import { createAgentRequestContext, type AgentSessionContext } from "../context/agent-context.js";
import {
  INTERACTIVE_THINKING_BUDGET_TOKENS,
  classifyInferenceTier,
  createInferenceModelRouter,
  inferenceThinkingProviderOptions,
  writeInferenceTier,
} from "./inference-policy.js";

const sessionContext: AgentSessionContext = {
  actorId: "actor-1",
  actorDisplayName: "Actor One",
  conversationId: "0197f4a2-0800-7000-8000-000000000004",
  sessionName: "agent:v1:conversation:0197f4a2-0800-7000-8000-000000000004",
  permissionMode: "smart",
  locale: "zh-CN",
  roles: ["creator"],
  permissions: ["story.read", "story.write"],
  traceId: "trace-1",
  surface: "story-studio",
  scope: {
    kind: "story-project",
    workspaceId: "workspace-1",
    projectId: "project-1",
  },
};

describe("inference policy", () => {
  it("keeps greetings and focused canvas actions on the interactive path", () => {
    expect(classifyInferenceTier([userMessage("你好")])).toBe("interactive");
    expect(classifyInferenceTier([userMessage("添加一个节点我看看")])).toBe("interactive");
  });

  it("routes source material and explicit deep analysis to reasoning", () => {
    expect(
      classifyInferenceTier([
        {
          id: "message-file",
          role: "user",
          parts: [
            {
              type: "file",
              mediaType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
              filename: "script.docx",
              url: "fizzdragon-media://0197f4a2-0800-7000-8000-000000000009",
            },
          ],
        },
      ])
    ).toBe("reasoning");
    expect(classifyInferenceTier([userMessage("请全面分析并拆解这部长篇剧本")])).toBe("reasoning");
  });

  it("routes long inline instructions to reasoning", () => {
    expect(classifyInferenceTier([userMessage("a".repeat(1_200))])).toBe("reasoning");
  });

  it("caps interactive thinking while leaving reasoning turns dynamic", () => {
    expect(inferenceThinkingProviderOptions("interactive")).toEqual({
      google: { thinkingConfig: { thinkingBudget: INTERACTIVE_THINKING_BUDGET_TOKENS } },
    });
    expect(inferenceThinkingProviderOptions("reasoning")).toBeUndefined();
  });

  it("keeps the interactive budget above gemini-2.5-pro's enforced minimum", () => {
    // Vertex rejects thinkingBudget below 128 on the pro model. The budget is
    // shared policy, so keep it in the range every routed model accepts while
    // still bounding the pre-first-token thinking delay.
    expect(INTERACTIVE_THINKING_BUDGET_TOKENS).toBeGreaterThanOrEqual(128);
    expect(INTERACTIVE_THINKING_BUDGET_TOKENS).toBeLessThanOrEqual(512);
  });

  it("selects only from the trusted internal request context", () => {
    const requestContext = createAgentRequestContext(sessionContext);
    const interactive = { modelId: "interactive" } as never;
    const reasoning = { modelId: "reasoning" } as never;
    const router = createInferenceModelRouter({ interactive, reasoning });

    expect(router({ requestContext })).toBe(interactive);
    writeInferenceTier(requestContext, "reasoning");
    expect(router({ requestContext })).toBe(reasoning);
  });
});

function userMessage(text: string): UIMessage {
  return {
    id: `message-${text.length}`,
    role: "user",
    parts: [{ type: "text", text }],
  };
}
