// @vitest-environment jsdom
import { act } from "react";
import { strToU8, zipSync } from "fflate";
import { createRoot, type Root } from "react-dom/client";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import messages from "@/messages/en-US.json";
import { StoryPlotImportDialog } from "./story-plot-import-dialog";

const mediaMocks = vi.hoisted(() => ({ upload: vi.fn(), add: vi.fn() }));
vi.mock("@/lib/media-upload", () => ({ uploadFileViaSignedUrl: mediaMocks.upload }));
vi.mock("@/lib/story-projects-api", () => ({ addStoryCandidateAsset: mediaMocks.add }));
const valid = JSON.stringify({
  entryNodeId: "start",
  assets: [],
  nodes: [{ id: "start", type: "scene", title: "Opening", next: null }],
});
function button(label: string) {
  const found = Array.from(document.querySelectorAll("button")).find(
    (element) => element.textContent === label
  );
  if (!found) throw new Error(`Button missing: ${label}`);
  return found;
}
async function choose(source: string | Promise<string>, size = 100) {
  const input = document.querySelector('input[type="file"]')!;
  Object.defineProperty(input, "files", {
    configurable: true,
    value: [{ name: "plot.json", size, text: () => Promise.resolve(source) }],
  });
  await act(async () => input.dispatchEvent(new Event("change", { bubbles: true })));
}

async function settle() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

async function dragFiles(type: string, names = ["plot.json"], target?: Element) {
  const zone = document.querySelector('button[aria-label="Choose JSON file"]')!.parentElement!;
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, "dataTransfer", {
    value: {
      types: ["Files"],
      files: names.map((name) => ({ name, size: 100, text: () => Promise.resolve(valid) })),
      dropEffect: "none",
    },
  });
  await act(async () => (target ?? zone).dispatchEvent(event));
  return event;
}

describe("plot import dialog", () => {
  let root: Root;
  let container: HTMLDivElement;
  const onImport = vi.fn();
  const render = async (disabled = false, hasNodes = false) =>
    act(async () =>
      root.render(
        <NextIntlClientProvider locale="en-US" messages={messages}>
          <StoryPlotImportDialog
            projectId="project-1"
            disabled={disabled}
            hasNodes={hasNodes}
            onImport={onImport}
          />
        </NextIntlClientProvider>
      )
    );
  beforeEach(async () => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    onImport.mockReset();
    mediaMocks.upload.mockReset().mockResolvedValue({ mediaAssetId: "media-1" });
    mediaMocks.add.mockReset().mockResolvedValue({ id: "media-1" });
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await render();
    await act(async () => button("Import Plot Tree").click());
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });
  it("offers the template and imports once only after file validation and confirmation", async () => {
    expect(document.querySelector("a[download]")?.getAttribute("href")).toBe(
      "/templates/story-plot/en-US.md"
    );
    expect(button("Import plot tree").disabled).toBe(true);
    await choose(valid);
    expect(document.body.textContent).toContain(
      "1 scenes · 0 decisions · 0 variables · 0 assets · 0 clips"
    );
    expect(onImport).not.toHaveBeenCalled();
    await act(async () => {
      button("Import plot tree").click();
      button("Import plot tree").click();
    });
    await settle();
    expect(onImport).toHaveBeenCalledTimes(1);
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });
  it("keeps existing content by default and explicitly passes append mode", async () => {
    await render(false, true);
    const checkbox = document.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
    expect(checkbox.checked).toBe(false);
    await choose(valid);
    await act(async () => button("Import plot tree").click());
    await settle();
    expect(onImport).toHaveBeenCalledWith(expect.any(Object), "append");
  });
  it("imports in replacement mode only when checked, and resets it on reopening", async () => {
    await render(false, true);
    await act(async () =>
      document.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click()
    );
    expect(document.body.textContent).toContain("Replaces this chapter’s nodes and connections");
    await choose(valid);
    await act(async () => button("Import plot tree").click());
    await settle();
    expect(onImport).toHaveBeenCalledWith(expect.any(Object), "replace");
    await act(async () => button("Import Plot Tree").click());
    expect(document.querySelector<HTMLInputElement>('input[type="checkbox"]')!.checked).toBe(false);
  });
  it("omits replacement for an empty chapter", () => {
    expect(document.querySelector('input[type="checkbox"]')).toBeNull();
  });
  it("allows clicking outside to dismiss before importing", async () => {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
      document.body.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, button: 0 }));
    });
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });
  it("invalid files replace a previous valid selection and cannot leave a partial import", async () => {
    await choose(valid);
    await choose("invalid");
    expect(document.querySelector('[role="alert"]')?.textContent).toContain("Invalid JSON");
    expect(button("Import plot tree").disabled).toBe(true);
    expect(onImport).not.toHaveBeenCalled();
    await choose(valid);
    expect(document.querySelector('[role="alert"]')).toBeNull();
    expect(button("Import plot tree").disabled).toBe(false);
  });
  it("rejects oversized files before reading them", async () => {
    await choose(valid, 10 * 1024 * 1024 + 1);
    expect(document.querySelector('[role="alert"]')?.textContent).toContain("too large");
    expect(button("Import plot tree").disabled).toBe(true);
  });
  it("highlights file drags and validates drops without submitting or navigating", async () => {
    const event = await dragFiles("dragenter");
    expect(event.defaultPrevented).toBe(true);
    expect(document.body.textContent).toContain("Drop to select these files");
    const child = document.querySelector('button[aria-label="Choose JSON file"] svg')!;
    await dragFiles("dragenter", ["plot.json"], child);
    await dragFiles("dragleave", ["plot.json"], child);
    expect(document.body.textContent).toContain("Drop to select these files");
    expect((await dragFiles("drop")).defaultPrevented).toBe(true);
    expect(document.body.textContent).toContain("plot.json");
    expect(document.body.textContent).toContain(
      "1 scenes · 0 decisions · 0 variables · 0 assets · 0 clips"
    );
    expect(button("Import plot tree").disabled).toBe(false);
    expect(onImport).not.toHaveBeenCalled();
  });
  it.each([["one.json", "two.json"], ["script.txt"]])(
    "rejects unsupported drops: %s",
    async (...names) => {
      await choose(valid);
      await dragFiles("drop", names);
      expect(document.querySelector('[role="alert"]')).not.toBeNull();
      expect(button("Import plot tree").disabled).toBe(true);
      expect(onImport).not.toHaveBeenCalled();
    }
  );
  it("does not accept dropped files when editing becomes disabled", async () => {
    await render(true);
    await dragFiles("drop");
    expect(button("Import plot tree").disabled).toBe(true);
    expect(document.body.textContent).not.toContain("plot.json");
  });
  it("discards an in-flight read when the dialog closes", async () => {
    let finish!: (value: string) => void;
    await choose(
      new Promise<string>((resolve) => {
        finish = resolve;
      })
    );
    await act(async () => button("Cancel").click());
    await act(async () => button("Import Plot Tree").click());
    await act(async () => finish(valid));
    expect(button("Import plot tree").disabled).toBe(true);
    expect(onImport).not.toHaveBeenCalled();
  });
  it("respects a write lock acquired after selecting the file", async () => {
    await choose(valid);
    await render(true, true);
    expect(document.body.textContent).toContain("Adds a separate group");
    expect(button("Import plot tree").disabled).toBe(true);
    expect(onImport).not.toHaveBeenCalled();
  });
  it("retains the selection and displays a rejected mutation without reporting success", async () => {
    await choose(valid);
    onImport.mockImplementation(() => {
      throw new Error("The chapter changed.");
    });
    await act(async () => button("Import plot tree").click());
    await settle();
    expect(document.querySelector('[role="alert"]')?.textContent).toBe("The chapter changed.");
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
    expect(button("Import plot tree").disabled).toBe(false);
  });
  it.each(["resolve", "reject"])(
    "prevents dismissing the final save until it can %s",
    async (outcome) => {
      let resolve!: () => void;
      let reject!: (error: Error) => void;
      onImport.mockImplementation(
        () =>
          new Promise<void>((yes, no) => {
            resolve = yes;
            reject = no;
          })
      );
      await choose(valid);
      await act(async () => button("Import plot tree").click());
      expect(document.querySelector('[data-slot="dialog-close"]')).toBeNull();
      expect(button("Cancel").disabled).toBe(true);
      expect(button("Saving plot tree…").disabled).toBe(true);
      await act(async () =>
        document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))
      );
      expect(document.querySelector('[role="dialog"]')).not.toBeNull();
      await act(async () =>
        outcome === "resolve" ? resolve() : reject(new Error("Old import failed"))
      );
      await settle();
      if (outcome === "resolve") {
        expect(document.querySelector('[role="dialog"]')).toBeNull();
      } else {
        expect(document.querySelector('[role="alert"]')?.textContent).toBe("Old import failed");
        expect(button("Import plot tree").disabled).toBe(false);
        expect(document.querySelector('[data-slot="dialog-close"]')).not.toBeNull();
      }
    }
  );
  async function choosePair(names: string[], referenced = "opening.mp4") {
    const source = JSON.stringify({
      entryNodeId: "start",
      assets: [],
      nodes: [
        {
          id: "start",
          type: "scene",
          title: "Opening",
          next: null,
          storyboard: {
            clips: ["one", "two"].map((id) => ({
              id,
              kind: "video",
              title: id,
              prompt: "A scene",
              durationMs: 1000,
              videoFile: referenced,
            })),
          },
        },
      ],
    });
    const bytes = zipSync(Object.fromEntries(names.map((name) => [name, strToU8("video")])));
    const input = document.querySelector('input[type="file"]')!;
    Object.defineProperty(input, "files", {
      configurable: true,
      value: [
        { name: "plot.json", size: source.length, text: async () => source },
        { name: "videos.zip", size: bytes.length, arrayBuffer: async () => bytes.buffer },
      ],
    });
    await act(async () => input.dispatchEvent(new Event("change", { bubbles: true })));
  }
  it("matches JSON and ZIP together, uploads reused files once, and retries a failed save without another upload", async () => {
    await choosePair(["folder/OPENING.mp4"]);
    expect(document.body.textContent).toContain("2 of 2 video references matched");
    onImport.mockRejectedValueOnce(new Error("The chapter changed."));
    await act(async () => button("Import plot tree").click());
    await settle();
    expect(mediaMocks.upload).toHaveBeenCalledTimes(1);
    expect(mediaMocks.add).toHaveBeenCalledWith("project-1", "media-1", expect.any(AbortSignal));
    expect(onImport).toHaveBeenCalledWith(expect.any(Object), "append", [
      { nodeId: "start", clipId: "one", mediaAssetId: "media-1" },
      { nodeId: "start", clipId: "two", mediaAssetId: "media-1" },
    ]);
    expect(document.querySelector('[role="alert"]')?.textContent).toBe("The chapter changed.");
    await act(async () => button("Import plot tree").click());
    await settle();
    expect(mediaMocks.upload).toHaveBeenCalledTimes(1);
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });
  it.each([["other.mp4"], ["one/opening.mp4", "two/opening.mp4"]])(
    "blocks missing or ambiguous ZIP matches before uploading: %s",
    async (...names) => {
      await choosePair(names);
      expect(button("Import plot tree").disabled).toBe(true);
      expect(document.body.textContent).toContain("0 of 2 video references matched");
      expect(mediaMocks.upload).not.toHaveBeenCalled();
    }
  );
  it("shows upload and verification progress, and closing aborts without importing late results", async () => {
    let finish!: (result: { mediaAssetId: string }) => void;
    mediaMocks.upload.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        })
    );
    await choosePair(["opening.mp4"]);
    await act(async () => button("Import plot tree").click());
    await settle();
    const options = mediaMocks.upload.mock.calls[0]![1];
    expect(document.body.textContent).toContain("Preparing video 1 / 1");
    await act(async () => options.onProgress(42));
    expect(document.body.textContent).toContain("Uploading video 1 of 1 · 42%");
    expect(document.querySelector("progress")?.value).toBe(42);
    await act(async () => {
      document.body.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, button: 0 }));
    });
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
    expect(options.signal.aborted).toBe(false);
    await act(async () => options.onConfirming());
    expect(document.body.textContent).toContain("Verifying video 1 / 1");
    expect(document.querySelector("progress")?.hasAttribute("value")).toBe(false);
    const close = document.querySelector<HTMLButtonElement>('[data-slot="dialog-close"]')!;
    await act(async () => close.click());
    expect(options.signal.aborted).toBe(true);
    await act(async () => button("Import Plot Tree").click());
    await choose(valid);
    await act(async () => finish({ mediaAssetId: "late-upload" }));
    expect(mediaMocks.add).not.toHaveBeenCalled();
    expect(onImport).not.toHaveBeenCalled();
    expect(button("Import plot tree").disabled).toBe(false);
    expect(document.querySelector('[role="alert"]')).toBeNull();
  });
  it("can cancel while attaching a video and does not import after the attachment finishes", async () => {
    let finish!: () => void;
    mediaMocks.add.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        })
    );
    await choosePair(["opening.mp4"]);
    await act(async () => button("Import plot tree").click());
    await settle();
    const signal = mediaMocks.add.mock.calls[0]![2] as AbortSignal;
    await act(async () => button("Cancel upload").click());
    expect(signal.aborted).toBe(true);
    await act(async () => finish());
    expect(onImport).not.toHaveBeenCalled();
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });
  it("retries a failed video attachment without uploading the video again", async () => {
    mediaMocks.add.mockRejectedValueOnce(new Error("Attachment failed"));
    await choosePair(["opening.mp4"]);
    await act(async () => button("Import plot tree").click());
    await settle();
    expect(document.querySelector('[role="alert"]')?.textContent).toBe("Attachment failed");
    expect(onImport).not.toHaveBeenCalled();
    await act(async () => button("Import plot tree").click());
    await settle();
    expect(mediaMocks.upload).toHaveBeenCalledTimes(1);
    expect(mediaMocks.add).toHaveBeenCalledTimes(2);
    expect(onImport).toHaveBeenCalledTimes(1);
  });
  it("blocks import after a ZIP read failure until the selection is corrected", async () => {
    await choose(valid);
    const input = document.querySelectorAll('input[type="file"]')[1]!;
    Object.defineProperty(input, "files", {
      configurable: true,
      value: [{ name: "invalid.zip", size: 4, arrayBuffer: async () => strToU8("oops").buffer }],
    });
    await act(async () => input.dispatchEvent(new Event("change", { bubbles: true })));
    expect(document.querySelector('[role="alert"]')).not.toBeNull();
    expect(button("Import plot tree").disabled).toBe(true);
    await choose(valid);
    expect(button("Import plot tree").disabled).toBe(false);
  });
  it("ignores an earlier file read after a later unsupported selection", async () => {
    let finish!: (value: string) => void;
    await choose(
      new Promise<string>((resolve) => {
        finish = resolve;
      })
    );
    const input = document.querySelector('input[type="file"]')!;
    Object.defineProperty(input, "files", { configurable: true, value: [{ name: "script.txt" }] });
    await act(async () => input.dispatchEvent(new Event("change", { bubbles: true })));
    await act(async () => finish(valid));
    expect(button("Import plot tree").disabled).toBe(true);
    expect(document.body.textContent).not.toContain("plot.json");
  });
});
