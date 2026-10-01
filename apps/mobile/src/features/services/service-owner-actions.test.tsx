import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { ServiceOwnerActions } from "./service-owner-actions";
const h = vi.hoisted(() => ({
  change: vi.fn(),
  refresh: vi.fn(),
  user: "owner",
  generation: 1,
  authenticated: true,
}));
vi.mock("./owner-service-api", async (original) => ({
  ...(await original<typeof import("./owner-service-api")>()),
  changeServiceStatus: h.change,
}));
vi.mock("@/lib/api-client", () => ({ api: {} }));
vi.mock("@/auth", () => ({
  useAuth: () => ({
    status: h.authenticated ? "authenticated" : "anonymous",
    generation: h.generation,
    user: { id: h.user },
  }),
}));
vi.mock("@/auth/auth-store", () => ({ getAuthGeneration: () => h.generation }));
vi.mock("@/hooks/use-app-active", () => ({ useScreenActive: () => true }));
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
    <button onClick={onPress} disabled={disabled}>
      {children}
    </button>
  ),
}));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: Root, host: HTMLDivElement;
const render = (status = "listed") =>
  act(async () =>
    root.render(
      <ServiceOwnerActions id="s" creatorId="owner" status={status} refresh={h.refresh} />
    )
  );
const click = (key: string) =>
  Array.from(host.querySelectorAll("button"))
    .find((b) => b.textContent === key)!
    .click();
beforeEach(() => {
  vi.resetAllMocks();
  h.user = "owner";
  h.generation = 1;
  h.authenticated = true;
  host = document.createElement("div");
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
});
it("requires ownership, confirmation and serializes taps", async () => {
  h.user = "visitor";
  await render();
  expect(host.textContent).toBe("");
  h.user = "owner";
  await render();
  let finish!: () => void;
  h.change.mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      })
  );
  await act(async () => click("myServices.action.pause"));
  expect(h.change).not.toHaveBeenCalled();
  await act(async () => {
    click("myServices.confirm");
    click("myServices.confirm");
  });
  expect(h.change).toHaveBeenCalledExactlyOnceWith("s", "pause");
  await act(async () => finish());
  expect(h.refresh).toHaveBeenCalledOnce();
});
it("ignores old-account completions and explains irreversible archive", async () => {
  let finish!: () => void;
  h.change.mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      })
  );
  await render();
  await act(async () => click("myServices.action.archive"));
  expect(host.textContent).toContain("myServices.archiveHint");
  await act(async () => click("myServices.confirm"));
  h.generation++;
  await render();
  await act(async () => finish());
  expect(h.refresh).not.toHaveBeenCalled();
  await render("archived");
  expect(host.textContent).toBe("");
});
it("shows server failures without claiming success", async () => {
  h.change.mockRejectedValue(new Error("A package is required"));
  await render("draft");
  await act(async () => click("myServices.action.publish"));
  await act(async () => click("myServices.confirm"));
  expect(host.textContent).toContain("A package is required");
  expect(h.refresh).not.toHaveBeenCalled();
});
