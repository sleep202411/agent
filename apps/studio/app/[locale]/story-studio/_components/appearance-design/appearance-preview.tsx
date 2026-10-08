"use client";

import {
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useLocale, useTranslations } from "next-intl";
import {
  IconArrowLeft,
  IconArrowBackUp,
  IconLayoutSidebarRightCollapse,
  IconLayoutSidebarRightExpand,
  IconDeviceFloppy,
} from "@tabler/icons-react";
import { Link } from "@/i18n/navigation";
import {
  DEFAULT_APPEARANCE,
  useAppearanceWorkspace,
  type Appearance,
} from "./appearance-workspace";
import {
  AppearanceDesignResultSchema,
  AppearanceWebOpenResultSchema,
  AppearanceWebPollResultSchema,
} from "@repo/game-agent-protocol";
import type { GameUIProject } from "@repo/shared/experience-runtime";
import { useQueryClient } from "@tanstack/react-query";
import {
  getStoryProject,
  updateStoryProject,
  type StoryProjectSummary,
} from "@/lib/story-projects-api";
import { api, ApiRequestError } from "@/lib/api";
import styles from "./appearance-preview.module.css";
import { AppearanceSplitPanels } from "./appearance-split-panels";
import { appearanceWindowIdentity } from "./appearance-window-identity";

export interface AppearanceStageProps {
  appearance: Appearance;
  gameUi: GameUIProject | null;
}
interface WebSession {
  leaseId: string;
  id: string;
  url: string;
  requestId: string;
  controlPath: string;
  admissionContext: object;
}
const EMPTY_CHOICE_LABELS: string[] = [];

export function AppearancePreview({
  projectId,
  project,
  projectTitle,
  backHref = "/story-studio",
  renderStage,
  previewTools,
  choiceLabels = EMPTY_CHOICE_LABELS,
}: {
  projectId?: string;
  project?: StoryProjectSummary;
  projectTitle?: string;
  backHref?: string;
  renderStage: (props: AppearanceStageProps) => ReactNode;
  previewTools?: ReactNode;
  choiceLabels?: string[];
}) {
  const t = useTranslations("appearancePreview");
  const previewId = useId();
  const locale = useLocale();
  const fallbackTitle = t("project");
  const saveFailed = t("saveFailed");
  const { workspace, update, restoreError, persistenceFailed } = useAppearanceWorkspace(
    projectId,
    project
  );
  const queryClient = useQueryClient();
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [chatVisible, setChatVisible] = useState(true);
  const canEdit = !project || project.capabilities.includes("story.edit");
  const canDesign = Boolean(
    projectId &&
    project?.id === projectId &&
    canEdit &&
    project.capabilities.includes("story.generate")
  );
  const controlPath = projectId
    ? `/aurora/game-agent/projects/${encodeURIComponent(projectId)}/appearance/web`
    : null;
  const admissionContext = useMemo(
    () => ({ controlPath, canDesign, locale }),
    [controlPath, canDesign, locale]
  );
  const appearance = workspace.applied;
  const [session, setSession] = useState<WebSession | null>(null);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const [reportedRunning, setRunning] = useState(false);
  const iframe = useRef<HTMLIFrameElement>(null);
  const lease = useRef<{ id: string; leaseId: string; controlPath: string } | null>(null);
  const admissionIdentity = useRef<string | null>(null);
  const mounted = useRef(false);
  const activeAdmission = useRef<object | null>(null);
  const recoveryAttempts = useRef(0);
  useLayoutEffect(() => {
    activeAdmission.current = canDesign ? admissionContext : null;
  }, [admissionContext, canDesign]);
  const activeSession =
    canDesign && session?.admissionContext === admissionContext ? session : null;
  const running = Boolean(activeSession && reportedRunning);
  useEffect(() => {
    mounted.current = true;
    const release = () => {
      const currentLease = lease.current;
      if (!currentLease) return;
      lease.current = null;
      void fetch(currentLease.controlPath, {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "close",
          id: currentLease.id,
          leaseId: currentLease.leaseId,
        }),
        keepalive: true,
      }).catch(() => undefined);
    };
    const restore = (event: PageTransitionEvent) => {
      if (event.persisted) setRetry((value) => value + 1);
    };
    window.addEventListener("pagehide", release);
    window.addEventListener("pageshow", restore);
    return () => {
      mounted.current = false;
      release();
      window.removeEventListener("pagehide", release);
      window.removeEventListener("pageshow", restore);
    };
  }, [controlPath, canDesign, locale]);
  const windowIdentity = useRef<string | null>(null);
  const current = useRef({ appearance, workspace, update });
  useLayoutEffect(() => {
    current.current = { appearance, workspace, update };
  }, [appearance, workspace, update]);
  const admitted = useRef<{
    requestId: string;
    before: Appearance;
    beforeGameUi: GameUIProject | null;
  } | null>(null);
  const seen = useRef<string | null>(null);
  const serial = JSON.stringify({
    appearance,
    gameUi: workspace.gameUi,
    title: projectTitle,
    choiceLabels,
  });

  useEffect(() => {
    if (!canDesign || !controlPath) return;
    admissionIdentity.current ??= crypto.randomUUID();
    if (!windowIdentity.current) {
      try {
        windowIdentity.current = appearanceWindowIdentity(sessionStorage);
      } catch {
        windowIdentity.current = crypto.randomUUID();
      }
    }
    const controller = new AbortController();
    const before = current.current.appearance;
    const beforeGameUi = current.current.workspace.gameUi ?? null;
    const requestId = crypto.randomUUID();
    admitted.current = null;
    void api
      .post<unknown>(controlPath, {
        requestScope: "project",
        data: {
          action: "open",
          key: windowIdentity.current,
          leaseId: admissionIdentity.current,
          draft: current.current.workspace.prompt,
          request: {
            requestId,
            prompt: "Design the current preview according to the next user message.",
            locale,
            appearance: before,
            gameUi: beforeGameUi,
            context: { title: (projectTitle || fallbackTitle).slice(0, 200), choiceLabels },
            history: [],
          },
        },
        signal: controller.signal,
        timeout: 40_000,
      })
      .then((response) => {
        const result = AppearanceWebOpenResultSchema.parse(response);
        if (
          result.url !== `${controlPath}/${result.id}/` ||
          result.leaseId !== admissionIdentity.current
        )
          throw new Error("The appearance conversation does not match this project.");
        if (controller.signal.aborted) {
          if (!mounted.current || activeAdmission.current !== admissionContext)
            void api
              .post(controlPath, {
                requestScope: "project",
                data: { action: "close", id: result.id, leaseId: result.leaseId },
              })
              .catch(() => undefined);
          return;
        }
        if (!lease.current) setRunning(false);
        lease.current = { id: result.id, leaseId: result.leaseId, controlPath };
        admitted.current = { requestId: result.requestId, before, beforeGameUi };
        setSession((previous) =>
          previous?.id === result.id && previous.admissionContext === admissionContext
            ? previous
            : { ...result, controlPath, admissionContext }
        );
        setError("");
      })
      .catch((reason) => {
        if (!controller.signal.aborted)
          setError(reason instanceof Error ? reason.message : String(reason));
      });
    return () => {
      controller.abort();
      admitted.current = null;
    };
  }, [
    controlPath,
    locale,
    serial,
    retry,
    projectTitle,
    choiceLabels,
    fallbackTitle,
    canDesign,
    admissionContext,
  ]);

  useEffect(() => {
    if (!activeSession) return;
    let disposed = false;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const response = await api.post<unknown>(activeSession.controlPath, {
          requestScope: "project",
          data: { action: "poll", id: activeSession.id },
          signal: controller.signal,
        });
        if (disposed) return;
        const body = AppearanceWebPollResultSchema.parse(response);
        recoveryAttempts.current = 0;
        if (body.result) {
          const result = AppearanceDesignResultSchema.parse(body.result);
          const request = admitted.current;
          if (
            request &&
            result.requestId === request.requestId &&
            seen.current !== result.requestId
          ) {
            seen.current = result.requestId;
            const { update } = current.current;
            const saved = update((state) => {
              if (
                JSON.stringify(state.applied) !== JSON.stringify(request.before) ||
                JSON.stringify(state.gameUi ?? null) !== JSON.stringify(request.beforeGameUi)
              )
                return state;
              return {
                ...state,
                applied: result.appearance,
                gameUi: result.gameUi !== undefined ? result.gameUi : state.gameUi,
                undo: [...state.undo, { applied: request.before, gameUi: request.beforeGameUi }],
              };
            });
            if (!saved) setError(saveFailed);
          }
        }
      } catch (reason) {
        if (disposed) return;
        if (
          reason instanceof ApiRequestError &&
          (reason.status === 404 || reason.status === 410) &&
          recoveryAttempts.current === 0
        ) {
          recoveryAttempts.current = 1;
          setSession(null);
          setRunning(false);
          setRetry((value) => value + 1);
          return;
        }
        setError(reason instanceof Error ? reason.message : String(reason));
        return;
      }
      if (!disposed) timer = setTimeout(() => void poll(), 750);
    };
    void poll();
    return () => {
      disposed = true;
      controller.abort();
      clearTimeout(timer);
    };
  }, [activeSession, saveFailed]);

  useEffect(() => {
    if (!activeSession) return;
    const origin = new URL(activeSession.url, window.location.origin).origin;
    const listener = (event: MessageEvent) => {
      if (event.origin !== origin || event.source !== iframe.current?.contentWindow) return;
      const data: unknown = event.data;
      if (!data || typeof data !== "object") return;
      if (
        "type" in data &&
        data.type === "fizz.appearance.draft" &&
        "text" in data &&
        typeof data.text === "string" &&
        data.text.length <= 2000
      ) {
        if (!current.current.update((state) => ({ ...state, prompt: data.text as string })))
          setError(saveFailed);
      }
      if (
        "type" in data &&
        data.type === "fizz.appearance.error" &&
        "message" in data &&
        typeof data.message === "string"
      )
        setError(data.message);
      if (
        "type" in data &&
        data.type === "fizz.appearance.running" &&
        "running" in data &&
        typeof data.running === "boolean"
      )
        setRunning(data.running);
    };
    window.addEventListener("message", listener);
    return () => window.removeEventListener("message", listener);
  }, [activeSession, saveFailed]);

  function cacheProject(saved: StoryProjectSummary) {
    queryClient.setQueriesData(
      { queryKey: ["story-studio", "playtest-runtime", projectId] },
      (value: unknown) =>
        value && typeof value === "object" ? { ...value, project: saved } : value
    );
  }
  async function reloadProject() {
    if (!projectId || saving) return;
    setSaving(true);
    try {
      const latest = await getStoryProject(projectId);
      cacheProject(latest);
      update((state) => ({ ...state, baseProjectVersion: latest.projectVersion }));
      setSaveError("");
    } catch (reason) {
      setSaveError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setSaving(false);
    }
  }
  const dirty = useMemo(
    () =>
      Boolean(
        project &&
        (JSON.stringify(appearance) !== JSON.stringify(project.appearance ?? DEFAULT_APPEARANCE) ||
          JSON.stringify(workspace.gameUi ?? null) !== JSON.stringify(project.gameUi ?? null))
      ),
    [appearance, project, workspace.gameUi]
  );
  async function saveAppearance() {
    if (!projectId || !project || !canEdit || saving || running) return;
    setSaving(true);
    setSaveError("");
    try {
      const saved = await updateStoryProject(projectId, {
        expectedProjectVersion: workspace.baseProjectVersion ?? project.projectVersion,
        appearance,
        gameUiSource: workspace.gameUi?.source ?? null,
      });
      update((state) => ({ ...state, baseProjectVersion: saved.projectVersion }));
      cacheProject(saved);
      // Other project surfaces fetch the new version on return; keep this player's runtime mounted.
      void queryClient.invalidateQueries({
        queryKey: ["story-studio", "chapter-scope", projectId],
        refetchType: "none",
      });
    } catch (reason) {
      setSaveError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setSaving(false);
    }
  }

  return (
    <AppearanceSplitPanels
      chatVisible={chatVisible && canDesign}
      previewId={previewId}
      preview={
        <section id={previewId} className={styles.preview} aria-label={t("preview")}>
          <header className={styles.previewHeader}>
            <div className={styles.identity}>
              <Link
                href={backHref}
                className={styles.back}
                aria-label={t(projectId ? "backProject" : "back")}
              >
                <IconArrowLeft size={18} />
              </Link>
              <h1>{projectTitle || t(projectId ? "projectFallback" : "project")}</h1>
              <span>{t("previewTitle")}</span>
            </div>
            <div className={styles.previewActions}>
              {project && canEdit && (
                <button
                  type="button"
                  className={styles.undo}
                  disabled={!dirty || saving || running}
                  onClick={() => void saveAppearance()}
                >
                  <IconDeviceFloppy size={16} />
                  {t(saving ? "savingProject" : dirty ? "saveProject" : "savedProject")}
                </button>
              )}
              {canEdit && workspace.undo.length > 0 && (
                <button
                  className={styles.undo}
                  disabled={running || saving}
                  onClick={() =>
                    update((state) => {
                      const previous = state.undo.at(-1);
                      return previous
                        ? { ...state, ...previous, undo: state.undo.slice(0, -1) }
                        : state;
                    })
                  }
                >
                  <IconArrowBackUp size={14} />
                  {t("chat.undo")}
                </button>
              )}
              {previewTools}
              {canDesign && (
                <button
                  type="button"
                  className={styles.back}
                  aria-label={t(chatVisible ? "hideChat" : "showChat")}
                  title={t(chatVisible ? "hideChat" : "showChat")}
                  aria-expanded={chatVisible}
                  onClick={() => setChatVisible((value) => !value)}
                >
                  {chatVisible ? (
                    <IconLayoutSidebarRightCollapse size={18} />
                  ) : (
                    <IconLayoutSidebarRightExpand size={18} />
                  )}
                </button>
              )}
            </div>
          </header>
          {(saveError || restoreError || persistenceFailed) && (
            <div className={styles.saveError} role="alert">
              <p>
                {saveError ||
                  (restoreError
                    ? `${t("restoreDraftFailed")} ${restoreError}`
                    : t("draftSaveFailed"))}
              </p>
              {saveError && project && (
                <button type="button" disabled={saving} onClick={() => void reloadProject()}>
                  {t("reloadProject")}
                </button>
              )}
              {persistenceFailed && !restoreError && (
                <button type="button" onClick={() => update((state) => state)}>
                  {t("retryDraftSave")}
                </button>
              )}
            </div>
          )}
          <div className={styles.stage}>
            {renderStage({
              appearance,
              gameUi: workspace.gameUi ?? null,
            })}
          </div>
        </section>
      }
      chat={
        <aside className={styles.chat} aria-label={t("chat.label")}>
          {error && (
            <div className={styles.connectionError} role="alert">
              <p>{error}</p>
              <button
                onClick={() => {
                  recoveryAttempts.current = 0;
                  setSession(null);
                  setRunning(false);
                  setRetry((n) => n + 1);
                }}
              >
                {t("chat.reconnect")}
              </button>
            </div>
          )}
          {activeSession ? (
            <iframe
              key={`${activeSession.id}:${retry}`}
              ref={iframe}
              title={t("chat.label")}
              src={activeSession.url}
              className={styles.harnessFrame}
              sandbox="allow-scripts allow-same-origin allow-downloads"
            />
          ) : (
            !error && (
              <p className={styles.connecting} role="status">
                {t("chat.connecting")}
              </p>
            )
          )}
        </aside>
      }
    />
  );
}
