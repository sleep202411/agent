import { expect, it } from "vitest";
import { extractSuggestedActions } from "./suggested-action";
const action = { label: "Continue", tool: "next", input: { projectId: "p" } };
function block(value: unknown) {
  return "Intro\n```json\n" + JSON.stringify({ actions: [value] }) + "\n```";
}
it("removes the whole action fence when whitespace follows it", () => {
  expect(extractSuggestedActions(block(action) + "\n  \n")).toEqual({
    cleanText: "Intro",
    suggestedActions: [action],
  });
});
it("rejects array inputs instead of emitting unusable action buttons", () => {
  expect(extractSuggestedActions(block({ ...action, input: [] })).suggestedActions).toEqual([]);
});
it("does not display an overflowed numeric cost", () => {
  const source = block(action).replace('"input":', '"estimatedCost":1e999,"input":');
  expect(extractSuggestedActions(source).suggestedActions[0]?.estimatedCost).toBeUndefined();
});
it("retains valid actions, finite costs and preceding prose", () => {
  const value = { ...action, estimatedCost: 12 };
  expect(extractSuggestedActions(block(value))).toEqual({
    cleanText: "Intro",
    suggestedActions: [value],
  });
});
it("hides incomplete action payloads until complete", () => {
  expect(extractSuggestedActions('Intro\n```json\n{"actions":[')).toEqual({
    cleanText: "Intro",
    suggestedActions: [],
  });
});
