// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { AdminSessionBoundary } from "../admin-session-boundary";
import { NewsEditor } from "./news-editor";
import { emptyLocalizedContent, type NewsArticle } from "./types";
const router = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));
vi.mock("./rich-text-editor", () => ({ RichTextEditor: () => null }));
vi.mock("./news-tag-dialog", () => ({ NewsTagDialog: () => null }));
vi.mock("@/components/ui/button", () => ({
  Button: ({
    children,
    variant,
    size,
    ...props
  }: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: string; size?: string }) => (
    <button {...props} data-variant={variant} data-size={size}>
      {children}
    </button>
  ),
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | undefined;
let container: HTMLDivElement;
const fetchMock = vi.fn();

const localized = emptyLocalizedContent();
localized["zh-CN"] = {
  ...localized["zh-CN"],
  title: "Original title",
  url: "https://example.com/article",
};
const article: NewsArticle = {
  id: "one",
  kind: "external",
  url: "https://example.com/article",
  author: "Author",
  status: "draft",
  tagIds: [],
  publishedAt: null,
  localized,
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
};
const view = (id = "one") => (
  <NewsEditor
    mode="edit"
    existing={{ ...article, id }}
    tags={[]}
    siteLabel="Global"
    databaseLabel="Fixture"
  />
);
function response(data: unknown = {}) {
  return { ok: true, json: () => Promise.resolve({ code: 200, data }) };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
async function render(view: ReactNode, session = "alice") {
  vi.stubGlobal("fetch", fetchMock);
  if (!root) {
    container = document.createElement("div");
    root = createRoot(container);
  }
  await act(async () =>
    root!.render(<AdminSessionBoundary scopeKey={session}>{view}</AdminSessionBoundary>)
  );
}
function click(text: string) {
  [...container.querySelectorAll("button")]
    .find((button) => (button.getAttribute("aria-label") ?? button.textContent?.trim()) === text)!
    .click();
}
afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
  vi.resetAllMocks();
  vi.unstubAllGlobals();
});

async function chooseFile(twice = false) {
  const field = container.querySelector<HTMLInputElement>('input[type="file"]')!;
  Object.defineProperty(field, "files", {
    configurable: true,
    value: [new File(["image"], "cover.png", { type: "image/png" })],
  });
  await act(async () => {
    field.dispatchEvent(new Event("change", { bubbles: true }));
    if (twice) field.dispatchEvent(new Event("change", { bubbles: true }));
  });
}
const signed = () =>
  response({
    uploadUrl: "https://storage.invalid/upload",
    method: "PUT",
    headers: {},
    storageKey: "fixture-key",
  });
it("excludes duplicate saves and retains active failures for retry", async () => {
  const pending = deferred<ReturnType<typeof response>>();
  fetchMock.mockReturnValueOnce(pending.promise).mockResolvedValue(response());
  await render(view());
  await act(async () => {
    click("保存资讯");
    click("保存资讯");
  });
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(container.querySelector("[inert]")).not.toBeNull();
  await act(async () => pending.reject(new Error("Save unavailable")));
  expect(container.textContent).toContain("Save unavailable");
  await act(async () => click("保存资讯"));
  expect(router.push).toHaveBeenCalledWith("/news");
  expect(router.refresh).toHaveBeenCalledOnce();
  await act(async () => click("保存资讯"));
  expect(fetchMock).toHaveBeenCalledTimes(2);
});
it("cancels a departed editor without late navigation", async () => {
  const pending = deferred<ReturnType<typeof response>>();
  fetchMock.mockReturnValue(pending.promise);
  await render(view());
  await act(async () => click("保存资讯"));
  const signal = fetchMock.mock.calls[0][1].signal as AbortSignal;
  await act(async () => click("取消"));
  expect(signal.aborted).toBe(true);
  await act(async () => pending.resolve(response()));
  expect(router.push).toHaveBeenCalledTimes(1);
  expect(router.refresh).not.toHaveBeenCalled();
});
it("cancels replacement-target saves and preserves the replacement form", async () => {
  const pending = deferred<ReturnType<typeof response>>();
  fetchMock.mockReturnValue(pending.promise);
  await render(view());
  await act(async () => click("保存资讯"));
  const signal = fetchMock.mock.calls[0][1].signal as AbortSignal;
  await render(view("two"));
  expect(signal.aborted).toBe(true);
  await act(async () => pending.reject(new Error("Old target failure")));
  expect(container.textContent).not.toContain("Old target failure");
  expect(router.push).not.toHaveBeenCalled();
});
it("excludes duplicate uploads and prevents a save before confirmation", async () => {
  const pending = deferred<ReturnType<typeof response>>();
  fetchMock
    .mockReturnValueOnce(pending.promise)
    .mockResolvedValueOnce(response())
    .mockResolvedValueOnce(response({ url: "https://cdn.invalid/cover" }))
    .mockResolvedValue(response());
  await render(view());
  await chooseFile(true);
  await act(async () => click("保存中…"));
  expect(fetchMock).toHaveBeenCalledTimes(1);
  await act(async () => pending.resolve(signed()));
  expect(fetchMock).toHaveBeenCalledTimes(3);
  await act(async () => click("保存资讯"));
  expect(JSON.parse(fetchMock.mock.calls[3][1].body).localized["zh-CN"].coverUrl).toBe(
    "https://cdn.invalid/cover"
  );
});
it("stops after a cancelled storage upload without confirming or attaching it", async () => {
  const pending = deferred<ReturnType<typeof response>>();
  fetchMock.mockResolvedValueOnce(signed()).mockReturnValueOnce(pending.promise);
  await render(view());
  await chooseFile();
  const signal = fetchMock.mock.calls[1][1].signal as AbortSignal;
  await render(view(), "bob");
  expect(signal.aborted).toBe(true);
  await act(async () => pending.resolve(response()));
  expect(fetchMock).toHaveBeenCalledTimes(2);
  expect(container.querySelector("img")).toBeNull();
});
