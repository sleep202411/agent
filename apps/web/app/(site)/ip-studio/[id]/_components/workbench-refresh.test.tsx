import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { IpStudioWorkbench } from "./ip-studio-workbench";
import { ApiRequestError } from "@/src/lib/api";
import type { IpCreatorIp } from "@/src/lib/ip-commerce/api";

const state = vi.hoisted(() => ({
  account: "owner" as string | null,
  login: vi.fn(),
  ip: null as IpCreatorIp | null,
  error: null as Error | null,
  fetching: false,
  retry: vi.fn(),
  save: vi.fn(),
}));
vi.mock("@/src/hooks/use-user", () => ({
  useCurrentUser: () => ({ user: state.account ? { id: state.account } : null, isLoading: false }),
}));
vi.mock("@/components/auth/auth-dialog-provider", () => ({
  useAuthDialog: () => ({ open: state.login }),
}));
vi.mock("@/src/lib/ip-commerce/hooks", () => ({
  useMyIpCommerceIp: () => ({
    data: state.ip ? { ip: state.ip } : undefined,
    error: state.error,
    isLoading: false,
    isFetching: state.fetching,
    refetch: state.retry,
  }),
  useSubmitIpCommerceIpForReview: () => ({ isPending: false }),
  useUpdateIpCommerceIpAssets: () => ({ isPending: false }),
  useUploadIpCommerceMedia: () => ({ isPending: false }),
  useUpdateIpCommerceIpProfile: () => ({ mutateAsync: state.save, isPending: false }),
  useIpCommerceTaxonomyTerms: () => ({ data: { items: [] }, isLoading: false }),
}));
vi.mock("@/src/i18n/i18n", () => ({
  useLocale: () => "en-US",
  useTranslations: () => (key: string) => key,
}));
vi.mock("@/src/env", () => ({ env: {} }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
let root: Root, host: HTMLDivElement;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  state.account = "owner";
  state.login.mockReset();
  state.ip = {
    id: "ip",
    version: 10,
    title: "Original",
    summary: "Summary",
    description: "",
    listingVisibility: "public",
    ageRating: "general",
    genreCodes: ["drama"],
    genres: ["Drama"],
    status: "published",
    viewerAccess: { owner: true },
    sourceLocale: "en-US",
    updatedAt: "2026-09-23T00:00:00Z",
  } as IpCreatorIp;
  state.error = null;
  state.fetching = false;
  state.retry.mockReset();
  state.save.mockReset().mockResolvedValue({ ip: state.ip });
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});
function render() {
  act(() => root.render(<IpStudioWorkbench ipId="ip" />));
}
const input = () =>
  document.querySelector<HTMLInputElement>('input[placeholder="fieldNamePlaceholder"]');
const button = (label: string) =>
  [...document.querySelectorAll("button")].find((b) => b.textContent === label)!;

it("preserves the open profile draft and original version through a failed refresh and recovery", async () => {
  render();
  act(() => button("editBasics").click());
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(
      input(),
      "Unsaved title"
    );
    input()!.dispatchEvent(new Event("input", { bubbles: true }));
  });
  const originalInput = input();
  state.error = new Error("Refresh offline");
  render();
  expect(input()).toBe(originalInput);
  expect(input()?.value).toBe("Unsaved title");
  expect(host.textContent).toContain("Refresh offline");
  await act(async () => button("retry").click());
  expect(state.retry).toHaveBeenCalledOnce();
  state.fetching = true;
  render();
  expect(button("retry").disabled).toBe(true);
  state.fetching = false;
  state.error = null;
  state.ip = { ...state.ip!, version: 11, title: "Remote title" };
  render();
  expect(input()?.value).toBe("Unsaved title");
  await act(async () => button("profileEdit.save").click());
  expect(state.save).toHaveBeenCalledWith(
    expect.objectContaining({
      expectedVersion: 10,
      title: "Unsaved title",
    })
  );
});

it("offers retry without an editor when the initial read fails", async () => {
  state.ip = null;
  state.error = new Error("Unavailable");
  render();
  expect(host.textContent).toContain("Unavailable");
  expect(input()).toBeNull();
  await act(async () => button("retry").click());
  expect(state.retry).toHaveBeenCalledOnce();
});

it.each([401, 403, 404])("removes the cached editor when access is denied (%s)", (status) => {
  render();
  act(() => button("editBasics").click());
  expect(input()).not.toBeNull();
  state.error = new ApiRequestError(`HTTP_${status}`, "IP access is unavailable", status);
  render();
  expect(host.textContent).toContain("IP access is unavailable");
  expect(input()).toBeNull();
  expect(button("editBasics")).toBeUndefined();
  expect(button("profileEdit.save")).toBeUndefined();
  state.fetching = true;
  render();
  expect(button("loading").disabled).toBe(true);
});

it("offers sign-in instead of retrying a disabled guest query", () => {
  state.account = null;
  state.ip = null;
  render();
  expect(host.textContent).toContain("signInRequired");
  expect(button("retry")).toBeUndefined();
  act(() => button("signIn").click());
  expect(state.login).toHaveBeenCalledOnce();
});

it("resets an open editor when the account changes", () => {
  render();
  act(() => button("editBasics").click());
  expect(input()).not.toBeNull();
  state.account = "another-editor";
  render();
  expect(input()).toBeNull();
});
