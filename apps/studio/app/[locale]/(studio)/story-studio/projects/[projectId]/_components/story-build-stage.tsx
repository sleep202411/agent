"use client";

import {
  IconAlertTriangle,
  IconCheck,
  IconCloudUpload,
  IconEdit,
  IconExternalLink,
  IconLoader2,
  IconLock,
  IconPackage,
  IconRefresh,
  IconRoute,
} from "@tabler/icons-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import { ExperienceRuntimePlayer } from "@/components/experience-runtime/experience-runtime-player";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { FrostedPanel } from "@/components/ui/frosted-panel";
import { Link } from "@/i18n/navigation";
import {
  createFilmBuild,
  getFilmBuild,
  listFilmBuilds,
  lockStoryRevision,
  publishFilmBuild,
  storyApiErrorMessage,
  type ExperienceReleaseResult,
  type FilmBuild,
  type FilmBuildDiagnostic,
  type FilmBuildSummary,
  type StoryWorkbench,
} from "@/lib/story-projects-api";
import { cn } from "@/lib/utils";

export function StoryBuildStage({
  projectId,
  workspaceId,
  workbench,
  onRefresh,
}: {
  projectId: string;
  workspaceId: string;
  workbench: StoryWorkbench;
  onRefresh: () => Promise<unknown>;
}) {
  const t = useTranslations("storyStudio.build");
  const locale = useLocale();
  const queryClient = useQueryClient();
  const [selectedBuildId, setSelectedBuildId] = useState<string | null>(null);
  const [publication, setPublication] = useState<{
    buildId: string;
    result: ExperienceReleaseResult;
  } | null>(null);
  const [publishCandidateBuildId, setPublishCandidateBuildId] = useState<string | null>(null);
  const buildQueryKey = useMemo(
    () => ["story-studio", "production-builds", workspaceId, projectId] as const,
    [projectId, workspaceId]
  );
  const buildsQuery = useQuery({
    queryKey: buildQueryKey,
    queryFn: () => listFilmBuilds(workspaceId, projectId, { profile: "production", limit: 30 }),
    retry: false,
  });

  const effectiveSelectedBuildId = selectedBuildId ?? buildsQuery.data?.items[0]?.id ?? null;

  const detailQuery = useQuery({
    queryKey: ["story-studio", "build", workspaceId, projectId, effectiveSelectedBuildId],
    queryFn: () => getFilmBuild(workspaceId, projectId, effectiveSelectedBuildId as string),
    enabled: Boolean(effectiveSelectedBuildId),
    retry: false,
  });
  const lockMutation = useMutation({
    mutationFn: () =>
      lockStoryRevision(workspaceId, projectId, {
        expectedDraftRevision: workbench.draft.revision,
      }),
    onSuccess: async () => {
      toast.success(t("notifications.revisionLocked"));
      await onRefresh();
    },
    onError: (error) => toast.error(storyApiErrorMessage(error, t("errors.lockRevision"))),
  });
  const createMutation = useMutation({
    mutationFn: () => {
      if (!workbench.selectedRevision || !workbench.film) {
        throw new Error(t("errors.revisionRequired"));
      }
      return createFilmBuild(
        workspaceId,
        projectId,
        {
          revisionId: workbench.selectedRevision.id,
          expectedProductionRevision: workbench.film.productionRevision,
          profile: "production",
          scope: { kind: "full" },
        },
        globalThis.crypto.randomUUID()
      );
    },
    onSuccess: async (build) => {
      setSelectedBuildId(build.id);
      queryClient.setQueryData(["story-studio", "build", workspaceId, projectId, build.id], build);
      toast[build.status === "ready" ? "success" : "warning"](
        build.status === "ready" ? t("notifications.created") : t("notifications.validationFailed")
      );
      await Promise.all([queryClient.invalidateQueries({ queryKey: buildQueryKey }), onRefresh()]);
    },
    onError: (error) => toast.error(storyApiErrorMessage(error, t("errors.create"))),
  });
  const publishMutation = useMutation({
    mutationFn: (buildId: string) =>
      publishFilmBuild(workspaceId, projectId, buildId, {
        status: "published",
        setCurrent: true,
      }),
    onSuccess: (result, buildId) => {
      setPublication({ buildId, result });
      setPublishCandidateBuildId(null);
      toast.success(t("notifications.published"));
    },
    onError: (error) => toast.error(storyApiErrorMessage(error, t("errors.publish"))),
  });

  const canBuild = workbench.project.capabilities.includes("story.build");
  const canEdit = workbench.project.capabilities.includes("story.edit");
  const canRelease = workbench.project.capabilities.includes("story.release");
  const selectedBuild =
    createMutation.data?.id === effectiveSelectedBuildId
      ? createMutation.data
      : (detailQuery.data ?? null);
  const listError = buildsQuery.isError
    ? storyApiErrorMessage(buildsQuery.error, t("errors.list"))
    : null;

  return (
    <div className="space-y-5">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-base font-semibold text-white">{t("title")}</h2>
          <p className="mt-1 max-w-3xl text-xs leading-5 text-white/42">{t("subtitle")}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" variant="ghost" asChild>
            <Link href={`/story-studio/projects/${projectId}/canvas`}>
              <IconEdit className="size-4" />
              {t("actions.editStory")}
            </Link>
          </Button>
          <Button
            type="button"
            variant="secondary"
            disabled={buildsQuery.isFetching}
            onClick={() => void buildsQuery.refetch()}
          >
            <IconRefresh className={buildsQuery.isFetching ? "size-4 animate-spin" : "size-4"} />
            {t("actions.refresh")}
          </Button>
          {workbench.selectedRevision && workbench.film ? (
            <Button
              type="button"
              disabled={!canBuild || createMutation.isPending}
              onClick={() => createMutation.mutate()}
            >
              {createMutation.isPending ? (
                <IconLoader2 className="size-4 animate-spin" />
              ) : (
                <IconPackage className="size-4" />
              )}
              {createMutation.isPending ? t("actions.creating") : t("actions.createProduction")}
            </Button>
          ) : null}
        </div>
      </header>

      {!workbench.selectedRevision ? (
        <FrostedPanel className="flex flex-col items-start gap-5 p-6 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <div className="grid size-10 shrink-0 place-items-center rounded-xl bg-white/[0.06] text-white/62">
              <IconLock className="size-4" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-white">{t("lockRevision.title")}</h3>
              <p className="mt-1 max-w-2xl text-xs leading-5 text-white/44">
                {t("lockRevision.description")}
              </p>
            </div>
          </div>
          <Button
            type="button"
            disabled={!canEdit || lockMutation.isPending}
            onClick={() => lockMutation.mutate()}
          >
            {lockMutation.isPending ? (
              <IconLoader2 className="size-4 animate-spin" />
            ) : (
              <IconLock className="size-4" />
            )}
            {lockMutation.isPending ? t("lockRevision.locking") : t("lockRevision.action")}
          </Button>
        </FrostedPanel>
      ) : workbench.film ? (
        <FrostedPanel className="flex items-start gap-3 p-5">
          <IconCheck className="mt-0.5 size-4 shrink-0 text-white/62" />
          <div>
            <h3 className="text-sm font-semibold text-white">
              {t("revisionBasis.currentTitle", { number: workbench.selectedRevision.number })}
            </h3>
            <p className="mt-1 text-xs leading-5 text-white/42">
              {t("revisionBasis.currentDescription", {
                number: workbench.selectedRevision.number,
                sourceRevision: workbench.selectedRevision.sourceDraftRevision,
              })}
            </p>
          </div>
        </FrostedPanel>
      ) : (
        <BuildAlert title={t("missingFilm.title")} description={t("missingFilm.description")} />
      )}

      {!canBuild ? <BuildAlert title={t("permissions.build")} /> : null}
      {!canRelease && selectedBuild?.status === "ready" ? (
        <BuildAlert title={t("permissions.release")} />
      ) : null}
      {listError ? <BuildAlert title={listError} /> : null}

      <div className="grid gap-5 xl:grid-cols-[280px_minmax(0,1fr)]">
        <FrostedPanel className="p-3">
          <div className="flex items-center justify-between px-2 py-2">
            <h3 className="text-xs font-semibold text-white/72">{t("history.title")}</h3>
            <span className="text-[10px] text-white/34">
              {t("history.count", { count: buildsQuery.data?.items.length ?? 0 })}
            </span>
          </div>
          <div className="mt-1 space-y-1">
            {buildsQuery.isLoading ? (
              <div className="grid min-h-28 place-items-center">
                <IconLoader2 className="size-4 animate-spin text-white/42" />
              </div>
            ) : null}
            {buildsQuery.data?.items.map((build) => (
              <BuildHistoryItem
                key={build.id}
                build={build}
                selected={build.id === effectiveSelectedBuildId}
                onSelect={() => setSelectedBuildId(build.id)}
              />
            ))}
            {buildsQuery.data && buildsQuery.data.items.length === 0 ? (
              <p className="px-2 py-8 text-center text-xs leading-5 text-white/36">
                {t("history.empty")}
              </p>
            ) : null}
          </div>
        </FrostedPanel>

        <div className="min-w-0">
          {effectiveSelectedBuildId && detailQuery.isLoading ? (
            <FrostedPanel className="grid min-h-80 place-items-center">
              <IconLoader2 className="size-5 animate-spin text-white/46" />
            </FrostedPanel>
          ) : null}
          {detailQuery.isError ? (
            <BuildAlert title={storyApiErrorMessage(detailQuery.error, t("errors.detail"))} />
          ) : null}
          {selectedBuild ? (
            <BuildDetail
              build={selectedBuild}
              locale={locale}
              frameProfile={workbench.project.frameProfile}
              canRelease={canRelease}
              publishing={publishMutation.isPending}
              publication={publication?.buildId === selectedBuild.id ? publication.result : null}
              onPublish={() => setPublishCandidateBuildId(selectedBuild.id)}
            />
          ) : null}
          {!effectiveSelectedBuildId && !buildsQuery.isLoading ? (
            <FrostedPanel className="grid min-h-80 place-items-center p-8 text-center">
              <div className="max-w-md">
                <IconPackage className="mx-auto size-6 text-white/42" />
                <h3 className="mt-4 text-sm font-semibold text-white">{t("empty.title")}</h3>
                <p className="mt-2 text-xs leading-5 text-white/42">{t("empty.description")}</p>
              </div>
            </FrostedPanel>
          ) : null}
        </div>
      </div>

      <Dialog
        open={publishCandidateBuildId !== null}
        onOpenChange={(open) => {
          if (!open && !publishMutation.isPending) setPublishCandidateBuildId(null);
        }}
      >
        <DialogContent
          showCloseButton={!publishMutation.isPending}
          className="rounded-[20px] bg-[oklch(0.205_0_0/0.98)] p-5 text-white shadow-[0_32px_100px_rgba(0,0,0,0.7)] sm:max-w-md"
        >
          <DialogHeader>
            <DialogTitle>{t("publishDialog.title")}</DialogTitle>
            <DialogDescription>{t("publishDialog.description")}</DialogDescription>
          </DialogHeader>
          <DialogFooter className="mt-2">
            <DialogClose asChild>
              <Button type="button" variant="secondary" disabled={publishMutation.isPending}>
                {t("publishDialog.cancel")}
              </Button>
            </DialogClose>
            <Button
              type="button"
              disabled={!publishCandidateBuildId || publishMutation.isPending}
              onClick={() => {
                if (publishCandidateBuildId) publishMutation.mutate(publishCandidateBuildId);
              }}
            >
              {publishMutation.isPending ? (
                <IconLoader2 className="size-4 animate-spin" />
              ) : (
                <IconCloudUpload className="size-4" />
              )}
              {publishMutation.isPending ? t("actions.publishing") : t("publishDialog.confirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function BuildHistoryItem({
  build,
  selected,
  onSelect,
}: {
  build: FilmBuildSummary;
  selected: boolean;
  onSelect: () => void;
}) {
  const t = useTranslations("storyStudio.build");
  const errors = build.diagnostics.filter((item) => item.severity === "error").length;
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        "w-full rounded-xl px-3 py-3 text-left transition",
        selected ? "bg-white/[0.09]" : "hover:bg-white/[0.045]"
      )}
    >
      <div className="flex items-center justify-between gap-3">
        <span className="text-xs font-semibold text-white/76">
          {t("buildNumber", { number: build.number })}
        </span>
        <span className="text-[10px] text-white/38">{t(`status.${build.status}`)}</span>
      </div>
      <div className="mt-1.5 flex items-center gap-2 text-[10px] text-white/32">
        <span>r{build.sourceProductionRevision}</span>
        <span>{t(`profile.${build.profile}`)}</span>
        {errors > 0 ? (
          <span className="text-[#ff9b9e]">{t("history.errors", { count: errors })}</span>
        ) : null}
      </div>
    </button>
  );
}

function BuildDetail({
  build,
  locale,
  frameProfile,
  canRelease,
  publishing,
  publication,
  onPublish,
}: {
  build: FilmBuild;
  locale: string;
  frameProfile: StoryWorkbench["project"]["frameProfile"];
  canRelease: boolean;
  publishing: boolean;
  publication: ExperienceReleaseResult | null;
  onPublish: () => void;
}) {
  const t = useTranslations("storyStudio.build");
  const errors = build.diagnostics.filter((item) => item.severity === "error");
  const warnings = build.diagnostics.filter((item) => item.severity === "warning");
  return (
    <div className="space-y-5">
      <FrostedPanel className="p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-white">
              {t("buildNumber", { number: build.number })}
            </h3>
            <p className="mt-1 text-[10px] text-white/38">
              {t("detail.identity", {
                revision: build.sourceProductionRevision,
                profile: t(`profile.${build.profile}`),
                scope: t("scope.full"),
              })}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-white/[0.06] px-3 py-1.5 text-[10px] font-semibold text-white/52">
              {t(`status.${build.status}`)}
            </span>
            {build.status === "ready" && build.runtimeJson ? (
              <Button type="button" disabled={!canRelease || publishing} onClick={onPublish}>
                {publishing ? (
                  <IconLoader2 className="size-4 animate-spin" />
                ) : (
                  <IconCloudUpload className="size-4" />
                )}
                {publishing ? t("actions.publishing") : t("actions.publish")}
              </Button>
            ) : null}
          </div>
        </div>
        {publication ? (
          <a
            href={publication.manifestUrl}
            target="_blank"
            rel="noreferrer"
            className="mt-4 flex items-center gap-2 rounded-xl bg-white/[0.045] px-3 py-2 text-[10px] text-white/54 transition hover:bg-white/[0.07] hover:text-white/76"
          >
            <IconExternalLink className="size-3.5 shrink-0" />
            <span className="min-w-0 truncate">
              {t("publication.current", { version: publication.contentVersion })}
            </span>
          </a>
        ) : null}
      </FrostedPanel>

      {build.status === "ready" && build.runtimeJson ? (
        <FrostedPanel className="p-4 sm:p-5">
          <div className="mb-4">
            <h3 className="text-sm font-semibold text-white">{t("playtest.title")}</h3>
            <p className="mt-1 text-xs text-white/40">{t("playtest.description")}</p>
          </div>
          <ExperienceRuntimePlayer
            runtime={build.runtimeJson}
            locale={locale}
            frameProfile={frameProfile}
          />
        </FrostedPanel>
      ) : null}

      {build.status === "ready" && !build.runtimeJson ? (
        <BuildAlert title={t("errors.runtimeUnavailable")} />
      ) : null}

      <div className="grid gap-5 lg:grid-cols-2">
        <FrostedPanel className="p-5">
          <h3 className="text-sm font-semibold text-white">{t("diagnostics.title")}</h3>
          <p className="mt-1 text-[10px] text-white/36">
            {t("diagnostics.summary", { errors: errors.length, warnings: warnings.length })}
          </p>
          <div className="mt-4 space-y-2">
            {build.diagnostics.length > 0 ? (
              build.diagnostics.map((item, index) => (
                <DiagnosticItem
                  key={`${item.code}:${item.entityId ?? "project"}:${index}`}
                  item={item}
                />
              ))
            ) : (
              <div className="rounded-xl bg-white/[0.045] px-4 py-3">
                <p className="text-xs font-medium text-white/68">{t("diagnostics.cleanTitle")}</p>
                <p className="mt-1 text-[10px] leading-4 text-white/36">
                  {t("diagnostics.cleanDescription")}
                </p>
              </div>
            )}
          </div>
        </FrostedPanel>

        <FrostedPanel className="p-5">
          <div className="flex items-center gap-2">
            <IconRoute className="size-4 text-white/46" />
            <h3 className="text-sm font-semibold text-white">{t("pathReport.title")}</h3>
          </div>
          <p className="mt-1 text-[10px] text-white/36">{t("pathReport.description")}</p>
          {build.pathReport ? (
            <dl className="mt-4 grid grid-cols-2 gap-2">
              <Metric label={t("pathReport.paths")} value={build.pathReport.enumeratedPathCount} />
              <Metric
                label={t("pathReport.endings")}
                value={build.pathReport.reachableEndingIds.length}
              />
              <Metric
                label={t("pathReport.ambiguous")}
                value={build.pathReport.ambiguousPathCount}
              />
              <Metric
                label={t("pathReport.unreachable")}
                value={build.pathReport.unreachableNodeIds.length}
              />
            </dl>
          ) : (
            <p className="mt-4 text-xs text-white/34">{t("errors.runtimeUnavailable")}</p>
          )}
        </FrostedPanel>
      </div>

      {build.assets.length > 0 ? (
        <FrostedPanel className="p-5">
          <h3 className="text-sm font-semibold text-white">{t("assets.title")}</h3>
          <p className="mt-1 text-[10px] text-white/36">{t("assets.description")}</p>
          <div className="mt-4 divide-y divide-white/[0.055]">
            {build.assets.map((asset) => (
              <div
                key={asset.id}
                className="flex items-center justify-between gap-4 py-2.5 text-[10px]"
              >
                <code className="min-w-0 truncate text-white/54">{asset.logicalKey}</code>
                <code className="shrink-0 text-white/28">{asset.checksumSha256.slice(0, 12)}</code>
              </div>
            ))}
          </div>
        </FrostedPanel>
      ) : null}
    </div>
  );
}

function DiagnosticItem({ item }: { item: FilmBuildDiagnostic }) {
  return (
    <div className="rounded-xl bg-white/[0.045] px-4 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <span
          className={cn(
            "text-[10px] font-semibold",
            item.severity === "error" ? "text-[#ff9b9e]" : "text-white/48"
          )}
        >
          {item.severity.toUpperCase()}
        </span>
        <code className="text-[10px] text-white/30">{item.code}</code>
      </div>
      <p className="mt-1.5 text-xs leading-5 text-white/58">{item.message}</p>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl bg-white/[0.045] px-3 py-3">
      <dt className="text-[10px] text-white/34">{label}</dt>
      <dd className="mt-1 text-sm font-semibold tabular-nums text-white/72">{value}</dd>
    </div>
  );
}

function BuildAlert({ title, description }: { title: string; description?: string }) {
  return (
    <FrostedPanel role="alert" className="flex items-start gap-3 p-5">
      <IconAlertTriangle className="mt-0.5 size-4 shrink-0 text-[#ff9b9e]" />
      <div>
        <p className="text-xs font-medium text-white/72">{title}</p>
        {description ? <p className="mt-1 text-xs leading-5 text-white/42">{description}</p> : null}
      </div>
    </FrostedPanel>
  );
}
