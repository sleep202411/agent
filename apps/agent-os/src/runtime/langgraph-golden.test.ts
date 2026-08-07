import { AIMessage } from "@langchain/core/messages";
import { fakeModel } from "@langchain/core/testing";
import { MemorySaver } from "@langchain/langgraph";
import { describe, expect, it } from "vitest";

import { InMemoryStoryDomain } from "./in-memory-domain.js";
import { LangGraphRunService } from "./langgraph-run-service.js";

const PROJECT = "22222222-2222-4222-8222-222222222222";
const CONVERSATION = "33333333-3333-4333-8333-333333333333";
const ATTACHMENT = "44444444-4444-4444-8444-444444444444";

describe("LangGraph golden path: script → characters", () => {
  it("interrupts on characters_upsert, then writes after approve", async () => {
    const domain = new InMemoryStoryDomain();
    domain.setScript("林黛玉与贾宝玉在贾府相遇。王熙凤协理宁国府。", 80);

    const model = fakeModel()
      .respondWithTools([
        {
          name: "script_read_section",
          id: "tc-read",
          args: {
            attachmentId: ATTACHMENT,
            sectionIndex: 0,
            maxChars: 8000,
          },
        },
      ])
      .respondWithTools([
        {
          name: "characters_upsert",
          id: "tc-upsert",
          args: {
            baseRevision: 0,
            characters: [
              {
                id: "lin-daiyu",
                name: { "zh-CN": "林黛玉" },
                summary: "贾母外孙女。",
                intent: "create",
              },
              {
                id: "jia-baoyu",
                name: { "zh-CN": "贾宝玉" },
                summary: "荣国府公子。",
                intent: "create",
              },
            ],
          },
        },
      ])
      .respond(new AIMessage("已写入林黛玉、贾宝玉两个角色。"));

    const service = new LangGraphRunService();
    const checkpointer = new MemorySaver();
    const runId = crypto.randomUUID();

    const first = await service.start({
      runId,
      conversationId: CONVERSATION,
      projectId: PROJECT,
      actorId: "user-1",
      sessionId: `agent-os:v1:conversation:${CONVERSATION}`,
      message: "请根据剧本分析角色并写入项目",
      modelProfileId: "qwen-plus",
      model,
      domain,
      checkpointer,
      mode: "ASSIST",
      permissionMode: "smart",
    });

    expect(first.status).toBe("waiting_for_approval");
    expect(first.pendingApproval?.toolId).toBe("characters.upsert");
    expect(domain.characters.size).toBe(0);
    expect(first.journal.all().map((e) => e.type)).toContain("ApprovalRequired");

    const second = await service.resumeApproval({
      runId,
      sessionId: `agent-os:v1:conversation:${CONVERSATION}`,
      conversationId: CONVERSATION,
      decision: "approve",
      modelProfileId: "qwen-plus",
      model,
      domain,
      checkpointer,
      projectId: PROJECT,
      actorId: "user-1",
    });

    expect(second.status).toBe("completed");
    expect(domain.characters.size).toBe(2);
    expect(domain.characters.get("lin-daiyu")?.name["zh-CN"]).toBe("林黛玉");
    expect(second.assistantText).toMatch(/角色/);
    expect(second.journal.all().map((e) => e.type)).toContain("RunCompleted");
  });

  it("reject leaves database unchanged", async () => {
    const domain = new InMemoryStoryDomain();
    domain.setScript("角色甲。");

    const model = fakeModel()
      .respondWithTools([
        {
          name: "characters_upsert",
          id: "tc-1",
          args: {
            baseRevision: 0,
            characters: [
              {
                id: "role-a",
                name: { "zh-CN": "角色甲" },
                summary: "路人",
                intent: "create",
              },
            ],
          },
        },
      ])
      .respond(new AIMessage("should not reach"));

    const service = new LangGraphRunService();
    const checkpointer = new MemorySaver();
    const runId = crypto.randomUUID();

    const paused = await service.start({
      runId,
      conversationId: CONVERSATION,
      projectId: PROJECT,
      actorId: "user-1",
      sessionId: `agent-os:v1:conversation:${CONVERSATION}`,
      message: "写入角色",
      modelProfileId: "qwen-plus",
      model,
      domain,
      checkpointer,
    });

    expect(paused.status).toBe("waiting_for_approval");

    const cancelled = await service.resumeApproval({
      runId,
      sessionId: `agent-os:v1:conversation:${CONVERSATION}`,
      conversationId: CONVERSATION,
      decision: "reject",
      modelProfileId: "qwen-plus",
      model,
      domain,
      checkpointer,
      projectId: PROJECT,
      actorId: "user-1",
    });

    expect(cancelled.status).toBe("cancelled");
    expect(domain.characters.size).toBe(0);
  });
});
