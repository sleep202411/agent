// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import messages from "@/messages/en-US.json";
import { StoryPlotImportDialog } from "./story-plot-import-dialog";

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
          <StoryPlotImportDialog disabled={disabled} hasNodes={hasNodes} onImport={onImport} />
        </NextIntlClientProvider>
      )
    );
  beforeEach(async () => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    onImport.mockReset();
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
    await choose(valid, 2 * 1024 * 1024 + 1);
    expect(document.querySelector('[role="alert"]')?.textContent).toContain("too large");
    expect(button("Import plot tree").disabled).toBe(true);
  });
  it("highlights file drags and validates drops without submitting or navigating", async () => {
    const event = await dragFiles("dragenter");
    expect(event.defaultPrevented).toBe(true);
    expect(document.body.textContent).toContain("Drop to select this file");
    const child = document.querySelector('button[aria-label="Choose JSON file"] svg')!;
    await dragFiles("dragenter", ["plot.json"], child);
    await dragFiles("dragleave", ["plot.json"], child);
    expect(document.body.textContent).toContain("Drop to select this file");
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
    "ignores a previous import's late %s after reopening",
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
      const close = document.querySelector<HTMLButtonElement>('[data-slot="dialog-close"]')!;
      await act(async () => close.click());
      await act(async () => button("Import Plot Tree").click());
      await choose(valid);
      await act(async () =>
        outcome === "resolve" ? resolve() : reject(new Error("Old import failed"))
      );
      await settle();
      expect(document.querySelector('[role="dialog"]')).not.toBeNull();
      expect(document.querySelector('[role="alert"]')).toBeNull();
      expect(button("Import plot tree").disabled).toBe(false);
      expect(document.body.textContent).toContain("plot.json");
    }
  );
});
