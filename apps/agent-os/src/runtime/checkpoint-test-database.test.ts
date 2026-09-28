import { describe, expect, it } from "vitest";
import { checkpointTestDatabase } from "./checkpoint-test-database.js";

describe("Checkpoint integration database selection", () => {
  it("does not infer permission from an ordinary DATABASE_URL", () => {
    expect(
      checkpointTestDatabase({ DATABASE_URL: "postgres://production.invalid/product" })
    ).toBeNull();
  });
  it("uses the explicit CI fixture in preference to a runtime URL", () => {
    const fixture = "postgres://fixture@127.0.0.1:55439/task01?sslmode=disable";
    expect(
      checkpointTestDatabase({
        TASK01_TEST_DATABASE_URL: fixture,
        DATABASE_URL: "postgres://production.invalid/product",
      })
    ).toBe(fixture);
  });
  it("retains explicit local checkpoint opt-in", () => {
    const fixture = "postgres://fixture@localhost:5433/fizzdragon";
    expect(
      checkpointTestDatabase({
        AGENT_OS_CHECKPOINT_POSTGRES_INTEGRATION: "1",
        DATABASE_URL: fixture,
      })
    ).toBe(fixture);
  });
  it.each([
    "postgres://fixture@production.invalid:55439/task01",
    "postgres://fixture@127.0.0.1:55439/product",
    "postgres://fixture@127.0.0.1:5432/task01",
    "postgres://fixture@127.0.0.1:55439/task01?host=production.invalid",
    "postgres://fixture@127.0.0.1:55439/task01?dbname=product",
  ])("rejects unsafe fixture selection %s", (url) => {
    expect(() => checkpointTestDatabase({ TASK01_TEST_DATABASE_URL: url })).toThrow(
      "named loopback"
    );
  });
  it("requires an explicit URL for local opt-in", () => {
    expect(() => checkpointTestDatabase({ AGENT_OS_CHECKPOINT_POSTGRES_INTEGRATION: "1" })).toThrow(
      "explicit test database"
    );
  });
});
