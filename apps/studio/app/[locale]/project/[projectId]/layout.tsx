"use client";

import { use, useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { useParams } from "next/navigation";
import { IconArrowLeft, IconEye, IconHistory, IconSparkles, IconUsers } from "@tabler/icons-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  ProjectProvider,
} from "@/app/[locale]/project/_components/project-context";
import {
  CanvasConnectionProvider,
  useCanvasConnection,
} from "@/app/[locale]/project/_components/canvas-connection-context";
import { CreditsBadge } from "@/app/_components/credits-badge";
import { CollabAvatars } from "@/app/[locale]/canvas/_components/collab-presence";
import { ConnectionSignal } from "@/app/[locale]/canvas/_components/connection-signal";
import { CopilotPanel } from "@/app/[locale]/canvas/_components/copilot/copilot-panel";
import { CanvasHistory } from "@/app/[locale]/canvas/_components/canvas-history";
import { ShareDialog } from "@/app/_components/share-dialog";
import { MODE_ORDER, getMode } from "@/app/[locale]/project/_modes/registry";
import { getProject, renameProject, type ProjectRole } from "@/lib/collab/projects-api";

/**
 * Project workspace shell. Three flex regions:
 *
 *   ┌──────────────────────────────────────┬──────────────┐
 *   │ header (fixed, full-width)           │              │
 *   ├──────────┬───────────────────────────┤   AI 助手     │
 *   │ 左抽屉    │  main content (mode)       │  (push)      │
 *   │ (push)   │  canvas / storyboard …     │              │
 *   └──────────┴───────────────────────────┴──────────────┘
 *
 * The header never moves — only the left drawer and the AI assistant push the
 * regions below it. Modes register a drawer via `setLeftDrawer`; the shell owns
 * the AI assistant open/close. (Phased rollout: stage 1 lays the skeleton +
 * fixes the header; left-drawer/AI slots are wired in stages 2 & 3.)
 */
export default function ProjectLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = use(params);
  const t = useTranslations("project");
  const routeParams = useParams();
  const activeMode = typeof routeParams.mode === "string" ? routeParams.mode : "canvas";

  const [name, setName] = useState("");
  const [role, setRole] = useState<ProjectRole | null>(null);
  const [shareOpen, setShareOpen] = useState(false);
  const [leftDrawer, setLeftDrawer] = useState<React.ReactNode>(null);
  const [copilotOpen, setCopilotOpen] = useState(false);
  // Shell-owned panels: copilot (AI assistant) + activity history. Both are
  // workspace-level, so they live in the shell, not per-mode.
  const [historyOpen, setHistoryOpen] = useState(false);
  // Legacy shellInset is a no-op now: the shell uses flex push (header is fixed,
  // drawer/AI push the body via flex columns), so no chrome位移 is needed. Kept
  // as a stable no-op so canvas/storyboard callers don't crash; removing the
  // call sites themselves is a follow-up.
  const setShellInset = useCallback(() => {}, []);

  const dirtyRef = useRef(false);
  const committedRef = useRef("");
  useEffect(() => {
    let cancelled = false;
    getProject(projectId)
      .then((project) => {
        if (cancelled) return;
        setRole(project.role ?? null);
        if (dirtyRef.current) return;
        committedRef.current = project.name;
        setName(project.name);
      })
      .catch(() => {
        /* keep it empty; the editor surfaces access errors */
      });
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  const canEdit = role == null ? true : role !== "viewer";
  const canManage = role === "owner" || role === "admin";
  const openShare = useCallback(() => setShareOpen(true), []);

  const commitName = (next: string) => {
    if (!canEdit) return;
    const trimmed = next.trim();
    if (!trimmed) {
      setName(committedRef.current);
      return;
    }
    if (trimmed === committedRef.current) {
      setName(trimmed);
      return;
    }
    const previous = committedRef.current;
    committedRef.current = trimmed;
    setName(trimmed);
    void renameProject(projectId, trimmed).catch(() => {
      committedRef.current = previous;
      setName(previous);
      toast.error(t("renameFailed"));
    });
  };

  return (
    <ProjectProvider
      projectId={projectId}
      role={role}
      openShare={openShare}
      setShellInset={setShellInset}
      setLeftDrawer={setLeftDrawer}
      copilotOpen={copilotOpen}
      setCopilotOpen={setCopilotOpen}
    >
      <CanvasConnectionProvider projectId={projectId} canEdit={canEdit}>
        <div className="flex h-dvh">
          {/* LEFT BODY: header on top, drawer slot + main content below. */}
          <div className="flex min-w-0 flex-1 flex-col">
            {/* HEADER — fixed, full-width, never pushed by drawer/assistant. */}
            <header className="relative z-30 flex h-14 shrink-0 items-center gap-3 px-4">
              <Link
                href="/projects"
                aria-label={t("backToProjects")}
                className="flex size-8 items-center justify-center rounded-full transition-colors hover:bg-white/[0.08]"
              >
                <IconArrowLeft className="size-4" />
              </Link>
              <input
                value={name}
                aria-label={t("projectName")}
                placeholder={t("untitled")}
                readOnly={!canEdit}
                onChange={(event) => {
                  if (!canEdit) return;
                  dirtyRef.current = true;
                  setName(event.target.value);
                }}
                onBlur={(event) => commitName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") event.currentTarget.blur();
                }}
                className="field-sizing-content h-8 min-w-[80px] max-w-[240px] rounded-full px-3 text-sm font-medium outline-none transition-colors read-only:cursor-default hover:bg-white/[0.06] focus:bg-white/[0.06]"
              />

              {/* Mode switcher (center). */}
              <div className="mx-auto flex items-center gap-0.5 rounded-full bg-white/[0.06] p-1">
                {MODE_ORDER.map((slug) => {
                  const mode = getMode(slug);
                  if (!mode) return null;
                  const active = slug === activeMode;
                  const Icon = mode.Icon;
                  return (
                    <Link
                      key={slug}
                      href={`/project/${projectId}/${slug}`}
                      className={cn(
                        "flex h-7 items-center gap-1.5 rounded-full px-3 text-xs font-medium transition-colors",
                        active
                          ? "bg-white text-black"
                          : "text-white/70 hover:bg-white/[0.08] hover:text-white",
                      )}
                    >
                      <Icon className="size-3.5" stroke={1.8} />
                      {t(mode.labelKey)}
                    </Link>
                  );
                })}
              </div>

              {/* Right-side header cluster — shell-owned, identical across modes. */}
              <div className="ml-auto flex items-center gap-2">
                {role === "viewer" && (
                  <span className="flex h-8 items-center gap-1.5 rounded-full bg-white/[0.06] px-3 text-xs font-medium text-white/70">
                    <IconEye className="size-4" stroke={1.8} />
                    {t("viewOnly")}
                  </span>
                )}
                <HeaderActions
                  copilotOpen={copilotOpen}
                  onToggleCopilot={() => {
                    setHistoryOpen(false);
                    setCopilotOpen((v) => !v);
                  }}
                  historyOpen={historyOpen}
                  onToggleHistory={() => {
                    setCopilotOpen(false);
                    setHistoryOpen((v) => !v);
                  }}
                  canEdit={canEdit}
                />
                {canManage && (
                  <button
                    type="button"
                    onClick={openShare}
                    className="flex h-8 items-center gap-1.5 rounded-full bg-white/[0.06] px-3 text-xs font-medium transition-colors hover:bg-white/[0.1]"
                  >
                    <IconUsers className="size-4" stroke={1.8} />
                    {t("share")}
                  </button>
                )}
              </div>
            </header>

            {/* BODY: left drawer slot (push) + main content. */}
            <div className="flex min-h-0 flex-1">
              {leftDrawer ? (
                <aside className="h-full shrink-0 overflow-hidden">{leftDrawer}</aside>
              ) : null}
              <main className="relative min-w-0 flex-1">{children}</main>
            </div>
          </div>

          {/* RIGHT: AI assistant (push). Shell-owned — works in every mode because
              its tools now read the graph via CanvasGraphContext (lifted to the
              shell) instead of ReactFlow. */}
          {copilotOpen ? (
            <aside className="h-full w-[380px] shrink-0 border-l border-white/[0.06] bg-popover/95 backdrop-blur-xl">
              <CopilotPanel
                projectId={projectId}
                open={copilotOpen}
                onClose={() => setCopilotOpen(false)}
              />
            </aside>
          ) : null}
        </div>

        {/* Activity history overlay (shell-owned, workspace-level). */}
        {historyOpen ? (
          <HistoryOverlay onClose={() => setHistoryOpen(false)} />
        ) : null}
      </CanvasConnectionProvider>

      {canManage && (
        <ShareDialog
          scope={{ kind: "project", id: projectId, name: name || t("thisProject") }}
          canManage={canManage}
          open={shareOpen}
          onOpenChange={setShareOpen}
        />
      )}
    </ProjectProvider>
  );
}

/** Header right-cluster actions — reads the canvas connection (the single
 *  shell-owned one) so connection/avatars/credits are identical in every mode. */
function HeaderActions({
  copilotOpen,
  onToggleCopilot,
  historyOpen,
  onToggleHistory,
  canEdit,
}: {
  copilotOpen: boolean;
  onToggleCopilot: () => void;
  historyOpen: boolean;
  onToggleHistory: () => void;
  canEdit: boolean;
}) {
  const tCopilot = useTranslations("copilot");
  const tCanvas = useTranslations("canvas");
  const { connectionStatus, rtt, awareness, doc } = useCanvasConnection();
  return (
    <>
      <button
        type="button"
        aria-label={tCopilot("open")}
        onClick={onToggleCopilot}
        className={cn(
          "flex size-8 items-center justify-center rounded-full transition-colors",
          copilotOpen
            ? "bg-white text-black"
            : "text-white/70 hover:bg-white/[0.08] hover:text-white",
        )}
      >
        <IconSparkles className="size-4" stroke={1.8} />
      </button>
      <span className="flex h-8 items-center rounded-full bg-white/[0.06] px-3">
        <ConnectionSignal status={connectionStatus} rtt={rtt} />
      </span>
      {canEdit ? (
        <button
          type="button"
          aria-label={tCanvas("activityLog")}
          onClick={onToggleHistory}
          className={cn(
            "flex size-8 items-center justify-center rounded-full transition-colors",
            historyOpen
              ? "bg-white text-black"
              : "text-white/70 hover:bg-white/[0.08] hover:text-white",
          )}
        >
          <IconHistory className="size-4" stroke={1.8} />
        </button>
      ) : null}
      <CollabAvatars awareness={awareness} localClientId={doc?.clientID} />
      <CreditsBadge className="flex h-8 items-center gap-1.5 rounded-full bg-white/[0.06] px-3 text-xs font-medium tabular-nums" />
    </>
  );
}

/** Activity history panel — renders against the shell-owned connection. */
function HistoryOverlay({ onClose }: { onClose: () => void }) {
  const { documentId, provider } = useCanvasConnection();
  return (
    <CanvasHistory documentId={documentId} provider={provider} onClose={onClose} />
  );
}

