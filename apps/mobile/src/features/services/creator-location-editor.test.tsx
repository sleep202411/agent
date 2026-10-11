import { act, StrictMode, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { CreatorLocationEditor } from "./creator-location-editor";
import { ApiRequestError } from "@/lib/api-client";
vi.mock("./creator-device-city", () => ({ CreatorDeviceCity: () => null }));
const h = vi.hoisted(() => ({
  get: vi.fn(),
  put: vi.fn(),
  post: vi.fn(),
  generation: 1,
  active: true,
  records: new Map<string, string>(),
}));
vi.mock("@/lib/api-client", () => ({
  api: { get: h.get, put: h.put, post: h.post },
  ApiRequestError: class extends Error {
    constructor(
      public code: string,
      message: string,
      public status: number
    ) {
      super(message);
    }
  },
}));
vi.mock("@/auth/auth-store", () => ({ getAuthGeneration: () => h.generation }));
vi.mock("@/hooks/use-app-active", () => ({ useScreenActive: () => h.active }));
vi.mock("@/hooks/use-theme", () => ({ useTheme: () => ({}) }));
vi.mock("@/i18n", () => ({ useTranslations: () => (s: string) => s, useLocale: () => "en-US" }));
vi.mock("expo-modules-core", () => ({
  uuid: { v4: () => "11111111-1111-4111-8111-111111111111" },
}));
vi.mock("@/lib/durable-record", () => ({
  durableRecord: (ns: string, u: string, id: string) => ({
    read: () => h.records.get(ns + u + id) ?? null,
    write: (s: string) => h.records.set(ns + u + id, s),
  }),
}));
vi.mock("@/components/themed-text", () => ({
  ThemedText: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}));
vi.mock("react-native", () => ({
  View: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  ScrollView: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  ActivityIndicator: () => <span>loading</span>,
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
  Switch: ({
    value,
    onValueChange,
    disabled,
    accessibilityLabel,
  }: {
    value: boolean;
    onValueChange: (v: boolean) => void;
    disabled: boolean;
    accessibilityLabel: string;
  }) => (
    <input
      type="checkbox"
      aria-label={accessibilityLabel}
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
    onChangeText: (s: string) => void;
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
}));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const profile = {
  basedIn: { countryCode: "SG", city: "Singapore" },
  serves: [],
  remote: false,
  showOnMap: true,
};
const revision = { version: 2, profile, requestId: "22222222-2222-4222-8222-222222222222" };
let host: HTMLDivElement, root: Root;
const button = (key: string) =>
  Array.from(host.querySelectorAll("button")).find((b) => b.textContent === key)!;
const click = async (key: string) => act(async () => button(key).click());
const render = () =>
  act(async () =>
    root.render(
      <StrictMode>
        <CreatorLocationEditor scope={{ userId: "owner", generation: 1 }} />
      </StrictMode>
    )
  );
const settle = () =>
  act(async () => {
    await new Promise((r) => setTimeout(r, 15));
  });
const open = async () => {
  await render();
  await click("creatorLocation.title");
  await settle();
};
const toggle = async () =>
  act(async () =>
    host.querySelector<HTMLInputElement>('input[aria-label="creatorLocation.remote"]')!.click()
  );
beforeEach(() => {
  vi.resetAllMocks();
  h.records.clear();
  h.generation = 1;
  h.active = true;
  h.get.mockResolvedValue(revision);
  h.put.mockImplementation(async (_p, { data }) => ({
    version: data.expectedVersion + 1,
    profile: data.profile,
    requestId: data.requestId,
  }));
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});
it("is collapsed initially, reads only on open and never calls a geocoder automatically", async () => {
  await render();
  expect(h.get).not.toHaveBeenCalled();
  await click("creatorLocation.title");
  await settle();
  expect(h.get).toHaveBeenCalledTimes(1);
  expect(button("creatorLocation.save").disabled).toBe(true);
  expect(
    host.querySelector('input[aria-label="creatorLocation.basedIn: creatorLocation.city"]')
  ).not.toBeNull();
  expect(h.post).not.toHaveBeenCalled();
  await toggle();
  expect(button("creatorLocation.save").disabled).toBe(false);
  expect(button("creatorGeocoding.check")).toBeUndefined();
  expect(button("creatorLocation.close").disabled).toBe(true);
});
it("locks an uncertain save, recovers it after remount and retries the same exact request", async () => {
  await open();
  await toggle();
  h.put.mockRejectedValueOnce(new Error("Reply lost"));
  await click("creatorLocation.save");
  expect(host.textContent).toContain("Reply lost");
  expect(button("creatorLocation.retrySave").disabled).toBe(false);
  expect(
    host.querySelector<HTMLInputElement>('input[aria-label="creatorLocation.remote"]')!.disabled
  ).toBe(true);
  const first = h.put.mock.calls[0][1].data;
  await click("creatorLocation.close");
  await click("creatorLocation.title");
  await settle();
  expect(h.put).toHaveBeenCalledTimes(1);
  h.get.mockResolvedValue({
    ...revision,
    version: 3,
    profile: first.profile,
    requestId: first.requestId,
  });
  await click("creatorLocation.retrySave");
  expect(h.put.mock.calls[1][1].data).toEqual(first);
  expect(host.textContent).toContain("creatorLocation.saved");
});
it("requires explicit discard and does not resend an acknowledged save if latest-read fails", async () => {
  await open();
  await toggle();
  await click("creatorLocation.discard");
  expect(host.textContent).toContain("creatorLocation.confirmDiscard");
  await click("myServices.cancel");
  expect(host.textContent).not.toContain("creatorLocation.confirmDiscard");
  h.get.mockRejectedValueOnce(new Error("Refresh failed"));
  await click("creatorLocation.save");
  expect(host.textContent).toContain("Refresh failed");
  expect(button("creatorLocation.retrySave")).toBeUndefined();
  expect(button("creatorLocation.save").disabled).toBe(true);
  expect(h.put).toHaveBeenCalledTimes(1);
});
it("removes map consent with base city and prevents editing without fresh read after permission denial", async () => {
  await open();
  await click("creatorLocation.removeBase");
  expect(
    host.querySelector<HTMLInputElement>('input[aria-label="creatorLocation.showOnMap"]')!.checked
  ).toBe(false);
  h.put.mockRejectedValueOnce(new ApiRequestError("DENIED", "Owner access denied", 403));
  await click("creatorLocation.save");
  expect(host.textContent).toContain("Owner access denied");
  expect(host.querySelectorAll("input")).toHaveLength(0);
  expect(button("creatorGeocoding.check")).toBeUndefined();
});
it("exposes resolve only for a checked matching missing/expired version, then keeps uncertain state read-only", async () => {
  await open();
  expect(button("creatorGeocoding.resolve")).toBeUndefined();
  h.get.mockResolvedValueOnce({ version: 2, state: "missing", attemptId: null, point: null });
  await click("creatorGeocoding.check");
  expect(button("creatorGeocoding.resolve")).toBeDefined();
  h.get
    .mockResolvedValueOnce(revision)
    .mockResolvedValueOnce({ version: 2, state: "uncertain", attemptId: null, point: null });
  await click("creatorGeocoding.resolve");
  expect(h.post).not.toHaveBeenCalled();
  expect(button("creatorGeocoding.resolve")).toBeUndefined();
  expect(button("creatorGeocoding.check")).toBeDefined();
});
it("does not dispatch while backgrounded or install results from another account", async () => {
  await open();
  h.active = false;
  await render();
  expect(button("creatorGeocoding.check").disabled).toBe(true);
  h.active = true;
  await render();
  await toggle();
  h.put.mockImplementationOnce(async () => {
    h.generation = 2;
    return revision;
  });
  await click("creatorLocation.save");
  expect(host.textContent).not.toContain("creatorLocation.saved");
  expect(h.get).toHaveBeenCalledTimes(1);
});
it("keeps a version conflict for explicit abandonment without overwriting the other writer", async () => {
  await open();
  await toggle();
  h.put.mockRejectedValueOnce(
    new ApiRequestError("CONFLICT", "Location changed on another device", 409)
  );
  await click("creatorLocation.save");
  expect(host.textContent).toContain("Location changed on another device");
  expect(
    host.querySelector<HTMLInputElement>('input[aria-label="creatorLocation.remote"]')!.disabled
  ).toBe(true);
  await click("creatorLocation.discard");
  h.get.mockResolvedValueOnce({
    ...revision,
    version: 4,
    profile: { ...profile, basedIn: { countryCode: "JP", city: "Tokyo" } },
  });
  await act(async () =>
    Array.from(host.querySelectorAll("button"))
      .filter((b) => b.textContent === "creatorLocation.discard")
      .at(-1)!
      .click()
  );
  expect(
    host.querySelector<HTMLInputElement>(
      'input[aria-label="creatorLocation.basedIn: creatorLocation.city"]'
    )!.value
  ).toBe("Tokyo");
  expect(h.put).toHaveBeenCalledTimes(1);
  expect(button("creatorLocation.retrySave")).toBeUndefined();
});
