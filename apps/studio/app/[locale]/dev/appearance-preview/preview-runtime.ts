import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  canonicalizeExperienceJson,
  ExperienceRuntimeManifestSchema,
} from "@repo/shared/experience-runtime";
import en from "@/messages/en-US.json";
import cn from "@/messages/zh-CN.json";
import hk from "@/messages/zh-HK.json";

const catalogs = {
  "en-US": en.appearancePreview,
  "zh-CN": cn.appearancePreview,
  "zh-HK": hk.appearancePreview,
};
const localized = (get: (catalog: typeof en.appearancePreview) => string) =>
  Object.fromEntries(Object.entries(catalogs).map(([locale, catalog]) => [locale, get(catalog)]));

/** A local still-image story exercises the same runtime as project previews. */
export async function appearancePreviewRuntime() {
  const themeUri = "/experience-runtime/themes/core.film-dark.v1.json";
  const pictureUri = "/story-studio/jinling-rumeng-gate-arrival.jpg";
  const [themeBytes, imageBytes] = await Promise.all([
    readFile(join(process.cwd(), "public", themeUri)),
    readFile(join(process.cwd(), "public", pictureUri)),
  ]);
  const hash = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");
  return ExperienceRuntimeManifestSchema.parse({
    manifestType: "fizzdragon.experience",
    schemaVersion: 2,
    channel: "preview",
    gameId: "appearance.review",
    buildId: "appearance.review.v2",
    contentVersion: "1.0.1",
    completionPolicy: "finite",
    metadata: {
      title: localized((c) => c.project),
      experienceProfile: "cinematic",
    },
    compatibility: {
      engineApiVersion: "2.0.0",
      experienceApiVersion: "1.0.0",
      semanticRulesVersion: 1,
      requiredCapabilities: ["core.video", "core.video.still", "core.choice"],
    },
    localization: { defaultLocale: "en-US", locales: ["en-US", "zh-CN", "zh-HK"] },
    stateDefinitions: [],
    inputActions: [],
    telemetryDefinitions: [],
    rendererRequirements: [
      {
        rendererId: "core.video",
        apiVersion: "1.0.0",
        configSchemaVersion: "1.0.0",
        requiredCapabilities: ["core.video"],
        outcomes: [{ outcomeType: "media-ended" }],
        commands: [],
      },
      {
        rendererId: "core.choice",
        apiVersion: "1.0.0",
        configSchemaVersion: "1.0.0",
        requiredCapabilities: ["core.choice"],
        outcomes: [{ outcomeType: "choice-selected" }],
        commands: [{ commandType: "open" }],
      },
    ],
    assets: [
      {
        assetId: "theme.config",
        sourceAssetId: "theme.source",
        kind: "data",
        sha256: hash(canonicalizeExperienceJson(JSON.parse(themeBytes.toString()))),
        uri: themeUri,
        mediaType: "application/json",
        format: "json",
      },
      {
        assetId: "scene.picture",
        // core.video.still uses a video slot carrying an image variant.
        kind: "video",
        orientationPolicy: "single-master",
        variants: [
          {
            variantId: "scene.landscape",
            sourceAssetId: "scene.source",
            sha256: hash(imageBytes),
            uri: pictureUri,
            mediaType: "image/jpeg",
            orientation: "landscape",
            width: 1600,
            height: 900,
          },
        ],
      },
    ],
    theme: { themeId: "film.dark", apiVersion: "1.0.0", configAssetId: "theme.config" },
    endings: [{ endingId: "ending.choice", title: localized((c) => c.project), kind: "success" }],
    graph: {
      entrySceneId: "scene.arrival",
      nodes: [
        {
          kind: "scene",
          sceneId: "scene.arrival",
          clock: { kind: "none" },
          renderers: [
            {
              instanceId: "film",
              rendererId: "core.video",
              layer: 0,
              config: {
                fit: "contain",
                sequence: [
                  {
                    clipId: "arrival",
                    assetId: "scene.picture",
                    endBehavior: { behavior: "hold-last-frame", durationMs: 100000 },
                  },
                ],
                autoplay: true,
              },
              bindings: {},
            },
            {
              instanceId: "choices",
              rendererId: "core.choice",
              layer: 100,
              config: {
                decisionId: "arrival.choice",
                prompt: localized((c) => c.question),
                choices: [0, 1].map((index) => ({
                  choiceId: `choice.${index}`,
                  label: localized((c) => c.options[String(index) as "0" | "1"]),
                })),
                initiallyOpen: true,
              },
              bindings: {},
            },
          ],
          anchors: [],
          gestures: [],
          timeline: { cues: [] },
          eventBindings: [
            {
              bindingId: "choice.finish",
              on: { type: "renderer.outcome", sourceId: "choices", qualifierId: "choice-selected" },
              routes: [
                {
                  routeId: "finish",
                  actions: [{ kind: "ending.complete", endingId: "ending.choice" }],
                },
              ],
            },
          ],
        },
      ],
    },
  });
}
