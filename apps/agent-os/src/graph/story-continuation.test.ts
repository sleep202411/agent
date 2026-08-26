import { HumanMessage } from "@langchain/core/messages";
import { fakeModel } from "@langchain/core/testing";
import { MemorySaver } from "@langchain/langgraph";
import type { DomainPort } from "@repo/agent-tools";
import { describe, expect, it } from "vitest";

import { createAgentOsGraph } from "./create-agent-graph.js";

const PROJECT_ID = "22222222-2222-4222-8222-222222222222";
const CHAPTER_ID = "33333333-3333-4333-8333-333333333333";
const RESPONSE_ID = "44444444-4444-4444-8444-444444444444";
const NEXT_RUN_ID = "55555555-5555-4555-8555-555555555555";

describe("durable Story production continuation", () => {
  it("reads canonical state and starts exactly one next proposal inside the saved scope", async () => {
    const observed: Array<{ toolId: string; input: unknown }> = [];
    const domain: DomainPort = {
      async execute(toolId, input) {
        observed.push({ toolId, input });
        if (toolId === "story.read") {
          return {
            ok: true,
            data: storyReadResult({
              assets: "current",
              plot: "missing",
              storyboard: "missing",
            }),
          };
        }
        expect(toolId).toBe("story.author");
        const startedMessage = (input as { startedMessage: string }).startedMessage;
        return {
          ok: true,
          data: {
            runId: NEXT_RUN_ID,
            status: "authoring",
            agentHandoff: {
              kind: "external_job",
              jobId: NEXT_RUN_ID,
              startedMessage,
            },
          },
        };
      },
    };
    const graph = createAgentOsGraph({
      model: fakeModel(),
      projectKind: "story",
      workbenchMode: "story",
      checkpointer: new MemorySaver(),
      runtime: continuationRuntime(domain),
    });

    const result = await graph.invoke(
      { messages: [new HumanMessage("asset approval committed")] },
      { configurable: { thread_id: "story-continuation-next" } }
    );

    expect(observed.map(({ toolId }) => toolId)).toEqual(["story.read", "story.author"]);
    expect(observed[1]?.input).toEqual({
      continueThrough: "storyboard",
      title: "Night Watch",
      summary: "Complete the remaining reviewable production specifications.",
      brief: "Continue through Storyboard Specs, pausing for every approval.",
      startedMessage: "已开始准备下一份可审核的制作规格；本阶段不会生成任何图片或视频。",
      completionMessage: "下一份制作规格提案已准备好供你审核；本阶段没有生成任何图片或视频。",
    });
    expect(result.messages.at(-1)?.content).toBe(
      "下一份可审核的制作规格已由服务端受理；本阶段不会生成任何图片或视频。"
    );
  });

  it("stops after the saved target without calling story.author", async () => {
    const observed: string[] = [];
    const domain: DomainPort = {
      async execute(toolId) {
        observed.push(toolId);
        return {
          ok: true,
          data: storyReadResult({
            assets: "current",
            plot: "current",
            storyboard: "missing",
          }),
        };
      },
    };
    const graph = createAgentOsGraph({
      model: fakeModel(),
      projectKind: "story",
      workbenchMode: "story",
      checkpointer: new MemorySaver(),
      runtime: continuationRuntime(domain, "assets"),
    });

    const result = await graph.invoke(
      { messages: [new HumanMessage("asset approval committed")] },
      { configurable: { thread_id: "story-continuation-complete" } }
    );

    expect(observed).toEqual(["story.read"]);
    expect(result.messages.at(-1)?.content).toBe(
      "你要求的制作规格范围已经完成，当前没有后续阶段在运行。"
    );
  });

  it("advances every separately approved stage across terminal graph cycles", async () => {
    const checkpointer = new MemorySaver();
    const threadId = "story-continuation-multi-stage";
    const observed: string[] = [];
    const production = {
      assets: "missing" as "missing" | "current" | "stale",
      plot: "missing" as "missing" | "current" | "stale",
      storyboard: "missing" as "missing" | "current" | "stale",
    };
    const domain: DomainPort = {
      async execute(toolId) {
        observed.push(toolId);
        if (toolId === "story.read") {
          return { ok: true, data: storyReadResult(production) };
        }
        const nextStage =
          production.plot !== "current"
            ? "plot"
            : production.assets !== "current"
              ? "assets"
              : "storyboard";
        return {
          ok: true,
          data: {
            runId: NEXT_RUN_ID,
            status: "authoring",
            stage: nextStage,
            agentHandoff: {
              kind: "external_job",
              jobId: NEXT_RUN_ID,
              startedMessage: `Preparing ${nextStage}.`,
            },
          },
        };
      },
    };
    const responses = [
      "44444444-4444-4444-8444-444444444441",
      "44444444-4444-4444-8444-444444444442",
      "44444444-4444-4444-8444-444444444443",
      "44444444-4444-4444-8444-444444444444",
    ];

    for (const [index, responseId] of responses.entries()) {
      const graph = createAgentOsGraph({
        model: fakeModel(),
        projectKind: "story",
        workbenchMode: "story",
        checkpointer,
        runtime: continuationRuntime(domain, "storyboard", responseId),
      });
      await graph.invoke(
        {
          messages: [
            new HumanMessage({
              id: responseId,
              content: "Continue from canonical Story state.",
            }),
          ],
        },
        { configurable: { thread_id: threadId } }
      );
      if (index === 0) production.plot = "current";
      if (index === 1) production.assets = "current";
      if (index === 2) production.storyboard = "current";
    }

    expect(observed).toEqual([
      "story.read",
      "story.author",
      "story.read",
      "story.author",
      "story.read",
      "story.author",
      "story.read",
    ]);
  });
});

function continuationRuntime(
  domain: DomainPort,
  continueThrough: "plot" | "assets" | "storyboard" = "storyboard",
  responseId = RESPONSE_ID
) {
  return {
    runId: "66666666-6666-4666-8666-666666666666",
    turnId: "77777777-7777-4777-8777-777777777777",
    conversationId: "88888888-8888-4888-8888-888888888888",
    projectId: PROJECT_ID,
    actorId: "creator-1",
    skillResolutionId: "99999999-9999-4999-8999-999999999999",
    skillVersionIds: [],
    agentMode: "AUTOPILOT" as const,
    permissionMode: "full" as const,
    domain,
    storyContinuation: {
      responseId,
      locale: "zh-CN" as const,
      plan: {
        continueThrough,
        title: "Night Watch",
        summary: "Complete the remaining reviewable production specifications.",
        brief: "Continue through Storyboard Specs, pausing for every approval.",
      },
    },
  };
}

function storyReadResult(input: {
  assets: "missing" | "current" | "stale";
  plot: "missing" | "current" | "stale";
  storyboard: "missing" | "current" | "stale";
}) {
  return {
    chapterId: CHAPTER_ID,
    draftRevision: 3,
    contentHash: "a".repeat(64),
    storyBible: { logline: "Night watch.", synopsis: "", characters: [] },
    graph: { entryNodeId: null, nodes: [] },
    productionNotes: [],
    productionState: {
      projectId: PROJECT_ID,
      chapterId: CHAPTER_ID,
      profile: { status: "current" },
      script: {
        status: "current",
        documentId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        sequence: 1,
      },
      plotTree: { status: input.plot, nodeCount: input.plot === "current" ? 2 : 0 },
      assets: {
        status: input.assets,
        currentCount: input.assets === "current" ? 3 : 0,
        staleCount: input.assets === "stale" ? 3 : 0,
      },
      storyboard: {
        status: input.storyboard,
        sequenceCount: input.storyboard === "current" ? 2 : 0,
        staleCount: input.storyboard === "stale" ? 2 : 0,
        missingPlotNodeIds: [],
      },
      ready:
        input.assets === "current" && input.plot === "current" && input.storyboard === "current",
    },
    creativeProfile: {
      frameProfile: "portrait_9_16",
      durationPreset: "short_5_15",
      visualStyle: "cinematic-realism",
      storyLanguage: "zh-CN",
      confirmed: true,
    },
    authoringRun: null,
  };
}
