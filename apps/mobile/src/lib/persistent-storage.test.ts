import { afterEach, expect, it, vi } from "vitest";
import { getStoredString } from "./persistent-storage";
const native = vi.hoisted(() => ({
  getItemAsync: vi.fn(),
  setItemAsync: vi.fn(),
  deleteItemAsync: vi.fn(),
}));
vi.mock("expo-secure-store", () => native);
vi.mock("react-native", () => ({ Platform: { OS: "web" } }));
afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
});
it("treats a blocked web storage getter as an unavailable read", async () => {
  vi.spyOn(window, "localStorage", "get").mockImplementation(() => {
    throw new DOMException("blocked", "SecurityError");
  });
  await expect(getStoredString("key")).resolves.toBeNull();
  expect(native.getItemAsync).not.toHaveBeenCalled();
});
it("does not fall through to native storage when web storage is unavailable", async () => {
  vi.spyOn(window, "localStorage", "get").mockReturnValue(undefined as unknown as Storage);
  await expect(getStoredString("key")).resolves.toBeNull();
  expect(native.getItemAsync).not.toHaveBeenCalled();
});
it("reads available web storage", async () => {
  window.localStorage.setItem("fixture-key", "value");
  await expect(getStoredString("fixture-key")).resolves.toBe("value");
  window.localStorage.removeItem("fixture-key");
});
