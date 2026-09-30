"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useQuery } from "@tanstack/react-query";
import { STORY_VISUAL_STYLE_SKILL_SLUGS } from "@repo/shared";
import {
  IconAlertCircle,
  IconAlertTriangle,
  IconChevronDown,
  IconPaperclip,
  IconPuzzle,
  IconSettings,
  IconSparkles,
  IconX,
} from "@tabler/icons-react";
import { CopilotComposer } from "@/components/copilot/copilot-composer";
import {
  FizzAgentOrbButton,
  FizzAgentPermissionMenu,
  FizzAgentSurface,
} from "@/components/fizz-agent";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogMedia,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  agentOsApi,
  type AgentOsAttachmentSummary,
  type AgentOsPendingApproval,
  type AgentOsPermissionMode,
  type AgentOsSkillMeta,
  type AgentOsWorkbenchContext,
  type AgentOsWorkbenchMode,
} from "@/lib/agent-os/api-client";
import { cn } from "@/lib/utils";
import {
  agentActivityLabelKey,
  resolveAgentOsActivityStatus,
  type AgentOsActivityStatus,
} from "./agent-os-activity";
import { deriveActiveTurnId } from "./agent-os-timeline";
import { AgentOsTranscript } from "./agent-os-transcript";
import { AgentOsApprovalComposer } from "./agent-os-approval-composer";
import { AgentOsUserInputCard } from "./agent-os-user-input-card";
import { type ApprovalPayloadLabels } from "./approval-payload";
import { toAgentOsIssue, type AgentOsIssue } from "./agent-os-issue";
import {
  deriveAgentActivity,
  useAgentOsRun,
  type AgentOsChatMessage,
  type AgentOsTranscriptArtifact,
} from "./use-agent-os-run";
import { useOptionalProjectContext } from "@/app/[locale]/project/_components/project-context";
import { useProjectUIStore } from "@/app/[locale]/project/_stores/project-ui-store";
import { listProjectSkillInstallations } from "@/lib/project-skills-api";
import { AgentComposerPrefillBridge } from "./agent-composer-prefill-bridge";
import { AgentOsModelSettingsDialog } from "./agent-os-model-settings-dialog";

const PERMISSION_MODES: Array<{
  id: AgentOsPermissionMode;
  labelKey: "permAsk" | "permSmart" | "permFull";
}> = [
  { id: "ask", labelKey: "permAsk" },
  { id: "smart", labelKey: "permSmart" },
  { id: "full", labelKey: "permFull" },
];

const SUGGESTIONS = ["suggestCharacters", "suggestShots", "suggestBoth"] as const;
const STORY_SUGGESTIONS = [
  "suggestStoryContinue",
  "suggestStoryBranch",
  "suggestStoryPolish",
] as const;

const ACCEPT =
  ".docx,.txt,.md,.markdown,.fountain,.fdx,.csv,.json,.xml,.log,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain,text/markdown,text/x-markdown,text/csv,application/json,application/xml,text/xml";
const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024;
const MAX_ATTACHMENTS_PER_TURN = 20;
const UPLOAD_CONCURRENCY = 3;

const LS_PERM = "fizz:agent-os:permissionMode";

/**
 * Tools that only read. Anything absent is treated as a write, so a tool added
 * later refreshes the workbench by default instead of silently leaving it
 * stale — the failure mode of guessing wrong is one extra refetch, not a
 * canvas that never catches up.
 */
const READ_ONLY_TOOLS = new Set([
  "story.read",
  "canvas.read",
  "characters.list",
  "storyboard.listShots",
  "script.readSection",
]);

/** A burst of writes collapses into one refetch instead of one per tool. */
const WORKBENCH_REFRESH_COOLDOWN_MS = 1_200;

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

interface AgentOsPanelProps {
  canWrite: boolean;
  projectId: string;
  projectKind: "platform" | "story";
  workbenchMode: AgentOsWorkbenchMode;
  workbenchContext?: AgentOsWorkbenchContext;
  onMutationCompleted?: () => void | Promise<void>;
  open: boolean;
  /** Omit to make the panel permanent — no close control is rendered. */
  onClose?: () => void;
  className?: string;
  variant?: "floating" | "docked";
  /** Host-owned transform for exceptional composer states. */
  composerGate?: (composer: ReactNode) => ReactNode;
  /** Host renderer for a domain-rich approval; null falls back to the generic card. */
  approvalGate?: (input: {
    approval: AgentOsPendingApproval;
    busy: boolean;
    onResolve: (decision: "approve" | "reject", responseText?: string) => Promise<boolean>;
  }) => { composer: ReactNode } | null;
  /** Host renderer for durable, journal-backed domain artifacts. */
  artifactRenderer?: (artifact: AgentOsTranscriptArtifact) => ReactNode;
  /** Host presentation override for replaying legacy Assistant copy. */
  assistantTextResolver?: (content: string, message: AgentOsChatMessage) => string;
  /** Host-owned work that participates in the Agent's single activity line. */
  activityStatus?: AgentOsActivityStatus | null;
  /** Host-derived copy for the current product phase. */
  composerPlaceholder?: string;
  /** One-shot, host-suggested natural-language draft. Never auto-submitted. */
  composerPrefill?: { id: number; text: string } | null;
  onComposerPrefillConsumed?: (id: number) => void;
}

/** Agent OS side panel — one durable conversation boundary per project. */
export function AgentOsPanel(props: AgentOsPanelProps) {
  return <AgentOsProjectSession key={props.projectId} {...props} />;
}

function AgentOsProjectSession({
  canWrite,
  projectId,
  projectKind,
  workbenchMode,
  workbenchContext,
  onMutationCompleted,
  open,
  onClose,
  className,
  variant,
  composerGate,
  approvalGate,
  artifactRenderer,
  assistantTextResolver,
  activityStatus,
  composerPlaceholder,
  composerPrefill,
  onComposerPrefillConsumed,
}: AgentOsPanelProps) {
  const rawLocale = useLocale();
  if (rawLocale !== "en-US" && rawLocale !== "zh-CN" && rawLocale !== "zh-HK") {
    throw new Error(`Unsupported Agent transcript locale: ${rawLocale}`);
  }
  const transcriptLocale = rawLocale;
  const t = useTranslations("agentOs");
  const ts = useTranslations("project.skills");
  const tStoryProfile = useTranslations("storyStudio.canvas.filmFoundation.profile");
  const openSkills = useProjectUIStore((state) => state.openSkills);
  const projectContext = useOptionalProjectContext();
  const projectSkillsQuery = useQuery({
    queryKey: ["project-skills", "installations", projectKind, projectId],
    queryFn: () => listProjectSkillInstallations(projectKind, projectId),
    enabled: !projectContext,
    staleTime: 10_000,
  });
  const projectSkills = projectContext?.projectSkills ?? {
    data: projectSkillsQuery.data,
    loading: projectSkillsQuery.isPending,
    error: projectSkillsQuery.isError,
    retry: () => void projectSkillsQuery.refetch(),
  };
  const { state, send, resolveApproval, resolveUserInput, newChat, stop } =
    useAgentOsRun(projectId);
  const agentActivity = deriveAgentActivity(state.events, state.status, state.pendingExternal);
  const activeTurnId = state.runId ? deriveActiveTurnId(state.events, state.runId) : null;
  const effectiveActivityStatus = resolveAgentOsActivityStatus({
    status: state.status,
    runId: state.runId,
    activeTurnId,
    pendingExternalJobId: state.pendingExternal?.jobId ?? null,
    host: activityStatus ?? null,
    derived: agentActivity
      ? {
          label: t(`activity.${agentActivityLabelKey(agentActivity)}`),
          mode:
            agentActivity.kind === "waiting_for_input" ||
            agentActivity.kind === "waiting_for_approval"
              ? "waiting"
              : "working",
          turnId: agentActivity.turnId,
          runId: state.runId,
        }
      : null,
  });
  const [draft, setDraft] = useState("");
  const applyComposerPrefill = useCallback((text: string) => {
    // Never destroy a draft the creator already started. The stage CTA still
    // brings that existing draft into focus, so the user stays in control.
    setDraft((current) => (current.trim().length > 0 ? current : text));
  }, []);
  const [pendingFiles, setPendingFiles] = useState<AgentOsAttachmentSummary[]>([]);
  const [uploading, setUploading] = useState(false);
  const [modelProfileId, setModelProfileId] = useState("");
  const [modelSettingsOpen, setModelSettingsOpen] = useState(false);
  const [permissionMode, setPermissionMode] = useState<AgentOsPermissionMode>(() => {
    const saved = readLs(LS_PERM);
    return saved === "ask" || saved === "smart" || saved === "full" ? saved : "smart";
  });
  const [busy, setBusy] = useState(false);
  const [workerOk, setWorkerOk] = useState<boolean | null>(null);
  /** Invocable skills for this workbench (composer multi-select). */
  const [invocableSkills, setInvocableSkills] = useState<AgentOsSkillMeta[]>([]);
  /** Per-turn selection (user toggles). */
  const [turnSkillIds, setTurnSkillIds] = useState<string[]>([]);
  /** Installed catalog Skills explicitly added/disabled for this message. */
  const [turnProjectSkillIds, setTurnProjectSkillIds] = useState<string[]>([]);
  const [disabledProjectDefaultSkillIds, setDisabledProjectDefaultSkillIds] = useState<string[]>(
    []
  );
  const fileInputRef = useRef<HTMLInputElement>(null);
  const prevStatusRef = useRef(state.status);
  const lastSyncedRunRef = useRef<string | null>(null);

  /** Event cursor. `sequence` restarts per run, so it resets with the run. */
  const seenEventRunRef = useRef<string | null>(null);
  const seenEventSeqRef = useRef(0);
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const refreshedAtRef = useRef(0);
  const [models, setModels] = useState<Array<{ id: string; label: string; hint?: string }>>([]);
  const [latestIssue, setLatestIssue] = useState<AgentOsIssue | null>(null);

  const projectSkillEntries = useMemo(() => {
    const expectedSource = `agent_os:${workbenchMode}`;
    return (projectSkills.data?.installations ?? [])
      .filter(
        (installation) =>
          installation.status === "active" &&
          installation.version.capabilities.includes("agent_prompt") &&
          (installation.version.workbenchModes.length === 0 ||
            installation.version.workbenchModes.includes(workbenchMode))
      )
      .map((installation) => ({
        installation,
        name: installation.translationKey
          ? ts(`items.${installation.translationKey}.name`)
          : (installation.name ?? installation.slug ?? ts("title")),
        isDefault: installation.defaults.some(
          (activation) =>
            activation.scope === "agent_prompt" &&
            (!activation.workbenchMode || activation.workbenchMode === workbenchMode) &&
            (!activation.sourceSurface || activation.sourceSurface === expectedSource)
        ),
      }));
  }, [projectSkills.data?.installations, ts, workbenchMode]);
  const projectSkillsReady = !projectSkills.loading && !projectSkills.error && !!projectSkills.data;

  const availableProjectSkillIds = useMemo(
    () => new Set(projectSkillEntries.map((entry) => entry.installation.id)),
    [projectSkillEntries]
  );
  const defaultProjectSkillIds = useMemo(
    () =>
      new Set(
        projectSkillEntries.filter((entry) => entry.isDefault).map((entry) => entry.installation.id)
      ),
    [projectSkillEntries]
  );
  const effectiveTurnProjectSkillIds = turnProjectSkillIds.filter((id) =>
    availableProjectSkillIds.has(id)
  );
  const effectiveDisabledProjectDefaultSkillIds = disabledProjectDefaultSkillIds.filter((id) =>
    defaultProjectSkillIds.has(id)
  );
  const activeProjectSkillEntries = projectSkillEntries.filter(({ installation, isDefault }) =>
    isDefault
      ? !effectiveDisabledProjectDefaultSkillIds.includes(installation.id)
      : effectiveTurnProjectSkillIds.includes(installation.id)
  );

  const reportIssue = useCallback(
    (error: unknown, fallback: string) => {
      setLatestIssue(toAgentOsIssue(error, fallback, t("serviceUnavailable")));
    },
    [t]
  );

  /**
   * Availability is a live fact, not a one-time reading.
   *
   * This panel stays mounted for the whole session, so a single check on mount
   * meant a worker that was down at open stayed "offline" forever — and one
   * that died later still looked fine. Re-check on an interval, and again the
   * moment the tab is looked at, so recovery shows up without a reload.
   */
  useEffect(() => {
    let cancelled = false;
    const check = () => {
      void agentOsApi
        .health()
        .then((h) => {
          if (!cancelled) setWorkerOk(Boolean(h.ok && (h.worker?.ok ?? true)));
        })
        .catch(() => {
          if (!cancelled) setWorkerOk(false);
        });
    };
    check();
    const timer = window.setInterval(check, 30_000);
    const onVisible = () => {
      if (document.visibilityState === "visible") check();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  // Load workbench-scoped system skills and the worker model catalog. Project
  // defaults come exclusively from installed catalog Skills below.
  useEffect(() => {
    let cancelled = false;
    void Promise.all([
      agentOsApi.listSkills(projectId, workbenchMode),
      agentOsApi.listModels(),
      agentOsApi.getModelPreferences(projectId),
    ])
      .then(([skillCatalog, modelCatalog, preferences]) => {
        if (cancelled) return;
        setInvocableSkills(skillCatalog.invocable);
        setModels(modelCatalog.models);
        const preferred = preferences.chatModelProfileId;
        setModelProfileId(
          preferred && modelCatalog.models.some((model) => model.id === preferred)
            ? preferred
            : (modelCatalog.models[0]?.id ?? "")
        );
        // Drop turn picks that no longer apply to this workbench.
        setTurnSkillIds((prev) =>
          prev.filter((id) => skillCatalog.invocable.some((s) => s.id === id))
        );
      })
      .catch((error) => {
        if (!cancelled) reportIssue(error, t("catalogLoadFailed"));
      });
    return () => {
      cancelled = true;
    };
  }, [projectId, reportIssue, t, workbenchMode]);

  useEffect(() => {
    writeLs(LS_PERM, permissionMode);
  }, [permissionMode]);

  useEffect(() => {
    const prev = prevStatusRef.current;
    prevStatusRef.current = state.status;
    const finishedWork =
      (prev === "running" ||
        prev === "waiting_for_approval" ||
        prev === "waiting_for_input" ||
        prev === "waiting_for_external") &&
      state.status === "completed";
    if (!finishedWork || !state.runId) return;
    if (lastSyncedRunRef.current === state.runId) return;
    lastSyncedRunRef.current = state.runId;
    void onMutationCompleted?.();
  }, [onMutationCompleted, state.runId, state.status]);

  // Held in a ref so the watcher below re-runs on new events only, not on every
  // render that hands down a fresh callback identity.
  const mutationCallbackRef = useRef(onMutationCompleted);
  useEffect(() => {
    mutationCallbackRef.current = onMutationCompleted;
  }, [onMutationCompleted]);

  /**
   * A run can write for minutes before it reports `completed`. Refreshing only
   * at that point left the workbench frozen for the whole turn and then
   * changing all at once, so each finished write refreshes as soon as it lands.
   */
  useEffect(() => {
    if (state.runId !== seenEventRunRef.current) {
      seenEventRunRef.current = state.runId;
      seenEventSeqRef.current = 0;
    }

    let highest = seenEventSeqRef.current;
    let wrote = false;
    for (const event of state.events) {
      if (event.sequence <= seenEventSeqRef.current) continue;
      if (event.sequence > highest) highest = event.sequence;
      if (event.type !== "ToolCompleted") continue;
      const toolId = String(event.data.toolId ?? "");
      if (toolId && !READ_ONLY_TOOLS.has(toolId)) wrote = true;
    }
    seenEventSeqRef.current = highest;
    if (!wrote || !mutationCallbackRef.current) return;

    const elapsed = Date.now() - refreshedAtRef.current;
    if (elapsed >= WORKBENCH_REFRESH_COOLDOWN_MS) {
      refreshedAtRef.current = Date.now();
      void mutationCallbackRef.current();
      return;
    }
    if (refreshTimerRef.current) return;
    refreshTimerRef.current = setTimeout(() => {
      refreshTimerRef.current = null;
      refreshedAtRef.current = Date.now();
      void mutationCallbackRef.current?.();
    }, WORKBENCH_REFRESH_COOLDOWN_MS - elapsed);
  }, [state.events, state.runId]);

  useEffect(
    () => () => {
      if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
    },
    []
  );

  /**
   * Failures the client itself diagnoses get a translated sentence; anything
   * from the server keeps its own message rather than being flattened into a
   * generic one.
   */
  const runErrorText = state.errorCode
    ? state.errorCode === "AGENT_OS_POLL_LOST"
      ? t("pollLost")
      : state.errorCode === "AGENT_OS_POLL_TIMEOUT"
        ? t("pollTimeout")
        : (state.error ?? null)
    : state.error;
  const projectSkillIssue = projectSkills.error
    ? toAgentOsIssue(
        new Error(t("skillCatalogFailed")),
        t("skillCatalogFailed"),
        t("serviceUnavailable")
      )
    : null;
  const composerIssue = latestIssue ?? projectSkillIssue;
  const diagnosticIssue =
    composerIssue ??
    (runErrorText
      ? toAgentOsIssue(new Error(runErrorText), t("runFailed"), t("serviceUnavailable"))
      : null);

  const turnBusy =
    !canWrite ||
    busy ||
    uploading ||
    state.status === "running" ||
    state.status === "waiting_for_approval" ||
    state.status === "waiting_for_input" ||
    state.status === "waiting_for_external";

  const selectedModelLabel =
    models.find((model) => model.id === modelProfileId)?.label ?? t("modelProfile");

  // Known-offline is the one state where sending cannot work. `null` is "not
  // checked yet" — do not lock the composer on an unanswered probe.
  const canSend =
    !turnBusy &&
    workerOk !== false &&
    projectSkillsReady &&
    modelProfileId.trim().length > 0 &&
    (draft.trim().length > 0 || pendingFiles.some((f) => f.status === "ready"));

  const onPickFiles = async (list: FileList | null) => {
    if (!canWrite || !list?.length) return;
    const remaining = Math.max(0, MAX_ATTACHMENTS_PER_TURN - pendingFiles.length);
    const selected = Array.from(list);
    if (selected.length > remaining) {
      reportIssue(null, t("attachmentTooMany", { count: MAX_ATTACHMENTS_PER_TURN }));
    }
    const candidates = selected.slice(0, remaining);
    const accepted: File[] = [];
    for (const file of candidates) {
      if (file.size === 0) {
        reportIssue(null, t("attachmentEmpty", { name: file.name }));
      } else if (file.size > MAX_ATTACHMENT_BYTES) {
        reportIssue(null, t("attachmentTooLarge", { name: file.name, size: 20 }));
      } else {
        accepted.push(file);
      }
    }
    if (accepted.length === 0) {
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }

    setUploading(true);
    try {
      const uploaded: AgentOsAttachmentSummary[] = [];
      for (let index = 0; index < accepted.length; index += UPLOAD_CONCURRENCY) {
        const batch = accepted.slice(index, index + UPLOAD_CONCURRENCY);
        const results = await Promise.allSettled(
          batch.map((file) => agentOsApi.uploadAttachment(projectId, file))
        );
        results.forEach((result, batchIndex) => {
          const file = batch[batchIndex];
          if (result.status === "rejected") {
            reportIssue(result.reason, t("attachmentFailed", { name: file.name }));
            return;
          }
          if (result.value.status !== "ready") {
            reportIssue(
              result.value.errorMessage ? new Error(result.value.errorMessage) : null,
              t("attachmentFailed", { name: result.value.filename })
            );
            return;
          }
          uploaded.push(result.value);
        });
      }
      if (uploaded.length > 0) {
        setPendingFiles((prev) => {
          const byId = new Map(prev.map((item) => [item.id, item]));
          for (const item of uploaded) byId.set(item.id, item);
          return [...byId.values()];
        });
      }
    } catch (error) {
      reportIssue(error, t("attachmentFailedGeneric"));
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const removePending = (id: string) => {
    setPendingFiles((prev) => prev.filter((f) => f.id !== id));
  };

  const onSkillChipClick = useCallback(
    (skillId: string) => {
      if (turnBusy) return;
      setTurnSkillIds((prev) =>
        prev.includes(skillId) ? prev.filter((id) => id !== skillId) : [...prev, skillId]
      );
    },
    [turnBusy]
  );

  const onProjectSkillChipClick = useCallback(
    (installationId: string, isDefault: boolean) => {
      if (turnBusy) return;
      if (isDefault) {
        setDisabledProjectDefaultSkillIds((current) =>
          current.includes(installationId)
            ? current.filter((id) => id !== installationId)
            : [...current, installationId]
        );
        return;
      }
      setTurnProjectSkillIds((current) =>
        current.includes(installationId)
          ? current.filter((id) => id !== installationId)
          : [...current, installationId]
      );
    },
    [turnBusy]
  );

  const onSend = async () => {
    if (!canSend) return;
    const text = draft.trim();
    const ready = pendingFiles.filter((f) => f.status === "ready");
    const attachmentIds = ready.map((f) => f.id);
    const attachmentNames = ready.map((f) => f.filename);
    setDraft("");
    setPendingFiles([]);
    setLatestIssue(null);
    setBusy(true);
    try {
      await send({
        message: text,
        modelProfileId,
        attachmentIds,
        attachmentNames,
        permissionMode,
        workbenchMode,
        workbenchContext,
        skillIds: turnSkillIds,
        projectSkillInstallationIds:
          effectiveTurnProjectSkillIds.length > 0 ? effectiveTurnProjectSkillIds : undefined,
        disabledDefaultSkillInstallationIds:
          effectiveDisabledProjectDefaultSkillIds.length > 0
            ? effectiveDisabledProjectDefaultSkillIds
            : undefined,
      });
      setTurnSkillIds([]);
      setTurnProjectSkillIds([]);
      setDisabledProjectDefaultSkillIds([]);
    } catch (error) {
      reportIssue(error, t("sendFailed"));
    } finally {
      setBusy(false);
    }
  };

  const onApprove = async (
    decision: "approve" | "reject",
    responseText?: string
  ): Promise<boolean> => {
    if (!canWrite) return false;
    const approvalId = state.pendingApproval?.approvalId;
    // Provisional ids are UI-only until ApprovalRequired lands with a real UUID.
    if (!approvalId || approvalId.startsWith("pending:") || !/^[0-9a-f-]{36}$/i.test(approvalId)) {
      reportIssue(null, t("approvalNotReady"));
      return false;
    }
    setBusy(true);
    try {
      // Feedback lives in the transcript (decision bubble + stream / cancel),
      // not a floating toast.
      await resolveApproval({
        approvalId,
        decision,
        responseText: responseText ?? (decision === "approve" ? t("approved") : t("rejected")),
        locale: transcriptLocale,
        modelProfileId,
        permissionMode,
        ...(workbenchContext?.experience === "mobile_h5"
          ? { experience: "mobile_h5" as const }
          : {}),
      });
      return true;
    } catch (error) {
      reportIssue(error, t("approvalFailed"));
      return false;
    } finally {
      setBusy(false);
    }
  };

  const onResolveUserInput = async (requestId: string, answers: Record<string, string>) => {
    if (!canWrite) return;
    setBusy(true);
    try {
      await resolveUserInput({ requestId, answers, modelProfileId, permissionMode });
    } catch (error) {
      reportIssue(error, t("userInput.failed"));
    } finally {
      setBusy(false);
    }
  };

  const resolveProfileOptionLabel = useCallback(
    (questionId: string, value: string, fallback: string): string => {
      if (questionId === "aspect_ratio") {
        if (value === "portrait_9_16" || value === "landscape_16_9") {
          return tStoryProfile(`frameProfiles.${value}`);
        }
      }
      if (questionId === "target_runtime") {
        if (value === "short_5_15" || value === "medium_15_30" || value === "long_30_60") {
          return tStoryProfile(`durationPresets.${value}`);
        }
      }
      if (
        questionId === "visual_direction" &&
        STORY_VISUAL_STYLE_SKILL_SLUGS.some((candidate) => candidate === value)
      ) {
        return tStoryProfile(
          `visualStyles.${value as (typeof STORY_VISUAL_STYLE_SKILL_SLUGS)[number]}`
        );
      }
      if (questionId === "story_language") {
        try {
          return new Intl.DisplayNames([transcriptLocale], { type: "language" }).of(value) ?? value;
        } catch {
          return fallback;
        }
      }
      return fallback;
    },
    [tStoryProfile, transcriptLocale]
  );

  const workerStatus =
    workerOk === false ? t("workerOffline") : workerOk === true ? t("workerOnline") : t("subtitle");

  // Approval payload detail belongs only to the blocking composer decision.
  const payloadLabels: ApprovalPayloadLabels = {
    creates: (count) => t("approvalCreates", { count }),
    updates: (count) => t("approvalUpdates", { count }),
    deletes: (count) => t("approvalDeletes", { count }),
    andMore: (count) => t("approvalAndMore", { count }),
    showDetails: t("approvalShowDetails"),
    hideDetails: t("approvalHideDetails"),
    untitled: t("approvalUntitled"),
    storyBible: t("approvalStoryBible"),
    storyEntry: t("approvalStoryEntry"),
    sceneOrder: t("approvalSceneOrder"),
    storyScene: t("approvalStoryScene"),
    generationBatch: t("approvalGenerationBatch"),
    generationBatchSummary: (count, points) =>
      t("approvalGenerationBatchSummary", { count, points }),
  };

  const approval = state.pendingApproval;
  const hostApproval = approval
    ? approvalGate?.({
        approval,
        busy: busy || !canWrite,
        onResolve: onApprove,
      })
    : null;

  // Agent OS decisions pause the active run but no longer displace the input.
  // Keeping the composer mounted preserves the creator's draft and gives the
  // mobile layout one stable bottom anchor. Submission and composer tools stay
  // disabled through `turnBusy` until the decision resolves.
  const composerDecision: ReactNode = (() => {
    const inputRequest = state.pendingUserInput;
    if (inputRequest) {
      return (
        <AgentOsUserInputCard
          key={inputRequest.requestId}
          request={inputRequest}
          busy={busy || !canWrite}
          labels={{
            step: (current, total) => t("userInput.step", { current, total }),
            back: t("userInput.back"),
            continue: t("userInput.continue"),
            submit: t("userInput.submit"),
            submitting: t("userInput.submitting"),
          }}
          resolveProfileOptionLabel={resolveProfileOptionLabel}
          resolveProfileQuestion={(id) => {
            if (
              id !== "aspect_ratio" &&
              id !== "target_runtime" &&
              id !== "visual_direction" &&
              id !== "story_language"
            )
              return undefined;
            return {
              header: t(`userInput.profile.${id}.header`),
              question: t(`userInput.profile.${id}.question`),
            };
          }}
          onSubmit={(answers) => void onResolveUserInput(inputRequest.requestId, answers)}
        />
      );
    }
    if (!approval) return null;
    if (hostApproval != null) return hostApproval.composer;
    return (
      <AgentOsApprovalComposer
        approval={approval}
        busy={busy || !canWrite}
        labels={{
          title: t("approvalRequired"),
          approve: t("approve"),
          reject: t("reject"),
          payload: payloadLabels,
        }}
        onApprove={(decision) => void onApprove(decision)}
      />
    );
  })();

  return (
    <FizzAgentSurface
      className={className}
      variant={variant}
      composerGate={composerGate}
      composerAccessory={composerDecision}
      open={open}
      title={t("title")}
      subtitle={workerStatus}
      labels={{
        surface: t("transcriptLabel"),
        close: t("close"),
        collapse: t("collapse"),
        newConversation: t("newChat"),
        newConversationDialog: {
          title: t("newConversationDialog.title"),
          description: t("newConversationDialog.description"),
          cancel: t("newConversationDialog.cancel"),
          confirm: t("newConversationDialog.confirm"),
        },
      }}
      onNewConversation={() => {
        setLatestIssue(null);
        newChat();
      }}
      busy={turnBusy}
      headerActions={
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            disabled={turnBusy}
            onClick={() => setModelSettingsOpen(true)}
            aria-label={t("modelSettings.open")}
            title={t("modelSettings.open")}
            className="flex size-8 shrink-0 items-center justify-center rounded-full bg-white/[0.05] text-white/72 transition-colors hover:bg-white/[0.1] hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white/70 disabled:opacity-45"
          >
            <IconSettings aria-hidden="true" className="size-4" />
          </button>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <button
                type="button"
                aria-label={t("runDetails.open")}
                title={t("runDetails.open")}
                className={cn(
                  "relative flex size-8 shrink-0 items-center justify-center rounded-full transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white/70",
                  diagnosticIssue
                    ? "bg-red-500/12 text-red-300 hover:bg-red-500/20 hover:text-red-200"
                    : "bg-white/[0.05] text-white/72 hover:bg-white/[0.1] hover:text-white"
                )}
              >
                {diagnosticIssue ? (
                  <IconAlertTriangle aria-hidden="true" className="size-4" />
                ) : (
                  <IconAlertCircle aria-hidden="true" className="size-4" />
                )}
                {diagnosticIssue ? (
                  <span className="absolute right-0.5 top-0.5 size-1.5 rounded-full bg-red-400 ring-2 ring-[oklch(0.145_0_0)]" />
                ) : null}
              </button>
            </AlertDialogTrigger>
            <AlertDialogContent className="liquid-rim bg-[oklch(0.18_0_0_/_0.98)] ring-0 shadow-[inset_0_1px_0_rgba(255,255,255,0.12),0_28px_90px_rgba(0,0,0,0.68)] backdrop-blur-[36px]">
              <AlertDialogHeader>
                <AlertDialogMedia>
                  <IconAlertCircle aria-hidden="true" />
                </AlertDialogMedia>
                <AlertDialogTitle>{t("runDetails.title")}</AlertDialogTitle>
                <AlertDialogDescription>{t("runDetails.description")}</AlertDialogDescription>
              </AlertDialogHeader>
              <dl className="grid gap-2 rounded-xl bg-white/[0.035] p-3 text-xs">
                <div className="flex items-start justify-between gap-4">
                  <dt className="text-white/42">{t("runDetails.status")}</dt>
                  <dd className="text-right font-medium text-white/82">
                    {t(`runDetails.statusValue.${state.status}`)}
                  </dd>
                </div>
                <div className="flex items-start justify-between gap-4">
                  <dt className="shrink-0 text-white/42">{t("runDetails.conversationId")}</dt>
                  <dd className="min-w-0 break-all text-right font-mono text-[11px] text-white/68">
                    {state.conversationId ?? t("runDetails.notAvailable")}
                  </dd>
                </div>
                {diagnosticIssue ? (
                  <div className="grid gap-1 border-t border-white/[0.07] pt-2">
                    <dt className="text-white/42">{t("runDetails.latestIssue")}</dt>
                    <dd className="break-words text-xs/relaxed text-red-200/85">
                      {diagnosticIssue.message}
                    </dd>
                    {diagnosticIssue.technicalDetail ? (
                      <>
                        <dt className="mt-1 text-white/42">{t("runDetails.technicalDetail")}</dt>
                        <dd className="break-all font-mono text-[11px] text-white/58">
                          {diagnosticIssue.technicalDetail}
                        </dd>
                      </>
                    ) : null}
                  </div>
                ) : null}
              </dl>
              <AlertDialogFooter>
                <AlertDialogAction variant="secondary">{t("runDetails.close")}</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
          <AgentOsModelSettingsDialog
            projectId={projectId}
            chatModels={models}
            open={modelSettingsOpen}
            onOpenChange={setModelSettingsOpen}
            disabled={turnBusy}
            onSaved={(preferences) => {
              const preferred = preferences.chatModelProfileId;
              setModelProfileId(
                preferred && models.some((model) => model.id === preferred)
                  ? preferred
                  : (models[0]?.id ?? "")
              );
            }}
          />
        </div>
      }
      onOpenChange={
        onClose
          ? (nextOpen) => {
              if (!nextOpen) onClose();
            }
          : undefined
      }
      composer={
        <div className="space-y-2">
          <AgentComposerPrefillBridge
            request={composerPrefill}
            onPrefill={applyComposerPrefill}
            onConsumed={onComposerPrefillConsumed}
          />
          <input
            ref={fileInputRef}
            type="file"
            accept={ACCEPT}
            multiple
            className="hidden"
            onChange={(event) => void onPickFiles(event.target.files)}
          />

          {composerIssue ? (
            <div
              role="alert"
              className="flex min-w-0 items-center gap-2 rounded-xl bg-red-500/[0.09] px-3 py-2 text-red-100/80 ring-1 ring-inset ring-red-400/12"
            >
              <IconAlertTriangle aria-hidden="true" className="size-3.5 shrink-0 text-red-300/80" />
              <span className="min-w-0 flex-1 truncate text-[11px]" title={composerIssue.message}>
                {composerIssue.message}
              </span>
              {latestIssue ? (
                <button
                  type="button"
                  onClick={() => setLatestIssue(null)}
                  aria-label={t("dismissIssue")}
                  title={t("dismissIssue")}
                  className="grid size-5 shrink-0 place-items-center rounded-full text-red-100/45 transition-colors hover:bg-red-100/10 hover:text-red-50"
                >
                  <IconX aria-hidden="true" className="size-3" />
                </button>
              ) : null}
            </div>
          ) : null}

          <CopilotComposer
            value={draft}
            readOnly={!canWrite}
            onChange={setDraft}
            onSubmit={() => void onSend()}
            onStop={() => {
              void stop(t("stopped"))
                .catch((error) => reportIssue(error, t("stopFailed")))
                .finally(() => setBusy(false));
            }}
            busy={
              busy ||
              uploading ||
              state.status === "running" ||
              state.status === "waiting_for_external"
            }
            sendDisabled={!canSend}
            canSendWithoutText={pendingFiles.some((file) => file.status === "ready")}
            placeholder={
              !canWrite
                ? t("readOnlyProject")
                : (composerPlaceholder ??
                  t(workbenchMode === "story" ? "composerPlaceholderStory" : "composerPlaceholder"))
            }
            inputLabel={t("message")}
            sendLabel={t("send")}
            stopLabel={t("stop")}
            stopAvailable={canWrite && state.pendingExternal?.toolId !== "story.applyProposal"}
            autoFocus
            focusRequestKey={composerPrefill?.id}
            appearance="fizz-agent"
            leadingAction={
              <button
                type="button"
                disabled={turnBusy}
                onClick={() => fileInputRef.current?.click()}
                aria-label={t("attachFile")}
                title={t("attachFile")}
                className="grid size-8 shrink-0 place-items-center rounded-full text-white/72 transition-colors hover:bg-white/[0.08] hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white/70 disabled:opacity-45"
              >
                <IconPaperclip aria-hidden="true" className="size-4" stroke={1.8} />
              </button>
            }
            beforeSend={
              <div className="flex min-w-0 shrink items-center gap-1">
                <FizzAgentPermissionMenu
                  value={permissionMode}
                  disabled={turnBusy}
                  labels={{ menu: t("permissionMode") }}
                  options={PERMISSION_MODES.map((mode) => ({
                    value: mode.id,
                    label: t(mode.labelKey),
                    description: t(`permHint_${mode.id}`),
                  }))}
                  onValueChange={setPermissionMode}
                />
                <button
                  type="button"
                  disabled={turnBusy}
                  onClick={() => setModelSettingsOpen(true)}
                  aria-label={t("modelSettings.open")}
                  title={t("modelSettings.open")}
                  className="inline-flex h-7 min-w-0 max-w-32 items-center gap-1.5 rounded-lg px-2 text-[11px] text-white/72 transition-colors hover:bg-white/[0.08] hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white/70 disabled:opacity-45"
                >
                  <IconSparkles aria-hidden="true" className="size-3.5 shrink-0" />
                  <span className="truncate">{selectedModelLabel}</span>
                </button>
              </div>
            }
            attachmentBar={
              <div className="grid gap-1.5">
                {invocableSkills.length > 0 ? (
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-[10px] text-white/65">{t("skillsLabel")}</span>
                    {invocableSkills.map((skill) => {
                      const isTurn = turnSkillIds.includes(skill.id);
                      const active = isTurn;
                      return (
                        <button
                          key={skill.id}
                          type="button"
                          disabled={turnBusy}
                          title={`${skill.description} · ${t("skillToggleTurn")}`}
                          aria-pressed={active}
                          onClick={() => onSkillChipClick(skill.id)}
                          className={cn(
                            "rounded-full px-2 py-0.5 text-[10px] transition-colors",
                            active
                              ? "bg-white/15 text-white/90"
                              : "bg-white/[0.06] text-white/78 hover:bg-white/[0.1] hover:text-white"
                          )}
                        >
                          {skill.name}
                        </button>
                      );
                    })}
                  </div>
                ) : null}

                <div className="flex min-w-0 items-center">
                  <DropdownMenu>
                    <DropdownMenuTrigger
                      disabled={turnBusy}
                      aria-label={t("chooseProjectSkills")}
                      title={t("chooseProjectSkills")}
                      className="ring-brand-yellow/25 hover:bg-brand-yellow/[0.055] hover:ring-brand-yellow/45 inline-flex h-7 max-w-full shrink-0 items-center gap-1.5 rounded-lg bg-transparent px-2.5 text-[11px] font-medium text-white/88 ring-1 ring-inset outline-none transition-colors hover:text-white focus-visible:ring-2 focus-visible:ring-white/45 disabled:opacity-45"
                    >
                      <IconPuzzle
                        aria-hidden="true"
                        className="text-brand-yellow size-3.5"
                        stroke={1.8}
                      />
                      <span>{t("skillsLabel")}</span>
                      {activeProjectSkillEntries.length > 0 ? (
                        <span className="text-brand-yellow/75 tabular-nums">
                          · {activeProjectSkillEntries.length}
                        </span>
                      ) : null}
                      <IconChevronDown
                        aria-hidden="true"
                        className="size-3 text-white/60"
                        stroke={1.8}
                      />
                    </DropdownMenuTrigger>
                    <DropdownMenuContent
                      align="start"
                      side="top"
                      sideOffset={8}
                      className="liquid-rim max-h-72 w-[min(320px,calc(100vw-24px))] rounded-2xl bg-[oklch(0.18_0_0_/_0.98)] p-1.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.12),0_24px_72px_rgba(0,0,0,0.68)] backdrop-blur-[36px]"
                    >
                      <DropdownMenuLabel className="px-2.5 pt-2 pb-1 text-[10px] font-medium text-white/65">
                        {t("projectSkillsLabel")}
                      </DropdownMenuLabel>
                      {projectSkills.loading ? (
                        <p className="px-2.5 py-2 text-[11px] text-white/68">
                          {t("skillsLoading")}
                        </p>
                      ) : projectSkills.error ? (
                        <DropdownMenuItem
                          onSelect={() => projectSkills.retry()}
                          className="min-h-9 rounded-xl px-2.5 py-2 focus:bg-white/[0.06]"
                        >
                          <span className="text-white/88">{t("skillCatalogFailed")}</span>
                          <span className="ml-auto text-[10px] text-white/65">
                            {t("skillsRetry")}
                          </span>
                        </DropdownMenuItem>
                      ) : projectSkillEntries.length > 0 ? (
                        projectSkillEntries.map(({ installation, name, isDefault }) => {
                          const active = isDefault
                            ? !effectiveDisabledProjectDefaultSkillIds.includes(installation.id)
                            : effectiveTurnProjectSkillIds.includes(installation.id);
                          return (
                            <DropdownMenuCheckboxItem
                              key={installation.id}
                              checked={active}
                              disabled={turnBusy}
                              onSelect={(event) => event.preventDefault()}
                              onCheckedChange={() =>
                                onProjectSkillChipClick(installation.id, isDefault)
                              }
                              className="min-h-9 rounded-xl px-2.5 py-2 pr-9 focus:bg-white/[0.06]"
                            >
                              <IconPuzzle
                                aria-hidden="true"
                                className={cn(
                                  "size-3.5",
                                  active ? "text-brand-yellow" : "text-white/28"
                                )}
                                stroke={1.8}
                              />
                              <span className="min-w-0 flex-1 truncate text-white/90">{name}</span>
                              {isDefault ? (
                                <span className="text-brand-yellow/55 text-[10px]">
                                  {t("skillDefaultBadge")}
                                </span>
                              ) : null}
                            </DropdownMenuCheckboxItem>
                          );
                        })
                      ) : (
                        <p className="px-2.5 py-2 text-[11px] text-white/68">{t("skillsEmpty")}</p>
                      )}
                      <DropdownMenuSeparator className="my-1 bg-white/[0.08]" />
                      <DropdownMenuItem
                        onSelect={() => openSkills()}
                        className="min-h-9 rounded-xl px-2.5 py-2 focus:bg-white/[0.06]"
                      >
                        <span className="text-white/90">{t("browseSkills")}</span>
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>

                {pendingFiles.length > 0 || uploading ? (
                  <div className="flex flex-wrap gap-1.5">
                    {uploading ? (
                      <span className="rounded-full bg-white/[0.06] px-2 py-0.5 text-[10px] text-white/50">
                        {t("uploading")}
                      </span>
                    ) : null}
                    {pendingFiles.map((file) => (
                      <span
                        key={file.id}
                        className="inline-flex max-w-full items-center gap-1 rounded-full bg-white/[0.08] px-2 py-0.5 text-[10px] text-white/88"
                      >
                        <span className="truncate">{file.filename}</span>
                        <button
                          type="button"
                          onClick={() => removePending(file.id)}
                          className="shrink-0 text-white/40 transition-colors hover:text-white/80"
                          aria-label={t("removeAttachment")}
                        >
                          <IconX aria-hidden="true" className="size-3" stroke={2} />
                        </button>
                      </span>
                    ))}
                  </div>
                ) : null}
              </div>
            }
          />
        </div>
      }
    >
      <AgentOsTranscript
        messages={state.messages}
        status={state.status}
        error={runErrorText}
        busy={busy}
        activityStatus={effectiveActivityStatus}
        artifactRenderer={artifactRenderer}
        assistantTextResolver={assistantTextResolver}
        labels={{
          transcript: t("transcriptLabel"),
          scrollToLatest: t("scrollToLatest"),
          user: t("roleUser"),
          assistant: t("roleAssistant"),
          thinking: t("thinking"),
          waitingForInput: t("waitingForInput"),
          waitingForApproval: t("waitingForApproval"),
          approved: t("approved"),
          rejected: t("rejected"),
        }}
        empty={
          <div className="w-full max-w-80 space-y-3">
            <FizzAgentOrbButton
              size={64}
              aria-hidden="true"
              tabIndex={-1}
              className="pointer-events-none mx-auto mb-1"
            />
            <p className="text-xs/relaxed text-white/78">
              {t(workbenchMode === "story" ? "emptyHintStory" : "emptyHint")}
            </p>
            <div className="flex flex-wrap justify-center gap-1.5">
              {(workbenchMode === "story" ? STORY_SUGGESTIONS : SUGGESTIONS).map((key) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setDraft(t(key))}
                  className="rounded-full bg-white/[0.07] px-2.5 py-1 text-[11px] text-white/90 transition hover:bg-white/[0.12] hover:text-white"
                >
                  {t(key)}
                </button>
              ))}
            </div>
          </div>
        }
      />
    </FizzAgentSurface>
  );
}
