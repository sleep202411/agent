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
  loadAssistantSystemPrompt,
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

    const activeEpisode = context.episodes.find(
      (ep: Record<string, unknown>) =>
        String(ep.id) === String(context.episodeId),
    );

    // Build column definitions for storyboard
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
        return options.length > 0
          ? `${key} (${type}, options: ${options.join(', ')})`
          : `${key} (${type})`;
      })
      .join('\n  ');

    const langMap: Record<string, string> = {
      'en-US':
        "The user's UI locale is English. Default to English for all content unless the user writes in another language.",
      'zh-HK':
        '用戶的 UI 語言是繁體中文。預設使用繁體中文，除非用戶使用其他語言交流。',
    };

    const basePrompt = loadAssistantSystemPrompt({
      projectId: context.projectId,
      worldId: context.worldId ?? 'unknown',
      projectName: sanitize(
        typeof context.detail?.name === 'string'
          ? context.detail.name
          : '未命名项目',
      ),
      projectDescription:
        sanitize(
          typeof context.detail?.description === 'string'
            ? context.detail.description
            : '',
        ) || '暂无',
      activeEpisodeTitle:
        typeof activeEpisode?.title === 'string'
          ? activeEpisode.title
          : '未选择剧集',
      episodeId: context.episodeId ?? 'none',
      activeTab: context.activeTab ?? 'storyboard',
      activePanel: context.activePanel ?? 'none',
      episodeCount: context.episodes.length,
      characterCount: context.characterSummary?.total ?? 0,
      sceneCount: context.sceneSummary?.total ?? 0,
      propCount: context.propSummary?.total ?? 0,
      columnNames:
        (context.storyboardSummary?.columnNames ?? [])
          .slice(0, 20)
          .join('、') || '暂无',
      shotCount: context.storyboardSummary?.shotCount ?? 0,
      columnDefs: columnDefs
        ? `\n[分镜列定义（AI 可填充的列）]\n  ${columnDefs}`
        : '',
      characterSample:
        (context.characterSummary?.sampleNames ?? []).join('、') || '暂无',
      sceneSample:
        (context.sceneSummary?.sampleNames ?? []).join('、') || '暂无',
      propSample: (context.propSummary?.sampleNames ?? []).join('、') || '暂无',
      localeHint: langMap[locale ?? ''] ?? '',
    });

    const agentSection = loadAgentPrompt(agentType);
    return agentSection ? `${basePrompt}\n\n${agentSection}` : basePrompt;
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
