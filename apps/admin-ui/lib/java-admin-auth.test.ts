import { afterEach, describe, expect, it, vi } from "vitest";
import { javaAdminAuthHeaders } from "./java-admin-auth";

vi.mock("server-only", () => ({}));

describe("Java admin authentication", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("uses the shared Java admin token for the default header", () => {
    vi.stubEnv("JAVA_ADMIN_API_TOKEN", "admin-token");
    expect(javaAdminAuthHeaders()).toEqual({ "X-Admin-Api-Token": "admin-token" });
  });

  it("honours the Java-configured header name", () => {
    vi.stubEnv("JAVA_ADMIN_API_TOKEN", "admin-token");
    vi.stubEnv("JAVA_ADMIN_API_TOKEN_HEADER", "X-Fizz-Admin-Token");
    expect(javaAdminAuthHeaders()).toEqual({ "X-Fizz-Admin-Token": "admin-token" });
  });

  it("fails closed when the shared token is missing", () => {
    vi.stubEnv("JAVA_ADMIN_API_TOKEN", "");
    expect(() => javaAdminAuthHeaders()).toThrow("JAVA_ADMIN_API_TOKEN");
  });
});
