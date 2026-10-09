import { createHash } from "node:crypto";
import {
  canonicalizeExperienceJson,
  type ExperienceJsonValue,
  type ExperienceRuntimeManifest,
} from "@repo/shared/experience-runtime";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { loadExperienceTheme } from "./experience-theme-loader";

// Run the interactive-player theme checks with the reported native API gap.
const nativeAbortCheck = Object.getOwnPropertyDescriptor(AbortSignal.prototype, "throwIfAborted");
beforeAll(async () => {
  Reflect.deleteProperty(AbortSignal.prototype, "throwIfAborted");
  await import("@/lib/abort-signal-polyfill");
});
afterAll(() => {
  if (nativeAbortCheck) {
    Object.defineProperty(AbortSignal.prototype, "throwIfAborted", nativeAbortCheck);
  } else {
    Reflect.deleteProperty(AbortSignal.prototype, "throwIfAborted");
  }
});

const THEME = {
  schemaVersion: 1,
  colorScheme: "dark",
  tokens: { "color.background": "#000000", "radius.panel": 20 },
  motion: { reducedMotionBehavior: "minimize" },
} as const;

function themeHash(): string {
  return createHash("sha256")
    .update(canonicalizeExperienceJson(THEME as ExperienceJsonValue))
    .digest("hex");
}

function manifest(sha256 = themeHash()): ExperienceRuntimeManifest {
  return {
    theme: {
      themeId: "theme.test",
      apiVersion: "1.0.0",
      configAssetId: "theme.config",
    },
    assets: [
      {
        assetId: "theme.config",
        kind: "data",
        sourceAssetId: "theme.config.source",
        sha256,
        uri: "/theme.json",
        mediaType: "application/json",
        format: "json",
      },
    ],
  } as ExperienceRuntimeManifest;
}

vi.mock("@/config", () => ({ resolveExperienceAssetUrl: (uri: string) => uri }));
afterEach(() => vi.restoreAllMocks());

describe("loadExperienceTheme", () => {
  it("loads, validates, and materializes a frozen declarative theme", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify(THEME), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    );

    await expect(loadExperienceTheme(manifest())).resolves.toEqual({
      ...THEME,
      rendererStyles: {},
    });
  });

  it("rejects theme content that does not match the manifest checksum", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify(THEME), { status: 200 })
    );

    await expect(loadExperienceTheme(manifest("a".repeat(64)))).rejects.toThrow(
      "failed integrity validation"
    );
  });
  it("stops before hashing a body resolved after cancellation", async () => {
    let resolveBody!: (value: unknown) => void;
    const body = new Promise<unknown>((resolve) => {
      resolveBody = resolve;
    });
    const response = new Response();
    vi.spyOn(response, "json").mockReturnValue(body);
    vi.spyOn(globalThis, "fetch").mockResolvedValue(response);
    const controller = new AbortController();
    const pending = loadExperienceTheme(manifest(), controller.signal);
    const rejected = expect(pending).rejects.toMatchObject({ name: "AbortError" });
    await Promise.resolve();
    controller.abort();
    resolveBody(THEME);
    await rejected;
  });
});
