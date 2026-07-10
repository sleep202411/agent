"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { IconCheck, IconRefresh, IconSparkles, IconWand } from "@tabler/icons-react";
import { cn } from "@/lib/utils";
import { Button3D } from "@/components/ui/button-3d";
import { useTranslations } from "@/src/i18n/i18n";
import type { PlayConceptOption } from "../_lib/play-api";
import { SafePlayerMarkdown } from "./safe-player-markdown";

const CONCEPT_STEP_KEYS = ["premise", "conflict", "contrast", "hook", "possibility"] as const;
const ENTER_STEP_KEYS = [
  "world",
  "characters",
  "secrets",
  "clues",
  "structure",
  "truth",
  "endings",
  "opening",
] as const;

export function LoadingDots() {
  return (
    <span className="flex h-5 items-center gap-1.5" aria-hidden="true">
      {[0, 1, 2].map((index) => (
        <span
          key={index}
          className="size-1.5 animate-pulse rounded-full bg-[#ea2804]/75 motion-reduce:animate-none"
          style={{ animationDelay: `${index * 180}ms`, animationDuration: "1.2s" }}
        />
      ))}
    </span>
  );
}

export function NarrativeLoadingScreen({
  kind,
  exitControl,
  concept,
}: {
  kind: "concepts" | "enter";
  exitControl: ReactNode;
  concept?: PlayConceptOption | null;
}) {
  const t = useTranslations("narrativeDemo");
  const [progress, setProgress] = useState(3);
  const stepKeys = kind === "concepts" ? CONCEPT_STEP_KEYS : ENTER_STEP_KEYS;
  const ns = kind === "concepts" ? "loading" : "entering";

  useEffect(() => {
    const id = window.setInterval(
      () => setProgress((current) => Math.min(92, current + (92 - current) * 0.02)),
      200
    );
    return () => window.clearInterval(id);
  }, []);

  const stepKey =
    stepKeys[Math.min(stepKeys.length - 1, Math.floor((progress / 100) * stepKeys.length))];

  return (
    <>
      <div className="shrink-0">{exitControl}</div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div
          className={cn(
            "mx-auto flex min-h-full w-full flex-col items-center justify-center px-2 py-8 text-center sm:px-6",
            concept ? "max-w-2xl" : "max-w-lg"
          )}
        >
          <p role="status" aria-live="polite" className="sr-only">
            {t(`concepts.${ns}.ariaLabel`)}
          </p>
          <div className="mb-6 grid size-18 animate-bounce place-items-center rounded-3xl bg-[#1f2d34] text-4xl shadow-[0_4px_0_#091014] motion-reduce:animate-none">
            🎭
          </div>
          <p className="min-h-[1.4em] text-base font-bold" aria-hidden="true">
            {t(`concepts.${ns}.steps.${stepKey}`)}
          </p>
          <div className="relative mt-4 h-4 w-full max-w-lg overflow-hidden rounded-full bg-[#14232a]">
            <div
              className="absolute inset-y-0 left-0 rounded-full bg-[#ea2804] transition-[width] duration-200 ease-linear"
              style={{ width: `${Math.round(progress)}%` }}
            >
              <span className="absolute inset-x-1.5 top-0.75 h-1 rounded-full bg-white/35" />
            </div>
          </div>
          <p className="mt-3 text-xs text-[#5f7580]">{t(`concepts.${ns}.description`)}</p>
          {concept ? (
            <section className="mt-9 w-full text-left duration-500 animate-in fade-in-0 slide-in-from-bottom-2 motion-reduce:animate-none">
              <p className="mb-2.5 text-xs font-extrabold uppercase tracking-[0.08em] text-white/60">
                {t("concepts.entering.selectedLabel")}
              </p>
              <div className="max-h-[38vh] overflow-y-auto overscroll-contain rounded-2xl bg-[#241915] p-5 shadow-[0_4px_0_#3a130a] ring-1 ring-[#ea2804]/40">
                <SafePlayerMarkdown>{concept.contentMarkdown}</SafePlayerMarkdown>
              </div>
            </section>
          ) : null}
        </div>
      </div>
    </>
  );
}

export function ConceptSelectionScreen({
  concepts,
  selectedId,
  enteredConceptId,
  enterError,
  enterFailureMode,
  exitControl,
  onSelect,
  onConfirm,
  onRegenerate,
}: {
  concepts: PlayConceptOption[];
  selectedId: string | null;
  enteredConceptId: string | null;
  enterError: string | null;
  enterFailureMode: "retry" | "fresh" | "choose-another" | null;
  exitControl: ReactNode;
  onSelect: (id: string) => void;
  onConfirm: () => void;
  onRegenerate: () => void;
}) {
  const t = useTranslations("narrativeDemo");
  const headingRef = useRef<HTMLHeadingElement>(null);
  const enterAlertRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    headingRef.current?.focus({ preventScroll: true });
  }, []);

  useEffect(() => {
    if (enterError) enterAlertRef.current?.focus({ preventScroll: true });
  }, [enterError]);

  const canResume = Boolean(selectedId && selectedId === enteredConceptId);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="mx-auto flex w-full max-w-5xl shrink-0 items-center justify-between gap-3">
        {exitControl}
        <button
          type="button"
          onClick={onRegenerate}
          className="inline-flex min-h-11 items-center gap-2 rounded-full px-3 text-[13px] font-bold text-[#8ea6b2] transition-colors hover:bg-white/5 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
        >
          <IconRefresh size={17} />
          {t("concepts.actions.regenerate")}
        </button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-0.5 pb-8 pt-5 sm:pt-8">
        <main className="mx-auto w-full max-w-5xl">
          <div className="max-w-2xl">
            <p className="text-xs font-extrabold uppercase tracking-[0.08em] text-white/60">
              {t("concepts.select.eyebrow")}
            </p>
            <h1
              ref={headingRef}
              tabIndex={-1}
              className="mt-2 text-[26px] font-extrabold leading-tight outline-none sm:text-[30px]"
            >
              {t("concepts.select.title")}
            </h1>
            <p
              id="concept-selection-description"
              className="mt-3 text-[14px] font-medium leading-6 text-[#8ea6b2]"
            >
              {t("concepts.select.description")}
            </p>
            <p className="mt-2 text-xs font-bold text-white/60">
              {t("concepts.select.resultCount", { count: concepts.length })}
            </p>
          </div>

          {enterError ? (
            <div
              ref={enterAlertRef}
              role="alert"
              tabIndex={-1}
              className="mt-6 rounded-2xl bg-[#321918] px-4 py-3 text-[14px] font-semibold leading-6 text-[#ffb4aa]"
            >
              <p className="font-extrabold text-[#ffd2cc]">{t("concepts.error.enterTitle")}</p>
              <p className="mt-1 [overflow-wrap:anywhere]">{enterError}</p>
              {enterFailureMode === "fresh" ? (
                <p className="mt-2 text-[13px] font-medium text-[#ffd2cc]/85">
                  {t("concepts.error.freshRunHint")}
                </p>
              ) : null}
              {enterFailureMode === "choose-another" ? (
                <p className="mt-2 text-[13px] font-medium text-[#ffd2cc]/85">
                  {t("concepts.error.chooseAnotherHint")}
                </p>
              ) : null}
            </div>
          ) : null}

          <fieldset aria-describedby="concept-selection-description" className="mt-7">
            <legend className="sr-only">{t("concepts.select.title")}</legend>
            <div className="grid grid-cols-1 items-start gap-4 md:grid-cols-2">
              {concepts.map((concept, index) => {
                const selected = selectedId === concept.id;
                const inputId = `narrative-concept-${index}`;
                const headingId = `${inputId}-heading`;
                const descriptionId = `${inputId}-description`;
                return (
                  <label key={concept.id} className="relative block min-w-0 cursor-pointer">
                    <input
                      id={inputId}
                      type="radio"
                      name="narrative-concept"
                      value={concept.id}
                      checked={selected}
                      onChange={() => onSelect(concept.id)}
                      aria-labelledby={headingId}
                      aria-describedby={descriptionId}
                      className="peer sr-only"
                    />
                    <article
                      aria-labelledby={headingId}
                      className={cn(
                        "flex aspect-[4/3] min-w-0 flex-col overflow-hidden rounded-2xl bg-[#171f23] p-5 text-left shadow-[0_4px_0_#080d0f] transition duration-200 motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-bottom-2 peer-focus-visible:ring-2 peer-focus-visible:ring-white/70 peer-focus-visible:ring-offset-2 peer-focus-visible:ring-offset-[#0c1418]",
                        selected
                          ? "bg-[#241915] ring-2 ring-[#ea2804] shadow-[0_4px_0_#6d1d08]"
                          : "hover:bg-[#1d282d]"
                      )}
                      style={{ animationDelay: `${index * 70}ms` }}
                    >
                      <div className="mb-4 flex shrink-0 items-start justify-between gap-3">
                        <h2 id={headingId} className="min-w-0 flex-1">
                          <span className="inline-flex min-h-11 items-center gap-3 text-[14px] font-extrabold text-white/82">
                            <span
                              aria-hidden="true"
                              className={cn(
                                "grid size-6 shrink-0 place-items-center rounded-full border-2",
                                selected
                                  ? "border-[#ea2804] bg-[#ea2804] text-white"
                                  : "border-white/30 bg-black/15"
                              )}
                            >
                              {selected ? <IconCheck size={15} stroke={3} /> : null}
                            </span>
                            <span>{t("concepts.select.optionLabel", { index: index + 1 })}</span>
                          </span>
                        </h2>
                        {selected ? (
                          <span className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-white/[0.08] px-2.5 py-1 text-[11px] font-extrabold text-white/72">
                            {t("concepts.select.selected")}
                          </span>
                        ) : null}
                      </div>
                      <div
                        id={descriptionId}
                        className="min-h-0 flex-1 overflow-y-auto overscroll-contain pr-1"
                      >
                        <SafePlayerMarkdown>{concept.contentMarkdown}</SafePlayerMarkdown>
                      </div>
                    </article>
                  </label>
                );
              })}
            </div>
          </fieldset>
        </main>
      </div>

      <footer className="shrink-0 border-t border-white/5 pt-4 [padding-bottom:max(0px,env(safe-area-inset-bottom))]">
        <div className="mx-auto flex w-full max-w-5xl justify-end">
          <Button3D
            block
            size="md"
            disabled={!selectedId}
            onClick={onConfirm}
            className="sm:w-auto sm:min-w-58"
            icon={<IconWand />}
          >
            {t(
              enterFailureMode === "fresh"
                ? "concepts.error.buildFresh"
                : enterError
                  ? "concepts.error.retryEnter"
                  : canResume
                    ? "concepts.select.resume"
                    : "concepts.select.confirm"
            )}
          </Button3D>
        </div>
      </footer>
    </div>
  );
}

export function ConceptsErrorScreen({
  message,
  exitControl,
  onRetry,
}: {
  message: string;
  exitControl: ReactNode;
  onRetry?: () => void;
}) {
  const t = useTranslations("narrativeDemo");
  const alertRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    alertRef.current?.focus({ preventScroll: true });
  }, []);

  return (
    <>
      <div className="shrink-0">{exitControl}</div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex min-h-full w-full max-w-md flex-col items-center justify-center gap-5 px-2 py-8 text-center sm:px-6">
          <div className="grid size-16 place-items-center rounded-3xl bg-[#321918] text-[#ff8f82]">
            <IconSparkles size={30} />
          </div>
          <div ref={alertRef} role="alert" tabIndex={-1} className="outline-none">
            <h1 className="text-[22px] font-extrabold leading-tight">
              {t("concepts.error.conceptsTitle")}
            </h1>
            <p className="mt-3 text-[14px] font-medium leading-6 text-[#8ea6b2] [overflow-wrap:anywhere]">
              {message}
            </p>
          </div>
          {onRetry ? (
            <Button3D block onClick={onRetry} icon={<IconRefresh />}>
              {t("concepts.error.retryConcepts")}
            </Button3D>
          ) : null}
        </div>
      </div>
    </>
  );
}
