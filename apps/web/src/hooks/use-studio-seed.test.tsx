import { act, StrictMode, useLayoutEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const s = vi.hoisted(() => ({ user: "a", project: "p", dispatch: vi.fn() }));
vi.mock("./use-user", () => ({ useCurrentUser: () => ({ user: { id: s.user } }) }));
vi.mock("@/src/store", () => ({ useAppDispatch: () => s.dispatch }));
vi.mock("@/src/store/slices/assistantSlice", () => ({
  pushAttachment: (v: unknown) => ({ type: "attachment", v }),
  sendUserMessage: (v: unknown) => ({ type: "send", v }),
  setAgentType: (v: unknown) => ({ type: "agent", v }),
  setDraft: (v: unknown) => ({ type: "draft", v }),
  setForcedPersona: (v: unknown) => ({ type: "persona", v }),
}));
vi.mock("@/src/store/slices/projectSlice", () => ({
  setActivePanel: (v: unknown) => ({ type: "panel", v }),
}));
import { useStudioSeed } from "./use-studio-seed";
import { useStudioSeedConsumer } from "./use-studio-seed-consumer";
import { STUDIO_SEED_STORAGE_KEY } from "@/src/types/studio-seed";
let root: Root;
let value: ReturnType<typeof useStudioSeed>;
function View() {
  const current = useStudioSeed(s.project);
  useLayoutEffect(() => {
    value = current;
  });
  return null;
}
function Consumer() {
  useStudioSeedConsumer(s.project);
  return null;
}
function put(projectId = "p", prompt = "Prompt") {
  sessionStorage.setItem(
    STUDIO_SEED_STORAGE_KEY,
    JSON.stringify({ projectId, worldId: "world", seed: { agent: null, prompt } })
  );
}
async function render(consumer = false) {
  await act(async () => root.render(<StrictMode>{consumer ? <Consumer /> : <View />}</StrictMode>));
}
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  s.user = "a";
  s.project = "p";
  s.dispatch.mockReset();
  sessionStorage.clear();
  root = createRoot(document.createElement("div"));
});
afterEach(() => act(() => root.unmount()));
it("does not expose or claim a prior seed after project changes", async () => {
  put();
  await render();
  expect(value.seed?.prompt).toBe("Prompt");
  const oldClaim = value.claim;
  s.project = "other";
  await render();
  expect(value.seed).toBeNull();
  expect(oldClaim()).toBe(false);
});
it("claims an exact envelope once and never removes a replacement", async () => {
  put();
  await render();
  put("p", "Replacement");
  expect(value.claim()).toBe(false);
  expect(sessionStorage.getItem(STUDIO_SEED_STORAGE_KEY)).toContain("Replacement");
  s.project = "other";
  await render();
  s.project = "p";
  await render();
  expect(value.seed?.prompt).toBe("Replacement");
  expect(value.claim()).toBe(true);
  expect(value.claim()).toBe(false);
});
it("rejects malformed seeds", async () => {
  sessionStorage.setItem(
    STUDIO_SEED_STORAGE_KEY,
    JSON.stringify({ projectId: "p", seed: { agent: null, prompt: 123 } })
  );
  await render();
  expect(value.seed).toBeNull();
});
it("sends only once under Strict Mode and does not replay after remount", async () => {
  put();
  await render(true);
  expect(s.dispatch.mock.calls.filter(([a]) => a.type === "send")).toHaveLength(1);
  await act(async () => root.render(null));
  await render(true);
  expect(s.dispatch.mock.calls.filter(([a]) => a.type === "send")).toHaveLength(1);
});
it("accepts a new project's seed in the same page lifetime", async () => {
  put();
  await render(true);
  s.project = "second";
  put("second", "New");
  await render(true);
  expect(s.dispatch.mock.calls.filter(([a]) => a.type === "send").map(([a]) => a.v)).toEqual([
    "p",
    "second",
  ]);
});
