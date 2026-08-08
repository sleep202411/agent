import { AIMessage } from "@langchain/core/messages";
import { fakeModel } from "@langchain/core/testing";
import { MemorySaver } from "@langchain/langgraph";
import { describe, expect, it } from "vitest";

import { InMemoryStoryDomain } from "./in-memory-domain.js";
import { LangGraphRunService } from "./langgraph-run-service.js";

const PROJECT = "22222222-2222-4222-8222-222222222222";
const CONVERSATION = "33333333-3333-4333-8333-333333333333";
const ATTACHMENT = "00000000-0000-4000-8000-000000000001";

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
      surface: "storyboard",
      model,
      domain,
      checkpointer,
      mode: "ASSIST",
      permissionMode: "smart",
    });

    expect(first.status).toBe("waiting_for_approval");
    expect(first.pendingApproval?.toolId).toBe("characters.upsert");
    // Surface must survive HITL pause (resume remounts tools from this field).
    expect(first.surface).toBe("storyboard");
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
    expect(second.surface).toBe("storyboard");
    expect(domain.characters.size).toBe(2);
    expect(domain.characters.get("lin-daiyu")?.name["zh-CN"]).toBe("林黛玉");
    expect(second.assistantText).toMatch(/角色/);
    expect(second.journal.all().map((e) => e.type)).toContain("RunCompleted");
    // After approve, the write tool finishes and lands ToolCompleted in the journal.
    expect(second.journal.all().map((e) => e.type)).toContain("ToolCompleted");
  });

  it("preserves non-default surface (brief) across HITL pause + approve", async () => {
    const domain = new InMemoryStoryDomain();
    domain.setScript("角色甲。", 80);

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
      .respond(new AIMessage("已写入。"));

    const service = new LangGraphRunService();
    const checkpointer = new MemorySaver();
    const runId = crypto.randomUUID();
    const conversationId = crypto.randomUUID();

    const paused = await service.start({
      runId,
      conversationId,
      projectId: PROJECT,
      actorId: "user-1",
      sessionId: `agent-os:v1:conversation:${conversationId}`,
      message: "写入角色",
      modelProfileId: "qwen-plus",
      surface: "brief",
      model,
      domain,
      checkpointer,
      mode: "ASSIST",
      permissionMode: "smart",
    });

    expect(paused.status).toBe("waiting_for_approval");
    expect(paused.surface).toBe("brief");

    const done = await service.resumeApproval({
      runId,
      sessionId: `agent-os:v1:conversation:${conversationId}`,
      conversationId,
      decision: "approve",
      modelProfileId: "qwen-plus",
      model,
      domain,
      checkpointer,
      projectId: PROJECT,
      actorId: "user-1",
    });

    expect(done.status).toBe("completed");
    expect(done.surface).toBe("brief");
    expect(domain.characters.size).toBe(1);
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
      surface: "storyboard",
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
    const types = cancelled.journal.all().map((e) => e.type);
    expect(types).toContain("ApprovalResolved");
    expect(types).toContain("ToolFailed");
    expect(types).toContain("RunCancelled");
    const failed = cancelled.journal.all().find((e) => e.type === "ToolFailed");
    expect(failed?.data).toMatchObject({
      code: "APPROVAL_REJECTED",
      toolId: "characters.upsert",
    });
  });
});

describe("LangGraph cancel", () => {
  it("cancel marks running run cancelled without writing tools", async () => {
    const domain = new InMemoryStoryDomain();
    // Never-resolving tool path is hard with fakeModel; cancel after start
    // while status is still running/queued from beginStart is enough.
    const model = fakeModel().respond(new AIMessage("still thinking…"));
    const service = new LangGraphRunService();
    const checkpointer = new MemorySaver();
    const runId = crypto.randomUUID();

    const begun = service.beginStart({
      runId,
      conversationId: CONVERSATION,
      projectId: PROJECT,
      actorId: "user-1",
      sessionId: `agent-os:v1:conversation:${CONVERSATION}`,
      message: "hello",
      modelProfileId: "qwen-plus",
      surface: "storyboard",
      model,
      domain,
      checkpointer,
    });
    expect(begun.status).toBe("running");

    const cancelled = service.cancel(runId, "Stopped");
    expect(cancelled?.status).toBe("cancelled");
    expect(service.getSnapshot(runId)?.status).toBe("cancelled");
    expect(cancelled?.journal.all().map((e) => e.type)).toContain("RunCancelled");

    // Idempotent: already terminal stays cancelled
    const again = service.cancel(runId);
    expect(again?.status).toBe("cancelled");
  });
});

describe("LangGraph golden path: script → storyboard shots", () => {
  it("interrupts on storyboard_upsert_shots, then writes after approve", async () => {
    const domain = new InMemoryStoryDomain();
    domain.setScript("夜雨中，林黛玉撑伞走过曲径。贾宝玉立于廊下。", 80);

    const model = fakeModel()
      .respondWithTools([
        {
          // LangChain names use `_` for `.` only — keep camelCase segments.
          name: "storyboard_listShots",
          id: "tc-list",
          args: {},
        },
      ])
      .respondWithTools([
        {
          name: "storyboard_upsertShots",
          id: "tc-shots",
          args: {
            baseRevision: 0,
            shots: [
              {
                id: "shot-01",
                title: "夜雨曲径",
                prompt: "Wide shot, rain, figure with umbrella on stone path",
                notes: "cold palette",
                intent: "create",
              },
              {
                id: "shot-02",
                title: "廊下对望",
                prompt: "Medium shot, young man under porch watching rain",
                intent: "create",
              },
            ],
          },
        },
      ])
      .respond(new AIMessage("已写入两个分镜镜头。"));

    const service = new LangGraphRunService();
    const checkpointer = new MemorySaver();
    const runId = crypto.randomUUID();

    const first = await service.start({
      runId,
      conversationId: CONVERSATION,
      projectId: PROJECT,
      actorId: "user-1",
      sessionId: `agent-os:v1:conversation:${CONVERSATION}`,
      message: "把剧本拆成 storyboard shots 并写入",
      modelProfileId: "qwen-plus",
      surface: "storyboard",
      model,
      domain,
      checkpointer,
    });

    expect(first.status).toBe("waiting_for_approval");
    expect(first.pendingApproval?.toolId).toBe("storyboard.upsertShots");
    expect(domain.shots.size).toBe(0);

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
    expect(domain.shots.size).toBe(2);
    expect(domain.shots.get("shot-01")?.title).toBe("夜雨曲径");
  });
});
