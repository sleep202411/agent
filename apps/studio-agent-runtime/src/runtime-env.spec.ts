import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { declaredEnvKeys, loadRuntimeDotEnv, readDotEnvValue } from "./runtime-env.js";

describe("runtime environment file", () => {
  it("loads the app's own .env so a bare node dist/worker-*.js starts", () => {
    const directory = mkdtempSync(join(tmpdir(), "studio-agent-env-"));
    const path = join(directory, ".env");
    writeFileSync(path, "STUDIO_AGENT_RELEASE=local-dev\nTEMPORAL_NAMESPACE=default\n", "utf8");
    const environment: NodeJS.ProcessEnv = {};

    const result = loadRuntimeDotEnv({
      path,
      environment,
      loadEnvFile: () => {
        environment.STUDIO_AGENT_RELEASE = "local-dev";
        environment.TEMPORAL_NAMESPACE = "default";
      },
    });

    expect(result.loaded).toBe(true);
    expect(environment.STUDIO_AGENT_RELEASE).toBe("local-dev");
    expect([...result.applied].sort()).toEqual(["STUDIO_AGENT_RELEASE", "TEMPORAL_NAMESPACE"]);
  });

  it("never replaces a variable the deployment already set", () => {
    const directory = mkdtempSync(join(tmpdir(), "studio-agent-env-"));
    const path = join(directory, ".env");
    writeFileSync(path, "STUDIO_AGENT_RELEASE=from-file\n", "utf8");
    const environment: NodeJS.ProcessEnv = { STUDIO_AGENT_RELEASE: "from-deployment" };

    const result = loadRuntimeDotEnv({
      path,
      environment,
      // Mirrors process.loadEnvFile, which leaves already-set variables alone.
      loadEnvFile: () => {},
    });

    expect(environment.STUDIO_AGENT_RELEASE).toBe("from-deployment");
    expect(result.ignored).toEqual(["STUDIO_AGENT_RELEASE"]);
  });

  it("is a reported no-op when no file exists, as in the production image", () => {
    const directory = mkdtempSync(join(tmpdir(), "studio-agent-env-"));

    const result = loadRuntimeDotEnv({
      path: join(directory, ".env"),
      environment: {},
      loadEnvFile: () => {
        throw new Error("must not be called");
      },
    });

    expect(result).toMatchObject({ loaded: false, applied: [], ignored: [] });
  });

  it("reports the file and the failure when the file cannot be parsed", () => {
    const directory = mkdtempSync(join(tmpdir(), "studio-agent-env-"));
    const path = join(directory, ".env");
    writeFileSync(path, "not-an-assignment\n", "utf8");

    expect(() =>
      loadRuntimeDotEnv({
        path,
        environment: {},
        loadEnvFile: () => {
          throw new Error("invalid line");
        },
      })
    ).toThrow(new RegExp(`Failed to parse the runtime environment file .*\\.env: invalid line`));
  });

  it("reports key names only, never values", () => {
    const directory = mkdtempSync(join(tmpdir(), "studio-agent-env-"));
    const path = join(directory, ".env");
    writeFileSync(
      path,
      [
        "# comment",
        "ALIBABA_API_KEY=sk-secret-value",
        "export TEMPORAL_NAMESPACE=default",
        "",
      ].join("\n"),
      "utf8"
    );

    const keys = declaredEnvKeys(path);

    expect(keys).toEqual(["ALIBABA_API_KEY", "TEMPORAL_NAMESPACE"]);
    expect(keys.join(",")).not.toContain("sk-secret-value");
  });

  it("really loads a file through Node's own parser with process precedence", () => {
    const directory = mkdtempSync(join(tmpdir(), "studio-agent-env-"));
    const path = join(directory, ".env");
    writeFileSync(path, "STUDIO_AGENT_TEST_PRESET=from-file\nSTUDIO_AGENT_TEST_NEW=from-file\n");
    process.env.STUDIO_AGENT_TEST_PRESET = "from-process";
    delete process.env.STUDIO_AGENT_TEST_NEW;

    try {
      const result = loadRuntimeDotEnv({ path });

      expect(process.env.STUDIO_AGENT_TEST_PRESET).toBe("from-process");
      expect(process.env.STUDIO_AGENT_TEST_NEW).toBe("from-file");
      expect(result.applied).toContain("STUDIO_AGENT_TEST_NEW");
      expect(result.ignored).toContain("STUDIO_AGENT_TEST_PRESET");
    } finally {
      delete process.env.STUDIO_AGENT_TEST_PRESET;
      delete process.env.STUDIO_AGENT_TEST_NEW;
    }
  });
});

/**
 * A FRESH CLONE MUST START.
 *
 * The activities worker refuses to boot without ABLY_API_KEY — correctly, since
 * delivery IS Ably. But the key lives in `apps/server/.env`, where the documented
 * server setup already puts it, and requiring a second copy in this app's own
 * `.env` meant `npm run dev -w studio-agent-runtime` failed on every fresh
 * checkout. The launcher borrows exactly that one variable; this covers the
 * reader it borrows through, including the part that matters most — that it does
 * NOT drag the rest of another app's environment along with it.
 */
describe("borrowing one variable from another app's dotenv", () => {
  const write = (contents: string): string => {
    const path = join(mkdtempSync(join(tmpdir(), "studio-agent-borrow-")), ".env");
    writeFileSync(path, contents, "utf8");
    return path;
  };

  it("reads the requested key and nothing else", () => {
    const path = write(
      [
        "DATABASE_URL=postgres://localhost:5433/fizzdragon",
        "ALIBABA_API_KEY=another-apps-model-key",
        "ABLY_API_KEY=appid.keyid:c2VjcmV0",
        "",
      ].join("\n")
    );

    expect(readDotEnvValue(path, "ABLY_API_KEY")).toBe("appid.keyid:c2VjcmV0");
    // The server's .env also names variables this runtime reads. Loading the
    // file wholesale would silently reconfigure the worker from it.
    expect(process.env.DATABASE_URL).not.toBe("postgres://localhost:5433/fizzdragon");
    expect(process.env.ALIBABA_API_KEY).not.toBe("another-apps-model-key");
  });

  it("handles export prefixes, quotes and a later override", () => {
    expect(readDotEnvValue(write('export ABLY_API_KEY="a.b:c"\n'), "ABLY_API_KEY")).toBe("a.b:c");
    expect(readDotEnvValue(write("ABLY_API_KEY=a.b:c\nABLY_API_KEY=d.e:f\n"), "ABLY_API_KEY")).toBe(
      "d.e:f"
    );
  });

  it("is undefined rather than empty for a commented, blank or absent key, and for an absent file", () => {
    expect(readDotEnvValue(write("# ABLY_API_KEY=a.b:c\n"), "ABLY_API_KEY")).toBeUndefined();
    expect(readDotEnvValue(write("ABLY_API_KEY=\n"), "ABLY_API_KEY")).toBeUndefined();
    expect(readDotEnvValue(write("OTHER=1\n"), "ABLY_API_KEY")).toBeUndefined();
    expect(
      readDotEnvValue(join(tmpdir(), "studio-agent-no-such-file", ".env"), "ABLY_API_KEY")
    ).toBeUndefined();
  });
});
