import { expect, it } from "vitest";
import {
  agentInputRequestKey,
  readAgentInputDraft,
  writeAgentInputDraft,
} from "./agent-input-draft";
const questions = ["a", "b"].map((id) => ({
  id,
  question: id,
  options: [{ value: "yes", label: "Yes" }],
}));
const request = { requestId: "r1", questions };
function fixture() {
  let value: string | null = null;
  return {
    requestKey: agentInputRequestKey(request),
    record: {
      read: () => value,
      write: (next: string) => {
        value = next;
      },
    },
  };
}
it("isolates a replaced request or changed definition", () => {
  const storage = fixture();
  writeAgentInputDraft(storage, { step: 1, answers: { a: "yes" } });
  for (const changed of [
    { ...request, requestId: "r2" },
    { ...request, questions: questions.map((q) => ({ ...q, question: "Changed" })) },
  ]) {
    expect(
      readAgentInputDraft(
        { ...storage, requestKey: agentInputRequestKey(changed) },
        changed.questions
      )
    ).toEqual({ step: 0, answers: {} });
  }
});
it("drops invalid answers and cannot skip the first unanswered question", () => {
  const storage = fixture();
  writeAgentInputDraft(storage, { step: 99, answers: { a: "removed", b: "yes", unknown: "yes" } });
  expect(readAgentInputDraft(storage, questions)).toEqual({ step: 0, answers: { b: "yes" } });
});
it("restores complete answers at the last question for explicit submission", () => {
  const storage = fixture();
  writeAgentInputDraft(storage, { step: 99, answers: { a: "yes", b: "yes" } });
  expect(readAgentInputDraft(storage, questions)).toEqual({
    step: 1,
    answers: { a: "yes", b: "yes" },
  });
});
it("handles absent records and rejects corrupt JSON", () => {
  const storage = fixture();
  expect(readAgentInputDraft(storage, questions)).toEqual({ step: 0, answers: {} });
  storage.record.write("not json");
  expect(() => readAgentInputDraft(storage, questions)).toThrow();
});
