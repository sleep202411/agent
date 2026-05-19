import { afterEach, describe, expect, it } from "vitest";
import { postgresSslConfig, requireDatabaseUrl } from "./postgres-config";

const ORIGINAL_DATABASE_URL = process.env.DATABASE_URL;
const ORIGINAL_PGSSLMODE = process.env.PGSSLMODE;

afterEach(() => {
  restoreEnv("DATABASE_URL", ORIGINAL_DATABASE_URL);
  restoreEnv("PGSSLMODE", ORIGINAL_PGSSLMODE);
});

describe("requireDatabaseUrl", () => {
  it("fails fast when the agent storage DSN is missing", () => {
    delete process.env.DATABASE_URL;

    expect(() => requireDatabaseUrl()).toThrow(/DATABASE_URL is not set/);
  });

  it("returns the configured DSN unchanged", () => {
    process.env.DATABASE_URL = "postgresql://user:pass@postgres:5432/fizzdragon";

    expect(requireDatabaseUrl()).toBe("postgresql://user:pass@postgres:5432/fizzdragon");
  });
});

describe("postgresSslConfig", () => {
  it("disables TLS for in-docker Postgres when PGSSLMODE=disable", () => {
    process.env.DATABASE_URL = "postgresql://user:pass@postgres:5432/fizzdragon";
    process.env.PGSSLMODE = "disable";

    expect(postgresSslConfig()).toBe(false);
  });

  it("honors sslmode=disable from the connection string", () => {
    process.env.DATABASE_URL = "postgresql://user:pass@postgres:5432/fizzdragon?sslmode=disable";
    delete process.env.PGSSLMODE;

    expect(postgresSslConfig()).toBe(false);
  });

  it("keeps managed Postgres compatible by defaulting to TLS without CA verification", () => {
    process.env.DATABASE_URL = "postgresql://user:pass@host:5432/fizzdragon";
    delete process.env.PGSSLMODE;

    expect(postgresSslConfig()).toEqual({ rejectUnauthorized: false });
  });

  it("uses strict TLS for verify modes", () => {
    process.env.DATABASE_URL = "postgresql://user:pass@host:5432/fizzdragon";
    process.env.PGSSLMODE = "verify-full";

    expect(postgresSslConfig()).toBe(true);
  });
});

function restoreEnv(key: "DATABASE_URL" | "PGSSLMODE", value: string | undefined): void {
  if (value === undefined) {
    delete process.env[key];
  } else {
    process.env[key] = value;
  }
}
