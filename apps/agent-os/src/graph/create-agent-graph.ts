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
import { IncompleteModelStreamError, InvalidToolResponseError } from "@repo/model-router";

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
  if (!input.checkpointer && process.env.NODE_ENV !== "test") {
    throw new Error("An explicit persistent checkpointer is required");
  }
  const mount = resolveAgentOsSkillMount({
    ...input,
    workbenchContext: input.runtime.workbenchContext,
  });
  const tools = buildLangChainTools(input.runtime, mount.toolIds);
  return createReactAgent({
    llm: input.runtime.storyContinuation
      ? createStoryContinuationModel(input.runtime)
      : () =>
          input.model.bindTools!(tools).withRetry({
            stopAfterAttempt: 2,
            onFailedAttempt: (error) => {
              // Retry only the interrupted model node. Successful tool nodes
              // remain in the checkpoint and must never be executed again.
              if (
                !(error instanceof IncompleteModelStreamError) &&
                !(error instanceof InvalidToolResponseError)
              )
                throw error;
            },
          }),
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
  const quoteToolCallId = `story-media-quote:${continuation.responseId}`;
  const confirmToolCallId = `story-media-confirm:${continuation.responseId}`;
  const autoGenerateAssets =
    continuation.mediaBatchCompleted !== true &&
    continuation.completedStage === "assets" &&
    continuation.plan.autoGenerateAssetImages === true;
  const autoGenerateStoryboard =
    continuation.mediaBatchCompleted !== true &&
    continuation.completedStage === "storyboard" &&
    continuation.plan.autoGenerateStoryboardMedia === true;
  const autoGenerateMedia = autoGenerateAssets || autoGenerateStoryboard;

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

      if (autoGenerateMedia) {
        const confirmResult = state.messages.find(
          (message) => isToolMessage(message) && message.tool_call_id === confirmToolCallId
        );
        if (confirmResult) {
          if (!toolMessageSucceeded(confirmResult.content)) {
            return new AIMessage(storyContinuationCopy(continuation.locale, "generation_failed"));
          }
          return new AIMessage(
            storyContinuationCopy(
              continuation.locale,
              generationBatchStatusFromToolMessage(confirmResult.content) === "blocked"
                ? "media_blocked"
                : "media_started"
            )
          );
        }
        const quoteResult = state.messages.find(
          (message) => isToolMessage(message) && message.tool_call_id === quoteToolCallId
        );
        if (!quoteResult) {
          return new AIMessage({
            content: "",
            tool_calls: [
              {
                id: quoteToolCallId,
                name: toLangChainToolName(
                  autoGenerateAssets
                    ? "story.generation.quoteAssets"
                    : "story.generation.quoteStoryboard"
                ),
                args: autoGenerateAssets
                  ? { outputKind: "image", dispatchMode: "sequential" }
                  : { dispatchMode: "sequential" },
                type: "tool_call",
              },
            ],
          });
        }
        const quote = generationQuoteFromToolMessage(quoteResult.content);
        if (!quote) {
          return new AIMessage(storyContinuationCopy(continuation.locale, "generation_failed"));
        }
        return new AIMessage({
          content: "",
          tool_calls: [
            {
              id: confirmToolCallId,
              name: toLangChainToolName("story.generation.confirmBatch"),
              args: {
                batchId: quote.id,
                expectedVersion: quote.version,
                expectedItemCount: quote.itemCount,
                expectedTotalPoints: quote.totalPoints,
              },
              type: "tool_call",
            },
          ],
        });
      }
      const regenerationPending =
        continuation.plan.regenerateStage !== undefined &&
        continuation.plan.regenerateStage !== continuation.completedStage;
      if (
        !regenerationPending &&
        !storyProductionNeedsContinuation(productionState, continuation.plan.continueThrough)
      ) {
        return new AIMessage(
          storyContinuationCopy(
            continuation.locale,
            continuation.mediaBatchCompleted === true
              ? continuation.completedStage === "storyboard"
                ? "playtest_ready"
                : "media_complete"
              : "complete"
          )
        );
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

function generationBatchStatusFromToolMessage(content: unknown): string | null {
  if (typeof content !== "string") return null;
  try {
    const result = JSON.parse(content) as { ok?: unknown; data?: { status?: unknown } };
    return result.ok === true && typeof result.data?.status === "string"
      ? result.data.status
      : null;
  } catch {
    return null;
  }
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

function generationQuoteFromToolMessage(content: unknown): {
  id: string;
  version: number;
  itemCount: number;
  totalPoints: number;
} | null {
  if (typeof content !== "string") return null;
  try {
    const result = JSON.parse(content) as {
      ok?: unknown;
      data?: { id?: unknown; version?: unknown; itemCount?: unknown; totalPoints?: unknown };
    };
    const data = result.data;
    if (
      result.ok !== true ||
      !data ||
      typeof data.id !== "string" ||
      typeof data.version !== "number" ||
      typeof data.itemCount !== "number" ||
      typeof data.totalPoints !== "number"
    ) {
      return null;
    }
    return {
      id: data.id,
      version: data.version,
      itemCount: data.itemCount,
      totalPoints: data.totalPoints,
    };
  } catch {
    return null;
  }
}

function storyContinuationCopy(
  locale: "en-US" | "zh-CN" | "zh-HK",
  outcome:
    | "complete"
    | "started"
    | "read_failed"
    | "failed"
    | "media_started"
    | "media_blocked"
    | "media_complete"
    | "playtest_ready"
    | "generation_failed"
) {
  if (locale === "zh-CN") {
    if (outcome === "media_started") return "正在按故事顺序逐项生成，结果会自动回填到当前卡片。";
    if (outcome === "media_blocked") return "积分不足，生成已暂停。充值后可从当前卡片继续。";
    if (outcome === "media_complete") return "本阶段的图片已全部生成。";
    if (outcome === "playtest_ready") return "所有分镜片段已生成完成，现在可以预览并发布游玩。";
    if (outcome === "generation_failed")
      return "媒体生成没有开始。请查看上方的具体错误；如果是积分不足，请充值后重试。";
    if (outcome === "complete") return "你要求的制作规格范围已经完成，当前没有后续阶段在运行。";
    if (outcome === "started")
      return "下一份可审核的制作规格已由服务端受理；本阶段不会生成任何图片或视频。";
    if (outcome === "read_failed")
      return "无法读取当前项目的权威制作状态，因此没有启动下一阶段。请重试。";
    return "下一阶段没有成功启动，当前没有后台制作任务在运行。请重试。";
  }
  if (locale === "zh-HK") {
    if (outcome === "media_started") return "正在按故事順序逐項生成，結果會自動回填到目前卡片。";
    if (outcome === "media_blocked") return "積分不足，生成已暫停。儲值後可從目前卡片繼續。";
    if (outcome === "media_complete") return "本階段的圖片已全部生成。";
    if (outcome === "playtest_ready") return "所有分鏡片段已生成完成，現在可以預覽並發佈遊玩。";
    if (outcome === "generation_failed")
      return "媒體生成沒有開始。請查看上方的具體錯誤；如果是積分不足，請儲值後重試。";
    if (outcome === "complete") return "你要求的製作規格範圍已經完成，目前沒有後續階段在運行。";
    if (outcome === "started")
      return "下一份可審核的製作規格已由服務端受理；本階段不會生成任何圖片或影片。";
    if (outcome === "read_failed")
      return "無法讀取目前專案的權威製作狀態，因此沒有啟動下一階段。請重試。";
    return "下一階段沒有成功啟動，目前沒有背景製作工作在運行。請重試。";
  }
  if (outcome === "media_started")
    return "Generating one item at a time in story order. Results will fill into each card automatically.";
  if (outcome === "media_blocked")
    return "Generation is paused because the balance is too low. Add credits to continue from this card.";
  if (outcome === "media_complete") return "All media for this stage has finished generating.";
  if (outcome === "playtest_ready")
    return "All storyboard clips are complete. The story is ready to preview and publish for play.";
  if (outcome === "generation_failed")
    return "Media generation did not start. Check the specific error above; if the balance is insufficient, add credits and retry.";
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
  workbenchContext?: Readonly<Record<string, string>>;
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
  const mobileH5Story =
    input.projectKind === "story" &&
    input.workbenchMode === "story" &&
    input.workbenchContext?.experience === "mobile_h5";
  const mobileH5Instructions = mobileH5Story
    ? `## Mandatory mobile H5 Story state machine

This is the trusted mobile_h5 creation surface. It deliberately has no creative-profile
questionnaire. For a substantive creative seed in a canonically empty chapter, call
story_read first and then call story_author immediately with continueThrough=storyboard.
The Server atomically applies the H5 product defaults. Never ask about aspect ratio,
runtime, visual style, or story language; never call request_user_input or
story_confirmCreativeProfile; never add a conversational confirmation before the Script.
Script and Plot Tree are the first creator-visible Continue/Don't continue boundaries.`
    : "";
  const toolIds = [
    ...new Set([...systemMount.toolIds, ...projectSkills.flatMap((skill) => skill.toolIds)]),
  ].filter(
    (toolId) =>
      !mobileH5Story ||
      (toolId !== "request_user_input" && toolId !== "story.confirmCreativeProfile")
  );
  return {
    instructions: [systemMount.instructions, ...projectInstructions, mobileH5Instructions]
      .filter(Boolean)
      .join("\n\n"),
    toolIds,
    systemSkillIds: systemMount.skills.map((skill) => skill.id),
    projectSkillVersionIds: projectSkills.map((skill) => skill.versionId),
    skippedSkillIds: [...systemMount.skippedSkillIds],
  };
}

export type AgentOsGraph = ReturnType<typeof createAgentOsGraph>;
