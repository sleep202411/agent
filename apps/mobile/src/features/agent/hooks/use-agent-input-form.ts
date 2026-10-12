import { useLayoutEffect, useRef, useState } from "react";
import type { AgentOsPendingUserInputQuestion } from "../api/agent-os-api";

/** Mount once per request definition; retained callbacks cannot edit another step. */
export function useAgentInputForm(
  questions: AgentOsPendingUserInputQuestion[],
  busy: boolean,
  onSubmit: (answers: Record<string, string>) => void
) {
  const [step, setStep] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const active = useRef(false);
  const currentStep = useRef(step);
  const blocked = useRef(busy);
  useLayoutEffect(() => {
    currentStep.current = step;
    blocked.current = busy;
  });
  useLayoutEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  const current = () => active.current && !blocked.current && currentStep.current === step;
  const question = questions[step];
  const isLast = step === questions.length - 1;
  const selected = question?.options.some((option) => option.value === answers[question.id])
    ? answers[question.id]
    : undefined;
  function choose(value: string) {
    if (!current() || !question?.options.some((option) => option.value === value)) return;
    setAnswers((previous) => ({ ...previous, [question.id]: value }));
  }
  function back() {
    if (current()) setStep(Math.max(0, step - 1));
  }
  function submit() {
    if (!current() || !selected) return;
    if (!isLast) {
      setStep(step + 1);
      return;
    }
    if (
      !questions.every((item) => item.options.some((option) => option.value === answers[item.id]))
    )
      return;
    onSubmit(Object.fromEntries(questions.map((item) => [item.id, answers[item.id]])));
  }
  return { step, question, isLast, selected, choose, back, submit };
}
