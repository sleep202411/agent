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
  IconGripVertical,
  IconTrash,
  IconLoader2,
} from "@tabler/icons-react";
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
} from "@/src/hooks/use-my-projects";
import {
  SUGGESTED_TAGS,
  TARGET_EPISODES_OPTIONS,
  PRESET_REWARDS,
  type IPRewardTier,
} from "@/app/ip/_components/ip-mock";
import { AddMemberDialog, type NewMember } from "./add-member-dialog";

// ─── Tabs ────────────────────────────────────────────

const TABS = [
  { id: "basic", labelKey: "editBasic", icon: IconFileText },
  { id: "media", labelKey: "editMedia", icon: IconVideo },
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
  episodes: { title: string; price: number; type: "linear" | "interactive" }[];
  jobs: { role: string; description: string; profitRatio: string; earnings: string }[];
  faqs: { question: string; answer: string }[];
  // Keep for UI compatibility
  story: string;
  whyThisIP: string;
  targetEpisodes: number;
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
  episodes: [],
  jobs: [],
  faqs: [],
  story: "",
  whyThisIP: "",
  targetEpisodes: 10,
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
  const [activeTab, setActiveTab] = useState("basic");
  const [form, setForm] = useState<EditForm>(EMPTY_FORM);
  const [saved, setSaved] = useState(false);
  const [addMemberOpen, setAddMemberOpen] = useState(false);

  const { data: project, isLoading } = useProjectDetail(id);
  const { mutate: doUpdate, isPending: saving } = useUpdateProject();
  const { data: videoLink } = useProjectVideoLink(id);
  const { mutate: doUploadVideo, isPending: uploadingVideo } = useUploadProjectVideo();
  const videoInputRef = useRef<HTMLInputElement>(null);

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

  // Episode helpers
  const addEpisode = (type: "linear" | "interactive" = "linear") =>
    update({ episodes: [...form.episodes, { title: "", price: 0, type }] });
  const removeEpisode = (i: number) =>
    update({ episodes: form.episodes.filter((_, j) => j !== i) });
  const updateEpisode = (i: number, patch: Partial<{ title: string; price: number }>) => {
    const eps = [...form.episodes];
    eps[i] = { ...eps[i], ...patch };
    update({ episodes: eps });
  };

  // Job helpers
  const addJob = () =>
    update({
      jobs: [...form.jobs, { role: "", description: "", profitRatio: "", earnings: "" }],
    });
  const removeJob = (i: number) => update({ jobs: form.jobs.filter((_, j) => j !== i) });
  const updateJob = (
    i: number,
    patch: Partial<{ role: string; description: string; profitRatio: string; earnings: string }>
  ) => {
    const jobs = [...form.jobs];
    jobs[i] = { ...jobs[i], ...patch };
    update({ jobs });
  };

  // Reward helpers
  const addReward = (r: IPRewardTier) => {
    if (!form.rewards.some((rr) => rr.id === r.id)) update({ rewards: [...form.rewards, r] });
  };
  const removeReward = (rid: string) =>
    update({ rewards: form.rewards.filter((r) => r.id !== rid) });

  return (
    <div className="flex h-[calc(100vh-3.5rem)] flex-col bg-background">
      {/* Top tab nav */}
      <div className="border-b border-border bg-card/50">
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
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-screen-lg px-6">
          {/* ── Basic ── */}
          {/* ── Media ── */}
          {activeTab === "media" && (
            <>
              <Section title={t("sectionImage")} description={t("sectionImageDesc")}>
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

              {/* Project Video (optional) */}
              <Section title={t("sectionVideo")} description={t("sectionVideoDesc")}>
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

              <Section
                title={t("sectionTargetEpisodes")}
                description={t("sectionTargetEpisodesDesc")}
              >
                <div className="flex flex-wrap gap-2">
                  {TARGET_EPISODES_OPTIONS.map((n) => (
                    <Button
                      key={n}
                      variant={form.targetEpisodes === n ? "soft" : "outline"}
                      color={form.targetEpisodes === n ? "primary" : "muted"}
                      size="sm"
                      onClick={() => update({ targetEpisodes: n })}
                    >
                      {n} {t("eps")}
                    </Button>
                  ))}
                </div>
              </Section>
            </>
          )}

          {/* ── Episodes ── */}
          {activeTab === "episodes" && (
            <Section title={t("sectionEpisodes")} description={t("sectionEpisodesDesc")}>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {form.episodes.map((ep, i) => (
                  <div
                    key={i}
                    className={cn(
                      "group relative overflow-hidden rounded-xl border transition-colors",
                      ep.type === "interactive"
                        ? "border-violet-400/20 bg-violet-400/5"
                        : "border-border bg-card"
                    )}
                  >
                    {/* Thumbnail area */}
                    <div className="relative flex aspect-video items-center justify-center bg-muted/50">
                      <IconPlaylist className="size-10 text-muted-foreground/20" />
                      <span
                        className={cn(
                          "absolute left-2 top-2 rounded px-1.5 py-0.5 text-[10px] font-semibold",
                          ep.type === "interactive"
                            ? "bg-violet-400/15 text-violet-400"
                            : "bg-blue-400/15 text-blue-400"
                        )}
                      >
                        {ep.type === "interactive" ? t("typeInteractive") : t("typeLinear")}
                      </span>
                      <div className="absolute right-2 top-2 flex gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                        {ep.type === "interactive" && (
                          <Button
                            variant="ghost"
                            size="icon-xs"
                            className="bg-black/60 text-white hover:bg-black/80"
                            asChild
                          >
                            <a href={`/ips/${id}/episodes/${i + 1}/editor`}>
                              <IconFileText className="size-3.5" />
                            </a>
                          </Button>
                        )}
                        <Button
                          variant="ghost"
                          size="icon-xs"
                          className="bg-black/60 text-white hover:bg-red-500/80"
                          onClick={() => removeEpisode(i)}
                        >
                          <IconTrash className="size-3.5" />
                        </Button>
                      </div>
                    </div>

                    {/* Info */}
                    <div className="space-y-2 p-3">
                      <div className="flex items-center gap-2">
                        <span className="flex size-6 shrink-0 items-center justify-center rounded bg-secondary text-[10px] font-bold text-muted-foreground">
                          {String(i + 1).padStart(2, "0")}
                        </span>
                        <Input
                          value={ep.title}
                          onChange={(e) => updateEpisode(i, { title: e.target.value })}
                          placeholder={t("epTitlePlaceholder")}
                          className="h-8 min-w-0 flex-1 text-sm"
                        />
                      </div>
                      <div className="flex items-center gap-1">
                        <span className="text-xs text-muted-foreground">¥</span>
                        <Input
                          type="number"
                          value={ep.price}
                          onChange={(e) => updateEpisode(i, { price: Number(e.target.value) || 0 })}
                          className="h-8 w-20 text-center text-sm"
                        />
                        <span className="text-[10px] text-muted-foreground/60">
                          / {t("episode")}
                        </span>
                      </div>
                    </div>
                  </div>
                ))}

                {/* Add episode card */}
                <button
                  type="button"
                  onClick={() => addEpisode("linear")}
                  className="flex aspect-[4/3] flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-border bg-transparent text-muted-foreground transition-colors hover:border-primary/50 hover:text-primary"
                >
                  <IconPlus className="size-8" />
                  <span className="text-sm font-medium">{t("addEpisode")}</span>
                </button>
              </div>
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
                {form.jobs.length === 0 ? (
                  <div className="rounded-xl border border-border bg-card p-6 text-center">
                    <p className="text-sm text-muted-foreground">{t("noMembers")}</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {form.jobs.map((job, i) => (
                      <div
                        key={i}
                        className="flex items-start gap-4 rounded-xl border border-border bg-card p-4"
                      >
                        <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-secondary text-sm font-bold text-muted-foreground">
                          {String(i + 1).padStart(2, "0")}
                        </div>
                        <div className="min-w-0 flex-1 space-y-2">
                          <Input
                            value={job.role}
                            onChange={(e) => updateJob(i, { role: e.target.value })}
                            placeholder={t("rolePlaceholder")}
                            className="h-8 text-sm font-medium"
                          />
                          <Textarea
                            value={job.description}
                            onChange={(e) => updateJob(i, { description: e.target.value })}
                            placeholder={t("jobDescPlaceholder")}
                            rows={2}
                            className="min-h-14 text-sm"
                          />
                          <div className="flex gap-3">
                            <div className="relative flex-1">
                              <Input
                                type="number"
                                value={job.profitRatio}
                                onChange={(e) => updateJob(i, { profitRatio: e.target.value })}
                                placeholder={t("profitRatio")}
                                className="h-8 pr-8 text-sm"
                              />
                              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
                                %
                              </span>
                            </div>
                            <Input
                              type="number"
                              value={job.earnings}
                              onChange={(e) => updateJob(i, { earnings: e.target.value })}
                              placeholder={t("estimatedEarnings")}
                              className="h-8 flex-1 text-sm"
                            />
                          </div>
                        </div>
                        <Button
                          variant="ghost"
                          color="muted"
                          size="icon-xs"
                          onClick={() => removeJob(i)}
                          className="mt-1 hover:text-destructive"
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
                  addJob();
                  const idx = form.jobs.length;
                  updateJob(idx, { role: member.name, description: member.email });
                  toast.success(t("memberAdded"));
                }}
              />
            </>
          )}

          {/* ── FAQ ── */}
          {activeTab === "faq" && (
            <Section title={t("sectionFAQ")} description={t("sectionFAQDesc")}>
              {(form.faqs ?? []).length > 0 && (
                <div className="space-y-4">
                  {(form.faqs ?? []).map((faq, i) => (
                    <div key={i} className="space-y-3 rounded-xl border border-border bg-card p-4">
                      <div>
                        <label className="mb-1 block text-xs font-medium text-foreground">
                          {t("faqQuestion")}
                        </label>
                        <Input
                          value={faq.question}
                          onChange={(e) => {
                            const faqs = [...form.faqs];
                            faqs[i] = { ...faqs[i], question: e.target.value };
                            update({ faqs });
                          }}
                          placeholder={t("faqQuestionPlaceholder")}
                        />
                      </div>
                      <div>
                        <label className="mb-1 block text-xs font-medium text-foreground">
                          {t("faqAnswer")}
                        </label>
                        <Textarea
                          value={faq.answer}
                          onChange={(e) => {
                            const faqs = [...form.faqs];
                            faqs[i] = { ...faqs[i], answer: e.target.value };
                            update({ faqs });
                          }}
                          placeholder={t("faqAnswerPlaceholder")}
                          rows={3}
                        />
                      </div>
                      <div className="flex justify-end">
                        <Button
                          variant="outline"
                          color="destructive"
                          size="sm"
                          onClick={() =>
                            update({ faqs: (form.faqs ?? []).filter((_, j) => j !== i) })
                          }
                        >
                          <IconTrash className="size-3.5" />
                          {t("faqDelete")}
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
              <Button
                variant="outline"
                color="muted"
                className="w-full"
                onClick={() =>
                  update({ faqs: [...(form.faqs ?? []), { question: "", answer: "" }] })
                }
              >
                <IconPlus className="size-4" />
                {t("faqAdd")}
              </Button>
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
