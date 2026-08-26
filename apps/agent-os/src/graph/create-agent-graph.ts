import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { AIMessage, isToolMessage, type BaseMessage } from "@langchain/core/messages";
import { RunnableLambda } from "@langchain/core/runnables";
import type { BaseCheckpointSaver } from "@langchain/langgraph-checkpoint";
import { MemorySaver } from "@langchain/langgraph";
import { createReactAgent } from "@langchain/langgraph/prebuilt";
import type { AgentProjectKind } from "@repo/agent-capabilities";
import {
  resolveSkillMounts,
  type ProjectSkillResolutionSnapshot,
  type SkillMountContext,
} from "@repo/agent-skills";
import { StoryProductionStateSchema, storyProductionNeedsContinuation } from "@repo/agent-tools";

import { buildLangChainTools, type ToolRuntimeContext } from "./build-langchain-tools.js";
import { toLangChainToolName } from "./tool-name.js";

export function createAgentOsGraph(input: {
  model: BaseChatModel;
  runtime: ToolRuntimeContext;
  projectKind: AgentProjectKind;
  workbenchMode: string;
  /** Per-turn skill ids from composer. Same runtime path as future catalog skills. */
  turnSkillIds?: readonly string[];
  /** Immutable project-installed Skills resolved and signed by Nest. */
  skillMountSnapshot?: ProjectSkillResolutionSnapshot;
  checkpointer?: BaseCheckpointSaver;
}) {
  const mount = resolveAgentOsSkillMount(input);
  const tools = buildLangChainTools(input.runtime, mount.toolIds);
  return createReactAgent({
    llm: input.runtime.storyContinuation
      ? createStoryContinuationModel(input.runtime)
      : input.model,
    tools,
    checkpointSaver: input.checkpointer ?? new MemorySaver(),
    prompt: mount.instructions,
  });
}

/**
 * Post-approval Story advancement is a workflow, not another free-form model
 * turn. The model already converted the creator's request into continueThrough
 * on the first story.author call. Every later boundary therefore performs a
 * real canonical read and either starts exactly one next proposal or closes.
 */
function createStoryContinuationModel(runtime: ToolRuntimeContext) {
  const continuation = runtime.storyContinuation;
  if (!continuation) throw new Error("Story continuation context is required");
  const readToolCallId = `story-read:${continuation.responseId}`;
  const authorToolCallId = `story-author:${continuation.responseId}`;

  return (state: { messages: BaseMessage[] }) =>
    RunnableLambda.from(async () => {
      const authorResult = state.messages.find(
        (message) => isToolMessage(message) && message.tool_call_id === authorToolCallId
      );
      if (authorResult) {
        return new AIMessage(
          storyContinuationCopy(
            continuation.locale,
            toolMessageSucceeded(authorResult.content) ? "started" : "failed"
          )
        );
      }

      const readResult = state.messages.find(
        (message) => isToolMessage(message) && message.tool_call_id === readToolCallId
      );
      if (!readResult) {
        return new AIMessage({
          content: "",
          tool_calls: [
            {
              id: readToolCallId,
              name: toLangChainToolName("story.read"),
              args: {},
              type: "tool_call",
            },
          ],
        });
      }

      const productionState = productionStateFromToolMessage(readResult.content);
      if (!productionState) {
        return new AIMessage(storyContinuationCopy(continuation.locale, "read_failed"));
      }
      if (!storyProductionNeedsContinuation(productionState, continuation.plan.continueThrough)) {
        return new AIMessage(storyContinuationCopy(continuation.locale, "complete"));
      }

      return new AIMessage({
        content: "",
        tool_calls: [
          {
            id: authorToolCallId,
            name: toLangChainToolName("story.author"),
            args: {},
            type: "tool_call",
          },
        ],
      });
    });
}

function productionStateFromToolMessage(content: unknown) {
  if (typeof content !== "string") return null;
  try {
    const result = JSON.parse(content) as {
      ok?: unknown;
      data?: { productionState?: unknown };
    };
    if (result.ok !== true) return null;
    const parsed = StoryProductionStateSchema.safeParse(result.data?.productionState);
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

function toolMessageSucceeded(content: unknown): boolean {
  if (typeof content !== "string") return false;
  try {
    const result = JSON.parse(content) as { ok?: unknown };
    return result.ok === true;
  } catch {
    return false;
  }
}

function storyContinuationCopy(
  locale: "en-US" | "zh-CN" | "zh-HK",
  outcome: "complete" | "started" | "read_failed" | "failed"
) {
  if (locale === "zh-CN") {
    if (outcome === "complete") return "你要求的制作规格范围已经完成，当前没有后续阶段在运行。";
    if (outcome === "started")
      return "下一份可审核的制作规格已由服务端受理；本阶段不会生成任何图片或视频。";
    if (outcome === "read_failed")
      return "无法读取当前项目的权威制作状态，因此没有启动下一阶段。请重试。";
    return "下一阶段没有成功启动，当前没有后台制作任务在运行。请重试。";
  }
  if (locale === "zh-HK") {
    if (outcome === "complete") return "你要求的製作規格範圍已經完成，目前沒有後續階段在運行。";
    if (outcome === "started")
      return "下一份可審核的製作規格已由服務端受理；本階段不會生成任何圖片或影片。";
    if (outcome === "read_failed")
      return "無法讀取目前專案的權威製作狀態，因此沒有啟動下一階段。請重試。";
    return "下一階段沒有成功啟動，目前沒有背景製作工作在運行。請重試。";
  }
  if (outcome === "complete")
    return "The production scope you requested is complete. No later stage is currently running.";
  if (outcome === "started")
    return "The server accepted the next reviewable production specification. No image or video generation was started.";
  if (outcome === "read_failed")
    return "I could not read the canonical production state, so no next stage was started. Please retry.";
  return "The next stage did not start successfully. No background production job is currently running. Please retry.";
}

export function resolveAgentOsSkillMount(input: {
  projectKind: AgentProjectKind;
  workbenchMode: string;
  turnSkillIds?: readonly string[];
  skillMountSnapshot?: ProjectSkillResolutionSnapshot;
}) {
  const mountContext: SkillMountContext = {
    projectKind: input.projectKind,
    workbenchMode: input.workbenchMode,
    turnSkillIds: input.turnSkillIds,
  };
  const systemMount = resolveSkillMounts(mountContext);
  const projectSkills = input.skillMountSnapshot?.skills ?? [];
  const projectInstructions = projectSkills.map(
    (skill) =>
      `## Project Skill: ${skill.name} (${skill.slug}@${skill.version})\n${skill.instructions}`
  );
  return {
    instructions: [systemMount.instructions, ...projectInstructions].filter(Boolean).join("\n\n"),
    toolIds: [
      ...new Set([...systemMount.toolIds, ...projectSkills.flatMap((skill) => skill.toolIds)]),
    ],
    systemSkillIds: systemMount.skills.map((skill) => skill.id),
    projectSkillVersionIds: projectSkills.map((skill) => skill.versionId),
    skippedSkillIds: [...systemMount.skippedSkillIds],
  };
}

export type AgentOsGraph = ReturnType<typeof createAgentOsGraph>;
