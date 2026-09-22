import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import Page from "./page";
const mocks = vi.hoisted(() => ({
  query: "code=A&projectId=1&worldId=10",
  post: vi.fn(),
  push: vi.fn(),
  replace: vi.fn(),
  open: vi.fn(),
  t: (key: string) => key,
}));
vi.mock("next/navigation", () => ({
  useRouter: () => mocks,
  useSearchParams: () => new URLSearchParams(mocks.query),
}));
vi.mock("@/src/i18n/i18n", () => ({ useLocale: () => "en-US", useTranslations: () => mocks.t }));
vi.mock("@/components/auth/auth-dialog-provider", () => ({
  useAuthDialog: () => ({ open: mocks.open }),
}));
vi.mock("@/src/lib/api", () => ({
  backendApi: { post: mocks.post },
  ApiRequestError: class extends Error {
    status = 401;
  },
}));
let root: Root, container: HTMLDivElement;
function deferred() {
  let resolve!: (v: unknown) => void;
  let reject!: (v: unknown) => void;
  const promise = new Promise((r, j) => {
    resolve = r;
    reject = j;
  });
  return { resolve, reject, promise };
}
beforeEach(async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.useFakeTimers();
  mocks.query = "code=A&projectId=1&worldId=10";
  mocks.post.mockReset();
  mocks.push.mockReset();
  mocks.post.mockImplementation(async (url: string) =>
    url.includes("getByInviteCode") ? { projectId: "1", worldId: "10", projectName: "A" } : {}
  );
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root.render(<Page />));
});
afterEach(async () => {
  await act(async () => root.unmount());
  vi.clearAllTimers();
  vi.useRealTimers();
  container.remove();
});
async function click(label: string) {
  const button = [...container.querySelectorAll("button")].find((b) => b.textContent === label)!;
  expect(button).toBeTruthy();
  await act(async () => button.click());
}
it("does not navigate when a running approval poll resolves after unmount", async () => {
  await click("accept");
  const pending = deferred();
  mocks.post.mockReturnValueOnce(pending.promise);
  await act(async () => vi.advanceTimersByTime(30_000));
  await act(async () => root.render(null));
  await act(async () => pending.resolve({ worldId: "10" }));
  expect(mocks.push).not.toHaveBeenCalled();
});
it("does not restart polling after a running check fails on an unmounted page", async () => {
  await click("accept");
  const pending = deferred();
  mocks.post.mockReturnValueOnce(pending.promise);
  await act(async () => vi.advanceTimersByTime(30_000));
  await act(async () => root.render(null));
  await act(async () => pending.reject(new Error("not approved")));
  const count = mocks.post.mock.calls.length;
  await act(async () => vi.advanceTimersByTime(50_000));
  expect(mocks.post).toHaveBeenCalledTimes(count);
});
it("does not start polling when an application completes after leaving", async () => {
  const pending = deferred();
  mocks.post.mockReturnValueOnce(pending.promise);
  await click("accept");
  await act(async () => root.render(null));
  await act(async () => pending.resolve({}));
  const count = mocks.post.mock.calls.length;
  await act(async () => vi.advanceTimersByTime(30_000));
  expect(mocks.post).toHaveBeenCalledTimes(count);
});
it("uses the replacement invitation project instead of retaining the old project", async () => {
  mocks.query = "code=B&projectId=2&worldId=20";
  mocks.post.mockResolvedValueOnce({ projectId: "2", worldId: "20", joined: true });
  await act(async () => root.render(<Page />));
  await click("enterProject");
  expect(mocks.push).toHaveBeenCalledWith("/en-US/art-studio/projects/2?worldId=20");
});
it("still navigates after an active invitation is approved", async () => {
  await click("accept");
  mocks.post.mockResolvedValueOnce({ worldId: "10" });
  await act(async () => vi.advanceTimersByTime(30_000));
  expect(mocks.push).toHaveBeenCalledWith("/en-US/art-studio/projects/1?worldId=10");
});
it("ignores a manual approval result after the user chooses Back Home", async () => {
  await click("accept");
  const pending = deferred();
  mocks.post.mockReturnValueOnce(pending.promise);
  await click("refresh");
  await click("backHome");
  await act(async () => pending.resolve({ worldId: "10" }));
  expect(mocks.push.mock.calls).toEqual([["/"]]);
});
it("ignores a delayed workspace lookup after leaving an already-joined invitation", async () => {
  mocks.query = "code=B&projectId=2";
  mocks.post.mockResolvedValueOnce({ projectId: "2", joined: true });
  await act(async () => root.render(<Page />));
  const pending = deferred();
  mocks.post.mockReturnValueOnce(pending.promise);
  await click("enterProject");
  await act(async () => root.render(null));
  await act(async () => pending.resolve({ worldId: "20" }));
  expect(mocks.push).not.toHaveBeenCalled();
});
