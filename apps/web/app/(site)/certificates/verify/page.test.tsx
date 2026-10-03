import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import Page from "./page";
import {
  CertificateVerifyApiError,
  verifyCertificate,
  type CertificateVerificationResult,
} from "./_data/api";
vi.mock("./_data/api", async (original) => ({
  ...(await original<typeof import("./_data/api")>()),
  verifyCertificate: vi.fn(),
}));
vi.mock("@/src/i18n/i18n", () => ({
  useLocale: () => "en-US",
  useTranslations: () => (key: string) => key,
}));
let root: Root, container: HTMLDivElement;
const result: CertificateVerificationResult = {
  certNo: "FD-A",
  valid: true,
  status: "valid",
  certificate: null,
};
beforeEach(async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.mocked(verifyCertificate).mockReset();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root.render(<Page />));
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});
async function enter(value: string) {
  await act(async () => {
    const input = container.querySelector("input")!;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
async function submit() {
  await act(async () => {
    container
      .querySelector("form")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
}
it("clears a previous verdict when editing the certificate number", async () => {
  vi.mocked(verifyCertificate).mockResolvedValue(result);
  await enter("fd-a");
  await submit();
  expect(container.textContent).toContain("validTitle");
  await enter("FD-B");
  expect(container.textContent).not.toContain("validTitle");
});
it("clears the verdict during re-verification and binds pending input to that request", async () => {
  vi.mocked(verifyCertificate).mockResolvedValueOnce(result);
  await enter("FD-A");
  await submit();
  let resolve!: (value: CertificateVerificationResult) => void;
  vi.mocked(verifyCertificate).mockImplementationOnce(
    () =>
      new Promise((r) => {
        resolve = r;
      })
  );
  await submit();
  expect(container.textContent).not.toContain("validTitle");
  expect(container.querySelector("input")!.disabled).toBe(true);
  await act(async () => resolve({ ...result, valid: false, status: "revoked" }));
  expect(container.textContent).toContain("revokedTitle");
  expect(container.querySelector("input")!.disabled).toBe(false);
});
it("clears errors on editing and permits a normalized retry", async () => {
  vi.mocked(verifyCertificate).mockRejectedValueOnce(new CertificateVerifyApiError(429, null));
  await enter("FD-A");
  await submit();
  expect(container.textContent).toContain("rateLimitedError");
  await enter(" fd - b ");
  expect(container.textContent).not.toContain("rateLimitedError");
  vi.mocked(verifyCertificate).mockResolvedValueOnce({
    ...result,
    certNo: "FD-B",
    status: "not_found",
    valid: false,
  });
  await submit();
  expect(verifyCertificate).toHaveBeenLastCalledWith("FD-B");
  expect(container.textContent).toContain("notFoundTitle");
});
it("rejects empty numbers without sending a request", async () => {
  await enter("  ");
  await submit();
  expect(verifyCertificate).not.toHaveBeenCalled();
  expect(container.textContent).toContain("emptyError");
});

it("shows the upstream reason instead of replacing it with a generic error", async () => {
  vi.mocked(verifyCertificate).mockRejectedValueOnce(
    new CertificateVerifyApiError(429, { message: "Try again in 30 seconds" })
  );
  await enter("FD-A");
  await submit();
  expect(container.textContent).toContain("Try again in 30 seconds");
});
