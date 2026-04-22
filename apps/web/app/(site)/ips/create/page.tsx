"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  IconArrowLeft,
  IconArrowRight,
  IconCheck,
  IconUpload,
  IconX,
  IconPlus,
  IconInfoCircle,
} from "@tabler/icons-react";
import { toast } from "sonner";
import { useTranslations } from "@/src/i18n/i18n";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

// ─── Constants ──────────────────────────────────────

const MOCK_CATEGORIES = [
  { value: "1", label: "AIGC影视" },
  { value: "2", label: "热血动漫" },
  { value: "3", label: "AI纪录片" },
  { value: "4", label: "文化传统" },
  { value: "5", label: "经典动画" },
  { value: "6", label: "AI经典改编" },
  { value: "7", label: "末日来临" },
  { value: "8", label: "爱情故事" },
  { value: "9", label: "AI科幻" },
];

const SUGGESTED_TAGS = [
  "AI Animation",
  "Cyberpunk",
  "Fantasy",
  "Sci-Fi",
  "Slice of Life",
  "Action",
  "Mystery",
  "Healing",
  "Chinese Style",
  "Mecha",
  "Post-Apocalyptic",
  "Romance",
  "Campus",
  "Horror",
];

const STEPS = [
  { label: "Basic Info" },
  { label: "Story" },
  { label: "Funding" },
  { label: "Rewards" },
  { label: "Preview" },
];

const EPISODE_OPTIONS = [3, 6, 8, 10, 12, 15];

const PRESET_REWARDS = [
  { id: "r1", title: "Supporter", amount: 30, perks: ["Early Access", "Credits"] },
  {
    id: "r2",
    title: "Early Bird",
    amount: 100,
    perks: ["Early Access", "Behind-the-Scenes", "Exclusive Discord"],
  },
  {
    id: "r3",
    title: "Super Fan",
    amount: 300,
    perks: ["All above", "Signed Poster", "Q&A Session"],
  },
  {
    id: "r4",
    title: "Co-Producer",
    amount: 1000,
    perks: ["All above", "Executive Producer Credit", "Revenue Share"],
  },
];

// ─── Form type ──────────────────────────────────────

interface CreateForm {
  title: string;
  projectType: string;
  description: string;
  tags: string[];
  coverImage: string | null;
  story: string;
  whyThisIP: string;
  targetEpisodes: number;
  fundingMode: "" | "investment" | "presale";
  valuation: string;
  sharesOffered: string;
  totalShares: string;
  deadline: string;
  presalePrice: number;
  fullPrice: number;
  presaleTarget: number;
  presaleDeadline: string;
  rewards: typeof PRESET_REWARDS;
}

// ─── Page ───────────────────────────────────────────

export default function CreateIPPage() {
  const t = useTranslations("ipCreate");
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [tagInput, setTagInput] = useState("");
  const [submitted, setSubmitted] = useState(false);

  const [form, setForm] = useState<CreateForm>({
    title: "",
    projectType: "",
    description: "",
    tags: [],
    coverImage: null,
    story: "",
    whyThisIP: "",
    targetEpisodes: 6,
    fundingMode: "",
    valuation: "",
    sharesOffered: "",
    totalShares: "",
    deadline: "",
    presalePrice: 30,
    fullPrice: 100,
    presaleTarget: 100,
    presaleDeadline: "",
    rewards: [],
  });

  const update = (patch: Partial<CreateForm>) => setForm((p) => ({ ...p, ...patch }));

  const addTag = (tag: string) => {
    const trimmed = tag.trim();
    if (trimmed && !form.tags.includes(trimmed) && form.tags.length < 10) {
      update({ tags: [...form.tags, trimmed] });
      setTagInput("");
    }
  };

  const canProceed = (): boolean => {
    switch (step) {
      case 0:
        return !!(form.title && form.projectType && form.description);
      case 1:
        return form.story.length >= 30 && !!form.whyThisIP;
      case 2:
        return form.fundingMode === "investment"
          ? !!(form.valuation && form.sharesOffered && form.totalShares)
          : form.fundingMode === "presale"
            ? form.presalePrice > 0 && form.presaleTarget > 0
            : false;
      case 3:
        return form.rewards.length > 0;
      default:
        return true;
    }
  };

  if (submitted) {
    return (
      <div className="flex min-h-[calc(100vh-3.5rem)] flex-col items-center justify-center px-6">
        <div className="flex size-20 items-center justify-center rounded-full bg-green-400/10">
          <IconCheck className="size-10 text-green-400" />
        </div>
        <h1 className="mt-6 text-2xl font-bold text-foreground">{t("successTitle")}</h1>
        <p className="mt-2 text-sm text-muted-foreground">{t("successDesc")}</p>
        <div className="mt-6 flex gap-3">
          <Button variant="outline" color="muted" asChild>
            <Link href="/studio/projects">{t("goToStudio")}</Link>
          </Button>
          <Button asChild>
            <Link href="/ips">{t("viewIPPlaza")}</Link>
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-[calc(100vh-3.5rem)] bg-background">
      {/* Header */}
      <div className="border-b border-border">
        <div className="mx-auto max-w-2xl px-6 py-6">
          <Link
            href="/ips"
            className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
          >
            <IconArrowLeft className="size-4" /> {t("backToPlaza")}
          </Link>
          <h1 className="flex items-center gap-2 text-xl font-bold text-foreground">
            {t("pageTitle")}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">{t("pageSubtitle")}</p>
        </div>
      </div>

      {/* Step indicator */}
      <div className="border-b border-border">
        <div className="mx-auto max-w-2xl px-6 py-4">
          <div className="flex items-center justify-center gap-2">
            {STEPS.map((s, i) => {
              const active = i === step;
              const done = i < step;
              return (
                <div key={i} className="flex items-center gap-2">
                  {i > 0 && <div className={cn("h-px w-8", done ? "bg-primary" : "bg-border")} />}
                  <button
                    type="button"
                    onClick={() => i <= step && setStep(i)}
                    disabled={i > step}
                    className={cn(
                      "flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors",
                      active
                        ? "bg-primary text-primary-foreground"
                        : done
                          ? "bg-primary/10 text-primary"
                          : "bg-secondary text-muted-foreground"
                    )}
                  >
                    {done ? (
                      <IconCheck className="size-3.5" />
                    ) : (
                      <span className="text-xs">{i + 1}</span>
                    )}
                    {s.label}
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="mx-auto max-w-2xl px-6 py-8">
        {/* ── Step 0: Basic Info ── */}
        {step === 0 && (
          <div className="space-y-6">
            <div>
              <label className="mb-2 block text-sm font-medium text-foreground">Cover Image</label>
              <div className="flex h-48 w-full cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed border-border bg-secondary/50 transition-colors hover:border-primary/50">
                <IconUpload className="mb-2 size-8 text-muted-foreground/50" />
                <p className="text-sm text-muted-foreground">Click or drag to upload cover</p>
                <p className="text-xs text-muted-foreground/60">Recommended: 1920×1080, max 5MB</p>
              </div>
            </div>

            <div>
              <label className="mb-2 block text-sm font-medium text-foreground">Title *</label>
              <Input
                value={form.title}
                onChange={(e) => update({ title: e.target.value })}
                placeholder="Enter your IP name"
                maxLength={50}
                className="h-10"
              />
              <p className="mt-1 text-right text-xs text-muted-foreground">
                {form.title.length}/50
              </p>
            </div>

            <div>
              <label className="mb-2 block text-sm font-medium text-foreground">
                Project Type *
              </label>
              <div className="flex flex-wrap gap-2">
                {MOCK_CATEGORIES.map((c) => (
                  <Button
                    key={c.value}
                    variant={form.projectType === c.value ? "soft" : "outline"}
                    color={form.projectType === c.value ? "primary" : "muted"}
                    size="sm"
                    onClick={() => update({ projectType: c.value })}
                  >
                    {c.label}
                  </Button>
                ))}
              </div>
            </div>

            <div>
              <label className="mb-2 block text-sm font-medium text-foreground">
                Description *
              </label>
              <Textarea
                value={form.description}
                onChange={(e) => update({ description: e.target.value })}
                placeholder="Describe your IP project..."
                maxLength={500}
                rows={4}
                className="min-h-24"
              />
              <p className="mt-1 text-right text-xs text-muted-foreground">
                {form.description.length}/500
              </p>
            </div>

            <div>
              <label className="mb-2 block text-sm font-medium text-foreground">
                Tags <span className="font-normal text-muted-foreground">(max 10)</span>
              </label>
              <div className="mb-3 flex items-center gap-2">
                <Input
                  value={tagInput}
                  onChange={(e) => setTagInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      addTag(tagInput);
                    }
                  }}
                  placeholder="Type a tag and press Enter"
                  className="h-9"
                />
                <Button size="sm" onClick={() => addTag(tagInput)} disabled={!tagInput.trim()}>
                  <IconPlus className="size-4" />
                </Button>
              </div>
              <div className="mb-3 flex flex-wrap gap-1.5">
                {SUGGESTED_TAGS.filter((t) => !form.tags.includes(t)).map((tag) => (
                  <button
                    key={tag}
                    type="button"
                    onClick={() => addTag(tag)}
                    className="rounded-full border border-border bg-secondary px-2.5 py-1 text-xs text-muted-foreground hover:border-primary/50 hover:text-primary"
                  >
                    + {tag}
                  </button>
                ))}
              </div>
              {form.tags.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {form.tags.map((tag) => (
                    <span
                      key={tag}
                      className="flex items-center gap-1 rounded-full bg-primary/10 px-2.5 py-1 text-xs text-primary"
                    >
                      #{tag}
                      <button
                        type="button"
                        onClick={() => update({ tags: form.tags.filter((t) => t !== tag) })}
                      >
                        <IconX className="size-3" />
                      </button>
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── Step 1: Story ── */}
        {step === 1 && (
          <div className="space-y-6">
            <div>
              <label className="mb-2 block text-sm font-medium text-foreground">
                Story Summary *
              </label>
              <Textarea
                value={form.story}
                onChange={(e) => update({ story: e.target.value })}
                placeholder="Describe your world-building, characters, and plot direction..."
                rows={8}
                maxLength={2000}
                className="min-h-48"
              />
              <p className="mt-1 text-right text-xs text-muted-foreground">
                {form.story.length}/2000
              </p>
            </div>

            <div>
              <label className="mb-2 block text-sm font-medium text-foreground">
                Why This IP *
              </label>
              <Textarea
                value={form.whyThisIP}
                onChange={(e) => update({ whyThisIP: e.target.value })}
                placeholder="What makes this project unique and worth supporting?"
                rows={4}
                maxLength={1000}
                className="min-h-24"
              />
            </div>

            <div>
              <label className="mb-2 block text-sm font-medium text-foreground">
                Target Episodes
              </label>
              <div className="flex flex-wrap gap-2">
                {EPISODE_OPTIONS.map((n) => (
                  <Button
                    key={n}
                    variant={form.targetEpisodes === n ? "soft" : "outline"}
                    color={form.targetEpisodes === n ? "primary" : "muted"}
                    size="sm"
                    onClick={() => update({ targetEpisodes: n })}
                  >
                    {n} eps
                  </Button>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* ── Step 2: Funding ── */}
        {step === 2 && (
          <div className="space-y-6">
            <div>
              <label className="mb-2 block text-sm font-medium text-foreground">
                Funding Mode *
              </label>
              <div className="flex gap-3">
                {(["investment", "presale"] as const).map((mode) => (
                  <Button
                    key={mode}
                    variant={form.fundingMode === mode ? "soft" : "outline"}
                    color={form.fundingMode === mode ? "primary" : "muted"}
                    className="flex-1 py-3"
                    onClick={() => update({ fundingMode: mode })}
                  >
                    {mode === "investment" ? "Equity Investment" : "Pre-sale"}
                  </Button>
                ))}
              </div>
            </div>

            {form.fundingMode === "investment" && (
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="mb-1.5 block text-xs text-muted-foreground">
                    IP Valuation (CNY)
                  </label>
                  <Input
                    type="number"
                    value={form.valuation}
                    onChange={(e) => update({ valuation: e.target.value })}
                    className="h-10"
                  />
                </div>
                <div>
                  <label className="mb-1.5 block text-xs text-muted-foreground">
                    Shares Offered (%)
                  </label>
                  <Input
                    type="number"
                    value={form.sharesOffered}
                    onChange={(e) => update({ sharesOffered: e.target.value })}
                    className="h-10"
                  />
                </div>
                <div>
                  <label className="mb-1.5 block text-xs text-muted-foreground">Total Shares</label>
                  <Input
                    type="number"
                    value={form.totalShares}
                    onChange={(e) => update({ totalShares: e.target.value })}
                    className="h-10"
                  />
                </div>
                <div>
                  <label className="mb-1.5 block text-xs text-muted-foreground">Deadline</label>
                  <Input
                    type="date"
                    value={form.deadline}
                    onChange={(e) => update({ deadline: e.target.value })}
                    className="h-10"
                  />
                </div>
              </div>
            )}

            {form.fundingMode === "presale" && (
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="mb-1.5 block text-xs text-muted-foreground">
                    Pre-sale Price (CNY)
                  </label>
                  <Input
                    type="number"
                    value={form.presalePrice}
                    onChange={(e) => update({ presalePrice: Number(e.target.value) || 0 })}
                    className="h-10"
                  />
                </div>
                <div>
                  <label className="mb-1.5 block text-xs text-muted-foreground">
                    Full Price (CNY)
                  </label>
                  <Input
                    type="number"
                    value={form.fullPrice}
                    onChange={(e) => update({ fullPrice: Number(e.target.value) || 0 })}
                    className="h-10"
                  />
                </div>
                <div>
                  <label className="mb-1.5 block text-xs text-muted-foreground">
                    Target Backers
                  </label>
                  <Input
                    type="number"
                    value={form.presaleTarget}
                    onChange={(e) => update({ presaleTarget: Number(e.target.value) || 0 })}
                    className="h-10"
                  />
                </div>
                <div>
                  <label className="mb-1.5 block text-xs text-muted-foreground">Deadline</label>
                  <Input
                    type="date"
                    value={form.presaleDeadline}
                    onChange={(e) => update({ presaleDeadline: e.target.value })}
                    className="h-10"
                  />
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── Step 3: Rewards ── */}
        {step === 3 && (
          <div className="space-y-6">
            <div className="grid grid-cols-2 gap-3">
              {PRESET_REWARDS.map((r) => {
                const added = form.rewards.some((rr) => rr.id === r.id);
                return (
                  <button
                    key={r.id}
                    type="button"
                    onClick={() =>
                      added
                        ? update({ rewards: form.rewards.filter((rr) => rr.id !== r.id) })
                        : update({ rewards: [...form.rewards, r] })
                    }
                    className={cn(
                      "rounded-xl border p-4 text-left transition-all",
                      added
                        ? "border-primary/40 bg-primary/5"
                        : "border-border hover:border-border/80"
                    )}
                  >
                    <div className="mb-1 flex items-center justify-between">
                      <span className="text-sm font-semibold text-foreground">
                        ¥{r.amount} {r.title}
                      </span>
                      {added && <span className="text-xs text-primary">Added</span>}
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {r.perks.map((p) => (
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
          </div>
        )}

        {/* ── Step 4: Preview ── */}
        {step === 4 && (
          <div className="space-y-4">
            <div className="rounded-xl border border-border bg-card p-6">
              <h3 className="mb-4 text-sm font-bold text-foreground">Preview</h3>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Title</span>
                  <span className="text-foreground">{form.title || "—"}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Type</span>
                  <span className="text-foreground">
                    {MOCK_CATEGORIES.find((c) => c.value === form.projectType)?.label || "—"}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Tags</span>
                  <span className="text-foreground">{form.tags.length} tags</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Episodes</span>
                  <span className="text-foreground">{form.targetEpisodes}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Funding</span>
                  <span className="text-foreground">{form.fundingMode || "—"}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Rewards</span>
                  <span className="text-foreground">{form.rewards.length} tiers</span>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Nav buttons */}
        <div className="mt-8 flex items-center justify-between">
          <Button
            variant="outline"
            color="muted"
            onClick={() => setStep((s) => s - 1)}
            disabled={step === 0}
          >
            <IconArrowLeft className="size-4" /> Previous
          </Button>
          {step < 4 ? (
            <Button onClick={() => setStep((s) => s + 1)} disabled={!canProceed()}>
              Next <IconArrowRight className="size-4" />
            </Button>
          ) : (
            <Button className="bg-green-500 hover:bg-green-600" onClick={() => setSubmitted(true)}>
              <IconCheck className="size-4" /> Submit & Publish
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
