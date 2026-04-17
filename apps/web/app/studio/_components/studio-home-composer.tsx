"use client";

import { useRef, useState } from "react";
import { IconArrowUp, IconPaperclip, IconSparkles } from "@tabler/icons-react";
import { useTranslations } from "@/src/i18n/i18n";
import { cn } from "@/lib/utils";
import { api } from "@/src/lib/api";
import { useAppDispatch } from "@/src/store";
import { initAgent, setTaskId } from "@/src/store/slices/agentSlice";

type AgentKey = "character" | "episode" | "prop" | "scene";

const AGENTS: { key: AgentKey; labelKey: string }[] = [
  { key: "character", labelKey: "agentCharacter" },
  { key: "episode", labelKey: "agentEpisode" },
  { key: "prop", labelKey: "agentProp" },
  { key: "scene", labelKey: "agentScene" },
];

export function StudioHomeComposer() {
  const t = useTranslations("workspace");
  const dispatch = useAppDispatch();
  const [prompt, setPrompt] = useState("");
  const [agent, setAgent] = useState<AgentKey>("character");
  const [focused, setFocused] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const canSubmit = prompt.trim().length > 0;

  const handleSubmit = async () => {
    if (!canSubmit) return;
    const id = crypto.randomUUID();
    dispatch(initAgent({ id, prompt: prompt.trim() }));
    try {
      const task = await api.post<{ id: string }>("/aurora/api/tasks", {
        data: {
          type: "agent",
          input: { prompt: prompt.trim(), totalSteps: 3, agent },
        },
      });
      dispatch(setTaskId(task.id));
    } catch (err) {
      console.warn("[StudioHomeComposer] Failed to create task:", err);
    }
    setPrompt("");
  };

  return (
    <section className="mx-auto flex w-full max-w-3xl flex-col items-center gap-6">
      {/* Headline */}
      <div className="flex flex-col items-center gap-3 text-center">
        <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">
          {t("studioHomeTitle")}
        </h1>
        <p className="text-sm text-muted-foreground sm:text-base">{t("studioHomeSubtitle")}</p>
      </div>

      {/* Composer */}
      <div
        className={cn(
          "relative w-full rounded-3xl p-px transition-all duration-500",
          focused
            ? "bg-gradient-to-r from-primary/70 via-fuchsia-400/60 to-primary/70 shadow-[0_0_32px_-8px_oklch(0.591_0.225_26.8/0.35)]"
            : "bg-border"
        )}
      >
        <div className="rounded-[calc(var(--radius-3xl)-1px)] bg-card">
          <textarea
            ref={textareaRef}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && canSubmit) {
                e.preventDefault();
                handleSubmit();
              }
            }}
            placeholder={t("studioHomePlaceholder")}
            rows={3}
            className="min-h-[140px] w-full resize-none bg-transparent px-5 pt-5 text-[15px] leading-relaxed text-foreground placeholder:text-muted-foreground/70 focus:outline-none"
          />

          {/* Toolbar */}
          <div className="flex items-center justify-between gap-2 px-3 pb-3">
            <div className="flex items-center gap-1.5">
              <input
                ref={fileInputRef}
                type="file"
                accept=".txt,.md,.text,.docx,.pdf"
                className="hidden"
              />
              <ToolbarPill
                icon={<IconPaperclip className="size-3.5" />}
                onClick={() => fileInputRef.current?.click()}
              >
                {t("studioHomeScript")}
              </ToolbarPill>
            </div>

            <button
              type="button"
              onClick={handleSubmit}
              disabled={!canSubmit}
              aria-label={t("studioHomeSend")}
              className="flex size-9 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-[0_0_18px_-2px_oklch(0.591_0.225_26.8/0.5)] transition-all hover:bg-primary-hover disabled:opacity-40 disabled:shadow-none"
            >
              <IconArrowUp className="size-4" />
            </button>
          </div>
        </div>
      </div>

      {/* Agent chips */}
      <div className="flex flex-wrap items-center justify-center gap-2.5">
        {AGENTS.map(({ key, labelKey }) => (
          <AgentChip key={key} active={agent === key} onClick={() => setAgent(key)}>
            {t(labelKey)}
          </AgentChip>
        ))}
      </div>
    </section>
  );
}

function ToolbarPill({
  children,
  icon,
  onClick,
}: {
  children: React.ReactNode;
  icon: React.ReactNode;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex h-7 items-center gap-1.5 rounded-full border border-border/70 px-3 text-xs text-muted-foreground transition-colors hover:border-border hover:bg-muted hover:text-foreground"
    >
      {icon}
      {children}
    </button>
  );
}

function AgentChip({
  children,
  active,
  onClick,
}: {
  children: React.ReactNode;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex h-9 items-center gap-1.5 rounded-full border px-4 text-sm transition-all",
        active
          ? "border-primary/40 bg-primary/10 text-foreground shadow-[0_0_16px_-2px_oklch(0.591_0.225_26.8/0.45)]"
          : "border-border/70 bg-card text-muted-foreground hover:border-border hover:text-foreground"
      )}
    >
      <IconSparkles className={cn("size-3.5", active ? "text-primary" : "text-muted-foreground")} />
      {children}
    </button>
  );
}
