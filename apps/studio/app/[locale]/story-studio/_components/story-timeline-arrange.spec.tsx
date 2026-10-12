// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import type { StoryStoryboardClip } from "@/lib/story-production-api";
import type { StoryCandidateAsset } from "@/lib/story-projects-api";
import { StoryTimelineArrange } from "./story-timeline-arrange";
vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => key }));
let host: HTMLDivElement;
let root: Root;
const move = vi.fn();
const insert = vi.fn();
const candidate = {
  asset: { id: "asset-1", kind: "image", fileName: "Frame" },
} as StoryCandidateAsset;
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  move.mockClear();
  insert.mockClear();
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});
async function render(disabled = false) {
  await act(async () =>
    root.render(
      <StoryTimelineArrange
        clips={[{ id: "a" }, { id: "b" }] as StoryStoryboardClip[]}
        selectedClipId="a"
        candidates={[candidate]}
        disabled={disabled}
        loading={false}
        error={null}
        onRetry={vi.fn()}
        onMove={move}
        onInsert={insert}
      >
        <button data-story-clip-id="a" draggable>
          A
        </button>
        <button data-story-clip-id="b" draggable>
          B
        </button>
        <div data-end />
      </StoryTimelineArrange>
    )
  );
}
function drag(target: Element, name: string, data: Record<string, string>) {
  const event = new Event(name, { bubbles: true, cancelable: true });
  Object.defineProperty(event, "dataTransfer", {
    value: {
      types: Object.keys(data),
      getData: (key: string) => data[key] || "",
      setData: (key: string, value: string) => {
        data[key] = value;
      },
    },
  });
  target.dispatchEvent(event);
}
it("moves clips by drag and by the accessible later action", async () => {
  await render();
  const data: Record<string, string> = {};
  await act(async () => {
    drag(host.querySelector('[data-story-clip-id="b"]')!, "dragstart", data);
    drag(host.querySelector('[data-story-clip-id="a"]')!, "drop", data);
  });
  expect(move).toHaveBeenCalledWith("b", "a");
  await act(async () => (host.querySelector('[aria-label="later"]') as HTMLButtonElement).click());
  expect(move).toHaveBeenCalledWith("a", null);
  expect((host.querySelector('[aria-label="earlier"]') as HTMLButtonElement).disabled).toBe(true);
});
it("inserts a known project asset by drag and click; rejects foreign IDs", async () => {
  await render();
  await act(async () => (host.querySelector("[aria-expanded]") as HTMLButtonElement).click());
  const button = Array.from(host.querySelectorAll("button")).find(
    (b) => b.textContent === "Frame"
  )!;
  const data: Record<string, string> = {};
  await act(async () => {
    drag(button, "dragstart", data);
    drag(host.querySelector('[data-story-clip-id="b"]')!, "drop", data);
  });
  expect(insert).toHaveBeenCalledWith(candidate, "b");
  await act(async () => button.click());
  expect(insert).toHaveBeenCalledWith(candidate, "a");
  insert.mockClear();
  await act(async () =>
    drag(host.querySelector("[data-end]")!, "drop", { "application/x-fizz-story-media": "foreign" })
  );
  expect(insert).not.toHaveBeenCalled();
});
it("blocks read-only and in-flight edits", async () => {
  await render(true);
  await act(async () =>
    drag(host.querySelector('[data-story-clip-id="a"]')!, "drop", {
      "application/x-fizz-story-clip": "b",
    })
  );
  expect(move).not.toHaveBeenCalled();
  expect((host.querySelector('[aria-label="later"]') as HTMLButtonElement).disabled).toBe(true);
});
