"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  IconArrowsMaximize,
  IconArrowsMinimize,
  IconChevronDown,
  IconFileText,
  IconLayoutGrid,
  IconLoader2,
  IconMapPin,
  IconMovie,
  IconPackage,
  IconPencil,
  IconPlus,
  IconRefresh,
  IconSend,
  IconSparkles,
  IconTrash,
  IconUser,
  IconX,
} from "@tabler/icons-react";
import { BorderGlow } from "@/components/ui/border-glow";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { marked } from "marked";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { AssistantToolCard } from "@/components/project/assistant/assistant-tool-card";
import { PanelLayout } from "@/components/project/panels/panel-layout";
import { Button } from "@/components/ui/button";
import {
  getAssistantToolDisplayName,
  getAssistantToolName,
  isAssistantToolPart,
  type AssistantAttachment,
  type AssistantMessage,
  type PendingAssistantToolUi,
  type AssistantToolResult,
} from "@/src/lib/assistant/assistant-types";
import { useAppSelector, useAppDispatch } from "@/src/store";
import { store } from "@/src/store";
import {
  ensureProject,
  setDraft,
  addAttachments,
  removeAttachment,
  retryAttachment,
  sendUserMessage,
  applyToolResult,
  resetProjectConversation,
  setPanelExpanded,
  selectAssistantConversation,
} from "@/src/store/slices/assistantSlice";

const MAX_ATTACHMENTS = 1;

const AI_AGENTS = [
  {
    key: "general",
    icon: <IconSparkles className="size-4" />,
    name: "通用助手",
    description: "自由提问，智能理解你的需求",
  },
  {
    key: "script",
    icon: <IconPencil className="size-4" />,
    name: "剧本大师",
    description: "拆剧本、分集、写台词、分析节奏",
  },
  {
    key: "storyboard",
    icon: <IconMovie className="size-4" />,
    name: "分镜导演",
    description: "生成分镜、镜头语言、景别运镜",
  },
  {
    key: "character",
    icon: <IconUser className="size-4" />,
    name: "角色设计师",
    description: "提取角色、生成形象、三视图",
  },
  {
    key: "scene",
    icon: <IconMapPin className="size-4" />,
    name: "场景设计师",
    description: "场景构建、氛围设计、全景图",
  },
] as const;

const quickActionDefs = [
  {
    icon: <IconFileText className="size-5" />,
    titleKey: "breakdownScript" as const,
    descKey: "breakdownScriptDesc" as const,
    promptKey: "breakdownScriptPrompt" as const,
    colors: ["#f87171", "#fb923c", "#f472b6"],
    glowColor: "0 80 65",
  },
  {
    icon: <IconLayoutGrid className="size-5" />,
    titleKey: "designStoryboard" as const,
    descKey: "designStoryboardDesc" as const,
    promptKey: "designStoryboardPrompt" as const,
    colors: ["#a78bfa", "#818cf8", "#38bdf8"],
    glowColor: "250 70 70",
  },
  {
    icon: <IconPackage className="size-5" />,
    titleKey: "assetAnalysis" as const,
    descKey: "assetAnalysisDesc" as const,
    promptKey: "assetAnalysisPrompt" as const,
    colors: ["#34d399", "#2dd4bf", "#a3e635"],
    glowColor: "160 70 65",
  },
];

const EMPTY_MESSAGES: AssistantMessage[] = [];
const EMPTY_ATTACHMENTS: AssistantAttachment[] = [];
const EMPTY_PENDING_TOOLS: PendingAssistantToolUi[] = [];

function formatFileSize(size: number) {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function isImageMime(mimeType?: string) {
  return Boolean(mimeType?.startsWith("image/"));
}

function renderMarkdown(text: string) {
  return marked.parse(text || "", { breaks: true, gfm: true }) as string;
}

function AssistantFilePreview({ attachment }: { attachment: AssistantAttachment }) {
  const href = attachment.previewUrl || attachment.url || attachment.path || "#";

  return isImageMime(attachment.mimeType) && href ? (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="block overflow-hidden rounded-xl border border-border/70 bg-background/60"
    >
      <img src={href} alt={attachment.name} className="h-36 w-full object-cover" />
      <div className="flex items-center justify-between gap-3 px-3 py-2 text-xs text-muted-foreground">
        <span className="truncate">{attachment.name}</span>
        <span>{formatFileSize(attachment.size)}</span>
      </div>
    </a>
  ) : (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="flex items-center justify-between gap-3 rounded-xl border border-border/70 bg-background/60 px-3 py-2 text-xs transition-colors hover:border-primary/30 hover:bg-primary/5"
    >
      <div className="min-w-0">
        <div className="truncate font-medium text-foreground">{attachment.name}</div>
        <div className="truncate text-muted-foreground">{attachment.mimeType || "unknown"}</div>
      </div>
      <span className="shrink-0 text-muted-foreground">{formatFileSize(attachment.size)}</span>
    </a>
  );
}

function MessageBubble({
  message,
  sending,
  submittingToolCallId,
  onApplyToolResult,
}: {
  message: AssistantMessage;
  sending: boolean;
  submittingToolCallId: string | null;
  onApplyToolResult: (result: AssistantToolResult) => void;
}) {
  return (
    <div
      id={`assistant-message-${message.id}`}
      className={cn("flex", message.role === "user" ? "justify-end" : "justify-start")}
    >
      <div
        className={cn(
          "max-w-[85%] px-2 py-2 text-[13px] leading-relaxed",
          message.role === "user" ? "rounded-xl bg-muted" : ""
        )}
      >
        {message.metadata?.attachments?.length ? (
          <div className="mb-2 grid gap-2">
            {message.metadata.attachments.map((attachment) => (
              <AssistantFilePreview key={attachment.id} attachment={attachment} />
            ))}
          </div>
        ) : null}

        <div className="space-y-3">
          {message.parts.map((part, index) => {
            if (part.type === "text") {
              return (
                <div
                  key={`${message.id}-text-${index}`}
                  className="prose prose-sm max-w-none text-foreground prose-p:my-2 prose-pre:overflow-x-auto prose-pre:rounded-xl prose-pre:bg-black/20 prose-pre:p-3 prose-code:text-foreground prose-strong:text-foreground prose-a:text-primary"
                  dangerouslySetInnerHTML={{ __html: renderMarkdown(part.text) }}
                />
              );
            }

            if (part.type === "reasoning") {
              return (
                <div
                  key={`${message.id}-reasoning-${index}`}
                  className="rounded-xl border border-dashed border-border/70 bg-black/10 px-3 py-2 text-xs text-muted-foreground"
                >
                  {part.text}
                </div>
              );
            }

            if (part.type === "file" && message.role === "assistant") {
              return (
                <AssistantFilePreview
                  key={`${message.id}-file-${index}`}
                  attachment={{
                    id: `${message.id}-file-${index}`,
                    name: part.filename || part.url.split("/").pop() || "attachment",
                    mimeType: part.mediaType,
                    size: 0,
                    url: part.url,
                    status: "uploaded",
                  }}
                />
              );
            }

            if (part.type === "source-url") {
              return (
                <a
                  key={`${message.id}-source-url-${index}`}
                  href={part.url}
                  target="_blank"
                  rel="noreferrer"
                  className="block rounded-xl border border-border/70 bg-background/40 px-3 py-2 text-xs text-primary transition-colors hover:bg-primary/5"
                >
                  {part.title || part.url}
                </a>
              );
            }

            if (part.type === "source-document") {
              return (
                <div
                  key={`${message.id}-source-document-${index}`}
                  className="rounded-xl border border-border/70 bg-background/40 px-3 py-2 text-xs text-muted-foreground"
                >
                  {part.title}
                </div>
              );
            }

            if (isAssistantToolPart(part)) {
              return (
                <AssistantToolCard
                  key={`${message.id}-${part.toolCallId}-${getAssistantToolName(part)}-${part.state}`}
                  part={part}
                  disabled={sending}
                  processing={sending && submittingToolCallId === part.toolCallId}
                  onApplyResult={onApplyToolResult}
                />
              );
            }

            return null;
          })}
        </div>
      </div>
    </div>
  );
}

interface AiAssistantPanelProps {
  onClose: () => void;
}

export function AiAssistantPanel({ onClose }: AiAssistantPanelProps) {
  const t = useTranslations("ai");
  const tc = useTranslations("common");
  const dispatch = useAppDispatch();
  const projectId = useAppSelector((state) => state.project.currentProjectId);

  const conversation = useAppSelector((state) =>
    projectId ? state.assistant.projects[projectId] : undefined
  );

  const messagesRef = useRef<HTMLDivElement | null>(null);
  const editorRef = useRef<HTMLDivElement | null>(null);
  const [selectedAgent, setSelectedAgent] = useState("general");
  const currentAgent = AI_AGENTS.find((a) => a.key === selectedAgent) ?? AI_AGENTS[0];
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (projectId) {
      dispatch(ensureProject(projectId));
    }
  }, [ensureProject, projectId]);

  const messages = conversation?.messages ?? EMPTY_MESSAGES;
  const draftInput = conversation?.draftInput ?? "";
  const attachments = conversation?.attachments ?? EMPTY_ATTACHMENTS;
  const sending = conversation?.sending ?? false;
  const panelExpanded = conversation?.panelExpanded ?? false;
  const pendingToolUi = conversation?.pendingToolUi ?? EMPTY_PENDING_TOOLS;
  const submittingToolCallId = conversation?.submittingToolCallId ?? null;
  const error = conversation?.error ?? null;

  useEffect(() => {
    messagesRef.current?.scrollTo({
      top: messagesRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages, sending]);

  // 当 store 中 draftInput 被清空时（发送后），同步清空 contentEditable DOM
  useEffect(() => {
    if (!draftInput && editorRef.current && editorRef.current.innerText.trim()) {
      editorRef.current.innerText = "";
    }
  }, [draftInput]);

  const hasMeaningfulMessages = messages.length > 1;
  const hasUploadingAttachments = attachments.some(
    (attachment) => attachment.status === "uploading"
  );

  const renderedMessages = useMemo(() => messages, [messages]);
  const pendingItems = useMemo(
    () =>
      pendingToolUi.map((item) => ({
        ...item,
        label: item.title || getAssistantToolDisplayName(item.toolName),
      })),
    [pendingToolUi]
  );

  const scrollToMessage = (messageId: string) => {
    const element = document.getElementById(`assistant-message-${messageId}`);
    if (!element) return;
    element.scrollIntoView({ behavior: "smooth", block: "center" });
  };

  return (
    <PanelLayout
      icon={
        <div className="flex size-9 items-center justify-center rounded-2xl bg-primary/10 text-primary">
          <IconSparkles className="size-4" />
        </div>
      }
      title={t("title")}
      description={t("panelDescription")}
      actions={null}
      onClose={onClose}
      footer={renderFooter()}
    >
      {pendingItems.length > 0 ? (
        <div className="border-b border-border/60 px-4 py-3">
          <div className="mb-2 text-xs font-medium text-muted-foreground">
            {t("pendingCount", { count: pendingItems.length })}
          </div>
          <div className="flex flex-wrap gap-2">
            {pendingItems.map((item) => (
              <button
                key={item.toolCallId}
                type="button"
                onClick={() => scrollToMessage(item.messageId)}
                className="rounded-full border border-primary/20 bg-primary/5 px-2.5 py-1 text-xs text-primary transition-colors hover:border-primary/35 hover:bg-primary/10"
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      <div ref={messagesRef} className="flex-1 space-y-4 overflow-y-auto">
        {!hasMeaningfulMessages ? (
          <div className="space-y-3">
            <div className="px-1 text-center mb-6">
              <p className="text-sm font-medium">{t("greeting")}</p>
              <p className="mt-1 text-xs text-muted-foreground">{t("greetingHint")}</p>
            </div>
            {quickActionDefs.map((action) => {
              const prompt = t(action.promptKey);
              return (
                <BorderGlow
                  key={action.titleKey}
                  className="cursor-pointer"
                  backgroundColor="oklch(0.205 0.006 285.88)"
                  borderRadius={16}
                  glowRadius={24}
                  glowColor={action.glowColor}
                  colors={action.colors}
                  glowIntensity={0.8}
                  fillOpacity={0.3}
                >
                  <button
                    type="button"
                    onClick={() => {
                      if (!projectId) return;
                      dispatch(setDraft({ projectId: projectId, draft: prompt }));
                      if (editorRef.current) {
                        editorRef.current.innerText = prompt;
                      }
                    }}
                    className="w-full p-3 text-left"
                  >
                    <div className="flex items-center gap-2.5">
                      <span className="text-muted-foreground">{action.icon}</span>
                      <span className="text-sm font-medium">{t(action.titleKey)}</span>
                    </div>
                    <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
                      {t(action.descKey)}
                    </p>
                  </button>
                </BorderGlow>
              );
            })}
          </div>
        ) : null}

        {renderedMessages.map((message) => (
          <MessageBubble
            key={message.id}
            message={message}
            sending={sending}
            submittingToolCallId={submittingToolCallId}
            onApplyToolResult={(result) => {
              if (!projectId) return;
              void dispatch(applyToolResult({ projectId: projectId, result: result }));
            }}
          />
        ))}

        {sending &&
        !messages.some(
          (message) =>
            message.role === "assistant" &&
            message.parts.some((part) => part.type === "text" && part.state === "streaming")
        ) ? (
          <div className="flex items-center gap-2 px-2 py-2 text-xs text-muted-foreground">
            <IconLoader2 className="size-3.5 animate-spin" />
            {t("aiReplying")}
          </div>
        ) : null}
      </div>
    </PanelLayout>
  );

  function renderFooter() {
    return (
      <>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          className="hidden"
          onChange={(event) => {
            const files = Array.from(event.target.files ?? []);
            if (projectId && files.length > 0) {
              void dispatch(addAttachments({ projectId: projectId, files: files }));
            }
            event.currentTarget.value = "";
          }}
        />

        <div className="rounded-xl bg-muted p-3">
          {attachments.length > 0 ? (
            <div className="mb-3 flex flex-wrap gap-2">
              {attachments.map((attachment) => (
                <div
                  key={attachment.id}
                  className="flex max-w-full items-center gap-2 rounded-2xl border border-border/70 bg-muted/30 px-2.5 py-2"
                >
                  {isImageMime(attachment.mimeType) && attachment.previewUrl ? (
                    <img
                      src={attachment.previewUrl}
                      alt={attachment.name}
                      className="size-10 rounded-lg object-cover"
                    />
                  ) : null}
                  <div className="min-w-0">
                    <div className="truncate text-xs font-medium">{attachment.name}</div>
                    <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                      <span>{formatFileSize(attachment.size)}</span>
                      {attachment.status === "uploading" ? (
                        <span className="inline-flex items-center gap-1">
                          <IconLoader2 className="size-3 animate-spin" />
                          {t("uploading")}
                        </span>
                      ) : attachment.status === "error" ? (
                        <button
                          type="button"
                          className="inline-flex items-center gap-1 text-destructive hover:text-destructive/80"
                          onClick={() =>
                            projectId &&
                            void dispatch(
                              retryAttachment({ projectId: projectId, attachmentId: attachment.id })
                            )
                          }
                        >
                          <IconRefresh className="size-3" />
                          {tc("retry")}
                        </button>
                      ) : (
                        <span>{t("uploaded")}</span>
                      )}
                    </div>
                  </div>
                  <button
                    type="button"
                    className="flex size-6 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground"
                    onClick={() =>
                      projectId &&
                      dispatch(
                        removeAttachment({ projectId: projectId, attachmentId: attachment.id })
                      )
                    }
                  >
                    <IconX className="size-3.5" />
                  </button>
                </div>
              ))}
            </div>
          ) : null}

          <div
            ref={editorRef}
            contentEditable
            suppressContentEditableWarning
            role="textbox"
            aria-multiline="true"
            data-placeholder={`${t("inputPlaceholder")} (${t("sendHint")})`}
            className="min-h-24 max-h-52 overflow-y-auto text-sm leading-relaxed outline-none empty:before:pointer-events-none empty:before:float-left empty:before:h-0 empty:before:text-muted-foreground/40 empty:before:content-[attr(data-placeholder)]"
            onInput={(event) => {
              if (projectId)
                dispatch(
                  setDraft({ projectId, draft: (event.target as HTMLDivElement).innerText })
                );
            }}
            onKeyDown={(event) => {
              if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
                event.preventDefault();
                if (projectId) void dispatch(sendUserMessage(projectId));
              }
            }}
          />

          <div className="mt-3 flex items-center justify-between gap-2">
            <div className="flex min-w-0 items-center gap-2">
              <Button
                variant="ghost"
                color="muted"
                size="icon-xs"
                onClick={() => fileInputRef.current?.click()}
                disabled={sending || !projectId || attachments.length >= MAX_ATTACHMENTS}
              >
                <IconPlus className="size-4" />
              </Button>

              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="ghost" color="muted" size="sm" className="gap-1">
                    {currentAgent.icon}
                    <span className="text-xs">{currentAgent.name}</span>
                    <IconChevronDown className="size-3 text-muted-foreground" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent align="start" side="top" className="w-[260px] p-1.5">
                  {AI_AGENTS.map((agent) => (
                    <button
                      key={agent.key}
                      type="button"
                      onClick={() => setSelectedAgent(agent.key)}
                      className={cn(
                        "flex w-full cursor-pointer items-start gap-2.5 rounded-lg px-3 py-2 text-left transition-colors",
                        selectedAgent === agent.key
                          ? "bg-primary/10 text-primary"
                          : "hover:bg-muted"
                      )}
                    >
                      <span className="mt-0.5 shrink-0">{agent.icon}</span>
                      <div className="min-w-0">
                        <div className="text-xs font-medium">{agent.name}</div>
                        <div className="text-[11px] text-muted-foreground">{agent.description}</div>
                      </div>
                    </button>
                  ))}
                </PopoverContent>
              </Popover>
            </div>
            <Button
              size="icon-sm"
              onClick={() => projectId && void dispatch(sendUserMessage(projectId))}
              disabled={
                sending ||
                hasUploadingAttachments ||
                !projectId ||
                (!draftInput.trim() && attachments.every((a) => a.status !== "uploaded"))
              }
            >
              {sending ? (
                <IconLoader2 className="size-4 animate-spin" />
              ) : (
                <IconSend className="size-4" />
              )}
            </Button>
          </div>

          {error ? <div className="mt-2 text-xs text-destructive">{error}</div> : null}
        </div>
      </>
    );
  }
}
