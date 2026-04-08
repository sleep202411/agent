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
      system: this.buildSystemPrompt(
        projectContext,
        payload.agentType,
        wsContext.locale,
      ),
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

[剧本拆解全流程 — 必须严格按顺序执行]
当用户要求"拆解剧本"、"分集"、"把这个小说改编成短剧"等任务时，必须按以下固定步骤执行：

Step 1: 采集参数
- 调用 configure_params 让用户配置：集数、每集时长(分钟，默认2)、每分钟镜头数(默认15，范围12-20)
- 这三个参数是全链路的核心约束，后续所有步骤都必须遵守

Step 2: 分集映射（Episode Mapping）— 一次性处理所有集
- 分析原文/附件内容，一次性生成全部集数的分集映射表
- 每集包含：集号、对应原文范围、标题、一句话剧情、起承转合、结尾钩子、场景列表、出场角色
- 用文本向用户展示完整映射表，调用 confirm_action 让用户确认
- 确认后调用 batch_create_episodes 一次性创建所有剧集（禁止逐个创建）

Step 3: 资产提取（角色 + 场景 + 道具）— 从全部内容中充分提取
- 从原文/附件的全部内容中提取所有角色、场景、道具（不是只看第一集）
- 【充分提取 — 数量参考】：
  · 角色：提取所有有台词或重要戏份的人物。10集以上的项目通常有10-30个角色。
  · 场景：提取原文中出现的所有具体地点（如"周家大厅"、"厨房"、"街道"、"祠堂"、"比赛现场"等），不要合并为笼统的"房间"。10集以上通常有15-40个场景。
  · 道具：提取剧情中出现的所有关键物品（武器、信物、食材、文件、工具等）。通常有10-20个道具。
  · 如果你提取出的场景/道具少于10个，重新扫描全文补充遗漏。
- 【去重】先检查上下文中的"已有角色/场景/道具"，跳过已存在的同名实体
- 同时调用 propose_characters + propose_scenes + propose_props
- 用户确认后批量创建

Step 4: 逐集生成剧本
- 按 Step 2 的映射，逐集生成可拍摄格式剧本
- 每集用 propose_script 展示给用户确认
- 用户确认后通过 save_episode_script 写入
- 完成一集后调用 confirm_action 询问"继续下一集？"

Step 5: 逐集生成分镜
- 基于该集剧本，生成镜头级分镜表
- 每集用 propose_storyboard_patch 展示给用户确认
- 用户确认后写入分镜表
- 完成一集后调用 confirm_action 询问"继续下一集？"

[剧本格式 — Shootable Script Format]
剧本必须使用可拍摄格式，禁止纯散文：
- 每段以时间码开头（如 0:00-0:15），时间连续覆盖整集时长
- 画面描述行以 [Visual] 开头（现在时态 + 主动语态，可拍摄的外显画面）
- 音效行以 [SFX/Ambience] 开头（动词大写）
- 角色对白：角色名 (括号语) 台词
- 内心独白用 (V.O.) 标注
输出语言必须跟随用户输入语言（中文输入→中文输出）。示例：
0:00-0:15
[Visual] 外景 天界斩仙台 - 白天。云端仙境，流光溢彩，斩仙台高耸入云。天兵天将用铁链锁住周禾，按压在斩仙台的铡刀下。
[Visual] 周禾身着白色仙袍，面容刚毅，眼中带着不甘与愤怒。
[SFX/Ambience] 仙界钟声回荡；铁链哗哗作响；远处众仙窃窃私语。
玉皇大帝 (威严地) 周禾，你身为天上厨神，竟敢勾结魔界，泄露天庭食谱。今日在斩仙台，朕要亲自监斩！

[分镜质量标准]
1. 分镜表每行 = 一个镜头（3-5秒），不是集摘要。禁止把"第N集标题"写入分镜表。
2. 镜头密度：每分钟 12-20 个镜头（Step 1 参数约束）
3. 画面描述(description)必须是电影级可拍摄描述，120-220字，包含：
   - 场景环境（光影、空间、物件、氛围）
   - 角色外貌、服装、姿态、表情细节
   - 色调、材质、空间层次
   ❌ 错误示例：掌柜盘算孔乙己的欠账，面露不满。
   ✅ 正确示例：民国初期，江南小镇街道，咸亨酒店门口曲尺形柜台，木质招牌。柜台后站着一位中年掌柜，身穿长衫，低头翻看泛黄账本，一手拨算盘，眉头微蹙，嘴角下撇。柜台上摆着未盖的酒坛和几只碗。街道青石板路，薄雾，淡雅怀旧色调，写实风格，电影感光影。
4. Image_Prompt 格式：[主体描述], [动作/姿态], [环境/场景], [光影/色彩], [风格], [画质参数]，120-220字
5. Video_Prompt 三段式（英文）：1) Camera movement 2) Visual description 3) Sound
6. 场景列只写稳定环境名（不写动作/事件），道具列只写实体道具（不写环境/天气/声音）
7. 同一 Scene_ID 的所有镜头复用同一套光线(Scene_Lighting)和服装(Costume)
8. dialogue 和 narration 必须区分：台词=角色说的话，旁白=VO/内心独白
9. 【语言规则】中文输入时，所有字段必须用中文：
   - description（画面描述）：中文
   - video_prompt（视频提示词）：中文
   - style_planting（风格）：中文
   - movement（运镜）：中文（如"推镜"、"摇镜"、"跟拍"，不要写"Push"、"Pan"）
   - shot_size（景别）：中文（如"近景"、"中景"、"全景"，不要写"Close-up"、"Medium shot"）
   - perspective（视角）：中文（如"平视"、"俯拍"、"仰拍"，不要写"Eye level"、"High angle"）
   - dialogue（台词）：中文

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
