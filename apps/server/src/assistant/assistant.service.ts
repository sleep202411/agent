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
    if (taskService) {
      this.taskWorker = new TaskWorker(
        taskService,
        () => this.ai.getModel(),
        (sessionId, state) => this.scriptAgent.saveState(sessionId, state),
      );
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

  async getHistory(userId: string, projectId: string, tier?: string) {
    const { conversationId, messages } = await this.conversation.getMessages(
      userId,
      projectId,
    );
    const limits = getLimitsForTier(tier);
    const userMessageCount = messages.filter((m) => m.role === 'user').length;
    return {
      conversationId,
      messages,
      messageCount: userMessageCount,
      messageLimit: limits.maxMessages,
      retentionDays:
        limits.ttlSeconds > 0 ? Math.round(limits.ttlSeconds / 86400) : 0,
    };
  }

  async getServerMessageCount(
    userId: string,
    projectId: string,
  ): Promise<number> {
    const { messages } = await this.conversation.getMessages(userId, projectId);
    return messages.filter((m) => m.role === 'user').length;
  }

  async clearHistory(userId: string, projectId: string): Promise<void> {
    await this.conversation.clearMessages(userId, projectId);
  }

  async saveConversation(
    userId: string,
    projectId: string,
    messages: unknown[],
    tier?: string,
  ): Promise<void> {
    // Strip large data before saving
    const stripped = (messages as AssistantMessage[])
      .filter((m) => m.role === 'user' || m.role === 'assistant')
      .map((m) => this.stripForStorage(m));
    await this.conversation.saveMessages(userId, projectId, stripped, tier);
    this.logger.log(
      `Saved conversation: userId=${userId} project=${projectId} messages=${stripped.length}`,
    );
  }

  // ─── Chat ──────────────────────────────────────────────

  async chat(
    payload: {
      projectId: string;
      messages: unknown[];
      workspaceContext?: Partial<WorkspaceContext>;
      agentType?: string;
      userId: string;
      userTier?: string;
    },
    incomingHeaders: HeadersLike,
  ): Promise<{ toUIMessageStreamResponse: () => Response }> {
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

    const messages = payload.messages as AssistantMessage[];
    const attachmentFullText = this.collectAttachmentTexts(messages);
    const attachmentInfos = this.collectAttachmentInfos(messages);

    const tools = createGroupedAssistantTools(
      {
        headers: incomingHeaders,
        ws: this.workspace,
        context: wsContext,
        userId: payload.userId,
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

    this.logger.log('Fetching project context...');
    const projectContext = await this.workspace.getProjectContextSummary(
      incomingHeaders,
      wsContext,
    );
    this.logger.log('Project context ready');

    const validationTools = tools as unknown as ToolSet;
    let validatedMessages: AssistantMessage[];
    try {
      validatedMessages = await validateUIMessages({
        messages: payload.messages,
        tools: validationTools,
      } as never);
    } catch (err) {
      this.logger.error(
        `Message validation failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      throw new Error('助手消息格式不合法');
    }
    this.logger.log(`Validated ${validatedMessages.length} messages`);

    const preparedMessages = this.augmentMessages(validatedMessages);
    const modelMessages = await convertToModelMessages(preparedMessages, {
      tools: validationTools,
    });

    // Strip non-image file parts
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

    const modelId = process.env.AI_MODEL || 'qwen3-max';
    this.logger.log(
      `Starting streamText: model=${modelId}, ${modelMessages.length} messages, ${Object.keys(tools).length} tools`,
    );

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
        const toolCalls = event.toolCalls ?? [];
        this.logger.log(
          `Step finished: reason=${event.finishReason}, toolCalls=${toolCalls.length} [${toolCalls.map((tc: { toolName: string }) => tc.toolName).join(', ')}]`,
        );
      },
      onFinish: (event) => {
        this.logger.log(`Stream finished: reason=${event.finishReason}`);
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
    // Sanitize user-controlled fields to prevent prompt injection
    const sanitize = (s: string) =>
      s.replace(/\[/g, '(').replace(/\]/g, ')').slice(0, 500);
    const projectName = sanitize(
      typeof context.detail?.name === 'string'
        ? context.detail.name
        : '未命名项目',
    );
    const projectDescription = sanitize(
      typeof context.detail?.description === 'string'
        ? context.detail.description
        : '',
    );
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

    // Build detailed column definitions for storyboard generation
    const AI_FILLABLE_TYPES = new Set([
      'TEXT',
      'RICH_TEXT',
      'NUMBER',
      'SINGLE_OPTION',
      'SCENE',
    ]);
    const columns = (context.storyboardSummary?.columns ?? []) as Array<{
      presetColumnKey?: string;
      columnName?: string;
      columnType?: string;
      columnOptions?: Array<{ name: string }>;
    }>;
    const columnDefs = columns
      .filter((col) => AI_FILLABLE_TYPES.has(col.columnType ?? ''))
      .map((col) => {
        const key = col.presetColumnKey ?? col.columnName ?? '';
        const type = col.columnType ?? '';
        const options = col.columnOptions?.map((o) => o.name) ?? [];
        if (options.length > 0) {
          return `${key} (${type}, options: ${options.join(', ')})`;
        }
        return `${key} (${type})`;
      })
      .join('\n  ');

    const basePrompt = `你是 FizzDragon Studio 项目详情页里的 StoryOS 助手。你的职责是帮助创作者理解项目、提出可执行方案，并在用户明确授权时通过工具修改当前项目。

[当前项目上下文]
- projectId: ${context.projectId}
- worldId: ${context.worldId ?? 'unknown'}
- 当前项目: ${projectName}
- 项目简介: ${projectDescription || '暂无'}
- 当前剧集: ${activeEpisodeTitle} (episodeId: ${context.episodeId ?? 'none'})
- activeTab: ${context.activeTab ?? 'storyboard'}
- activePanel: ${context.activePanel ?? 'none'}
- 剧集数量: ${context.episodes.length}
- 角色/场景/道具数量: ${context.characterSummary?.total ?? 0}/${context.sceneSummary?.total ?? 0}/${context.propSummary?.total ?? 0}
- 当前分镜列: ${columnNames || '暂无'}
- 当前镜头数量: ${context.storyboardSummary?.shotCount ?? 0}
${columnDefs ? `\n[分镜列定义（AI 可填充的列）]\n  ${columnDefs}` : ''}
- 部分角色: ${characterSample || '暂无'}
- 部分场景: ${sceneSample || '暂无'}
- 部分道具: ${propSample || '暂无'}
注意：以上仅列出部分角色/场景/道具名称。当用户询问数量、列表或具体信息时，必须先调用 get_world_assets 或 list_characters/list_scenes/list_props 工具获取最新数据，不要依赖上方摘要或之前对话中的旧数据。回复时不要提及"样本"、"部分列出"等内部概念。

[行为模式]
按以下 4 种模式分流：
1. read-only：用户询问项目事实时，只读取并回答。
2. direct execute：指令明确、参数齐全、风险低时，直接调用写入工具。
3. proposal -> confirm -> execute：需要创作/补全/批量操作时，先 proposal 让用户确认，再 execute。
4. clarify：目标不明确或高风险操作时，先追问。

[交互规则]
1. proposal 被 accept 后，直接调用对应的写入工具保存，不要重复输出 proposal 的内容。例如 propose_script 被接受后，直接调用 save_episode_script 保存，不要再输出剧本文本。批量资产 proposal 被接受后，优先走 batch execute。
2. proposal 被 reject 后，尊重用户并询问下一步。
3. 先调用读取工具了解现状，不要凭空猜测。
4. 回复简洁、具体、可执行。不要提及工具名称。
5. 任何需要用户确认的场景，必须调用 confirm_action 或 show_options 生成交互卡片。禁止用纯文本要求用户回复"确认"。
10. 【重要】调用 show_options、confirm_action、configure_params 工具之前，你必须先在回复中输出至少一句说明文字（比如"好的，请选择画面风格："），然后再调用工具。绝对禁止跳过文字直接调用这些工具。这是硬性要求。
6. 当需要批量创建资产时，必须直接调用 propose 工具生成交互卡片。
7. 涉及数值参数时，必须调用 configure_params 生成参数表单。
8. 当用户上传了附件时，必须优先从附件内容中分析和提取信息。附件内容在消息的 [附件上下文] 部分。
9. 图片生成功能正在开发中，暂不可用。

[分镜生成]
使用 propose_storyboard_patch 生成分镜时：
- 每集至少生成 15-30 个镜头，确保覆盖所有场景和关键剧情节点，不要偷懒只生成几个。
- 每个镜头必须填写所有 AI 可填充的列。
- image_prompt（图片提示词）：**必填**，每个镜头都必须生成。必须是专业的 AI 图像生成提示词格式，包含：主体描述、场景环境、光影氛围、镜头构图、艺术风格。不能简单翻译 description，要针对 AI 图像模型优化。
- video_prompt（视频提示词）：**必填**，每个镜头都必须生成。必须包含运动描述（镜头移动、人物动作、环境变化）和时间流动感。不能和 image_prompt 或 description 重复。
- description（画面描述）：详细的叙事性描述，面向人类读者。
- 三者的区别：description 描述剧情；image_prompt 描述静态画面的视觉细节；video_prompt 描述动态运动和时间变化。三者内容不应相同。
- 所有生成的内容（描述、提示词、对白等）必须使用统一的语言，不要混用。
- dialogue（对白/旁白）如有对白必须填写。
- 对于 SINGLE_OPTION 类型的列（景别、视角、运镜），值必须从列定义的 options 中选择。

[剧本拆解]
当用户要求"拆解剧本"、"生成分镜"、"把小说改编成短剧"等任务时：
- 如果用户上传了文件或提供了完整剧本文本，使用 start_pipeline 工具启动智能分镜 pipeline。pipeline 会自动完成角色提取、场景拆分、镜头细化，用户在过程中确认。
- 如果用户只是想讨论剧本结构、写一小段对白、或调整某个场景，使用常规对话或 propose_script 工具。

[资产去重规则]
创建角色/场景/道具前，必须检查项目上下文中的"已有角色/场景/道具"列表，跳过同名实体。禁止创建重名资产。`;

    const langRules = `[语言规则]
所有生成的内容（回复文本、工具参数、剧本、分镜描述、提示词等）必须使用统一的语言，严禁混用。
语言确定优先级：
1. 用户当前聊天使用的语言（最高优先级）
2. 用户上传的文件/剧本所用的语言（如果与聊天语言一致则直接采用）
3. 如果文件语言与聊天语言不一致，使用 show_options 询问用户希望使用哪种语言
4. 系统 locale 语言（兜底）
5. 如果仍无法确定，主动询问用户
一旦确定语言，所有内容都必须使用该语言，包括 image_prompt、video_prompt、description、dialogue 等所有字段。`;

    const langMap: Record<string, string> = {
      'en-US':
        "The user's UI locale is English. Default to English for all content unless the user writes in another language.",
      'zh-HK':
        '用戶的 UI 語言是繁體中文。預設使用繁體中文，除非用戶使用其他語言交流。',
    };
    const localeHint = langMap[locale ?? ''] ?? '';
    const langSection = `\n\n${langRules}${localeHint ? `\n${localeHint}` : ''}`;

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

  /** Strip large tool outputs before persisting to Redis */
  private stripForStorage(message: AssistantMessage): StoredMessage {
    const STRIP_TOOLS = new Set([
      'get_project_snapshot',
      'get_world_assets',
      'search_world_assets',
      'aggregate_world_assets_for_analysis',
      'get_storyboard_snapshot',
      'query_storyboard_rows',
      'aggregate_storyboard_rows_for_analysis',
    ]);

    const parts = message.parts.map((part) => {
      if (typeof part === 'object' && part !== null && 'type' in part) {
        const p = part as Record<string, unknown>;
        const toolType = String(p.type ?? '');
        // Tool part types are "tool-{toolName}" e.g. "tool-get_project_snapshot"
        // Also check the toolName field directly as fallback
        const toolName = toolType.startsWith('tool-')
          ? toolType.slice(5)
          : String(p.toolName ?? '');
        if (toolName && p.output !== undefined && STRIP_TOOLS.has(toolName)) {
          return { ...p, output: { _stripped: true } };
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
