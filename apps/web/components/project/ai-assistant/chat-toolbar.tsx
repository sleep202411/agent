import { useRef, useState } from "react";
import { IconChevronDown, IconLoader2, IconMovie, IconPlus, IconSend } from "@tabler/icons-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { useTranslations } from "@/src/i18n/i18n";
import { cn } from "@/lib/utils";
import { useAppDispatch, useAppSelector } from "@/src/store";
import {
  setAgentType,
  setVideoPromptStyle,
  addAttachments,
  sendUserMessage,
} from "@/src/store/slices/assistantSlice";
import { AI_AGENTS, MAX_ATTACHMENTS } from "./constants";

interface ChatToolbarProps {
  projectId: string | null;
  draftInput: string;
  attachmentsCount: number;
  sending: boolean;
  hasPendingTools: boolean;
  hasUploadingAttachments: boolean;
  selectedAgent: string;
}

export function ChatToolbar({
  projectId,
  draftInput,
  attachmentsCount,
  sending,
  hasPendingTools,
  hasUploadingAttachments,
  selectedAgent,
}: ChatToolbarProps) {
  const t = useTranslations("ai");
  const tc = useTranslations("common");
  const dispatch = useAppDispatch();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [agentMenuOpen, setAgentMenuOpen] = useState(false);
  const currentAgent = AI_AGENTS.find((a) => a.key === selectedAgent) ?? AI_AGENTS[0];
  const videoPromptStyle = useAppSelector(
    (s) => (projectId ? s.assistant.projects[projectId]?.videoPromptStyle : undefined) ?? "default"
  );

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
            void dispatch(addAttachments({ projectId, files, t: tc }));
          }
          event.currentTarget.value = "";
        }}
      />

      <div className="mt-3 flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <Button
            variant="ghost"
            color="muted"
            size="icon-xs"
            onClick={() => fileInputRef.current?.click()}
            disabled={sending || !projectId || attachmentsCount >= MAX_ATTACHMENTS}
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
                        setAgentType({ projectId, agentType: agent.key as typeof selectedAgent })
                      );
                    }
                    setAgentMenuOpen(false);
                  }}
                  className={cn(
                    "flex w-full cursor-pointer items-start gap-2 rounded-lg px-3 py-2 text-left transition-colors",
                    selectedAgent === agent.key ? "bg-primary/10 text-primary" : "hover:bg-white/10"
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

          <Button
            variant="ghost"
            color="muted"
            size="sm"
            className={cn("gap-1 text-xs", videoPromptStyle === "seedance" && "text-primary")}
            onClick={() => {
              if (projectId) {
                dispatch(
                  setVideoPromptStyle({
                    projectId,
                    style: videoPromptStyle === "seedance" ? "default" : "seedance",
                  })
                );
              }
            }}
          >
            <IconMovie className="size-3.5" />
            {videoPromptStyle === "seedance" ? "Seedance" : t("defaultStyle")}
          </Button>
        </div>

        <Button
          size="icon-sm"
          onClick={() => projectId && !hasPendingTools && void dispatch(sendUserMessage(projectId))}
          disabled={
            sending ||
            hasPendingTools ||
            hasUploadingAttachments ||
            !projectId ||
            !draftInput.trim()
          }
        >
          {sending ? (
            <IconLoader2 className="size-4 animate-spin" />
          ) : (
            <IconSend className="size-4" />
          )}
        </Button>
      </div>
    </>
  );
}
