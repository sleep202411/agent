// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { LoginForm } from "./login-form";
import { ADMIN_SITE_OPTIONS } from "@/lib/admin-sites";
const router = vi.hoisted(() => ({ refresh: vi.fn(), replace: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));
const qr = vi.hoisted(() => vi.fn());
vi.mock("qrcode", () => ({ default: { toDataURL: qr } }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | undefined;
let container: HTMLDivElement;
const fetchMock = vi.fn();
const mfa = {
  required: true,
  setupRequired: true,
  challengeToken: "fixture-challenge",
  expiresAt: "2027-01-01",
  secret: "fixture-secret",
  otpauthUri: "otpauth://fixture",
};
const response = (data: unknown = {}) => ({
  ok: true,
  json: () => Promise.resolve({ code: 200, data }),
});
function deferred() {
  let resolve!: (value: ReturnType<typeof response>) => void;
  let reject!: (value: Error) => void;
  const promise = new Promise<ReturnType<typeof response>>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
async function render(site = 0) {
  vi.stubGlobal("fetch", fetchMock);
  if (!qr.getMockImplementation()) qr.mockResolvedValue("data:image/png;base64,fixture");
  if (!root) {
    container = document.createElement("div");
    root = createRoot(container);
  }
  await act(async () => root!.render(<LoginForm site={ADMIN_SITE_OPTIONS[site]!} />));
}
function submit() {
  container
    .querySelector("form")!
    .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
}
afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
  vi.useRealTimers();
  vi.resetAllMocks();
  vi.unstubAllGlobals();
});
it("releases failed login and excludes rapid duplicate submissions", async () => {
  const pending = deferred();
  fetchMock.mockReturnValueOnce(pending.promise).mockResolvedValue(response());
  await render();
  container.querySelector<HTMLInputElement>("#email")!.value = "admin@fixture.invalid";
  await act(async () => {
    submit();
    submit();
  });
  expect(fetchMock).toHaveBeenCalledTimes(1);
  await act(async () => pending.reject(new Error("Network unavailable")));
  expect(container.textContent).toContain("Network unavailable");
  expect(container.querySelector<HTMLButtonElement>('button[type="submit"]')!.disabled).toBe(false);
  await act(async () => submit());
  expect(router.replace).toHaveBeenCalledTimes(1);
  await act(async () => submit());
  expect(fetchMock).toHaveBeenCalledTimes(2);
});
it("cancels a changed site's login and suppresses stale navigation", async () => {
  const pending = deferred();
  fetchMock.mockReturnValueOnce(pending.promise);
  await render();
  await act(async () => submit());
  const signal = fetchMock.mock.calls[0][1].signal as AbortSignal;
  await render(1);
  expect(signal.aborted).toBe(true);
  await act(async () => pending.resolve(response()));
  expect(router.replace).not.toHaveBeenCalled();
  expect(container.querySelector<HTMLButtonElement>('button[type="submit"]')!.disabled).toBe(false);
});
it("keeps failed MFA verification retryable with its original challenge", async () => {
  fetchMock
    .mockResolvedValueOnce(response({ mfa }))
    .mockRejectedValueOnce(new Error("MFA unavailable"))
    .mockResolvedValue(response());
  await render();
  await act(async () => submit());
  const code = container.querySelector<HTMLInputElement>("#mfa-code")!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(code, "123456");
    code.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => submit());
  expect(container.textContent).toContain("MFA unavailable");
  expect(code.value).toBe("123456");
  await act(async () => submit());
  expect(JSON.parse(fetchMock.mock.calls[2][1].body).challengeToken).toBe("fixture-challenge");
  expect(router.replace).toHaveBeenCalledTimes(1);
});
it("reports clipboard failures without abandoning MFA", async () => {
  const writeText = vi.fn().mockRejectedValue(new Error("Clipboard denied"));
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
  fetchMock.mockResolvedValue(response({ mfa }));
  await render();
  await act(async () => submit());
  await act(async () =>
    [...container.querySelectorAll("button")].find((b) => b.textContent?.trim() === "复制")!.click()
  );
  expect(container.textContent).toContain("Clipboard denied");
  expect(container.querySelector("#mfa-code")).not.toBeNull();
});

it("releases a stalled login with a visible retryable timeout", async () => {
  vi.useFakeTimers();
  fetchMock.mockReturnValue(new Promise(() => {}));
  await render();
  await act(async () => submit());
  await act(async () => vi.advanceTimersByTimeAsync(30_000));
  expect(container.textContent).toContain("Authentication timed out");
  expect(container.querySelector<HTMLButtonElement>('button[type="submit"]')!.disabled).toBe(false);
  expect(fetchMock).toHaveBeenCalledTimes(1);
});
