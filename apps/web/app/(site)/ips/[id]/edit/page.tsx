"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { useParams } from "next/navigation";
import {
  IconBookmark,
  IconCoin,
  IconFileText,
  IconLoader2,
  IconPlaylist,
  IconPlus,
  IconShoppingBag,
  IconTrash,
  IconUpload,
  IconUsers,
  IconVideo,
  IconX,
} from "@tabler/icons-react";
import { DragDropProvider } from "@dnd-kit/react";
import { toast } from "sonner";
import { useTranslations } from "@/src/i18n/i18n";
import { cn } from "@/lib/utils";
import { UserAvatar } from "@/components/user-avatar";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { VideoPlayer } from "@/components/media/video-player";
import { env } from "@/src/env";
import {
  useProjectDetail,
  useUpdateProject,
  useProjectVideoLink,
  useUploadProjectVideo,
  useProjectEpisodes,
  useCreateEpisode,
  useUpdateEpisode,
  useReorderEpisode,
  useProjectMembers,
  useAddMember,
  useRemoveMember,
  useFAQs,
  useCreateFAQ,
  useUpdateFAQ,
  useDeleteFAQ,
  useLegacyJobsByRole,
  ipKeys,
  ipImageUrl,
  userAvatarUrl,
  MEMBER_ROLE,
  useProjectRoles,
  type Episode,
  type FAQ,
  type ProjectMember,
  type ProjectRole,
} from "@/app/(site)/ips/_hooks/use-ip";
import { useQueryClient } from "@tanstack/react-query";
import { useTagList } from "@/src/hooks/use-tag-list";
import { useIPTypes } from "@/app/(site)/ips/_hooks/use-ip-list";
import { uploadIPBanner } from "@/app/(site)/ips/_hooks/uploads";
import { AddMemberDialog, type NewMember } from "./add-member-dialog";
import { EpisodeDialog, type EpisodeDraft } from "./episode-dialog";
import { SortableEpisodeRow } from "./episode-row";
import { FaqDialog, type FaqDraft } from "./faq-dialog";
import { SortableFaqRow } from "./faq-row";
import { EditHero } from "./edit-hero";
import { PricingTab } from "./_pricing/pricing-tab";
import { MerchandiseTab } from "./_merchandise/merchandise-tab";
import { useLocale } from "@/src/i18n/i18n";
import { SparkDialog } from "./spark-dialog";

// ─── Member row ────────────────────────────────────
// Stateless presentation row for a team member: avatar + name + role
// badge + remark + remove. The page provides labels because i18n lives
// at the page boundary; helpers below map the wire `role` integer to a
// label and a colour.
function MemberRow({
  member,
  roleLabel,
  roleTone,
  canRemove,
  onRemove,
  labels,
}: {
  member: ProjectMember;
  roleLabel: string;
  roleTone: string;
  canRemove: boolean;
  onRemove: () => void;
  labels: { remove: string };
}) {
  const display = member.nickName || member.userName || member.id || `#${member.userId ?? "?"}`;
  const avatar = userAvatarUrl(member.avatar);
  return (
    <div className="flex items-center gap-3 rounded-xl border border-border bg-card p-3">
      <UserAvatar
        src={avatar}
        seed={member.userId}
        name={String(display)}
        className="size-10 shrink-0"
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-medium text-foreground">{display}</span>
          <span
            className={cn(
              "shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ring-1 ring-inset",
              roleTone
            )}
          >
            {roleLabel}
          </span>
        </div>
        {member.remark && (
          <p className="mt-0.5 line-clamp-1 text-xs text-muted-foreground">{member.remark}</p>
        )}
      </div>
      {canRemove && (
        <Button
          variant="ghost"
          size="icon-xs"
          onClick={onRemove}
          className="text-muted-foreground hover:bg-red-500/10 hover:text-red-500"
          aria-label={labels.remove}
        >
          <IconTrash className="size-3.5" />
        </Button>
      )}
    </div>
  );
}

function getRoleLabel(
  role: number | undefined,
  roles: ProjectRole[],
  t: (k: string) => string
): string {
  // Prefer the backend-supplied role name when the catalog has it. Fall
  // back to the legacy hard-coded labels for projects whose role list
  // hasn't loaded yet (or for owner/admin synthesized client-side).
  if (role !== undefined) {
    const fromCatalog = roles.find((r) => r.id === role);
    if (fromCatalog) return fromCatalog.name;
  }
  if (role === MEMBER_ROLE.OWNER) return t("roleOwner");
  if (role === MEMBER_ROLE.ADMIN) return t("roleAdmin");
  return t("roleMember");
}

function getRoleTone(role: number | undefined): string {
  if (role === MEMBER_ROLE.OWNER) return "bg-amber-500/15 text-amber-300 ring-amber-500/30";
  if (role === MEMBER_ROLE.ADMIN) return "bg-violet-500/15 text-violet-300 ring-violet-500/30";
  return "bg-muted/60 text-muted-foreground ring-border";
}

// ─── Episode → dialog adapter ──────────────────────
// Episode (server shape) carries id / sort / createdAt / projectId; the
// dialog only needs the editable subset. videoLink (wire) round-trips
// unchanged so non-attachment edits don't null the field; videoUrl
// (display) starts empty and the dialog resolves it via
// `useEpisodeVideoLink(ep.id)` for playback.
function episodeToDraft(ep: Episode | undefined): EpisodeDraft | null {
  if (!ep) return null;
  return {
    title: ep.title,
    description: ep.description,
    videoLink: ep.videoLink,
    videoUrl: "",
    videoBanner: ep.videoBanner,
    coverUrl: ipImageUrl(ep.videoBanner),
    duration: ep.duration,
    // Backend doesn't currently echo these on the Episode shape; the
    // dialog's auto-probe effect re-derives width/height from the video
    // URL on open. Size is only knowable when the user re-uploads.
    width: 0,
    height: 0,
    size: 0,
  };
}

// ─── Tabs ────────────────────────────────────────────

const TABS = [
  { id: "basic", labelKey: "editBasic", icon: IconFileText },
  { id: "trailer", labelKey: "editTrailer", icon: IconVideo },
  { id: "episodes", labelKey: "editEpisodes", icon: IconPlaylist },
  // Pricing tab is feature-gated until the community-score / unlock
  // endpoints ship on the backend. UI is fully built and exercises a
  // mock data layer (see ips/_hooks/pricing-mock.ts); flip `disabled`
  // to false once real wires are in place.
  { id: "pricing", labelKey: "editPricing", icon: IconCoin, disabled: true },
  // Merchandise tab is feature-gated alongside Pricing. The full CRUD
  // UI is built and exercises a mock data layer (see
  // ips/_hooks/merchandise-mock.ts); flip `disabled` to false once
  // backend ships the matching endpoints and the storefront is ready
  // for owner-side use.
  { id: "merchandise", labelKey: "editMerchandise", icon: IconShoppingBag, disabled: true },
  { id: "team", labelKey: "editTeam", icon: IconUsers },
  { id: "faq", labelKey: "editFAQ", icon: IconFileText },
] as const;

/**
 * Optional 6th tab — only injected when the legacy
 * `/project/job/project/list` endpoint returns rows for this project.
 * Pre-existing projects with hiring data on the old shape need a
 * surface to view it; brand-new projects never have legacy data so
 * the tab stays hidden and the nav reads as before.
 */
const LEGACY_JOBS_TAB = {
  id: "jobs" as const,
  labelKey: "editJobRecruitment" as const,
  icon: IconBookmark,
};

// ─── Form type ──────────────────────────────────────

interface EditForm {
  title: string;
  typeId: string;
  description: string;
  background: string;
  bannerLink: string;
  contact: string;
  tags: string[];
  // Future tabs
  promoVideo: string | null;
  // Trailer tab — local preview URL (resolved from project.bannerLink).
  coverImage: string | null;
}

const EMPTY_FORM: EditForm = {
  title: "",
  typeId: "",
  description: "",
  background: "",
  bannerLink: "",
  contact: "",
  tags: [],
  promoVideo: null,
  coverImage: null,
};

// ─── Two-column section layout ──────────────────────

function Section({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid grid-cols-1 gap-8 border-b border-border py-10 last:border-b-0 md:grid-cols-[1fr_2fr]">
      <div>
        <h3 className="text-sm font-bold text-foreground">{title}</h3>
        {description && (
          <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">{description}</p>
        )}
      </div>
      <div className="space-y-4">{children}</div>
    </div>
  );
}

// ─── Component ───────────────────────────────────────

export default function IPEditPage() {
  const { id } = useParams<{ id: string }>();
  const locale = useLocale();
  const t = useTranslations("ipEdit");
  const tc = useTranslations("common");
  const tEp = useTranslations("episode");
  const [activeTab, setActiveTab] = useState("basic");
  const [form, setForm] = useState<EditForm>(EMPTY_FORM);
  const [saved, setSaved] = useState(false);
  const [addMemberOpen, setAddMemberOpen] = useState(false);
  // Episode dialog: null = closed, -1 = creating, otherwise editing index
  const [episodeDialogIndex, setEpisodeDialogIndex] = useState<number | null>(null);
  // Episode delete confirm: backend isn't wired yet, so confirm just
  // pins the action button into a permanent loading state until the
  // user dismisses the dialog.
  const [deleteEpisodeIndex, setDeleteEpisodeIndex] = useState<number | null>(null);
  const [deletingEpisode, setDeletingEpisode] = useState(false);

  const { data: tagList } = useTagList();
  const { data: typeList } = useIPTypes();
  const { data: project, isLoading } = useProjectDetail(id);
  const { mutate: doUpdate, isPending: saving } = useUpdateProject();
  const { data: videoLink } = useProjectVideoLink(id, !!project?.videoLink);
  const { mutate: doUploadVideo, isPending: uploadingVideo } = useUploadProjectVideo();
  // Legacy job-recruitment compat — only surface the optional 6th tab
  // when historical data exists for this project. See useLegacyJobsByRole.
  const { data: legacyJobs = [] } = useLegacyJobsByRole(id);
  const visibleTabs = legacyJobs.length > 0 ? [...TABS, LEGACY_JOBS_TAB] : TABS;
  const videoInputRef = useRef<HTMLInputElement>(null);
  const coverInputRef = useRef<HTMLInputElement>(null);
  const [uploadingCover, setUploadingCover] = useState(false);

  // Episode CRUD — `useProjectEpisodes` is the single source of truth for
  // the list shown below; mutations invalidate `ipKeys.episodes(id)` so the
  // list refetches after every change. No local form mirror — episodes
  // persist independently of the IP-save button.
  const queryClient = useQueryClient();
  const { data: episodes = [] } = useProjectEpisodes(id);
  const { mutateAsync: createEpisodeMut } = useCreateEpisode();
  const { mutateAsync: updateEpisodeMut } = useUpdateEpisode();
  const { mutate: reorderEpisodeMut } = useReorderEpisode();

  // Team CRUD — list shipped, add/remove via dialog + per-row delete.
  const { data: members = [] } = useProjectMembers(id);
  const { data: roleCatalog = [] } = useProjectRoles();
  const { mutateAsync: addMemberMut } = useAddMember();
  const { mutate: removeMemberMut } = useRemoveMember();
  const [addingMember, setAddingMember] = useState(false);

  // FAQ CRUD — `useFAQs` is the source of truth. The dialog owns the
  // edit form; `faqDialogIndex` tracks which row is open (-1 = creating,
  // >=0 = editing). The expanded-answer accordion is independent.
  const { data: faqs = [] } = useFAQs(id);
  const { mutateAsync: createFAQMut } = useCreateFAQ();
  const { mutateAsync: updateFAQMut } = useUpdateFAQ();
  const { mutate: deleteFAQMut } = useDeleteFAQ();
  const [faqDialogOpen, setFaqDialogOpen] = useState(false);
  const [faqDialogIndex, setFaqDialogIndex] = useState<number | null>(null);

  // Spark — AI brief analyzer. Lives behind a single dialog driven by
  // `sparkOpen`. Result is a patch the dialog hands back via `onApply`,
  // which we splice into form state without auto-saving (the hero's
  // Save button is the explicit commit point).
  const [sparkOpen, setSparkOpen] = useState(false);

  // Lifecycle transitions (5 = approved / 3 = rejected / 8 = taken
  // down) are admin-only. Users can only save edits, which the backend
  // resets `projectStatus` to 0 (pending review) automatically. The
  // hero's Save button gates this via its own confirm dialog.

  // Populate form when project data loads
  useEffect(() => {
    if (!project) return;
    const parseTags = (tag: unknown): string[] => {
      if (!tag) return [];
      try {
        const parsed = JSON.parse(String(tag));
        return Array.isArray(parsed) ? parsed.map(String) : [];
      } catch {
        return String(tag).split(",").filter(Boolean);
      }
    };
    setForm((prev) => ({
      ...prev,
      title: project.name ?? "",
      typeId: String(project.typeId ?? ""),
      description: project.description ?? "",
      background: project.background ?? "",
      bannerLink: project.bannerLink ?? "",
      contact: project.contact ?? "",
      tags: parseTags(project.tag),
      coverImage: project.bannerLink
        ? project.bannerLink.startsWith("http")
          ? project.bannerLink
          : `${env.BANNER_BASE_URL}/${project.bannerLink}`
        : null,
    }));
  }, [project]);

  const update = useCallback((patch: Partial<EditForm>) => {
    setForm((prev) => ({ ...prev, ...patch }));
    setSaved(false);
  }, []);

  // Drag-reorder buffer: dnd-kit fires onDragOver continuously; we batch
  // the latest projected order and commit a single reorder mutation in
  // onDragEnd. The optimistic setQueryData lets the UI reflect the new
  // order immediately; if the backend call fails, the next refetch
  // restores authoritative state. `originalRef` snapshots the order at
  // drag-start so onDragEnd can diff against it (the live `episodes` value
  // already reflects the optimistic mutation by then).
  //
  // These hooks must live above the `if (isLoading) return …` guard so
  // the hook order stays stable across renders (Rules of Hooks).
  const pendingReorderRef = useRef<Episode[] | null>(null);
  const originalReorderRef = useRef<Episode[] | null>(null);
  const handleEpisodeDragOver = useCallback(
    (event: unknown) => {
      const op = (
        event as {
          operation?: { source?: { id: string | number }; target?: { id: string | number } };
        }
      ).operation;
      const source = op?.source;
      const target = op?.target;
      if (!source || !target || source.id === target.id) return;
      if (originalReorderRef.current === null) {
        originalReorderRef.current = episodes;
      }
      const list = pendingReorderRef.current ?? originalReorderRef.current ?? episodes;
      const fromIndex = Number(source.id);
      const toIndex = Number(target.id);
      if (
        Number.isNaN(fromIndex) ||
        Number.isNaN(toIndex) ||
        fromIndex < 0 ||
        toIndex < 0 ||
        fromIndex === toIndex
      ) {
        return;
      }
      const next = [...list];
      const [moved] = next.splice(fromIndex, 1);
      next.splice(toIndex, 0, moved);
      pendingReorderRef.current = next;
      // Optimistic: paint the new order before the mutation lands.
      queryClient.setQueryData(ipKeys.episodes(id), next);
    },
    [episodes, id, queryClient]
  );
  const handleEpisodeDragEnd = useCallback(() => {
    const finalOrder = pendingReorderRef.current;
    const original = originalReorderRef.current;
    pendingReorderRef.current = null;
    originalReorderRef.current = null;
    if (!finalOrder || !original) return;
    const movedIndex = finalOrder.findIndex((ep, i) => ep.id !== original[i]?.id);
    if (movedIndex === -1) return;
    const moved = finalOrder[movedIndex];
    // Backend convention: the moved video lands BEFORE the next neighbour;
    // omit `beforeVideoId` when dropped at the tail.
    const next = finalOrder[movedIndex + 1];
    reorderEpisodeMut({
      currentVideoId: moved.id,
      beforeVideoId: next?.id,
      projectId: id,
    });
  }, [id, reorderEpisodeMut]);

  // FAQ drag-reorder — same optimistic pattern as Episodes, but the
  // backend has no dedicated reorder endpoint. We persist the new order
  // by re-issuing `/project/faq/update` with the row's new `sort` index
  // for every row whose position actually changed.
  const pendingFaqReorderRef = useRef<FAQ[] | null>(null);
  const originalFaqReorderRef = useRef<FAQ[] | null>(null);
  const handleFaqDragOver = useCallback(
    (event: unknown) => {
      const op = (
        event as {
          operation?: { source?: { id: string | number }; target?: { id: string | number } };
        }
      ).operation;
      const source = op?.source;
      const target = op?.target;
      if (!source || !target || source.id === target.id) return;
      if (originalFaqReorderRef.current === null) {
        originalFaqReorderRef.current = faqs;
      }
      const list = pendingFaqReorderRef.current ?? originalFaqReorderRef.current ?? faqs;
      // Sortable rows are keyed by faqId (stable across reorders), so we
      // map the dnd-kit ids back to current indexes by faqId lookup.
      const sourceId = String(source.id);
      const targetId = String(target.id);
      const fromIndex = list.findIndex((f) => String(f.faqId) === sourceId);
      const toIndex = list.findIndex((f) => String(f.faqId) === targetId);
      if (fromIndex < 0 || toIndex < 0 || fromIndex === toIndex) return;
      const next = [...list];
      const [moved] = next.splice(fromIndex, 1);
      next.splice(toIndex, 0, moved);
      pendingFaqReorderRef.current = next;
      queryClient.setQueryData(ipKeys.faqs(id), next);
    },
    [faqs, id, queryClient]
  );
  const handleFaqDragEnd = useCallback(() => {
    const finalOrder = pendingFaqReorderRef.current;
    const original = originalFaqReorderRef.current;
    pendingFaqReorderRef.current = null;
    originalFaqReorderRef.current = null;
    if (!finalOrder || !original) return;
    if (finalOrder.every((f, i) => f.faqId === original[i]?.faqId)) return;
    // Persist by updating every row whose new index changed its sort.
    void Promise.all(
      finalOrder.map((faq, idx) => {
        if (faq.sort === idx) return null;
        return updateFAQMut({
          faqId: faq.faqId,
          projectId: faq.projectId,
          question: faq.question,
          answer: faq.answer,
          sort: idx,
        });
      })
    ).catch((err) => {
      toast.error(err instanceof Error && err.message ? err.message : tc("saveFailed"));
      // Refetch authoritative state on failure.
      queryClient.invalidateQueries({ queryKey: ipKeys.faqs(id) });
    });
  }, [id, queryClient, tc, updateFAQMut]);

  const handleSave = () => {
    if (!form.title.trim()) {
      toast.warning(t("nameRequired"));
      return;
    }
    doUpdate(
      {
        id: Number(id),
        name: form.title.trim(),
        typeId: form.typeId,
        description: form.description,
        background: form.background,
        bannerLink: form.bannerLink,
        contact: form.contact,
        tag: JSON.stringify(form.tags.map(Number).filter(Boolean)),
      },
      {
        onSuccess: () => {
          toast.success(t("saveSuccess"));
          setSaved(true);
          setTimeout(() => setSaved(false), 2000);
        },
        onError: () => toast.error(t("saveFailed")),
      }
    );
  };

  if (isLoading) {
    return (
      <div className="flex h-[calc(100vh-3.5rem)] items-center justify-center">
        <IconLoader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  // Tag helpers
  const addTag = (tag: string) => {
    const trimmed = tag.trim();
    if (!trimmed || form.tags.length >= 10 || form.tags.includes(trimmed)) return;
    update({ tags: [...form.tags, trimmed] });
  };
  const removeTag = (tag: string) => update({ tags: form.tags.filter((t) => t !== tag) });

  // Episode helpers — backed by mutation hooks; the list above refetches
  // automatically on success via `ipKeys.episodes(id)` invalidation.
  const removeEpisode = (i: number) => {
    setDeleteEpisodeIndex(i);
  };
  const upsertEpisode = async (i: number | null, next: EpisodeDraft): Promise<void> => {
    const videoMeta = {
      duration: next.duration,
      width: next.width || undefined,
      height: next.height || undefined,
      size: next.size || undefined,
    };

    if (i === null || i < 0) {
      await createEpisodeMut({
        projectId: id,
        title: next.title,
        description: next.description,
        videoLink: next.videoLink,
        videoBanner: next.videoBanner,
        videoMeta,
      });
      toast.success(tc("saveSuccess"));
      return;
    }
    const target = episodes[i];
    if (!target) return;
    await updateEpisodeMut({
      id: target.id,
      projectId: id,
      title: next.title,
      description: next.description,
      videoLink: next.videoLink,
      videoBanner: next.videoBanner,
      videoMeta,
    });
    toast.success(tc("saveSuccess"));
  };
  // FAQ helpers — dialog-driven create/edit. `upsertFaq` resolves on
  // success so the dialog can close itself and reject on failure so the
  // dialog surfaces the inline error.
  const openFaqCreate = () => {
    setFaqDialogIndex(-1);
    setFaqDialogOpen(true);
  };
  const openFaqEdit = (i: number) => {
    setFaqDialogIndex(i);
    setFaqDialogOpen(true);
  };
  const upsertFaq = async (i: number | null, next: FaqDraft): Promise<void> => {
    if (i === null || i < 0) {
      await createFAQMut({
        projectId: Number(id),
        question: next.question,
        answer: next.answer,
      });
      toast.success(tc("saveSuccess"));
      return;
    }
    const target = faqs[i];
    if (!target) return;
    await updateFAQMut({
      faqId: target.faqId,
      projectId: target.projectId,
      question: next.question,
      answer: next.answer,
      sort: target.sort,
    });
    toast.success(tc("saveSuccess"));
  };
  const removeFaq = (i: number) => {
    const target = faqs[i];
    if (!target) return;
    deleteFAQMut(
      { faqId: target.faqId, projectId: target.projectId },
      {
        onSuccess: () => toast.success(tc("deleteSuccess")),
        onError: (err) =>
          toast.error(err instanceof Error && err.message ? err.message : tc("deleteFailed")),
      }
    );
  };

  return (
    <div className="flex min-h-[calc(100vh-4rem)] flex-col bg-background">
      {/* Hero — IP banner + status + primary actions. The hero owns the
       *  Save / Publish / Spark commands; the sticky tab nav below is
       *  for tab navigation only. */}
      <EditHero
        title={form.title || project?.name || ""}
        projectStatus={project?.projectStatus}
        saving={saving}
        saved={saved}
        onSave={handleSave}
        onSpark={() => setSparkOpen(true)}
      />

      {/* Sticky tab nav — navigation only. */}
      <div className="sticky top-14 z-30 border-b border-border bg-card/95 backdrop-blur supports-backdrop-filter:bg-card/70">
        <div className="relative flex items-center justify-center px-6">
          <nav className="flex items-center gap-1 overflow-x-auto">
            {visibleTabs.map((tab) => {
              const disabled = "disabled" in tab && tab.disabled;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => {
                    if (disabled) {
                      toast.info(tc("comingSoon"));
                      return;
                    }
                    setActiveTab(tab.id);
                  }}
                  className={cn(
                    "flex items-center gap-1.5 whitespace-nowrap border-b-2 px-4 py-3 text-sm transition-colors",
                    disabled
                      ? "cursor-not-allowed border-transparent text-muted-foreground/50"
                      : activeTab === tab.id
                        ? "border-primary font-semibold text-primary"
                        : "border-transparent text-muted-foreground hover:text-foreground"
                  )}
                >
                  <tab.icon className="size-4" />
                  {t(tab.labelKey)}
                </button>
              );
            })}
          </nav>
        </div>
      </div>

      <SparkDialog open={sparkOpen} onOpenChange={setSparkOpen} projectId={id} />

      {/* Content */}
      <div>
        <div className="mx-auto max-w-6xl px-4">
          {/* ── Basic ── */}
          {/* ── Media ── */}
          {activeTab === "trailer" && (
            <>
              <Section title={t("sectionTrailerCover")} description={t("sectionTrailerCoverDesc")}>
                {form.coverImage ? (
                  <div className="relative aspect-video w-full overflow-hidden rounded-lg border border-border">
                    <img src={form.coverImage} alt="" className="size-full object-cover" />
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      className="absolute right-2 top-10 bg-black/60 text-white hover:bg-black/80"
                      onClick={() => update({ coverImage: null, bannerLink: "" })}
                      disabled={uploadingCover}
                    >
                      <IconX className="size-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      className="absolute right-2 top-2 bg-black/60 text-white hover:bg-black/80"
                      onClick={() => coverInputRef.current?.click()}
                      disabled={uploadingCover}
                    >
                      {uploadingCover ? (
                        <IconLoader2 className="size-4 animate-spin" />
                      ) : (
                        <IconUpload className="size-4" />
                      )}
                    </Button>
                  </div>
                ) : (
                  <div className="flex aspect-video w-full flex-col items-center justify-center rounded-lg border-2 border-dashed border-border">
                    <Button
                      variant="outline"
                      color="muted"
                      size="sm"
                      onClick={() => coverInputRef.current?.click()}
                      disabled={uploadingCover}
                    >
                      {uploadingCover ? (
                        <IconLoader2 className="size-3.5 animate-spin" />
                      ) : (
                        <IconUpload className="size-3.5" />
                      )}
                      {t("uploadImage")}
                    </Button>
                    <p className="mt-2 text-xs text-muted-foreground">{t("imageDropHint")}</p>
                    <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground/60">
                      {t("imageSpec")}
                    </p>
                  </div>
                )}
                <input
                  ref={coverInputRef}
                  type="file"
                  accept="image/jpeg,image/png,image/gif,image/webp"
                  className="hidden"
                  onChange={async (e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    e.target.value = "";
                    setUploadingCover(true);
                    try {
                      const asset = await uploadIPBanner(file, { projectId: id });
                      const previewUrl = asset.path.startsWith("http")
                        ? asset.path
                        : `${env.BANNER_BASE_URL}/${asset.path}`;
                      update({ bannerLink: asset.path, coverImage: previewUrl });
                      toast.success(tc("uploadSuccess"));
                    } catch (err) {
                      toast.error(
                        err instanceof Error && err.message ? err.message : tc("uploadFailed")
                      );
                    } finally {
                      setUploadingCover(false);
                    }
                  }}
                />
              </Section>

              {/* Trailer video */}
              <Section title={t("sectionTrailerVideo")} description={t("sectionTrailerVideoDesc")}>
                {videoLink ? (
                  <div className="relative aspect-video w-full overflow-hidden rounded-lg border border-border bg-black">
                    <VideoPlayer
                      key={videoLink}
                      src={videoLink}
                      autoplay={false}
                      className={cn(
                        "size-full",
                        "[&_.video-js]:size-full",
                        "[&_.vjs-big-play-button]:size-12!",
                        "[&_.vjs-big-play-button]:-mt-6! [&_.vjs-big-play-button]:-ml-6!",
                        "[&_.vjs-big-play-button]:rounded-full!",
                        "[&_.vjs-big-play-button]:border-0!",
                        "[&_.vjs-big-play-button]:bg-black/60!",
                        "[&_.vjs-big-play-button]:text-base! [&_.vjs-big-play-button]:leading-12!",
                        "[&_.vjs-picture-in-picture-control]:hidden!"
                      )}
                    />
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      className="absolute right-2 top-2 z-10 bg-black/60 text-white hover:bg-black/80"
                      onClick={() => videoInputRef.current?.click()}
                      disabled={uploadingVideo}
                    >
                      {uploadingVideo ? (
                        <IconLoader2 className="size-4 animate-spin" />
                      ) : (
                        <IconUpload className="size-4" />
                      )}
                    </Button>
                  </div>
                ) : (
                  <div className="flex aspect-video w-full flex-col items-center justify-center rounded-lg border-2 border-dashed border-border">
                    <Button
                      variant="outline"
                      color="muted"
                      size="sm"
                      onClick={() => videoInputRef.current?.click()}
                      disabled={uploadingVideo}
                    >
                      {uploadingVideo ? (
                        <IconLoader2 className="size-3.5 animate-spin" />
                      ) : (
                        <IconUpload className="size-3.5" />
                      )}
                      {t("uploadVideo")}
                    </Button>
                    <p className="mt-2 text-xs text-muted-foreground">{t("videoDropHint")}</p>
                    <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground/60">
                      {t("videoSpec")}
                    </p>
                  </div>
                )}
                <input
                  ref={videoInputRef}
                  type="file"
                  accept="video/*"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    e.target.value = "";
                    doUploadVideo(
                      { projectId: id, file },
                      {
                        onSuccess: () => toast.success(t("videoUploadSuccess")),
                        onError: () => toast.error(t("videoUploadFailed")),
                      }
                    );
                  }}
                />
              </Section>
            </>
          )}

          {/* ── Basic ── */}
          {activeTab === "basic" && (
            <>
              <Section title={t("sectionName")} description={t("sectionNameDesc")}>
                <Input
                  value={form.title}
                  onChange={(e) => update({ title: e.target.value.slice(0, 200) })}
                  className="h-10"
                />
              </Section>

              <Section title={t("sectionType")} description={t("sectionTypeDesc")}>
                <div className="flex flex-wrap gap-2">
                  {(typeList ?? []).map((tp) => {
                    const value = String(tp.id);
                    return (
                      <Button
                        key={tp.id}
                        variant={form.typeId === value ? "soft" : "outline"}
                        color={form.typeId === value ? "primary" : "muted"}
                        size="sm"
                        onClick={() => update({ typeId: value })}
                      >
                        {tp.name}
                      </Button>
                    );
                  })}
                </div>
              </Section>

              <Section title={t("sectionDesc")} description={t("sectionDescDesc")}>
                <Textarea
                  value={form.description}
                  onChange={(e) => update({ description: e.target.value.slice(0, 1200) })}
                  rows={4}
                  className="min-h-24"
                />
                <span className="block text-right text-xs text-muted-foreground">
                  {form.description.length}/1200
                </span>
              </Section>

              <Section title={t("sectionBackground")} description={t("sectionBackgroundDesc")}>
                <Textarea
                  value={form.background}
                  onChange={(e) => update({ background: e.target.value.slice(0, 6000) })}
                  rows={5}
                  className="min-h-32"
                />
                <span className="block text-right text-xs text-muted-foreground">
                  {form.background.length}/6000
                </span>
              </Section>

              <Section title={t("sectionTags")} description={t("sectionTagsDesc")}>
                <div className="flex flex-wrap gap-1">
                  {(tagList ?? [])
                    .filter((tg) => !form.tags.includes(tg.name))
                    .map((tg) => (
                      <Button
                        key={tg.id}
                        variant="outline"
                        color="muted"
                        size="xs"
                        className="rounded-full"
                        onClick={() => addTag(tg.name)}
                      >
                        + {tg.name}
                      </Button>
                    ))}
                </div>
                <div className="flex flex-wrap gap-1">
                  {form.tags.map((tag) => (
                    <span
                      key={tag}
                      className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-medium text-primary"
                    >
                      {tag}
                      <button type="button" onClick={() => removeTag(tag)}>
                        <IconX className="size-3" />
                      </button>
                    </span>
                  ))}
                </div>
              </Section>

              <Section title={t("sectionContact")} description={t("sectionContactDesc")}>
                <Input
                  value={form.contact}
                  onChange={(e) => update({ contact: e.target.value })}
                  placeholder={t("contactPlaceholder")}
                  className="h-10"
                />
              </Section>
            </>
          )}

          {/* ── Episodes ── */}
          {activeTab === "episodes" && (
            <Section title={t("sectionEpisodes")} description={t("sectionEpisodesDesc")}>
              <DragDropProvider onDragOver={handleEpisodeDragOver} onDragEnd={handleEpisodeDragEnd}>
                <div className="space-y-2">
                  {episodes.map((ep, i) => (
                    <SortableEpisodeRow
                      key={ep.id}
                      id={String(i)}
                      index={i}
                      episode={ep}
                      onClick={() => setEpisodeDialogIndex(i)}
                      onDelete={() => removeEpisode(i)}
                    />
                  ))}

                  {/* Add episode row */}
                  <button
                    type="button"
                    onClick={() => setEpisodeDialogIndex(-1)}
                    className="flex w-full items-center justify-center gap-2 rounded-xl border-2 border-dashed border-border bg-transparent py-4 text-muted-foreground transition-colors hover:border-primary/50 hover:text-primary"
                  >
                    <IconPlus className="size-5" />
                    <span className="text-sm font-medium">{t("addEpisode")}</span>
                  </button>
                </div>
              </DragDropProvider>

              <EpisodeDialog
                open={episodeDialogIndex !== null}
                onOpenChange={(v) => {
                  if (!v) setEpisodeDialogIndex(null);
                }}
                index={episodeDialogIndex}
                projectId={id}
                initial={
                  episodeDialogIndex !== null && episodeDialogIndex >= 0
                    ? episodeToDraft(episodes[episodeDialogIndex])
                    : null
                }
                episodeId={
                  episodeDialogIndex !== null && episodeDialogIndex >= 0
                    ? episodes[episodeDialogIndex]?.id
                    : undefined
                }
                onSubmit={async (draft: EpisodeDraft) => {
                  await upsertEpisode(
                    episodeDialogIndex !== null && episodeDialogIndex >= 0
                      ? episodeDialogIndex
                      : null,
                    draft
                  );
                  setEpisodeDialogIndex(null);
                }}
              />

              <AlertDialog
                open={deleteEpisodeIndex !== null}
                onOpenChange={(v) => {
                  if (!v) {
                    setDeleteEpisodeIndex(null);
                    setDeletingEpisode(false);
                  }
                }}
              >
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>{tEp("deleteEpisode")}</AlertDialogTitle>
                    <AlertDialogDescription>{tEp("deleteEpisodeConfirm")}</AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel disabled={deletingEpisode}>{tc("cancel")}</AlertDialogCancel>
                    <AlertDialogAction
                      color="destructive"
                      disabled={deletingEpisode}
                      onClick={(e) => {
                        // Backend not wired up yet — pin the button in a
                        // loading state so the click feels handled but no
                        // request is sent. User must cancel to escape.
                        e.preventDefault();
                        setDeletingEpisode(true);
                      }}
                    >
                      {deletingEpisode ? <IconLoader2 className="size-3.5 animate-spin" /> : null}
                      {tc("confirm")}
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </Section>
          )}

          {/* ── Pricing ── */}
          {activeTab === "pricing" && (
            <div className="py-2">
              <PricingTab ipId={id} locale={locale} />
            </div>
          )}

          {/* ── Merchandise ── */}
          {activeTab === "merchandise" && (
            <div className="py-2">
              <MerchandiseTab ipId={id} />
            </div>
          )}

          {/* ── Team ── */}
          {activeTab === "team" && (
            <>
              {/* Team Members — render exactly what `/ip/member/list`
               *  returns. No client-side owner synthesis or self-hide:
               *  whatever the backend includes (or omits) is the truth.
               *  Backend is responsible for placing the owner row in
               *  the list if it should appear. */}
              <Section title={t("sectionMembers")} description={t("sectionMembersDesc")}>
                {members.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-border bg-card/40 px-4 py-10 text-center">
                    <p className="text-sm text-muted-foreground">{t("noMembers")}</p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {members.map((m, i) => (
                      <MemberRow
                        key={m.id ?? m.userId ?? i}
                        member={m}
                        roleLabel={getRoleLabel(m.role, roleCatalog, t)}
                        roleTone={getRoleTone(m.role)}
                        canRemove={m.userId != null}
                        onRemove={() => {
                          if (m.userId == null) return;
                          removeMemberMut(
                            { projectId: Number(id), userId: Number(m.userId) },
                            {
                              onSuccess: () => toast.success(tc("deleteSuccess")),
                              onError: (err) =>
                                toast.error(
                                  err instanceof Error && err.message
                                    ? err.message
                                    : tc("deleteFailed")
                                ),
                            }
                          );
                        }}
                        labels={{ remove: t("memberRemove") }}
                      />
                    ))}
                  </div>
                )}
                <Button
                  variant="outline"
                  color="muted"
                  className="w-full"
                  onClick={() => setAddMemberOpen(true)}
                >
                  <IconPlus className="size-4" />
                  {t("addMember")}
                </Button>
              </Section>

              <AddMemberDialog
                open={addMemberOpen}
                onOpenChange={setAddMemberOpen}
                existingEmails={members
                  .map((m) => m.contact)
                  .filter((v): v is string => typeof v === "string" && v.length > 0)}
                busy={addingMember}
                onSubmit={async (member: NewMember) => {
                  setAddingMember(true);
                  try {
                    await addMemberMut({
                      projectId: Number(id),
                      email: member.email,
                      role: member.role,
                      remark: member.remark,
                    });
                    toast.success(t("memberAdded"));
                    setAddMemberOpen(false);
                  } catch (err) {
                    toast.error(
                      err instanceof Error && err.message ? err.message : t("addMemberFailed")
                    );
                  } finally {
                    setAddingMember(false);
                  }
                }}
              />
            </>
          )}

          {/* ── FAQ ── */}
          {activeTab === "faq" && (
            <Section title={t("sectionFAQ")} description={t("sectionFAQDesc")}>
              {faqs.length > 0 ? (
                <DragDropProvider onDragOver={handleFaqDragOver} onDragEnd={handleFaqDragEnd}>
                  <div className="flex flex-col gap-3">
                    {faqs.map((faq, i) => (
                      <SortableFaqRow
                        key={faq.faqId}
                        id={String(faq.faqId)}
                        index={i}
                        faq={faq}
                        onEdit={() => openFaqEdit(i)}
                        onDelete={() => removeFaq(i)}
                      />
                    ))}
                  </div>
                </DragDropProvider>
              ) : (
                <p className="rounded-xl border border-dashed border-border bg-card/40 px-4 py-8 text-center text-sm text-muted-foreground">
                  {t("faqEmpty")}
                </p>
              )}

              <Button variant="outline" color="muted" className="w-full" onClick={openFaqCreate}>
                <IconPlus className="size-4" />
                {t("faqAdd")}
              </Button>

              <FaqDialog
                open={faqDialogOpen}
                onOpenChange={setFaqDialogOpen}
                index={faqDialogIndex}
                initial={
                  faqDialogIndex !== null && faqDialogIndex >= 0
                    ? {
                        question: faqs[faqDialogIndex]?.question ?? "",
                        answer: faqs[faqDialogIndex]?.answer ?? "",
                      }
                    : null
                }
                onSubmit={(draft) => upsertFaq(faqDialogIndex, draft)}
              />
            </Section>
          )}

          {/* ── Legacy job recruitment ──
              Read-only view of historical hiring data fetched from the
              old `/project/job/project/list` endpoint. Tab is only mounted
              when `legacyJobs.length > 0` (see `visibleTabs` above), so
              this `activeTab === "jobs"` branch is unreachable for
              brand-new projects. */}
          {activeTab === "jobs" && (
            <Section title={t("editJobRecruitment")} description={t("editJobRecruitmentDesc")}>
              <div className="space-y-2">
                {legacyJobs.map((job, i) => {
                  const title = job.roleName || `#${job.roleId ?? i + 1}`;
                  const desc =
                    typeof job.jobDescription === "string" ? job.jobDescription.trim() : "";
                  const tag: string[] = [];
                  if (typeof job.profitRatio === "number" && job.profitRatio > 0) {
                    tag.push(t("editJobProfitRatio", { ratio: job.profitRatio }));
                  }
                  if (typeof job.estimatedEarnings === "number" && job.estimatedEarnings > 0) {
                    tag.push(t("editJobEstimatedEarnings", { amount: job.estimatedEarnings }));
                  }
                  return (
                    <div key={job.id ?? i} className="rounded-xl border border-border bg-card p-4">
                      <div className="mb-1 flex items-center justify-between gap-3">
                        <span className="text-sm font-semibold text-foreground">{title}</span>
                        {tag.length > 0 && (
                          <span className="shrink-0 text-[11px] text-amber-400">
                            {tag.join(" · ")}
                          </span>
                        )}
                      </div>
                      {desc && (
                        <p className="whitespace-pre-line text-xs leading-relaxed text-secondary-foreground">
                          {desc}
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>
            </Section>
          )}
        </div>
      </div>
    </div>
  );
}
