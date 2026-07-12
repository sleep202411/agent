#!/usr/bin/env -S npx tsx

import { writeFile } from "node:fs/promises";
import path from "node:path";
import { parseJinlingAssetManifest } from "../../src/features/jinling-rumeng/production/asset-manifest";
import {
  JINLING_FILM_CONTINUITY_V3,
  JINLING_FILM_CUT_V2,
} from "../../src/features/jinling-rumeng/production/s01-film-cut-v2";
import { WEB_ROOT } from "./paths";

const ENDPOINT_ID = "ep-20260708234913-w8kjv";
const OUTPUT_PATH = path.join(
  WEB_ROOT,
  "src/features/jinling-rumeng/production/manifests/s01-film-cut-v2.json"
);

const cinematicLanguage = [
  "Create one continuous 15-second premium live-action Chinese period-drama shot in a 16:9 landscape master at 24fps.",
  "The visual standard is a theatrical feature film or prestige short drama: physically motivated camera movement, layered foreground and background blocking, natural skin texture, restrained performance, period-correct late-imperial architecture and costume, practical oil-lamp or daylight sources, controlled contrast, subtle film grain and believable lens depth.",
  "Treat the camera as the original player's first-person position but compose other characters as real scene partners, not talking portrait cards.",
  "Although this is one 15-second production segment, stage it as part of a simulated unbroken long take. Never create an editorial cut inside the segment. Camera momentum, eyelines, performance rhythm and diegetic sound must feel continuous beyond both segment boundaries.",
  "Preserve every referenced character's face, apparent age, hair, costume and proportions exactly across the shot.",
  "Generate production-quality synchronized Mandarin dialogue with accurate speaker-specific lip sync, natural breathing, cloth, footsteps and location ambience. Dialogue must sound performed inside the scene, never like narration pasted over a still image.",
].join(" ");

const hardNegative = [
  "subtitles, captions, title cards, readable generated writing, pseudo-text, logo, watermark or black bars",
  "modern objects, modern haircut, Republican-era costume, fantasy glow, magic particles, game-render look, anime, plastic skin or beauty-filter face",
  "identity drift, face morphing, age drift, costume change, architecture change, duplicate actor, extra limbs, malformed hands or fused props",
  "montage, internal camera cut, jump cut, slideshow, Ken Burns still-image motion, fast zoom, drone shot, violent shake, time lapse or slow motion",
  "flat front lighting, empty background, centered talking-head composition, fashion posing, exaggerated crying, sitcom acting or villain caricature",
  "English speech, duplicated voices, mismatched lip sync, synthetic announcer delivery, background pop music or electronic sound",
];

const manifest = parseJinlingAssetManifest({
  schemaVersion: 1,
  manifestId: "S01-FILM-CUT-V02",
  gameId: "jinling-rumeng",
  releaseId: "season-01-production",
  contentVersion: "2026.07.12.film-cut.4-720p",
  sceneId: "S01-FILM-CUT",
  productionCardId: "S01-FILM-CUT-CARD-V02",
  status: "LOCKED",
  promptVersion: "cinematic-dialogue-continuity-v03",
  authoredAt: "2026-07-12T00:00:00.000Z",
  taskIds: JINLING_FILM_CUT_V2.map((shot) => `TASK-${shot.id}`),
  assets: JINLING_FILM_CUT_V2.map((shot) => {
    const continuity = JINLING_FILM_CONTINUITY_V3[shot.id];
    const referenceIds = shot.references.map((_, index) => `${shot.id}-REF-${index + 1}`);
    const dialogue =
      shot.dialogue.length > 0
        ? `Exact spoken lines, in this order and with no paraphrase:\n${shot.dialogue
            .map((line) => `- ${line}`)
            .join("\n")}`
        : "This authored WAIT plate has no speech. Generate only natural diegetic ambience.";

    const continuityDirection = continuity
      ? continuity.join === "direct"
        ? "The first supplied reference is the exact final frame of the preceding segment. Reproduce it as frame zero without recomposing: identical camera position, lens, crop, subject placement, pose, costume, lighting, exposure and motion direction. Continue the camera move and performance immediately, with no reset, establishing shot or visible cut."
        : "The first supplied reference is the exact final frame of the preceding segment. Preserve its composition at frame zero, then complete the already-motivated foreground occlusion, darkness, door/pillar wipe, or close-object wipe to conceal the stitch before revealing the next dramatic beat. Do not use a dissolve or an editorial cut."
      : "This segment begins a new continuous passage. Establish purposeful camera momentum that can be inherited by the following segment; do not begin like an isolated trailer shot.";
    const branchConvergence = shot.condition.startsWith("choice.C1")
      ? "During the final two seconds, move through the inner gate so a dark wooden door edge fills the lens; end on a stable near-black architectural wipe that every first-choice branch can share."
      : shot.condition.startsWith("choice.C2")
        ? "During the final two seconds, let the practical lantern pass close across the lens and end on its dark metal frame, creating a shared motivated wipe into the family room."
        : shot.condition.startsWith("choice.C3")
          ? "During the final two seconds, a servant's dark sleeve crosses the lens while the room settles; end on a stable fabric occlusion that motivates the later night-time passage."
          : "";

    return {
      assetId: `VIDEO-${shot.id}`,
      taskId: `TASK-${shot.id}`,
      sceneId: "S01-FILM-CUT",
      shotId: shot.id,
      kind: "VIDEO",
      status: "REVIEW",
      purpose: shot.purpose,
      source: {
        strategy: "seedance",
        provider: "byteplus-modelark",
        model: "seedance-2.0",
        endpointId: ENDPOINT_ID,
        mode: "multimodal-to-video",
        enabledEnv: "BYTEPLUS_MODELARK_ENABLED",
        credentialEnv: "BYTEPLUS_MODELARK_API_KEY",
        baseUrlEnv: "BYTEPLUS_MODELARK_API_BASE_URL",
        generationParams: {
          resolution: "720p",
          ratio: "16:9",
          durationSeconds: shot.durationSeconds,
          generateAudio: true,
          watermark: false,
          outputRole: "reference-trial",
        },
      },
      prompt: {
        positive: `${cinematicLanguage}\n\nContinuity direction: ${continuityDirection}${
          branchConvergence ? `\n${branchConvergence}` : ""
        }\n\nShot direction: ${shot.action}\n\n${dialogue}`,
        negative: hardNegative,
        script: shot.timeline,
        referenceAssetIds: referenceIds,
      },
      dependsOn: [],
      references: shot.references.map((reference, index) => ({
        assetId: referenceIds[index],
        path: reference.path,
        role: reference.role,
      })),
      submission: { state: "REFERENCE_TRIAL", blockers: [] },
      delivery: {
        type: "video",
        width: 1280,
        height: 720,
        aspectRatio: "16:9",
        framesPerSecond: { numerator: 24, denominator: 1 },
        frameCount: shot.durationSeconds * 24,
        durationSeconds: { min: shot.durationSeconds, max: shot.durationSeconds },
        container: "mp4",
        videoCodec: "h264",
        audio: true,
      },
      output: {
        publicPath: `/jinling-rumeng/production/story/film-cut-v2/${shot.id.toLowerCase()}.mp4`,
        recordPath: `production/records/film-cut-v2/${shot.id}.json`,
      },
      acceptance: [
        "The shot is a genuinely moving live-action scene, not a still image with camera drift",
        "Every specified Mandarin line is present, naturally performed and synchronized to the correct visible speaker or clearly motivated off-screen source",
        "Referenced actor identity, age, costume and historical environment remain stable",
        "The 1280x720 MP4 contains exactly 360 frames at 24fps and an audio stream",
        "The opening frame and camera momentum match the predecessor tail frame when a continuity dependency is declared",
      ],
      rejection: [
        "Reject silent output, missing or paraphrased dialogue, wrong speaker, weak lip sync, identity drift, deformed anatomy, modern contamination, pseudo-text, flat talking-head staging or slideshow motion",
      ],
    };
  }),
});

async function main(): Promise<void> {
  await writeFile(OUTPUT_PATH, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  process.stdout.write(`${OUTPUT_PATH}\n`);
}

void main();
