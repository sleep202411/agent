import { createHash } from "node:crypto";
import {
  canonicalizeExperienceJson,
  type ExperienceJsonValue,
  type ExperienceRuntimeManifest,
} from "@repo/shared/experience-runtime";
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadExperienceTheme } from "./experience-theme-loader";

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
    const digest = vi.spyOn(globalThis.crypto.subtle, "digest");
    const controller = new AbortController();
    const pending = loadExperienceTheme(manifest(), controller.signal);
    const rejected = expect(pending).rejects.toMatchObject({ name: "AbortError" });
    await Promise.resolve();
    controller.abort();
    resolveBody(THEME);
    await rejected;
    expect(digest).not.toHaveBeenCalled();
  });

  it("rejects cancellation while the digest is pending", async () => {
    let resolveDigest!: (value: ArrayBuffer) => void;
    let started!: () => void;
    const hashing = new Promise<void>((resolve) => {
      started = resolve;
    });
    vi.spyOn(globalThis.crypto.subtle, "digest").mockImplementation(() => {
      started();
      return new Promise<ArrayBuffer>((resolve) => {
        resolveDigest = resolve;
      });
    });
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify(THEME)));
    const controller = new AbortController();
    const pending = loadExperienceTheme(manifest(), controller.signal);
    const rejected = expect(pending).rejects.toMatchObject({ name: "AbortError" });
    await hashing;
    controller.abort();
    resolveDigest(Uint8Array.from(Buffer.from(themeHash(), "hex")).buffer);
    await rejected;
  });
});
