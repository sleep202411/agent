import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { StoryHotspotOutcomePreview } from "./story-hotspot-outcome-preview";
vi.mock("@/i18n", () => ({ useTranslations: () => (k: string) => k, useLocale: () => "en-US" }));
vi.mock("@/components/themed-text", () => ({
  ThemedText: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}));
vi.mock("react-native", () => ({
  View: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  Pressable: ({ children, onPress }: { children: ReactNode; onPress: () => void }) => (
    <button onClick={onPress}>{children}</button>
  ),
}));
let host: HTMLDivElement, root: Root;
const content = {
  storyBible: {},
  graph: { entryNodeId: "a", nodes: [{ nodeId: "a", name: "Opening" }] },
};
const base = {
  kind: "hotspot",
  interactionId: "hotspot:a",
  label: { "en-US": "Touch" },
  trigger: { kind: "tap" },
  rect: { x: 0, y: 0, width: 1, height: 1 },
  startMs: 100,
  endMs: 2000,
  timing: "window",
  outcomes: { success: { kind: "continue" } },
};
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
beforeEach(() => {
  host = document.createElement("div");
  root = createRoot(host);
});
afterEach(() => act(() => root.unmount()));
const render = (value: unknown = base, time = 100, active = true) =>
  act(async () =>
    root.render(
      <StoryHotspotOutcomePreview
        key={JSON.stringify(value)}
        value={value}
        content={content}
        time={time}
        active={active}
      />
    )
  );
const press = () => act(async () => host.querySelector("button")!.click());
it("only exposes a hotspot inside its input window and while active", async () => {
  await render(base, 99);
  expect(host.querySelector("button")).toBeNull();
  await render(base, 100);
  expect(host.querySelector("button")).not.toBeNull();
  await render(base, 2001);
  expect(host.querySelector("button")).toBeNull();
  await render(base, 100, false);
  expect(host.querySelector("button")).toBeNull();
});
it("describes success outcomes without mutating the draft or executing them", async () => {
  const before = JSON.stringify(base);
  await render();
  await press();
  expect(host.textContent).toContain("storyHotspot.previewContinue");
  for (const [action, expected] of [
    [{ kind: "pause" }, "storyHotspot.previewPause"],
    [{ kind: "seek", timeMs: 1350 }, "1350 ms"],
    [{ kind: "goto", target: { kind: "node", nodeId: "a" } }, "Opening"],
    [
      { kind: "goto", target: { kind: "node", nodeId: "missing" } },
      "storyHotspot.previewMissingTarget",
    ],
  ] as const) {
    await render({ ...base, outcomes: { success: action } });
    await press();
    expect(host.textContent).toContain(expected);
  }
  expect(JSON.stringify(base)).toBe(before);
});
it("does not offer preview for incomplete numeric edits", async () => {
  await render({ ...base, startMs: "-" });
  expect(host.querySelector("button")).toBeNull();
  expect(host.textContent).toContain("storyHotspot.previewInvalid");
});
