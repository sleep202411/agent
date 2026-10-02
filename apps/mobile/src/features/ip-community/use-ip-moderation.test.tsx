import { act, useLayoutEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { useIpModeration } from "./use-ip-moderation";
const h = vi.hoisted(() => ({
  generation: 1,
  authenticated: true,
  menu: vi.fn(),
  alert: vi.fn(),
  login: vi.fn(),
  openLogin: vi.fn(),
  block: vi.fn(),
  report: vi.fn(),
  invalidate: vi.fn(),
  back: vi.fn(),
}));
vi.mock("@\/auth", () => ({
  useAuth: () => ({
    generation: h.generation,
    status: h.authenticated ? "authenticated" : "anonymous",
  }),
  useAuthGate: () => ({ requireAuth: h.login, openLogin: h.openLogin }),
}));
vi.mock("@/auth/auth-store", () => ({ getAuthGeneration: () => h.generation }));
vi.mock("@/components/report-actions", () => ({ showContentActionsMenu: h.menu }));
vi.mock("@/data/browse-service", () => ({ blockIpContent: h.block, reportIpContent: h.report }));
vi.mock("@/data/browse-refresh", () => ({ invalidateBrowse: h.invalidate }));
vi.mock("@/i18n", () => ({ useTranslations: () => (k: string) => k }));
vi.mock("react-native", () => ({ Alert: { alert: h.alert } }));
vi.mock("@/lib/api-client", () => ({
  ApiRequestError: class extends Error {
    status = 401;
  },
}));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: Root, current: ReturnType<typeof useIpModeration>;
function Screen({ active = true }: { active?: boolean }) {
  const value = useIpModeration("ip", active, h.back);
  useLayoutEffect(() => {
    current = value;
  });
  return null;
}
const render = (active = true, key = "viewer") =>
  act(async () => root.render(<Screen active={active} key={key} />));
const openReport = async () => {
  await act(async () => current.openActions());
  await act(async () => h.menu.mock.lastCall![0].onReport());
};
const blockConfirm = async () => {
  await act(async () => current.openActions());
  await act(async () => h.menu.mock.lastCall![0].onBlock());
  return h.alert.mock.lastCall![2][1].onPress as () => void;
};
beforeEach(() => {
  vi.resetAllMocks();
  h.generation = 1;
  h.authenticated = true;
  root = createRoot(document.createElement("div"));
  h.block.mockResolvedValue(undefined);
  h.report.mockResolvedValue(undefined);
});
afterEach(async () => {
  await act(async () => root.unmount());
});
it("guests log in without retaining old menu callbacks", async () => {
  h.authenticated = false;
  await render();
  await act(async () => current.openActions());
  expect(h.login).toHaveBeenCalledExactlyOnceWith();
  expect(h.menu).not.toHaveBeenCalled();
});
it("ignores stale menus and block confirmations after blur or account change", async () => {
  await render();
  const confirm = await blockConfirm();
  await render(false);
  await render();
  await act(async () => confirm());
  expect(h.block).not.toHaveBeenCalled();
  const fresh = await blockConfirm();
  h.generation++;
  await render(true, "other");
  await act(async () => fresh());
  expect(h.block).not.toHaveBeenCalled();
});
it("serializes reports across a return visit and retains an accepted reply", async () => {
  let finish!: () => void;
  h.report.mockImplementationOnce(
    () =>
      new Promise<void>((r) => {
        finish = r;
      })
  );
  await render();
  await openReport();
  await act(async () => {
    current.submitReport("privacy");
    current.submitReport("privacy");
  });
  expect(h.report).toHaveBeenCalledExactlyOnceWith("ip", "privacy");
  await render(false);
  await render();
  await act(async () => current.submitReport("privacy"));
  expect(h.report).toHaveBeenCalledTimes(1);
  await act(async () => finish());
  expect(current.reportOpen).toBe(false);
  expect(current.busy).toBe(false);
  expect(h.alert).not.toHaveBeenCalled();
});
it("keeps report open with backend error and supports deliberate retry", async () => {
  h.report.mockRejectedValueOnce(new Error("Report temporarily unavailable"));
  await render();
  await openReport();
  await act(async () => current.submitReport("fraud"));
  expect(current.reportOpen).toBe(true);
  expect(h.alert).toHaveBeenCalledWith("report.failed", "Report temporarily unavailable");
  await act(async () => current.submitReport("fraud"));
  expect(current.reportOpen).toBe(false);
  expect(h.report).toHaveBeenCalledTimes(2);
});
it("serializes blocks and prevents a late success dismissal from navigating another screen", async () => {
  let finish!: () => void;
  h.block.mockImplementationOnce(
    () =>
      new Promise<void>((r) => {
        finish = r;
      })
  );
  await render();
  const confirm = await blockConfirm();
  await act(async () => {
    confirm();
    confirm();
  });
  expect(h.block).toHaveBeenCalledOnce();
  await act(async () => finish());
  expect(h.invalidate).toHaveBeenCalledOnce();
  const close = h.alert.mock.lastCall![2][0].onPress;
  await render(false);
  await render();
  await act(async () => close());
  expect(h.back).not.toHaveBeenCalled();
});
it("blocks report dismissal while submitting and rejects old-account report completions", async () => {
  let finish!: () => void;
  h.report.mockImplementationOnce(
    () =>
      new Promise<void>((r) => {
        finish = r;
      })
  );
  await render();
  await openReport();
  await act(async () => current.submitReport("other"));
  await act(async () => current.closeReport());
  expect(current.reportOpen).toBe(true);
  h.generation++;
  await render(true, "other");
  await act(async () => finish());
  expect(h.alert).not.toHaveBeenCalled();
  expect(current.reportOpen).toBe(false);
});
