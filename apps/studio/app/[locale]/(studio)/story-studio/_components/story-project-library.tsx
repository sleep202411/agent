"use client";

import { useCallback, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  IconArchive,
  IconArrowRight,
  IconClock,
  IconDeviceMobile,
  IconDots,
  IconEdit,
  IconFileText,
  IconGitBranch,
  IconLoader2,
  IconMovie,
  IconPhoto,
  IconPlus,
  IconRefresh,
  IconRectangle,
  IconSparkles,
} from "@tabler/icons-react";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import { useWorkspace } from "@/app/_components/workspace-context";
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
  type CreatableStoryFormat,
  type StoryFrameProfile,
  type StoryProjectSummary,
} from "@/lib/story-projects-api";
import { StoryStudioHero } from "./story-studio-hero";

const STORY_PROJECTS_QUERY = ["story-studio", "projects"] as const;
const JINLING_SOURCE_TITLE = "金陵入梦";
const JINLING_FEATURE_TAGS = ["interactive_film", "classical_literature", "mystery"] as const;

export function StoryProjectLibrary({ featuredPlayerHref }: { featuredPlayerHref: string }) {
  const t = useTranslations("storyStudio");
  const locale = useLocale();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { activeWorkspace, loading: workspaceLoading } = useWorkspace();
  const workspaceId = activeWorkspace?.id ?? null;
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<StoryProjectSummary | null>(null);
  const [archiving, setArchiving] = useState<StoryProjectSummary | null>(null);

  const projectsQuery = useQuery({
    queryKey: [...STORY_PROJECTS_QUERY, workspaceId],
    queryFn: () => listStoryProjects(workspaceId as string, { limit: 100 }),
    enabled: Boolean(workspaceId),
    retry: false,
  });

  const projects = projectsQuery.data?.items ?? [];
  const isLoading = workspaceLoading || (Boolean(workspaceId) && projectsQuery.isLoading);
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
      <section
        id="story-projects"
        className="relative z-20 pr-6 pb-16 pl-6 pt-12 sm:pl-20 lg:pl-[120px]"
      >
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
              onClick={() => setCreateOpen(true)}
              disabled={!workspaceId}
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
              <EmptyProjects onCreate={() => setCreateOpen(true)} />
            ) : (
              <div className="mt-5 grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-4">
                {projects.map((project) => (
                  <StoryProjectCard
                    key={project.id}
                    project={project}
                    locale={locale}
                    onEdit={() => setEditing(project)}
                    onArchive={() => setArchiving(project)}
                  />
                ))}
              </div>
            )}
          </section>
        </div>

        <CreateProjectDialog
          open={createOpen}
          onOpenChange={setCreateOpen}
          workspaceId={workspaceId}
          defaultLocale={locale}
          onCreated={(project) => {
            void refresh();
            router.push(`/story-studio/projects/${project.id}/canvas`);
          }}
        />
        {editing ? (
          <EditProjectDialog
            key={`${editing.id}:${editing.projectVersion}`}
            project={editing}
            workspaceId={workspaceId as string}
            onOpenChange={(open) => !open && setEditing(null)}
            onSaved={() => {
              setEditing(null);
              void refresh();
            }}
          />
        ) : null}
        {archiving ? (
          <ArchiveProjectDialog
            project={archiving}
            workspaceId={workspaceId as string}
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
  onArchive,
}: {
  project: StoryProjectSummary;
  locale: string;
  onEdit: () => void;
  onArchive: () => void;
}) {
  const t = useTranslations("storyStudio");
  const canEdit = project.capabilities.includes("story.edit");
  const canAdmin = project.capabilities.includes("story.admin");

  const coverUrl = project.cover?.previewUrl ?? null;
  const isTextFirstWithoutVideo =
    project.format === "text_adventure" && project.production.clipCount === 0;

  return (
    <div className="group relative min-w-0">
      <Link
        href={`/story-studio/projects/${project.id}/canvas`}
        className="relative block overflow-hidden rounded-[16px] bg-white/[0.05] shadow-[0_18px_42px_rgba(0,0,0,0.32)] outline-none transition duration-200 hover:-translate-y-1 hover:bg-white/[0.08] hover:shadow-[0_26px_70px_rgba(0,0,0,0.44)] focus-visible:ring-2 focus-visible:ring-white/50"
      >
        <div className="relative aspect-video overflow-hidden bg-[#171819]">
          {coverUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- signed media preview URL
            <img
              src={coverUrl}
              alt=""
              className="size-full object-cover transition duration-500 group-hover:scale-105"
            />
          ) : (
            <>
              <div className="absolute inset-0 bg-[linear-gradient(145deg,rgba(255,255,255,0.055),transparent_48%,rgba(255,255,255,0.018))]" />
              <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.025)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.025)_1px,transparent_1px)] bg-[size:28px_28px] opacity-70" />
              <div className="absolute inset-0 grid place-items-center">
                {project.format === "text_adventure" ? (
                  <IconFileText className="size-9 text-white/16" stroke={1.4} />
                ) : (
                  <IconMovie className="size-9 text-white/16" stroke={1.4} />
                )}
              </div>
            </>
          )}

          <div className="absolute top-2.5 left-2.5 flex items-center gap-1.5">
            <span className="rounded-full bg-black/48 px-2.5 py-1 text-[10px] font-bold tracking-[0.06em] text-white/70 uppercase backdrop-blur-md">
              {t("projects.draft")}
            </span>
            <span className="rounded-full bg-black/48 px-2.5 py-1 text-[10px] font-semibold text-white/78 backdrop-blur-md">
              {t(`formats.${project.format}.label`)}
            </span>
          </div>

          <div className="absolute right-2.5 bottom-2.5 left-2.5 flex items-center gap-1.5">
            {isTextFirstWithoutVideo ? (
              <ProjectStateChip
                icon={<IconFileText className="size-3" />}
                label={t("projects.textFirstWithoutVideo")}
              />
            ) : (
              <>
                <ProjectMetricChip
                  icon={<IconPhoto className="size-3" />}
                  value={`${project.production.approvedReferenceCount}/${project.production.referenceSlotCount}`}
                  label={t("metrics.references")}
                />
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
              </>
            )}
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
                {isTextFirstWithoutVideo
                  ? t("projects.textFirstProgress")
                  : project.production.generatingClipCount > 0
                    ? t("projects.generating", { count: project.production.generatingClipCount })
                    : t("projects.videoProgress", {
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
            {canEdit && canAdmin ? <DropdownMenuSeparator /> : null}
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

function ProjectStateChip({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <span className="inline-flex min-w-0 items-center gap-1 rounded-full bg-black/52 px-2 py-1 text-[9px] font-semibold text-white/72 backdrop-blur-md">
      {icon}
      <span className="truncate">{label}</span>
    </span>
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

function EmptyProjects({ onCreate }: { onCreate: () => void }) {
  const t = useTranslations("storyStudio");
  return (
    <FrostedPanel className="mt-5 flex min-h-64 flex-col items-center justify-center px-6 text-center">
      <div className="grid size-12 place-items-center rounded-2xl bg-white/[0.055] text-white/68">
        <IconGitBranch className="size-5" />
      </div>
      <h3 className="mt-4 text-sm font-semibold text-white">{t("empty.title")}</h3>
      <p className="mt-2 max-w-md text-xs leading-5 text-white/42">{t("empty.description")}</p>
      <Button className="mt-5" variant="secondary" onClick={onCreate}>
        <IconPlus className="size-4" />
        {t("newProject")}
      </Button>
    </FrostedPanel>
  );
}

function CreateProjectDialog({
  open,
  onOpenChange,
  workspaceId,
  defaultLocale,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspaceId: string | null;
  defaultLocale: string;
  onCreated: (project: StoryProjectSummary) => void;
}) {
  const t = useTranslations("storyStudio");
  const [title, setTitle] = useState("");
  const [summary, setSummary] = useState("");
  const [format, setFormat] = useState<CreatableStoryFormat>("interactive_film");
  const [frameProfile, setFrameProfile] = useState<StoryFrameProfile | null>(null);
  // A text-first project sets no frame profile at all; a film project requires one.
  const requiresFrameProfile = format === "interactive_film";
  const createMutation = useMutation({
    mutationFn: () => {
      if (!workspaceId || (requiresFrameProfile && !frameProfile)) {
        throw new Error(t("errors.createProject"));
      }
      return createStoryProject(workspaceId, {
        format,
        ...(requiresFrameProfile && frameProfile ? { frameProfile } : {}),
        title: title.trim(),
        summary: summary.trim() || null,
        defaultLocale,
        visibility: "private",
      });
    },
    onSuccess: (project) => {
      setTitle("");
      setSummary("");
      setFormat("interactive_film");
      setFrameProfile(null);
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
          <label className="block space-y-2">
            <span className="text-xs font-medium text-white/58">{t("fields.title")}</span>
            <Input
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              maxLength={160}
              autoFocus
              placeholder={t("fields.titlePlaceholder")}
            />
          </label>
          <label className="block space-y-2">
            <span className="text-xs font-medium text-white/58">{t("fields.summary")}</span>
            <Textarea
              value={summary}
              onChange={(event) => setSummary(event.target.value)}
              maxLength={2000}
              rows={4}
              placeholder={t("fields.summaryPlaceholder")}
            />
          </label>
          <fieldset className="space-y-2">
            <legend className="text-xs font-medium text-white/58">
              {t("fields.primaryExperience")}
            </legend>
            <p className="text-[11px] leading-4 text-white/38">
              {t("fields.primaryExperienceHint")}
            </p>
            <div className="grid grid-cols-2 gap-2" role="radiogroup">
              <FormatOption
                format="interactive_film"
                selected={format === "interactive_film"}
                icon={<IconMovie className="size-5" stroke={1.7} />}
                onSelect={setFormat}
              />
              <FormatOption
                format="text_adventure"
                selected={format === "text_adventure"}
                icon={<IconFileText className="size-5" stroke={1.7} />}
                onSelect={(next) => {
                  setFormat(next);
                  // A text-first project has no frame contract; drop any picked
                  // profile so it is never sent in the create payload.
                  if (next === "text_adventure") setFrameProfile(null);
                }}
              />
            </div>
          </fieldset>
          {requiresFrameProfile ? (
            <fieldset className="space-y-2">
              <legend className="text-xs font-medium text-white/58">
                {t("fields.frameProfile")}
              </legend>
              <p className="text-[11px] leading-4 text-white/38">{t("fields.frameProfileHint")}</p>
              <div className="grid grid-cols-2 gap-2" role="radiogroup">
                <FrameProfileOption
                  profile="landscape_16_9"
                  selected={frameProfile === "landscape_16_9"}
                  icon={<IconRectangle className="size-5" stroke={1.7} />}
                  onSelect={setFrameProfile}
                />
                <FrameProfileOption
                  profile="portrait_9_16"
                  selected={frameProfile === "portrait_9_16"}
                  icon={<IconDeviceMobile className="size-5" stroke={1.7} />}
                  onSelect={setFrameProfile}
                />
              </div>
            </fieldset>
          ) : null}
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
            size="xl"
            className="sm:min-w-32"
            onClick={() => createMutation.mutate()}
            disabled={
              !workspaceId ||
              !title.trim() ||
              (requiresFrameProfile && !frameProfile) ||
              createMutation.isPending
            }
          >
            {createMutation.isPending ? <IconLoader2 className="size-4 animate-spin" /> : null}
            {t("actions.create")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function FormatOption({
  format,
  selected,
  icon,
  onSelect,
}: {
  format: CreatableStoryFormat;
  selected: boolean;
  icon: React.ReactNode;
  onSelect: (format: CreatableStoryFormat) => void;
}) {
  const t = useTranslations("storyStudio");
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      className={`flex min-h-24 flex-col rounded-xl px-3.5 py-3 text-left outline-none transition focus-visible:ring-2 focus-visible:ring-white/50 ${
        selected
          ? "bg-white text-black shadow-[0_14px_32px_rgba(0,0,0,0.3)]"
          : "bg-white/[0.055] text-white/58 hover:bg-white/[0.085] hover:text-white/82"
      }`}
      onClick={() => onSelect(format)}
    >
      <span className={selected ? "text-black/72" : "text-white/48"}>{icon}</span>
      <span className="mt-3 block text-xs font-semibold">{t(`formats.${format}.label`)}</span>
      <span
        className={`mt-1 block text-[10px] leading-4 font-medium ${
          selected ? "text-black/56" : "text-white/38"
        }`}
      >
        {t(`formats.${format}.description`)}
      </span>
    </button>
  );
}

function FrameProfileOption({
  profile,
  selected,
  icon,
  onSelect,
}: {
  profile: StoryFrameProfile;
  selected: boolean;
  icon: React.ReactNode;
  onSelect: (profile: StoryFrameProfile) => void;
}) {
  const t = useTranslations("storyStudio");
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      className={`flex min-h-24 flex-col justify-between rounded-xl px-3.5 py-3 text-left outline-none transition focus-visible:ring-2 focus-visible:ring-white/50 ${
        selected
          ? "bg-white text-black shadow-[0_14px_32px_rgba(0,0,0,0.3)]"
          : "bg-white/[0.055] text-white/58 hover:bg-white/[0.085] hover:text-white/82"
      }`}
      onClick={() => onSelect(profile)}
    >
      <span className={selected ? "text-black/72" : "text-white/48"}>{icon}</span>
      <span className="mt-3 block">
        <span className="block text-xs font-semibold">{t(`frameProfiles.${profile}.label`)}</span>
        <span
          className={`mt-0.5 block text-[10px] font-medium tabular-nums ${
            selected ? "text-black/54" : "text-white/36"
          }`}
        >
          {t(`frameProfiles.${profile}.dimensions`)}
        </span>
      </span>
    </button>
  );
}

function EditProjectDialog({
  project,
  workspaceId,
  onOpenChange,
  onSaved,
}: {
  project: StoryProjectSummary;
  workspaceId: string;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}) {
  const t = useTranslations("storyStudio");
  const [title, setTitle] = useState(project.title);
  const [summary, setSummary] = useState(project.summary ?? "");
  const updateMutation = useMutation({
    mutationFn: () =>
      updateStoryProject(workspaceId, project.id, {
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
          <label className="block space-y-2">
            <span className="text-xs font-medium text-white/58">{t("fields.title")}</span>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} />
          </label>
          <label className="block space-y-2">
            <span className="text-xs font-medium text-white/58">{t("fields.summary")}</span>
            <Textarea value={summary} onChange={(e) => setSummary(e.target.value)} rows={4} />
          </label>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {t("actions.cancel")}
          </Button>
          <Button
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
  workspaceId,
  onOpenChange,
  onArchived,
}: {
  project: StoryProjectSummary;
  workspaceId: string;
  onOpenChange: (open: boolean) => void;
  onArchived: () => void;
}) {
  const t = useTranslations("storyStudio");
  const archiveMutation = useMutation({
    mutationFn: () => archiveStoryProject(workspaceId, project.id, project.projectVersion),
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
