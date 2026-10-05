import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { StoryCanvasMediaLibrary } from "./story-canvas-media-library";
import { canvasOverview } from "../lib/story-canvas-overview";
vi.mock("@/hooks/use-theme", () => ({ useTheme: () => ({}) }));
vi.mock("@/i18n", () => ({ useTranslations: () => (key: string) => key }));
vi.mock("@/components/themed-text", () => ({
  ThemedText: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}));
vi.mock("react-native", () => ({
  View: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  Pressable: ({ children, onPress }: { children: ReactNode; onPress: () => void }) => (
    <button onClick={onPress}>{children}</button>
  ),
  TextInput: ({
    value,
    onChangeText,
  }: {
    value: string;
    onChangeText: (value: string) => void;
  }) => <input value={value} onChange={(event) => onChangeText(event.target.value)} />,
}));
const assets = canvasOverview({
  meta: {},
  nodes: {},
  edges: {},
  groups: {},
  assets: {
    a: {
      id: "a",
      kind: "image",
      url: "",
      name: "Rain image",
      source: "generated",
      prompt: "Midnight city",
      createdAt: 1,
      mediaAssetId: "00000000-0000-4000-8000-000000000001",
    },
    b: {
      id: "b",
      kind: "audio",
      url: "",
      name: "Uploaded sound",
      source: "uploaded",
      createdAt: 2,
    },
    c: { id: "c", kind: "video", url: "", name: "Legacy clip", createdAt: 3 },
  },
}).assets;
let root: Root, host: HTMLDivElement;
const save = vi.fn();
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  save.mockReset();
  host = document.createElement("div");
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  vi.unstubAllGlobals();
});
const render = (visible = true, canEdit = true, rows = assets) =>
  act(async () =>
    root.render(
      <StoryCanvasMediaLibrary
        visible={visible}
        canEdit={canEdit}
        assets={rows}
        onSaveCandidate={save}
      />
    )
  );
const click = (label: string) =>
  act(async () => {
    Array.from(host.querySelectorAll("button"))
      .find((b) => b.textContent === label)!
      .click();
  });
async function search(value: string) {
  await act(async () => {
    const input = host.querySelector("input")!;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
it("classifies legacy assets like Web and orders newest first", async () => {
  await render();
  expect(host.textContent!.indexOf("Legacy clip")).toBeLessThan(
    host.textContent!.indexOf("Rain image")
  );
  await click("storyCanvas.library.generated");
  expect(host.textContent).toContain("Rain image");
  expect(host.textContent).not.toContain("Uploaded sound");
  await click("storyCanvas.library.uploaded");
  expect(host.textContent).toContain("Uploaded sound");
  expect(host.textContent).toContain("Legacy clip");
  expect(host.textContent).not.toContain("Rain image");
});
it("searches names and prompts and preserves filters across tab visits", async () => {
  await render();
  await search(" MIDNIGHT ");
  expect(host.textContent).toContain("Rain image");
  expect(host.textContent).not.toContain("Uploaded sound");
  await render(false);
  expect(host.textContent).toBe("");
  await render();
  expect(host.querySelector("input")!.value).toBe(" MIDNIGHT ");
  await click("storyCanvas.library.uploaded");
  expect(host.textContent).toContain("storyCanvas.library.noMatches");
  await search("sound");
  expect(host.textContent).toContain("Uploaded sound");
});
it("hands off only durable media identity and removes writes in read-only mode", async () => {
  await render();
  expect(host.querySelectorAll("button")).toHaveLength(4);
  await click("storyCanvas.saveCandidate");
  expect(save).toHaveBeenCalledExactlyOnceWith(assets[0]!.mediaAssetId);
  await render(true, false);
  expect(host.textContent).not.toContain("storyCanvas.saveCandidate");
  expect(host.textContent).toContain("Rain image");
});
it("reconciles changed inventory without mutating its order or filtering snapshot data", async () => {
  await render();
  await click("storyCanvas.library.generated");
  await render(true, true, []);
  expect(host.textContent).toContain("storyCanvas.empty");
  expect(host.textContent).not.toContain("Rain image");
  expect(assets.map((a) => a.id)).toEqual(["a", "b", "c"]);
});

it("opens panorama assets for read-only users without exposing candidate writes", async () => {
  const preview = vi.fn();
  const rows = [{ ...assets[0]!, panorama: true }];
  await act(async () =>
    root.render(
      <StoryCanvasMediaLibrary
        visible
        assets={rows}
        canEdit={false}
        onSaveCandidate={save}
        onPreviewPanorama={preview}
      />
    )
  );
  await click("storyCanvas.panorama.open");
  expect(preview).toHaveBeenCalledExactlyOnceWith(rows[0]);
  expect(save).not.toHaveBeenCalled();
  expect(host.textContent).not.toContain("storyCanvas.saveCandidate");
});
