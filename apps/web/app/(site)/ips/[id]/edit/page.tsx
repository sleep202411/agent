"use client";

import { useState, useCallback, useEffect, useRef } from "react";
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
  type Episode,
  type FAQ,
} from "@/app/(site)/ips/_hooks/use-ip";
import { useQueryClient } from "@tanstack/react-query";
import { SUGGESTED_TAGS, PRESET_REWARDS, type IPRewardTier } from "@/app/(site)/ips/_data/ip";
import { AddMemberDialog, type NewMember } from "./add-member-dialog";
import { EpisodeDialog, type EpisodeDraft } from "./episode-dialog";
import { SortableEpisodeRow } from "./episode-row";

// ─── FAQ row ───────────────────────────────────────
// Per-FAQ card with local question/answer state; flushes via the parent
// `onSave` callback on input blur (only when the value actually changed).
function FAQCard({
  faq,
  onSave,
  onDelete,
  labels,
}: {
  faq: FAQ;
  onSave: (patch: Partial<Pick<FAQ, "question" | "answer">>) => void;
  onDelete: () => void;
  labels: {
    question: string;
    questionPlaceholder: string;
    answer: string;
    answerPlaceholder: string;
    del: string;
  };
}) {
  const [question, setQuestion] = useState(faq.question);
  const [answer, setAnswer] = useState(faq.answer);
  return (
    <div className="space-y-3 rounded-xl border border-border bg-card p-4">
      <div>
        <label className="mb-1 block text-xs font-medium text-foreground">{labels.question}</label>
        <Input
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          onBlur={() => {
            if (question !== faq.question) onSave({ question });
          }}
          placeholder={labels.questionPlaceholder}
        />
      </div>
      <div>
        <label className="mb-1 block text-xs font-medium text-foreground">{labels.answer}</label>
        <Textarea
          value={answer}
          onChange={(e) => setAnswer(e.target.value)}
          onBlur={() => {
            if (answer !== faq.answer) onSave({ answer });
          }}
          placeholder={labels.answerPlaceholder}
          rows={3}
        />
      </div>
      <div className="flex justify-end">
        <Button variant="outline" color="destructive" size="sm" onClick={onDelete}>
          <IconTrash className="size-3.5" />
          {labels.del}
        </Button>
      </div>
    </div>
  );
}

// ─── Episode → dialog adapter ──────────────────────
// Episode (server shape) carries id / sort / createdAt / projectId; the
// dialog only needs the editable subset.
function episodeToDraft(ep: Episode | undefined): EpisodeDraft | null {
  if (!ep) return null;
  return {
    title: ep.title,
    description: ep.description,
    type: ep.type,
    videoUrl: ep.videoUrl,
    cover: ep.cover,
    duration: ep.duration,
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
  // Keep for UI compatibility
  story: string;
  whyThisIP: string;
  fundingMode: "investment" | "presale";
  valuation: string;
  sharesOffered: string;
  totalShares: string;
  deadline: string;
  presalePrice: number;
  fullPrice: number;
  presaleTarget: number;
  presaleDeadline: string;
  rewards: IPRewardTier[];
  coverImage: string | null;
  projectType: string;
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
  fundingMode: "investment",
  valuation: "",
  sharesOffered: "",
  totalShares: "",
  deadline: "",
  presalePrice: 0,
  fullPrice: 0,
  presaleTarget: 0,
  presaleDeadline: "",
  rewards: [],
  coverImage: null,
  projectType: "",
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

export default function IPEditPage({ id }: { id: string }) {
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
  const { data: videoLink } = useProjectVideoLink(id);
  const { mutate: doUploadVideo, isPending: uploadingVideo } = useUploadProjectVideo();
  const videoInputRef = useRef<HTMLInputElement>(null);

  // Episode CRUD — `useProjectEpisodes` is the single source of truth for
  // the list shown below; mutations invalidate `ipKeys.episodes(id)` so the
  // list refetches after every change. No local form mirror — episodes
  // persist independently of the IP-save button.
  const queryClient = useQueryClient();
  const { data: episodes = [] } = useProjectEpisodes(id);
  const { mutate: createEpisodeMut } = useCreateEpisode();
  const { mutate: updateEpisodeMut } = useUpdateEpisode();
  const { mutate: deleteEpisodeMut } = useDeleteEpisode();
  const { mutate: reorderEpisodeMut } = useReorderEpisode();

  // Team CRUD — list shipped, add/remove via dialog + per-row delete.
  const { data: members = [] } = useProjectMembers(id);
  const { mutate: addMemberMut } = useAddMember();
  const { mutate: removeMemberMut } = useRemoveMember();

  // FAQ CRUD — `useFAQs` is the source of truth; one local draft slot
  // for new entries that haven't been saved yet.
  const { data: faqs = [] } = useFAQs(id);
  const { mutate: createFAQMut } = useCreateFAQ();
  const { mutate: updateFAQMut } = useUpdateFAQ();
  const { mutate: deleteFAQMut } = useDeleteFAQ();
  const [faqDraft, setFaqDraft] = useState<{ question: string; answer: string } | null>(null);

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
      projectType: String(project.typeId ?? ""),
    }));
  }, [project]);

  const update = useCallback((patch: Partial<EditForm>) => {
    setForm((prev) => ({ ...prev, ...patch }));
    setSaved(false);
  }, []);

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
    const target = episodes[i];
    if (!target) return;
    deleteEpisodeMut({ id: target.id, projectId: id });
  };
  const upsertEpisode = (i: number | null, next: EpisodeDraft) => {
    if (i === null || i < 0) {
      createEpisodeMut({
        projectId: id,
        title: next.title,
        description: next.description,
        videoUrl: next.videoUrl,
        cover: next.cover,
        videoMeta: { duration: next.duration },
      });
      return;
    }
    const target = episodes[i];
    if (!target) return;
    updateEpisodeMut({
      id: target.id,
      projectId: id,
      title: next.title,
      description: next.description,
      videoUrl: next.videoUrl,
      cover: next.cover,
      videoMeta: { duration: next.duration },
    });
  };
  // Drag-reorder buffer: dnd-kit fires onDragOver continuously; we batch
  // the latest projected order and commit a single reorder mutation in
  // onDragEnd. The optimistic setQueryData lets the UI reflect the new
  // order immediately; if the backend call fails, the next refetch
  // restores authoritative state. `originalRef` snapshots the order at
  // drag-start so onDragEnd can diff against it (the live `episodes` value
  // already reflects the optimistic mutation by then).
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

  // FAQ helpers — `faqDraft` holds the single in-flight new entry; a
  // saved FAQ shows up in `faqs` after createFAQMut succeeds and the
  // draft slot is reset.
  const saveFAQDraft = () => {
    if (!faqDraft) return;
    if (!faqDraft.question.trim() || !faqDraft.answer.trim()) {
      toast.warning(t("faqRequireBoth"));
      return;
    }
    createFAQMut(
      {
        projectId: Number(id),
        question: faqDraft.question.trim(),
        answer: faqDraft.answer.trim(),
      },
      { onSuccess: () => setFaqDraft(null) }
    );
  };
  const updateFAQField = (faq: FAQ, patch: Partial<Pick<FAQ, "question" | "answer">>) => {
    if (!patch.question?.trim() && !patch.answer?.trim()) return;
    updateFAQMut({
      id: faq.id,
      projectId: faq.projectId,
      ...patch,
    });
  };

  // Reward helpers
  const addReward = (r: IPRewardTier) => {
    if (!form.rewards.some((rr) => rr.id === r.id)) update({ rewards: [...form.rewards, r] });
  };
  const removeReward = (rid: string) =>
    update({ rewards: form.rewards.filter((r) => r.id !== rid) });

  return (
    <div className="flex flex-col bg-background">
      {/* Top tab nav */}
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
          <div className="absolute right-6 flex shrink-0 items-center gap-2 py-2">
            {saved && <span className="text-xs text-green-400">{t("saved")}</span>}
            <Button size="sm" onClick={handleSave} disabled={saving}>
              {saving ? <IconLoader2 className="size-3.5 animate-spin" /> : null}
              {t("save")}
            </Button>
          </div>
        </div>
      </div>

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
                    <video
                      key={videoLink}
                      src={videoLink}
                      controls
                      playsInline
                      className="h-full w-full object-contain"
                    />
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      className="absolute right-2 top-2 bg-black/60 text-white hover:bg-black/80"
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
                      ipId={id}
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
                onSubmit={(draft: EpisodeDraft) => {
                  upsertEpisode(
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
              {/* Self Introduction */}
              <Section title={t("sectionAbout")} description={t("sectionAboutDesc")}>
                <div className="flex items-center gap-4 rounded-xl border border-border bg-card p-4">
                  <div className="flex size-14 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xl font-bold text-primary">
                    {form.title.slice(0, 1) || "?"}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-semibold">{form.title || t("unnamed")}</div>
                    <div className="mt-0.5 text-xs text-muted-foreground">{t("creator")}</div>
                  </div>
                  <Button
                    variant="outline"
                    color="muted"
                    size="sm"
                    onClick={() => setActiveTab("basic")}
                  >
                    {t("editProfile")}
                  </Button>
                </div>
              </Section>

              {/* Team Members */}
              <Section title={t("sectionMembers")} description={t("sectionMembersDesc")}>
                {members.length === 0 ? (
                  <div className="rounded-xl border border-border bg-card p-6 text-center">
                    <p className="text-sm text-muted-foreground">{t("noMembers")}</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {members.map((m, i) => (
                      <div
                        key={m.id ?? m.userId ?? i}
                        className="flex items-center gap-4 rounded-xl border border-border bg-card p-4"
                      >
                        <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-secondary text-sm font-bold text-muted-foreground">
                          {String(i + 1).padStart(2, "0")}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="text-sm font-medium text-foreground">
                            {m.nickName || m.userName || t("unnamed")}
                          </div>
                          {m.roleName && (
                            <div className="mt-0.5 text-xs text-muted-foreground">{m.roleName}</div>
                          )}
                        </div>
                        <Button
                          variant="ghost"
                          color="muted"
                          size="icon-xs"
                          onClick={() => {
                            if (m.userId == null) return;
                            removeMemberMut({ projectId: Number(id), userId: Number(m.userId) });
                          }}
                          className="hover:text-destructive"
                        >
                          <IconTrash className="size-4" />
                        </Button>
                      </div>
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
                onSubmit={(member: NewMember) => {
                  addMemberMut(
                    {
                      projectId: Number(id),
                      email: member.email,
                      name: member.name,
                    },
                    {
                      onSuccess: () => {
                        toast.success(t("memberAdded"));
                        setAddMemberOpen(false);
                      },
                      onError: () => toast.error(t("addMemberFailed")),
                    }
                  );
                }}
              />
            </>
          )}

          {/* ── FAQ ── */}
          {activeTab === "faq" && (
            <Section title={t("sectionFAQ")} description={t("sectionFAQDesc")}>
              {/* Persisted FAQs — auto-save on input blur via updateFAQMut. */}
              {faqs.length > 0 && (
                <div className="space-y-4">
                  {faqs.map((faq) => (
                    <FAQCard
                      key={faq.id}
                      faq={faq}
                      onSave={(patch) => updateFAQField(faq, patch)}
                      onDelete={() => deleteFAQMut({ id: faq.id, projectId: faq.projectId })}
                      labels={{
                        question: t("faqQuestion"),
                        questionPlaceholder: t("faqQuestionPlaceholder"),
                        answer: t("faqAnswer"),
                        answerPlaceholder: t("faqAnswerPlaceholder"),
                        del: t("faqDelete"),
                      }}
                    />
                  ))}
                </div>
              )}

              {/* Local draft for the new FAQ — submit on Save. */}
              {faqDraft && (
                <div className="space-y-3 rounded-xl border border-dashed border-primary/40 bg-card p-4">
                  <div>
                    <label className="mb-1 block text-xs font-medium text-foreground">
                      {t("faqQuestion")}
                    </label>
                    <Input
                      value={faqDraft.question}
                      onChange={(e) => setFaqDraft({ ...faqDraft, question: e.target.value })}
                      placeholder={t("faqQuestionPlaceholder")}
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-medium text-foreground">
                      {t("faqAnswer")}
                    </label>
                    <Textarea
                      value={faqDraft.answer}
                      onChange={(e) => setFaqDraft({ ...faqDraft, answer: e.target.value })}
                      placeholder={t("faqAnswerPlaceholder")}
                      rows={3}
                    />
                  </div>
                  <div className="flex justify-end gap-2">
                    <Button
                      variant="ghost"
                      color="muted"
                      size="sm"
                      onClick={() => setFaqDraft(null)}
                    >
                      {tc("cancel")}
                    </Button>
                    <Button size="sm" onClick={saveFAQDraft}>
                      {tc("save")}
                    </Button>
                  </div>
                </div>
              )}

              {!faqDraft && (
                <Button
                  variant="outline"
                  color="muted"
                  className="w-full"
                  onClick={() => setFaqDraft({ question: "", answer: "" })}
                >
                  <IconPlus className="size-4" />
                  {t("faqAdd")}
                </Button>
              )}
            </Section>
          )}

          {/* ── Funding ── */}
          {activeTab === "funding" && (
            <>
              <Section title={t("sectionFundingMode")} description={t("sectionFundingModeDesc")}>
                <div className="flex gap-3">
                  {(["investment", "presale"] as const).map((mode) => (
                    <Button
                      key={mode}
                      variant={form.fundingMode === mode ? "soft" : "outline"}
                      color={form.fundingMode === mode ? "primary" : "muted"}
                      className="flex-1 py-3"
                      onClick={() => update({ fundingMode: mode })}
                    >
                      {t(`mode_${mode}`)}
                    </Button>
                  ))}
                </div>
              </Section>

              {form.fundingMode === "investment" ? (
                <>
                  <Section title={t("sectionValuation")} description={t("sectionValuationDesc")}>
                    <Input
                      type="number"
                      value={form.valuation}
                      onChange={(e) => update({ valuation: e.target.value })}
                      placeholder="0"
                      className="h-10"
                    />
                  </Section>
                  <Section title={t("sectionShares")} description={t("sectionSharesDesc")}>
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="mb-1 block text-xs text-muted-foreground">
                          {t("sharesOffered")}
                        </label>
                        <div className="relative">
                          <Input
                            type="number"
                            value={form.sharesOffered}
                            onChange={(e) => update({ sharesOffered: e.target.value })}
                            className="h-9 pr-8"
                          />
                          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
                            %
                          </span>
                        </div>
                      </div>
                      <div>
                        <label className="mb-1 block text-xs text-muted-foreground">
                          {t("totalShares")}
                        </label>
                        <Input
                          type="number"
                          value={form.totalShares}
                          onChange={(e) => update({ totalShares: e.target.value })}
                          className="h-9"
                        />
                      </div>
                    </div>
                  </Section>
                  <Section title={t("sectionDeadline")} description={t("sectionDeadlineDesc")}>
                    <Input
                      type="date"
                      value={form.deadline}
                      onChange={(e) => update({ deadline: e.target.value })}
                      className="h-10"
                    />
                  </Section>
                </>
              ) : (
                <>
                  <Section
                    title={t("sectionPresalePrice")}
                    description={t("sectionPresalePriceDesc")}
                  >
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="mb-1 block text-xs text-muted-foreground">
                          {t("presalePrice")}
                        </label>
                        <Input
                          type="number"
                          value={form.presalePrice}
                          onChange={(e) => update({ presalePrice: Number(e.target.value) || 0 })}
                          className="h-9"
                        />
                      </div>
                      <div>
                        <label className="mb-1 block text-xs text-muted-foreground">
                          {t("fullPrice")}
                        </label>
                        <Input
                          type="number"
                          value={form.fullPrice}
                          onChange={(e) => update({ fullPrice: Number(e.target.value) || 0 })}
                          className="h-9"
                        />
                      </div>
                    </div>
                  </Section>
                  <Section
                    title={t("sectionPresaleTarget")}
                    description={t("sectionPresaleTargetDesc")}
                  >
                    <Input
                      type="number"
                      value={form.presaleTarget}
                      onChange={(e) => update({ presaleTarget: Number(e.target.value) || 0 })}
                      className="h-10"
                    />
                  </Section>
                  <Section
                    title={t("sectionDeadline")}
                    description={t("sectionPresaleDeadlineDesc")}
                  >
                    <Input
                      type="date"
                      value={form.presaleDeadline}
                      onChange={(e) => update({ presaleDeadline: e.target.value })}
                      className="h-10"
                    />
                  </Section>
                </>
              )}
            </>
          )}

          {/* ── Rewards ── */}
          {activeTab === "rewards" && (
            <Section title={t("sectionRewards")} description={t("sectionRewardsDesc")}>
              <div className="grid grid-cols-2 gap-3">
                {PRESET_REWARDS.map((preset) => {
                  const added = form.rewards.some((r) => r.id === preset.id);
                  return (
                    <button
                      key={preset.id}
                      type="button"
                      onClick={() => (added ? removeReward(preset.id) : addReward(preset))}
                      className={cn(
                        "rounded-xl border p-3 text-left transition-all",
                        added
                          ? "border-primary/40 bg-primary/5"
                          : "border-border bg-card hover:border-border/80"
                      )}
                    >
                      <div className="mb-1 flex items-center justify-between">
                        <span className="text-sm font-semibold text-foreground">
                          ¥{preset.amount} {preset.title}
                        </span>
                        {added && <span className="text-xs text-primary">{t("added")}</span>}
                      </div>
                      <div className="flex flex-wrap gap-1">
                        {preset.perks.slice(0, 3).map((p) => (
                          <span
                            key={p}
                            className="rounded-full bg-secondary px-2 py-0.5 text-[10px] text-muted-foreground"
                          >
                            {p}
                          </span>
                        ))}
                      </div>
                    </button>
                  );
                })}
              </div>
              {form.rewards.length > 0 && (
                <div>
                  <label className="mb-2 block text-sm font-medium text-foreground">
                    {t("currentRewards")} ({form.rewards.length})
                  </label>
                  <div className="space-y-2">
                    {form.rewards.map((r) => (
                      <div
                        key={r.id}
                        className="flex items-center justify-between rounded-lg border border-border bg-card p-3"
                      >
                        <span className="text-sm font-medium text-foreground">
                          ¥{r.amount} {r.title}
                        </span>
                        <Button
                          variant="ghost"
                          color="muted"
                          size="icon-xs"
                          onClick={() => removeReward(r.id)}
                          className="hover:text-destructive"
                        >
                          <IconX className="size-4" />
                        </Button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </Section>
          )}
        </div>
      </div>
    </div>
  );
}
