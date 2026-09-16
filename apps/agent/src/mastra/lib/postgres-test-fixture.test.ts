import { afterEach, describe, expect, it } from "vitest";
import {
  configureArtifactTestDatabase,
  assertLegacyRedisTestTarget,
} from "./postgres-test-fixture";
const previous = {
  legacy: process.env.LEGACY_AGENT_TEST_DATABASE_URL,
  database: process.env.DATABASE_URL,
  ssl: process.env.PGSSLMODE,
};
afterEach(() => {
  for (const [key, value] of Object.entries({
    LEGACY_AGENT_TEST_DATABASE_URL: previous.legacy,
    DATABASE_URL: previous.database,
    PGSSLMODE: previous.ssl,
  })) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});
describe("Legacy Agent disposable database guard", () => {
  it.each(["5433", "55439"])("accepts the dedicated fixture on %s", (port) => {
    const url = `postgres://fixture@127.0.0.1:${port}/fizzdragon_legacy_agent_test?sslmode=disable`;
    process.env.LEGACY_AGENT_TEST_DATABASE_URL = url;
    configureArtifactTestDatabase();
    expect(process.env.DATABASE_URL).toBe(url);
  });
  it.each([
    "postgres://fixture@127.0.0.1:55439/task01",
    "postgres://fixture@production.invalid:55439/fizzdragon_legacy_agent_test",
    "postgres://fixture@127.0.0.1:5432/fizzdragon_legacy_agent_test",
    "postgres://fixture@127.0.0.1:55439/fizzdragon_legacy_agent_test?host=production.invalid",
  ])("rejects an unsafe reset target %s", (url) => {
    process.env.LEGACY_AGENT_TEST_DATABASE_URL = url;
    expect(() => configureArtifactTestDatabase()).toThrow("named legacy");
    expect(process.env.DATABASE_URL).toBe(previous.database);
  });
  it("does not use an ordinary runtime URL as reset permission", () => {
    delete process.env.LEGACY_AGENT_TEST_DATABASE_URL;
    expect(() => configureArtifactTestDatabase()).toThrow("Set LEGACY_AGENT_TEST_DATABASE_URL");
  });
});

describe("Legacy Redis disposable target guard", () => {
  it.each(["redis://localhost:16379", "redis://127.0.0.1:16389/0"])(
    "accepts explicit fixture %s",
    (url) => {
      expect(() => assertLegacyRedisTestTarget(url)).not.toThrow();
    }
  );
  it.each([
    "redis://production.invalid:16379",
    "redis://localhost:6379",
    "redis://localhost:16389?path=/tmp/other-redis.sock",
    "redis://localhost:16389/1",
  ])("rejects unrelated or overridden targets %s", (url) => {
    expect(() => assertLegacyRedisTestTarget(url)).toThrow("dedicated loopback");
  });
});
