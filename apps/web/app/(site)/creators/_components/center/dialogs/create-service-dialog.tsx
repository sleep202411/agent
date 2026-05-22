"use client";

/**
 * Create / edit a CreatorService — Fiverr-style 3-step wizard.
 *
 *   Step 1 · Overview   title · pitch · category · tags
 *   Step 2 · Pricing    3-column tier table (basic / std / premium),
 *                       single currency locked across tiers,
 *                       tier-specific smart placeholders
 *   Step 3 · Preview    read-only render via ServiceDetailSections
 *                       — exactly what buyers will see
 *
 * State machine:
 *
 *   Save Draft (any step)  → creates on first call, PATCHes after.
 *   `savedId` captures the row id the first time so subsequent
 *   saves stay on the same row. Mode flips create→edit invisibly.
 *
 *   Publish (only on step 3) → fires final PATCH (if dirty) then
 *   /publish. Requires ≥ 1 enabled tier + title + summary.
 *
 *   Back / Next navigate the wizard without persisting; data only
 *   persists when Save Draft / Publish is clicked.
 *
 * Why a wizard vs the prior single dialog:
 *
 *   Fiverr's research (and ours by inspection) shows tier-priced
 *   service authoring is most legible when the creator builds in
 *   *one concept per surface*: overview, then pricing, then preview.
 *   The single-dialog version forced everyone to mentally page
 *   through "title, summary, tags, basic title, basic desc, basic
 *   price, basic days..." which is high cognitive load and tends
 *   to produce thinner copy. The wizard imitates the Fiverr flow
 *   that's proven for this exact category of UX.
 */

import { useEffect, useMemo, useState } from "react";
import { IconChevronDown, IconLoader2 } from "@tabler/icons-react";
import { toast } from "sonner";
import {
  SERVICE_CATEGORIES,
  SERVICE_TIERS,
  UNLIMITED_REVISIONS,
  type CreatorServiceDTO,
  type ServiceCategory,
  type ServicePackageDTO,
  type ServiceTier,
} from "@repo/shared/creator-service";
import { ZERO_DECIMAL_CURRENCIES, type CurrencyCode } from "@repo/shared/crew";
import { useTranslations } from "@/src/i18n/i18n";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHero,
} from "@/components/ui/dialog";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { TagInput } from "@/components/ui/tag-input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { env } from "@/src/env";
import { cn } from "@/lib/utils";
import {
  ServiceApiError,
  useCreateService,
  usePublishService,
  useUpdateService,
  type CreateServiceBody,
  type ServicePackageInput,
  type UpdateServiceBody,
} from "@/app/(site)/creators/_hooks/use-creator-services";
import { ServiceDetailSections } from "./service-detail-sections";

const HERO_URL =
  "https://fizzdragonblob.blob.core.windows.net/foundry-outputs/web-assets/creator-service/creator-service-dialog-hero-20260521.png";

// ─── Currency policy ────────────────────────────────────────

// Mirrors the cell-aware server check. Future: derive from a
// `/aurora/currency/policy` endpoint so the list is server-owned.
const COM_CURRENCIES: CurrencyCode[] = [
  "USD",
  "EUR",
  "GBP",
  "JPY",
  "HKD",
  "AUD",
  "CAD",
  "SGD",
  "CNY",
];
const CN_CURRENCIES: CurrencyCode[] = ["CNY"];

function defaultCurrencyForCell(): CurrencyCode {
  const banner = env.BANNER_BASE_URL ?? "";
  return /\.cn|\.aliyuncs\.com/.test(banner) ? "CNY" : "USD";
}

function allowedCurrenciesForCell(): CurrencyCode[] {
  return defaultCurrencyForCell() === "CNY" ? CN_CURRENCIES : COM_CURRENCIES;
}

// ─── Form state ─────────────────────────────────────────────

interface TierFormState {
  enabled: boolean;
  title: string;
  description: string;
  priceText: string;
  deliveryDays: number;
  revisions: number;
  scopeText: string;
}

function blankTier(): TierFormState {
  return {
    enabled: false,
    title: "",
    description: "",
    priceText: "",
    deliveryDays: 7,
    revisions: 1,
    scopeText: "",
  };
}

function tierFromDTO(p: ServicePackageDTO): TierFormState {
  return {
    enabled: true,
    title: p.title,
    description: p.description,
    priceText: String(p.price),
    deliveryDays: p.deliveryDays,
    revisions: p.revisions,
    scopeText: p.scope.join("\n"),
  };
}

function tierToWire(
  tier: ServiceTier,
  s: TierFormState,
  currency: CurrencyCode
): ServicePackageInput | null {
  if (!s.enabled) return null;
  const price = Number(s.priceText.trim());
  return {
    tier,
    title: s.title.trim(),
    description: s.description.trim(),
    currency,
    price: Number.isFinite(price) ? price : 0,
    deliveryDays: s.deliveryDays,
    revisions: s.revisions,
    scope: s.scopeText
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean),
  };
}

// ─── Step config ────────────────────────────────────────────

type StepId = "overview" | "pricing" | "questions" | "preview";
const STEPS: StepId[] = ["overview", "pricing", "questions", "preview"];

/**
 * Form-state shape for a single requirement question. `id` is the
 * stable identifier — server-minted ids are kept so subsequent
 * edits / order-answer references stay aligned (see
 * `questionToRow` in CreatorServicesService).
 */
interface QuestionFormState {
  id: string;
  prompt: string;
  helpText: string;
  required: boolean;
}

/** Local-only id token used until the row gets a server-side id. */
function localQuestionId(): string {
  return `local-${Math.random().toString(36).slice(2, 11)}`;
}

function blankQuestion(): QuestionFormState {
  return {
    id: localQuestionId(),
    prompt: "",
    helpText: "",
    required: false,
  };
}

function questionFromDTO(q: {
  id: string;
  prompt: string;
  helpText: string;
  required: boolean;
}): QuestionFormState {
  return {
    id: q.id,
    prompt: q.prompt,
    helpText: q.helpText,
    required: q.required,
  };
}

function questionsToWire(qs: QuestionFormState[]) {
  return qs
    .map((q, displayOrder) => {
      const prompt = q.prompt.trim();
      if (prompt.length === 0) return null;
      // Only send `id` to the server when it's a real server id; the
      // local- prefix sentinel signals "new — mint one".
      const isLocal = q.id.startsWith("local-");
      return {
        ...(isLocal ? {} : { id: q.id }),
        prompt,
        helpText: q.helpText.trim(),
        required: q.required,
        displayOrder,
      };
    })
    .filter((q): q is Exclude<typeof q, null> => q !== null);
}

// ─── Component ──────────────────────────────────────────────

interface CreateServiceDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initial?: CreatorServiceDTO | null;
  onSaved?: (service: CreatorServiceDTO) => void;
}

export function CreateServiceDialog({
  open,
  onOpenChange,
  initial,
  onSaved,
}: CreateServiceDialogProps) {
  const t = useTranslations("creatorService");
  const tc = useTranslations("common");

  const defaultCurrency = useMemo(() => defaultCurrencyForCell(), []);
  const allowedCurrencies = useMemo(() => allowedCurrenciesForCell(), []);

  // ─── State ──────────────────────────────────────
  const [step, setStep] = useState<StepId>("overview");

  /**
   * Row id we've persisted to. NULL until the first Save Draft (or
   * initial-edit mode). After first save the dialog silently flips
   * to PATCH mode for the rest of the session.
   */
  const [savedId, setSavedId] = useState<string | null>(null);
  // Service-level
  const [title, setTitle] = useState("");
  const [summary, setSummary] = useState("");
  const [category, setCategory] = useState<ServiceCategory>("video_production");
  const [tags, setTags] = useState<string[]>([]);
  // Currency lives at the service level — a service uses one currency.
  // Multi-currency per tier would confuse buyer comparison.
  const [currency, setCurrency] = useState<CurrencyCode>(defaultCurrency);
  // Tier rows
  const [tiers, setTiers] = useState<Record<ServiceTier, TierFormState>>(() => ({
    basic: blankTier(),
    standard: blankTier(),
    premium: blankTier(),
  }));
  // Pre-order questionnaire — list of rows the creator pre-defines
  // for buyers to answer at order time.
  const [questions, setQuestions] = useState<QuestionFormState[]>([]);
  // Concurrency token for PATCH.
  const [expectedVersion, setExpectedVersion] = useState<number | undefined>(undefined);

  // ─── Reset / prefill on open ─────────────────────
  // Intentional setState-in-effect: the trigger is the `open`
  // prop flipping false→true. A key-prop remount would also work
  // but would lose the parent's hold on the dialog instance. See
  // contact-creator-dialog.tsx for the same pattern.
  useEffect(() => {
    if (!open) return;
    /* eslint-disable react-hooks/set-state-in-effect */
    if (initial) {
      setStep("overview");
      setSavedId(initial.id);
      setTitle(initial.title);
      setSummary(initial.summary);
      setCategory(initial.category);
      setTags(initial.tags);
      setCurrency((initial.packages[0]?.currency as CurrencyCode | undefined) ?? defaultCurrency);
      const byTier: Record<ServiceTier, TierFormState> = {
        basic: blankTier(),
        standard: blankTier(),
        premium: blankTier(),
      };
      for (const p of initial.packages) byTier[p.tier] = tierFromDTO(p);
      setTiers(byTier);
      setQuestions(initial.requirementQuestions.map(questionFromDTO));
      setExpectedVersion(initial.version);
    } else {
      setStep("overview");
      setSavedId(null);
      setTitle("");
      setSummary("");
      setCategory("video_production");
      setTags([]);
      setCurrency(defaultCurrency);
      // Start with no tiers enabled — auto-enabling Basic was
      // friendlier on paper but caused 400s when the user hit Save
      // Draft on step 1 (server rejects packages with blank
      // title/description). Empty packages array is a valid draft;
      // user enables + fills tiers on step 2 when they're ready.
      setTiers({
        basic: blankTier(),
        standard: blankTier(),
        premium: blankTier(),
      });
      setQuestions([]);
      setExpectedVersion(undefined);
    }
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [open, initial, defaultCurrency]);

  // ─── Mutations ──────────────────────────────────
  const create = useCreateService();
  const update = useUpdateService();
  const publish = usePublishService();
  const busy = create.isPending || update.isPending || publish.isPending;

  const enabledCount = SERVICE_TIERS.filter((t) => tiers[t].enabled).length;
  const overviewReady = title.trim().length > 0 && summary.trim().length > 0;
  const canPublish = overviewReady && enabledCount > 0;

  const updateTier = (tier: ServiceTier, patch: Partial<TierFormState>) =>
    setTiers((prev) => ({ ...prev, [tier]: { ...prev[tier], ...patch } }));

  const reportError = (err: unknown, fallback: string) => {
    if (err instanceof ServiceApiError) {
      const body =
        typeof err.body === "object" && err.body && "message" in err.body
          ? String((err.body as { message: unknown }).message)
          : typeof err.body === "string"
            ? err.body.slice(0, 800)
            : err.message;
      toast.error(`HTTP ${err.status}`, { description: body, duration: 10000 });
    } else {
      toast.error(err instanceof Error ? err.message : fallback);
    }
  };

  const buildBody = (forUpdate: boolean): CreateServiceBody | UpdateServiceBody => {
    const packages = SERVICE_TIERS.map((tier) => tierToWire(tier, tiers[tier], currency)).filter(
      (p): p is ServicePackageInput => p !== null
    );
    const requirementQuestions = questionsToWire(questions);
    const base = {
      title: title.trim(),
      summary: summary.trim(),
      category,
      tags,
      packages,
      requirementQuestions,
    };
    if (forUpdate && expectedVersion !== undefined) {
      return { ...base, expectedVersion } satisfies UpdateServiceBody;
    }
    return base;
  };

  /**
   * Find the first enabled tier missing a required field, so we can
   * surface a specific actionable message instead of letting the
   * server 400 with a `packages.0.title` path the user can't read.
   * Returns null when all enabled tiers are wire-ready.
   */
  const findIncompleteTier = (): { tier: ServiceTier; field: "title" | "description" } | null => {
    for (const tier of SERVICE_TIERS) {
      const s = tiers[tier];
      if (!s.enabled) continue;
      if (!s.title.trim()) return { tier, field: "title" };
      if (!s.description.trim()) return { tier, field: "description" };
    }
    return null;
  };

  /**
   * Persist current form state. First call creates and captures
   * `savedId`; subsequent calls PATCH the same row. Stays open on
   * the current step so the user can keep editing.
   */
  const persist = async (): Promise<CreatorServiceDTO | null> => {
    if (!overviewReady) {
      toast.error(t("missingRequired"));
      return null;
    }
    // Server's PackageInputSchema requires non-blank title +
    // description on every shipped package. If the user has enabled
    // a tier but left it blank, surface a targeted message and bail
    // before the request rather than dumping a 400 / Zod path on
    // them.
    const incomplete = findIncompleteTier();
    if (incomplete) {
      toast.error(
        t("tierIncomplete", {
          tier: t(`tier.${incomplete.tier}`),
          field: t(`tierField.${incomplete.field}`),
        })
      );
      return null;
    }
    try {
      let saved: CreatorServiceDTO;
      if (savedId) {
        saved = await update.mutateAsync({
          id: savedId,
          body: buildBody(true) as UpdateServiceBody,
        });
      } else {
        saved = await create.mutateAsync(buildBody(false) as CreateServiceBody);
        setSavedId(saved.id);
      }
      setExpectedVersion(saved.version);
      return saved;
    } catch (err) {
      reportError(err, savedId ? t("saveFailed") : t("createFailed"));
      return null;
    }
  };

  const handleSaveDraft = async () => {
    const saved = await persist();
    if (!saved) return;
    toast.success(savedId ? t("savedToast") : t("createdToast"));
  };

  const handlePublish = async () => {
    if (!canPublish) {
      toast.error(t("publishNeedsTier"));
      return;
    }
    const saved = await persist();
    if (!saved) return;
    try {
      const published =
        saved.status === "listed" ? saved : await publish.mutateAsync({ id: saved.id });
      toast.success(t("publishedToast"));
      onSaved?.(published);
      onOpenChange(false);
    } catch (err) {
      reportError(err, t("saveFailed"));
    }
  };

  // ─── Step navigation gates ───────────────────────
  // Going from overview → pricing requires title + summary;
  // pricing → questions requires at least one enabled, non-blank
  // tier; questions step is always valid (questionnaire is optional).
  // Preview requires canPublish (title + ≥ 1 enabled tier).
  const stepValid: Record<StepId, boolean> = {
    overview: overviewReady,
    pricing:
      enabledCount > 0 &&
      SERVICE_TIERS.every((k) => !tiers[k].enabled || tiers[k].title.trim().length > 0),
    questions: true,
    preview: canPublish,
  };

  const goNext = () => {
    const i = STEPS.indexOf(step);
    if (i < STEPS.length - 1) setStep(STEPS[i + 1]);
  };
  const goBack = () => {
    const i = STEPS.indexOf(step);
    if (i > 0) setStep(STEPS[i - 1]);
  };

  // ─── Preview DTO (built from form state for the preview step) ─
  const previewService: CreatorServiceDTO = useMemo(
    () => ({
      id: savedId ?? "preview",
      creatorId: initial?.creatorId ?? "preview",
      title: title.trim() || t("previewTitleFallback"),
      summary: summary.trim() || t("previewSummaryFallback"),
      coverPath: "",
      category,
      tags,
      status: "draft",
      publishedAt: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      version: 0,
      packages: SERVICE_TIERS.map((tier) => tierToWire(tier, tiers[tier], currency))
        .filter((p): p is ServicePackageInput => p !== null)
        .map((p, i) => ({
          // Synthetic ids so map keys stay stable across re-renders.
          id: `preview-${p.tier}-${i}`,
          tier: p.tier,
          title: p.title,
          description: p.description,
          price: p.price,
          currency: p.currency as CurrencyCode,
          deliveryDays: p.deliveryDays,
          revisions: p.revisions,
          scope: p.scope,
        })),
      requirementQuestions: questions.map((q, i) => ({
        id: q.id,
        prompt: q.prompt.trim() || t("questionPreviewPlaceholder"),
        helpText: q.helpText.trim(),
        required: q.required,
        displayOrder: i,
      })),
    }),
    [savedId, initial?.creatorId, title, summary, category, tags, tiers, currency, questions, t]
  );

  // ─── Render ─────────────────────────────────────
  const isLastStep = step === "preview";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[92vh] max-w-3xl flex-col overflow-hidden p-0 sm:max-w-3xl">
        <DialogHero
          src={HERO_URL}
          eyebrow={savedId || initial ? t("heroEyebrowEdit") : t("heroEyebrowCreate")}
          title={savedId || initial ? t("editTitle") : t("createTitle")}
          description={t("subtitle")}
          height="h-28 sm:h-44"
          className="shrink-0"
        />

        <StepIndicator
          steps={STEPS}
          current={step}
          stepValid={stepValid}
          onJump={(target) => {
            // Allow jumping back freely; jumping forward requires
            // all prior steps to be valid so we don't land on
            // pricing with an empty overview.
            const ti = STEPS.indexOf(target);
            const ci = STEPS.indexOf(step);
            if (ti <= ci) return setStep(target);
            for (let i = 0; i < ti; i++) {
              if (!stepValid[STEPS[i]]) return;
            }
            setStep(target);
          }}
        />

        <DialogBody className="min-h-0 flex-1 overflow-y-auto p-3 sm:p-5">
          {step === "overview" ? (
            <OverviewStep
              title={title}
              setTitle={setTitle}
              summary={summary}
              setSummary={setSummary}
              category={category}
              setCategory={setCategory}
              tags={tags}
              setTags={setTags}
            />
          ) : null}
          {step === "pricing" ? (
            <PricingStep
              currency={currency}
              setCurrency={setCurrency}
              allowedCurrencies={allowedCurrencies}
              tiers={tiers}
              updateTier={updateTier}
            />
          ) : null}
          {step === "questions" ? (
            <QuestionsStep questions={questions} setQuestions={setQuestions} />
          ) : null}
          {step === "preview" ? <PreviewStep service={previewService} /> : null}
        </DialogBody>

        <DialogFooter className="shrink-0">
          <div className="flex w-full items-center justify-between gap-2">
            <div>
              {step !== "overview" ? (
                <Button
                  type="button"
                  variant="ghost"
                  color="muted"
                  onClick={goBack}
                  disabled={busy}
                >
                  {t("wizardBack")}
                </Button>
              ) : (
                <Button
                  type="button"
                  variant="ghost"
                  color="muted"
                  onClick={() => onOpenChange(false)}
                  disabled={busy}
                >
                  {tc("cancel")}
                </Button>
              )}
            </div>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                color="muted"
                onClick={handleSaveDraft}
                disabled={busy || !overviewReady}
              >
                {(create.isPending || update.isPending) && !publish.isPending ? (
                  <IconLoader2 className="size-4 animate-spin" />
                ) : null}
                {t("saveDraft")}
              </Button>
              {!isLastStep ? (
                <Button type="button" onClick={goNext} disabled={busy || !stepValid[step]}>
                  {t("wizardNext")}
                </Button>
              ) : (
                <Button type="button" onClick={handlePublish} disabled={busy || !canPublish}>
                  {publish.isPending ? <IconLoader2 className="size-4 animate-spin" /> : null}
                  {t("savePublish")}
                </Button>
              )}
            </div>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Step indicator ─────────────────────────────────────────

function StepIndicator({
  steps,
  current,
  stepValid,
  onJump,
}: {
  steps: StepId[];
  current: StepId;
  stepValid: Record<StepId, boolean>;
  onJump: (s: StepId) => void;
}) {
  const t = useTranslations("creatorService");
  const currentIdx = steps.indexOf(current);
  return (
    <nav
      aria-label="wizard"
      className="flex shrink-0 items-center justify-center gap-1.5 border-b border-border bg-card/40 px-3 py-2.5 sm:gap-2 sm:px-4 sm:py-3"
    >
      {steps.map((s, i) => {
        const active = s === current;
        const idx = i + 1;
        const valid = stepValid[s];
        // Mobile space-saving: only the active chip shows its
        // label; non-active chips collapse to just a numbered
        // circle. On sm+ all labels render. Connector lines also
        // shrink on mobile.
        const showLabelMobile = active;
        return (
          <div key={s} className="flex items-center gap-1.5 sm:gap-2">
            <button
              type="button"
              onClick={() => onJump(s)}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full px-2 py-1 text-xs font-medium transition-colors sm:gap-2 sm:px-3 sm:py-1.5",
                active
                  ? "bg-primary/15 text-primary"
                  : valid
                    ? "text-muted-foreground hover:text-foreground"
                    : "text-muted-foreground/60"
              )}
              aria-label={t(`wizard.${s}`)}
              aria-current={active ? "step" : undefined}
            >
              <span
                className={cn(
                  "inline-flex size-5 items-center justify-center rounded-full text-[10px] font-bold tabular-nums",
                  active
                    ? "bg-primary text-primary-foreground"
                    : "bg-secondary text-muted-foreground"
                )}
              >
                {idx}
              </span>
              <span className={cn(showLabelMobile ? "inline" : "hidden sm:inline")}>
                {t(`wizard.${s}`)}
              </span>
            </button>
            {i < steps.length - 1 ? <span className="h-px w-3 bg-border sm:w-6" /> : null}
          </div>
        );
      })}
      {/* Screen-reader hint: surfaces "step 2 of 4" so AT users
          know progress without parsing the chips visually. */}
      <span className="sr-only">
        Step {currentIdx + 1} of {steps.length}
      </span>
    </nav>
  );
}

// ─── Step 1 · Overview ──────────────────────────────────────

function OverviewStep({
  title,
  setTitle,
  summary,
  setSummary,
  category,
  setCategory,
  tags,
  setTags,
}: {
  title: string;
  setTitle: (v: string) => void;
  summary: string;
  setSummary: (v: string) => void;
  category: ServiceCategory;
  setCategory: (v: ServiceCategory) => void;
  tags: string[];
  setTags: (v: string[]) => void;
}) {
  const t = useTranslations("creatorService");
  return (
    <FieldGroup>
      <Field>
        <FieldLabel required>{t("fieldTitle")}</FieldLabel>
        <Input
          value={title}
          onChange={(e) => setTitle(e.target.value.slice(0, 120))}
          placeholder={t("fieldTitlePlaceholder")}
          maxLength={120}
        />
        <FieldDescription>{t("fieldTitleHint")}</FieldDescription>
      </Field>

      <Field>
        <FieldLabel required>{t("fieldSummary")}</FieldLabel>
        <Textarea
          value={summary}
          onChange={(e) => setSummary(e.target.value.slice(0, 1000))}
          placeholder={t("fieldSummaryPlaceholder")}
          rows={4}
          maxLength={1000}
          className="max-h-40 overflow-y-auto"
        />
        <FieldDescription>{summary.length} / 1000</FieldDescription>
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field>
          <FieldLabel>{t("fieldCategory")}</FieldLabel>
          <NativeSelect value={category} onChange={(v) => setCategory(v as ServiceCategory)}>
            {SERVICE_CATEGORIES.map((c) => (
              <NativeSelectOption key={c} value={c}>
                {t(`category.${c}`)}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </Field>
        <Field>
          <FieldLabel>{t("fieldTags")}</FieldLabel>
          <TagInput
            value={tags}
            onChange={setTags}
            maxTags={10}
            maxLength={48}
            placeholder={t("fieldTagsPlaceholder")}
          />
        </Field>
      </div>
    </FieldGroup>
  );
}

// ─── Step 2 · Pricing ───────────────────────────────────────

function PricingStep({
  currency,
  setCurrency,
  allowedCurrencies,
  tiers,
  updateTier,
}: {
  currency: CurrencyCode;
  setCurrency: (v: CurrencyCode) => void;
  allowedCurrencies: CurrencyCode[];
  tiers: Record<ServiceTier, TierFormState>;
  updateTier: (tier: ServiceTier, patch: Partial<TierFormState>) => void;
}) {
  const t = useTranslations("creatorService");
  return (
    <div className="space-y-4">
      {/* Currency selector — single source of truth for all 3 tiers. */}
      <div className="flex items-center justify-between gap-3 rounded-lg bg-card/40 px-4 py-3">
        <div className="space-y-0.5">
          <h3 className="text-sm font-medium text-foreground">{t("pricingCurrencyLabel")}</h3>
          <p className="text-xs text-muted-foreground">{t("pricingCurrencyHint")}</p>
        </div>
        <NativeSelect
          value={currency}
          onChange={(v) => setCurrency(v as CurrencyCode)}
          className="w-28"
        >
          {allowedCurrencies.map((c) => (
            <NativeSelectOption key={c} value={c}>
              {c}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      </div>

      {/* Vertical accordion. Side-by-side three columns sounded right
          on paper (Fiverr does it) but inside a 768px dialog each
          column ends up ~200px wide — textareas, scope bullets, and
          field hints all wrap badly. Accordion gives each tier the
          full dialog width, which is the readability win that
          matters more than the Fiverr-style visual comparison
          (preview step covers that). */}
      <div className="space-y-2">
        {SERVICE_TIERS.map((tier) => (
          <TierPanel
            key={tier}
            tier={tier}
            state={tiers[tier]}
            currency={currency}
            onChange={(patch) => updateTier(tier, patch)}
          />
        ))}
      </div>
    </div>
  );
}

function TierPanel({
  tier,
  state,
  currency,
  onChange,
}: {
  tier: ServiceTier;
  state: TierFormState;
  currency: CurrencyCode;
  onChange: (patch: Partial<TierFormState>) => void;
}) {
  const t = useTranslations("creatorService");
  const symbol = currencySymbol(currency);
  const isZero = ZERO_DECIMAL_CURRENCIES.has(currency);
  const priceStep = isZero ? "1" : "0.01";
  const unlimited = state.revisions === UNLIMITED_REVISIONS;
  const [expanded, setExpanded] = useState(state.enabled);

  // Intentional setState-in-effect: when the tier toggle flips
  // off→on, force the tier card to expand so the creator sees
  // the fields they need to fill. Doing this in handler would
  // miss programmatic enabling (e.g. prefill from initial DTO).
  useEffect(() => {
    if (state.enabled) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setExpanded(true);
    }
  }, [state.enabled]);

  return (
    <div
      className={cn(
        "rounded-md bg-card/50 transition-colors",
        state.enabled && "bg-card ring-1 ring-primary/30"
      )}
    >
      {/* Header row: checkbox + tier name + chevron (or hint).
          Tooltip explanation lives in the disabled-state body
          instead of a hover icon. */}
      <div className="flex items-center gap-2.5 px-3 py-2.5">
        <Checkbox
          checked={state.enabled}
          onCheckedChange={(v) => onChange({ enabled: v === true })}
          aria-label={t(`tier.${tier}`)}
        />
        <button
          type="button"
          onClick={() => state.enabled && setExpanded((x) => !x)}
          disabled={!state.enabled}
          className="flex flex-1 items-center justify-between gap-2 text-left disabled:cursor-default"
        >
          <span className="flex items-center gap-2 text-sm font-medium text-foreground">
            {t(`tier.${tier}`)}
            {tier === "premium" ? (
              <span className="inline-flex items-center rounded-full bg-primary/15 px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wider text-primary">
                {t("tierPremiumBadge")}
              </span>
            ) : null}
            {state.enabled && state.priceText ? (
              <span className="text-xs font-normal tabular-nums text-muted-foreground">
                · {symbol}
                {state.priceText}
              </span>
            ) : null}
          </span>
          {state.enabled ? (
            <IconChevronDown
              className={cn(
                "size-4 text-muted-foreground transition-transform",
                expanded && "rotate-180"
              )}
            />
          ) : (
            <span className="text-[11px] text-muted-foreground">{t("tierTurnOn")}</span>
          )}
        </button>
      </div>

      {!state.enabled ? (
        <p className="border-t border-border px-3 py-3 text-[11px] leading-relaxed text-muted-foreground/80">
          {t(`tierDisabledHint.${tier}`)}
        </p>
      ) : expanded ? (
        <div className="space-y-3 border-t border-border px-3 py-3">
          <Field>
            <FieldLabel required>{t("tierFieldTitle")}</FieldLabel>
            <Input
              value={state.title}
              onChange={(e) => onChange({ title: e.target.value.slice(0, 80) })}
              placeholder={t(`tierTitlePlaceholder.${tier}`)}
              maxLength={80}
            />
          </Field>

          <Field>
            <FieldLabel required>{t("tierFieldDescription")}</FieldLabel>
            <Textarea
              value={state.description}
              onChange={(e) => onChange({ description: e.target.value.slice(0, 2000) })}
              placeholder={t(`tierDescPlaceholder.${tier}`)}
              rows={3}
              maxLength={2000}
              className="max-h-32 overflow-y-auto"
            />
          </Field>

          <div className="grid gap-3 sm:grid-cols-3">
            <Field>
              <FieldLabel required>{t("tierFieldPrice")}</FieldLabel>
              <div className="relative">
                <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                  {symbol}
                </span>
                <Input
                  type="number"
                  inputMode={isZero ? "numeric" : "decimal"}
                  step={priceStep}
                  min={0}
                  value={state.priceText}
                  onChange={(e) => onChange({ priceText: e.target.value })}
                  className="pl-8"
                  placeholder="0"
                />
              </div>
            </Field>

            <Field>
              <FieldLabel required>{t("tierFieldDeliveryDays")}</FieldLabel>
              <Input
                type="number"
                inputMode="numeric"
                min={1}
                max={365}
                value={state.deliveryDays}
                onChange={(e) =>
                  onChange({
                    deliveryDays: clamp(Number(e.target.value) || 0, 1, 365),
                  })
                }
              />
            </Field>

            <Field>
              <FieldLabel required>{t("tierFieldRevisions")}</FieldLabel>
              <div className="flex items-center gap-2">
                <Input
                  type="number"
                  inputMode="numeric"
                  min={0}
                  max={200}
                  disabled={unlimited}
                  value={unlimited ? "" : state.revisions}
                  onChange={(e) =>
                    onChange({
                      revisions: clamp(Number(e.target.value) || 0, 0, 200),
                    })
                  }
                  placeholder={unlimited ? "∞" : "0"}
                  className="flex-1"
                />
                <label className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap text-[11px] text-muted-foreground">
                  <Checkbox
                    checked={unlimited}
                    onCheckedChange={(v) =>
                      onChange({
                        revisions: v === true ? UNLIMITED_REVISIONS : 0,
                      })
                    }
                    className="size-3.5"
                  />
                  {t("revisionsUnlimited")}
                </label>
              </div>
            </Field>
          </div>

          <Field>
            <FieldLabel>{t("tierFieldScope")}</FieldLabel>
            <Textarea
              value={state.scopeText}
              onChange={(e) => onChange({ scopeText: e.target.value })}
              placeholder={t(`tierScopePlaceholder.${tier}`)}
              rows={3}
              className="max-h-32 overflow-y-auto"
            />
          </Field>
        </div>
      ) : null}
    </div>
  );
}

// ─── Step 3 · Requirement questions ─────────────────────────

const MAX_QUESTIONS = 20;

function QuestionsStep({
  questions,
  setQuestions,
}: {
  questions: QuestionFormState[];
  setQuestions: React.Dispatch<React.SetStateAction<QuestionFormState[]>>;
}) {
  const t = useTranslations("creatorService");

  const addQuestion = () =>
    setQuestions((qs) => (qs.length >= MAX_QUESTIONS ? qs : [...qs, blankQuestion()]));

  const removeAt = (i: number) => setQuestions((qs) => qs.filter((_, idx) => idx !== i));

  const move = (i: number, delta: -1 | 1) =>
    setQuestions((qs) => {
      const j = i + delta;
      if (j < 0 || j >= qs.length) return qs;
      const copy = [...qs];
      [copy[i], copy[j]] = [copy[j], copy[i]];
      return copy;
    });

  const patch = (i: number, p: Partial<QuestionFormState>) =>
    setQuestions((qs) => qs.map((q, idx) => (idx === i ? { ...q, ...p } : q)));

  return (
    <div className="space-y-4">
      <div className="rounded-lg bg-card/40 px-4 py-3 text-xs text-muted-foreground">
        {t("questionsHint")}
      </div>

      {questions.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-2 rounded-2xl bg-card/40 px-6 py-12 text-center">
          <p className="text-sm text-muted-foreground">{t("questionsEmpty")}</p>
          <Button type="button" variant="outline" color="muted" size="sm" onClick={addQuestion}>
            + {t("questionAddFirst")}
          </Button>
        </div>
      ) : (
        <ol className="space-y-3">
          {questions.map((q, i) => (
            <QuestionRow
              key={q.id}
              index={i}
              total={questions.length}
              state={q}
              onChange={(p) => patch(i, p)}
              onMoveUp={() => move(i, -1)}
              onMoveDown={() => move(i, 1)}
              onRemove={() => removeAt(i)}
            />
          ))}
        </ol>
      )}

      {questions.length > 0 ? (
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>
            {questions.length} / {MAX_QUESTIONS}
          </span>
          <Button
            type="button"
            variant="outline"
            color="muted"
            size="sm"
            onClick={addQuestion}
            disabled={questions.length >= MAX_QUESTIONS}
          >
            + {t("questionAdd")}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function QuestionRow({
  index,
  total,
  state,
  onChange,
  onMoveUp,
  onMoveDown,
  onRemove,
}: {
  index: number;
  total: number;
  state: QuestionFormState;
  onChange: (patch: Partial<QuestionFormState>) => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onRemove: () => void;
}) {
  const t = useTranslations("creatorService");
  return (
    <li className="rounded-xl bg-card p-4">
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          {t("questionLabel", { index: String(index + 1) })}
        </span>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={onMoveUp}
            disabled={index === 0}
            className="rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-secondary disabled:opacity-30"
            aria-label={t("questionMoveUp")}
          >
            ↑
          </button>
          <button
            type="button"
            onClick={onMoveDown}
            disabled={index === total - 1}
            className="rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-secondary disabled:opacity-30"
            aria-label={t("questionMoveDown")}
          >
            ↓
          </button>
          <button
            type="button"
            onClick={onRemove}
            className="rounded-md px-2 py-1 text-xs text-destructive hover:bg-destructive/10"
            aria-label={t("questionRemove")}
          >
            {t("questionRemove")}
          </button>
        </div>
      </div>

      <div className="space-y-3">
        <Field>
          <FieldLabel required>{t("questionPromptLabel")}</FieldLabel>
          <Input
            value={state.prompt}
            onChange={(e) => onChange({ prompt: e.target.value.slice(0, 240) })}
            placeholder={t("questionPromptPlaceholder")}
            maxLength={240}
          />
        </Field>

        <Field>
          <FieldLabel>{t("questionHelpLabel")}</FieldLabel>
          <Input
            value={state.helpText}
            onChange={(e) => onChange({ helpText: e.target.value.slice(0, 240) })}
            placeholder={t("questionHelpPlaceholder")}
            maxLength={240}
          />
        </Field>

        <label className="inline-flex cursor-pointer items-center gap-2 text-xs text-muted-foreground">
          <Checkbox
            checked={state.required}
            onCheckedChange={(v) => onChange({ required: v === true })}
          />
          {t("questionRequired")}
        </label>
      </div>
    </li>
  );
}

// ─── Step 4 · Preview ───────────────────────────────────────

function PreviewStep({ service }: { service: CreatorServiceDTO }) {
  const t = useTranslations("creatorService");
  return (
    <div className="space-y-4">
      <div className="rounded-lg bg-card/40 px-4 py-3 text-xs text-muted-foreground">
        {t("previewHint")}
      </div>
      <div className="space-y-3">
        <header className="space-y-1">
          <div className="inline-flex items-center rounded-full bg-primary/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-primary">
            {t(`category.${service.category}`)}
          </div>
          <h2 className="text-xl font-bold text-foreground">{service.title}</h2>
          <p className="whitespace-pre-wrap text-sm leading-relaxed text-muted-foreground">
            {service.summary}
          </p>
        </header>
        <ServiceDetailSections service={service} />
      </div>
    </div>
  );
}

// ─── Pure helpers ──────────────────────────────────────────

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

const CURRENCY_SYMBOL: Record<CurrencyCode, string> = {
  CNY: "¥",
  USD: "$",
  EUR: "€",
  GBP: "£",
  JPY: "¥",
  HKD: "HK$",
  AUD: "A$",
  CAD: "C$",
  SGD: "S$",
};
function currencySymbol(c: CurrencyCode): string {
  return CURRENCY_SYMBOL[c] ?? c;
}
