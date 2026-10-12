// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { createHash, webcrypto } from "node:crypto";
import theme from "./assets/experience-runtime/themes/core.film-dark.v1.json";
import {
  canonicalizeExperienceJson,
  type ExperienceRuntimeManifest,
} from "@repo/shared/experience-runtime";
import { loadHostedStoryTheme } from "./player";
afterEach(() => vi.unstubAllGlobals());
it("loads the packaged theme under the authenticated shell and preserves integrity validation", async () => {
  history.replaceState(null, "", "/aurora/app-story-agent/ui/index.html");
  const hash = createHash("sha256").update(canonicalizeExperienceJson(theme)).digest("hex");
  const asset = {
    assetId: "theme",
    kind: "data",
    format: "json",
    uri: "/experience-runtime/themes/core.film-dark.v1.json",
    sha256: hash,
  };
  const manifest = {
    theme: { themeId: "core.film-dark.v1", configAssetId: "theme" },
    assets: [asset],
  } as unknown as ExperienceRuntimeManifest;
  const fetcher = vi.fn<typeof fetch>(async () => new Response(JSON.stringify(theme)));
  vi.stubGlobal("fetch", fetcher);
  vi.stubGlobal("crypto", webcrypto);
  await expect(loadHostedStoryTheme(manifest)).resolves.toMatchObject(theme);
  expect(fetcher.mock.calls[0]?.[0]).toBe(
    new URL("./experience-runtime/themes/core.film-dark.v1.json", location.href).href
  );
  asset.sha256 = "0".repeat(64);
  await expect(loadHostedStoryTheme(manifest)).rejects.toThrow("integrity validation");
});
