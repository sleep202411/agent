import React, { act, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, it, expect, vi } from "vitest";
import { EnrollmentPanel } from "./enrollment-panel";
const h = vi.hoisted(() => ({
  start: vi.fn(),
  status: vi.fn(),
  complete: vi.fn(),
  active: true,
  generation: 1,
  frame: null as any,
  mounts: 0,
  detail: vi.fn(),
  close: vi.fn(),
}));
vi.mock("./enrollment-api", () => ({
  startEnrollment: h.start,
  loadEnrollmentStatus: h.status,
  completeEnrollment: h.complete,
  enrollmentErrorCode: (e: any) => e.code,
}));
vi.mock("./enrollment-frame", () => ({
  EnrollmentFrame: (props: any) => {
    h.frame = props;
    React.useEffect(() => {
      h.mounts++;
    }, []);
    return <div data-frame="true" />;
  },
}));
vi.mock("react-native", () => ({
  View: ({ children }: any) => <div>{children}</div>,
  ActivityIndicator: () => <div>loading</div>,
  Pressable: ({ children, onPress, disabled }: any) => (
    <button disabled={disabled} onClick={onPress}>
      {children}
    </button>
  ),
}));
vi.mock("@/components/themed-text", () => ({
  ThemedText: ({ children }: any) => <span>{children}</span>,
}));
vi.mock("@/hooks/use-theme", () => ({ useTheme: () => ({}) }));
vi.mock("@/hooks/use-app-active", () => ({ useScreenActive: () => h.active }));
vi.mock("@/auth/auth-store", () => ({ getAuthGeneration: () => h.generation }));
vi.mock("@/config/app-env", () => ({ appEnv: { appRegion: "global" } }));
vi.mock("@/i18n", () => ({ useTranslations: () => (s: string) => s }));
const scope = { workspaceId: "w", characterId: "c", generation: 1 };
const session = () => ({
  sessionId: "session",
  h5Link: "https://provider.example/secret",
  expiresAt: new Date(Date.now() + 60000).toISOString(),
});
let root: Root, host: HTMLDivElement;
beforeEach(() => {
  vi.useFakeTimers();
  vi.resetAllMocks();
  h.active = true;
  h.generation = 1;
  h.frame = null;
  h.mounts = 0;
  h.status.mockResolvedValue({ sessionStatus: "none", characterStatus: "draft" });
  h.start.mockResolvedValue(session());
  h.complete.mockResolvedValue({ id: "c", status: "active" });
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement("div");
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  vi.useRealTimers();
});
const mount = async () => {
  await act(async () =>
    root.render(
      <StrictMode>
        <EnrollmentPanel scope={scope} onDetail={h.detail} onClose={h.close} />
      </StrictMode>
    )
  );
  await act(async () => vi.advanceTimersByTimeAsync(0));
};
const button = (name: string) =>
  Array.from(host.querySelectorAll("button")).find((b) => b.textContent === name)!;
const click = (name: string) => act(async () => button(name).click());
it("never starts on mount, preserves the frame across permission/background transitions and polls only foreground", async () => {
  await mount();
  expect(h.start).not.toHaveBeenCalled();
  await click("enrollment.start");
  expect(h.start).toHaveBeenCalledTimes(1);
  const mounts = h.mounts;
  h.active = false;
  await mount();
  const reads = h.status.mock.calls.length;
  await act(async () => vi.advanceTimersByTimeAsync(10000));
  expect(h.status).toHaveBeenCalledTimes(reads);
  expect(h.mounts).toBe(mounts);
  h.active = true;
  await mount();
  expect(h.mounts).toBe(mounts);
  expect(h.start).toHaveBeenCalledTimes(1);
});
it("retains verification until authenticated completion and retries only the idempotent pull", async () => {
  await mount();
  await click("enrollment.start");
  h.complete.mockRejectedValueOnce(
    Object.assign(Error("Not completed"), { code: "ENROLLMENT_NOT_COMPLETED" })
  );
  await click("enrollment.complete");
  expect(h.detail).not.toHaveBeenCalled();
  expect(host.textContent).toContain("enrollment.waiting");
  expect(host.querySelector("[data-frame]")).not.toBeNull();
  await act(async () => vi.advanceTimersByTimeAsync(5000));
  expect(h.complete).toHaveBeenCalledTimes(2);
  expect(h.start).toHaveBeenCalledTimes(1);
  expect(h.detail).toHaveBeenCalledWith({ id: "c", status: "active" });
});
it("does not replay a lost start; restart requires explicit confirmation and the prior status remains checkable", async () => {
  await mount();
  h.start.mockRejectedValueOnce(Error("Lost session response"));
  await click("enrollment.start");
  expect(host.textContent).toContain("Lost session response");
  h.status.mockResolvedValue({ sessionStatus: "pending", characterStatus: "pending_verification" });
  await click("enrollment.check");
  expect(host.textContent).toContain("enrollment.lost");
  expect(h.start).toHaveBeenCalledTimes(1);
  await click("enrollment.restart");
  await act(async () => vi.advanceTimersByTimeAsync(5000));
  expect(host.textContent).toContain("enrollment.restartWarning");
  expect(h.start).toHaveBeenCalledTimes(1);
  await click("report.cancel");
  expect(h.start).toHaveBeenCalledTimes(1);
  await click("enrollment.restart");
  await click("casting.confirm");
  expect(h.start).toHaveBeenCalledTimes(2);
});
it("reconciles completed status through the server pull without a provider frame", async () => {
  h.status.mockResolvedValue({ sessionStatus: "completed", characterStatus: "active" });
  await mount();
  expect(h.start).not.toHaveBeenCalled();
  expect(h.complete).toHaveBeenCalledTimes(1);
  expect(h.detail).toHaveBeenCalled();
});
it("serializes duplicate callbacks, never accepts draft receipts as success and discards post-logout results", async () => {
  await mount();
  await click("enrollment.start");
  let resolve!: (v: any) => void;
  h.complete.mockImplementationOnce(
    () =>
      new Promise((r) => {
        resolve = r;
      })
  );
  await act(async () => {
    h.frame.onComplete();
    h.frame.onComplete();
  });
  expect(h.complete).toHaveBeenCalledTimes(1);
  await act(async () => resolve({ id: "c", status: "draft" }));
  expect(h.detail).not.toHaveBeenCalled();
  expect(host.textContent).toContain("enrollment.notVerified");
  h.complete.mockImplementationOnce(
    () =>
      new Promise((r) => {
        resolve = r;
      })
  );
  await click("enrollment.complete");
  h.generation = 2;
  await act(async () => resolve({ id: "c", status: "active" }));
  expect(h.detail).not.toHaveBeenCalled();
});
it("retains a callback during backgrounding and completes only after returning", async () => {
  await mount();
  await click("enrollment.start");
  h.active = false;
  await mount();
  await act(async () => h.frame.onComplete());
  expect(h.complete).not.toHaveBeenCalled();
  h.active = true;
  await mount();
  await act(async () => vi.advanceTimersByTimeAsync(5000));
  expect(h.complete).toHaveBeenCalledTimes(1);
  expect(h.detail).toHaveBeenCalledWith({ id: "c", status: "active" });
});
it("expires the frame without another start and surfaces frame failures without logging its URL", async () => {
  await mount();
  h.start.mockResolvedValueOnce({
    ...session(),
    expiresAt: new Date(Date.now() + 1000).toISOString(),
  });
  await click("enrollment.start");
  await act(async () => h.frame.onError());
  expect(host.textContent).toContain("enrollment.frameError");
  expect(host.textContent).not.toContain("secret");
  await act(async () => vi.advanceTimersByTimeAsync(1000));
  expect(host.querySelector("[data-frame]")).toBeNull();
  expect(host.textContent).toContain("enrollment.status.expired");
  expect(h.start).toHaveBeenCalledTimes(1);
});
