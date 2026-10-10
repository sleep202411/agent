import { useLayoutEffect, useRef, useState } from "react";
import {
  emptyAgentInputDraft,
  readAgentInputDraft,
  writeAgentInputDraft,
  type AgentInputDraft,
  type AgentInputDraftStorage,
} from "../lib/agent-input-draft";
import type { AgentOsPendingUserInputQuestion } from "../api/agent-os-api";

/** Mount once per request definition; retained callbacks cannot edit another step. */
export function useAgentInputForm(
  questions: AgentOsPendingUserInputQuestion[],
  busy: boolean,
  onSubmit: (answers: Record<string, string>) => void,
  storage?: AgentInputDraftStorage
) {
  const [state, setState] = useState<{ draft: AgentInputDraft; error?: string }>(() => {
    try {
      return { draft: readAgentInputDraft(storage, questions) };
    } catch (error) {
      return {
        draft: emptyAgentInputDraft(),
        error: error instanceof Error ? error.message : String(error),
      };
    }
  });
  const { step, answers } = state.draft;
  const draftRef = useRef(state.draft);
  function updateDraft(update: (previous: AgentInputDraft) => AgentInputDraft) {
    const draft = update(draftRef.current);
    let error: string | undefined;
    try {
      writeAgentInputDraft(storage, draft);
    } catch (failure) {
      error = failure instanceof Error ? failure.message : String(failure);
    }
    draftRef.current = draft;
    setState({ draft, error });
  }
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
    updateDraft((previous) => ({
      ...previous,
      answers: { ...previous.answers, [question.id]: value },
    }));
  }
  function back() {
    if (current()) updateDraft((previous) => ({ ...previous, step: Math.max(0, step - 1) }));
  }
  function submit() {
    if (!current() || !selected) return;
    if (!isLast) {
      updateDraft((previous) => ({ ...previous, step: step + 1 }));
      return;
    }
    if (
      !questions.every((item) => item.options.some((option) => option.value === answers[item.id]))
    )
      return;
    onSubmit(Object.fromEntries(questions.map((item) => [item.id, answers[item.id]])));
  }
  return { step, question, isLast, selected, choose, back, submit, error: state.error };
}
