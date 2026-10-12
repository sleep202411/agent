import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { IpGenerationPanel } from "./ip-generation-panel";
const h = vi.hoisted(() => ({
  generation: 1,
  get: vi.fn(),
  post: vi.fn(),
  pick: vi.fn(),
  upload: vi.fn(),
  alert: vi.fn(),
}));
vi.mock("@/auth", () => ({
  useAuth: () => ({ generation: h.generation, user: { id: String(h.generation) } }),
  useAuthGate: () => ({ requireAuth: vi.fn() }),
}));
vi.mock("@/auth/auth-store", () => ({ getAuthGeneration: () => h.generation }));
vi.mock("@/lib/api-client", () => ({ api: { get: h.get, post: h.post } }));
vi.mock("expo-document-picker", () => ({ getDocumentAsync: h.pick }));
vi.mock("@/lib/media-upload", () => ({ uploadMobileMediaFile: h.upload }));
vi.mock("@/constants/theme", () => ({ Spacing: {} }));
vi.mock("@/hooks/use-theme", () => ({ useTheme: () => ({}) }));
vi.mock("@/i18n", () => ({ useTranslations: () => (key: string) => key }));
vi.mock("@/features/paywall/lib/use-compute-wallet-balance", () => ({
  useComputeWalletBalance: () => 100,
}));
vi.mock("./use-ip-generation-preview", () => ({
  useIpGenerationPreview: () => ({
    costPreview: { computePoints: 10, isFree: false },
    previewLoading: false,
    previewError: false,
  }),
}));
vi.mock("@/components/themed-text", () => ({
  ThemedText: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}));
vi.mock("react-native", () => ({
  ActivityIndicator: () => null,
  Alert: { alert: h.alert },
  Linking: { openURL: vi.fn() },
  Image: () => <div>uploaded-image</div>,
  StyleSheet: { create: (value: unknown) => value },
  View: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  ScrollView: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  Pressable: ({
    children,
    onPress,
    disabled,
  }: {
    children: ReactNode;
    onPress: () => void;
    disabled?: boolean;
  }) => (
    <button onClick={onPress} disabled={disabled}>
      {children}
    </button>
  ),
}));
const template = { id: "old-template", name: "Old template", requireReferenceImage: true };
let root: Root;
let host: HTMLDivElement;
const render = (ipId = "one") => act(async () => root.render(<IpGenerationPanel ipId={ipId} />));
const click = (text: string) =>
  act(async () => {
    [...host.querySelectorAll("button")].find((button) => button.textContent === text)!.click();
  });
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  h.generation = 1;
  for (const mock of [h.get, h.post, h.pick, h.upload, h.alert]) mock.mockReset();
  h.get.mockResolvedValue({ templates: [template] });
  host = document.createElement("div");
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  vi.unstubAllGlobals();
});
it.each(["ip", "session"])(
  "removes old templates and references when %s changes, even for an empty catalog",
  async (change) => {
    await render();
    h.pick.mockResolvedValue({ canceled: false, assets: [{ uri: "file://old", name: "old.jpg" }] });
    h.upload.mockResolvedValue({ mediaAssetId: "old-ref", url: "https://example.test/old" });
    await click("ipGeneration.uploadButton");
    expect(host.textContent).toContain("uploaded-image");
    h.get.mockResolvedValueOnce({ templates: [] });
    if (change === "session") h.generation++;
    await render(change === "ip" ? "two" : "one");
    expect(host.textContent).toBe("");
    expect(h.get).toHaveBeenCalledTimes(2);
  }
);
it("does not upload a photo selected after the account changes", async () => {
  const picker = deferred<{ canceled: boolean; assets: { uri: string }[] }>();
  h.pick.mockReturnValue(picker.promise);
  await render();
  await click("ipGeneration.uploadButton");
  h.generation++;
  // The session store can change before React renders the new panel.
  await act(async () => picker.resolve({ canceled: false, assets: [{ uri: "file://private" }] }));
  expect(h.upload).not.toHaveBeenCalled();
});
it("ignores a previous IP's late catalog response", async () => {
  const catalog = deferred<{ templates: (typeof template)[] }>();
  h.get.mockReturnValueOnce(catalog.promise);
  await render();
  h.get.mockResolvedValueOnce({ templates: [] });
  await render("two");
  await act(async () => catalog.resolve({ templates: [template] }));
  expect(host.textContent).toBe("");
});

it("does not poll a job returned after switching IP", async () => {
  const run = deferred<{ jobId: string }>();
  h.get.mockResolvedValue({ templates: [{ ...template, requireReferenceImage: false }] });
  h.post.mockReturnValue(run.promise);
  await render();
  await click("ipGeneration.generateButton");
  expect(h.post).toHaveBeenCalledOnce();
  await render("two");
  await act(async () => run.resolve({ jobId: "old-job" }));
  expect(h.get.mock.calls.some(([url]) => String(url).includes("/jobs/"))).toBe(false);
});

it("does not show an old upload failure in the new session", async () => {
  let reject!: (error: Error) => void;
  h.pick.mockResolvedValue({ canceled: false, assets: [{ uri: "file://old" }] });
  h.upload.mockReturnValue(
    new Promise((_, fail) => {
      reject = fail;
    })
  );
  await render();
  await click("ipGeneration.uploadButton");
  expect(h.upload).toHaveBeenCalledOnce();
  h.generation++;
  await render();
  await act(async () => reject(new Error("old upload failed")));
  expect(h.alert).not.toHaveBeenCalled();
  expect(host.textContent).toContain("ipGeneration.uploadButton");
});

it("ignores the first submission after stopping and starting another job", async () => {
  const first = deferred<{ jobId: string }>();
  const second = deferred<{ jobId: string }>();
  h.get.mockResolvedValue({ templates: [{ ...template, requireReferenceImage: false }] });
  h.post.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
  await render();
  await click("ipGeneration.generateButton");
  await click("ipGeneration.cancel");
  await click("ipGeneration.generateButton");
  await act(async () => first.resolve({ jobId: "old-job" }));
  expect(h.get.mock.calls.some(([url]) => String(url).includes("/jobs/old-job"))).toBe(false);
});

it("ignores a stopped job's late failure while the next submission is pending", async () => {
  let reject!: (error: Error) => void;
  h.get.mockResolvedValue({ templates: [{ ...template, requireReferenceImage: false }] });
  h.post
    .mockReturnValueOnce(
      new Promise((_, fail) => {
        reject = fail;
      })
    )
    .mockReturnValueOnce(new Promise(() => {}));
  await render();
  await click("ipGeneration.generateButton");
  await click("ipGeneration.cancel");
  await click("ipGeneration.generateButton");
  await act(async () => reject(new Error("old failure")));
  expect(host.textContent).not.toContain("old failure");
  expect(host.textContent).toContain("ipGeneration.cancel");
});

it("ignores a stopped job's late poll result while the next job is pending", async () => {
  const status = deferred<{ status: string; outputs: unknown[]; progress: number }>();
  h.get
    .mockResolvedValueOnce({ templates: [{ ...template, requireReferenceImage: false }] })
    .mockReturnValueOnce(status.promise);
  h.post.mockResolvedValueOnce({ jobId: "old-job" }).mockReturnValueOnce(new Promise(() => {}));
  await render();
  await click("ipGeneration.generateButton");
  await click("ipGeneration.cancel");
  await click("ipGeneration.generateButton");
  expect((h.get.mock.calls[1][1].signal as AbortSignal).aborted).toBe(true);
  await act(async () => status.resolve({ status: "completed", outputs: [], progress: 100 }));
  expect(host.textContent).not.toContain("ipGeneration.completedLabel");
  expect(host.textContent).toContain("ipGeneration.cancel");
});

it("dispatches only one generation when tapped twice before React updates", async () => {
  h.get.mockResolvedValue({ templates: [{ ...template, requireReferenceImage: false }] });
  h.post.mockReturnValue(new Promise(() => {}));
  await render();
  await act(async () => {
    const button = [...host.querySelectorAll("button")].find(
      (item) => item.textContent === "ipGeneration.generateButton"
    )!;
    button.click();
    button.click();
  });
  expect(h.post).toHaveBeenCalledOnce();
});

it("continues polling the active job and permits another run after completion", async () => {
  vi.useFakeTimers();
  try {
    h.get
      .mockResolvedValueOnce({ templates: [{ ...template, requireReferenceImage: false }] })
      .mockResolvedValueOnce({ status: "in_progress", progress: 40, outputs: [] })
      .mockResolvedValueOnce({ status: "completed", progress: 100, outputs: [] });
    h.post
      .mockResolvedValueOnce({ jobId: "current-job" })
      .mockReturnValueOnce(new Promise(() => {}));
    await render();
    await click("ipGeneration.generateButton");
    expect(host.textContent).toContain("ipGeneration.cancel");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    expect(h.get).toHaveBeenCalledTimes(3);
    expect(host.textContent).toContain("ipGeneration.completedLabel");
    await click("ipGeneration.retry");
    await click("ipGeneration.generateButton");
    expect(h.post).toHaveBeenCalledTimes(2);
  } finally {
    vi.useRealTimers();
  }
});
