import { describe, expect, it } from "vitest";

import { InMemoryStoryDomain } from "./in-memory-domain.js";
import { TurnRunner } from "./turn-runner.js";

const PROJECT = "22222222-2222-4222-8222-222222222222";
const CONVERSATION = "33333333-3333-4333-8333-333333333333";
const ATTACHMENT = "44444444-4444-4444-8444-444444444444";
const RUN = "55555555-5555-4555-8555-555555555555";

/**
 * Golden use case A (docs/agent-os/PRODUCT.md):
 * Upload script → analyze characters → write into project DB.
 *
 * LLM planning is injected as a fixed tool plan so we test the execution spine.
 */
describe("golden path: script → characters → domain", () => {
  it("reads script, requires approval, writes characters once, idempotent replay", async () => {
    const domain = new InMemoryStoryDomain();
    domain.setScript("林黛玉自贾母处来。贾宝玉见黛玉，笑道：妹妹来了。王熙凤协理宁国府。", 50);

    const runner = new TurnRunner({
      sessionId: `agent-os:v1:conversation:${CONVERSATION}`,
      runId: RUN,
      conversationId: CONVERSATION,
      projectId: PROJECT,
      actorId: "user-1",
      skillResolutionId: "00000000-0000-4000-8000-000000000001",
      skillVersionIds: [],
      mode: "ASSIST",
      permissionMode: "smart",
      domain,
    });

    const upsertCall = {
      toolCallId: "call-upsert-1",
      toolId: "characters.upsert",
      arguments: {
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
    };

    const first = await runner.run({
      planSteps: [
        "Read uploaded script sections",
        "Extract cast list",
        "Write characters into project (requires approval)",
      ],
      toolCalls: [
        {
          toolCallId: "call-read-0",
          toolId: "script.readSection",
          arguments: {
            attachmentId: ATTACHMENT,
            sectionIndex: 0,
            maxChars: 8000,
          },
        },
        upsertCall,
      ],
      assistantText: "已根据剧本写入 2 个角色。",
    });

    expect(first.status).toBe("waiting_for_approval");
    expect(first.pendingApproval?.toolId).toBe("characters.upsert");
    expect(domain.characters.size).toBe(0);

    const types = first.journal.all().map((e) => e.type);
    expect(types).toContain("RunStarted");
    expect(types).toContain("PlanCreated");
    expect(types).toContain("ToolCompleted"); // readSection
    expect(types).toContain("ApprovalRequired");
    expect(types).toContain("RunPaused");

    const resumed = await runner.resumeAfterApproval({
      approvalId: first.pendingApproval!.approvalId,
      decision: "approve",
      toolCall: {
        ...upsertCall,
        arguments: first.pendingApproval!.arguments,
      },
      remainingToolCalls: first.remainingToolCalls,
      assistantText: "已根据剧本写入 2 个角色。",
    });

    expect(resumed.status).toBe("completed");
    expect(domain.characters.size).toBe(2);
    expect(domain.characters.get("lin-daiyu")?.name["zh-CN"]).toBe("林黛玉");
    expect(domain.revision).toBe(1);

    const completedTypes = resumed.journal.all().map((e) => e.type);
    expect(completedTypes).toContain("ApprovalResolved");
    expect(completedTypes).toContain("ProjectPatchApplied");
    expect(completedTypes).toContain("RunCompleted");

    // Idempotent replay of the same domain call key
    const replay = await domain.execute("characters.upsert", first.pendingApproval!.arguments, {
      runId: RUN,
      conversationId: CONVERSATION,
      projectId: PROJECT,
      actorId: "user-1",
      skillResolutionId: "00000000-0000-4000-8000-000000000001",
      skillVersionIds: [],
      toolCallId: "call-upsert-1",
      idempotencyKey: `${PROJECT}:${RUN}:call-upsert-1:v1`,
    });
    expect(replay.ok).toBe(true);
    expect(domain.characters.size).toBe(2);
    expect(domain.revision).toBe(1);
  });

  it("reject approval → zero domain writes", async () => {
    const domain = new InMemoryStoryDomain();
    domain.setScript("角色甲登场。");

    const runner = new TurnRunner({
      sessionId: `agent-os:v1:conversation:${CONVERSATION}`,
      runId: crypto.randomUUID(),
      conversationId: CONVERSATION,
      projectId: PROJECT,
      actorId: "user-1",
      mode: "ASSIST",
      permissionMode: "smart",
      domain,
    });

    const upsertCall = {
      toolCallId: "call-upsert-reject",
      toolId: "characters.upsert",
      arguments: {
        baseRevision: 0,
        characters: [
          {
            id: "role-a",
            name: { "zh-CN": "角色甲" },
            summary: "路人。",
            intent: "create",
          },
        ],
      },
    };

    const paused = await runner.run({
      toolCalls: [upsertCall],
    });
    expect(paused.status).toBe("waiting_for_approval");

    const cancelled = await runner.resumeAfterApproval({
      approvalId: paused.pendingApproval!.approvalId,
      decision: "reject",
      toolCall: upsertCall,
      remainingToolCalls: [],
    });

    expect(cancelled.status).toBe("cancelled");
    expect(domain.characters.size).toBe(0);
  });
});
