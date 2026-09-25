import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { CaseEvidence } from "./case-evidence";
import { PrivateCasesScreen } from "./private-cases";
import { attachmentFileError } from "../_hooks/use-case-attachments";
import { CrewApiError } from "../_hooks/api";
const h = vi.hoisted(() => ({ user: "alice", get: vi.fn(), post: vi.fn(), put: vi.fn() }));
vi.mock("@/src/hooks/use-user", () => ({ useCurrentUser: () => ({ user: { id: h.user } }) }));
vi.mock("@/src/i18n/i18n", () => ({
  useLocale: () => "en-US",
  useTranslations: () => (key: string) => key,
}));
vi.mock("../_hooks/api", async (original) => ({
  ...(await original<typeof import("../_hooks/api")>()),
  crewApi: {
    get: (...args: unknown[]) => h.get(...args),
    post: (...args: unknown[]) => h.post(...args),
  },
}));
const placement = {
  url: "https://storage.example/upload?signature=private",
  method: "PUT",
  headers: { "Content-Type": "application/pdf", "x-provider": "required" },
  expiresAt: "2099-01-01T00:00:00Z",
};
const fileRow = {
  id: "file",
  name: "evidence.pdf",
  contentType: "application/pdf",
  sizeBytes: 10,
  ready: true,
  shared: false,
  createdAt: "2026-09-25T00:00:00Z",
};
const page = { items: [fileRow], nextBeforeId: null };
const caseRow = {
  id: "case",
  taskId: "task",
  openedByUserId: "alice",
  respondentUserId: "bob",
  title: "Private case",
  status: "open",
  ownerAdminId: null,
  version: 1,
  createdAt: "2026-09-25T00:00:00Z",
  updatedAt: "2026-09-25T00:00:00Z",
  events: [],
  nextBeforeVersion: null,
};
let root: Root, host: HTMLDivElement, qc: QueryClient;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  h.user = "alice";
  vi.clearAllMocks();
  h.get.mockReset().mockResolvedValue(page);
  h.post
    .mockReset()
    .mockImplementation((path: string) =>
      Promise.resolve(path.endsWith("/confirm") ? { id: "file" } : placement)
    );
  h.put.mockReset().mockResolvedValue({ ok: true });
  vi.stubGlobal("fetch", h.put);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});
afterEach(async () => {
  await act(async () => root.unmount());
  qc.clear();
  host.remove();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
function Harness() {
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  return (
    <>
      <span data-selected>{selected.join(",")}</span>
      <span data-busy>{String(busy)}</span>
      <CaseEvidence
        userId={h.user}
        caseId="case"
        disabled={false}
        selected={selected}
        onSelect={setSelected}
        onBusy={setBusy}
      />
    </>
  );
}
async function flush() {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 25));
  });
}
async function render(full = false) {
  await act(async () =>
    root.render(
      <QueryClientProvider client={qc}>
        {full ? <PrivateCasesScreen caseId="case" /> : <Harness key={h.user} />}
      </QueryClientProvider>
    )
  );
  await flush();
}
function button(key: string) {
  return [...host.querySelectorAll("button")].find((b) => b.textContent === key)!;
}
async function click(key: string) {
  expect(button(key)).toBeDefined();
  await act(async () => button(key).click());
  await flush();
}
async function upload(file = new File(["pdf data"], "proof.pdf", { type: "application/pdf" })) {
  await act(async () => {
    const el = host.querySelector<HTMLInputElement>('input[type="file"]')!;
    Object.defineProperty(el, "files", { value: [file], configurable: true });
    el.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await flush();
}
async function select() {
  await act(async () => host.querySelector<HTMLButtonElement>('[role="checkbox"]')!.click());
}
async function message() {
  await act(async () => {
    const el = host.querySelector("textarea")!;
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(
      el,
      "Review evidence"
    );
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
it("uploads privately with required headers and confirms without sharing", async () => {
  await render();
  const file = new File(["pdf"], "proof.pdf", { type: "application/pdf" });
  await upload(file);
  expect(h.post.mock.calls[0][1].body).toEqual({
    name: "proof.pdf",
    contentType: "application/pdf",
    sizeBytes: 3,
  });
  const prepare = h.post.mock.calls[0][0];
  expect(h.post.mock.calls[1][0]).toBe(`${prepare}/confirm`);
  expect(h.put).toHaveBeenCalledWith(
    placement.url,
    expect.objectContaining({
      method: "PUT",
      headers: placement.headers,
      body: file,
      credentials: "omit",
      referrerPolicy: "no-referrer",
    })
  );
  expect(host.querySelector("[data-selected]")!.textContent).toBe("");
  expect(h.post.mock.calls.some((c) => c[0].endsWith("/events"))).toBe(false);
});
it.each([
  new File([], "empty.pdf", { type: "application/pdf" }),
  new File(["x"], "file.svg", { type: "image/svg+xml" }),
  new File(["x"], 'bad"name.pdf', { type: "application/pdf" }),
])("rejects unsupported or invalid files before prepare", async (file) => {
  await render();
  await upload(file);
  expect(h.post).not.toHaveBeenCalled();
  expect(host.textContent).toContain("fileInvalid");
});
it("checks exact upload size boundaries", () => {
  expect(
    attachmentFileError(
      new File([new Uint8Array(10 * 1024 * 1024)], "proof.png", { type: "image/png" })
    )
  ).toBe(false);
  expect(
    attachmentFileError(
      new File([new Uint8Array(10 * 1024 * 1024 + 1)], "proof.png", { type: "image/png" })
    )
  ).toBe(true);
});
it("retries prepare with the same upload identity", async () => {
  h.post
    .mockRejectedValueOnce(new Error("Lost prepare"))
    .mockResolvedValueOnce(placement)
    .mockResolvedValue({ id: "file" });
  await render();
  await upload();
  const first = h.post.mock.calls[0];
  await click("retry");
  expect(h.post.mock.calls[1][0]).toBe(first[0]);
  expect(h.post.mock.calls[1][1].body).toEqual(first[1].body);
});
it("retries confirmation without reuploading bytes", async () => {
  h.post
    .mockResolvedValueOnce(placement)
    .mockRejectedValueOnce(new Error("Lost confirmation"))
    .mockResolvedValue({ id: "file" });
  await render();
  await upload();
  expect(h.put).toHaveBeenCalledTimes(1);
  await click("retry");
  expect(h.put).toHaveBeenCalledTimes(1);
  expect(h.post.mock.calls[2][0]).toBe(h.post.mock.calls[1][0]);
});
it("recovers uncertain stored bytes without repeating PUT", async () => {
  h.put.mockRejectedValue(new Error("Lost upload response"));
  await render();
  await upload();
  expect(h.post).toHaveBeenCalledTimes(1);
  await click("confirmStored");
  expect(h.put).toHaveBeenCalledTimes(1);
  expect(h.post.mock.calls[1][0]).toMatch(/\/confirm$/);
});
it("does not use expired upload links", async () => {
  h.post.mockResolvedValue({ ...placement, expiresAt: "2000-01-01T00:00:00Z" });
  await render();
  await upload();
  expect(h.put).not.toHaveBeenCalled();
  expect(host.textContent).toContain("expired");
});
it("authorizes each download and removes denied or unsafe links", async () => {
  h.get.mockImplementation((path: string) =>
    Promise.resolve(
      path.endsWith("/read")
        ? { url: "https://storage.example/private", expiresAt: "2099-01-01T00:00:00Z" }
        : page
    )
  );
  await render();
  await click("requestRead");
  const link = host.querySelector("a")!;
  expect(link.href).toBe("https://storage.example/private");
  expect(link.rel).toBe("noopener noreferrer");
  h.get.mockRejectedValue(new CrewApiError(404, { message: "Unavailable" }));
  await click("requestRead");
  expect(host.querySelector("a")).toBeNull();
  expect(host.textContent).toContain("Unavailable");
});
it("rejects non-https read links", async () => {
  h.get.mockImplementation((path: string) =>
    Promise.resolve(
      path.endsWith("/read")
        ? { url: "javascript:alert(1)", expiresAt: "2099-01-01T00:00:00Z" }
        : page
    )
  );
  await render();
  await click("requestRead");
  expect(host.querySelector("a")).toBeNull();
  expect(host.textContent).toContain("invalidUrl");
});
it("shared files are readable but not selectable; own pending files are confirmable", async () => {
  h.get.mockResolvedValue({
    items: [
      { ...fileRow, shared: true },
      { ...fileRow, id: "pending", ready: false },
    ],
    nextBeforeId: null,
  });
  await render();
  expect(host.querySelector('[role="checkbox"]')).toBeNull();
  expect(button("requestRead")).toBeDefined();
  await click("confirmStored");
  expect(h.post.mock.calls[0][0]).toBe("/crew-disputes/case/attachments/pending/confirm");
});
it("paginates with attachment-scoped cursors and hides records after a failed read", async () => {
  h.get
    .mockResolvedValueOnce({ ...page, nextBeforeId: "file" })
    .mockResolvedValue({ items: [], nextBeforeId: null });
  await render();
  await click("more");
  expect(h.get.mock.calls[1][1].query).toEqual({ limit: 20, beforeId: "file" });
  h.get.mockRejectedValue(new Error("Denied"));
  await click("refresh");
  expect(host.textContent).not.toContain("evidence.pdf");
});
it("aborts an upload on account switch and ignores late responses", async () => {
  let done!: (v: unknown) => void;
  h.post.mockImplementation(
    () =>
      new Promise((r) => {
        done = r;
      })
  );
  await render();
  await upload();
  const signal = h.post.mock.calls[0][1].signal;
  h.user = "bob";
  await render();
  expect(signal.aborted).toBe(true);
  await act(async () => done(placement));
  expect(h.put).not.toHaveBeenCalled();
  expect(host.textContent).not.toContain("recover");
});
it.each(["open", "resolved"])(
  "shares selected evidence only with the explicit %s case action and preserves retry",
  async (status) => {
    h.get.mockImplementation((path: string) =>
      Promise.resolve(path.endsWith("/attachments") ? page : { ...caseRow, status })
    );
    h.post
      .mockRejectedValueOnce(new Error("Lost event"))
      .mockResolvedValue({ ...caseRow, version: 2 });
    await render(true);
    await select();
    await message();
    await click(status === "resolved" ? "reopen" : "send");
    const first = h.post.mock.calls[0];
    expect(first[1].body.attachmentIds).toEqual(["file"]);
    expect(first[1].body.action).toBe(status === "resolved" ? "appeal" : "message");
    await click("retryWrite");
    expect(h.post.mock.calls[1]).toEqual(first);
  }
);

it("expires download links instead of retaining them in the UI", async () => {
  h.get.mockImplementation((path: string) =>
    Promise.resolve(
      path.endsWith("/read")
        ? {
            url: "https://storage.example/private",
            expiresAt: new Date(Date.now() + 60_000).toISOString(),
          }
        : page
    )
  );
  await render();
  await click("requestRead");
  expect(host.querySelector("a")).not.toBeNull();
  vi.useFakeTimers();
  // Re-request while fake time is active so the link timer is controlled.
  await act(async () => button("requestRead").click());
  await act(async () => vi.advanceTimersByTime(60_001));
  expect(host.querySelector("a")).toBeNull();
  vi.useRealTimers();
});
it("blocks sending selected evidence after a failed list read until explicitly cleared", async () => {
  h.get.mockImplementation((path: string) =>
    Promise.resolve(path.endsWith("/attachments") ? page : caseRow)
  );
  await render(true);
  await select();
  await message();
  h.get.mockImplementation((path: string) =>
    path.endsWith("/attachments")
      ? Promise.reject(new Error("Evidence unavailable"))
      : Promise.resolve(caseRow)
  );
  await act(async () =>
    [...host.querySelectorAll('section[aria-label="title"] button')]
      .find((b) => b.textContent === "refresh")!
      .dispatchEvent(new MouseEvent("click", { bubbles: true }))
  );
  await flush();
  expect(button("send").disabled).toBe(true);
  expect(host.textContent).toContain("evidenceChanged");
  await click("clearEvidence");
  expect(button("send").disabled).toBe(false);
});
it("caps explicit sharing selections at twenty", async () => {
  h.get.mockResolvedValue({
    items: Array.from({ length: 21 }, (_, i) => ({ ...fileRow, id: `file-${i}` })),
    nextBeforeId: null,
  });
  await render();
  const boxes = host.querySelectorAll<HTMLButtonElement>('[role="checkbox"]');
  for (let i = 0; i < 20; i++) await act(async () => boxes[i].click());
  expect(boxes[20].disabled).toBe(true);
});
