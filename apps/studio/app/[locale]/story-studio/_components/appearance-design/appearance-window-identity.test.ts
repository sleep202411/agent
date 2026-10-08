import { describe, expect, it } from "vitest";
import { appearanceWindowIdentity } from "./appearance-window-identity";
const storage = () => {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
  };
};
describe("editor window identity", () => {
  it("retains the identity across reloads in one window", () => {
    const windowStorage = storage();
    expect(appearanceWindowIdentity(windowStorage)).toBe(appearanceWindowIdentity(windowStorage));
  });
  it("separates contexts for two windows of the same project", () => {
    expect(appearanceWindowIdentity(storage())).not.toBe(appearanceWindowIdentity(storage()));
  });
  it("replaces an invalid stored identity", () => {
    const windowStorage = storage();
    windowStorage.setItem("fizzdragon.design-window.v1", "a".repeat(1000));
    expect(appearanceWindowIdentity(windowStorage)).toHaveLength(36);
  });
  it("still creates an identity when storage is blocked", () => {
    expect(
      appearanceWindowIdentity({
        getItem: () => {
          throw new Error("blocked");
        },
        setItem: () => {},
      })
    ).toHaveLength(36);
  });
});
