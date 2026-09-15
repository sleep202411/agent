"use client";

import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { IconFolder, IconLoader2, IconSearch } from "@tabler/icons-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useAuth } from "@/app/_components/auth-provider";
import { useWorkspace } from "@/app/_components/workspace-context";
import { listProjects, type ProjectRef } from "@/lib/collab/projects-api";
import {
  characterApiErrorCode,
  createProjectGrant,
  REAL_PERSON_GRANT_CONSENT_VERSION,
  type ProjectGrantDto,
} from "@/lib/characters-api";
import { ProjectGrantConsent } from "./project-grant-consent";

type Step = "pick" | "consent";

interface Candidate {
  project: ProjectRef;
  workspaceName: string;
}

/**
 * "Authorize a project" — the subject grants one of their projects the right to
 * use their likeness. Step 1 picks a project from across the subject's
 * workspaces (the server is the source of truth on editor-ness — a
 * PROJECT_EDITOR_REQUIRED refusal surfaces as a clear message); step 2 is the
 * versioned per-project grant consent; accept fires the grant POST.
 *
 * NOTE (wire gap): there is no "projects I can grant to" endpoint that returns
 * the caller's per-project role, so this lists visible workspace projects and
 * leans on the server's typed 403 for non-editor / project-only-membership
 * cases. A dedicated grantable-projects endpoint would let us pre-filter.
 */
type AuthorizeProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  characterId: string;
  /** Already-granted (active) project ids — excluded from the picker. */
  grantedProjectIds: ReadonlySet<string>;
  onGranted: (grant: ProjectGrantDto) => void;
};
export function AuthorizeProjectDialog(props: AuthorizeProps) {
  const { user } = useAuth();
  const { workspaces } = useWorkspace();
  const viewerId = user?.id == null ? "" : String(user.id);
  return (
    <AuthorizeContent
      key={JSON.stringify([viewerId, props.characterId, workspaces.map((w) => w.id).sort()])}
      {...props}
      viewerId={viewerId}
    />
  );
}
function AuthorizeContent({
  open,
  onOpenChange,
  characterId,
  grantedProjectIds,
  onGranted,
  viewerId,
}: AuthorizeProps & { viewerId: string }) {
  const t = useTranslations("characters");
  const tc = useTranslations("common");
  const { workspaces } = useWorkspace();

  const [step, setStep] = useState<Step>("pick");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Candidate | null>(null);
  const [busy, setBusy] = useState(false);
  const [consentRead, setConsentRead] = useState(false);
  const [consentAttested, setConsentAttested] = useState(false);

  const reset = () => {
    setStep("pick");
    setSearch("");
    setSelected(null);
    setConsentRead(false);
    setConsentAttested(false);
  };

  const [openScope, setOpenScope] = useState({ open });
  if (openScope.open !== open) {
    setOpenScope({ open });
    setBusy(false);
    reset();
  }

  const close = (next: boolean) => {
    if (busy) return;
    onOpenChange(next);
    if (!next) reset();
  };

  // Candidate projects = active projects across every workspace the subject
  // belongs to. Fanned out per workspace; the server enforces editor-ness.
  const workspaceIds = useMemo(() => workspaces.map((w) => w.id), [workspaces]);
  const projectsQuery = useQuery({
    queryKey: ["fizzstudio", "grantable-projects", viewerId, ...workspaceIds] as const,
    enabled: open && !!viewerId && workspaces.length > 0,
    staleTime: 30_000,
    queryFn: async ({ signal }): Promise<Candidate[]> => {
      const perWorkspace = await Promise.all(
        workspaces.map(async (ws) => {
          const projects = await listProjects(ws.id, signal);
          return projects
            .filter((p) => p.status === "active")
            .map((project) => ({ project, workspaceName: ws.name }));
        })
      );
      return perWorkspace.flat();
    },
  });

  const candidates = useMemo(() => {
    const all = (projectsQuery.data ?? []).filter((c) => !grantedProjectIds.has(c.project.id));
    const q = search.trim().toLowerCase();
    if (!q) return all;
    return all.filter(
      (c) => c.project.name.toLowerCase().includes(q) || c.workspaceName.toLowerCase().includes(q)
    );
  }, [projectsQuery.data, grantedProjectIds, search]);

  const scopeRef = useRef(openScope);
  const mounted = useRef(false);
  const active = useRef<AbortController | null>(null);
  useLayoutEffect(() => {
    scopeRef.current = openScope;
    mounted.current = open && !!viewerId;
    return () => {
      mounted.current = false;
      active.current?.abort();
      active.current = null;
    };
  }, [open, openScope, viewerId]);
  const grant = async () => {
    if (
      !mounted.current ||
      scopeRef.current !== openScope ||
      active.current ||
      !selected ||
      projectsQuery.isError ||
      grantedProjectIds.has(selected.project.id) ||
      !(consentRead && consentAttested)
    )
      return;
    const claim = new AbortController();
    active.current = claim;
    const current = () => mounted.current && active.current === claim;
    setBusy(true);
    try {
      const created = await createProjectGrant(
        characterId,
        selected.project.id,
        {
          version: REAL_PERSON_GRANT_CONSENT_VERSION,
          adultAttested: true,
        },
        claim.signal
      );
      if (!current()) return;
      onGranted(created);
      toast.success(t("grantAdded", { project: selected.project.name }));
      reset();
      onOpenChange(false);
    } catch (error) {
      if (!current()) return;
      const code = characterApiErrorCode(error);
      // Server rejected the consent (stale version / not sent) — bounce back to
      // the consent screen so the user re-accepts the current copy.
      if (code === "CONSENT_REQUIRED") {
        setConsentRead(false);
        setConsentAttested(false);
        setStep("consent");
        toast.error(t("errorConsentRequired"));
        return;
      }
      const map: Record<string, string> = {
        PROJECT_EDITOR_REQUIRED: t("errorGrantEditorRequired"),
        CHARACTER_SUBJECT_MISMATCH: t("errorSubjectMismatch"),
        PROJECT_NOT_FOUND: t("errorProjectNotFound"),
        CHARACTER_NOT_ACTIVE: t("errorCharacterNotActive"),
      };
      toast.error((code && map[code]) || (error instanceof Error ? error.message : tc("error")));
    } finally {
      if (current()) {
        active.current = null;
        setBusy(false);
      }
    }
  };

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className={step === "consent" ? "sm:max-w-lg" : "sm:max-w-md"}>
        {step === "pick" ? (
          <>
            <DialogHeader>
              <DialogTitle>{t("authorizeProjectTitle")}</DialogTitle>
              <DialogDescription>{t("authorizeProjectDescription")}</DialogDescription>
            </DialogHeader>

            <div className="relative">
              <IconSearch className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder={t("authorizeSearchPlaceholder")}
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                className="pl-8"
              />
            </div>

            <div className="max-h-72 min-h-24 space-y-0.5 overflow-y-auto">
              {projectsQuery.isPending && workspaces.length > 0 ? (
                <div className="flex items-center justify-center py-10 text-muted-foreground">
                  <IconLoader2 className="size-5 animate-spin" stroke={1.8} />
                </div>
              ) : projectsQuery.isError ? (
                <p className="px-1.5 py-8 text-center text-sm text-destructive">
                  {t("authorizeLoadFailed")}
                </p>
              ) : candidates.length === 0 ? (
                <p className="px-1.5 py-8 text-center text-sm text-muted-foreground">
                  {search.trim() ? t("authorizeNoMatches") : t("authorizeNoProjects")}
                </p>
              ) : (
                candidates.map((candidate) => {
                  const active = selected?.project.id === candidate.project.id;
                  return (
                    <button
                      key={candidate.project.id}
                      type="button"
                      onClick={() => setSelected(candidate)}
                      className={cn(
                        "flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left transition-colors",
                        active ? "bg-white/[0.09]" : "hover:bg-white/[0.05]"
                      )}
                    >
                      <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-white/[0.06]">
                        <IconFolder className="size-4.5 text-white/70" stroke={1.7} />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">
                          {candidate.project.name}
                        </span>
                        <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                          {candidate.workspaceName}
                        </span>
                      </span>
                    </button>
                  );
                })
              )}
            </div>

            <DialogFooter>
              <Button variant="ghost" onClick={() => close(false)} disabled={busy}>
                {tc("cancel")}
              </Button>
              <Button variant="primary-cta" onClick={() => setStep("consent")} disabled={!selected}>
                {tc("next")}
              </Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>{t("grantConsentTitle")}</DialogTitle>
              <DialogDescription>
                {t("grantConsentSubtitle", { project: selected?.project.name ?? "" })}
              </DialogDescription>
            </DialogHeader>

            <ProjectGrantConsent
              projectName={selected?.project.name ?? ""}
              read={consentRead}
              onRead={() => setConsentRead(true)}
              attested={consentAttested}
              onAttestedChange={setConsentAttested}
              disabled={busy}
            />

            <DialogFooter>
              <Button variant="ghost" onClick={() => setStep("pick")} disabled={busy}>
                {tc("back")}
              </Button>
              <Button
                variant="primary-cta"
                onClick={() => void grant()}
                disabled={busy || !consentRead || !consentAttested}
                title={REAL_PERSON_GRANT_CONSENT_VERSION}
              >
                {busy ? <IconLoader2 data-icon="inline-start" className="animate-spin" /> : null}
                {t("grantConfirm")}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
