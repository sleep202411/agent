// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, it, expect, vi } from "vitest";
import { CreatorDeviceCity } from "./creator-device-city";
import { api } from "@/src/lib/api";
vi.mock("@/src/i18n/i18n", () => ({
  useLocale: () => "en-US",
  useTranslations: () => (key: string) => key,
}));
vi.mock("@/src/lib/api", () => ({
  api: { get: vi.fn(), post: vi.fn() },
  ApiRequestError: class extends Error {
    status = 401;
  },
}));
let host: HTMLDivElement, root: Root;
const confirm = vi.fn(),
  denied = vi.fn(),
  locate = vi.fn();
const city = { city: "Singapore", countryCode: "SG" };
const button = (text: string) =>
  Array.from(host.querySelectorAll("button")).find((n) => n.textContent === text)!;
const click = async (text: string) =>
  act(async () => {
    button(text).click();
  });
beforeEach(async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.resetAllMocks();
  Object.defineProperty(window, "isSecureContext", { configurable: true, value: true });
  Object.defineProperty(navigator, "geolocation", {
    configurable: true,
    value: { getCurrentPosition: locate },
  });
  locate.mockImplementation((success) =>
    success({ coords: { latitude: 1.3521, longitude: 103.8198 } })
  );
  vi.mocked(api.post).mockResolvedValue({ state: "completed", city });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () =>
    root.render(<CreatorDeviceCity disabled={false} confirm={confirm} onDenied={denied} />)
  );
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});
it("requests nothing on mount and requires explicit confirmation before changing city", async () => {
  expect(locate).not.toHaveBeenCalled();
  expect(api.post).not.toHaveBeenCalled();
  await click("locate");
  expect(locate).toHaveBeenCalledTimes(1);
  expect(confirm).not.toHaveBeenCalled();
  expect(vi.mocked(api.post).mock.calls[0]![1]!.data).toMatchObject({
    consent: true,
    latitude: 1.3521,
    longitude: 103.8198,
  });
  await click("confirm");
  expect(confirm).toHaveBeenCalledWith(city);
});
it("permission denial keeps manual editing available and never calls server", async () => {
  locate.mockImplementation((_success, failure) => failure({ code: 1 }));
  await click("locate");
  expect(host.textContent).toContain("denied");
  expect(api.post).not.toHaveBeenCalled();
});
it("recovers a lost reply by reading the same attempt without another location or paid lookup", async () => {
  vi.mocked(api.post).mockRejectedValueOnce(new Error("Connection lost"));
  await click("locate");
  const id = (vi.mocked(api.post).mock.calls[0]![1]!.data as { requestId: string }).requestId;
  vi.mocked(api.get).mockResolvedValueOnce({ state: "completed", city });
  await click("check");
  expect(api.get).toHaveBeenCalledWith(
    `/aurora/creator-location/me/device-city/${id}`,
    expect.anything()
  );
  expect(locate).toHaveBeenCalledTimes(1);
  expect(api.post).toHaveBeenCalledTimes(1);
  expect(confirm).not.toHaveBeenCalled();
});
it("does not send coordinates from a late browser callback after unmount", async () => {
  let callback: (value: unknown) => void = () => {};
  locate.mockImplementation((success) => {
    callback = success;
  });
  await click("locate");
  act(() => root.unmount());
  root = createRoot(host);
  await act(async () => callback({ coords: { latitude: 1, longitude: 2 } }));
  expect(api.post).not.toHaveBeenCalled();
});
it("supports dismissal and unresolved city without confirmation", async () => {
  await click("locate");
  await click("dismiss");
  expect(confirm).not.toHaveBeenCalled();
  expect(button("confirm")).toBeUndefined();
  vi.mocked(api.post).mockResolvedValueOnce({ state: "completed", city: null });
  await click("locate");
  expect(button("confirm")).toBeUndefined();
});
