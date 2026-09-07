import { describe, expect, it } from "vitest";
import { isProtectedPath } from "./protected-paths";

describe("public TV catalog route", () => {
  it("allows anonymous viewers into TV just like the IP plaza", () => {
    for (const path of ["/tv", "/tv/", "/ips"]) {
      expect(isProtectedPath(path)).toBe(false);
    }
  });

  it("keeps unrelated and future TV routes protected", () => {
    for (const path of ["/tv-admin", "/tv/manage", "/profile", "/art-studio"]) {
      expect(isProtectedPath(path)).toBe(true);
    }
  });
});
