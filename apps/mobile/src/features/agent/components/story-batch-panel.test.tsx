import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { StoryBatchPanel } from "./story-batch-panel";
import type { StoryAssetSpec } from "../api/story-production-api";
const h = vi.hoisted(() => ({
  list: vi.fn(),
  quote: vi.fn(),
  act: vi.fn(),
  pending: vi.fn(),
  generation: 1,
  active: true,
  close: vi.fn(),
}));
vi.mock("../api/story-batch-management", () => ({ storyBatchManagement: () => h }));
vi.mock("@/auth/auth-store", () => ({ getAuthGeneration: () => h.generation }));
vi.mock("@/hooks/use-app-active", () => ({ useScreenActive: () => h.active }));
vi.mock("@/constants/theme", () => ({ MaxContentWidth: 430 }));
vi.mock("@/hooks/use-theme", () => ({ useTheme: () => ({}) }));
vi.mock("@/i18n", () => ({ useTranslations: () => (key: string) => key }));
vi.mock("expo-modules-core", () => ({ uuid: { v4: () => "request" } }));
vi.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0 }),
}));
type Box = { children?: ReactNode };
vi.mock("@/components/themed-text", () => ({
  ThemedText: ({ children }: Box) => <span>{children}</span>,
}));
vi.mock("react-native", () => ({
  View: ({ children }: Box) => <div>{children}</div>,
  ScrollView: ({ children }: Box) => <div>{children}</div>,
  Modal: ({ children }: Box) => <div>{children}</div>,
  ActivityIndicator: () => <span>loading</span>,
  Pressable: ({ children, disabled, onPress }: Box & { disabled?: boolean; onPress(): void }) => (
    <button disabled={disabled} onClick={onPress}>
      {children}
    </button>
  ),
}));
const scope = { projectId: "project", chapterId: "chapter", generation: 1 };
const assets = [{ id: "asset", name: "Character", version: 3 }] as StoryAssetSpec[];
const batch = {
  id: "batch",
  status: "blocked",
  version: 1,
  itemCount: 1,
  totalPoints: 20,
  items: [],
  canCancel: true,
  quoteExpiresAt: "2099-01-01T00:00:00Z",
  blockReason: { message: "Insufficient points" },
};
let root: Root, host: HTMLDivElement;
const mount = (canGenerate = true) =>
  act(async () =>
    root.render(
      <StoryBatchPanel
        scope={scope}
        userId="user"
        assets={assets}
        canGenerate={canGenerate}
        onClose={h.close}
      />
    )
  );
const button = (label: string) =>
  [...host.querySelectorAll("button")].find((button) => button.textContent === label);
beforeEach(() => {
  vi.resetAllMocks();
  h.generation = 1;
  h.active = true;
  h.list.mockResolvedValue([batch]);
  h.pending.mockReturnValue(null);
  h.act.mockResolvedValue({ ...batch, status: "queued" });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});
it("shows and recovers batches created outside the conversation with no automatic writes", async () => {
  await mount();
  expect(host.textContent).toContain("Insufficient points");
  expect(h.act).not.toHaveBeenCalled();
  await act(async () => {
    button("storyBatch.resume")!.click();
    button("storyBatch.resume")!.click();
  });
  expect(h.act).toHaveBeenCalledTimes(1);
  expect(h.act.mock.calls[0][0]).toBe("resume");
});
it("requires a separate confirmation after fetching a quote", async () => {
  h.list.mockResolvedValue([]);
  h.quote.mockResolvedValue({ ...batch, status: "awaiting_confirmation" });
  await mount();
  await act(async () => button("storyBatch.quote")!.click());
  expect(h.quote).toHaveBeenCalledTimes(1);
  expect(h.act).not.toHaveBeenCalled();
  await act(async () => button("storyBatch.confirm")!.click());
  expect(h.act.mock.calls[0][0]).toBe("confirm");
});
it("allows viewing but no generation commands without generate permission", async () => {
  await mount(false);
  expect(host.textContent).toContain("Insufficient points");
  expect(button("storyBatch.quote")).toBeUndefined();
  expect(button("storyBatch.resume")).toBeUndefined();
  expect(button("storyBatch.cancel")).toBeUndefined();
});
it("recovers the original pending quote and never substitutes newly selected assets", async () => {
  const pending = { clientKey: "old", targets: [{ id: "old-asset", expectedVersion: 1 }] };
  h.pending.mockReturnValue(pending);
  h.quote.mockResolvedValue({ ...batch, status: "awaiting_confirmation" });
  await mount();
  expect(button("storyBatch.quote")).toBeUndefined();
  const retry = [...host.querySelectorAll("button")]
    .filter((button) => button.textContent === "common.retry")
    .at(-1)!;
  await act(async () => retry.click());
  expect(h.quote.mock.calls[0][0]).toEqual(pending);
});
it("drops an in-flight result after an account switch", async () => {
  let finish: (value: unknown) => void = () => {};
  h.list.mockReturnValue(
    new Promise((resolve) => {
      finish = resolve;
    })
  );
  await mount();
  h.generation = 2;
  await act(async () => finish([batch]));
  await mount();
  expect(host.textContent).toBe("");
  expect(h.act).not.toHaveBeenCalled();
});
