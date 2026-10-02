import { act, useLayoutEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { useScriptSnapshot } from "./use-script-snapshot";
const h = vi.hoisted(() => ({
  load: vi.fn(),
  generation: 1,
  active: true,
  status: "authenticated",
}));
vi.mock("@/auth", () => ({ useAuth: () => ({ generation: h.generation, status: h.status }) }));
vi.mock("@/auth/auth-store", () => ({ getAuthGeneration: () => h.generation }));
vi.mock("@/hooks/use-app-active", () => ({ useScreenActive: () => h.active }));
vi.mock("../api/story-production-api", () => ({ loadStoryScriptSnapshot: h.load }));
vi.mock("../lib/parse-script-snapshot", () => ({
  scriptDocumentToMarkdown: (value: { contentSnapshot: string }) => value.contentSnapshot,
}));
let result: ReturnType<typeof useScriptSnapshot>, root: Root, host: HTMLDivElement;
function Probe({ chapter }: { chapter: string }) {
  const value = useScriptSnapshot("project", chapter, true);
  useLayoutEffect(() => {
    result = value;
  });
  return (
    <span>
      {value.markdown}
      {value.error}
    </span>
  );
}
const render = async (chapter = "one") => {
  await act(async () => root.render(<Probe chapter={chapter} />));
};
const deferred = () => {
  let resolve!: (value: { contentSnapshot: string }) => void;
  const promise = new Promise<{ contentSnapshot: string }>((r) => {
    resolve = r;
  });
  return { promise, resolve };
};
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
beforeEach(() => {
  vi.resetAllMocks();
  h.generation = 1;
  h.active = true;
  h.status = "authenticated";
  host = document.createElement("div");
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
});
it("aborts a refresh and ignores its late reply after switching chapters", async () => {
  h.load.mockResolvedValueOnce({ contentSnapshot: "first" });
  await render();
  const old = deferred();
  h.load.mockReturnValueOnce(old.promise);
  await act(async () => result.refresh());
  const signal = h.load.mock.calls[1][2];
  h.load.mockResolvedValueOnce({ contentSnapshot: "second" });
  await render("two");
  expect(signal.aborted).toBe(true);
  await act(async () => old.resolve({ contentSnapshot: "wrong" }));
  expect(result.markdown).toBe("second");
});
it("hides previous account data immediately and rejects late account replies", async () => {
  const old = deferred();
  h.load.mockReturnValueOnce(old.promise);
  await render();
  h.generation = 2;
  h.load.mockResolvedValueOnce({ contentSnapshot: "new account" });
  await render();
  await act(async () => old.resolve({ contentSnapshot: "old account" }));
  expect(result.markdown).toBe("new account");
  h.status = "anonymous";
  await render();
  expect(result.markdown).toBe("");
});
it("pauses in background, ignores aborted errors and reloads on foreground", async () => {
  const old = deferred();
  h.load.mockReturnValueOnce(old.promise);
  await render();
  const signal = h.load.mock.calls[0][2];
  h.active = false;
  await render();
  expect(signal.aborted).toBe(true);
  expect(result.markdown).toBe("");
  await act(async () => old.resolve({ contentSnapshot: "late" }));
  expect(result.markdown).toBe("");
  h.active = true;
  h.load.mockResolvedValueOnce({ contentSnapshot: "current" });
  await render();
  expect(result.markdown).toBe("current");
});
it("surfaces backend errors and clears them after retry", async () => {
  h.load.mockRejectedValueOnce(Error("Permission revoked"));
  await render();
  expect(result.error).toBe("Permission revoked");
  h.load.mockResolvedValueOnce({ contentSnapshot: "retried" });
  await act(async () => result.refresh());
  expect(result.error).toBeUndefined();
  expect(result.markdown).toBe("retried");
});
