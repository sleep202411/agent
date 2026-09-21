import { afterEach, expect, it, vi } from "vitest";
import { adminApiBaseUrl } from "./admin-api";
afterEach(() => vi.unstubAllEnvs());
it.each(["", "   "])("uses configured fallback when primary is blank (%s)", (primary) => {
  vi.stubEnv("ADMIN_API_BASE_URL", primary);
  vi.stubEnv("ADMIN_GLOBAL_API_BASE_URL", "https://fixture.invalid/admin");
  expect(adminApiBaseUrl()).toBe("https://fixture.invalid/admin");
});
it("prefers a nonblank primary and trims its surrounding whitespace", () => {
  vi.stubEnv("ADMIN_API_BASE_URL", " https://primary.invalid/admin ");
  vi.stubEnv("ADMIN_GLOBAL_API_BASE_URL", "https://fallback.invalid/admin");
  expect(adminApiBaseUrl()).toBe("https://primary.invalid/admin");
});
it("fails when both configured origins are blank", () => {
  vi.stubEnv("ADMIN_API_BASE_URL", " ");
  vi.stubEnv("ADMIN_GLOBAL_API_BASE_URL", " ");
  expect(() => adminApiBaseUrl()).toThrow("Missing admin API base URL");
});
