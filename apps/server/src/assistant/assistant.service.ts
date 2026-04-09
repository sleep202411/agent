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
import { WorkspaceService, type WorkspaceContext } from './workspace.service';
import { createGroupedAssistantTools } from './tools';
import {
  loadAgentPrompt,
  type AssistantAgentType,
  assistantAgentTypes,
} from './prompts';
import type { HeadersLike } from './tools/types';

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

@Injectable()
export class AssistantService {
  private readonly logger = new Logger(AssistantService.name);

  constructor(
    private readonly ai: AiService,
    private readonly workspace: WorkspaceService,
    private readonly scriptAgent: ScriptAgentService,
  ) {}

  async chat(
    payload: {
      projectId: string;
      messages: unknown[];
      workspaceContext?: Partial<WorkspaceContext>;
      agentType?: string;
    },
    incomingHeaders: HeadersLike,
  ): Promise<{ toUIMessageStreamResponse: () => globalThis.Response }> {
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

    // Collect attachment data via side channel (not through AI output)
    const messages = payload.messages as AssistantMessage[];
    const attachmentFullText = this.collectAttachmentTexts(messages);
    const attachmentInfos = this.collectAttachmentInfos(messages);

    const tools = createGroupedAssistantTools(
      {
        headers: incomingHeaders,
        ws: this.workspace,
        context: wsContext,
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
      },
      this.ai,
      this.scriptAgent,
    );

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
        if (error instanceof Error && error.stack) {
          this.logger.error(error.stack);
        }
      },
      onFinish: (event) => {
        this.logger.log(`Stream finished: reason=${event.finishReason}`);
      },
      onStepFinish: (event) => {
        this.logger.log(`Step finished: reason=${event.finishReason}`);
        if (event.finishReason === 'error') {
          this.logger.error(
            `Step error details: ${JSON.stringify({
              warnings: event.warnings,
              response: event.response ? { body: event.response.body } : null,
            })}`,
          );
        }
      },
    });

    return result;
  }

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
- 已有角色: ${characterSample || '暂无'}
- 已有场景: ${sceneSample || '暂无'}
- 已有道具: ${propSample || '暂无'}

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

    // Language instruction based on user locale
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
    const AI_EXCERPT_LIMIT = 2000; // AI only sees a short excerpt for decision-making
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

  /**
   * Collect full attachment text from all user messages.
   * Only contains text for plain-text files (PDF/DOCX excerpts are empty).
   */
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

  /**
   * Collect attachment metadata from all user messages.
   * Used by pipeline tools to download files from OSS for server-side extraction.
   */
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
