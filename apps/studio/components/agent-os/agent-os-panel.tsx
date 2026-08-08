"use client";

import { useCallback, useEffect, useRef, useState, type MouseEvent } from "react";
import { useParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { IconPaperclip, IconPlus, IconSparkles, IconX } from "@tabler/icons-react";
import { toast } from "sonner";
import { agentOsSurfaceFromStudioMode } from "@repo/shared";
import { CopilotComposer } from "@/components/copilot/copilot-composer";
import {
  agentOsApi,
  type AgentOsAttachmentSummary,
  type AgentOsPermissionMode,
  type AgentOsSkillMeta,
} from "@/lib/agent-os/api-client";
import { emitAgentOsDomainChanged } from "@/lib/agent-os/domain-events";
import { cn } from "@/lib/utils";
import { AgentOsTranscript } from "./agent-os-transcript";
import { useAgentOsRun } from "./use-agent-os-run";

const MODEL_PROFILES = [
  { id: "qwen-plus", labelKey: "profileQwenPlus" as const },
  { id: "qwen-max", labelKey: "profileQwenMax" as const },
  { id: "qwen-turbo", labelKey: "profileQwenTurbo" as const },
];

const PERMISSION_MODES: Array<{
  id: AgentOsPermissionMode;
  labelKey: "permAsk" | "permSmart" | "permFull";
}> = [
  { id: "ask", labelKey: "permAsk" },
  { id: "smart", labelKey: "permSmart" },
  { id: "full", labelKey: "permFull" },
];

const SUGGESTIONS = ["suggestCharacters", "suggestShots", "suggestBoth"] as const;

const ACCEPT =
  ".txt,.md,.markdown,.fountain,.csv,.json,.xml,text/plain,text/markdown,text/csv,application/json";

const LS_PERM = "fizz:agent-os:permissionMode";
const LS_MODEL = "fizz:agent-os:modelProfileId";

function readLs(key: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeLs(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* ignore */
  }
}

/**
 * Agent OS side panel — chat + attachments + Codex-style permission/model near send.
 */
export function AgentOsPanel({ projectId, onClose }: { projectId: string; onClose: () => void }) {
  const t = useTranslations("agentOs");
  const routeParams = useParams();
  const studioMode = typeof routeParams.mode === "string" ? routeParams.mode : "storyboard";
  const surface = agentOsSurfaceFromStudioMode(studioMode);
  const { state, send, resolveApproval, newChat, stop } = useAgentOsRun(projectId);
  const [draft, setDraft] = useState("");
  const [pendingFiles, setPendingFiles] = useState<AgentOsAttachmentSummary[]>([]);
  const [uploading, setUploading] = useState(false);
  const [modelProfileId, setModelProfileId] = useState(() => {
    const saved = readLs(LS_MODEL);
    return MODEL_PROFILES.some((p) => p.id === saved) ? saved! : "qwen-plus";
  });
  const [permissionMode, setPermissionMode] = useState<AgentOsPermissionMode>(() => {
    const saved = readLs(LS_PERM);
    return saved === "ask" || saved === "smart" || saved === "full" ? saved : "smart";
  });
  const [busy, setBusy] = useState(false);
  const [workerOk, setWorkerOk] = useState<boolean | null>(null);
  /** Invocable skills for this surface (composer multi-select). */
  const [invocableSkills, setInvocableSkills] = useState<AgentOsSkillMeta[]>([]);
  /** Project admin defaults — pinned chips; persisted via Nest. */
  const [projectDefaultSkillIds, setProjectDefaultSkillIds] = useState<string[]>([]);
  /** True after project skills catalog/defaults load (or fail). */
  const [skillsHydrated, setSkillsHydrated] = useState(false);
  /** Per-turn selection (user toggles). */
  const [turnSkillIds, setTurnSkillIds] = useState<string[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const prevStatusRef = useRef(state.status);
  const lastSyncedRunRef = useRef<string | null>(null);
  /** Domain revision last observed — pure chat must not re-apply unchanged shots. */
  const lastCharacterCountRef = useRef(0);
  const domainBaselineReady = useRef(false);

  useEffect(() => {
    void agentOsApi
      .health()
      .then((h) => setWorkerOk(Boolean(h.ok && (h.worker?.ok ?? true))))
      .catch(() => setWorkerOk(false));
  }, []);

  // Baseline the character count so a pure-chat turn does not toast, and load
  // project default skills + the invocable catalog for the composer.
  useEffect(() => {
    let cancelled = false;
    domainBaselineReady.current = false;
    setSkillsHydrated(false);
    void Promise.all([
      agentOsApi.listCharacters(projectId),
      agentOsApi.getProjectSkills(projectId),
      agentOsApi.listSkills(surface),
    ])
      .then(([charactersPage, projectSkills, skillCatalog]) => {
        if (cancelled) return;
        lastCharacterCountRef.current = charactersPage.characters.length;
        domainBaselineReady.current = true;
        setProjectDefaultSkillIds(projectSkills.defaultSkillIds);
        setInvocableSkills(skillCatalog.invocable);
        // Drop turn picks that no longer apply to this surface.
        setTurnSkillIds((prev) =>
          prev.filter((id) => skillCatalog.invocable.some((s) => s.id === id))
        );
        setSkillsHydrated(true);
      })
      .catch(() => {
        if (!cancelled) {
          domainBaselineReady.current = true;
          // Leave skillsHydrated false so the skills row stays hidden
          // and Nest loads durable defaults from DB.
          setSkillsHydrated(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [projectId, surface]);

  useEffect(() => {
    writeLs(LS_PERM, permissionMode);
  }, [permissionMode]);

  useEffect(() => {
    writeLs(LS_MODEL, modelProfileId);
  }, [modelProfileId]);

  /**
   * Characters have no product surface yet, so a count bump is the only signal
   * the panel can give. Shots need nothing here: the server writes them into
   * the canvas document and the documents WS fans the operation out, and
   * reconnect catch-up is that layer's job — a second, client-side reconciler
   * would be re-deriving a CRDT it does not own.
   */
  const syncProductSurfaces = useCallback(async () => {
    if (!domainBaselineReady.current) return;
    try {
      const charactersPage = await agentOsApi.listCharacters(projectId);
      const characterCount = charactersPage.characters.length;
      const newCharacters = Math.max(0, characterCount - lastCharacterCountRef.current);
      lastCharacterCountRef.current = characterCount;
      if (newCharacters > 0) {
        emitAgentOsDomainChanged({ projectId, kind: "characters" });
      }
    } catch {
      /* durable state stays in Agent OS tables; nothing to reconcile here */
    }
  }, [projectId]);

  useEffect(() => {
    const prev = prevStatusRef.current;
    prevStatusRef.current = state.status;
    const finishedWork =
      (prev === "running" || prev === "waiting_for_approval") && state.status === "completed";
    if (!finishedWork || !state.runId) return;
    if (lastSyncedRunRef.current === state.runId) return;
    lastSyncedRunRef.current = state.runId;
    void syncProductSurfaces();
  }, [state.runId, state.status, syncProductSurfaces]);

  const turnBusy =
    busy || uploading || state.status === "running" || state.status === "waiting_for_approval";

  const canSend =
    !turnBusy &&
    modelProfileId.trim().length > 0 &&
    (draft.trim().length > 0 || pendingFiles.some((f) => f.status === "ready"));

  const onPickFiles = async (list: FileList | null) => {
    if (!list?.length) return;
    setUploading(true);
    try {
      const uploaded: AgentOsAttachmentSummary[] = [];
      for (const file of Array.from(list)) {
        const row = await agentOsApi.uploadAttachment(projectId, file);
        if (row.status !== "ready") {
          toast.error(row.errorMessage || t("attachmentFailed", { name: row.filename }));
          continue;
        }
        uploaded.push(row);
      }
      if (uploaded.length > 0) {
        setPendingFiles((prev) => {
          const byId = new Map(prev.map((p) => [p.id, p]));
          for (const u of uploaded) byId.set(u.id, u);
          return [...byId.values()];
        });
        toast.success(t("attachmentReady", { count: uploaded.length }));
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("attachmentFailedGeneric"));
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const removePending = (id: string) => {
    setPendingFiles((prev) => prev.filter((f) => f.id !== id));
  };

  const persistProjectDefaults = useCallback(
    async (next: string[]) => {
      const prev = projectDefaultSkillIds;
      setProjectDefaultSkillIds(next);
      try {
        const saved = await agentOsApi.setProjectDefaultSkills(projectId, next);
        setProjectDefaultSkillIds(saved.defaultSkillIds);
      } catch (error) {
        setProjectDefaultSkillIds(prev);
        toast.error(error instanceof Error ? error.message : t("skillDefaultFailed"));
      }
    },
    [projectDefaultSkillIds, projectId, t]
  );

  const onSkillChipClick = useCallback(
    (skillId: string, e: MouseEvent) => {
      if (turnBusy) return;
      // Alt/Option-click pins or unpins as project default (persisted).
      if (e.altKey) {
        e.preventDefault();
        const isDefault = projectDefaultSkillIds.includes(skillId);
        const next = isDefault
          ? projectDefaultSkillIds.filter((id) => id !== skillId)
          : [...projectDefaultSkillIds, skillId];
        void persistProjectDefaults(next);
        return;
      }
      if (projectDefaultSkillIds.includes(skillId)) return;
      setTurnSkillIds((prev) =>
        prev.includes(skillId) ? prev.filter((id) => id !== skillId) : [...prev, skillId]
      );
    },
    [persistProjectDefaults, projectDefaultSkillIds, turnBusy]
  );

  const onSend = async () => {
    if (!canSend) return;
    const text = draft.trim();
    const ready = pendingFiles.filter((f) => f.status === "ready");
    const attachmentIds = ready.map((f) => f.id);
    const attachmentNames = ready.map((f) => f.filename);
    setDraft("");
    setPendingFiles([]);
    setBusy(true);
    try {
      await send({
        message: text,
        modelProfileId,
        attachmentIds,
        attachmentNames,
        permissionMode,
        surface,
        skillIds: turnSkillIds,
        // After hydrate, send composer state (includes optimistic pin).
        // Before hydrate / on load failure, omit so Nest reads durable DB defaults.
      });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("sendFailed"));
    } finally {
      setBusy(false);
    }
  };

  const onApprove = async (decision: "approve" | "reject") => {
    const approvalId = state.pendingApproval?.approvalId;
    // Provisional ids are UI-only until ApprovalRequired lands with a real UUID.
    if (approvalId && (approvalId.startsWith("pending:") || !/^[0-9a-f-]{36}$/i.test(approvalId))) {
      toast.error(t("approvalNotReady"));
      return;
    }
    setBusy(true);
    try {
      // Feedback lives in the transcript (decision bubble + stream / cancel),
      // not a floating toast.
      await resolveApproval({ decision, modelProfileId, permissionMode });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("approvalFailed"));
    } finally {
      setBusy(false);
    }
  };

  const selectClassName =
    "h-8 max-w-[7.25rem] shrink-0 rounded-xl border-0 bg-white/[0.08] px-2 text-[11px] text-white/80 outline-none focus:bg-white/[0.12] disabled:opacity-50";

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex shrink-0 items-center gap-2 border-b border-white/[0.06] px-3 py-2.5">
        <IconSparkles className="size-4 shrink-0 text-white/70" stroke={1.8} />
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-sm font-semibold text-white/90">{t("title")}</h2>
          <p className="truncate text-[10px] text-white/40">
            {workerOk === false
              ? t("workerOffline")
              : workerOk === true
                ? t("workerOnline")
                : t("subtitle")}
          </p>
        </div>
        <button
          type="button"
          onClick={newChat}
          disabled={busy}
          title={t("newChat")}
          aria-label={t("newChat")}
          className="flex size-8 items-center justify-center rounded-xl text-white/55 transition hover:bg-white/[0.08] hover:text-white disabled:opacity-40"
        >
          <IconPlus className="size-4" stroke={1.8} />
        </button>
        <button
          type="button"
          onClick={onClose}
          aria-label={t("close")}
          className="flex size-8 items-center justify-center rounded-xl text-white/55 transition hover:bg-white/[0.08] hover:text-white"
        >
          <IconX className="size-4" stroke={1.8} />
        </button>
      </header>

      <AgentOsTranscript
        messages={state.messages}
        status={state.status}
        error={state.error}
        busy={busy}
        pendingApprovalActive={Boolean(state.pendingApproval)}
        onApprove={(decision) => void onApprove(decision)}
        labels={{
          transcript: t("transcriptLabel"),
          scrollToLatest: t("scrollToLatest"),
          user: t("roleUser"),
          assistant: t("roleAssistant"),
          system: t("roleSystem"),
          tool: t("roleTool"),
          thinking: t("thinking"),
          approve: t("approve"),
          reject: t("reject"),
          scriptAttached: (chars) => t("scriptAttached", { chars }),
          plan: t("event.PlanCreated"),
          payload: {
            creates: (count) => t("approvalCreates", { count }),
            updates: (count) => t("approvalUpdates", { count }),
            deletes: (count) => t("approvalDeletes", { count }),
            andMore: (count) => t("approvalAndMore", { count }),
            showDetails: t("approvalShowDetails"),
            hideDetails: t("approvalHideDetails"),
            untitled: t("approvalUntitled"),
          },
        }}
        empty={
          <div className="w-full space-y-3 px-1 pt-1">
            <p className="text-xs leading-relaxed text-white/45">{t("emptyHint")}</p>
            <div className="flex flex-wrap gap-1.5">
              {SUGGESTIONS.map((key) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setDraft(t(key))}
                  className="rounded-full bg-white/[0.05] px-2.5 py-1 text-[11px] text-white/65 transition hover:bg-white/[0.09] hover:text-white/90"
                >
                  {t(key)}
                </button>
              ))}
            </div>
          </div>
        }
      />

      <footer className="shrink-0 space-y-2 border-t border-white/[0.06] px-3 py-2.5">
        <input
          ref={fileInputRef}
          type="file"
          accept={ACCEPT}
          multiple
          className="hidden"
          onChange={(e) => void onPickFiles(e.target.files)}
        />

        {invocableSkills.length > 0 ? (
          <div className="flex flex-wrap items-center gap-1.5 px-0.5">
            <span className="text-[10px] text-white/35">{t("skillsLabel")}</span>
            {invocableSkills.map((skill) => {
              const isDefault = projectDefaultSkillIds.includes(skill.id);
              const isTurn = turnSkillIds.includes(skill.id);
              const active = isDefault || isTurn;
              const titleParts = [
                skill.description,
                isDefault ? t("skillProjectDefault", { name: skill.name }) : t("skillToggleTurn"),
                isDefault ? t("skillUnpinDefault") : t("skillPinDefault"),
              ];
              return (
                <button
                  key={skill.id}
                  type="button"
                  disabled={turnBusy}
                  title={titleParts.join(" · ")}
                  aria-pressed={active}
                  onClick={(e) => onSkillChipClick(skill.id, e)}
                  className={cn(
                    "rounded-full px-2 py-0.5 text-[10px] transition",
                    active
                      ? "bg-white/15 text-white/90"
                      : "bg-white/[0.05] text-white/50 hover:bg-white/[0.09] hover:text-white/75",
                    isDefault && "ring-1 ring-white/20"
                  )}
                >
                  {skill.name}
                  {isDefault ? (
                    <span className="text-white/45">
                      {" · "}
                      {t("skillDefaultBadge")}
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>
        ) : null}

        <CopilotComposer
          value={draft}
          onChange={setDraft}
          onSubmit={() => void onSend()}
          onStop={() => {
            stop(t("stopped"));
            setBusy(false);
          }}
          busy={turnBusy}
          sendDisabled={!canSend && !turnBusy}
          canSendWithoutText={pendingFiles.some((f) => f.status === "ready")}
          placeholder={t("composerPlaceholder")}
          inputLabel={t("message")}
          sendLabel={t("send")}
          stopLabel={t("stop")}
          autoFocus
          className="bg-white/[0.04]"
          leadingAction={
            <button
              type="button"
              disabled={turnBusy}
              onClick={() => fileInputRef.current?.click()}
              aria-label={t("attachFile")}
              title={t("attachFile")}
              className="grid size-10 shrink-0 place-items-center rounded-2xl text-white/55 transition hover:bg-white/[0.08] hover:text-white disabled:opacity-40"
            >
              <IconPaperclip className="size-4" stroke={1.8} />
            </button>
          }
          beforeSend={
            <div className="flex shrink-0 items-center gap-1">
              <select
                value={permissionMode}
                onChange={(e) => setPermissionMode(e.target.value as AgentOsPermissionMode)}
                disabled={turnBusy}
                aria-label={t("permissionMode")}
                title={t(`permHint_${permissionMode}`)}
                className={selectClassName}
              >
                {PERMISSION_MODES.map((mode) => (
                  <option key={mode.id} value={mode.id} className="bg-neutral-900">
                    {t(mode.labelKey)}
                  </option>
                ))}
              </select>
              <select
                value={modelProfileId}
                onChange={(e) => setModelProfileId(e.target.value)}
                disabled={turnBusy}
                aria-label={t("modelProfile")}
                className={selectClassName}
              >
                {MODEL_PROFILES.map((profile) => (
                  <option key={profile.id} value={profile.id} className="bg-neutral-900">
                    {t(profile.labelKey)}
                  </option>
                ))}
              </select>
            </div>
          }
          attachmentBar={
            pendingFiles.length > 0 || uploading ? (
              <div className="flex flex-wrap gap-1.5">
                {uploading ? (
                  <span className="rounded-full bg-white/[0.06] px-2 py-0.5 text-[10px] text-white/50">
                    {t("uploading")}
                  </span>
                ) : null}
                {pendingFiles.map((file) => (
                  <span
                    key={file.id}
                    className="inline-flex max-w-full items-center gap-1 rounded-full bg-white/[0.08] px-2 py-0.5 text-[10px] text-white/75"
                  >
                    <span className="truncate">{file.filename}</span>
                    <button
                      type="button"
                      onClick={() => removePending(file.id)}
                      className="shrink-0 text-white/40 hover:text-white/80"
                      aria-label={t("removeAttachment")}
                    >
                      <IconX className="size-3" stroke={2} />
                    </button>
                  </span>
                ))}
              </div>
            ) : null
          }
        />

        <p className="px-0.5 text-[10px] tabular-nums text-white/30">
          {t("status", { status: state.status })}
          {state.conversationId ? ` · ${state.conversationId.slice(0, 8)}` : ""}
        </p>
      </footer>
    </div>
  );
}
