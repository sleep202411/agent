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

it("preserves ordinary JSON and following prose", () => {
  const source = 'Example\n```json\n{"name":"Scene"}\n```\nKeep this explanation.';
  expect(extractSuggestedActions(source)).toEqual({ cleanText: source, suggestedActions: [] });
});
it("extracts the trailing action without swallowing an earlier JSON example", () => {
  const prefix = 'Example\n```json\n{"name":"Scene"}\n```\nContinue below.';
  const source = prefix + "\n```json\n" + JSON.stringify({ actions: [action] }) + "\n```";
  expect(extractSuggestedActions(source)).toEqual({
    cleanText: prefix,
    suggestedActions: [action],
  });
});

it("preserves a completed ordinary JSON block at the end", () => {
  const source = 'Example\n```json\n{"name":"Scene"}\n```';
  expect(extractSuggestedActions(source)).toEqual({ cleanText: source, suggestedActions: [] });
});
it("hides only the unfinished trailing fence after an ordinary example", () => {
  const prefix = 'Example\n```json\n{"name":"Scene"}\n```\nContinue below.';
  expect(extractSuggestedActions(prefix + '\n```json\n{"actions":[')).toEqual({
    cleanText: prefix,
    suggestedActions: [],
  });
});
it("still repairs trailing commas inside the action fence", () => {
  const source =
    'Intro\n```json\n{"actions":[{"label":"Continue","tool":"next","input":{"projectId":"p"},},]}\n```';
  expect(extractSuggestedActions(source)).toEqual({
    cleanText: "Intro",
    suggestedActions: [action],
  });
});
it("accepts CRLF action fences", () => {
  expect(extractSuggestedActions(block(action).replaceAll("\n", "\r\n"))).toEqual({
    cleanText: "Intro",
    suggestedActions: [action],
  });
});
