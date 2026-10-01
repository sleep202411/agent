// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, it, expect, vi } from "vitest";
import { CreatorLocationEditor } from "./creator-location-editor";
import { api, ApiRequestError } from "@/src/lib/api";
const account = vi.hoisted(() => ({ id: "owner" }));
vi.mock("@/src/hooks/use-user", () => ({ useCurrentUser: () => ({ user: { id: account.id } }) }));
vi.mock("@/src/i18n/i18n", () => ({
  useLocale: () => "en-US",
  useTranslations: () => (key: string) => key,
}));
vi.mock("@/src/lib/api", () => ({
  api: { get: vi.fn(), put: vi.fn(), post: vi.fn() },
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
let host: HTMLDivElement;
let root: Root;
const profile = {
  basedIn: { countryCode: "SG", city: "Singapore" },
  serves: [{ countryCode: "MY", city: "Johor Bahru" }],
  remote: true,
  showOnMap: true,
};
const initial = { version: 1, profile, requestId: "01900000-0000-7000-8000-000000000003" };
const button = (text: string) =>
  Array.from(host.querySelectorAll("button")).find((node) => node.textContent === text)!;
async function render() {
  await act(async () => root.render(<CreatorLocationEditor />));
}
async function submit() {
  await act(async () => {
    host
      .querySelector("form")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
}
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.resetAllMocks();
  account.id = "owner";
  sessionStorage.clear();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  vi.mocked(api.get).mockResolvedValue(initial);
  vi.mocked(api.put).mockResolvedValue({ version: 2 });
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});
it("reuses the exact persisted request after a lost reply and remount", async () => {
  vi.mocked(api.put).mockRejectedValueOnce(new Error("Connection lost"));
  await render();
  await submit();
  const first = vi.mocked(api.put).mock.calls[0]![1]!.data;
  expect(host.textContent).toContain("Connection lost");
  expect(host.querySelector("fieldset")!.disabled).toBe(true);
  act(() => root.unmount());
  root = createRoot(host);
  await render();
  expect(button("retrySave")).toBeTruthy();
  await submit();
  expect(vi.mocked(api.put).mock.calls[1]![1]!.data).toEqual(first);
  expect(sessionStorage.length).toBe(0);
  expect(host.textContent).toContain("saved");
});
it("reads latest after replay instead of adopting an older receipt", async () => {
  await render();
  vi.mocked(api.get).mockResolvedValueOnce({
    ...initial,
    version: 8,
    profile: { ...profile, basedIn: { ...profile.basedIn, city: "Latest owner correction" } },
  });
  await submit();
  expect(host.querySelector("input")!.value).toBe("Latest owner correction");
  await submit();
  expect(vi.mocked(api.put).mock.calls[1]![1]!.data).toMatchObject({ expectedVersion: 8 });
});
it("retains edits on conflict and requires explicit loading of latest", async () => {
  vi.mocked(api.put).mockRejectedValueOnce(
    new ApiRequestError("CONFLICT", "Changed elsewhere", 409)
  );
  await render();
  await submit();
  expect(host.querySelector("input")!.value).toBe("Singapore");
  expect(button("save").disabled).toBe(true);
  vi.mocked(api.get).mockResolvedValueOnce({
    ...initial,
    version: 3,
    profile: { ...profile, basedIn: null, serves: [], showOnMap: false },
  });
  await act(async () => button("discard").click());
  expect(host.querySelectorAll("input[type=text]")).toHaveLength(0);
  expect(button("save").disabled).toBe(false);
});
it("clears private fields when owner access is revoked", async () => {
  vi.mocked(api.put).mockRejectedValueOnce(new ApiRequestError("NOT_FOUND", "IP not found.", 404));
  await render();
  await submit();
  expect(host.querySelector("form")).toBeNull();
  expect(sessionStorage.length).toBe(0);
  expect(host.textContent).toContain("IP not found.");
});
it("removing the base withdraws map consent but keeps service areas and remote work", async () => {
  await render();
  await act(async () => button("removeBase").click());
  expect((host.querySelector("input[type=checkbox]") as HTMLInputElement).checked).toBe(false);
  await submit();
  expect(vi.mocked(api.put).mock.calls[0]![1]!.data).toMatchObject({
    profile: { ...profile, basedIn: null, showOnMap: false },
  });
});
it("does not infer map consent for a new declaration", async () => {
  vi.mocked(api.get).mockResolvedValueOnce({ version: 0, profile: null, requestId: null });
  await render();
  expect((host.querySelector("input[type=checkbox]") as HTMLInputElement).checked).toBe(false);
  await act(async () => button("addBase").click());
  await submit();
  expect(api.put).not.toHaveBeenCalled();
  expect(host.textContent).toContain("invalid");
});
it("prevents duplicate dispatch and ignores replies after an account change", async () => {
  let finish!: (value: unknown) => void;
  vi.mocked(api.put).mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      })
  );
  await render();
  act(() => {
    for (let n = 0; n < 2; n++)
      host
        .querySelector("form")!
        .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
  expect(api.put).toHaveBeenCalledTimes(1);
  const signal = vi.mocked(api.put).mock.calls[0]![1]!.signal!;
  account.id = "other";
  vi.mocked(api.get).mockResolvedValueOnce({ version: 0, profile: null, requestId: null });
  await render();
  expect(signal.aborted).toBe(true);
  await act(async () => finish({ version: 2 }));
  expect(host.querySelectorAll("input[type=text]")).toHaveLength(0);
  expect(host.querySelector("[role=status]")).toBeNull();
});
it("does not send if durable retry storage is unavailable", async () => {
  await render();
  const storage = sessionStorage;
  vi.stubGlobal("sessionStorage", {
    getItem: storage.getItem.bind(storage),
    removeItem: storage.removeItem.bind(storage),
    setItem: () => {
      throw new Error("Storage unavailable");
    },
  });
  try {
    await submit();
    expect(api.put).not.toHaveBeenCalled();
    expect(host.textContent).toContain("Storage unavailable");
  } finally {
    vi.unstubAllGlobals();
  }
});

const missingCity = { version: 1, attemptId: null, state: "missing", point: null };
const resolvedCity = {
  version: 1,
  attemptId: "01900000-0000-7000-8000-000000000004",
  state: "resolved",
  point: {
    latitude: 1.3,
    longitude: 103.8,
    coordinateSystem: "WGS84",
    precision: "city",
    provider: "google",
    providerPlaceId: "sg",
  },
};
it("resolves a saved city only after explicit status check and action", async () => {
  await render();
  expect(api.post).not.toHaveBeenCalled();
  expect(button("resolve").disabled).toBe(true);
  vi.mocked(api.get).mockResolvedValueOnce(missingCity);
  await act(async () => button("check").click());
  expect(button("resolve").disabled).toBe(false);
  vi.mocked(api.post).mockResolvedValueOnce(resolvedCity);
  await act(async () => button("resolve").click());
  expect(vi.mocked(api.post).mock.calls[0]![1]!.data).toEqual({
    expectedVersion: 1,
    locale: "en-US",
  });
  expect(host.textContent).toContain("resolved");
  expect(api.put).not.toHaveBeenCalled();
});
it("recovers a lost geocoder reply through read-only status after remount", async () => {
  await render();
  vi.mocked(api.get).mockResolvedValueOnce(missingCity);
  await act(async () => button("check").click());
  vi.mocked(api.post).mockRejectedValueOnce(new Error("Geocoder reply lost"));
  await act(async () => button("resolve").click());
  expect(button("resolve").disabled).toBe(true);
  expect(host.textContent).toContain("Geocoder reply lost");
  act(() => root.unmount());
  root = createRoot(host);
  await render();
  vi.mocked(api.get).mockResolvedValueOnce(resolvedCity);
  await act(async () => button("check").click());
  expect(api.post).toHaveBeenCalledTimes(1);
  expect(host.textContent).toContain("resolved");
});
it("does not resolve unsaved edits or a different profile revision", async () => {
  await render();
  vi.mocked(api.get).mockResolvedValueOnce({ ...missingCity, version: 2 });
  await act(async () => button("check").click());
  expect(button("resolve").disabled).toBe(true);
  expect(host.textContent).toContain("changed");
  vi.mocked(api.get).mockResolvedValueOnce(missingCity);
  await act(async () => button("check").click());
  await act(async () => button("removeBase").click());
  expect(button("resolve").disabled).toBe(true);
  expect(button("check").disabled).toBe(true);
});
it("clears the editor on geocode authentication failure", async () => {
  await render();
  vi.mocked(api.get).mockRejectedValueOnce(new ApiRequestError("401", "Session expired", 401));
  await act(async () => button("check").click());
  expect(host.querySelector("form")).toBeNull();
  expect(host.textContent).toContain("Session expired");
});
it("does not restore old-account geocode results", async () => {
  await render();
  let finish!: (value: unknown) => void;
  vi.mocked(api.get).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      })
  );
  await act(async () => button("check").click());
  const signal = vi.mocked(api.get).mock.calls.at(-1)![1]!.signal;
  account.id = "other";
  await render();
  expect(signal?.aborted).toBe(true);
  await act(async () => finish(resolvedCity));
  expect(host.textContent).not.toContain(resolvedCity.attemptId);
  expect(button("resolve").disabled).toBe(true);
});
