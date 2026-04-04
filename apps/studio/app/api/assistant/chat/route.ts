import { type NextRequest, NextResponse } from "next/server";

// Assistant tool calls may chain multiple Java API requests (storyboard save = 300s)
export const maxDuration = 300;
import {
  convertToModelMessages,
  stepCountIs,
  streamText,
  validateUIMessages,
  type ToolSet,
  type UIMessage,
} from "ai";
import { z } from "zod";
import { getModel } from "@/src/lib/ai/provider";
import { getProjectContextSummary, type WorkspaceContext } from "@/src/lib/assistant/workspace";
import { createGroupedAssistantTools } from "@/src/lib/assistant/tools";

// ─── Zod schemas ────────────────────────────────────────

const workspaceContextSchema = z.object({
  worldId: z.string().nullable().optional(),
  episodeId: z.string().nullable().optional(),
  activeTab: z.string().nullable().optional(),
  activePanel: z.string().nullable().optional(),
  locale: z.string().nullable().optional(),
});

const messagePartSchema = z.object({ type: z.string().min(1) }).passthrough();

const attachmentSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  mimeType: z.string().min(1),
  size: z.number().nonnegative(),
  path: z.string().optional(),
  url: z.string().optional(),
  excerpt: z.string().optional(),
  status: z.enum(["uploading", "uploaded", "error"]).optional(),
  error: z.string().optional(),
});

const messageSchema = z
  .object({
    id: z.string().optional(),
    role: z.enum(["system", "user", "assistant"]),
    metadata: z.object({ attachments: z.array(attachmentSchema).optional() }).optional(),
    parts: z.array(messagePartSchema),
  })
  .passthrough();

const chatRequestSchema = z.object({
  projectId: z.string().min(1),
  messages: z.array(messageSchema).min(1),
  workspaceContext: workspaceContextSchema.partial().optional(),
});

// ─── Types ──────────────────────────────────────────────

type Attachment = z.infer<typeof attachmentSchema>;

type AssistantMessage = UIMessage<{ attachments?: Attachment[] }>;

// ─── Helpers ────────────────────────────────────────────

function normalizeWorkspaceContext(
  projectId: string,
  incoming?: z.infer<typeof workspaceContextSchema>
): WorkspaceContext {
  return {
    projectId,
    worldId: typeof incoming?.worldId === "string" ? incoming.worldId : undefined,
    episodeId: typeof incoming?.episodeId === "string" ? incoming.episodeId : undefined,
    activeTab: typeof incoming?.activeTab === "string" ? incoming.activeTab : undefined,
    activePanel: typeof incoming?.activePanel === "string" ? incoming.activePanel : undefined,
    locale: typeof incoming?.locale === "string" ? incoming.locale : undefined,
  };
}

type ProjectContext = Awaited<ReturnType<typeof getProjectContextSummary>>;

function buildSystemPrompt(context: ProjectContext) {
  const projectName = typeof context.detail?.name === "string" ? context.detail.name : "未命名项目";
  const projectDescription =
    typeof context.detail?.description === "string" ? context.detail.description : "";
  const activeEpisode = context.episodes.find(
    (ep: Record<string, unknown>) => String(ep.id) === String(context.episodeId)
  );
  const activeEpisodeTitle =
    typeof activeEpisode?.title === "string" ? activeEpisode.title : "未选择剧集";
  const characterSample = (context.characterSummary?.sampleNames ?? []).join("、");
  const sceneSample = (context.sceneSummary?.sampleNames ?? []).join("、");
  const propSample = (context.propSummary?.sampleNames ?? []).join("、");
  const columnNames = (context.storyboardSummary?.columnNames ?? []).slice(0, 20).join("、");

  return `你是 FizzDragon Studio 项目详情页里的 AI 助手。你的职责是帮助创作者理解项目、提出可执行方案，并在用户明确授权时通过工具修改当前项目。

[当前项目上下文]
- projectId: ${context.projectId}
- worldId: ${context.worldId ?? "unknown"}
- 当前项目: ${projectName}
- 项目简介: ${projectDescription || "暂无"}
- 当前剧集: ${activeEpisodeTitle}
- activeTab: ${context.activeTab ?? "storyboard"}
- activePanel: ${context.activePanel ?? "none"}
- 剧集数量: ${context.episodes.length}
- 角色数量: ${context.characterSummary?.total ?? 0}
- 场景数量: ${context.sceneSummary?.total ?? 0}
- 道具数量: ${context.propSummary?.total ?? 0}
- 当前分镜列: ${columnNames || "暂无"}
- 当前镜头数量: ${context.storyboardSummary?.shotCount ?? 0}
- 角色样本: ${characterSample || "暂无"}
- 场景样本: ${sceneSample || "暂无"}
- 道具样本: ${propSample || "暂无"}

[行为模式]
你必须按以下 4 种模式分流，而不是把所有请求都当成同一种处理：
1. read-only：
   - 用户只是询问项目事实、资产现状、分镜信息时，只读取并回答，不写库。
2. direct execute：
   - 用户指令明确、目标唯一、参数齐全、风险低时，可直接调用写入工具。
   - 例如：更新项目名称、更新某个角色描述、修改某个单元格。
3. proposal -> confirm -> execute：
   - 当任务需要你"创作/补全内容"、一次批量创建/修改多个实体、或者需要给用户看候选方案时，先 proposal，再等待用户确认，然后再 execute。
   - 角色提案接受后，调用 batch_create_characters。
   - 场景提案接受后，调用 batch_create_scenes。
   - 道具提案接受后，调用 batch_create_props。
   - 分镜提案接受后，调用 save_storyboard_draft。
4. clarify：
   - 删除、覆盖、高风险操作，或者目标不明确时，不要猜，先追问或调用 confirm/show_options。

[具体规则]
1. 若用户刚刚对 proposal 工具返回了 accept / accept_edited，优先走对应的 batch execute 工具，不要再逐个循环 create。
2. 若 proposal 被 reject，则尊重用户并询问下一步，而不是擅自执行。
3. 若已有可用工具能读取信息，请先调用读取工具，不要凭空猜测项目现状。
4. 读取数据时遵循最佳实践：
   - 先用 summary 工具建立全局上下文；
   - 查找具体实体时用 search/page 工具；
   - 只有在"分析全部角色 / 全部分镜 / 全局一致性检查"这类场景下，才调用 aggregate 工具。
5. 回复要简洁、具体、可执行，避免空泛表述。`;
}

function buildAttachmentContext(attachments: Attachment[]) {
  if (attachments.length === 0) return "";
  const lines = attachments.map((att, i) => {
    const parts = [`${i + 1}. 文件名：${att.name}`, `类型：${att.mimeType || "unknown"}`];
    if (att.url) parts.push(`地址：${att.url}`);
    if (att.excerpt) parts.push(`内容摘要：${att.excerpt}`);
    return parts.join("\n");
  });
  return `[附件上下文]\n${lines.join("\n\n")}`;
}

function augmentMessages(messages: AssistantMessage[]): AssistantMessage[] {
  return messages.map((message) => {
    if (message.role !== "user") return message;
    const attachments = message.metadata?.attachments ?? [];
    if (attachments.length === 0) return message;
    const existingContext = message.parts.some(
      (part) =>
        part.type === "text" &&
        "text" in part &&
        (part as { text: string }).text.includes("[附件上下文]")
    );
    if (existingContext) return message;
    return {
      ...message,
      parts: [
        ...message.parts,
        { type: "text" as const, text: buildAttachmentContext(attachments) },
      ],
    };
  });
}

// ─── Route Handler ──────────────────────────────────────

export async function POST(req: NextRequest) {
  let payload: z.infer<typeof chatRequestSchema>;
  try {
    const body = await req.json();
    payload = chatRequestSchema.parse(body);
  } catch {
    return NextResponse.json({ message: "助手请求格式不合法" }, { status: 400 });
  }

  const workspace = normalizeWorkspaceContext(payload.projectId, payload.workspaceContext);

  const tools = createGroupedAssistantTools({
    headers: req.headers,
    workspace,
    requireWorldId: () => {
      if (!workspace.worldId) {
        throw new Error("当前项目缺少 worldId，暂时无法操作角色、场景或道具。");
      }
      return workspace.worldId;
    },
    requireEpisodeId: () => {
      if (!workspace.episodeId) {
        throw new Error("当前未选中剧集，暂时无法读取或写入分镜。");
      }
      return workspace.episodeId;
    },
  });

  const projectContext = await getProjectContextSummary(req.headers, workspace);

  const validationTools = tools as unknown as ToolSet;
  let validatedMessages: AssistantMessage[];
  try {
    validatedMessages = await validateUIMessages({
      messages: payload.messages,
      tools: validationTools,
    } as never);
  } catch {
    return NextResponse.json({ message: "助手消息格式不合法" }, { status: 400 });
  }

  const preparedMessages = augmentMessages(validatedMessages);
  const modelInputMessages = preparedMessages.map((msg) => ({ ...msg, id: undefined }));
  const modelMessages = await convertToModelMessages(modelInputMessages, {
    tools: validationTools,
  });

  const result = streamText({
    model: getModel(),
    tools,
    toolChoice: "auto",
    system: buildSystemPrompt(projectContext),
    messages: modelMessages,
    stopWhen: stepCountIs(12),
    temperature: 0.2,
    onError: ({ error }) => {
      const msg = error instanceof Error ? error.message : String(error);
      console.error(`[Assistant] stream failed: ${msg}`);
    },
  });

  return result.toUIMessageStreamResponse();
}
