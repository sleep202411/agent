"use client";

import { IconArrowLeft, IconArrowRight, IconCheck, IconFeather } from "@tabler/icons-react";
import { cn } from "@/lib/utils";
import { useTranslations } from "@/src/i18n/i18n";
import type { JinlingProfileDraft } from "../content/profile-draft";

export const CREATION_STEPS = ["name", "origin", "trait", "confirm"] as const;
export type CreationStep = (typeof CREATION_STEPS)[number];

const ORIGINS = ["weave", "kin", "medic"] as const;
const TRAITS = ["heart", "careful", "quick"] as const;
type LedgerCharacterCreatorProps = {
  draft: JinlingProfileDraft;
  step: CreationStep;
  onDraftChange: (draft: JinlingProfileDraft) => void;
  onStepChange: (step: CreationStep) => void;
  onCancel: () => void;
  onComplete: () => void;
};

function ChoiceCard({
  selected,
  title,
  description,
  meta,
  onClick,
}: {
  selected: boolean;
  title: string;
  description: string;
  meta?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onClick}
      className={cn(
        "group relative min-h-36 w-full overflow-hidden border px-5 py-5 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#9d2024] focus-visible:ring-offset-2 focus-visible:ring-offset-[#d4c5a8]",
        selected
          ? "border-[#7f1d20]/70 bg-[#7f1d20]/[0.08]"
          : "border-[#352a1e]/15 bg-black/[0.025] hover:border-[#352a1e]/35 hover:bg-black/[0.045]"
      )}
    >
      <span
        className={cn(
          "absolute right-4 top-4 grid size-6 place-items-center rounded-full border transition",
          selected
            ? "border-[#7f1d20] bg-[#7f1d20] text-[#f3e8d0]"
            : "border-[#352a1e]/25 text-transparent"
        )}
      >
        <IconCheck size={14} stroke={2.2} />
      </span>
      <span className="block pr-10 text-lg font-semibold tracking-[0.08em] text-[#241c13]">
        {title}
      </span>
      {meta ? (
        <span className="mt-2 block text-[11px] uppercase tracking-[0.2em] text-[#7f1d20]">
          {meta}
        </span>
      ) : null}
      <span className="mt-3 block text-sm leading-6 text-[#4e4437]">{description}</span>
    </button>
  );
}

function SectionHeading({
  eyebrow,
  title,
  body,
}: {
  eyebrow: string;
  title: string;
  body: string;
}) {
  return (
    <div className="js-ledger-reveal">
      <p className="text-[11px] uppercase tracking-[0.32em] text-[#8a2528]">{eyebrow}</p>
      <h2
        className="mt-3 text-3xl leading-tight text-[#211a12] sm:text-4xl"
        style={{ fontFamily: '"Noto Serif SC", "Songti SC", ui-serif, Georgia, serif' }}
      >
        {title}
      </h2>
      <p className="mt-4 max-w-2xl text-sm leading-7 text-[#51483d] sm:text-[15px]">{body}</p>
    </div>
  );
}

export function LedgerCharacterCreator({
  draft,
  step,
  onDraftChange,
  onStepChange,
  onCancel,
  onComplete,
}: LedgerCharacterCreatorProps) {
  const t = useTranslations("jinlingRumeng.creation");
  const stepIndex = CREATION_STEPS.indexOf(step);
  const trimmedNameLength = Array.from(draft.displayName.trim()).length;

  const patchDraft = (patch: Partial<JinlingProfileDraft>) => {
    onDraftChange({
      ...draft,
      ...patch,
      updatedAt: new Date().toISOString(),
    });
  };

  const canContinue =
    (step === "name" && trimmedNameLength >= 1 && trimmedNameLength <= 8) ||
    (step === "origin" && draft.origin !== null) ||
    (step === "trait" && draft.trait !== null) ||
    step === "confirm";

  const previous = () => {
    if (stepIndex === 0) {
      onCancel();
      return;
    }
    onStepChange(CREATION_STEPS[stepIndex - 1]);
  };

  const next = () => {
    if (!canContinue) return;
    if (step === "confirm") {
      onComplete();
      return;
    }
    onStepChange(CREATION_STEPS[stepIndex + 1]);
  };

  return (
    <section className="relative z-20 flex min-h-dvh w-full items-end px-3 pb-3 pt-20 sm:px-6 sm:pb-6 lg:items-center lg:px-12 lg:py-24">
      <div className="mx-auto grid w-full max-w-[1180px] overflow-hidden border border-[#e6d7b5]/20 bg-[#c9b995] shadow-[0_36px_120px_rgba(0,0,0,0.72)] lg:grid-cols-[260px_minmax(0,1fr)]">
        <aside className="border-b border-[#2a2117]/15 bg-[#211a13] px-5 py-5 text-[#e9ddc4] lg:border-b-0 lg:border-r lg:border-white/10 lg:px-7 lg:py-8">
          <div className="flex items-center justify-between lg:block">
            <div>
              <p className="text-[10px] uppercase tracking-[0.34em] text-[#cdbb95]/55">
                {t("eyebrow")}
              </p>
              <p
                className="mt-2 text-xl tracking-[0.16em]"
                style={{ fontFamily: '"Noto Serif SC", "Songti SC", ui-serif, Georgia, serif' }}
              >
                {t("ledgerTitle")}
              </p>
            </div>
            <span className="text-xs tabular-nums text-[#cdbb95]/55 lg:mt-3 lg:block">
              {t("progress", { current: stepIndex + 1, total: CREATION_STEPS.length })}
            </span>
          </div>

          <ol className="mt-5 grid grid-cols-4 gap-1.5 lg:mt-12 lg:grid-cols-1 lg:gap-0">
            {CREATION_STEPS.map((item, index) => {
              const active = item === step;
              const complete = index < stepIndex;
              return (
                <li key={item} className="lg:flex lg:items-center lg:gap-3 lg:py-3">
                  <span
                    aria-hidden
                    className={cn(
                      "block h-1 w-full lg:grid lg:size-6 lg:place-items-center lg:rounded-full lg:border lg:text-[10px]",
                      active
                        ? "bg-[#9d2024] lg:border-[#b33a3e] lg:text-white"
                        : complete
                          ? "bg-[#d0bea0]/65 lg:border-[#d0bea0]/55 lg:bg-transparent lg:text-[#d0bea0]"
                          : "bg-white/10 lg:border-white/15 lg:bg-transparent lg:text-white/35"
                    )}
                  >
                    <span className="hidden lg:inline">
                      {complete ? <IconCheck size={12} /> : index + 1}
                    </span>
                  </span>
                  <span
                    className={cn(
                      "hidden text-xs tracking-[0.1em] lg:block",
                      active ? "text-white" : complete ? "text-[#d0bea0]" : "text-white/35"
                    )}
                  >
                    {t(`steps.${item}`)}
                  </span>
                </li>
              );
            })}
          </ol>

          <p className="mt-12 hidden text-xs leading-6 text-[#cdbb95]/55 lg:block">
            {t("asideNote")}
          </p>
        </aside>

        <div className="relative max-h-[calc(100dvh-7rem)] overflow-y-auto bg-[radial-gradient(circle_at_15%_0%,rgba(255,255,255,0.32),transparent_42%),linear-gradient(135deg,#d7c9aa_0%,#c5b38f_48%,#d1c19f_100%)] px-5 pb-5 pt-7 text-[#241c13] sm:px-9 sm:pb-8 sm:pt-9 lg:max-h-[760px] lg:min-h-[680px] lg:px-12 lg:pb-10 lg:pt-11">
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 opacity-[0.13] [background-image:repeating-linear-gradient(2deg,transparent_0,transparent_5px,rgba(42,31,19,0.11)_6px)]"
          />
          <div className="relative">
            {step === "name" ? (
              <div>
                <SectionHeading
                  eyebrow={t("name.eyebrow")}
                  title={t("name.title")}
                  body={t("name.body")}
                />
                <div className="js-ledger-reveal mt-12 max-w-2xl">
                  <label
                    htmlFor="jinling-player-name"
                    className="text-xs tracking-[0.18em] text-[#5f5140]"
                  >
                    {t("name.label")}
                  </label>
                  <div className="mt-3 flex items-end border-b border-[#342719]/45 pb-2 focus-within:border-[#8a2528]">
                    <IconFeather className="mb-2 mr-4 text-[#7a6954]" size={22} stroke={1.5} />
                    <input
                      id="jinling-player-name"
                      value={draft.displayName}
                      onChange={(event) => patchDraft({ displayName: event.target.value })}
                      autoComplete="off"
                      autoFocus
                      maxLength={16}
                      placeholder={t("name.placeholder")}
                      aria-describedby="jinling-player-name-help"
                      className="min-w-0 flex-1 bg-transparent py-2 text-3xl tracking-[0.14em] text-[#20170f] outline-none placeholder:text-[#594b38]/25 sm:text-4xl"
                      style={{
                        fontFamily: '"Noto Serif SC", "Songti SC", ui-serif, Georgia, serif',
                      }}
                    />
                    <span
                      className={cn(
                        "mb-2 text-xs tabular-nums",
                        trimmedNameLength > 8 ? "text-[#8a2528]" : "text-[#6e604d]/65"
                      )}
                    >
                      {trimmedNameLength}/8
                    </span>
                  </div>
                  <p
                    id="jinling-player-name-help"
                    className={cn(
                      "mt-3 text-xs leading-5",
                      trimmedNameLength > 8 ? "text-[#8a2528]" : "text-[#645744]"
                    )}
                  >
                    {trimmedNameLength > 8 ? t("name.tooLong") : t("name.hint")}
                  </p>
                </div>
              </div>
            ) : null}

            {step === "origin" ? (
              <div>
                <SectionHeading
                  eyebrow={t("origin.eyebrow")}
                  title={t("origin.title")}
                  body={t("origin.body")}
                />
                <div className="js-ledger-reveal mt-8 grid gap-3 md:grid-cols-3">
                  {ORIGINS.map((origin) => (
                    <ChoiceCard
                      key={origin}
                      selected={draft.origin === origin}
                      title={t(`origin.options.${origin}.title`)}
                      description={t(`origin.options.${origin}.description`)}
                      meta={t(`origin.options.${origin}.keepsake`)}
                      onClick={() => patchDraft({ origin })}
                    />
                  ))}
                </div>
              </div>
            ) : null}

            {step === "trait" ? (
              <div>
                <SectionHeading
                  eyebrow={t("trait.eyebrow")}
                  title={t("trait.title")}
                  body={t("trait.body")}
                />
                <div className="js-ledger-reveal mt-8 grid gap-3 md:grid-cols-3">
                  {TRAITS.map((trait) => (
                    <ChoiceCard
                      key={trait}
                      selected={draft.trait === trait}
                      title={t(`trait.options.${trait}.title`)}
                      description={t(`trait.options.${trait}.description`)}
                      onClick={() => patchDraft({ trait })}
                    />
                  ))}
                </div>
              </div>
            ) : null}

            {step === "confirm" ? (
              <div>
                <SectionHeading
                  eyebrow={t("confirm.eyebrow")}
                  title={t("confirm.title", { name: draft.displayName.trim() })}
                  body={t("confirm.body")}
                />
                <dl className="js-ledger-reveal mt-8 divide-y divide-[#36291a]/15 border-y border-[#36291a]/15">
                  <div className="grid gap-2 py-4 sm:grid-cols-[150px_1fr]">
                    <dt className="text-xs uppercase tracking-[0.18em] text-[#675946]">
                      {t("confirm.originLabel")}
                    </dt>
                    <dd className="text-sm leading-6 text-[#2e2419]">
                      {draft.origin ? t(`origin.options.${draft.origin}.title`) : "—"}
                    </dd>
                  </div>
                  <div className="grid gap-2 py-4 sm:grid-cols-[150px_1fr]">
                    <dt className="text-xs uppercase tracking-[0.18em] text-[#675946]">
                      {t("confirm.traitLabel")}
                    </dt>
                    <dd className="text-sm leading-6 text-[#2e2419]">
                      {draft.trait ? t(`trait.options.${draft.trait}.title`) : "—"}
                    </dd>
                  </div>
                  <div className="grid gap-2 py-4 sm:grid-cols-[150px_1fr]">
                    <dt className="text-xs uppercase tracking-[0.18em] text-[#675946]">
                      {t("confirm.keepsakeLabel")}
                    </dt>
                    <dd className="text-sm leading-6 text-[#2e2419]">
                      {draft.origin ? t(`origin.options.${draft.origin}.keepsake`) : "—"}
                    </dd>
                  </div>
                </dl>
                <p className="js-ledger-reveal mt-6 border-l-2 border-[#8a2528]/55 pl-4 text-xs leading-6 text-[#594b3a]">
                  {t("confirm.warning")}
                </p>
              </div>
            ) : null}
          </div>

          <div className="relative mt-10 flex items-center justify-between border-t border-[#36291a]/15 pt-5 lg:absolute lg:bottom-8 lg:left-12 lg:right-12 lg:mt-0">
            <button
              type="button"
              onClick={previous}
              className="inline-flex min-h-11 items-center gap-2 px-1 text-sm text-[#493c2e] transition hover:text-[#8a2528] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#8a2528]"
            >
              <IconArrowLeft size={17} />
              {stepIndex === 0 ? t("cancel") : t("back")}
            </button>
            <button
              type="button"
              disabled={!canContinue}
              onClick={next}
              className="inline-flex min-h-11 items-center gap-3 bg-[#211a13] px-5 text-sm font-semibold tracking-[0.08em] text-[#f0e5cf] transition hover:bg-[#302419] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#8a2528] focus-visible:ring-offset-2 focus-visible:ring-offset-[#c9b995] disabled:cursor-not-allowed disabled:opacity-35"
            >
              {step === "confirm" ? t("stamp") : t("next")}
              {step === "confirm" ? <IconFeather size={17} /> : <IconArrowRight size={17} />}
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}
