import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { checkForUpdate } from "./update-check";
const s = vi.hoisted(() => ({
  alert: vi.fn(),
  open: vi.fn(),
  latest: vi.fn(),
  stored: vi.fn(),
  set: vi.fn(),
}));
vi.mock("react-native", () => ({
  Alert: { alert: s.alert },
  Linking: { openURL: s.open },
  Platform: { OS: "android" },
}));
vi.mock("expo-constants", () => ({ default: { expoConfig: { android: { versionCode: 80 } } } }));
vi.mock("@/data/app-release-api", () => ({ fetchLatestRelease: s.latest }));
vi.mock("@/i18n", () => ({ t: (key: string) => key }));
vi.mock("@/lib/persistent-storage", () => ({ getStoredString: s.stored, setStoredString: s.set }));
const release = {
  versionName: "2.3",
  versionCode: 81,
  downloadUrl: "https://downloads.test.invalid/new.apk",
};
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("__DEV__", false);
  s.latest.mockResolvedValue(release);
  s.open.mockResolvedValue(undefined);
  s.stored.mockResolvedValue(null);
  s.set.mockResolvedValue(undefined);
});
afterEach(() => vi.unstubAllGlobals());
function pressUpdate() {
  const buttons = s.alert.mock.calls[0][2] as { text: string; onPress?: () => void }[];
  buttons.find((b) => b.text === "update.updateNow")!.onPress!();
}
it.each([false, true])(
  "reports a rejected update launch (minimum build advertised=%s)",
  async (forced) => {
    s.latest.mockResolvedValue({ ...release, minSupportedCode: forced ? 81 : undefined });
    const rejected = Promise.reject(new Error("No URL handler"));
    // Observe the fixture promise so the baseline failure is the missing user feedback.
    void rejected.catch(() => {});
    s.open.mockReturnValue(rejected);
    await checkForUpdate({ manual: true });
    pressUpdate();
    await Promise.resolve();
    await Promise.resolve();
    expect(s.open).toHaveBeenCalledWith(release.downloadUrl);
    expect(s.alert).toHaveBeenCalledWith("update.openFailed", "No URL handler");
  }
);
it("leaves a successful launch alone", async () => {
  await checkForUpdate({ manual: true });
  pressUpdate();
  await Promise.resolve();
  expect(s.open).toHaveBeenCalledWith(release.downloadUrl);
  expect(s.alert).toHaveBeenCalledTimes(1);
});
it("respects the prompt throttle even when the minimum supported build is higher", async () => {
  s.stored.mockResolvedValue(String(Date.now()));
  s.latest.mockResolvedValue({ ...release, minSupportedCode: 81 });
  await checkForUpdate();
  expect(s.alert).not.toHaveBeenCalled();
  expect(s.open).not.toHaveBeenCalled();
  expect(s.set).not.toHaveBeenCalled();
});
it.each([false, true])(
  "keeps updates optional below the minimum build (manual=%s)",
  async (manual) => {
    s.latest.mockResolvedValue({ ...release, minSupportedCode: 81 });
    if (manual) s.stored.mockResolvedValue(String(Date.now()));
    await checkForUpdate({ manual });
    expect(s.alert).toHaveBeenCalledTimes(1);
    expect(s.alert.mock.calls[0][2]).toEqual([
      { text: "update.later", style: "cancel" },
      { text: "update.updateNow", onPress: expect.any(Function) },
    ]);
    expect(s.alert.mock.calls[0][3]).toEqual({ cancelable: true });
    expect(s.open).not.toHaveBeenCalled();
  }
);
