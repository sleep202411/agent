// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import type { Creator } from "../../../_hooks/use-creator";
import { CertificatesTab } from "./certificates-tab";
const state = vi.hoisted(() => ({
  data: [] as unknown[],
  isLoading: false,
  isError: true,
  error: new Error("Certificate registry unavailable") as Error | null,
  isFetching: false,
  refetch: vi.fn(),
}));
vi.mock("@/app/(site)/creators/_hooks/use-certificates", () => ({
  useCreatorCertificates: () => state,
}));
vi.mock("@/src/i18n/i18n", () => ({
  useLocale: () => "en-US",
  useTranslations: () => (key: string) => key,
}));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | undefined;
let container: HTMLDivElement;
const creator = { id: "18424", name: "Creator" } as Creator;
function render() {
  if (!root) {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  }
  act(() => root!.render(<CertificatesTab creator={creator} isOwner={false} />));
}
afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  container?.remove();
  Object.assign(state, {
    data: [],
    isError: true,
    error: new Error("Certificate registry unavailable"),
    isFetching: false,
  });
  vi.clearAllMocks();
});
it("distinguishes registry failure from an empty profile and allows retry", () => {
  render();
  expect(container.querySelector('[role="alert"]')?.textContent).toContain(
    "Certificate registry unavailable"
  );
  expect(container.textContent).not.toContain("certificates.emptyVisitorTitle");
  act(() => container.querySelector("button")!.click());
  expect(state.refetch).toHaveBeenCalledOnce();
  state.isFetching = true;
  render();
  expect(container.querySelector("button")!.disabled).toBe(true);
  state.isError = false;
  state.isFetching = false;
  state.error = null;
  render();
  expect(container.querySelector('[role="alert"]')).toBeNull();
  expect(container.textContent).toContain("certificates.emptyVisitorTitle");
});
it("does not present cached certificates as verified when a refresh fails", () => {
  state.data = [{ id: "old", title: "Old certificate" }];
  render();
  expect(container.textContent).not.toContain("certificates.verified");
  expect(container.textContent).not.toContain("Old certificate");
  expect(container.querySelector('[role="alert"]')).not.toBeNull();
});
