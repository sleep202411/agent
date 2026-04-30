"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { useParams } from "next/navigation";
import {
  IconFileText,
  IconBook,
  IconVideo,
  IconPlaylist,
  IconUsers,
  IconUpload,
  IconX,
  IconPlus,
  IconTrash,
  IconLoader2,
} from "@tabler/icons-react";
import { DragDropProvider } from "@dnd-kit/react";
import { toast } from "sonner";
import { useTranslations } from "@/src/i18n/i18n";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
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
  useDeleteEpisode,
  useReorderEpisode,
  useProjectMembers,
  useAddMember,
  useRemoveMember,
  useFAQs,
  useCreateFAQ,
  useUpdateFAQ,
  useDeleteFAQ,
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
import { SUGGESTED_TAGS } from "@/app/(site)/ips/_data/ip";
import { AddMemberDialog, type NewMember } from "./add-member-dialog";
import { EpisodeDialog, type EpisodeDraft } from "./episode-dialog";
import { SortableEpisodeRow } from "./episode-row";
import { FaqDialog, type FaqDraft } from "./faq-dialog";
import { SortableFaqRow } from "./faq-row";
import { EditHero } from "./edit-hero";
import { SparkDialog, type SparkPatch } from "./spark-dialog";

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
  const initial = String(display).charAt(0).toUpperCase() || "?";
  return (
    <div className="flex items-center gap-3 rounded-xl border border-border bg-card p-3">
      <div
        className={cn(
          "flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-full",
          avatar
            ? "bg-muted"
            : "bg-gradient-to-br from-primary/25 to-secondary/40 text-sm font-semibold text-primary"
        )}
      >
        {avatar ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={avatar} alt="" className="size-full object-cover" />
        ) : (
          initial
        )}
      </div>
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
  { id: "story", labelKey: "editStory", icon: IconBook },
  { id: "episodes", labelKey: "editEpisodes", icon: IconPlaylist },
  { id: "team", labelKey: "editTeam", icon: IconUsers },
  { id: "faq", labelKey: "editFAQ", icon: IconFileText },
] as const;

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
  // Story tab — long-text fields not yet persisted server-side; kept in
  // form state until backend extends `/project/update` to accept them.
  story: string;
  whyThisIP: string;
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
  story: "",
  whyThisIP: "",
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
  const t = useTranslations("ipEdit");
  const tc = useTranslations("common");
  const [activeTab, setActiveTab] = useState("basic");
  const [form, setForm] = useState<EditForm>(EMPTY_FORM);
  const [saved, setSaved] = useState(false);
  const [addMemberOpen, setAddMemberOpen] = useState(false);
  // Episode dialog: null = closed, -1 = creating, otherwise editing index
  const [episodeDialogIndex, setEpisodeDialogIndex] = useState<number | null>(null);

  const { data: project, isLoading } = useProjectDetail(id);
  const { mutate: doUpdate, isPending: saving } = useUpdateProject();
  const { data: videoLink } = useProjectVideoLink(id, !!project?.videoLink);
  const { mutate: doUploadVideo, isPending: uploadingVideo } = useUploadProjectVideo();
  const videoInputRef = useRef<HTMLInputElement>(null);

  // Episode CRUD — `useProjectEpisodes` is the single source of truth for
  // the list shown below; mutations invalidate `ipKeys.episodes(id)` so the
  // list refetches after every change. No local form mirror — episodes
  // persist independently of the IP-save button.
  const queryClient = useQueryClient();
  const { data: episodes = [] } = useProjectEpisodes(id);
  const { mutateAsync: createEpisodeMut } = useCreateEpisode();
  const { mutateAsync: updateEpisodeMut } = useUpdateEpisode();
  const { mutate: deleteEpisodeMut } = useDeleteEpisode();
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

  // Publish/unpublish — toggles `projectStatus` 0 ↔ 8 via the existing
  // `useUpdateProject` mutation. Tracked separately from form-save
  // because the action has its own confirm + toast flow.
  const [publishing, setPublishing] = useState(false);

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

  // Publish/unpublish — flip projectStatus 0 ↔ 8. Optimistic toast on
  // success, refetch via React Query invalidation so the hero badge
  // re-paints.
  const handleTogglePublish = () => {
    if (!project) return;
    const isLive = project.projectStatus === 0;
    const nextStatus = isLive ? 8 : 0;
    setPublishing(true);
    doUpdate(
      { id: Number(id), projectStatus: nextStatus },
      {
        onSuccess: () => {
          toast.success(isLive ? t("unpublishSuccess") : t("publishSuccess"));
        },
        onError: () => toast.error(t("publishFailed")),
        onSettled: () => setPublishing(false),
      }
    );
  };

  // Spark patch application — caller-side merge into form state. We
  // never auto-Save here; the user reviews on the page and hits Save
  // when ready (matches the "AI proposes, user disposes" rule).
  const applySparkPatch = (patch: SparkPatch) => {
    setForm((prev) => ({
      ...prev,
      title: patch.name ?? prev.title,
      description: patch.description ?? prev.description,
      background: patch.background ?? prev.background,
      story: patch.story ?? prev.story,
      whyThisIP: patch.whyThisIP ?? prev.whyThisIP,
      tags: patch.tags ?? prev.tags,
      bannerLink: patch.bannerLink ?? prev.bannerLink,
      coverImage: patch.bannerLink
        ? patch.bannerLink.startsWith("http")
          ? patch.bannerLink
          : `${env.BANNER_BASE_URL}/${patch.bannerLink}`
        : prev.coverImage,
    }));
    setSaved(false);
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
    const target = episodes[i];
    if (!target) return;
    deleteEpisodeMut(
      { id: target.id, projectId: id },
      {
        onSuccess: () => toast.success(tc("deleteSuccess")),
        onError: (err) =>
          toast.error(err instanceof Error && err.message ? err.message : tc("deleteFailed")),
      }
    );
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
        bannerLink={form.bannerLink || project?.bannerLink || ""}
        projectStatus={project?.projectStatus}
        saving={saving}
        saved={saved}
        publishing={publishing}
        onSave={handleSave}
        onTogglePublish={handleTogglePublish}
        onSpark={() => setSparkOpen(true)}
      />

      {/* Sticky tab nav — navigation only. */}
      <div className="sticky top-14 z-30 border-b border-border bg-card/95 backdrop-blur supports-backdrop-filter:bg-card/70">
        <div className="relative flex items-center justify-center px-6">
          <nav className="flex items-center gap-1 overflow-x-auto">
            {TABS.map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={cn(
                  "flex items-center gap-1.5 whitespace-nowrap border-b-2 px-4 py-3 text-sm transition-colors",
                  activeTab === tab.id
                    ? "border-primary font-semibold text-primary"
                    : "border-transparent text-muted-foreground hover:text-foreground"
                )}
              >
                <tab.icon className="size-4" />
                {t(tab.labelKey)}
              </button>
            ))}
          </nav>
        </div>
      </div>

      <SparkDialog
        open={sparkOpen}
        onOpenChange={setSparkOpen}
        projectId={id}
        current={{
          name: form.title,
          description: form.description,
          background: form.background,
          story: form.story,
          whyThisIP: form.whyThisIP,
          tags: form.tags,
          bannerLink: form.bannerLink,
        }}
        onApply={applySparkPatch}
      />

      {/* Content */}
      <div>
        <div className="mx-auto max-w-screen-lg px-6">
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
                      className="absolute right-2 top-2 bg-black/60 text-white hover:bg-black/80"
                      onClick={() => update({ coverImage: null })}
                    >
                      <IconX className="size-4" />
                    </Button>
                  </div>
                ) : (
                  <div className="flex aspect-video w-full flex-col items-center justify-center rounded-lg border-2 border-dashed border-border">
                    <Button variant="outline" color="muted" size="sm">
                      <IconUpload className="size-3.5" />
                      {t("uploadImage")}
                    </Button>
                    <p className="mt-2 text-xs text-muted-foreground">{t("imageDropHint")}</p>
                    <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground/60">
                      {t("imageSpec")}
                    </p>
                  </div>
                )}
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
                  onChange={(e) => update({ title: e.target.value.slice(0, 50) })}
                  className="h-10"
                />
              </Section>

              <Section title={t("sectionType")} description={t("sectionTypeDesc")}>
                <div className="flex flex-wrap gap-2">
                  <Input
                    value={form.typeId}
                    onChange={(e) => update({ typeId: e.target.value })}
                    placeholder={t("sectionTypeDesc")}
                    className="h-10"
                  />
                </div>
              </Section>

              <Section title={t("sectionDesc")} description={t("sectionDescDesc")}>
                <Textarea
                  value={form.description}
                  onChange={(e) => update({ description: e.target.value.slice(0, 500) })}
                  rows={4}
                  className="min-h-24"
                />
                <span className="block text-right text-xs text-muted-foreground">
                  {form.description.length}/500
                </span>
              </Section>

              <Section title={t("sectionBackground")} description={t("sectionBackgroundDesc")}>
                <Textarea
                  value={form.background}
                  onChange={(e) => update({ background: e.target.value.slice(0, 2000) })}
                  rows={5}
                  className="min-h-32"
                />
                <span className="block text-right text-xs text-muted-foreground">
                  {form.background.length}/2000
                </span>
              </Section>

              <Section title={t("sectionTags")} description={t("sectionTagsDesc")}>
                <Input
                  placeholder={t("tagPlaceholder")}
                  className="h-10"
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      addTag((e.target as HTMLInputElement).value);
                      (e.target as HTMLInputElement).value = "";
                    }
                  }}
                />
                <div className="flex flex-wrap gap-1">
                  {SUGGESTED_TAGS.filter((t) => !form.tags.includes(t))
                    .slice(0, 8)
                    .map((tag) => (
                      <Button
                        key={tag}
                        variant="outline"
                        color="muted"
                        size="xs"
                        className="rounded-full"
                        onClick={() => addTag(tag)}
                      >
                        + {tag}
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

          {/* ── Story ── */}
          {activeTab === "story" && (
            <>
              <Section title={t("sectionStory")} description={t("sectionStoryDesc")}>
                <Textarea
                  value={form.story}
                  onChange={(e) => update({ story: e.target.value.slice(0, 2000) })}
                  rows={10}
                  className="min-h-48"
                />
                <span className="block text-right text-xs text-muted-foreground">
                  {form.story.length}/2000
                </span>
              </Section>

              <Section title={t("sectionWhyThisIP")} description={t("sectionWhyThisIPDesc")}>
                <Textarea
                  value={form.whyThisIP}
                  onChange={(e) => update({ whyThisIP: e.target.value.slice(0, 1000) })}
                  rows={5}
                  className="min-h-28"
                />
                <span className="block text-right text-xs text-muted-foreground">
                  {form.whyThisIP.length}/1000
                </span>
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
            </Section>
          )}

          {/* ── Team ── */}
          {activeTab === "team" && (
            <>
              {/* Team Members — owner is synthesized at the top of the
               *  list from `project.owner*` so the section is one
               *  unified roster. The owner is never removable; backend
               *  members that echo the owner id are deduplicated. */}
              <Section title={t("sectionMembers")} description={t("sectionMembersDesc")}>
                {(() => {
                  const ownerId = project?.ownerId;
                  const ownerRow: ProjectMember | null =
                    ownerId != null
                      ? {
                          userId: ownerId,
                          userName: project?.ownerName ?? undefined,
                          nickName: project?.ownerName ?? undefined,
                          avatar: project?.ownerAvatar ?? undefined,
                          role: MEMBER_ROLE.OWNER,
                        }
                      : null;
                  const collaborators = members.filter(
                    (m) => ownerId == null || m.userId !== ownerId
                  );
                  const rows: Array<{ member: ProjectMember; canRemove: boolean }> = [];
                  if (ownerRow) rows.push({ member: ownerRow, canRemove: false });
                  for (const m of collaborators) {
                    rows.push({ member: m, canRemove: m.userId != null });
                  }
                  if (rows.length === 0) {
                    return (
                      <div className="rounded-xl border border-dashed border-border bg-card/40 px-4 py-10 text-center">
                        <p className="text-sm text-muted-foreground">{t("noMembers")}</p>
                      </div>
                    );
                  }
                  return (
                    <div className="space-y-2">
                      {rows.map(({ member: m, canRemove }, i) => (
                        <MemberRow
                          key={m.id ?? m.userId ?? i}
                          member={m}
                          roleLabel={getRoleLabel(m.role, roleCatalog, t)}
                          roleTone={getRoleTone(m.role)}
                          canRemove={canRemove}
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
                  );
                })()}
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
                existingUserIds={[
                  ...(project?.ownerId != null ? [project.ownerId] : []),
                  ...members.map((m) => m.userId).filter((v): v is number => typeof v === "number"),
                ]}
                busy={addingMember}
                onSubmit={async (member: NewMember) => {
                  setAddingMember(true);
                  try {
                    await addMemberMut({
                      projectId: Number(id),
                      userId: member.userId,
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
        </div>
      </div>
    </div>
  );
}
