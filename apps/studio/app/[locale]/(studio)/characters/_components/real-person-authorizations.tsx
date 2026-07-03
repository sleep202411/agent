"use client";

import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import {
  IconAlertTriangle,
  IconFolder,
  IconLoader2,
  IconPlus,
  IconShieldOff,
  IconVideoOff,
} from "@tabler/icons-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { FrostedPanel } from "@/components/ui/frosted-panel";
import { SectionHeading } from "@/components/ui/section-heading";
import { Separator } from "@/components/ui/separator";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  listLikenessOutputs,
  listProjectGrants,
  revokeProjectGrant,
  takedownLikenessOutputs,
  type LikenessOutputItem,
  type ProjectGrantDto,
} from "@/lib/characters-api";
import { AuthorizeProjectDialog } from "./authorize-project-dialog";

const authKeys = {
  grants: (characterId: string) => ["fizzstudio", "characters", "grants", characterId] as const,
  outputs: (characterId: string) => ["fizzstudio", "characters", "outputs", characterId] as const,
};

/** Pending takedown scope for the confirm dialog. */
type TakedownScope =
  | { kind: "all" }
  | { kind: "project"; projectId: string; projectName: string }
  | { kind: "job"; jobId: string; projectName: string };

function OutputThumb({ url, mimeType }: { url: string; mimeType: string }) {
  if (mimeType.startsWith("video/")) {
    return (
      <video src={url} muted playsInline preload="metadata" className="size-full object-cover" />
    );
  }
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={url} alt="" className="size-full object-cover" />;
}

/**
 * Subject-facing likeness controls for an active real_person character
 * (design §6): the projects authorized to use the likeness (grant + withdraw)
 * and every video made from it (grouped by project, with per-job / per-project
 * / all "Take down" — a physical block). The subject owns this surface.
 */
export function RealPersonAuthorizations({ characterId }: { characterId: string }) {
  const t = useTranslations("characters");
  const tc = useTranslations("common");
  const queryClient = useQueryClient();

  const [authorizeOpen, setAuthorizeOpen] = useState(false);
  const [pendingTakedown, setPendingTakedown] = useState<TakedownScope | null>(null);
  const [takedownBusy, setTakedownBusy] = useState(false);
  const [revokingProjectId, setRevokingProjectId] = useState<string | null>(null);

  const grantsQuery = useQuery({
    queryKey: authKeys.grants(characterId),
    queryFn: () => listProjectGrants(characterId),
    staleTime: 30_000,
  });
  const outputsQuery = useQuery({
    queryKey: authKeys.outputs(characterId),
    queryFn: () => listLikenessOutputs(characterId),
    staleTime: 30_000,
  });

  const grants = useMemo(() => grantsQuery.data ?? [], [grantsQuery.data]);
  const activeGrantProjectIds = useMemo(
    () => new Set(grants.filter((g) => g.status === "active").map((g) => g.projectId)),
    [grants]
  );
  // projectId → display name, sourced from the grant history (outputs carry
  // only projectId). Falls back to a short id for outputs whose grant is gone.
  const projectName = useMemo(() => {
    const map = new Map<string, string>();
    for (const g of grants) map.set(g.projectId, g.projectName);
    return (id: string) => map.get(id) ?? t("outputsUnknownProject", { id: id.slice(0, 8) });
  }, [grants, t]);

  const outputsByProject = useMemo(() => {
    const groups = new Map<string, LikenessOutputItem[]>();
    for (const item of outputsQuery.data ?? []) {
      const list = groups.get(item.projectId) ?? [];
      list.push(item);
      groups.set(item.projectId, list);
    }
    return [...groups.entries()];
  }, [outputsQuery.data]);

  const applyGrant = (grant: ProjectGrantDto) => {
    queryClient.setQueryData<ProjectGrantDto[]>(authKeys.grants(characterId), (prev) => {
      const rest = (prev ?? []).filter((g) => g.projectId !== grant.projectId);
      return [grant, ...rest];
    });
    void queryClient.invalidateQueries({ queryKey: authKeys.grants(characterId) });
  };

  const withdraw = async (grant: ProjectGrantDto) => {
    if (revokingProjectId) return;
    setRevokingProjectId(grant.projectId);
    try {
      await revokeProjectGrant(characterId, grant.projectId);
      await queryClient.invalidateQueries({ queryKey: authKeys.grants(characterId) });
      toast.success(t("grantWithdrawn", { project: grant.projectName }));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : tc("error"));
    } finally {
      setRevokingProjectId(null);
    }
  };

  const confirmTakedown = async () => {
    if (!pendingTakedown || takedownBusy) return;
    setTakedownBusy(true);
    try {
      const scope =
        pendingTakedown.kind === "all"
          ? {}
          : pendingTakedown.kind === "project"
            ? { projectId: pendingTakedown.projectId }
            : { jobId: pendingTakedown.jobId };
      const { blocked } = await takedownLikenessOutputs(characterId, scope);
      await queryClient.invalidateQueries({ queryKey: authKeys.outputs(characterId) });
      toast.success(t("takedownDone", { count: blocked }));
      setPendingTakedown(null);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : tc("error"));
    } finally {
      setTakedownBusy(false);
    }
  };

  const takedownCopy = (scope: TakedownScope): string => {
    switch (scope.kind) {
      case "all":
        return t("takedownAllBody");
      case "project":
        return t("takedownProjectBody", { project: scope.projectName });
      case "job":
        return t("takedownJobBody", { project: scope.projectName });
    }
  };

  return (
    <section className="mt-12">
      <SectionHeading title={t("authHeading")} subtitle={t("authSubheading")} />

      {/* ── Authorized projects ─────────────────────────── */}
      <FrostedPanel className="mt-6 p-5">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-medium">{t("grantsTitle")}</h3>
            <p className="mt-0.5 text-xs text-muted-foreground">{t("grantsHint")}</p>
          </div>
          <Button variant="secondary" onClick={() => setAuthorizeOpen(true)}>
            <IconPlus data-icon="inline-start" />
            {t("authorizeProject")}
          </Button>
        </div>

        <div className="mt-4">
          {grantsQuery.isPending ? (
            <div className="flex items-center justify-center py-6 text-muted-foreground">
              <IconLoader2 className="size-5 animate-spin" stroke={1.8} />
            </div>
          ) : grantsQuery.isError ? (
            <p className="py-6 text-center text-sm text-destructive">{t("grantsLoadFailed")}</p>
          ) : grants.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">{t("grantsEmpty")}</p>
          ) : (
            <div className="space-y-0.5">
              {grants.map((grant) => {
                const active = grant.status === "active";
                return (
                  <div key={grant.id} className="flex items-center gap-3 rounded-lg px-1.5 py-2">
                    <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-white/[0.06]">
                      <IconFolder className="size-4 text-white/70" stroke={1.7} />
                    </span>
                    <div className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">
                        {grant.projectName}
                      </span>
                      <span className="mt-0.5 block text-xs text-muted-foreground">
                        {active
                          ? t("grantActiveSince", {
                              date: new Date(grant.createdAt).toLocaleDateString(),
                            })
                          : t("grantRevokedOn", {
                              date: new Date(
                                grant.revokedAt ?? grant.createdAt
                              ).toLocaleDateString(),
                            })}
                      </span>
                    </div>
                    {active ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => void withdraw(grant)}
                        disabled={revokingProjectId === grant.projectId}
                      >
                        {revokingProjectId === grant.projectId ? (
                          <IconLoader2 data-icon="inline-start" className="animate-spin" />
                        ) : null}
                        {t("grantWithdraw")}
                      </Button>
                    ) : (
                      <span className="rounded-full bg-white/[0.06] px-2 py-0.5 text-[10px] font-medium text-white/55">
                        {t("statusRevoked")}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </FrostedPanel>

      {/* ── Videos made with your likeness ──────────────── */}
      <FrostedPanel className="mt-4 p-5">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-medium">{t("outputsTitle")}</h3>
            <p className="mt-0.5 text-xs text-muted-foreground">{t("outputsHint")}</p>
          </div>
          {outputsByProject.length > 0 && (
            <Button
              size="sm"
              variant="ghost"
              className="text-destructive hover:text-destructive"
              onClick={() => setPendingTakedown({ kind: "all" })}
            >
              <IconShieldOff data-icon="inline-start" />
              {t("takedownAll")}
            </Button>
          )}
        </div>

        <div className="mt-4">
          {outputsQuery.isPending ? (
            <div className="flex items-center justify-center py-6 text-muted-foreground">
              <IconLoader2 className="size-5 animate-spin" stroke={1.8} />
            </div>
          ) : outputsQuery.isError ? (
            <p className="py-6 text-center text-sm text-destructive">{t("outputsLoadFailed")}</p>
          ) : outputsByProject.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-8 text-center">
              <IconVideoOff className="size-8 text-white/25" stroke={1.5} />
              <p className="text-sm text-muted-foreground">{t("outputsEmpty")}</p>
            </div>
          ) : (
            <div className="space-y-5">
              {outputsByProject.map(([projectId, items], groupIndex) => (
                <div key={projectId}>
                  {groupIndex > 0 && <Separator className="mb-5" />}
                  <div className="flex items-center justify-between gap-3">
                    <span className="truncate text-sm font-medium">{projectName(projectId)}</span>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-destructive hover:text-destructive"
                      onClick={() =>
                        setPendingTakedown({
                          kind: "project",
                          projectId,
                          projectName: projectName(projectId),
                        })
                      }
                    >
                      {t("takedownProject")}
                    </Button>
                  </div>

                  <div className="mt-3 space-y-3">
                    {items.map((job) => (
                      <div key={job.jobId} className="flex items-start gap-3">
                        <div className="grid flex-1 grid-cols-[repeat(auto-fill,minmax(84px,1fr))] gap-2">
                          {job.outputs.map((output) => (
                            <div
                              key={output.assetId}
                              className={cn(
                                "relative aspect-square overflow-hidden rounded-xl bg-white/[0.04]",
                                output.moderationStatus === "blocked" && "opacity-40"
                              )}
                            >
                              <OutputThumb url={output.url} mimeType={output.mimeType} />
                              {output.moderationStatus === "blocked" && (
                                <span className="absolute inset-0 grid place-items-center bg-black/45 text-[9px] font-semibold tracking-wide text-white/90 uppercase">
                                  {t("outputBlocked")}
                                </span>
                              )}
                            </div>
                          ))}
                        </div>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="shrink-0 text-destructive hover:text-destructive"
                          onClick={() =>
                            setPendingTakedown({
                              kind: "job",
                              jobId: job.jobId,
                              projectName: projectName(projectId),
                            })
                          }
                        >
                          {t("takedownJob")}
                        </Button>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </FrostedPanel>

      <AuthorizeProjectDialog
        open={authorizeOpen}
        onOpenChange={setAuthorizeOpen}
        characterId={characterId}
        grantedProjectIds={activeGrantProjectIds}
        onGranted={applyGrant}
      />

      <Dialog
        open={pendingTakedown !== null}
        onOpenChange={(open) => !takedownBusy && !open && setPendingTakedown(null)}
      >
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <IconAlertTriangle className="size-4 text-destructive" stroke={1.8} />
              {t("takedownTitle")}
            </DialogTitle>
            <DialogDescription>
              {pendingTakedown ? takedownCopy(pendingTakedown) : ""}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => setPendingTakedown(null)}
              disabled={takedownBusy}
            >
              {tc("cancel")}
            </Button>
            <Button
              variant="destructive"
              onClick={() => void confirmTakedown()}
              disabled={takedownBusy}
            >
              {takedownBusy ? (
                <IconLoader2 data-icon="inline-start" className="animate-spin" />
              ) : null}
              {t("takedownConfirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
