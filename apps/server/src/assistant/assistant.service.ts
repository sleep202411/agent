import { Injectable, Logger } from '@nestjs/common';
import {
  convertToModelMessages,
  stepCountIs,
  streamText,
  validateUIMessages,
  type ToolSet,
  type UIMessage,
} from 'ai';
import { AiService } from '../ai/ai.service';
import { ScriptAgentService } from '../pipeline/script-agent.service';
import { TaskService } from '../pipeline/task/task.service';
import { TaskQueue } from '../pipeline/task/task.queue';
import { TaskWorker } from '../pipeline/task/task.worker';
import { WorkspaceService, type WorkspaceContext } from './workspace.service';
import {
  ConversationService,
  getLimitsForTier,
  type StoredMessage,
} from './conversation.service';
import { createGroupedAssistantTools, type UserTier } from './tools';
import {
  loadAgentPrompt,
  type AssistantAgentType,
  assistantAgentTypes,
} from './prompts';
import type { HeadersLike } from './tools/types';

// ─── Types ─────────────────────────────────────────────

type Attachment = {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  url?: string;
  excerpt?: string;
};

type AssistantMessage = UIMessage<{ attachments?: Attachment[] }>;

type ProjectContext = Awaited<
  ReturnType<WorkspaceService['getProjectContextSummary']>
>;

// ─── Tool output stripping for persistence ─────────────

/** Tool names whose output is large (live data) and should not be persisted */
const STRIP_OUTPUT_TOOLS = new Set([
  'get_project_snapshot',
  'get_world_assets',
  'search_world_assets',
  'aggregate_world_assets_for_analysis',
  'get_storyboard_snapshot',
  'query_storyboard_rows',
  'aggregate_storyboard_rows_for_analysis',
]);

/**
 * Strip large tool outputs from a message before persisting to Redis.
 * Keeps tool invocation metadata (name, state) but removes bulky live data.
 */
function stripForStorage(message: AssistantMessage): StoredMessage {
  const parts = message.parts.map((part) => {
    if (
      typeof part === 'object' &&
      part !== null &&
      'type' in part &&
      typeof (part as Record<string, unknown>).type === 'string'
    ) {
      const p = part as Record<string, unknown>;
      const toolType = String(p.type ?? '');

      // Strip tool output for read-heavy tools
      if (toolType.startsWith('tool-') && p.output !== undefined) {
        const toolName = toolType.slice(5);
        if (STRIP_OUTPUT_TOOLS.has(toolName)) {
          return { ...p, output: { _stripped: true, _tool: toolName } };
        }
      }
    }
    return part;
  });

  return {
    id: message.id,
    role: message.role as 'user' | 'assistant',
    parts,
    metadata: message.metadata
      ? { attachments: message.metadata.attachments }
      : undefined,
    createdAt: Date.now(),
  };
}

// ─── Service ───────────────────────────────────────────

@Injectable()
export class AssistantService {
  private readonly logger = new Logger(AssistantService.name);

  private taskWorker: TaskWorker | null = null;

  constructor(
    private readonly ai: AiService,
    private readonly workspace: WorkspaceService,
    private readonly conversation: ConversationService,
    private readonly scriptAgent: ScriptAgentService,
    private readonly taskService: TaskService,
    private readonly taskQueue: TaskQueue,
  ) {
    // Create task worker and start BullMQ processing
    if (taskService) {
      this.taskWorker = new TaskWorker(
        taskService,
        () => this.ai.getModel(),
        (sessionId, state) => this.scriptAgent.saveState(sessionId, state),
      );
      // Start worker in-process unless DISABLE_INLINE_WORKER is set.
      if (taskQueue && process.env.DISABLE_INLINE_WORKER !== 'true') {
        taskQueue.startWorker(this.taskWorker);
        this.logger.log('Inline task worker started');
      } else if (process.env.DISABLE_INLINE_WORKER === 'true') {
        this.logger.log(
          'Inline task worker disabled — use standalone worker.ts',
        );
      }
    }
  }

  // ─── History ────────────────────────────────────────────

  async getHistory(
    userId: string,
    projectId: string,
    tier?: string,
  ): Promise<{
    conversationId: string;
    messages: StoredMessage[];
    messageCount: number;
    messageLimit: number;
    retentionDays: number;
  }> {
    const { conversationId, messages } = await this.conversation.getMessages(
      userId,
      projectId,
    );
    const limits = getLimitsForTier(tier);
    return {
      conversationId,
      messages,
      messageCount: messages.length,
      messageLimit: limits.maxMessages,
      retentionDays: Math.round(limits.ttlSeconds / 86400),
    };
  }

  async clearHistory(userId: string, projectId: string): Promise<void> {
    await this.conversation.clearMessages(userId, projectId);
  }

  // ─── Chat ──────────────────────────────────────────────

  async chat(
    payload: {
      projectId: string;
      /** Single new user message from the client */
      userMessage: AssistantMessage;
      workspaceContext?: Partial<WorkspaceContext>;
      agentType?: string;
      userId: string;
      userTier?: string;
    },
    incomingHeaders: HeadersLike,
  ): Promise<{ toUIMessageStreamResponse: () => Response }> {
    const { userId, userTier } = payload;

    // 1. Load conversation history
    const { messages: history } = await this.conversation.getMessages(
      userId,
      payload.projectId,
    );
    this.logger.log(
      `Loaded ${history.length} history messages for userId=${userId} project=${payload.projectId}`,
    );

    // 2. Check message limit (based on CURRENT tier)
    const limitCheck = this.conversation.canSendMessage(
      history.length,
      userTier,
    );
    if (!limitCheck.allowed) {
      throw new MessageLimitError(limitCheck.current, limitCheck.max);
    }

    // 3. Append user message to history
    const userStored = stripForStorage(payload.userMessage);
    const updatedHistory = [...history, userStored];

    // Save user message immediately (so it persists even if stream fails)
    await this.conversation.saveMessages(
      userId,
      payload.projectId,
      updatedHistory,
      userTier,
    );

    // 4. Build workspace context
    const wsContext: WorkspaceContext = {
      projectId: payload.projectId,
      worldId: payload.workspaceContext?.worldId
        ? String(payload.workspaceContext.worldId)
        : undefined,
      episodeId: payload.workspaceContext?.episodeId
        ? String(payload.workspaceContext.episodeId)
        : undefined,
      activeTab:
        typeof payload.workspaceContext?.activeTab === 'string'
          ? payload.workspaceContext.activeTab
          : undefined,
      activePanel:
        typeof payload.workspaceContext?.activePanel === 'string'
          ? payload.workspaceContext.activePanel
          : undefined,
      locale:
        typeof payload.workspaceContext?.locale === 'string'
          ? payload.workspaceContext.locale
          : undefined,
    };

    // 5. Rebuild messages for LLM: history (text-only) + new user message
    // History messages are simplified (no tool invocations) to ensure
    // clean context. Tool calls are ephemeral — only the current turn uses them.
    const historyMessages: AssistantMessage[] = history
      .map((m) => {
        // Extract only text parts from stored messages
        const textParts = (m.parts as Array<Record<string, unknown>>)
          .filter(
            (p) => p.type === 'text' && typeof p.text === 'string' && p.text,
          )
          .map((p) => ({
            type: 'text' as const,
            text: p.text as string,
            state: 'done' as const,
          }));
        if (textParts.length === 0) return null;
        return {
          id: m.id,
          role: m.role,
          parts: textParts,
        } as AssistantMessage;
      })
      .filter(Boolean) as AssistantMessage[];

    const attachmentFullText = this.collectAttachmentTexts([
      payload.userMessage,
    ]);
    const attachmentInfos = this.collectAttachmentInfos([payload.userMessage]);

    // 6. Build tools
    const tools = createGroupedAssistantTools(
      {
        headers: incomingHeaders,
        ws: this.workspace,
        context: wsContext,
        userId,
        requireWorldId: () => {
          if (!wsContext.worldId)
            throw new Error(
              '当前项目缺少 worldId，暂时无法操作角色、场景或道具。',
            );
          return wsContext.worldId;
        },
        requireEpisodeId: () => {
          if (!wsContext.episodeId)
            throw new Error('当前未选中剧集，暂时无法读取或写入分镜。');
          return wsContext.episodeId;
        },
        getAttachmentText: () => attachmentFullText,
        getAttachments: () => attachmentInfos,
        taskService: this.taskService,
        taskWorker: this.taskWorker ?? undefined,
        taskQueue: this.taskQueue ?? undefined,
      },
      this.ai,
      this.scriptAgent,
      (payload.userTier as UserTier) ?? 'free',
    ) as ToolSet;

    // 7. Build system prompt (fresh from DB, never stored)
    this.logger.log('Fetching project context...');
    const projectContext = await this.workspace.getProjectContextSummary(
      incomingHeaders,
      wsContext,
    );
    this.logger.log('Project context ready');

    // 8. Build model messages
    // History messages are pure text (user/assistant alternating).
    // Only the new user message goes through full validation.
    const historyModelMessages = historyMessages.map((m) => ({
      role: m.role as 'user' | 'assistant',
      content:
        m.parts
          .filter(
            (p): p is { type: 'text'; text: string } =>
              typeof p === 'object' &&
              p !== null &&
              'type' in p &&
              (p as Record<string, unknown>).type === 'text',
          )
          .map((p) => p.text)
          .join('\n') || '',
    }));

    // Validate + convert only the current user message
    const currentMessages = this.augmentMessages([payload.userMessage]);
    let currentModelMessages;
    try {
      const validated = await validateUIMessages({
        messages: currentMessages,
        tools: tools as unknown as ToolSet,
      } as never);
      currentModelMessages = await convertToModelMessages(validated, {
        tools: tools as unknown as ToolSet,
      });
    } catch (err) {
      this.logger.warn(`Current message validation failed: ${err}`);
      currentModelMessages = [
        {
          role: 'user' as const,
          content: currentMessages
            .map((m) =>
              m.parts
                .filter((p) => p.type === 'text')
                .map((p) => (p as { text: string }).text)
                .join('\n'),
            )
            .join('\n'),
        },
      ];
    }

    const modelMessages = [...historyModelMessages, ...currentModelMessages];
    this.logger.log(
      `Built ${modelMessages.length} model messages (${historyModelMessages.length} history + ${currentModelMessages.length} current}`,
    );

    // Strip non-image file parts — alibaba provider only supports images
    for (const msg of modelMessages) {
      if (msg.role === 'user' && Array.isArray(msg.content)) {
        msg.content = msg.content.filter(
          (part) =>
            part.type !== 'file' ||
            ('mediaType' in part &&
              typeof part.mediaType === 'string' &&
              part.mediaType.startsWith('image/')),
        );
      }
    }

    // 9. Trim to context window — keep system + recent messages
    // TODO: implement token-based trimming when needed
    const MAX_MESSAGES_TO_LLM = 80;
    if (modelMessages.length > MAX_MESSAGES_TO_LLM) {
      const trimmed = modelMessages.slice(-MAX_MESSAGES_TO_LLM);
      modelMessages.length = 0;
      modelMessages.push(...trimmed);
      this.logger.log(
        `Trimmed to ${MAX_MESSAGES_TO_LLM} messages for LLM context`,
      );
    }

    const modelId = process.env.AI_MODEL || 'qwen3-max';
    this.logger.log(
      `Starting streamText: model=${modelId}, ${modelMessages.length} messages, ${Object.keys(tools).length} tools`,
    );

    // 10. Stream
    const result = streamText({
      model: this.ai.getModel(),
      tools,
      toolChoice: 'auto',
      system: this.buildSystemPrompt(
        projectContext,
        payload.agentType,
        wsContext.locale,
      ),
      messages: modelMessages,
      stopWhen: stepCountIs(20),
      temperature: 0.2,
      onError: ({ error }) => {
        const msg = error instanceof Error ? error.message : String(error);
        this.logger.error(`Stream onError: ${msg}`);
      },
      onStepFinish: (event) => {
        this.logger.log(`Step finished: reason=${event.finishReason}`);
      },
      onFinish: async ({ response }) => {
        // Persist assistant replies after stream completes
        try {
          const assistantMsgs = response.messages.filter(
            (m) => m.role === 'assistant',
          );
          if (assistantMsgs.length === 0) return;

          const stored: StoredMessage[] = assistantMsgs.map((msg) => {
            // Extract text parts from model message content
            const parts: unknown[] = [];
            if (typeof msg.content === 'string') {
              if (msg.content) {
                parts.push({ type: 'text', text: msg.content, state: 'done' });
              }
            } else if (Array.isArray(msg.content)) {
              for (const part of msg.content) {
                if (part.type === 'text' && part.text) {
                  parts.push({ type: 'text', text: part.text, state: 'done' });
                } else if (part.type === 'tool-call') {
                  parts.push({
                    type: `tool-${part.toolName}`,
                    toolCallId: part.toolCallId,
                    state: 'output-available',
                  });
                }
              }
            }
            return {
              id: crypto.randomUUID(),
              role: 'assistant' as const,
              parts,
              createdAt: Date.now(),
            };
          });

          await this.conversation.appendAndSave(
            userId,
            payload.projectId,
            stored,
            userTier,
          );
          this.logger.log(
            `Saved ${stored.length} assistant messages: userId=${userId} project=${payload.projectId}`,
          );
        } catch (err) {
          this.logger.error(`Failed to save assistant reply: ${err}`);
        }
      },
    });

    return result;
  }

  // ─── System prompt ─────────────────────────────────────

  private buildSystemPrompt(
    context: ProjectContext,
    rawAgentType?: string,
    locale?: string,
  ) {
    const agentType: AssistantAgentType = assistantAgentTypes.includes(
      rawAgentType as AssistantAgentType,
    )
      ? (rawAgentType as AssistantAgentType)
      : 'general';
    const projectName =
      typeof context.detail?.name === 'string'
        ? context.detail.name
        : '未命名项目';
    const projectDescription =
      typeof context.detail?.description === 'string'
        ? context.detail.description
        : '';
    const activeEpisode = context.episodes.find(
      (ep: Record<string, unknown>) =>
        String(ep.id) === String(context.episodeId),
    );
    const activeEpisodeTitle =
      typeof activeEpisode?.title === 'string'
        ? activeEpisode.title
        : '未选择剧集';
    const characterSample = (context.characterSummary?.sampleNames ?? []).join(
      '、',
    );
    const sceneSample = (context.sceneSummary?.sampleNames ?? []).join('、');
    const propSample = (context.propSummary?.sampleNames ?? []).join('、');
    const columnNames = (context.storyboardSummary?.columnNames ?? [])
      .slice(0, 20)
      .join('、');

    const basePrompt = `你是 FizzDragon Studio 项目详情页里的 StoryOS 助手。你的职责是帮助创作者理解项目、提出可执行方案，并在用户明确授权时通过工具修改当前项目。

[当前项目上下文]
- projectId: ${context.projectId}
- worldId: ${context.worldId ?? 'unknown'}
- 当前项目: ${projectName}
- 项目简介: ${projectDescription || '暂无'}
- 当前剧集: ${activeEpisodeTitle}
- activeTab: ${context.activeTab ?? 'storyboard'}
- activePanel: ${context.activePanel ?? 'none'}
- 剧集数量: ${context.episodes.length}
- 角色/场景/道具数量: ${context.characterSummary?.total ?? 0}/${context.sceneSummary?.total ?? 0}/${context.propSummary?.total ?? 0}
- 当前分镜列: ${columnNames || '暂无'}
- 当前镜头数量: ${context.storyboardSummary?.shotCount ?? 0}
- 部分角色: ${characterSample || '暂无'}
- 部分场景: ${sceneSample || '暂无'}
- 部分道具: ${propSample || '暂无'}
注意：以上仅列出部分角色/场景/道具名称。当用户询问数量、列表或具体信息时，必须先调用 get_world_assets 或 get_project_snapshot 工具获取最新数据，不要依赖上方摘要或之前对话中的旧数据。回复时不要提及"样本"、"部分列出"等内部概念。

[行为模式]
按以下 4 种模式分流：
1. read-only：用户询问项目事实时，只读取并回答。
2. direct execute：指令明确、参数齐全、风险低时，直接调用写入工具。
3. proposal -> confirm -> execute：需要创作/补全/批量操作时，先 proposal 让用户确认，再 execute。
4. clarify：目标不明确或高风险操作时，先追问。

[交互规则]
1. proposal 被 accept 后，优先走 batch execute，不要逐个循环 create。
2. proposal 被 reject 后，尊重用户并询问下一步。
3. 先调用读取工具了解现状，不要凭空猜测。
4. 回复简洁、具体、可执行。不要提及工具名称。
5. 任何需要用户确认的场景，必须调用 confirm_action 或 show_options 生成交互卡片。禁止用纯文本要求用户回复"确认"。
10. 【重要】调用 show_options、confirm_action、configure_params 工具之前，你必须先在回复中输出至少一句说明文字（比如"好的，请选择画面风格："），然后再调用工具。绝对禁止跳过文字直接调用这些工具。这是硬性要求。
6. 当需要批量创建资产时，必须直接调用 propose 工具生成交互卡片。
7. 涉及数值参数时，必须调用 configure_params 生成参数表单。
8. 当用户上传了附件时，必须优先从附件内容中分析和提取信息。附件内容在消息的 [附件上下文] 部分。
9. 图片生成功能正在开发中，暂不可用。

[剧本拆解]
当用户要求"拆解剧本"、"生成分镜"、"把小说改编成短剧"等任务时：
- 如果用户上传了文件或提供了完整剧本文本，使用 start_pipeline 工具启动智能分镜 pipeline。pipeline 会自动完成角色提取、场景拆分、镜头细化，用户在过程中确认。
- 如果用户只是想讨论剧本结构、写一小段对白、或调整某个场景，使用常规对话或 propose_script 工具。

[资产去重规则]
创建角色/场景/道具前，必须检查项目上下文中的"已有角色/场景/道具"列表，跳过同名实体。禁止创建重名资产。`;

    const langMap: Record<string, string> = {
      'en-US':
        'You MUST respond in English. All text output, tool arguments, and generated content must be in English.',
      'zh-HK':
        '你必須使用繁體中文回覆。所有文字輸出、工具參數和生成的內容都必須使用繁體中文。',
    };
    const langInstruction = langMap[locale ?? ''] ?? '';
    const langSection = langInstruction
      ? `\n\n[語言/Language]\n${langInstruction}`
      : '';

    const agentSection = loadAgentPrompt(agentType);
    const agentPart = agentSection ? `\n\n${agentSection}` : '';
    return `${basePrompt}${langSection}${agentPart}`;
  }

  // ─── Message helpers ───────────────────────────────────

  private augmentMessages(messages: AssistantMessage[]): AssistantMessage[] {
    return messages.map((message) => {
      if (message.role !== 'user') return message;
      const attachments = message.metadata?.attachments ?? [];
      if (attachments.length === 0) return message;
      const existingContext = message.parts.some(
        (part) =>
          part.type === 'text' &&
          'text' in part &&
          (part as { text: string }).text.includes('[附件上下文]'),
      );
      if (existingContext) return message;
      return {
        ...message,
        parts: [
          ...message.parts,
          {
            type: 'text' as const,
            text: this.buildAttachmentContext(attachments),
          },
        ],
      };
    });
  }

  private buildAttachmentContext(attachments: Attachment[]) {
    const AI_EXCERPT_LIMIT = 2000;
    const lines = attachments.map((att, i) => {
      const parts = [
        `${i + 1}. 文件名：${att.name}`,
        `类型：${att.mimeType || 'unknown'}`,
        `字数：${att.excerpt?.length ?? 0}`,
      ];
      if (att.url) parts.push(`地址：${att.url}`);
      if (att.excerpt) {
        const truncated =
          att.excerpt.length > AI_EXCERPT_LIMIT
            ? att.excerpt.slice(0, AI_EXCERPT_LIMIT) +
              '\n...(内容已截断，完整文本已通过附件通道传递，可直接调用 start_pipeline 处理)'
            : att.excerpt;
        parts.push(`内容摘要：${truncated}`);
      }
      return parts.join('\n');
    });
    return `[附件上下文]\n${lines.join('\n\n')}`;
  }

  private collectAttachmentTexts(messages: AssistantMessage[]): string {
    const texts: string[] = [];
    for (const msg of messages) {
      if (msg.role !== 'user') continue;
      for (const att of msg.metadata?.attachments ?? []) {
        if (att.excerpt) texts.push(att.excerpt);
      }
    }
    return texts.join('\n\n');
  }

  private collectAttachmentInfos(
    messages: AssistantMessage[],
  ): import('./tools/types').AttachmentInfo[] {
    const result: import('./tools/types').AttachmentInfo[] = [];
    for (const msg of messages) {
      if (msg.role !== 'user') continue;
      for (const att of msg.metadata?.attachments ?? []) {
        result.push({
          name: att.name,
          mimeType: att.mimeType,
          url: att.url,
          excerpt: att.excerpt,
        });
      }
    }
    return result;
  }
}

// ─── Custom errors ─────────────────────────────────────

export class MessageLimitError extends Error {
  readonly code = 'MESSAGE_LIMIT_REACHED';
  constructor(
    readonly current: number,
    readonly max: number,
  ) {
    super(
      `Message limit reached (${current}/${max}). Start a new conversation or upgrade your plan.`,
    );
  }
}
