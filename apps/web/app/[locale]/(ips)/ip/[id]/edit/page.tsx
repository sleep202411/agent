import { useState, useCallback } from "react";
import {
  IconFileText,
  IconBook,
  IconVideo,
  IconPlaylist,
  IconUsers,
  IconCurrencyDollar,
  IconGift,
  IconUpload,
  IconX,
  IconPlus,
  IconGripVertical,
  IconTrash,
  IconInfoCircle,
} from "@tabler/icons-react";
import { useTranslations } from "@/src/i18n/i18n";
import { cn } from "@/lib/utils";
import {
  PROJECT_TYPES,
  SUGGESTED_TAGS,
  TARGET_EPISODES_OPTIONS,
  PRESET_REWARDS,
  MOCK_IP_DETAIL,
  type IPCreateForm,
  type IPRewardTier,
} from "@/components/ip/ip-mock";

// ─── Tabs ────────────────────────────────────────────

const TABS = [
  { id: "basic", labelKey: "editBasic", icon: IconFileText },
  { id: "story", labelKey: "editStory", icon: IconBook },
  { id: "promo", labelKey: "editPromo", icon: IconVideo },
  { id: "episodes", labelKey: "editEpisodes", icon: IconPlaylist },
  { id: "team", labelKey: "editTeam", icon: IconUsers },
  { id: "funding", labelKey: "editFunding", icon: IconCurrencyDollar },
  { id: "rewards", labelKey: "editRewards", icon: IconGift },
] as const;

// ─── Mock initial data ──────────────────────────────

function loadMockForm(): IPCreateForm & {
  promoVideo: string | null;
  episodes: { title: string; price: number; type: "linear" | "interactive" }[];
  contact: string;
  background: string;
  jobs: { role: string; description: string; profitRatio: string; earnings: string }[];
} {
  const ip = MOCK_IP_DETAIL;
  return {
    title: ip.title,
    projectType: "ipDevelopment",
    description: ip.desc,
    tags: [...ip.tags],
    coverImage: ip.cover,
    story: ip.story,
    whyThisIP: ip.whyThisIP,
    targetEpisodes: ip.targetEpisodes ?? 10,
    fundingMode: "investment",
    valuation: String(ip.valuation ?? ""),
    sharesOffered: String(ip.sharesOffered ?? ""),
    totalShares: String(ip.totalShares ?? ""),
    deadline: "",
    presalePrice: 30,
    fullPrice: 100,
    presaleTarget: 100,
    presaleDeadline: "",
    rewards: PRESET_REWARDS.slice(0, 2),
    promoVideo: null,
    episodes: ip.episodeList.map((ep, i) => ({
      title: ep.title,
      price: ep.price,
      type: (i === 2 || i === 4 ? "interactive" : "linear") as "linear" | "interactive",
    })),
    contact: "",
    background: "",
    jobs: [],
  };
}

type EditForm = ReturnType<typeof loadMockForm>;

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
      <div className="space-y-5">{children}</div>
    </div>
  );
}

// ─── Component ───────────────────────────────────────

export default function IPEditPage({ id }: { id: string }) {
  const t = useTranslations("ipEdit");
  const [activeTab, setActiveTab] = useState("basic");
  const [form, setForm] = useState<EditForm>(loadMockForm);
  const [saved, setSaved] = useState(false);

  const update = useCallback((patch: Partial<EditForm>) => {
    setForm((prev) => ({ ...prev, ...patch }));
    setSaved(false);
  }, []);

  const handleSave = () => {
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

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
            <button
              type="button"
              onClick={handleSave}
              className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
            >
              {t("save")}
            </button>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-screen-lg px-6">
          {/* ── Basic ── */}
          {activeTab === "basic" && (
            <>
              <Section title={t("sectionCover")} description={t("sectionCoverDesc")}>
                {form.coverImage ? (
                  <div className="relative aspect-video w-full max-w-md overflow-hidden rounded-xl border border-border">
                    <img src={form.coverImage} alt="" className="size-full object-cover" />
                    <button
                      type="button"
                      onClick={() => update({ coverImage: null })}
                      className="absolute right-2 top-2 flex size-7 items-center justify-center rounded-full bg-black/60 text-white hover:bg-black/80"
                    >
                      <IconX className="size-4" />
                    </button>
                  </div>
                ) : (
                  <div className="flex aspect-video w-full max-w-md flex-col items-center justify-center rounded-xl border-2 border-dashed border-border bg-secondary/50">
                    <IconUpload className="mb-2 size-8 text-muted-foreground/50" />
                    <p className="text-sm text-muted-foreground">{t("uploadCover")}</p>
                  </div>
                )}
              </Section>

              <Section title={t("sectionName")} description={t("sectionNameDesc")}>
                <input
                  type="text"
                  value={form.title}
                  onChange={(e) => update({ title: e.target.value.slice(0, 50) })}
                  className="w-full rounded-lg border border-border bg-background px-3 py-2.5 text-sm outline-none focus:border-primary"
                />
              </Section>

              <Section title={t("sectionType")} description={t("sectionTypeDesc")}>
                <div className="flex flex-wrap gap-2">
                  {PROJECT_TYPES.map((type) => (
                    <button
                      key={type}
                      type="button"
                      onClick={() => update({ projectType: type })}
                      className={cn(
                        "rounded-lg border px-3 py-1.5 text-xs font-medium transition-all",
                        form.projectType === type
                          ? "border-primary bg-primary/10 text-primary"
                          : "border-border bg-secondary text-muted-foreground hover:text-foreground"
                      )}
                    >
                      {t(`type_${type}`)}
                    </button>
                  ))}
                </div>
              </Section>

              <Section title={t("sectionDesc")} description={t("sectionDescDesc")}>
                <textarea
                  value={form.description}
                  onChange={(e) => update({ description: e.target.value.slice(0, 500) })}
                  rows={4}
                  className="w-full resize-none rounded-lg border border-border bg-background px-3 py-2.5 text-sm outline-none focus:border-primary"
                />
                <span className="block text-right text-xs text-muted-foreground">
                  {form.description.length}/500
                </span>
              </Section>

              <Section title={t("sectionBackground")} description={t("sectionBackgroundDesc")}>
                <textarea
                  value={form.background}
                  onChange={(e) => update({ background: e.target.value.slice(0, 2000) })}
                  rows={5}
                  className="w-full resize-none rounded-lg border border-border bg-background px-3 py-2.5 text-sm outline-none focus:border-primary"
                />
                <span className="block text-right text-xs text-muted-foreground">
                  {form.background.length}/2000
                </span>
              </Section>

              <Section title={t("sectionTags")} description={t("sectionTagsDesc")}>
                <input
                  type="text"
                  placeholder={t("tagPlaceholder")}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      addTag((e.target as HTMLInputElement).value);
                      (e.target as HTMLInputElement).value = "";
                    }
                  }}
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
                />
                <div className="flex flex-wrap gap-1">
                  {SUGGESTED_TAGS.filter((t) => !form.tags.includes(t))
                    .slice(0, 8)
                    .map((tag) => (
                      <button
                        key={tag}
                        type="button"
                        onClick={() => addTag(tag)}
                        className="rounded-full border border-border bg-secondary px-2 py-0.5 text-xs text-muted-foreground hover:text-foreground"
                      >
                        + {tag}
                      </button>
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
                <input
                  type="text"
                  value={form.contact}
                  onChange={(e) => update({ contact: e.target.value })}
                  placeholder={t("contactPlaceholder")}
                  className="w-full rounded-lg border border-border bg-background px-3 py-2.5 text-sm outline-none focus:border-primary"
                />
              </Section>
            </>
          )}

          {/* ── Story ── */}
          {activeTab === "story" && (
            <>
              <Section title={t("sectionStory")} description={t("sectionStoryDesc")}>
                <textarea
                  value={form.story}
                  onChange={(e) => update({ story: e.target.value.slice(0, 2000) })}
                  rows={10}
                  className="w-full resize-none rounded-lg border border-border bg-background px-3 py-2.5 text-sm outline-none focus:border-primary"
                />
                <span className="block text-right text-xs text-muted-foreground">
                  {form.story.length}/2000
                </span>
              </Section>

              <Section title={t("sectionWhyThisIP")} description={t("sectionWhyThisIPDesc")}>
                <textarea
                  value={form.whyThisIP}
                  onChange={(e) => update({ whyThisIP: e.target.value.slice(0, 1000) })}
                  rows={5}
                  className="w-full resize-none rounded-lg border border-border bg-background px-3 py-2.5 text-sm outline-none focus:border-primary"
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
                    <button
                      key={n}
                      type="button"
                      onClick={() => update({ targetEpisodes: n })}
                      className={cn(
                        "rounded-lg border px-4 py-2 text-sm font-medium transition-all",
                        form.targetEpisodes === n
                          ? "border-primary bg-primary/10 text-primary"
                          : "border-border bg-secondary text-muted-foreground"
                      )}
                    >
                      {n} {t("eps")}
                    </button>
                  ))}
                </div>
              </Section>
            </>
          )}

          {/* ── Promo ── */}
          {activeTab === "promo" && (
            <Section title={t("sectionPromo")} description={t("sectionPromoDesc")}>
              {form.promoVideo ? (
                <div className="relative aspect-video w-full overflow-hidden rounded-xl border border-border bg-black">
                  <div className="flex size-full items-center justify-center text-sm text-white/50">
                    {t("videoUploaded")}
                  </div>
                  <button
                    type="button"
                    onClick={() => update({ promoVideo: null })}
                    className="absolute right-2 top-2 flex size-7 items-center justify-center rounded-full bg-black/60 text-white hover:bg-black/80"
                  >
                    <IconX className="size-4" />
                  </button>
                </div>
              ) : (
                <div className="flex aspect-video w-full flex-col items-center justify-center rounded-xl border-2 border-dashed border-border bg-secondary/50">
                  <IconVideo className="mb-2 size-10 text-muted-foreground/30" />
                  <p className="text-sm text-muted-foreground">{t("uploadPromo")}</p>
                  <p className="mt-1 text-xs text-muted-foreground/60">{t("promoSpec")}</p>
                  <button
                    type="button"
                    onClick={() => update({ promoVideo: "mock" })}
                    className="mt-4 rounded-lg bg-primary px-4 py-2 text-xs font-medium text-primary-foreground"
                  >
                    <IconUpload className="mr-1 inline size-3.5" /> {t("selectVideo")}
                  </button>
                </div>
              )}
            </Section>
          )}

          {/* ── Episodes ── */}
          {activeTab === "episodes" && (
            <Section title={t("sectionEpisodes")} description={t("sectionEpisodesDesc")}>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => addEpisode("linear")}
                  className="flex items-center gap-1 rounded-lg border border-border bg-secondary px-3 py-1.5 text-xs font-medium text-foreground hover:bg-secondary/70"
                >
                  <IconPlus className="size-3.5" /> {t("addLinear")}
                </button>
                <button
                  type="button"
                  onClick={() => addEpisode("interactive")}
                  className="flex items-center gap-1 rounded-lg border border-violet-400/30 bg-violet-400/10 px-3 py-1.5 text-xs font-medium text-violet-400 hover:bg-violet-400/20"
                >
                  <IconPlus className="size-3.5" /> {t("addInteractive")}
                </button>
              </div>
              {form.episodes.length === 0 ? (
                <div className="py-10 text-center text-sm text-muted-foreground">
                  {t("noEpisodes")}
                </div>
              ) : (
                <div className="space-y-2">
                  {form.episodes.map((ep, i) => (
                    <div
                      key={i}
                      className={cn(
                        "flex items-center gap-3 rounded-lg border p-3",
                        ep.type === "interactive"
                          ? "border-violet-400/20 bg-violet-400/5"
                          : "border-border bg-secondary/30"
                      )}
                    >
                      <IconGripVertical className="size-4 shrink-0 text-muted-foreground/30" />
                      <div className="flex size-8 shrink-0 items-center justify-center rounded bg-secondary text-xs font-bold text-muted-foreground">
                        {String(i + 1).padStart(2, "0")}
                      </div>
                      <span
                        className={cn(
                          "shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold",
                          ep.type === "interactive"
                            ? "bg-violet-400/10 text-violet-400"
                            : "bg-blue-400/10 text-blue-400"
                        )}
                      >
                        {ep.type === "interactive" ? t("typeInteractive") : t("typeLinear")}
                      </span>
                      <input
                        type="text"
                        value={ep.title}
                        onChange={(e) => updateEpisode(i, { title: e.target.value })}
                        placeholder={t("epTitlePlaceholder")}
                        className="min-w-0 flex-1 rounded-lg border border-border bg-background px-3 py-1.5 text-sm outline-none focus:border-primary"
                      />
                      <div className="flex items-center gap-1">
                        <span className="text-xs text-muted-foreground">{"\u00A5"}</span>
                        <input
                          type="number"
                          value={ep.price}
                          onChange={(e) => updateEpisode(i, { price: Number(e.target.value) || 0 })}
                          className="w-20 rounded-lg border border-border bg-background px-2 py-1.5 text-center text-sm outline-none focus:border-primary"
                        />
                      </div>
                      {ep.type === "interactive" && (
                        <a
                          href={`/ips/${id}/episodes/${i + 1}/editor`}
                          className="shrink-0 rounded-lg border border-violet-400/30 bg-violet-400/10 px-2.5 py-1 text-[10px] font-semibold text-violet-400 hover:bg-violet-400/20"
                        >
                          {t("editFlow")}
                        </a>
                      )}
                      <button
                        type="button"
                        onClick={() => removeEpisode(i)}
                        className="text-muted-foreground hover:text-destructive"
                      >
                        <IconTrash className="size-4" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </Section>
          )}

          {/* ── Team ── */}
          {activeTab === "team" && (
            <Section title={t("sectionTeam")} description={t("sectionTeamDesc")}>
              <button
                type="button"
                onClick={addJob}
                className="flex items-center gap-1 rounded-lg border border-border bg-secondary px-3 py-1.5 text-xs font-medium text-foreground hover:bg-secondary/70"
              >
                <IconPlus className="size-3.5" /> {t("addPosition")}
              </button>
              {form.jobs.length === 0 ? (
                <div className="py-10 text-center text-sm text-muted-foreground">
                  {t("noPositions")}
                </div>
              ) : (
                <div className="space-y-4">
                  {form.jobs.map((job, i) => (
                    <div
                      key={i}
                      className="space-y-3 rounded-lg border border-border bg-secondary/30 p-4"
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-semibold text-foreground">
                          {t("position")} {i + 1}
                        </span>
                        <button
                          type="button"
                          onClick={() => removeJob(i)}
                          className="text-muted-foreground hover:text-destructive"
                        >
                          <IconTrash className="size-4" />
                        </button>
                      </div>
                      <input
                        type="text"
                        value={job.role}
                        onChange={(e) => updateJob(i, { role: e.target.value })}
                        placeholder={t("rolePlaceholder")}
                        className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
                      />
                      <textarea
                        value={job.description}
                        onChange={(e) => updateJob(i, { description: e.target.value })}
                        placeholder={t("jobDescPlaceholder")}
                        rows={2}
                        className="w-full resize-none rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
                      />
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="mb-1 block text-xs text-muted-foreground">
                            {t("profitRatio")}
                          </label>
                          <div className="relative">
                            <input
                              type="number"
                              value={job.profitRatio}
                              onChange={(e) => updateJob(i, { profitRatio: e.target.value })}
                              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
                            />
                            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
                              %
                            </span>
                          </div>
                        </div>
                        <div>
                          <label className="mb-1 block text-xs text-muted-foreground">
                            {t("estimatedEarnings")}
                          </label>
                          <input
                            type="number"
                            value={job.earnings}
                            onChange={(e) => updateJob(i, { earnings: e.target.value })}
                            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
                          />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Section>
          )}

          {/* ── Funding ── */}
          {activeTab === "funding" && (
            <>
              <Section title={t("sectionFundingMode")} description={t("sectionFundingModeDesc")}>
                <div className="flex gap-3">
                  {(["investment", "presale"] as const).map((mode) => (
                    <button
                      key={mode}
                      type="button"
                      onClick={() => update({ fundingMode: mode })}
                      className={cn(
                        "flex-1 rounded-lg border px-4 py-3 text-sm font-medium transition-all",
                        form.fundingMode === mode
                          ? "border-primary bg-primary/10 text-primary"
                          : "border-border bg-secondary text-muted-foreground"
                      )}
                    >
                      {t(`mode_${mode}`)}
                    </button>
                  ))}
                </div>
              </Section>

              {form.fundingMode === "investment" ? (
                <>
                  <Section title={t("sectionValuation")} description={t("sectionValuationDesc")}>
                    <input
                      type="number"
                      value={form.valuation}
                      onChange={(e) => update({ valuation: e.target.value })}
                      placeholder="0"
                      className="w-full rounded-lg border border-border bg-background px-3 py-2.5 text-sm outline-none focus:border-primary"
                    />
                  </Section>
                  <Section title={t("sectionShares")} description={t("sectionSharesDesc")}>
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="mb-1 block text-xs text-muted-foreground">
                          {t("sharesOffered")}
                        </label>
                        <div className="relative">
                          <input
                            type="number"
                            value={form.sharesOffered}
                            onChange={(e) => update({ sharesOffered: e.target.value })}
                            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
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
                        <input
                          type="number"
                          value={form.totalShares}
                          onChange={(e) => update({ totalShares: e.target.value })}
                          className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
                        />
                      </div>
                    </div>
                  </Section>
                  <Section title={t("sectionDeadline")} description={t("sectionDeadlineDesc")}>
                    <input
                      type="date"
                      value={form.deadline}
                      onChange={(e) => update({ deadline: e.target.value })}
                      className="w-full rounded-lg border border-border bg-background px-3 py-2.5 text-sm outline-none focus:border-primary"
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
                        <input
                          type="number"
                          value={form.presalePrice}
                          onChange={(e) => update({ presalePrice: Number(e.target.value) || 0 })}
                          className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
                        />
                      </div>
                      <div>
                        <label className="mb-1 block text-xs text-muted-foreground">
                          {t("fullPrice")}
                        </label>
                        <input
                          type="number"
                          value={form.fullPrice}
                          onChange={(e) => update({ fullPrice: Number(e.target.value) || 0 })}
                          className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
                        />
                      </div>
                    </div>
                  </Section>
                  <Section
                    title={t("sectionPresaleTarget")}
                    description={t("sectionPresaleTargetDesc")}
                  >
                    <input
                      type="number"
                      value={form.presaleTarget}
                      onChange={(e) => update({ presaleTarget: Number(e.target.value) || 0 })}
                      className="w-full rounded-lg border border-border bg-background px-3 py-2.5 text-sm outline-none focus:border-primary"
                    />
                  </Section>
                  <Section
                    title={t("sectionDeadline")}
                    description={t("sectionPresaleDeadlineDesc")}
                  >
                    <input
                      type="date"
                      value={form.presaleDeadline}
                      onChange={(e) => update({ presaleDeadline: e.target.value })}
                      className="w-full rounded-lg border border-border bg-background px-3 py-2.5 text-sm outline-none focus:border-primary"
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
                        <button
                          type="button"
                          onClick={() => removeReward(r.id)}
                          className="text-muted-foreground hover:text-destructive"
                        >
                          <IconX className="size-4" />
                        </button>
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
