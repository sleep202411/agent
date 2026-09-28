// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useProjectPromptHandoff } from "./use-project-prompt-handoff";
import { AgentComposerPrefillBridge } from "@/components/agent-os/agent-composer-prefill-bridge";
import { useProjectUIStore } from "../_stores/project-ui-store";
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(window.location.search),
}));
let root: Root;
const prefill = vi.fn();
function Harness() {
  const handoff = useProjectPromptHandoff();
  return (
    <AgentComposerPrefillBridge
      request={handoff.request}
      onPrefill={prefill}
      onConsumed={handoff.consume}
    />
  );
}
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.useFakeTimers();
  root = createRoot(document.createElement("div"));
  useProjectUIStore.setState({ copilotOpen: false });
});
afterEach(async () => {
  await act(async () => root.unmount());
  vi.useRealTimers();
  vi.unstubAllGlobals();
  prefill.mockReset();
});
it("opens FizzAgent and consumes only the prompt after the composer accepts it", async () => {
  window.history.replaceState(
    { marker: 1 },
    "",
    "/en-US/project/new/canvas?section=one&prompt=plan%20%26%20shoot#view"
  );
  await act(async () => root.render(<Harness />));
  expect(useProjectUIStore.getState().copilotOpen).toBe(true);
  expect(window.location.search).toContain("prompt=");
  await act(async () => vi.runAllTimers());
  expect(prefill).toHaveBeenCalledExactlyOnceWith("plan & shoot");
  expect(window.location.search).toBe("?section=one");
  expect(window.location.hash).toBe("#view");
  expect(window.history.state).toEqual({ marker: 1 });
  await act(async () => root.render(<Harness />));
  await act(async () => vi.runAllTimers());
  expect(prefill).toHaveBeenCalledTimes(1);
});
it("does not open or overwrite the Agent for an ordinary canvas visit", async () => {
  window.history.replaceState(null, "", "/en-US/project/new/canvas");
  await act(async () => root.render(<Harness />));
  await act(async () => vi.runAllTimers());
  expect(useProjectUIStore.getState().copilotOpen).toBe(false);
  expect(prefill).not.toHaveBeenCalled();
});
