import type { DurableRecord } from "@/lib/durable-record";
import type { AgentOsPendingUserInput, AgentOsPendingUserInputQuestion } from "../api/agent-os-api";

export type AgentInputDraft = { step: number; answers: Record<string, string> };
export type AgentInputDraftStorage = { record: DurableRecord; requestKey: string };
export const emptyAgentInputDraft = (): AgentInputDraft => ({ step: 0, answers: {} });

export function agentInputRequestKey(request: AgentOsPendingUserInput) {
  return JSON.stringify([
    request.requestId,
    request.turnId ?? "",
    request.formId ?? "",
    request.questions.map((question) => [
      question.id,
      question.header ?? "",
      question.question,
      question.options.map((option) => [option.value, option.label, option.description ?? ""]),
    ]),
  ]);
}

/** One bounded draft per chapter; never restore against a different server request. */
export function readAgentInputDraft(
  storage: AgentInputDraftStorage | undefined,
  questions: AgentOsPendingUserInputQuestion[]
): AgentInputDraft {
  const raw = storage?.record.read();
  if (!raw || !storage) return emptyAgentInputDraft();
  const saved = JSON.parse(raw);
  if (!saved || saved.version !== 1 || saved.requestKey !== storage.requestKey)
    return emptyAgentInputDraft();
  const answers = Object.fromEntries(
    questions.flatMap((question) => {
      const value = saved.answers?.[question.id];
      return typeof value === "string" && question.options.some((option) => option.value === value)
        ? [[question.id, value]]
        : [];
    })
  );
  const firstMissing = questions.findIndex((question) => !answers[question.id]);
  const lastReachable = firstMissing < 0 ? Math.max(0, questions.length - 1) : firstMissing;
  const step =
    Number.isSafeInteger(saved.step) && saved.step >= 0 ? Math.min(saved.step, lastReachable) : 0;
  return { step, answers };
}

export function writeAgentInputDraft(
  storage: AgentInputDraftStorage | undefined,
  draft: AgentInputDraft
) {
  storage?.record.write(JSON.stringify({ version: 1, requestKey: storage.requestKey, ...draft }));
}
