import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { AssetTaskProgress } from "./asset-task-progress";
import { assetGroups } from "./asset-task-progress-api";
const h = vi.hoisted(() => ({ generation: 1, active: true, fetch: vi.fn(), close: vi.fn() }));
vi.mock("./asset-task-progress-api", async (original) => ({
  ...(await original<typeof import("./asset-task-progress-api")>()),
  fetchAssetTaskProgress: h.fetch,
}));
vi.mock("@/lib/api-client", () => ({ api: { get: vi.fn() } }));
vi.mock("@/auth/auth-store", () => ({ getAuthGeneration: () => h.generation }));
vi.mock("@/hooks/use-app-active", () => ({ useScreenActive: () => h.active }));
vi.mock("@/i18n", () => ({ useTranslations: () => (key: string) => key }));
vi.mock("@/components/themed-text", () => ({
  ThemedText: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}));
vi.mock("react-native", () => ({
  View: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  ScrollView: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  ActivityIndicator: () => <span>loading</span>,
  Pressable: ({ children, onPress }: { children: ReactNode; onPress: () => void }) => (
    <button onClick={onPress}>{children}</button>
  ),
}));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let host: HTMLDivElement, root: Root;
const result = () =>
  Object.fromEntries(assetGroups.map((key) => [key, { approved: 12, total: 24 }]));
const render = (crewId = "crew", generation = 1) =>
  act(async () =>
    root.render(<AssetTaskProgress crewId={crewId} generation={generation} onClose={h.close} />)
  );
beforeEach(() => {
  vi.clearAllMocks();
  h.generation = 1;
  h.active = true;
  host = document.createElement("div");
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
});
it("renders real approved/total counts and clears them while refreshing", async () => {
  h.fetch.mockResolvedValueOnce(result());
  await render();
  expect(host.textContent).toContain("12/24");
  h.fetch.mockImplementationOnce(() => new Promise(() => {}));
  await act(async () =>
    [...host.querySelectorAll("button")].find((b) => b.textContent === "thread.refresh")!.click()
  );
  expect(host.textContent).not.toContain("12/24");
  expect(host.textContent).toContain("loading");
});
it("displays permission failures without zero or stale progress", async () => {
  h.fetch.mockRejectedValueOnce(new Error("Not a Crew member"));
  await render();
  expect(host.textContent).toContain("Not a Crew member");
  expect(host.textContent).not.toContain("0/0");
});
it("ignores a late result after switching crews and aborts the old request", async () => {
  let finish!: (value: unknown) => void;
  h.fetch
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        })
    )
    .mockResolvedValueOnce(result());
  await render();
  const signal = h.fetch.mock.calls[0][2] as AbortSignal;
  await render("another");
  expect(signal.aborted).toBe(true);
  await act(async () =>
    finish(Object.fromEntries(assetGroups.map((key) => [key, { approved: 99, total: 99 }])))
  );
  expect(host.textContent).not.toContain("99/99");
  expect(host.textContent).toContain("12/24");
});
it("makes no request for an inactive screen or stale session", async () => {
  h.active = false;
  await render();
  expect(h.fetch).not.toHaveBeenCalled();
  h.active = true;
  h.generation = 2;
  await render();
  expect(h.fetch).not.toHaveBeenCalled();
  expect(host.textContent).toBe("");
});
