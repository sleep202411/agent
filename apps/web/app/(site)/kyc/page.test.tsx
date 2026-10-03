import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import KycPage from "./page";
const s = vi.hoisted(() => ({
  user: "a",
  response: null as string | null,
  query: vi.fn(),
  init: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
  replace: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: s.replace }),
  useSearchParams: () => ({ get: () => s.response }),
}));
vi.mock("next/script", () => ({ default: () => null }));
vi.mock("@/src/hooks/use-user", () => ({ useUserInfo: () => ({ data: { id: s.user } }) }));
vi.mock("@/src/hooks/use-kyc", () => ({
  useCertifyInit: () => ({ mutateAsync: s.init }),
  useCertifyQuery: () => ({ mutateAsync: s.query }),
}));
vi.mock("@/src/i18n/i18n", () => ({
  useLocale: () => "zh-CN",
  useTranslations: () => (key: string) => key,
}));
vi.mock("sonner", () => ({ toast: { success: s.success, error: s.error, warning: s.error } }));
let root: Root;
let node: HTMLDivElement;
async function render() {
  await act(async () => root.render(<KycPage />));
}
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  s.user = "a";
  s.response = JSON.stringify({ code: "1000", extInfo: { certifyId: "fixture-verification" } });
  for (const fn of [s.query, s.init, s.success, s.error, s.replace]) fn.mockReset();
  node = document.createElement("div");
  root = createRoot(node);
  vi.useFakeTimers();
});
afterEach(() => {
  act(() => root.unmount());
  vi.useRealTimers();
});
it("does not accept return-URL success when backend confirmation fails", async () => {
  s.query.mockRejectedValue(new Error("offline"));
  await render();
  expect(s.success).not.toHaveBeenCalled();
  expect(s.error).toHaveBeenCalledWith("certificationNotPassed");
  await act(async () => vi.advanceTimersByTime(1500));
  expect(s.replace).not.toHaveBeenCalled();
});
it("requires a confirmed successful backend status", async () => {
  s.query.mockResolvedValue({ status: "F" });
  await render();
  expect(s.error).toHaveBeenCalledWith("certificationNotPassed");
  expect(s.success).not.toHaveBeenCalled();
});
it("rejects success callbacks without a verification identifier", async () => {
  s.response = JSON.stringify({ code: "1000" });
  await render();
  expect(s.query).not.toHaveBeenCalled();
  expect(s.success).not.toHaveBeenCalled();
  expect(s.error).toHaveBeenCalledWith("certificationResultParseFailed");
});
it("suppresses delayed confirmation and navigation after account replacement", async () => {
  let resolve!: (v: { status: string }) => void;
  s.query.mockImplementation(
    () =>
      new Promise((r) => {
        resolve = r;
      })
  );
  await render();
  s.user = "b";
  s.response = null;
  await render();
  await act(async () => resolve({ status: "T" }));
  await act(async () => vi.advanceTimersByTime(1500));
  expect(s.success).not.toHaveBeenCalled();
  expect(s.replace).not.toHaveBeenCalled();
});
it("cancels a successful confirmation's scheduled redirect on departure", async () => {
  s.query.mockResolvedValue({ status: "T" });
  await render();
  expect(s.success).toHaveBeenCalledWith("certificationSuccess");
  s.user = "b";
  s.response = null;
  await render();
  await act(async () => vi.advanceTimersByTime(1500));
  expect(s.replace).not.toHaveBeenCalled();
});

it("ignores a previous callback after a different verification response is selected", async () => {
  let resolve!: (value: { status: string }) => void;
  s.query
    .mockImplementationOnce(
      () =>
        new Promise((r) => {
          resolve = r;
        })
    )
    .mockResolvedValue({ status: "F" });
  await render();
  s.response = JSON.stringify({ code: "1000", extInfo: { certifyId: "replacement" } });
  await render();
  await act(async () => resolve({ status: "T" }));
  expect(s.success).not.toHaveBeenCalled();
});

it("returns a confirmed verification to the same locale", async () => {
  s.query.mockResolvedValue({ status: "T" });
  await render();
  await act(async () => vi.advanceTimersByTime(1500));
  expect(s.replace).toHaveBeenCalledWith("/zh-CN/profile");
});
