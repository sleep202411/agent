// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { AdminSessionBoundary } from "../admin-session-boundary";
import { ReleasesPanel } from "./releases-panel";
import type { AppReleaseRow } from "./releases-types";
vi.mock("../billing/shared", async (original) => ({
  ...(await original<object>()),
  AdminDialog: ({ children, footer }: { children: ReactNode; footer: ReactNode }) => (
    <section role="dialog">
      {children}
      {footer}
    </section>
  ),
}));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | undefined;
let container: HTMLDivElement;
const fetchMock = vi.fn();
const row: AppReleaseRow = {
  id: "release",
  platform: "android",
  versionName: "1.0",
  versionCode: 1,
  downloadUrl: "https://fixture.invalid/app",
  releaseNotes: "Original",
  minSupportedCode: null,
  active: true,
  createdAt: "2026-01-01",
  updatedAt: "2026-01-01",
};
const response = (ok = true) => ({
  ok,
  status: ok ? 200 : 503,
  json: () =>
    Promise.resolve({
      code: ok ? 200 : 503,
      msg: "Release service unavailable",
      data: { items: [row] },
    }),
});
function deferred() {
  let resolve!: (value: ReturnType<typeof response>) => void;
  const promise = new Promise<ReturnType<typeof response>>((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
}
async function render(scope = "one") {
  vi.stubGlobal("fetch", fetchMock);
  if (!root) {
    container = document.createElement("div");
    root = createRoot(container);
  }
  await act(async () =>
    root!.render(
      <AdminSessionBoundary scopeKey={scope}>
        <ReleasesPanel
          siteLabel="Test"
          databaseLabel="Local"
          initialData={{ items: [row] }}
          initialError={null}
        />
      </AdminSessionBoundary>
    )
  );
}
function button(text: string) {
  return [...container.querySelectorAll("button")].find((b) => b.textContent?.trim() === text)!;
}
function submit() {
  container
    .querySelector("form")!
    .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
}
afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
  vi.resetAllMocks();
  vi.unstubAllGlobals();
});
it("protects saves from repeated submissions and retains failed drafts with an inline error", async () => {
  const pending = deferred();
  fetchMock.mockReturnValueOnce(pending.promise).mockResolvedValue(response());
  await render();
  await act(async () => button("编辑").click());
  container.querySelector<HTMLTextAreaElement>("textarea")!.value = "Retained notes";
  await act(async () => {
    submit();
    submit();
  });
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(container.querySelector("form")?.hasAttribute("inert")).toBe(true);
  await act(async () => {
    pending.resolve(response(false));
  });
  expect(container.textContent).toContain("Release service unavailable");
  expect(container.querySelector<HTMLTextAreaElement>("textarea")!.value).toBe("Retained notes");
  await act(async () => submit());
  expect(fetchMock).toHaveBeenCalledTimes(3);
  expect(container.querySelector("form")).toBeNull();
});
it("suppresses abandoned saves without follow-up refreshes in a new session", async () => {
  const pending = deferred();
  fetchMock.mockReturnValueOnce(pending.promise);
  await render();
  await act(async () => button("编辑").click());
  await act(async () => submit());
  const signal = fetchMock.mock.calls[0][1].signal as AbortSignal;
  await render("two");
  expect(signal.aborted).toBe(true);
  await act(async () => {
    pending.resolve(response());
  });
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(container.querySelector("form")).toBeNull();
});
it("blocks unsafe and inconsistent version fields before transport", async () => {
  fetchMock.mockResolvedValue(response());
  await render();
  await act(async () => button("编辑").click());
  const code = container.querySelector<HTMLInputElement>('[name="versionCode"]')!;
  code.value = "9007199254740993";
  await act(async () => submit());
  expect(fetchMock).not.toHaveBeenCalled();
  expect(container.textContent).toContain("2147483647");
  code.value = "2";
  const minimum = container.querySelector<HTMLInputElement>('[name="minSupportedCode"]')!;
  minimum.value = "3";
  await act(async () => submit());
  expect(fetchMock).not.toHaveBeenCalled();
  expect(container.textContent).toContain("cannot exceed");
  minimum.value = "1";
  await act(async () => submit());
  expect(fetchMock).toHaveBeenCalledTimes(2);
});
it("retains accepted activation state after refresh failure and retries only the read", async () => {
  const pending = deferred();
  fetchMock
    .mockReturnValueOnce(pending.promise)
    .mockResolvedValueOnce(response(false))
    .mockResolvedValue(response());
  await render();
  const toggle = button("停用");
  await act(async () => {
    toggle.click();
    toggle.click();
  });
  expect(fetchMock).toHaveBeenCalledTimes(1);
  await act(async () => {
    pending.resolve(response());
  });
  expect(button("启用")).toBeDefined();
  expect(container.textContent).toContain("Release service unavailable");
  await act(async () => button("刷新").click());
  expect(fetchMock.mock.calls.map((call) => call[1].method)).toEqual([
    "PATCH",
    undefined,
    undefined,
  ]);
});
