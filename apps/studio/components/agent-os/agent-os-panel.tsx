"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import {
  IconAlertTriangle,
  IconLoader2,
  IconPlayerPlay,
  IconSparkles,
  IconX,
} from "@tabler/icons-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useAgentOsRun } from "./use-agent-os-run";
import type { AgentOsEvent } from "@/lib/agent-os/api-client";

const MODEL_PROFILES = [
  { id: "qwen-plus", labelKey: "profileQwenPlus" as const },
  { id: "qwen-max", labelKey: "profileQwenMax" as const },
  { id: "qwen-turbo", labelKey: "profileQwenTurbo" as const },
];

export function AgentOsPanel({ projectId, onClose }: { projectId: string; onClose: () => void }) {
  const t = useTranslations("agentOs");
  const { state, start, resolveApproval, reset } = useAgentOsRun(projectId);
  const [message, setMessage] = useState("");
  const [scriptText, setScriptText] = useState("");
  const [modelProfileId, setModelProfileId] = useState("qwen-plus");
  const [busy, setBusy] = useState(false);

  const canSend =
    !busy &&
    state.status !== "running" &&
    state.status !== "waiting_for_approval" &&
    message.trim().length > 0 &&
    modelProfileId.trim().length > 0;

  const timeline = useMemo(
    () => state.events.filter((e) => e.type !== "MessageDelta"),
    [state.events]
  );

  const onSubmit = async () => {
    if (!canSend) return;
    setBusy(true);
    try {
      await start({
        message: message.trim(),
        modelProfileId,
        scriptText: scriptText.trim() || undefined,
      });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("runFailed"));
    } finally {
      setBusy(false);
    }
  };

  const onApprove = async (decision: "approve" | "reject") => {
    setBusy(true);
    try {
      await resolveApproval({ decision, modelProfileId });
      if (decision === "approve") toast.success(t("approved"));
      else toast.message(t("rejected"));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("approvalFailed"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex h-full flex-col">
      <header className="flex shrink-0 items-start justify-between gap-3 border-b border-white/[0.06] px-4 py-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <IconSparkles className="size-4 text-white/70" stroke={1.8} />
            <h2 className="truncate text-sm font-semibold text-white/90">{t("title")}</h2>
          </div>
          <p className="mt-0.5 text-[11px] text-white/45">{t("subtitle")}</p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label={t("close")}
          className="flex size-8 items-center justify-center rounded-full text-white/60 transition-colors hover:bg-white/[0.08] hover:text-white"
        >
          <IconX className="size-4" stroke={1.8} />
        </button>
      </header>

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-3">
        {state.error ? (
          <div className="flex items-start gap-2 rounded-xl bg-red-500/10 px-3 py-2 text-xs text-red-200">
            <IconAlertTriangle className="mt-0.5 size-3.5 shrink-0" stroke={1.8} />
            <span>{state.error}</span>
          </div>
        ) : null}

        {timeline.length === 0 && state.status === "idle" ? (
          <p className="text-xs leading-relaxed text-white/45">{t("emptyHint")}</p>
        ) : null}

        <ol className="space-y-2">
          {timeline.map((event) => (
            <EventRow key={`${event.sequence}-${event.id}`} event={event} />
          ))}
        </ol>

        {state.assistantText ? (
          <div className="rounded-xl bg-white/[0.05] px-3 py-2 text-sm leading-relaxed text-white/85">
            {state.assistantText}
          </div>
        ) : null}

        {state.pendingApproval ? (
          <div className="space-y-2 rounded-xl border border-white/10 bg-white/[0.04] p-3">
            <p className="text-xs font-medium text-white/80">{state.pendingApproval.title}</p>
            <p className="text-[11px] text-white/50">{state.pendingApproval.description}</p>
            <p className="font-mono text-[10px] text-white/40">{state.pendingApproval.toolId}</p>
            <div className="flex gap-2 pt-1">
              <Button
                type="button"
                size="sm"
                disabled={busy}
                onClick={() => void onApprove("approve")}
              >
                {t("approve")}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="secondary"
                disabled={busy}
                onClick={() => void onApprove("reject")}
              >
                {t("reject")}
              </Button>
            </div>
          </div>
        ) : null}
      </div>

      <footer className="shrink-0 space-y-2 border-t border-white/[0.06] px-4 py-3">
        <label className="block space-y-1">
          <span className="text-[10px] font-medium uppercase tracking-wide text-white/40">
            {t("modelProfile")}
          </span>
          <select
            value={modelProfileId}
            onChange={(e) => setModelProfileId(e.target.value)}
            className="h-9 w-full rounded-lg border-0 bg-white/[0.06] px-3 text-xs text-white outline-none focus:bg-white/[0.09]"
          >
            {MODEL_PROFILES.map((profile) => (
              <option key={profile.id} value={profile.id} className="bg-neutral-900">
                {t(profile.labelKey)}
              </option>
            ))}
          </select>
        </label>

        <label className="block space-y-1">
          <span className="text-[10px] font-medium uppercase tracking-wide text-white/40">
            {t("scriptOptional")}
          </span>
          <textarea
            value={scriptText}
            onChange={(e) => setScriptText(e.target.value)}
            rows={3}
            placeholder={t("scriptPlaceholder")}
            className="w-full resize-none rounded-lg border-0 bg-white/[0.06] px-3 py-2 text-xs text-white outline-none placeholder:text-white/30 focus:bg-white/[0.09]"
          />
        </label>

        <label className="block space-y-1">
          <span className="text-[10px] font-medium uppercase tracking-wide text-white/40">
            {t("message")}
          </span>
          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            rows={3}
            placeholder={t("messagePlaceholder")}
            className="w-full resize-none rounded-lg border-0 bg-white/[0.06] px-3 py-2 text-xs text-white outline-none placeholder:text-white/30 focus:bg-white/[0.09]"
          />
        </label>

        <div className="flex gap-2">
          <Button
            type="button"
            className="flex-1"
            disabled={!canSend}
            onClick={() => void onSubmit()}
          >
            {busy || state.status === "running" ? (
              <IconLoader2 className="size-4 animate-spin" stroke={1.8} />
            ) : (
              <IconPlayerPlay className="size-4" stroke={1.8} />
            )}
            <span className="ml-1.5">{t("run")}</span>
          </Button>
          <Button type="button" variant="secondary" disabled={busy} onClick={reset}>
            {t("reset")}
          </Button>
        </div>

        <p
          className={cn(
            "text-[10px] tabular-nums text-white/35",
            state.status === "failed" && "text-red-300/80",
            state.status === "completed" && "text-emerald-300/70"
          )}
        >
          {t("status", { status: state.status })}
          {state.runId ? ` · ${state.runId.slice(0, 8)}` : ""}
        </p>
      </footer>
    </div>
  );
}

function EventRow({ event }: { event: AgentOsEvent }) {
  const t = useTranslations("agentOs");
  const label = eventLabel(event.type, t);
  return (
    <li className="rounded-lg bg-white/[0.03] px-3 py-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-medium text-white/75">{label}</span>
        <span className="font-mono text-[10px] text-white/30">#{event.sequence}</span>
      </div>
      {event.type === "ToolProposed" || event.type === "ToolCompleted" ? (
        <p className="mt-0.5 font-mono text-[10px] text-white/40">
          {String(event.data.toolId ?? "")}
        </p>
      ) : null}
      {event.type === "PlanCreated" && Array.isArray(event.data.steps) ? (
        <ul className="mt-1 list-inside list-disc text-[11px] text-white/50">
          {(event.data.steps as string[]).map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ul>
      ) : null}
    </li>
  );
}

const EVENT_KEYS: Record<string, string> = {
  RunStarted: "event.RunStarted",
  PlanCreated: "event.PlanCreated",
  ToolProposed: "event.ToolProposed",
  ToolStarted: "event.ToolStarted",
  ToolCompleted: "event.ToolCompleted",
  ToolFailed: "event.ToolFailed",
  ApprovalRequired: "event.ApprovalRequired",
  ApprovalResolved: "event.ApprovalResolved",
  MessageCompleted: "event.MessageCompleted",
  RunPaused: "event.RunPaused",
  RunCompleted: "event.RunCompleted",
  RunFailed: "event.RunFailed",
  RunCancelled: "event.RunCancelled",
  ProjectPatchApplied: "event.ProjectPatchApplied",
};

function eventLabel(type: string, t: (key: string) => string): string {
  const key = EVENT_KEYS[type];
  return key ? t(key) : type;
}
