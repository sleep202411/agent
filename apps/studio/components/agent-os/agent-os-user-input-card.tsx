"use client";

import { useEffect, useId, useRef, useState } from "react";
import { IconChevronLeft, IconLoader2 } from "@tabler/icons-react";
import { storyVisualStyleSkillBySlug } from "@repo/shared";
import Image from "next/image";
import { Button } from "@/components/ui/button";
import { GlassRim } from "@/components/ui/glass-rim";
import type { AgentOsPendingUserInput } from "@/lib/agent-os/api-client";
import { cn } from "@/lib/utils";

const SELECTED_RIM = "rgba(229,34,39,.88)";

export function AgentOsUserInputCard({
  request,
  busy,
  labels,
  resolveProfileQuestion,
  resolveProfileOptionLabel,
  onSubmit,
}: {
  request: AgentOsPendingUserInput;
  busy: boolean;
  labels: {
    step: (current: number, total: number) => string;
    back: string;
    continue: string;
    submit: string;
    submitting: string;
  };
  /** Fixed creative-profile enum copy belongs to the client locale catalog. */
  resolveProfileQuestion?: (questionId: string) => { header: string; question: string } | undefined;
  resolveProfileOptionLabel?: (questionId: string, value: string, fallback: string) => string;
  onSubmit: (answers: Record<string, string>) => void;
}) {
  const [step, setStep] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const groupId = useId();
  const questionTitleRef = useRef<HTMLLegendElement | null>(null);
  const optionRefs = useRef<Array<HTMLInputElement | null>>([]);
  const questions = request.questions;
  const question = questions[Math.min(step, questions.length - 1)];
  const isLast = step === questions.length - 1;
  const selected = question ? answers[question.id] : undefined;
  const isVisualStyleQuestion =
    request.formId === "story_creative_profile" && question?.id === "visual_direction";

  useEffect(() => {
    if (!question) return;
    const selectedIndex = question.options.findIndex((option) => option.value === selected);
    const target =
      selectedIndex >= 0 ? optionRefs.current[selectedIndex] : questionTitleRef.current;
    const frame = window.requestAnimationFrame(() => target?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [question, request.requestId, selected, step]);

  if (!question) return null;
  const questionCopy =
    (request.formId === "story_creative_profile" && resolveProfileQuestion?.(question.id)) ||
    question;

  const submit = () => {
    if (!selected || busy) return;
    if (!isLast) {
      setStep((current) => current + 1);
      return;
    }
    onSubmit(answers);
  };

  return (
    <section
      aria-labelledby={`${groupId}-title`}
      className="relative overflow-hidden rounded-[22px] bg-[oklch(0.19_0_0_/_0.98)] p-3.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.08),0_16px_40px_rgba(0,0,0,0.28)]"
    >
      <GlassRim className="opacity-75" />

      <div className="mb-3 flex items-center gap-3">
        <span className="shrink-0 text-[10px] font-semibold tracking-[0.12em] text-white/68">
          {labels.step(step + 1, questions.length)}
        </span>
        <div
          role="progressbar"
          aria-label={labels.step(step + 1, questions.length)}
          aria-valuemin={1}
          aria-valuemax={questions.length}
          aria-valuenow={step + 1}
          aria-valuetext={labels.step(step + 1, questions.length)}
          className="flex flex-1 gap-1.5"
        >
          {questions.map((item, index) => (
            <span
              key={item.id}
              className={cn(
                "h-0.5 flex-1 rounded-full",
                index <= step ? "bg-primary" : "bg-white/14"
              )}
            />
          ))}
        </div>
      </div>

      <fieldset disabled={busy} className="m-0 min-w-0 border-0 p-0">
        <legend
          ref={questionTitleRef}
          id={`${groupId}-title`}
          tabIndex={-1}
          className="mb-3 block w-full p-0 outline-none"
        >
          <span className="flex items-center gap-2">
            <span className="rounded-md bg-white/[0.08] px-1.5 py-0.5 text-[10px] font-semibold text-white/76">
              Q{step + 1}
            </span>
            <span className="text-sm font-semibold text-white">{questionCopy.header}</span>
            <span aria-hidden="true" className="text-primary">
              *
            </span>
          </span>
        </legend>
        <p id={`${groupId}-description`} className="mb-3 text-[11px]/relaxed text-white/78">
          {questionCopy.question}
        </p>

        <div
          role="radiogroup"
          aria-labelledby={`${groupId}-title`}
          aria-describedby={`${groupId}-description`}
          aria-required="true"
          className={cn(
            "grid",
            isVisualStyleQuestion
              ? "max-h-[338px] grid-cols-3 gap-1.5 overflow-y-auto overscroll-contain pr-1 [scrollbar-gutter:stable]"
              : "grid-cols-2 gap-2"
          )}
        >
          {question.options.map((option, optionIndex) => {
            const checked = option.value === selected;
            const optionLabel =
              request.formId === "story_creative_profile" && resolveProfileOptionLabel
                ? resolveProfileOptionLabel(question.id, option.value, option.label)
                : option.label;
            const visualStyle = isVisualStyleQuestion
              ? storyVisualStyleSkillBySlug(option.value)
              : undefined;
            const descriptionId = option.description
              ? `${groupId}-option-${optionIndex}-description`
              : undefined;
            return (
              <label
                key={option.value}
                className={cn(
                  "group relative flex cursor-pointer flex-col overflow-hidden rounded-2xl bg-white/[0.065] transition-colors hover:bg-white/[0.1] has-[:focus-visible]:outline has-[:focus-visible]:outline-1 has-[:focus-visible]:outline-dashed has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-white/45 has-[:disabled]:pointer-events-none has-[:disabled]:opacity-55",
                  visualStyle
                    ? "aspect-[2/3] min-h-0 justify-end rounded-xl p-0 text-left"
                    : "min-h-20 justify-center px-3 py-3 text-center",
                  checked && "bg-primary/[0.095]"
                )}
              >
                <input
                  ref={(node) => {
                    optionRefs.current[optionIndex] = node;
                  }}
                  className="sr-only"
                  type="radio"
                  required
                  name={`${groupId}-${question.id}`}
                  value={option.value}
                  checked={checked}
                  aria-describedby={descriptionId}
                  onChange={() =>
                    setAnswers((current) => ({ ...current, [question.id]: option.value }))
                  }
                />
                <GlassRim
                  gradient={checked ? SELECTED_RIM : undefined}
                  width="1.5px"
                  className={checked ? "z-20 opacity-100" : "z-20 opacity-35"}
                />
                {visualStyle ? (
                  <>
                    <Image
                      src={`/project-skills/previews/v1/${visualStyle.previewImageFile}`}
                      alt=""
                      fill
                      sizes="112px"
                      loading="lazy"
                      className="object-cover"
                    />
                    <span
                      aria-hidden="true"
                      className="absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-black/95 via-black/55 to-transparent"
                    />
                    <span className="relative z-10 block px-2.5 pb-2.5 text-[11px]/tight font-semibold text-white drop-shadow-sm">
                      {optionLabel}
                    </span>
                    {option.description ? (
                      <span id={descriptionId} className="sr-only">
                        {option.description}
                      </span>
                    ) : null}
                  </>
                ) : (
                  <>
                    <OptionGlyph value={option.value} selected={checked} />
                    <span className="block text-xs font-semibold text-white">{optionLabel}</span>
                    {option.description ? (
                      <span
                        id={descriptionId}
                        className="mt-1 block text-[10px]/relaxed text-white/72"
                      >
                        {option.description}
                      </span>
                    ) : null}
                  </>
                )}
              </label>
            );
          })}
        </div>
      </fieldset>

      <div className="mt-3 flex items-center gap-2">
        {step > 0 ? (
          <Button
            type="button"
            variant="quiet"
            size="lg"
            disabled={busy}
            onClick={() => setStep((current) => current - 1)}
            aria-label={labels.back}
          >
            <IconChevronLeft aria-hidden="true" />
            {labels.back}
          </Button>
        ) : null}
        <Button
          type="button"
          size="lg"
          className="ml-auto flex-1"
          disabled={!selected || busy}
          onClick={submit}
        >
          {busy ? (
            <IconLoader2 aria-hidden="true" className="animate-spin motion-reduce:animate-none" />
          ) : null}
          {busy ? labels.submitting : isLast ? labels.submit : labels.continue}
        </Button>
      </div>
    </section>
  );
}

function OptionGlyph({ value, selected }: { value: string; selected: boolean }) {
  const portrait = value.includes("9_16") || value.includes("portrait");
  const landscape = value.includes("16_9") || value.includes("landscape");
  if (!portrait && !landscape) return null;
  return (
    <span className="mb-2 grid h-7 place-items-center" aria-hidden="true">
      <span
        className={cn(
          "rounded-[3px] border-2",
          portrait ? "h-7 w-3.5" : "h-3.5 w-7",
          selected ? "border-primary" : "border-white/60"
        )}
      />
    </span>
  );
}
