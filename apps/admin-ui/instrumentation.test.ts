import { afterEach, describe, expect, it, vi } from "vitest";
import { register } from "./instrumentation";

const ORIGINAL = { ...process.env };

function setEnv(env: Record<string, string | undefined>) {
  for (const key of Object.keys(process.env)) delete process.env[key];
  for (const [key, value] of Object.entries(env)) {
    if (value !== undefined) process.env[key] = value;
  }
}

const COMPLETE = {
  NEXT_RUNTIME: "nodejs",
  NODE_ENV: "production",
  JAVA_ADMIN_API_TOKEN: "token",
  NEWS_API_BASE_URL: "https://java.fizzdragon.com/content",
  TEXT_GAME_API_BASE_URL: "https://java.fizzdragon.com/studio",
  ADMIN_API_BASE_URL: "http://fizzdragon-server:3001/admin",
};

afterEach(() => {
  setEnv(ORIGINAL);
  vi.restoreAllMocks();
});

describe("register", () => {
  it("passes when every required variable is present", () => {
    setEnv(COMPLETE);
    expect(() => register()).not.toThrow();
  });

  /**
   * The regression this file exists for: the pod that ran the Java text-game
   * API without a token started happily and only failed when a reviewer opened
   * the screen. Startup must refuse instead.
   */
  it("throws when the Java admin token is missing, and names the variable", () => {
    setEnv({ ...COMPLETE, JAVA_ADMIN_API_TOKEN: undefined });
    expect(() => register()).toThrowError(/JAVA_ADMIN_API_TOKEN/);
  });

  it("treats a blank value as missing", () => {
    setEnv({ ...COMPLETE, JAVA_ADMIN_API_TOKEN: "   " });
    expect(() => register()).toThrowError(/JAVA_ADMIN_API_TOKEN/);
  });

  it("reports every missing variable at once, not just the first", () => {
    setEnv({
      ...COMPLETE,
      JAVA_ADMIN_API_TOKEN: undefined,
      TEXT_GAME_API_BASE_URL: undefined,
    });
    try {
      register();
      expect.unreachable("register should have thrown");
    } catch (error) {
      const message = (error as Error).message;
      expect(message).toMatch(/JAVA_ADMIN_API_TOKEN/);
      expect(message).toMatch(/TEXT_GAME_API_BASE_URL/);
      expect(message).toMatch(/missing 2 required/);
    }
  });

  it("accepts ADMIN_GLOBAL_API_BASE_URL in place of ADMIN_API_BASE_URL", () => {
    setEnv({
      ...COMPLETE,
      ADMIN_API_BASE_URL: undefined,
      ADMIN_GLOBAL_API_BASE_URL: "http://fizzdragon-server:3001/admin",
    });
    expect(() => register()).not.toThrow();
  });

  it("throws when neither admin API base URL is set", () => {
    setEnv({ ...COMPLETE, ADMIN_API_BASE_URL: undefined });
    expect(() => register()).toThrowError(/ADMIN_API_BASE_URL \(or ADMIN_GLOBAL_API_BASE_URL\)/);
  });

  /** Local dev must not need a real Key Vault secret to boot. */
  it("stays silent outside production", () => {
    setEnv({ NEXT_RUNTIME: "nodejs", NODE_ENV: "development" });
    expect(() => register()).not.toThrow();
  });

  /** Only the Node.js server talks to Java; the edge runtime reads none of these. */
  it("stays silent on the edge runtime", () => {
    setEnv({ NEXT_RUNTIME: "edge", NODE_ENV: "production" });
    expect(() => register()).not.toThrow();
  });
});
