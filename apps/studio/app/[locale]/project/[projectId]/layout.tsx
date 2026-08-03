"use client";

import { use, useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { useParams } from "next/navigation";
import { IconArrowLeft, IconEye, IconUsers } from "@tabler/icons-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  ProjectProvider,
  type ShellInset,
} from "@/app/[locale]/project/_components/project-context";
import { ShareDialog } from "@/app/_components/share-dialog";
import { MODE_ORDER, getMode } from "@/app/[locale]/project/_modes/registry";
import { getProject, renameProject, type ProjectRole } from "@/lib/collab/projects-api";

/**
 * Project workspace shell — owns the project identity + chrome (back, editable
 * project name, mode switcher) and renders the active mode editor full-screen.
 * Switching modes is sibling-route navigation, so the shell never remounts.
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

  // Controlled name. `dirtyRef` guards the async initial load from clobbering
  // text typed before it resolved; `committedRef` holds the last good name so an
  // empty entry or a failed rename reverts cleanly. The input never remounts.
  const [name, setName] = useState("");
  const [role, setRole] = useState<ProjectRole | null>(null);
  const [shareOpen, setShareOpen] = useState(false);
  // The shell owns three regions: left panels, the mode's content, right
  // panels. A mode reports what its panels occupy on each edge and the
  // chrome that lives there yields — the canvas is only special in that its
  // content is full-bleed, so its panels cover the board instead of shrinking it.
  const [shellInset, setShellInsetState] = useState({ left: 0, right: 0 });
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
  const setShellInset = useCallback(
    (inset: ShellInset) => setShellInsetState((current) => ({ ...current, ...inset })),
    []
  );

  const commitName = (next: string) => {
    if (!canEdit) return; // viewers can't rename (server rejects too)
    const trimmed = next.trim();
    if (!trimmed) {
      setName(committedRef.current); // reject empty; restore the last good name
      return;
    }
    if (trimmed === committedRef.current) {
      setName(trimmed); // normalize whitespace only; no write
      return;
    }
    const previous = committedRef.current;
    committedRef.current = trimmed;
    setName(trimmed);
    void renameProject(projectId, trimmed).catch(() => {
      committedRef.current = previous;
      setName(previous); // revert the optimistic rename
      toast.error(t("renameFailed"));
    });
  };

  return (
    <ProjectProvider
      projectId={projectId}
      role={role}
      openShare={openShare}
      setShellInset={setShellInset}
    >
      <div className="relative h-dvh">
        {children}

        {/* Back + editable project name (top-left). */}
        <div
          className="absolute top-4 z-30 flex items-center gap-1 transition-[left] duration-200 ease-out"
          style={{ left: `calc(1rem + ${shellInset.left}px)` }}
        >
          <Link
            href="/projects"
            aria-label={t("backToProjects")}
            className="flex size-9 items-center justify-center rounded-full bg-popover/90 shadow-md backdrop-blur-xl transition-colors hover:bg-accent"
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
            className="field-sizing-content h-9 min-w-[80px] max-w-[280px] rounded-full bg-popover/90 px-3.5 text-sm font-medium shadow-md backdrop-blur-xl outline-none transition-colors read-only:cursor-default read-only:hover:bg-popover/90 hover:bg-accent focus:bg-accent"
          />
        </div>

        {/* Share + view-only state (top-right). */}
        <div
          className="absolute top-4 z-30 flex items-center gap-2 transition-[right] duration-200 ease-out"
          style={{ right: `calc(1rem + ${shellInset.right}px)` }}
        >
          {role === "viewer" && (
            <span className="flex h-9 items-center gap-1.5 rounded-full bg-popover/90 px-3.5 text-xs font-medium text-white/70 shadow-md backdrop-blur-xl">
              <IconEye className="size-4" stroke={1.8} />
              {t("viewOnly")}
            </span>
          )}
          {/* Canvas mode hosts Share inside the canvas toolbar cluster (so it
              lines up with the AI/history controls and shifts with the side
              panels); other modes host it here in the shell. */}
          {canManage && activeMode !== "canvas" && (
            <button
              type="button"
              onClick={openShare}
              className="flex h-9 items-center gap-1.5 rounded-full bg-popover/90 px-3.5 text-sm font-medium shadow-md backdrop-blur-xl transition-colors hover:bg-accent"
            >
              <IconUsers className="size-4" stroke={1.8} />
              {t("share")}
            </button>
          )}
        </div>

        {canManage && (
          <ShareDialog
            scope={{ kind: "project", id: projectId, name: name || t("thisProject") }}
            canManage={canManage}
            open={shareOpen}
            onOpenChange={setShareOpen}
          />
        )}

        {/* Mode switcher (top-center). */}
        <div className="absolute top-4 left-1/2 z-30 flex -translate-x-1/2 items-center gap-0.5 rounded-full bg-popover/90 p-1 shadow-md backdrop-blur-xl">
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
                    : "text-white/70 hover:bg-white/[0.08] hover:text-white"
                )}
              >
                <Icon className="size-3.5" stroke={1.8} />
                {t(mode.labelKey)}
              </Link>
            );
          })}
        </div>
      </div>
    </ProjectProvider>
  );
}
