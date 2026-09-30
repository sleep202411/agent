"use client";

import { useCallback, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  IconArchive,
  IconArrowRight,
  IconClock,
  IconDots,
  IconEdit,
  IconUsers,
  IconGitBranch,
  IconLoader2,
  IconMovie,
  IconPlus,
  IconRefresh,
  IconSparkles,
} from "@tabler/icons-react";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import { useWorkspace } from "@/app/_components/workspace-context";
import { ShareDialog } from "@/app/_components/share-dialog";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Field } from "@/components/ui/field";
import { FrostedPanel } from "@/components/ui/frosted-panel";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { Link, useRouter } from "@/i18n/navigation";
import {
  archiveStoryProject,
  createStoryProject,
  listStoryProjects,
  storyApiErrorMessage,
  updateStoryProject,
  type StoryProjectSummary,
} from "@/lib/story-projects-api";
import { MoveStoryProjectDialog } from "./move-story-project-dialog";
import { StoryStudioHero } from "./story-studio-hero";

const STORY_PROJECTS_QUERY = ["story-studio", "projects"] as const;
const JINLING_SOURCE_TITLE = "金陵入梦";
const JINLING_FEATURE_TAGS = ["interactive_film", "classical_literature", "mystery"] as const;

export function StoryProjectLibrary({ featuredPlayerHref }: { featuredPlayerHref: string }) {
  const t = useTranslations("storyStudio");
  const locale = useLocale();
  const { activeWorkspace, loading: workspaceLoading } = useWorkspace();
  const workspaceId = activeWorkspace?.id;
  const canCreate =
    activeWorkspace?.accessScope !== "project_only" &&
    (["owner", "admin", "editor"].includes(activeWorkspace?.role ?? "") ||
      activeWorkspace?.crewRole === "editor");
  const router = useRouter();
  const queryClient = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<StoryProjectSummary | null>(null);
  const [archiving, setArchiving] = useState<StoryProjectSummary | null>(null);
  const [moving, setMoving] = useState<StoryProjectSummary | null>(null);
  const [sharing, setSharing] = useState<StoryProjectSummary | null>(null);

  const projectsQuery = useQuery({
    queryKey: [...STORY_PROJECTS_QUERY, workspaceId],
    queryFn: () => listStoryProjects({ workspaceId: workspaceId!, limit: 100 }),
    enabled: Boolean(workspaceId),
    retry: false,
  });

  const projects = projectsQuery.data?.items ?? [];
  const isLoading = workspaceLoading || projectsQuery.isLoading;
  const featuredProject = projects.find(
    (project) =>
      project.title.trim() === JINLING_SOURCE_TITLE &&
      project.defaultLocale === "zh-CN" &&
      JINLING_FEATURE_TAGS.every((tag) => project.tags.includes(tag))
  );
  const featuredProjectHref = featuredProject
    ? `/story-studio/projects/${encodeURIComponent(featuredProject.id)}/canvas`
    : null;

  const refresh = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: STORY_PROJECTS_QUERY });
  }, [queryClient]);

  return (
    <>
      <StoryStudioHero featuredProjectHref={featuredProjectHref} playerHref={featuredPlayerHref} />
      <section id="story-projects" className="relative z-20 px-6 pt-12 pb-16 lg:px-8">
        <div className="w-full">
          <header className="flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
            <div>
              <p className="text-[11px] font-semibold tracking-[0.16em] text-white/38 uppercase">
                {t("eyebrow")}
              </p>
              <h2 className="mt-2 text-[22px] font-semibold tracking-[-0.015em] text-white">
                {t("projects.title")}
              </h2>
              <p className="mt-1 max-w-2xl text-[13px] font-medium text-white/48">
                {t("projects.subtitle")}
              </p>
            </div>
            <Button
              type="button"
              disabled={!canCreate}
              onClick={() => setCreateOpen(true)}
              className="h-10 rounded-xl bg-[#E52227] px-4 text-white hover:bg-[#f02b30]"
            >
              <IconPlus className="size-4" stroke={2} />
              {t("newProject")}
            </Button>
          </header>

          <section className="mt-8" aria-labelledby="story-projects-heading">
            <div className="flex items-end justify-between gap-4">
              <h3 id="story-projects-heading" className="sr-only">
                {t("projects.title")}
              </h3>
              {projectsQuery.isError ? (
                <Button variant="ghost" size="sm" onClick={() => void projectsQuery.refetch()}>
                  <IconRefresh className="size-4" />
                  {t("actions.retry")}
                </Button>
              ) : null}
            </div>

            {isLoading ? (
              <ProjectSkeletons />
            ) : projectsQuery.isError ? (
              <FrostedPanel className="mt-5 flex min-h-48 flex-col items-center justify-center px-6 text-center">
                <p className="text-sm font-medium text-white/72">{t("errors.loadProjects")}</p>
                <p className="mt-2 max-w-lg text-xs leading-5 text-white/42">
                  {storyApiErrorMessage(projectsQuery.error, t("errors.generic"))}
                </p>
              </FrostedPanel>
            ) : projects.length === 0 ? (
              <EmptyProjects onCreate={canCreate ? () => setCreateOpen(true) : undefined} />
            ) : (
              <div className="mt-5 grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-4">
                {projects.map((project) => (
                  <StoryProjectCard
                    key={project.id}
                    project={project}
                    locale={locale}
                    onEdit={() => setEditing(project)}
                    onShare={() => setSharing(project)}
                    onArchive={() => setArchiving(project)}
                    onMove={() => setMoving(project)}
                  />
                ))}
              </div>
            )}
          </section>
        </div>

        {workspaceId && canCreate && (
          <CreateProjectDialog
            key={workspaceId}
            workspaceId={workspaceId}
            open={createOpen}
            onOpenChange={setCreateOpen}
            defaultLocale={locale}
            onCreated={(project) => {
              void refresh();
              router.push(`/story-studio/projects/${project.id}/canvas`);
            }}
          />
        )}
        {editing ? (
          <EditProjectDialog
            key={`${editing.id}:${editing.projectVersion}`}
            project={editing}
            onOpenChange={(open) => !open && setEditing(null)}
            onSaved={() => {
              setEditing(null);
              void refresh();
            }}
          />
        ) : null}
        {sharing ? (
          <ShareDialog
            scope={{ kind: "story-project", id: sharing.id, name: sharing.title }}
            canManage={sharing.capabilities.includes("story.admin")}
            open
            onOpenChange={(open) => !open && setSharing(null)}
          />
        ) : null}
        {moving ? (
          <MoveStoryProjectDialog project={moving} onClose={() => setMoving(null)} />
        ) : null}
        {archiving ? (
          <ArchiveProjectDialog
            project={archiving}
            onOpenChange={(open) => !open && setArchiving(null)}
            onArchived={() => {
              setArchiving(null);
              void refresh();
            }}
          />
        ) : null}
      </section>
    </>
  );
}

function StoryProjectCard({
  project,
  locale,
  onEdit,
  onShare,
  onArchive,
  onMove,
}: {
  project: StoryProjectSummary;
  locale: string;
  onEdit: () => void;
  onShare: () => void;
  onArchive: () => void;
  onMove: () => void;
}) {
  const t = useTranslations("storyStudio");
  const canEdit = project.capabilities.includes("story.edit");
  const canAdmin = project.capabilities.includes("story.admin");
  // A project cover is an image. That is the contract every consumer needs — the
  // player's title backdrop, this tile, and the play page's og:image all render
  // a still — so a legacy video cover falls through to the placeholder art here
  // and has to be re-picked as an image.
  const cover =
    project.cover?.kind === "image" &&
    project.cover.status === "ready" &&
    project.cover.moderationStatus !== "blocked" &&
    project.cover.previewUrl
      ? project.cover
      : null;
  return (
    <div className="group relative min-w-0">
      <Link
        href={`/story-studio/projects/${project.id}/canvas`}
        className="relative block overflow-hidden rounded-[16px] bg-white/[0.05] shadow-[0_18px_42px_rgba(0,0,0,0.32)] outline-none transition duration-200 hover:-translate-y-1 hover:bg-white/[0.08] hover:shadow-[0_26px_70px_rgba(0,0,0,0.44)] focus-visible:ring-2 focus-visible:ring-white/50"
      >
        <div className="relative aspect-video overflow-hidden bg-[#171819]">
          {cover ? (
            // eslint-disable-next-line @next/next/no-img-element -- signed media preview URL
            <img
              src={cover.previewUrl as string}
              alt=""
              className="size-full object-cover transition duration-500 group-hover:scale-105"
            />
          ) : (
            <>
              <div className="absolute inset-0 bg-[linear-gradient(145deg,rgba(255,255,255,0.055),transparent_48%,rgba(255,255,255,0.018))]" />
              <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.025)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.025)_1px,transparent_1px)] bg-[size:28px_28px] opacity-70" />
              <div className="absolute inset-0 grid place-items-center">
                <IconMovie className="size-9 text-white/16" stroke={1.4} />
              </div>
            </>
          )}

          <div className="absolute top-2.5 left-2.5 flex items-center gap-1.5">
            <span className="rounded-full bg-black/48 px-2.5 py-1 text-[10px] font-bold tracking-[0.06em] text-white/70 uppercase backdrop-blur-md">
              {t("projects.draft")}
            </span>
          </div>

          <div className="absolute right-2.5 bottom-2.5 left-2.5 flex items-center gap-1.5">
            <ProjectMetricChip
              icon={<IconMovie className="size-3" />}
              value={String(project.production.clipCount)}
              label={t("metrics.clips")}
            />
            <ProjectMetricChip
              icon={<IconSparkles className="size-3" />}
              value={`${project.production.currentVideoCount}/${project.production.clipCount}`}
              label={t("metrics.videos")}
            />
          </div>
        </div>

        <div className="p-3.5">
          <h3 className="truncate text-[15px] font-semibold tracking-[-0.01em] text-white">
            {project.title}
          </h3>
          <p className="mt-1 line-clamp-2 min-h-[34px] text-[12px] leading-[17px] font-medium text-white/56">
            {project.summary || t("projects.noSummary")}
          </p>
          <div className="mt-2.5 flex items-center justify-between gap-3">
            <p className="inline-flex shrink-0 items-center gap-1.5 text-[11px] font-medium text-white/40">
              <IconClock className="size-3" stroke={2} />
              {formatUpdatedAt(project.updatedAt, locale, t("projects.updatedUnknown"))}
            </p>
            <p className="flex min-w-0 items-center gap-1 text-[10px] font-medium text-white/38">
              <span className="truncate">
                {t("projects.videoProgress", {
                  current: project.production.currentVideoCount,
                  total: project.production.clipCount,
                })}
              </span>
              <IconArrowRight
                className="size-3 shrink-0 transition-transform group-hover:translate-x-0.5 group-hover:text-white/66"
                stroke={1.8}
              />
            </p>
          </div>
        </div>
      </Link>

      {canEdit || canAdmin ? (
        <DropdownMenu>
          <DropdownMenuTrigger
            aria-label={t("actions.projectMenu")}
            className="absolute top-2.5 right-2.5 z-10 grid size-8 place-items-center rounded-full bg-black/48 text-white/64 opacity-0 outline-none backdrop-blur-md transition hover:bg-black/65 hover:text-white group-hover:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100"
            onClick={(event) => event.preventDefault()}
          >
            <IconDots className="size-4" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {canEdit ? (
              <DropdownMenuItem onSelect={onEdit}>
                <IconEdit className="size-4" />
                {t("actions.editDetails")}
              </DropdownMenuItem>
            ) : null}
            {canAdmin ? (
              <DropdownMenuItem onSelect={onShare}>
                <IconUsers className="size-4" />
                {t("actions.share")}
              </DropdownMenuItem>
            ) : null}
            {canEdit && canAdmin ? <DropdownMenuSeparator /> : null}
            {project.canMove ? (
              <DropdownMenuItem onSelect={onMove}>
                <IconArrowRight className="size-4" />
                {t("move.action")}
              </DropdownMenuItem>
            ) : null}
            {canAdmin ? (
              <DropdownMenuItem variant="destructive" onSelect={onArchive}>
                <IconArchive className="size-4" />
                {t("actions.archive")}
              </DropdownMenuItem>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
    </div>
  );
}

function ProjectMetricChip({
  icon,
  value,
  label,
}: {
  icon: React.ReactNode;
  value: string;
  label: string;
}) {
  return (
    <span className="inline-flex min-w-0 items-center gap-1 rounded-full bg-black/52 px-2 py-1 text-[9px] font-semibold text-white/64 backdrop-blur-md">
      {icon}
      <span className="truncate">{label}</span>
      <span className="tabular-nums text-white/88">{value}</span>
    </span>
  );
}

function ProjectSkeletons() {
  return (
    <div className="mt-5 grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-4">
      {[0, 1, 2, 3].map((key) => (
        <div key={key} className="overflow-hidden rounded-[16px] bg-white/[0.05]">
          <Skeleton className="aspect-video w-full rounded-none" />
          <div className="space-y-2 p-3.5">
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-3 w-full" />
            <Skeleton className="h-3 w-3/4" />
          </div>
        </div>
      ))}
    </div>
  );
}

function EmptyProjects({ onCreate }: { onCreate?: () => void }) {
  const t = useTranslations("storyStudio");
  return (
    <div className="mt-5 flex min-h-64 flex-col items-center justify-center px-6 text-center">
      <div className="grid size-12 place-items-center rounded-2xl bg-white/[0.055] text-white/68">
        <IconGitBranch className="size-5" />
      </div>
      <h3 className="mt-4 text-sm font-semibold text-white">{t("empty.title")}</h3>
      <p className="mt-2 max-w-md text-xs leading-5 text-white/42">{t("empty.description")}</p>
      {onCreate && (
        <Button className="mt-5" variant="secondary" onClick={onCreate}>
          <IconPlus className="size-4" />
          {t("newProject")}
        </Button>
      )}
    </div>
  );
}

function CreateProjectDialog({
  workspaceId,
  open,
  onOpenChange,
  defaultLocale,
  onCreated,
}: {
  workspaceId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  defaultLocale: string;
  onCreated: (project: StoryProjectSummary) => void;
}) {
  const t = useTranslations("storyStudio");
  const [title, setTitle] = useState("");
  const [summary, setSummary] = useState("");
  const createMutation = useMutation({
    mutationFn: () =>
      createStoryProject({
        workspaceId,
        title: title.trim(),
        summary: summary.trim() || null,
        // Provisional only. FizzAgent confirms the authored story language as
        // part of the creative profile when the creator first asks it to work.
        defaultLocale,
        visibility: "private",
      }),
    onSuccess: (project) => {
      setTitle("");
      setSummary("");
      onOpenChange(false);
      onCreated(project);
    },
    onError: (error) => toast.error(storyApiErrorMessage(error, t("errors.createProject"))),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("create.title")}</DialogTitle>
          <DialogDescription>{t("create.description")}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <Field dense required label={t("fields.title")} htmlFor="story-create-title">
            <Input
              id="story-create-title"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              maxLength={160}
              autoFocus
              aria-required="true"
              placeholder={t("fields.titlePlaceholder")}
            />
          </Field>
          <Field dense label={t("fields.summary")} htmlFor="story-create-summary">
            <Textarea
              id="story-create-summary"
              value={summary}
              onChange={(event) => setSummary(event.target.value)}
              maxLength={2000}
              rows={4}
              placeholder={t("fields.summaryPlaceholder")}
            />
          </Field>
        </div>
        <DialogFooter className="pt-2">
          <Button
            variant="ghost"
            size="xl"
            className="sm:min-w-24"
            onClick={() => onOpenChange(false)}
          >
            {t("actions.cancel")}
          </Button>
          <Button
            variant="primary-cta"
            size="xl"
            className="sm:min-w-32"
            onClick={() => createMutation.mutate()}
            disabled={!title.trim() || createMutation.isPending}
          >
            {createMutation.isPending ? <IconLoader2 className="size-4 animate-spin" /> : null}
            {t("actions.create")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function EditProjectDialog({
  project,
  onOpenChange,
  onSaved,
}: {
  project: StoryProjectSummary;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}) {
  const t = useTranslations("storyStudio");
  const [title, setTitle] = useState(project.title);
  const [summary, setSummary] = useState(project.summary ?? "");
  const updateMutation = useMutation({
    mutationFn: () =>
      updateStoryProject(project.id, {
        expectedProjectVersion: project.projectVersion,
        title: title.trim(),
        summary: summary.trim() || null,
      }),
    onSuccess: () => {
      setTitle("");
      setSummary("");
      onSaved();
    },
    onError: (error) => toast.error(storyApiErrorMessage(error, t("errors.updateProject"))),
  });

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) {
          setTitle("");
          setSummary("");
        }
        onOpenChange(open);
      }}
    >
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("edit.title")}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <Field dense required label={t("fields.title")} htmlFor="story-edit-title">
            <Input
              id="story-edit-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={160}
              aria-required="true"
            />
          </Field>
          <Field dense label={t("fields.summary")} htmlFor="story-edit-summary">
            <Textarea
              id="story-edit-summary"
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
              maxLength={2000}
              rows={4}
            />
          </Field>
        </div>
        <DialogFooter className="pt-2">
          <Button
            variant="ghost"
            size="xl"
            className="sm:min-w-24"
            onClick={() => onOpenChange(false)}
          >
            {t("actions.cancel")}
          </Button>
          <Button
            variant="primary-cta"
            size="xl"
            className="sm:min-w-32"
            onClick={() => updateMutation.mutate()}
            disabled={!title.trim() || updateMutation.isPending}
          >
            {updateMutation.isPending ? <IconLoader2 className="size-4 animate-spin" /> : null}
            {t("actions.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ArchiveProjectDialog({
  project,
  onOpenChange,
  onArchived,
}: {
  project: StoryProjectSummary;
  onOpenChange: (open: boolean) => void;
  onArchived: () => void;
}) {
  const t = useTranslations("storyStudio");
  const archiveMutation = useMutation({
    mutationFn: () => archiveStoryProject(project.id, project.projectVersion),
    onSuccess: onArchived,
    onError: (error) => toast.error(storyApiErrorMessage(error, t("errors.archiveProject"))),
  });
  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("archive.title")}</DialogTitle>
          <DialogDescription>
            {t("archive.description", { title: project.title })}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {t("actions.cancel")}
          </Button>
          <Button
            variant="destructive"
            onClick={() => archiveMutation.mutate()}
            disabled={archiveMutation.isPending}
          >
            {archiveMutation.isPending ? <IconLoader2 className="size-4 animate-spin" /> : null}
            {t("actions.archive")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function formatUpdatedAt(input: string, locale: string, unknownLabel: string): string {
  const timestamp = Date.parse(input);
  if (!Number.isFinite(timestamp)) return unknownLabel;
  const deltaSeconds = Math.round((timestamp - Date.now()) / 1000);
  const formatter = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  if (Math.abs(deltaSeconds) < 60) return formatter.format(deltaSeconds, "second");
  const minutes = Math.round(deltaSeconds / 60);
  if (Math.abs(minutes) < 60) return formatter.format(minutes, "minute");
  const hours = Math.round(minutes / 60);
  if (Math.abs(hours) < 24) return formatter.format(hours, "hour");
  return formatter.format(Math.round(hours / 24), "day");
}
