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
      worldId:
        typeof payload.workspaceContext?.worldId === 'string'
          ? payload.workspaceContext.worldId
          : undefined,
      episodeId:
        typeof payload.workspaceContext?.episodeId === 'string'
          ? payload.workspaceContext.episodeId
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

    const tools = createGroupedAssistantTools({
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
    });

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
      system: this.buildSystemPrompt(projectContext, payload.agentType),
      messages: modelMessages,
      stopWhen: stepCountIs(12),
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

  private buildSystemPrompt(context: ProjectContext, rawAgentType?: string) {
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
- 角色数量: ${context.characterSummary?.total ?? 0}
- 场景数量: ${context.sceneSummary?.total ?? 0}
- 道具数量: ${context.propSummary?.total ?? 0}
- 当前分镜列: ${columnNames || '暂无'}
- 当前镜头数量: ${context.storyboardSummary?.shotCount ?? 0}
- 角色样本: ${characterSample || '暂无'}
- 场景样本: ${sceneSample || '暂无'}
- 道具样本: ${propSample || '暂无'}

[行为模式]
你必须按以下 4 种模式分流，而不是把所有请求都当成同一种处理：
1. read-only：用户只是询问项目事实、资产现状、分镜信息时，只读取并回答，不写库。
2. direct execute：用户指令明确、目标唯一、参数齐全、风险低时，可直接调用写入工具。
3. proposal -> confirm -> execute：当任务需要你"创作/补全内容"、一次批量创建/修改多个实体、或者需要给用户看候选方案时，先 proposal，再等待用户确认，然后再 execute。
4. clarify：删除、覆盖、高风险操作，或者目标不明确时，不要猜，先追问或调用 confirm/show_options。

[具体规则]
1. 若用户刚刚对 proposal 工具返回了 accept / accept_edited，优先走对应的 batch execute 工具，不要再逐个循环 create。
2. 若 proposal 被 reject，则尊重用户并询问下一步，而不是擅自执行。
3. 若已有可用工具能读取信息，请先调用读取工具，不要凭空猜测项目现状。
4. 读取数据时遵循最佳实践：先用 summary 工具建立全局上下文；查找具体实体时用 search/page 工具；只有在"分析全部角色 / 全部分镜 / 全局一致性检查"这类场景下，才调用 aggregate 工具。
5. 回复要简洁、具体、可执行，避免空泛表述。
6. 图片生成功能正在开发中，暂不可用。如果用户要求生成图片，请告知该功能正在开发中，目前无法生成图片。
7. 绝对不要在回复中提及工具名称（如 create_scene、propose_storyboard_patch 等）。用户不需要知道你使用了什么工具，只需要看到结果。用自然语言描述你的操作意图，例如"我来帮你批量创建这些场景"而不是"我将使用 batch_create_scenes 工具"。
8. 当需要批量创建资产（角色/场景/道具）时，必须直接调用 propose 工具生成交互卡片，不要用文本列出方案再让用户输入 accept/reject。
9. 【强制】任何需要用户确认、选择或决策的场景，都必须调用 confirm_action 或 show_options 工具生成交互卡片。绝对禁止用纯文本要求用户回复"确认"、"accept"、"继续"等。包括但不限于：确认方案是否满意、选择覆盖哪个剧集、选择方案 A 或 B、确认是否继续下一步。
10. 完整方案模式：当用户要求拆解剧本或执行涉及多个资产类型的复杂任务时，在一次回复中同时调用多个 propose 工具（如 propose_characters + propose_scenes + propose_storyboard_patch），让用户一次性看到完整方案并逐个确认，而不是一步一步串行等待。用户确认某个提案后，自动执行对应的创建操作，无需用户手动输入"继续"。
11. 当任务涉及数值参数（如集数、时长、镜头数、字数等）时，必须调用 configure_params 工具生成参数表单，让用户可以直接调整数值后确认，而不是在文本中询问。例如拆解剧本时，应弹出表单让用户配置集数、每集时长等参数。`;

    const agentSection = loadAgentPrompt(agentType);
    return agentSection ? `${basePrompt}\n\n${agentSection}` : basePrompt;
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
    const lines = attachments.map((att, i) => {
      const parts = [
        `${i + 1}. 文件名：${att.name}`,
        `类型：${att.mimeType || 'unknown'}`,
      ];
      if (att.url) parts.push(`地址：${att.url}`);
      if (att.excerpt) parts.push(`内容摘要：${att.excerpt}`);
      return parts.join('\n');
    });
    return `[附件上下文]\n${lines.join('\n\n')}`;
  }
}
