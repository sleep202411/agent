// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { AdminSessionBoundary } from "../admin-session-boundary";
import { MediaGovernancePanel } from "./media-governance-panel";
import type {
  AdminMediaInitialData,
  AdminMediaProcessingJob,
  AdminMediaView,
} from "@/lib/admin-media";
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

const jobs = ["one", "two"].map(
  (id) =>
    ({
      id,
      assetId: `asset-${id}`,
      jobType: `job-${id}`,
      status: "failed",
      attempt: 1,
      priority: 10,
    }) as AdminMediaProcessingJob
);
const initial: AdminMediaInitialData = {
  overview: null,
  assets: null,
  moderationActions: null,
  processingJobs: { items: jobs },
  error: null,
};
const view = (selected: AdminMediaView = "processing") => (
  <MediaGovernancePanel
    view={selected}
    siteLabel="Global"
    databaseLabel="Fixture"
    initialData={selected === "processing" ? initial : { ...initial, processingJobs: null }}
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

it("excludes same-tick retries across jobs and retains failures for retry", async () => {
  const pending = deferred<ReturnType<typeof response>>();
  fetchMock.mockReturnValueOnce(pending.promise).mockResolvedValue(response({ items: jobs }));
  await render(view());
  const retries = [...container.querySelectorAll("button")].filter(
    (button) => button.textContent?.trim() === "重试"
  );
  await act(async () => {
    retries[0].click();
    retries[1].click();
  });
  expect(fetchMock).toHaveBeenCalledTimes(1);
  await act(async () => pending.reject(new Error("Retry unavailable")));
  expect(container.textContent).toContain("job-one");
  expect(container.textContent).toContain("Retry unavailable");
  await act(async () => click("重试"));
  expect(fetchMock.mock.calls.filter((call) => call[1]?.method === "POST")).toHaveLength(2);
});
it("cancels an abandoned view's write without refreshing its replacement", async () => {
  const pending = deferred<ReturnType<typeof response>>();
  fetchMock.mockReturnValue(pending.promise);
  await render(view());
  await act(async () => click("重试"));
  const signal = fetchMock.mock.calls[0][1].signal as AbortSignal;
  await render(view("assets"));
  expect(signal.aborted).toBe(true);
  await act(async () => pending.resolve(response()));
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(container.textContent).not.toContain("job-one");
});
it("cancels all overview companion reads when one fails", async () => {
  const pending = deferred<ReturnType<typeof response>>();
  fetchMock
    .mockRejectedValueOnce(new Error("Overview unavailable"))
    .mockReturnValue(pending.promise);
  await render(view("overview"));
  await act(async () => click("刷新"));
  expect(fetchMock).toHaveBeenCalledTimes(4);
  expect(fetchMock.mock.calls.every((call) => (call[1].signal as AbortSignal).aborted)).toBe(true);
  expect(container.textContent).toContain("Overview unavailable");
  await act(async () => pending.resolve(response({ items: [] })));
});
it("retains failed list results and cancels a replacement-account read", async () => {
  const pending = deferred<ReturnType<typeof response>>();
  fetchMock
    .mockRejectedValueOnce(new Error("List unavailable"))
    .mockReturnValueOnce(pending.promise);
  await render(view());
  await act(async () => click("刷新"));
  expect(container.textContent).toContain("job-one");
  await act(async () => click("刷新"));
  const signal = fetchMock.mock.calls[1][1].signal as AbortSignal;
  await render(view(), "bob");
  expect(signal.aborted).toBe(true);
  await act(async () => pending.resolve(response({ items: [] })));
  expect(container.textContent).toContain("job-one");
});
