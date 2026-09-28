// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { AiActorsPage } from "./ai-actors-page";

const actor = {
  id: "actor",
  name: "Mira",
  photoAssetId: "old-photo",
  active: true,
  _count: { unlocks: 1, uses: 2 },
};
let root: Root;
let host: HTMLDivElement;
let fetcher: ReturnType<typeof vi.fn>;
function envelope(data: unknown) {
  return Response.json({ code: 200, data });
}
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", {
    configurable: true,
    value() {
      this.open = true;
    },
  });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  fetcher = vi.fn().mockResolvedValue(envelope({ items: [actor], total: 1 }));
  // Fresh bodies are needed for every request.
  fetcher.mockImplementation(async () => envelope({ items: [actor], total: 1 }));
  vi.stubGlobal("fetch", fetcher);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
  delete (HTMLDialogElement.prototype as { showModal?: unknown }).showModal;
});
async function render(canWrite = true) {
  await act(async () => root.render(<AiActorsPage canWrite={canWrite} />));
}
function button(text: string) {
  return [...host.querySelectorAll("button")].find((b) => b.textContent === text)!;
}
async function click(text: string) {
  await act(async () => button(text).click());
}

it("retains the original photo and reports a failed confirmation without saving it", async () => {
  await render();
  await click("Edit");
  fetcher.mockImplementation(async (url: string) => {
    if (url.endsWith("upload-url"))
      return envelope({
        uploadUrl: "https://upload.invalid/photo",
        method: "PUT",
        headers: {},
        storageKey: "new-key",
      });
    if (url === "https://upload.invalid/photo") return new Response(null, { status: 200 });
    if (url.endsWith("confirm"))
      return Response.json({ code: 409, msg: "Photo verification failed" }, { status: 409 });
    throw new Error("Unexpected request");
  });
  const input = host.querySelector('input[type="file"]')!;
  Object.defineProperty(input, "files", {
    value: [new File(["image"], "photo.png", { type: "image/png" })],
  });
  await act(async () => {
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
  expect(host.querySelector('[role="alert"]')?.textContent).toBe("Photo verification failed");
  expect(host.querySelector('img[alt="Actor preview"]')?.getAttribute("src")).toContain(
    "old-photo"
  );
  expect(button("Save actor").disabled).toBe(false);
  expect(
    fetcher.mock.calls.filter(
      ([url, options]) => url.endsWith("/ai-actors") && options?.method === "POST"
    )
  ).toHaveLength(0);
});

it("does not let a cancelled save close a newly opened editor", async () => {
  await render();
  await click("Edit");
  let finish!: (value: Response) => void;
  let signal!: AbortSignal;
  fetcher.mockImplementation((_url: string, options: RequestInit) => {
    signal = options.signal!;
    return new Promise((resolve) => {
      finish = resolve;
    });
  });
  await click("Save actor");
  await click("Cancel");
  expect(signal.aborted).toBe(true);
  await click("Add actor");
  await act(async () => finish(envelope(actor)));
  expect(host.querySelector('dialog[aria-label="Add actor"]')).not.toBeNull();
});

it("keeps write actions disabled for a read-only admin", async () => {
  await render(false);
  expect(button("Add actor").disabled).toBe(true);
  expect(button("Edit").disabled).toBe(true);
  expect(button("Usage").disabled).toBe(false);
});

const usageRow = (name: string) => ({
  id: name,
  userId: "user",
  workspaceId: "workspace",
  projectId: "project",
  workspace: { name: "Workspace" },
  project: { name },
  createdAt: "2026-09-23T00:00:00Z",
});
function usageButton(text: string) {
  return [...host.querySelectorAll<HTMLButtonElement>("dialog button")].find(
    (b) => b.textContent === text
  );
}
it("lets an operator return to the previous usage page after a later page fails", async () => {
  await render();
  fetcher.mockImplementation(async (url: string) =>
    url.includes("page=2")
      ? Response.json({ code: 503, msg: "Usage unavailable" }, { status: 503 })
      : envelope({ items: [usageRow("First project")], total: 25 })
  );
  await click("Usage");
  await act(async () => usageButton("Next")!.click());
  expect(host.querySelector("dialog")!.textContent).toContain("Usage unavailable");
  expect(usageButton("Previous")).toBeDefined();
  expect(usageButton("Next")!.disabled).toBe(true);
  await act(async () => usageButton("Previous")!.click());
  expect(host.querySelector("dialog")!.textContent).toContain("First project");
  expect(host.querySelector("dialog")!.textContent).toContain("Page 1");
});
it("can leave a loading usage page and ignores its late result", async () => {
  await render();
  let finish!: (response: Response) => void;
  let signal!: AbortSignal;
  fetcher.mockImplementation(async (url: string, options: RequestInit) => {
    if (url.includes("page=2")) {
      signal = options.signal!;
      return new Promise<Response>((resolve) => {
        finish = resolve;
      });
    }
    return envelope({ items: [usageRow("First project")], total: 25 });
  });
  await click("Usage");
  await act(async () => usageButton("Next")!.click());
  expect(usageButton("Previous")).toBeDefined();
  await act(async () => usageButton("Previous")!.click());
  expect(signal.aborted).toBe(true);
  await act(async () => finish(envelope({ items: [usageRow("Late project")], total: 25 })));
  expect(host.querySelector("dialog")!.textContent).toContain("First project");
  expect(host.querySelector("dialog")!.textContent).not.toContain("Late project");
});

it("retries the failed usage page without losing its page number", async () => {
  await render();
  let failed = false;
  fetcher.mockImplementation(async (url: string) => {
    if (!url.includes("page=2")) return envelope({ items: [usageRow("First project")], total: 25 });
    if (!failed) {
      failed = true;
      return Response.json({ code: 503, msg: "Usage unavailable" }, { status: 503 });
    }
    return envelope({ items: [usageRow("Second project")], total: 25 });
  });
  await click("Usage");
  await act(async () => usageButton("Next")!.click());
  expect(host.querySelector("dialog")!.textContent).toContain("Page 2");
  await act(async () => usageButton("Retry")!.click());
  expect(host.querySelector("dialog")!.textContent).toContain("Second project");
  expect(usageButton("Next")!.disabled).toBe(true);
  expect(usageButton("Previous")!.disabled).toBe(false);
});
