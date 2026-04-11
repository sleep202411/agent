import { useState, useCallback } from "react";
import { Link } from "@tanstack/react-router";
import {
  IconArrowLeft,
  IconFileText,
  IconBook,
  IconVideo,
  IconPlaylist,
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
  { id: "funding", labelKey: "editFunding", icon: IconCurrencyDollar },
  { id: "rewards", labelKey: "editRewards", icon: IconGift },
] as const;

// ─── Mock initial data (from existing IP) ────────────

function loadMockForm(): IPCreateForm & {
  promoVideo: string | null;
  episodes: { title: string; price: number; type: "linear" | "interactive" }[];
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
  };
}

type EditForm = ReturnType<typeof loadMockForm>;

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
    // TODO: POST /api/ip/:id
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

  // Reward helpers
  const addReward = (r: IPRewardTier) => {
    if (!form.rewards.some((rr) => rr.id === r.id)) update({ rewards: [...form.rewards, r] });
  };
  const removeReward = (id: string) => update({ rewards: form.rewards.filter((r) => r.id !== id) });

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="border-b border-border bg-card/50">
        <div className="mx-auto flex max-w-screen-xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-3">
            <a
              href={`/ips/${id}`}
              className="text-muted-foreground transition-colors hover:text-foreground"
            >
              <IconArrowLeft className="size-4" />
            </a>
            <h1 className="text-lg font-bold text-foreground">{t("pageTitle")}</h1>
            <span className="rounded bg-secondary px-2 py-0.5 text-xs text-muted-foreground">
              {form.title}
            </span>
          </div>
          <div className="flex items-center gap-2">
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

      {/* Body */}
      <div className="mx-auto flex max-w-screen-xl gap-6 px-6 py-6">
        {/* Sidebar */}
        <div className="w-44 shrink-0">
          <nav className="sticky top-6 space-y-0.5">
            {TABS.map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={cn(
                  "flex w-full items-center gap-2 rounded-xl px-3 py-2.5 text-left text-sm transition-colors",
                  activeTab === tab.id
                    ? "bg-primary/10 font-semibold text-primary"
                    : "text-muted-foreground hover:bg-secondary hover:text-foreground"
                )}
              >
                <tab.icon className="size-4 shrink-0" />
                {t(tab.labelKey)}
              </button>
            ))}
          </nav>
        </div>

        {/* Content */}
        <div className="min-w-0 flex-1">
          {/* ── Basic Info ── */}
          {activeTab === "basic" && (
            <div className="space-y-6">
              <SectionCard title={t("editBasic")}>
                {/* Cover */}
                <div>
                  <label className="mb-2 block text-sm font-medium text-foreground">
                    {t("cover")}
                  </label>
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
                </div>

                {/* Title */}
                <div>
                  <label className="mb-2 block text-sm font-medium text-foreground">
                    {t("title")}
                  </label>
                  <input
                    type="text"
                    value={form.title}
                    onChange={(e) => update({ title: e.target.value.slice(0, 50) })}
                    className="w-full rounded-lg border border-border bg-background px-3 py-2.5 text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
                  />
                </div>

                {/* Type */}
                <div>
                  <label className="mb-2 block text-sm font-medium text-foreground">
                    {t("projectType")}
                  </label>
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
                </div>

                {/* Description */}
                <div>
                  <label className="mb-2 block text-sm font-medium text-foreground">
                    {t("description")}
                  </label>
                  <textarea
                    value={form.description}
                    onChange={(e) => update({ description: e.target.value.slice(0, 500) })}
                    rows={4}
                    className="w-full resize-none rounded-lg border border-border bg-background px-3 py-2.5 text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
                  />
                  <span className="mt-1 block text-right text-xs text-muted-foreground">
                    {form.description.length}/500
                  </span>
                </div>

                {/* Tags */}
                <div>
                  <label className="mb-2 block text-sm font-medium text-foreground">
                    {t("tags")}
                  </label>
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
                    className="mb-2 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
                  />
                  <div className="mb-2 flex flex-wrap gap-1">
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
                </div>
              </SectionCard>
            </div>
          )}

          {/* ── Story ── */}
          {activeTab === "story" && (
            <div className="space-y-6">
              <SectionCard title={t("editStory")}>
                <div>
                  <label className="mb-2 block text-sm font-medium text-foreground">
                    {t("storySummary")}
                  </label>
                  <textarea
                    value={form.story}
                    onChange={(e) => update({ story: e.target.value.slice(0, 2000) })}
                    rows={8}
                    className="w-full resize-none rounded-lg border border-border bg-background px-3 py-2.5 text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
                  />
                  <span className="mt-1 block text-right text-xs text-muted-foreground">
                    {form.story.length}/2000
                  </span>
                </div>
                <div>
                  <label className="mb-2 block text-sm font-medium text-foreground">
                    {t("whyThisIP")}
                  </label>
                  <textarea
                    value={form.whyThisIP}
                    onChange={(e) => update({ whyThisIP: e.target.value.slice(0, 1000) })}
                    rows={4}
                    className="w-full resize-none rounded-lg border border-border bg-background px-3 py-2.5 text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
                  />
                  <span className="mt-1 block text-right text-xs text-muted-foreground">
                    {form.whyThisIP.length}/1000
                  </span>
                </div>
                <div>
                  <label className="mb-2 block text-sm font-medium text-foreground">
                    {t("targetEpisodes")}
                  </label>
                  <div className="flex flex-wrap gap-2">
                    {TARGET_EPISODES_OPTIONS.map((n) => (
                      <button
                        key={n}
                        type="button"
                        onClick={() => update({ targetEpisodes: n })}
                        className={cn(
                          "rounded-lg border px-3 py-1.5 text-xs font-medium transition-all",
                          form.targetEpisodes === n
                            ? "border-primary bg-primary/10 text-primary"
                            : "border-border bg-secondary text-muted-foreground"
                        )}
                      >
                        {n} {t("eps")}
                      </button>
                    ))}
                  </div>
                </div>
              </SectionCard>
            </div>
          )}

          {/* ── Promo Video ── */}
          {activeTab === "promo" && (
            <div className="space-y-6">
              <SectionCard title={t("editPromo")}>
                {form.promoVideo ? (
                  <div className="relative aspect-video w-full max-w-lg overflow-hidden rounded-xl border border-border bg-black">
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
                  <div className="flex aspect-video w-full max-w-lg flex-col items-center justify-center rounded-xl border-2 border-dashed border-border bg-secondary/50">
                    <IconVideo className="mb-2 size-10 text-muted-foreground/30" />
                    <p className="text-sm text-muted-foreground">{t("uploadPromo")}</p>
                    <p className="mt-1 text-xs text-muted-foreground/60">{t("promoSpec")}</p>
                    <button
                      type="button"
                      onClick={() => update({ promoVideo: "mock-video-url" })}
                      className="mt-4 rounded-lg bg-primary px-4 py-2 text-xs font-medium text-primary-foreground"
                    >
                      <IconUpload className="mr-1 inline size-3.5" /> {t("selectVideo")}
                    </button>
                  </div>
                )}
                <div className="flex items-start gap-2 rounded-lg bg-primary/5 p-3">
                  <IconInfoCircle className="mt-0.5 size-4 shrink-0 text-primary" />
                  <p className="text-xs leading-relaxed text-muted-foreground">{t("promoTip")}</p>
                </div>
              </SectionCard>
            </div>
          )}

          {/* ── Episodes ── */}
          {activeTab === "episodes" && (
            <div className="space-y-6">
              <SectionCard
                title={t("editEpisodes")}
                action={
                  <div className="flex items-center gap-2">
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
                }
              >
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
                          className="min-w-0 flex-1 rounded-lg border border-border bg-background px-3 py-1.5 text-sm focus:border-primary focus:outline-none"
                        />
                        <div className="flex items-center gap-1">
                          <span className="text-xs text-muted-foreground">{"\u00A5"}</span>
                          <input
                            type="number"
                            value={ep.price}
                            onChange={(e) =>
                              updateEpisode(i, { price: Number(e.target.value) || 0 })
                            }
                            className="w-20 rounded-lg border border-border bg-background px-2 py-1.5 text-center text-sm focus:border-primary focus:outline-none"
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
                <div className="flex items-start gap-2 rounded-lg bg-primary/5 p-3">
                  <IconInfoCircle className="mt-0.5 size-4 shrink-0 text-primary" />
                  <p className="text-xs leading-relaxed text-muted-foreground">{t("episodeTip")}</p>
                </div>
              </SectionCard>
            </div>
          )}

          {/* ── Funding ── */}
          {activeTab === "funding" && (
            <div className="space-y-6">
              <SectionCard title={t("editFunding")}>
                <div>
                  <label className="mb-2 block text-sm font-medium text-foreground">
                    {t("fundingMode")}
                  </label>
                  <div className="flex gap-2">
                    {(["investment", "presale"] as const).map((mode) => (
                      <button
                        key={mode}
                        type="button"
                        onClick={() => update({ fundingMode: mode })}
                        className={cn(
                          "flex-1 rounded-lg border px-4 py-2.5 text-sm font-medium transition-all",
                          form.fundingMode === mode
                            ? "border-primary bg-primary/10 text-primary"
                            : "border-border bg-secondary text-muted-foreground"
                        )}
                      >
                        {t(`mode_${mode}`)}
                      </button>
                    ))}
                  </div>
                </div>
                {form.fundingMode === "investment" ? (
                  <div className="grid grid-cols-2 gap-4">
                    <Field
                      label={t("valuation")}
                      value={form.valuation}
                      onChange={(v) => update({ valuation: v })}
                      type="number"
                    />
                    <Field
                      label={t("sharesOffered")}
                      value={form.sharesOffered}
                      onChange={(v) => update({ sharesOffered: v })}
                      type="number"
                      suffix="%"
                    />
                    <Field
                      label={t("totalShares")}
                      value={form.totalShares}
                      onChange={(v) => update({ totalShares: v })}
                      type="number"
                    />
                    <Field
                      label={t("deadline")}
                      value={form.deadline}
                      onChange={(v) => update({ deadline: v })}
                      type="date"
                    />
                  </div>
                ) : (
                  <div className="grid grid-cols-2 gap-4">
                    <Field
                      label={t("presalePrice")}
                      value={String(form.presalePrice)}
                      onChange={(v) => update({ presalePrice: Number(v) || 0 })}
                      type="number"
                    />
                    <Field
                      label={t("fullPrice")}
                      value={String(form.fullPrice)}
                      onChange={(v) => update({ fullPrice: Number(v) || 0 })}
                      type="number"
                    />
                    <Field
                      label={t("presaleTarget")}
                      value={String(form.presaleTarget)}
                      onChange={(v) => update({ presaleTarget: Number(v) || 0 })}
                      type="number"
                    />
                    <Field
                      label={t("presaleDeadline")}
                      value={form.presaleDeadline}
                      onChange={(v) => update({ presaleDeadline: v })}
                      type="date"
                    />
                  </div>
                )}
              </SectionCard>
            </div>
          )}

          {/* ── Rewards ── */}
          {activeTab === "rewards" && (
            <div className="space-y-6">
              <SectionCard title={t("editRewards")}>
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
                            {"\u00A5"}
                            {preset.amount} {preset.title}
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
                            {"\u00A5"}
                            {r.amount} {r.title}
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
              </SectionCard>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Helpers ─────────────────────────────────────────

function SectionCard({
  title,
  action,
  children,
}: {
  title: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-6">
      <div className="mb-5 flex items-center justify-between">
        <h2 className="text-sm font-bold text-foreground">{title}</h2>
        {action}
      </div>
      <div className="space-y-5">{children}</div>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  type = "text",
  suffix,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  suffix?: string;
}) {
  return (
    <div>
      <label className="mb-1.5 block text-xs font-medium text-foreground">{label}</label>
      <div className="relative">
        <input
          type={type}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
        />
        {suffix && (
          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
            {suffix}
          </span>
        )}
      </div>
    </div>
  );
}
