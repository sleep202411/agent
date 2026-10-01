import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { ContentReviewExport } from "./content-review-export";
const h = vi.hoisted(() => ({ generation: 1, export: vi.fn(), share: vi.fn(), lost: vi.fn() }));
vi.mock("@/auth/auth-store", () => ({ getAuthGeneration: () => h.generation }));
vi.mock("./api/content-review-api", () => ({ exportContentReview: h.export }));
vi.mock("./share-review-report", () => ({ shareReviewReport: h.share }));
vi.mock("@/i18n", () => ({ useTranslations: () => (key: string) => key }));
vi.mock("@/components/themed-text", () => ({
  ThemedText: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}));
vi.mock("react-native", () => ({
  View: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  Pressable: ({
    children,
    onPress,
    disabled,
  }: {
    children: ReactNode;
    onPress: () => void;
    disabled: boolean;
  }) => (
    <button disabled={disabled} onClick={onPress}>
      {children}
    </button>
  ),
}));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: Root, host: HTMLDivElement;
beforeEach(async () => {
  vi.resetAllMocks();
  h.generation = 1;
  host = document.createElement("div");
  root = createRoot(host);
  await act(async () =>
    root.render(
      <ContentReviewExport
        workspaceId="workspace"
        generation={1}
        recordId="record"
        onAccessLost={h.lost}
      />
    )
  );
});
afterEach(async () => {
  await act(async () => root.unmount());
});
const click = () => act(async () => host.querySelector("button")!.click());
it("blocks duplicate exports while preparing or sharing", async () => {
  let finish!: (value: unknown) => void;
  h.export.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      })
  );
  await click();
  await click();
  expect(h.export).toHaveBeenCalledOnce();
  const report = { bytes: new Uint8Array([80, 75, 3, 4]), filename: "report.xlsx" };
  await act(async () => finish(report));
  expect(h.share).toHaveBeenCalledWith(report.bytes, report.filename, expect.any(Function));
  expect(host.querySelector("button")!.disabled).toBe(false);
});
it.each([401, 403])("clears the parent report on %s", async (status) => {
  h.export.mockRejectedValue(Object.assign(new Error("Access revoked"), { status }));
  await click();
  expect(h.lost).toHaveBeenCalledWith("Access revoked");
  expect(h.share).not.toHaveBeenCalled();
});
it("does not share a response after the account changes", async () => {
  let finish!: (value: unknown) => void;
  h.export.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      })
  );
  await click();
  h.generation = 2;
  await act(async () => finish({ bytes: new Uint8Array(), filename: "report.xlsx" }));
  expect(h.share).not.toHaveBeenCalled();
});
