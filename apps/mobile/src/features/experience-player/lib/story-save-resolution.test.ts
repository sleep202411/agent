import { beforeEach, expect, it, vi } from "vitest";
import { parseExperienceRuntimeManifest } from "@repo/shared/experience-runtime";
import { EXPERIENCE_ENGINE_API_VERSION, EXPERIENCE_API_VERSION } from "@repo/experience-engine";
import { createExperienceRuntime } from "./experience-runtime-host";
import { resolveStorySave, clearStorySaveSlots } from "./story-save-resolution";
import { getStorySaveChannel } from "./story-save-channel";
import { ApiRequestError } from "@/lib/api-client";
const h = vi.hoisted(() => ({ generation: 0, get: vi.fn(), put: vi.fn(), delete: vi.fn() }));
vi.mock("@/auth/auth-store", () => ({ getAuthGeneration: () => h.generation }));
vi.mock("@/lib/api-client", () => ({
  api: h,
  ApiRequestError: class extends Error {
    constructor(
      public code: string,
      message: string,
      public status: number
    ) {
      super(message);
    }
  },
}));
const HASH = "a".repeat(64);
const localized = (value: string) => ({ "en-US": value });
function manifestFixture() {
  return parseExperienceRuntimeManifest({
    manifestType: "fizzdragon.experience",
    schemaVersion: 2,
    channel: "preview",
    gameId: "core.text.test",
    buildId: "core.text.build.1",
    contentVersion: "1.0.0",
    completionPolicy: "finite",
    metadata: {
      title: localized("A text experience"),
    },
    compatibility: {
      engineApiVersion: EXPERIENCE_ENGINE_API_VERSION,
      experienceApiVersion: EXPERIENCE_API_VERSION,
      semanticRulesVersion: 1,
      requiredCapabilities: ["core.text"],
    },
    localization: { defaultLocale: "en-US", locales: ["en-US"] },
    rendererRequirements: [
      {
        rendererId: "core.text",
        apiVersion: "1.0.0",
        configSchemaVersion: "1.0.0",
        requiredCapabilities: ["core.text"],
        outcomes: [{ outcomeType: "text-completed" }],
        commands: [],
      },
    ],
    assets: [
      {
        assetId: "theme.config",
        sourceAssetId: "theme.config.source",
        kind: "data",
        sha256: HASH,
        uri: "/theme.json",
        mediaType: "application/json",
        format: "json",
      },
    ],
    theme: { themeId: "theme.test", apiVersion: "1.0.0", configAssetId: "theme.config" },
    endings: [
      {
        endingId: "ending.done",
        title: localized("Done"),
        kind: "success",
      },
    ],
    graph: {
      entrySceneId: "scene.text",
      nodes: [
        {
          kind: "scene",
          sceneId: "scene.text",
          renderers: [
            {
              instanceId: "text.primary",
              rendererId: "core.text",
              layer: 0,
              config: {
                title: localized("Chapter one"),
                body: localized("The story begins."),
                completion: "continue",
              },
            },
          ],
          eventBindings: [
            {
              bindingId: "text.complete",
              on: {
                type: "renderer.outcome",
                sourceId: "text.primary",
                qualifierId: "text-completed",
              },
              routes: [
                {
                  routeId: "finish",
                  actions: [{ kind: "ending.complete", endingId: "ending.done" }],
                },
              ],
            },
          ],
        },
      ],
    },
  });
}

const runtime = manifestFixture();
const state = createExperienceRuntime(runtime, { randomSeed: "saved" }).start().state;
const saved = {
  gameId: runtime.gameId,
  chapterId: "one",
  contentVersion: runtime.contentVersion,
  state: { ...state },
  events: [],
  revision: 3,
  updatedAt: "2026-10-05T00:00:00Z",
};
const input = {
  accountId: "account",
  runtime,
  chapterId: "one",
  availableChapterIds: ["one", "two"],
  explicitChapter: false,
};
beforeEach(() => {
  h.generation++;
  h.get
    .mockReset()
    .mockImplementation(async (path: string) =>
      path.endsWith("/latest") ? saved : { save: saved, revision: 3 }
    );
  h.put.mockReset();
  h.delete.mockReset().mockImplementation(async (_path, config) => ({
    cleared: true,
    revision: config.params.expectedRevision + 1,
  }));
});
it("keeps anonymous playback local without reading or clearing server saves", async () => {
  expect(await resolveStorySave({ ...input, accountId: null })).toEqual({
    phase: "ready",
    checkpoint: null,
  });
  expect(h.get).not.toHaveBeenCalled();
  expect(h.delete).not.toHaveBeenCalled();
});
it("explicit chapter wins over the latest pointer and validates actual engine state", async () => {
  const result = await resolveStorySave({ ...input, explicitChapter: true });
  expect(result).toEqual({ phase: "ready", checkpoint: { state, events: [] } });
  expect(h.get).toHaveBeenCalledTimes(1);
  expect(h.get.mock.calls[0]![0]).toContain("/save");
});
it("follows a latest chapter that still exists without mounting the wrong runtime", async () => {
  h.get.mockResolvedValueOnce({ ...saved, chapterId: "two" });
  expect(await resolveStorySave(input)).toEqual({ phase: "redirecting", chapterId: "two" });
  expect(h.get).toHaveBeenCalledTimes(1);
});
it("preserves a save whose chapter was removed instead of silently starting", async () => {
  h.get.mockResolvedValueOnce({ ...saved, chapterId: "removed" });
  expect(await resolveStorySave(input)).toEqual({
    phase: "incompatible",
    savedChapterId: "removed",
    reason: "chapter",
  });
  expect(h.delete).not.toHaveBeenCalled();
});
it("reads the full matching slot and accepts compatible republished content", async () => {
  h.get.mockResolvedValueOnce({ ...saved, state: { currentSceneId: "pointer-only" } });
  expect(
    await resolveStorySave({ ...input, runtime: { ...runtime, contentVersion: "new-build" } })
  ).toEqual({ phase: "ready", checkpoint: { state, events: [] } });
  expect(h.get).toHaveBeenCalledTimes(2);
});
it("reads a tombstone revision even when the latest pointer is empty", async () => {
  h.get.mockResolvedValueOnce(null).mockResolvedValueOnce({ save: null, revision: 8 });
  expect(await resolveStorySave(input)).toEqual({ phase: "ready", checkpoint: null });
  expect(getStorySaveChannel("account", runtime.gameId, "one").getRevision()).toBe(8);
});
it("does not convert an unavailable save read into a new run", async () => {
  h.get.mockRejectedValueOnce(new Error("Service unavailable"));
  await expect(resolveStorySave(input)).rejects.toThrow("Service unavailable");
});
it("preserves incompatible saved state for explicit restart", async () => {
  h.get.mockResolvedValueOnce({
    save: { ...saved, state: { ...state, currentSceneId: "removed" } },
    revision: 3,
  });
  expect(await resolveStorySave({ ...input, explicitChapter: true })).toEqual({
    phase: "incompatible",
    savedChapterId: "one",
    reason: "state",
  });
  expect(h.delete).not.toHaveBeenCalled();
});
it("restores newer same-session pending events after checking the server revision", async () => {
  const channel = getStorySaveChannel("account", runtime.gameId, "one");
  await channel.read();
  channel.replace({ ...saved, events: [{ type: "pending.event" }] });
  expect(await resolveStorySave({ ...input, explicitChapter: true })).toMatchObject({
    phase: "ready",
    checkpoint: { events: [{ type: "pending.event" }] },
  });
});
it("requires explicit reload when another device changed pending progress", async () => {
  const channel = getStorySaveChannel("account", runtime.gameId, "one");
  await channel.read();
  channel.replace(saved);
  h.get.mockResolvedValue({ save: { ...saved, revision: 4 }, revision: 4 });
  await expect(resolveStorySave({ ...input, explicitChapter: true })).rejects.toBeInstanceOf(
    ApiRequestError
  );
  expect(channel.getPending()).not.toBeNull();
  expect(await resolveStorySave({ ...input, explicitChapter: true, reload: true })).toMatchObject({
    phase: "ready",
  });
  expect(channel.getPending()).toBeNull();
});
it("clears duplicate restart slots once with the read revision", async () => {
  await clearStorySaveSlots({
    accountId: "account",
    gameId: runtime.gameId,
    chapterIds: ["one", "one"],
  });
  expect(h.delete).toHaveBeenCalledTimes(1);
  expect(h.delete.mock.calls[0]![1].params).toEqual({ chapterId: "one", expectedRevision: 3 });
});
it("rejects a late read after logout without continuing into another slot", async () => {
  h.get.mockImplementationOnce(async () => {
    h.generation++;
    return { save: saved, revision: 3 };
  });
  await expect(
    clearStorySaveSlots({
      accountId: "account",
      gameId: runtime.gameId,
      chapterIds: ["one", "two"],
    })
  ).rejects.toHaveProperty("name", "AbortError");
  expect(h.get).toHaveBeenCalledTimes(1);
  expect(h.delete).not.toHaveBeenCalled();
});
it("retains pending state when conditional restart fails", async () => {
  const channel = getStorySaveChannel("account", runtime.gameId, "one");
  await channel.read();
  channel.replace(saved);
  h.delete.mockRejectedValueOnce(new Error("Offline"));
  await expect(
    clearStorySaveSlots({ accountId: "account", gameId: runtime.gameId, chapterIds: ["one"] })
  ).rejects.toThrow("Offline");
  expect(channel.getPending()).toEqual(saved);
});
it("does no work after route cancellation", async () => {
  const controller = new AbortController();
  controller.abort();
  await expect(resolveStorySave({ ...input, signal: controller.signal })).rejects.toHaveProperty(
    "name",
    "AbortError"
  );
  expect(h.get).not.toHaveBeenCalled();
});
