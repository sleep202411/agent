/**
 * Live end-to-end: real Qwen + LangGraph tools + approval + domain write.
 *
 *   npm run live:golden -w agent-os
 *
 * Requires apps/agent-os/.env (Qwen credentials). Not run in CI by default.
 */
import { MemorySaver } from "@langchain/langgraph";
import { createLiteLlmChatModel, readLiteLlmConfigFromEnv } from "@repo/model-router";

import { InMemoryStoryDomain } from "../src/runtime/in-memory-domain.js";
import { LangGraphRunService } from "../src/runtime/langgraph-run-service.js";

const PROJECT = "22222222-2222-4222-8222-222222222222";
const CONVERSATION = crypto.randomUUID();
const ATTACHMENT = crypto.randomUUID();

async function main(): Promise<void> {
  const cfg = readLiteLlmConfigFromEnv();
  const model = createLiteLlmChatModel({
    profileId: "qwen-plus",
    config: cfg,
  });

  const domain = new InMemoryStoryDomain();
  domain.setScript(
    [
      "第一回",
      "林黛玉自贾母处来，贾宝玉见黛玉，笑道：妹妹来了。",
      "王熙凤协理宁国府，处事干练。",
      "薛宝钗稳重端庄。",
    ].join("\n"),
    120,
  );

  const service = new LangGraphRunService();
  const checkpointer = new MemorySaver();
  const runId = crypto.randomUUID();
  const sessionId = `agent-os:v1:conversation:${CONVERSATION}`;

  process.stdout.write(
    `${JSON.stringify({
      level: "info",
      msg: "live-golden.start",
      runId,
      baseUrl: cfg.baseUrl,
    })}\n`,
  );

  const first = await service.start({
    runId,
    conversationId: CONVERSATION,
    projectId: PROJECT,
    actorId: "live-dev-user",
    sessionId,
    message: [
      `请根据已上传剧本（attachmentId=${ATTACHMENT}）分析主要角色，`,
      "先用 script_read_section 读取 sectionIndex=0，",
      "再调用 characters_upsert 把角色写入项目（baseRevision 用 0，intent=create）。",
      "角色 id 用拼音小写加连字符，如 lin-daiyu。",
    ].join(""),
    modelProfileId: "qwen-plus",
    model,
    domain,
    checkpointer,
    mode: "ASSIST",
    permissionMode: "smart",
  });

  process.stdout.write(
    `${JSON.stringify({
      level: "info",
      msg: "live-golden.after-start",
      status: first.status,
      pendingTool: first.pendingApproval?.toolId,
      eventTypes: first.journal.all().map((e) => e.type),
      characterCount: domain.characters.size,
    })}\n`,
  );

  if (first.status === "waiting_for_approval" && first.pendingApproval) {
    const second = await service.resumeApproval({
      runId,
      sessionId,
      conversationId: CONVERSATION,
      decision: "approve",
      modelProfileId: "qwen-plus",
      model,
      domain,
      checkpointer,
      projectId: PROJECT,
      actorId: "live-dev-user",
    });

    process.stdout.write(
      `${JSON.stringify({
        level: "info",
        msg: "live-golden.after-approve",
        status: second.status,
        assistantText: second.assistantText,
        characters: [...domain.characters.values()].map((c) => ({
          id: c.id,
          name: c.name,
        })),
        eventTypes: second.journal.all().map((e) => e.type),
      })}\n`,
    );

    if (domain.characters.size < 1) {
      throw new Error("Expected at least one character written after approval");
    }
    if (second.status !== "completed") {
      throw new Error(`Expected completed, got ${second.status}`);
    }
  } else if (first.status === "completed" && domain.characters.size > 0) {
    process.stdout.write(
      `${JSON.stringify({
        level: "info",
        msg: "live-golden.completed-without-pause",
        characters: [...domain.characters.keys()],
      })}\n`,
    );
  } else {
    throw new Error(
      `Unexpected terminal state status=${first.status} chars=${domain.characters.size}`,
    );
  }

  process.stdout.write(
    `${JSON.stringify({ level: "info", msg: "live-golden.ok" })}\n`,
  );
}

main().catch((error) => {
  process.stderr.write(
    `${JSON.stringify({
      level: "error",
      msg: "live-golden.failed",
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    })}\n`,
  );
  process.exitCode = 1;
});
