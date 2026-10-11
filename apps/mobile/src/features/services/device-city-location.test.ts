import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { locateDeviceCity } from "./device-city-location";
const h = vi.hoisted(() => ({ permission: vi.fn(), position: vi.fn() }));
vi.mock("expo-location", () => ({
  Accuracy: { Balanced: 3 },
  requestForegroundPermissionsAsync: h.permission,
  getCurrentPositionAsync: h.position,
}));
beforeEach(() => {
  vi.resetAllMocks();
  h.permission.mockResolvedValue({ granted: true });
  h.position.mockResolvedValue({ coords: { latitude: 1, longitude: 2, altitude: 3 } });
});
afterEach(() => vi.useRealTimers());
it("requests foreground permission and returns only coordinates", async () => {
  expect(await locateDeviceCity(new AbortController().signal, (k) => k)).toEqual({
    latitude: 1,
    longitude: 2,
  });
  expect(h.position).toHaveBeenCalledWith({ accuracy: 3 });
});
it("stops after denial and aborts before invoking location", async () => {
  h.permission.mockResolvedValue({ granted: false });
  await expect(locateDeviceCity(new AbortController().signal, (k) => k)).rejects.toThrow("denied");
  expect(h.position).not.toHaveBeenCalled();
});
it("times out rather than leaving the form busy forever", async () => {
  vi.useFakeTimers();
  h.position.mockReturnValue(new Promise(() => {}));
  const result = expect(locateDeviceCity(new AbortController().signal, (k) => k)).rejects.toThrow(
    "unavailable"
  );
  await vi.advanceTimersByTimeAsync(10000);
  await result;
});
it("rejects a pending lookup on background cancellation", async () => {
  h.position.mockReturnValue(new Promise(() => {}));
  const c = new AbortController();
  const result = expect(locateDeviceCity(c.signal, (k) => k)).rejects.toThrow("unavailable");
  await Promise.resolve();
  c.abort();
  await result;
});
