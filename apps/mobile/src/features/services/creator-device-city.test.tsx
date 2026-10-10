import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { CreatorDeviceCity } from "./creator-device-city";
const h = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  locate: vi.fn(),
  confirm: vi.fn(),
  denied: vi.fn(),
  generation: 1,
  active: true,
  records: new Map<string, string>(),
  failStorage: false,
}));
vi.mock("./device-city-location", () => ({ locateDeviceCity: h.locate }));
vi.mock("@/auth/auth-store", () => ({ getAuthGeneration: () => h.generation }));
vi.mock("@/hooks/use-app-active", () => ({ useScreenActive: () => h.active }));
vi.mock("@/i18n", () => ({
  useTranslations: () => (key: string) => key,
  useLocale: () => "en-US",
}));
vi.mock("expo-modules-core", () => ({
  uuid: { v4: () => "11111111-1111-4111-8111-111111111111" },
}));
vi.mock("@/lib/durable-record", () => ({
  durableRecord: (ns: string, user: string, id: string) => ({
    read: () => h.records.get(ns + user + id) ?? null,
    write: (v: string) => {
      if (h.failStorage) throw Error("Storage blocked");
      h.records.set(ns + user + id, v);
    },
  }),
}));
vi.mock("@/lib/api-client", () => ({
  api: { get: h.get, post: h.post },
  ApiRequestError: class extends Error {
    status = 403;
  },
}));
vi.mock("@/components/themed-text", () => ({
  ThemedText: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}));
vi.mock("react-native", () => ({
  View: ({ children }: { children: ReactNode }) => <div>{children}</div>,
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
}));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let host: HTMLDivElement, root: Root;
const button = (key: string) =>
  [...host.querySelectorAll("button")].find((b) => b.textContent === `creatorDeviceCity.${key}`)!;
const click = (key: string) => act(async () => button(key).click());
const render = () =>
  act(async () =>
    root.render(
      <CreatorDeviceCity
        scope={{ userId: "alice", generation: 1 }}
        disabled={false}
        confirm={h.confirm}
        onDenied={h.denied}
      />
    )
  );
const completed = { state: "completed", city: { countryCode: "SG", city: "Singapore" } };
beforeEach(() => {
  vi.resetAllMocks();
  h.generation = 1;
  h.active = true;
  h.records.clear();
  h.failStorage = false;
  h.locate.mockResolvedValue({ latitude: 1.3, longitude: 103.8 });
  h.post.mockResolvedValue(completed);
  h.get.mockResolvedValue(completed);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});
it("asks only after explicit action and applies a suggestion only after confirmation", async () => {
  await render();
  expect(h.locate).not.toHaveBeenCalled();
  await click("locate");
  expect(h.post).toHaveBeenCalledWith(
    "/creator-location/me/device-city",
    expect.objectContaining({
      retry: false,
      data: {
        requestId: expect.any(String),
        consent: true,
        latitude: 1.3,
        longitude: 103.8,
        locale: "en-US",
      },
    })
  );
  expect(h.confirm).not.toHaveBeenCalled();
  expect([...h.records.values()]).toEqual(["11111111-1111-4111-8111-111111111111"]);
  await click("confirm");
  expect(h.confirm).toHaveBeenCalledWith(completed.city);
  expect([...h.records.values()]).toEqual([""]);
});
it("recovers a lost response after reopening without asking for coordinates or dispatching again", async () => {
  h.post.mockRejectedValueOnce(Error("Network"));
  await render();
  await click("locate");
  await act(async () => root.render(null));
  await render();
  await click("check");
  expect(h.locate).toHaveBeenCalledTimes(1);
  expect(h.post).toHaveBeenCalledTimes(1);
  expect(h.get).toHaveBeenCalledWith(
    "/creator-location/me/device-city/11111111-1111-4111-8111-111111111111",
    expect.objectContaining({ retry: false })
  );
  await click("dismiss");
  expect(h.confirm).not.toHaveBeenCalled();
});
it("does not transmit after permission denial or failed attempt persistence", async () => {
  h.locate.mockRejectedValueOnce(Error("Permission denied"));
  await render();
  await click("locate");
  expect(h.post).not.toHaveBeenCalled();
  h.failStorage = true;
  await click("locate");
  expect(h.post).not.toHaveBeenCalled();
  expect(host.textContent).toContain("Storage blocked");
});
it("retires late coordinates on background and can start again after return", async () => {
  let resolve!: (v: object) => void;
  h.locate.mockReturnValueOnce(new Promise((r) => (resolve = r)));
  await render();
  await click("locate");
  h.active = false;
  await render();
  await act(async () => resolve({ latitude: 1, longitude: 2 }));
  expect(h.post).not.toHaveBeenCalled();
  h.active = true;
  await render();
  expect(button("locate").disabled).toBe(false);
});
it("ignores a late result after the account changes", async () => {
  let resolve!: (v: object) => void;
  h.post.mockReturnValueOnce(new Promise((r) => (resolve = r)));
  await render();
  await click("locate");
  h.generation = 2;
  await act(async () => resolve(completed));
  expect(button("confirm")).toBeUndefined();
  expect(h.confirm).not.toHaveBeenCalled();
});
it("does not dispatch invalid coordinates", async () => {
  h.locate.mockResolvedValue({ latitude: 91, longitude: 2 });
  await render();
  await click("locate");
  expect(h.post).not.toHaveBeenCalled();
});
