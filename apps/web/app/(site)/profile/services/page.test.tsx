import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import ProfileServicesPage from "./page";

const state = vi.hoisted(() => ({
  user: { id: "owner-one" } as { id: string } | null,
  open: vi.fn(),
  replace: vi.fn(),
  lookup: vi.fn(),
  error: null as Error | null,
  fetching: false,
  refetch: vi.fn(),
}));
vi.mock("@/src/hooks/use-user", () => ({
  useCurrentUser: () => ({ user: state.user, isFetched: true }),
}));
vi.mock("@/components/auth/auth-dialog-provider", () => ({
  useAuthDialog: () => ({ open: state.open }),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: state.replace }) }));
vi.mock("@/src/i18n/i18n", () => ({
  useLocale: () => "zh-HK",
  useTranslations: () => (key: string) => key,
}));
vi.mock("@/app/(site)/creators/_hooks/use-creator", () => ({
  useCreatorDetail: (id: string) => {
    state.lookup(id);
    return {
      data: id ? { id } : undefined,
      error: state.error,
      isFetching: state.fetching,
      refetch: state.refetch,
    };
  },
}));
vi.mock("@/app/(site)/creators/_components/center/tabs/services-tab", () => ({
  ServicesTab: ({ creator, isOwner }: { creator: { id: string }; isOwner: boolean }) => (
    <div data-owner={isOwner}>{creator.id}</div>
  ),
}));

vi.mock("@/app/(site)/creators/_components/creator-location-editor", () => ({
  CreatorLocationEditor: () => <div>Location editor</div>,
}));

let root: Root, container: HTMLDivElement;
beforeEach(() => {
  vi.clearAllMocks();
  state.user = { id: "owner-one" };
  state.error = null;
  state.fetching = false;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});
const render = async () => {
  await act(async () => root.render(<ProfileServicesPage />));
};

it("uses only the authenticated user's identity and retains localized profile navigation", async () => {
  await render();
  expect(state.lookup).toHaveBeenLastCalledWith("owner-one");
  expect(container.querySelector('[data-owner="true"]')?.textContent).toBe("owner-one");
  expect(container.querySelector("a")?.getAttribute("href")).toBe("/zh-HK/profile");
});

it("removes owner content on logout and asks for authentication", async () => {
  await render();
  state.user = null;
  await render();
  expect(container.querySelector("[data-owner]")).toBeNull();
  expect(state.lookup).toHaveBeenLastCalledWith("");
  expect(state.open).toHaveBeenCalledWith(expect.objectContaining({ mode: "stay" }));
});

it("switches service management to the newly authenticated account", async () => {
  await render();
  state.user = { id: "owner-two" };
  await render();
  expect(container.textContent).not.toContain("owner-one");
  expect(container.querySelector('[data-owner="true"]')?.textContent).toBe("owner-two");
});

it("retries a failed creator read without exposing owner controls until recovery", async () => {
  state.error = new Error("Profile service unavailable");
  await render();
  expect(container.querySelector('[role="alert"]')?.textContent).toBe(
    "Profile service unavailable"
  );
  expect(container.querySelector("[data-owner]")).toBeNull();
  const retry = Array.from(container.querySelectorAll("button")).find(
    (button) => button.textContent === "retry"
  )!;
  await act(async () => retry.click());
  expect(state.refetch).toHaveBeenCalledOnce();
  state.fetching = true;
  await render();
  expect(retry.disabled).toBe(true);
  state.fetching = false;
  state.error = null;
  await render();
  expect(container.querySelector('[role="alert"]')).toBeNull();
  expect(container.querySelector('[data-owner="true"]')?.textContent).toBe("owner-one");
});
