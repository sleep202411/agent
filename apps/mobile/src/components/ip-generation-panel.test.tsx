import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { IpGenerationPanel } from "./ip-generation-panel";
const h = vi.hoisted(() => ({
  generation: 1,
  active: true,
  records: new Map<string, string>(),
  get: vi.fn(),
  post: vi.fn(),
  pick: vi.fn(),
  upload: vi.fn(),
  alert: vi.fn(),
}));
vi.mock("@/hooks/use-app-active", () => ({ useScreenActive: () => h.active }));
vi.mock("@/lib/durable-record", () => ({
  durableRecord: (namespace: string, user: string, ip: string) => {
    const key = [namespace, user, ip].join(":");
    return {
      read: () => h.records.get(key) ?? null,
      write: (value: string) => h.records.set(key, value),
    };
  },
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
    retryPreview: vi.fn(),
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
  h.active = true;
  h.records.clear();
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

it("keeps uncertain submissions saved and never reposts when no receipt exists", async () => {
  h.get
    .mockResolvedValueOnce({ templates: [{ ...template, requireReferenceImage: false }] })
    .mockResolvedValue({ jobs: [] });
  h.post.mockRejectedValueOnce(new Error("Connection lost"));
  await render();
  await click("ipGeneration.generateButton");
  expect(host.textContent).toContain("Connection lost");
  expect(host.textContent).not.toContain("ipGeneration.generateButton");
  await click("ipGeneration.recoverJob");
  expect(host.textContent).toContain("ipGeneration.awaitingReceipt");
  expect(h.post).toHaveBeenCalledTimes(1);
  expect(h.records.size).toBe(1);
});
it("stops only local tracking and resumes the same accepted job", async () => {
  const status = deferred<{ status: string; outputs: unknown[]; progress: number }>();
  h.get
    .mockResolvedValueOnce({ templates: [{ ...template, requireReferenceImage: false }] })
    .mockReturnValueOnce(status.promise)
    .mockResolvedValueOnce({ status: "completed", outputs: [], progress: 100 });
  h.post.mockResolvedValueOnce({ jobId: "old-job" });
  await render();
  await click("ipGeneration.generateButton");
  await click("ipGeneration.stopTracking");
  expect((h.get.mock.calls[1][1].signal as AbortSignal).aborted).toBe(true);
  expect(host.textContent).not.toContain("ipGeneration.generateButton");
  await act(async () => status.resolve({ status: "completed", outputs: [], progress: 100 }));
  expect(host.textContent).not.toContain("ipGeneration.completedLabel");
  await click("ipGeneration.recoverJob");
  expect(host.textContent).toContain("ipGeneration.completedLabel");
  expect(h.post).toHaveBeenCalledTimes(1);
  expect(h.get.mock.calls[2][0]).toBe(h.get.mock.calls[1][0]);
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
    expect(host.textContent).toContain("ipGeneration.stopTracking");
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

it("keeps a failed template catalog visible with retry and then recovers", async () => {
  h.get.mockRejectedValueOnce(new Error("Templates temporarily unavailable"));
  await render();
  expect(host.textContent).toContain("Templates temporarily unavailable");
  await click("common.retry");
  expect(host.textContent).toContain("Old template");
  expect(host.textContent).not.toContain("Templates temporarily unavailable");
  expect(h.post).not.toHaveBeenCalled();
});
it("recovers a saved unknown submission after remount with no second POST", async () => {
  h.get
    .mockResolvedValueOnce({ templates: [{ ...template, requireReferenceImage: false }] })
    .mockResolvedValue({ jobs: [] });
  h.post.mockRejectedValueOnce(new Error("Network lost"));
  await render();
  await click("ipGeneration.generateButton");
  const key = h.post.mock.calls[0][1].data.idempotencyKey;
  await act(async () => root.render(null));
  h.get.mockImplementation(async (url: string) =>
    url === "/ai/jobs"
      ? { jobs: [{ id: "found", idempotencyKey: key, sourceSurface: "ip_audience_generation" }] }
      : url.includes("/jobs/")
        ? { status: "completed", outputs: [], progress: 100 }
        : { templates: [] }
  );
  await render();
  expect(host.textContent).toContain("ipGeneration.completedLabel");
  expect(h.post).toHaveBeenCalledTimes(1);
});
it("persists a late acknowledgement after unmount for the next visit", async () => {
  const run = deferred<{ jobId: string }>();
  h.get.mockResolvedValueOnce({ templates: [{ ...template, requireReferenceImage: false }] });
  h.post.mockReturnValueOnce(run.promise);
  await render();
  await click("ipGeneration.generateButton");
  await act(async () => root.render(null));
  await act(async () => run.resolve({ jobId: "late-job" }));
  expect([...h.records.values()][0]).toContain("late-job");
  h.get.mockImplementation(async (url: string) =>
    url.includes("/jobs/") ? { status: "completed", outputs: [], progress: 100 } : { templates: [] }
  );
  await render();
  expect(host.textContent).toContain("ipGeneration.completedLabel");
  expect(h.post).toHaveBeenCalledTimes(1);
});
it("preserves job identity when a polling read fails and retries only that read", async () => {
  h.get
    .mockResolvedValueOnce({ templates: [{ ...template, requireReferenceImage: false }] })
    .mockRejectedValueOnce(new Error("Status unavailable"))
    .mockResolvedValueOnce({ status: "completed", outputs: [], progress: 100 });
  h.post.mockResolvedValueOnce({ jobId: "saved" });
  await render();
  await click("ipGeneration.generateButton");
  expect(host.textContent).toContain("Status unavailable");
  await click("ipGeneration.recoverJob");
  expect(host.textContent).toContain("ipGeneration.completedLabel");
  expect(h.post).toHaveBeenCalledTimes(1);
});
it("aborts status reads on blur and rechecks the saved job on return without submission", async () => {
  const first = deferred<{ status: string; outputs: unknown[]; progress: number }>();
  h.get
    .mockResolvedValueOnce({ templates: [{ ...template, requireReferenceImage: false }] })
    .mockReturnValueOnce(first.promise)
    .mockResolvedValueOnce({ status: "completed", outputs: [], progress: 100 });
  h.post.mockResolvedValueOnce({ jobId: "saved" });
  await render();
  await click("ipGeneration.generateButton");
  h.active = false;
  await render();
  expect(h.get.mock.calls[1][1].signal.aborted).toBe(true);
  h.active = true;
  await render();
  expect(host.textContent).toContain("ipGeneration.completedLabel");
  expect(h.post).toHaveBeenCalledTimes(1);
  await act(async () => first.resolve({ status: "in_progress", outputs: [], progress: 5 }));
  expect(host.textContent).toContain("ipGeneration.completedLabel");
});
it("treats expired jobs as terminal instead of polling forever", async () => {
  h.get
    .mockResolvedValueOnce({ templates: [{ ...template, requireReferenceImage: false }] })
    .mockResolvedValueOnce({ status: "expired", outputs: [], progress: 0 });
  h.post.mockResolvedValueOnce({ jobId: "expired-job" });
  await render();
  await click("ipGeneration.generateButton");
  expect(host.textContent).toContain("ipGeneration.retry");
  expect(host.textContent).not.toContain("ipGeneration.stopTracking");
});
