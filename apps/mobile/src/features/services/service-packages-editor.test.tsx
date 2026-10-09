import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { ServicePackagesEditor } from "./service-packages-editor";
import type { CreatorServiceDetail } from "@/data/types";
const h = vi.hoisted(() => ({
  change: vi.fn(),
  refresh: vi.fn(),
  user: "owner",
  generation: 1,
  authenticated: true,
}));
vi.mock("./service-packages-api", async (original) => ({
  ...(await original<typeof import("./service-packages-api")>()),
  saveServicePackages: h.change,
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
vi.mock("@/hooks/use-theme", () => ({ useTheme: () => ({}) }));
vi.mock("@/hooks/use-app-active", () => ({ useScreenActive: () => true }));
vi.mock("@/i18n", () => ({ useTranslations: () => (key: string) => key }));
vi.mock("@/components/themed-text", () => ({
  ThemedText: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}));
vi.mock("react-native", () => ({
  Switch: ({
    value,
    onValueChange,
    disabled,
  }: {
    value: boolean;
    onValueChange: (value: boolean) => void;
    disabled: boolean;
  }) => (
    <input
      type="checkbox"
      checked={value}
      disabled={disabled}
      onChange={(e) => onValueChange(e.target.checked)}
    />
  ),
  TextInput: ({
    value,
    onChangeText,
    editable,
    accessibilityLabel,
  }: {
    value: string;
    onChangeText: (text: string) => void;
    editable: boolean;
    accessibilityLabel: string;
  }) => (
    <input
      aria-label={accessibilityLabel}
      value={value}
      disabled={!editable}
      onChange={(e) => onChangeText(e.target.value)}
    />
  ),
  ScrollView: ({ children }: { children: ReactNode }) => <div>{children}</div>,
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

vi.mock("@/config", () => ({ appEnv: { siteRegion: "global" } }));
const service = {
  id: "s",
  creatorId: "owner",
  status: "listed",
  version: 3,
  packages: [
    {
      id: "p",
      tier: "basic",
      title: "Film",
      description: "Edit",
      price: 12.5,
      currency: "USD",
      deliveryDays: 3,
      revisions: -1,
      scope: ["One cut"],
    },
  ],
} as CreatorServiceDetail;
const render = (status = "listed") =>
  act(async () =>
    root.render(<ServicePackagesEditor service={{ ...service, status }} refresh={h.refresh} />)
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
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});
it("saves supported package terms once and ignores stale-account completion", async () => {
  let finish!: () => void;
  h.change.mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      })
  );
  await render();
  await act(async () => click("servicePackages.title"));
  await act(async () => {
    click("profileEdit.save");
    click("profileEdit.save");
  });
  expect(h.change).toHaveBeenCalledExactlyOnceWith("s", "listed", {
    expectedVersion: 3,
    packages: [
      {
        tier: "basic",
        title: "Film",
        description: "Edit",
        price: 12.5,
        currency: "USD",
        deliveryDays: 3,
        revisions: -1,
        scope: ["One cut"],
      },
    ],
  });
  h.generation++;
  await render();
  await act(async () => finish());
  expect(h.refresh).not.toHaveBeenCalled();
});
it("blocks blank prices and removing the last listed package", async () => {
  await render();
  await act(async () => click("servicePackages.title"));
  const price = host.querySelector<HTMLInputElement>(
    'input[aria-label="servicePackages.tier.basic servicePackages.price"]'
  )!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(price, "");
    price.dispatchEvent(new Event("input", { bubbles: true }));
  });
  expect(
    Array.from(host.querySelectorAll("button")).find((b) => b.textContent === "profileEdit.save")
      ?.disabled
  ).toBe(true);
  await act(async () => host.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click());
  expect(host.textContent).toContain("servicePackages.pauseFirst");
  expect(h.change).not.toHaveBeenCalled();
});
it("gates nonowners and shows conflicts without refreshing away edits", async () => {
  h.user = "visitor";
  await render();
  expect(host.textContent).toBe("");
  h.user = "owner";
  await render("archived");
  expect(host.textContent).toBe("");
  await render();
  await act(async () => click("servicePackages.title"));
  h.change.mockRejectedValue(new Error("Version conflict"));
  await act(async () => click("profileEdit.save"));
  expect(host.textContent).toContain("Version conflict");
  expect(h.refresh).not.toHaveBeenCalled();
});
