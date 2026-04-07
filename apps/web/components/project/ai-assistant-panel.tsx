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
  IconAd,
  IconBook2,
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
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
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
  setAgentType,
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
    nameKey: "generalAgent" as const,
    descKey: "generalAgentDesc" as const,
  },
  {
    key: "script",
    icon: <IconPencil className="size-4" />,
    nameKey: "scriptAgent" as const,
    descKey: "scriptAgentDesc" as const,
  },
  {
    key: "storyboard",
    icon: <IconMovie className="size-4" />,
    nameKey: "storyboardAgent" as const,
    descKey: "storyboardAgentDesc" as const,
  },
  {
    key: "character",
    icon: <IconUser className="size-4" />,
    nameKey: "characterAgent" as const,
    descKey: "characterAgentDesc" as const,
  },
  {
    key: "scene",
    icon: <IconMapPin className="size-4" />,
    nameKey: "sceneAgent" as const,
    descKey: "sceneAgentDesc" as const,
  },
  {
    key: "ad",
    icon: <IconAd className="size-4" />,
    nameKey: "adAgent" as const,
    descKey: "adAgentDesc" as const,
  },
  {
    key: "novel",
    icon: <IconBook2 className="size-4" />,
    nameKey: "novelAgent" as const,
    descKey: "novelAgentDesc" as const,
  },
] as const;

type QuickAction = {
  icon: React.ReactNode;
  titleKey: string;
  descKey: string;
  promptKey: string;
  colors: string[];
  glowColor: string;
};

const quickActionsByAgent: Record<string, QuickAction[]> = {
  general: [
    {
      icon: <IconFileText className="size-5" />,
      titleKey: "breakdownScript",
      descKey: "breakdownScriptDesc",
      promptKey: "breakdownScriptPrompt",
      colors: ["#f87171", "#fb923c", "#f472b6"],
      glowColor: "0 80 65",
    },
    {
      icon: <IconLayoutGrid className="size-5" />,
      titleKey: "designStoryboard",
      descKey: "designStoryboardDesc",
      promptKey: "designStoryboardPrompt",
      colors: ["#a78bfa", "#818cf8", "#38bdf8"],
      glowColor: "250 70 70",
    },
    {
      icon: <IconPackage className="size-5" />,
      titleKey: "assetAnalysis",
      descKey: "assetAnalysisDesc",
      promptKey: "assetAnalysisPrompt",
      colors: ["#34d399", "#2dd4bf", "#a3e635"],
      glowColor: "160 70 65",
    },
  ],
  script: [
    {
      icon: <IconFileText className="size-5" />,
      titleKey: "qaScriptWrite",
      descKey: "qaScriptWriteDesc",
      promptKey: "qaScriptWritePrompt",
      colors: ["#f87171", "#fb923c", "#f472b6"],
      glowColor: "0 80 65",
    },
    {
      icon: <IconLayoutGrid className="size-5" />,
      titleKey: "qaScriptAnalyze",
      descKey: "qaScriptAnalyzeDesc",
      promptKey: "qaScriptAnalyzePrompt",
      colors: ["#a78bfa", "#818cf8", "#38bdf8"],
      glowColor: "250 70 70",
    },
    {
      icon: <IconPencil className="size-5" />,
      titleKey: "qaScriptDialogue",
      descKey: "qaScriptDialogueDesc",
      promptKey: "qaScriptDialoguePrompt",
      colors: ["#34d399", "#2dd4bf", "#a3e635"],
      glowColor: "160 70 65",
    },
  ],
  storyboard: [
    {
      icon: <IconMovie className="size-5" />,
      titleKey: "qaStoryboardSplit",
      descKey: "qaStoryboardSplitDesc",
      promptKey: "qaStoryboardSplitPrompt",
      colors: ["#a78bfa", "#818cf8", "#38bdf8"],
      glowColor: "250 70 70",
    },
    {
      icon: <IconLayoutGrid className="size-5" />,
      titleKey: "qaStoryboardOptimize",
      descKey: "qaStoryboardOptimizeDesc",
      promptKey: "qaStoryboardOptimizePrompt",
      colors: ["#f87171", "#fb923c", "#f472b6"],
      glowColor: "0 80 65",
    },
    {
      icon: <IconMapPin className="size-5" />,
      titleKey: "qaStoryboardTransition",
      descKey: "qaStoryboardTransitionDesc",
      promptKey: "qaStoryboardTransitionPrompt",
      colors: ["#34d399", "#2dd4bf", "#a3e635"],
      glowColor: "160 70 65",
    },
  ],
  character: [
    {
      icon: <IconUser className="size-5" />,
      titleKey: "qaCharacterExtract",
      descKey: "qaCharacterExtractDesc",
      promptKey: "qaCharacterExtractPrompt",
      colors: ["#f87171", "#fb923c", "#f472b6"],
      glowColor: "0 80 65",
    },
    {
      icon: <IconPencil className="size-5" />,
      titleKey: "qaCharacterDesign",
      descKey: "qaCharacterDesignDesc",
      promptKey: "qaCharacterDesignPrompt",
      colors: ["#a78bfa", "#818cf8", "#38bdf8"],
      glowColor: "250 70 70",
    },
    {
      icon: <IconPackage className="size-5" />,
      titleKey: "qaCharacterRelation",
      descKey: "qaCharacterRelationDesc",
      promptKey: "qaCharacterRelationPrompt",
      colors: ["#34d399", "#2dd4bf", "#a3e635"],
      glowColor: "160 70 65",
    },
  ],
  scene: [
    {
      icon: <IconMapPin className="size-5" />,
      titleKey: "qaSceneCreate",
      descKey: "qaSceneCreateDesc",
      promptKey: "qaSceneCreatePrompt",
      colors: ["#34d399", "#2dd4bf", "#a3e635"],
      glowColor: "160 70 65",
    },
    {
      icon: <IconLayoutGrid className="size-5" />,
      titleKey: "qaSceneAnalyze",
      descKey: "qaSceneAnalyzeDesc",
      promptKey: "qaSceneAnalyzePrompt",
      colors: ["#a78bfa", "#818cf8", "#38bdf8"],
      glowColor: "250 70 70",
    },
    {
      icon: <IconPencil className="size-5" />,
      titleKey: "qaSceneAtmosphere",
      descKey: "qaSceneAtmosphereDesc",
      promptKey: "qaSceneAtmospherePrompt",
      colors: ["#f87171", "#fb923c", "#f472b6"],
      glowColor: "0 80 65",
    },
  ],
  ad: [
    {
      icon: <IconAd className="size-5" />,
      titleKey: "qaAdScript",
      descKey: "qaAdScriptDesc",
      promptKey: "qaAdScriptPrompt",
      colors: ["#f87171", "#fb923c", "#f472b6"],
      glowColor: "0 80 65",
    },
    {
      icon: <IconLayoutGrid className="size-5" />,
      titleKey: "qaAdStoryboard",
      descKey: "qaAdStoryboardDesc",
      promptKey: "qaAdStoryboardPrompt",
      colors: ["#a78bfa", "#818cf8", "#38bdf8"],
      glowColor: "250 70 70",
    },
    {
      icon: <IconPackage className="size-5" />,
      titleKey: "qaAdPlatform",
      descKey: "qaAdPlatformDesc",
      promptKey: "qaAdPlatformPrompt",
      colors: ["#34d399", "#2dd4bf", "#a3e635"],
      glowColor: "160 70 65",
    },
  ],
  novel: [
    {
      icon: <IconBook2 className="size-5" />,
      titleKey: "qaNovelCreate",
      descKey: "qaNovelCreateDesc",
      promptKey: "qaNovelCreatePrompt",
      colors: ["#f87171", "#fb923c", "#f472b6"],
      glowColor: "0 80 65",
    },
    {
      icon: <IconFileText className="size-5" />,
      titleKey: "qaNovelAdapt",
      descKey: "qaNovelAdaptDesc",
      promptKey: "qaNovelAdaptPrompt",
      colors: ["#a78bfa", "#818cf8", "#38bdf8"],
      glowColor: "250 70 70",
    },
    {
      icon: <IconSparkles className="size-5" />,
      titleKey: "qaNovelExplore",
      descKey: "qaNovelExploreDesc",
      promptKey: "qaNovelExplorePrompt",
      colors: ["#34d399", "#2dd4bf", "#a3e635"],
      glowColor: "160 70 65",
    },
  ],
};

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

const markdownComponents = {
  p: ({ children }: { children?: React.ReactNode }) => <p className="mb-3 last:mb-0">{children}</p>,
  strong: ({ children }: { children?: React.ReactNode }) => (
    <strong className="font-semibold">{children}</strong>
  ),
  ul: ({ children }: { children?: React.ReactNode }) => (
    <ul className="mb-3 list-disc space-y-1 pl-4 last:mb-0">{children}</ul>
  ),
  ol: ({ children }: { children?: React.ReactNode }) => (
    <ol className="mb-3 list-decimal space-y-1 pl-4 last:mb-0">{children}</ol>
  ),
  li: ({ children }: { children?: React.ReactNode }) => <li>{children}</li>,
  code: ({ children, className }: { children?: React.ReactNode; className?: string }) => {
    const isBlock = className?.includes("language-");
    if (isBlock) {
      return (
        <code className="block overflow-x-auto rounded-lg bg-black/20 p-3 text-xs">{children}</code>
      );
    }
    return <code className="rounded bg-black/20 px-1.5 py-0.5 text-xs">{children}</code>;
  },
  h1: ({ children }: { children?: React.ReactNode }) => (
    <h1 className="mb-2 text-base font-bold">{children}</h1>
  ),
  h2: ({ children }: { children?: React.ReactNode }) => (
    <h2 className="mb-2 text-sm font-bold">{children}</h2>
  ),
  h3: ({ children }: { children?: React.ReactNode }) => (
    <h3 className="mb-1 text-sm font-semibold">{children}</h3>
  ),
  blockquote: ({ children }: { children?: React.ReactNode }) => (
    <blockquote className="mb-3 border-l-2 border-foreground/20 pl-3 italic last:mb-0">
      {children}
    </blockquote>
  ),
  hr: () => <hr className="my-3 border-border" />,
  table: ({ children }: { children?: React.ReactNode }) => (
    <div className="mb-3 overflow-x-auto last:mb-0">
      <table className="w-full border-collapse text-xs">{children}</table>
    </div>
  ),
  th: ({ children }: { children?: React.ReactNode }) => (
    <th className="border border-border bg-black/10 px-2 py-1 text-left font-semibold">
      {children}
    </th>
  ),
  td: ({ children }: { children?: React.ReactNode }) => (
    <td className="border border-border px-2 py-1">{children}</td>
  ),
};

function getFileTypeKey(mimeType?: string, name?: string): string {
  const ext = name?.split(".").pop()?.toLowerCase();
  if (ext === "docx" || ext === "doc" || mimeType?.includes("wordprocessingml"))
    return "fileTypeWord";
  if (ext === "pdf" || mimeType === "application/pdf") return "fileTypePdf";
  if (ext === "txt" || mimeType === "text/plain") return "fileTypeText";
  if (ext === "xlsx" || mimeType?.includes("spreadsheetml")) return "fileTypeExcel";
  if (ext === "pptx" || mimeType?.includes("presentationml")) return "fileTypePpt";
  if (mimeType?.startsWith("image/")) return "fileTypeImage";
  if (mimeType?.startsWith("video/")) return "fileTypeVideo";
  if (mimeType?.startsWith("audio/")) return "fileTypeAudio";
  return "fileTypeDefault";
}

function AssistantFilePreview({ attachment }: { attachment: AssistantAttachment }) {
  const t = useTranslations("ai");
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
      className="flex items-center justify-between gap-3 overflow-hidden rounded-xl border border-border/70 bg-background/60 px-3 py-2 text-xs transition-colors hover:border-primary/30 hover:bg-primary/5"
    >
      <div className="min-w-0">
        <div className="truncate font-medium text-foreground">{attachment.name}</div>
        <div className="truncate text-muted-foreground">
          {t(getFileTypeKey(attachment.mimeType, attachment.name))}
        </div>
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
          "max-w-full overflow-hidden px-2 py-2 text-[13px] leading-relaxed break-words",
          message.role === "user" ? "rounded-xl bg-muted" : ""
        )}
      >
        {message.metadata?.attachments?.length ? (
          <div className="mb-2 grid gap-2 overflow-hidden">
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
                  className="max-w-none text-[13px] leading-relaxed"
                >
                  <Markdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
                    {part.text}
                  </Markdown>
                  {part.state === "streaming" && (
                    <span className="inline-block h-4 w-0.5 animate-pulse bg-foreground/60" />
                  )}
                </div>
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
  const selectedAgent = conversation?.agentType ?? "general";
  const [agentMenuOpen, setAgentMenuOpen] = useState(false);
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

  // Auto-scroll: track the last message content length to detect streaming updates
  const lastMessageLength = useMemo(() => {
    const last = messages[messages.length - 1];
    if (!last) return 0;
    return last.parts.reduce(
      (len, p) => len + ("text" in p && typeof p.text === "string" ? p.text.length : 0),
      0
    );
  }, [messages]);

  useEffect(() => {
    messagesRef.current?.scrollTo({
      top: messagesRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages, sending, lastMessageLength]);

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
            {(quickActionsByAgent[selectedAgent] ?? quickActionsByAgent.general).map((action) => {
              const prompt = t(action.promptKey);
              return (
                <BorderGlow
                  key={action.titleKey}
                  className="cursor-pointer"
                  backgroundColor="var(--color-card)"
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

              <Popover open={agentMenuOpen} onOpenChange={setAgentMenuOpen}>
                <PopoverTrigger asChild>
                  <Button variant="ghost" color="muted" size="sm" className="gap-1">
                    {currentAgent.icon}
                    <span className="text-xs">{t(currentAgent.nameKey)}</span>
                    <IconChevronDown className="size-3 text-muted-foreground" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent
                  align="start"
                  side="top"
                  className="w-65 border-white/8 bg-white/6 gap-2 p-2 shadow-2xl backdrop-blur-2xl backdrop-saturate-150"
                >
                  {AI_AGENTS.map((agent) => (
                    <button
                      key={agent.key}
                      type="button"
                      onClick={() => {
                        if (projectId) {
                          dispatch(
                            setAgentType({
                              projectId,
                              agentType: agent.key as typeof selectedAgent,
                            })
                          );
                        }
                        setAgentMenuOpen(false);
                      }}
                      className={cn(
                        "flex w-full cursor-pointer items-start gap-2 rounded-lg px-3 py-2 text-left transition-colors",
                        selectedAgent === agent.key
                          ? "bg-primary/10 text-primary"
                          : "hover:bg-white/10"
                      )}
                    >
                      <span className="mt-0.5 shrink-0">{agent.icon}</span>
                      <div className="min-w-0">
                        <div className="text-xs font-medium">{t(agent.nameKey)}</div>
                        <div className="text-[11px] text-muted-foreground">{t(agent.descKey)}</div>
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

        <p className="mt-2 text-center text-[11px] text-muted-foreground/50">{t("aiDisclaimer")}</p>
      </>
    );
  }
}
