/**
 * Which models can actually drive Agent OS?
 *
 *   npm run probe:models -w agent-os -- qwen3.7-plus deepseek-v4-pro glm-5.2
 *
 * The catalog says a model exists; it does not say the model can hold a tool
 * contract. This runs the real graph against each one — read a script section,
 * propose a write, pause for approval, resume, land the write — and reports the
 * three ways a model fails us:
 *
 *   1. the provider rejects `parallel_tool_calls: false`, which every write
 *      depends on (approving a turn that proposed two writes replays the first)
 *   2. the model never calls the tool, or invents a name that is not bound
 *   3. the arguments do not satisfy the tool's schema
 *
 * Uses the in-memory domain, so nothing touches the database.
 */
import { MemorySaver } from "@langchain/langgraph";
import {
  createLiteLlmChatModel,
  loadModelProfiles,
  readLiteLlmConfigFromEnv,
} from "@repo/model-router";

import { InMemoryStoryDomain } from "../src/runtime/in-memory-domain.js";
import { LangGraphRunService } from "../src/runtime/langgraph-run-service.js";

const PROJECT = "22222222-2222-4222-8222-222222222222";
const ATTACHMENT = "33333333-3333-4333-8333-333333333333";

const CANDIDATES = process.argv.slice(2).filter((arg) => !arg.startsWith("-"));
if (CANDIDATES.length === 0) {
  process.stderr.write("usage: npm run probe:models -w agent-os -- <model> [<model> …]\n");
  process.exit(2);
}

type Verdict = {
  model: string;
  ok: boolean;
  proposedWrite: boolean;
  wroteAfterApproval: boolean;
  characters: number;
  ms: number;
  failure?: string;
};

async function probe(model: string): Promise<Verdict> {
  const started = Date.now();
  const verdict: Verdict = {
    model,
    ok: false,
    proposedWrite: false,
    wroteAfterApproval: false,
    characters: 0,
    ms: 0,
  };

  try {
    const domain = new InMemoryStoryDomain();
    domain.setScript("林黛玉自贾母处来，贾宝玉笑道：妹妹来了。王熙凤协理宁国府，处事干练。", 120);

    // The profile table is keyed by our own ids; this probe addresses the
    // provider's model directly, through the same constructor the app uses so
    // modelKwargs (parallel_tool_calls) travel with it.
    const base = readLiteLlmConfigFromEnv();
    const chat = createLiteLlmChatModel({
      profileId: loadModelProfiles()[0]!.id,
      config: base,
    });
    chat.model = model;
    chat.modelName = model;

    const service = new LangGraphRunService();
    const checkpointer = new MemorySaver();
    const runId = crypto.randomUUID();
    const conversationId = crypto.randomUUID();
    const sessionId = `agent-os:v1:conversation:${conversationId}`;

    const first = await service.start({
      runId,
      conversationId,
      projectId: PROJECT,
      actorId: "probe",
      sessionId,
      message: [
        `请根据已上传剧本（attachmentId=${ATTACHMENT}）分析主要角色，`,
        "先用 script_readSection 读取 sectionIndex=0，",
        "再调用 characters_upsert 把角色写入项目（baseRevision 用 0，intent=create）。",
        "角色 id 用拼音小写加连字符，如 lin-daiyu。",
      ].join(""),
      modelProfileId: loadModelProfiles()[0]!.id,
      projectKind: "platform",
      workbenchMode: "brief",
      model: chat,
      domain,
      checkpointer,
    });

    verdict.proposedWrite = first.status === "waiting_for_approval";
    if (!verdict.proposedWrite) {
      verdict.failure =
        first.status === "failed"
          ? (first.errorMessage ?? "run failed")
          : `never proposed a write (status=${first.status})`;
      verdict.ms = Date.now() - started;
      return verdict;
    }

    const resumed = await service.resumeApproval({
      runId,
      sessionId,
      conversationId,
      decision: "approve",
      modelProfileId: loadModelProfiles()[0]!.id,
      model: chat,
      domain,
      checkpointer,
      projectId: PROJECT,
      actorId: "probe",
    });

    verdict.characters = domain.characters.size;
    verdict.wroteAfterApproval = verdict.characters > 0;
    verdict.ok = resumed.status === "completed" && verdict.wroteAfterApproval;
    if (!verdict.ok) {
      verdict.failure =
        resumed.errorMessage ?? `resume ended as ${resumed.status}, wrote ${verdict.characters}`;
    }
  } catch (error) {
    verdict.failure = error instanceof Error ? error.message : String(error);
  }

  verdict.ms = Date.now() - started;
  return verdict;
}

async function main(): Promise<void> {
  const results: Verdict[] = [];
  for (const model of CANDIDATES) {
    process.stdout.write(`→ ${model} …\n`);
    const verdict = await probe(model);
    results.push(verdict);
    process.stdout.write(`${JSON.stringify(verdict)}\n`);
  }

  process.stdout.write("\n");
  process.stdout.write("model                          tools  write  chars  ms\n");
  for (const r of results) {
    process.stdout.write(
      `${r.model.padEnd(30)} ${(r.proposedWrite ? "yes" : "NO ").padEnd(6)} ` +
        `${(r.wroteAfterApproval ? "yes" : "NO ").padEnd(6)} ` +
        `${String(r.characters).padEnd(6)} ${r.ms}\n`
    );
    if (r.failure) process.stdout.write(`   ↳ ${r.failure}\n`);
  }

  const usable = results.filter((r) => r.ok).map((r) => r.model);
  process.stdout.write(`\nusable: ${usable.join(", ") || "(none)"}\n`);
}

void main();
