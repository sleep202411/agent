"use client";

import { useEffect, useId, useRef, useState } from "react";
import { IconChevronLeft, IconLoader2 } from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import { GlassRim } from "@/components/ui/glass-rim";
import type { AgentOsPendingUserInput } from "@/lib/agent-os/api-client";
import { cn } from "@/lib/utils";

const SELECTED_RIM =
  "linear-gradient(135deg,rgba(229,34,39,.96),rgba(229,34,39,.3) 58%,rgba(255,255,255,.12))";

export function AgentOsUserInputCard({
  request,
  busy,
  labels,
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
  onSubmit: (answers: Record<string, string>) => void;
}) {
  const [step, setStep] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const groupId = useId();
  const optionRefs = useRef<Array<HTMLInputElement | null>>([]);
  const questions = request.questions;
  const question = questions[Math.min(step, questions.length - 1)];
  const isLast = step === questions.length - 1;
  const selected = question ? answers[question.id] : undefined;

  useEffect(() => {
    if (!question) return;
    const selectedIndex = question.options.findIndex((option) => option.value === selected);
    const target = optionRefs.current[selectedIndex >= 0 ? selectedIndex : 0];
    const frame = window.requestAnimationFrame(() => target?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [question, request.requestId, selected, step]);

  if (!question) return null;

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
        <legend id={`${groupId}-title`} className="mb-3 block w-full p-0">
          <span className="flex items-center gap-2">
            <span className="rounded-md bg-white/[0.08] px-1.5 py-0.5 text-[10px] font-semibold text-white/76">
              Q{step + 1}
            </span>
            <span className="text-sm font-semibold text-white">{question.header}</span>
            <span aria-hidden="true" className="text-primary">
              *
            </span>
          </span>
        </legend>
        <p id={`${groupId}-description`} className="mb-3 text-[11px]/relaxed text-white/78">
          {question.question}
        </p>

        <div
          role="radiogroup"
          aria-labelledby={`${groupId}-title`}
          aria-describedby={`${groupId}-description`}
          aria-required="true"
          className="grid grid-cols-2 gap-2"
        >
          {question.options.map((option, optionIndex) => {
            const checked = option.value === selected;
            const descriptionId = option.description
              ? `${groupId}-option-${optionIndex}-description`
              : undefined;
            return (
              <label
                key={option.value}
                className={cn(
                  "relative min-h-20 cursor-pointer overflow-hidden rounded-2xl bg-white/[0.065] px-3 py-3 text-left transition-[background-color,transform] hover:bg-white/[0.1] active:translate-y-px focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-white/80 has-[:disabled]:pointer-events-none has-[:disabled]:opacity-55",
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
                  width={checked ? "1.5px" : "1px"}
                  className={checked ? "opacity-100" : "opacity-35"}
                />
                <OptionGlyph value={option.value} selected={checked} />
                <span className="block text-xs font-semibold text-white">{option.label}</span>
                {option.description ? (
                  <span id={descriptionId} className="mt-1 block text-[10px]/relaxed text-white/72">
                    {option.description}
                  </span>
                ) : null}
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
