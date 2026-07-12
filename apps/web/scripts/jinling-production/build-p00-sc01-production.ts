#!/usr/bin/env -S npx tsx

import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseJinlingAssetManifest } from "../../src/features/jinling-rumeng/production/asset-manifest";
import {
  parseJinlingDialogueLock,
  type JinlingDialogueLock,
} from "../../src/features/jinling-rumeng/production/dialogue-lock-contract";
import {
  parseJinlingShotProductionPack,
  type JinlingShotProductionPack,
} from "../../src/features/jinling-rumeng/production/shot-production-contract";
import { WEB_ROOT } from "./paths";

const ENDPOINT_ID = "ep-20260708234913-w8kjv";
const DIALOGUE_PATH = path.join(
  WEB_ROOT,
  "src/features/jinling-rumeng/production/manifests/s01-dialogue-lock-v1.json"
);
const PACK_PATH = path.join(
  WEB_ROOT,
  "src/features/jinling-rumeng/production/manifests/s01-p00-sc01-production-v1.json"
);
const SEEDANCE_MANIFEST_PATH = path.join(
  WEB_ROOT,
  "src/features/jinling-rumeng/production/manifests/s01-sc01-seedance-v1.json"
);

async function main(): Promise<void> {
  const dialogueRaw = await readFile(DIALOGUE_PATH);
  const dialogue = parseJinlingDialogueLock(JSON.parse(dialogueRaw.toString("utf8")));
  const dialogueManifestSha256 = createHash("sha256").update(dialogueRaw).digest("hex");
  const lineMap = new Map(dialogue.lines.map((line) => [line.dialogueId, line]));

  const requireLine = (dialogueId: string): JinlingDialogueLock["lines"][number] => {
    const found = lineMap.get(dialogueId);
    if (!found) throw new Error(`Locked dialogue ${dialogueId} is missing`);
    return found;
  };

  const audioTask = (
    dialogueId: string,
    voiceCardId: string
  ): JinlingShotProductionPack["audioTasks"][number] => {
    const locked = requireLine(dialogueId);
    if (locked.audioStrategy !== "seedaudio-vo") {
      throw new Error(`${dialogueId} is not locked for SeedAudio`);
    }
    return {
      taskId: `${dialogueId}-AUDIO-V1`,
      sceneId: locked.sceneId,
      condition: locked.condition,
      dialogueIds: [locked.dialogueId],
      speakerId: locked.speakerId,
      provider: "seedaudio",
      task: "voice",
      voiceCardId,
      text: locked.text,
      performance: locked.performance,
      targetDurationSeconds: locked.targetDurationSeconds,
      delivery: {
        format: "wav",
        sampleRateHz: 48000,
        bitDepth: 24,
        channels: 1,
      },
      outputPath: `/jinling-rumeng/production/audio/${locked.dialogueId.toLowerCase()}-v1.wav`,
    };
  };

  const commonNegative = [
    "baked subtitles, captions, readable pseudo-writing, logos or watermarks",
    "modern objects, fantasy particles, glowing magic, identity drift or costume drift",
    "extra people, extra limbs, malformed anatomy, camera cuts, fast zooms or violent shake",
    "vertical framing, 9:16 crop, portrait composition or key action outside the central landscape frame",
  ];

  const videoTasks: JinlingShotProductionPack["videoTasks"] = [
    {
      taskId: "S01-SC01-B01-VIDEO-MAIN-V2",
      assetId: "S01-SC01-B01-VIDEO-MAIN-CANDIDATE-V2",
      sceneId: "S01-SC01",
      condition: "always",
      dialogueIds: [],
      provider: "seedance-2.0",
      endpointId: ENDPOINT_ID,
      mode: "image-to-video",
      generateAudio: false,
      durationSeconds: 12,
      resolution: "1080p",
      width: 1920,
      height: 1080,
      framesPerSecond: 24,
      frameCount: 288,
      prompt:
        "Create a continuous restrained live-action first-person carriage arrival in late-imperial Jiangnan from this exact recommendation-letter reference. Begin inside a moving wooden carriage with the letter held low in frame, then let the curtain breathe open enough to reveal the Rongguo residence approach and Lin Daiyu's sedan ahead. Preserve the letter, cord, pale-red seal, cold dawn light and physical carriage motion. The player is never shown in third person. Keep the central 16:9 action area clear for subtitles. Produce a silent clean picture plate; no dialogue, music or generated sound.",
      timeline:
        "0.0–3.0s wake into gentle carriage motion with the letter low in frame; 3.0–7.0s curtain movement reveals the approach and distant sedan; 7.0–10.0s carriage slows near the residence; 10.0–12.0s stable natural hold for the choice transition.",
      negative: [
        ...commonNegative,
        "embedded speech, music, sound effects, visible player face, third-person camera or readable letter text",
      ],
      referenceIds: ["S01-SC01-REF-LETTER-COMPOSITION"],
      outputPath: "/jinling-rumeng/production/story/video/sc01-b01-main-16x9-v02.mp4",
      recordPath: "production/records/S01-SC01-B01-VIDEO-MAIN-CANDIDATE-V2.json",
    },
    {
      taskId: "S01-SC01-C01A-VIDEO-REACT-V2",
      assetId: "S01-SC01-C01A-VIDEO-REACT-CANDIDATE-V2",
      sceneId: "S01-SC01",
      condition: "choice.C01-A",
      dialogueIds: [],
      provider: "seedance-2.0",
      endpointId: ENDPOINT_ID,
      mode: "first-last-frame-to-video",
      generateAudio: false,
      durationSeconds: 6,
      resolution: "1080p",
      width: 1920,
      height: 1080,
      framesPerSecond: 24,
      frameCount: 144,
      prompt:
        "Create one continuous restrained live-action first-person camera movement between the exact supplied first and last frames. Begin at the end of the carriage-arrival shot with Lin Daiyu's sedan still centered near the gate. The player deliberately lowers their gaze to inspect the old recommendation letter; the camera tilts down naturally inside the same carriage while it settles with believable weight. End exactly on the supplied letter close-up, where the sedan is no longer visible because the player chose to look away. Preserve carriage curtains, dark wood, cold dawn light, letter geometry, cord and seal. Do not invent readable writing. Silent clean picture plate only.",
      timeline:
        "0.0–1.2s hold the sedan and gate from the exact first frame; 1.2–4.8s one natural continuous downward first-person tilt toward the letter as the carriage settles; 4.8–6.0s arrive exactly at the supplied letter close-up and hold, with no sedan visible.",
      negative: [
        ...commonNegative,
        "readable generated calligraphy, embedded audio, camera cut, cross-dissolve, teleporting objects, returning sedan or melodramatic camera movement",
      ],
      referenceIds: ["S01-SC01-C01A-V2-FIRST", "S01-SC01-C01A-V2-LAST"],
      outputPath: "/jinling-rumeng/production/story/video/sc01-c01a-react-16x9-v02.mp4",
      recordPath: "production/records/S01-SC01-C01A-VIDEO-REACT-CANDIDATE-V2.json",
    },
    {
      taskId: "S01-SC01-C01B-VIDEO-REACT-V1",
      assetId: "S01-SC01-C01B-VIDEO-REACT-CANDIDATE-V1",
      sceneId: "S01-SC01",
      condition: "choice.C01-B",
      dialogueIds: [],
      provider: "seedance-2.0",
      endpointId: ENDPOINT_ID,
      mode: "image-to-video",
      generateAudio: false,
      durationSeconds: 6,
      resolution: "1080p",
      width: 1920,
      height: 1080,
      framesPerSecond: 24,
      frameCount: 144,
      prompt:
        "Continue the exact first-person recommendation-letter close-up as a restrained six-second live-action uncanny reaction. A very faint pale-red fibre pattern becomes perceptible inside the existing seal and then recedes as natural dawn reflection crosses the paper. It must look physically embedded in paper fibres, never like magic, fire, neon or a user interface. Preserve letter geometry, cord, wood, carriage motion and 16:9 composition. Silent clean picture plate only.",
      timeline:
        "0.0–1.8s normal paper and carriage vibration; 1.8–4.2s the pale-red fibre trace quietly emerges under changing natural light; 4.2–6.0s the trace recedes to an unresolved stable hold.",
      negative: [
        ...commonNegative,
        "magic seal, glowing rune, fire, horror effect, readable text or embedded audio",
      ],
      referenceIds: ["S01-SC01-REF-LETTER-COMPOSITION"],
      outputPath: "/jinling-rumeng/production/story/video/sc01-c01b-react-16x9-v01.mp4",
      recordPath: "production/records/S01-SC01-C01B-VIDEO-REACT-CANDIDATE-V1.json",
    },
    {
      taskId: "S01-SC01-C01C-VIDEO-REACT-V1",
      assetId: "S01-SC01-C01C-VIDEO-REACT-CANDIDATE-V1",
      sceneId: "S01-SC01",
      condition: "choice.C01-C",
      dialogueIds: ["S01-SC01-C01C-DY-01"],
      provider: "seedance-2.0",
      endpointId: ENDPOINT_ID,
      mode: "multimodal-to-video",
      generateAudio: true,
      durationSeconds: 6,
      resolution: "1080p",
      width: 1920,
      height: 1080,
      framesPerSecond: 24,
      frameCount: 144,
      prompt:
        "Use the exact Lin Daiyu identity reference and the exact Qinhuai carriage visual reference to create one continuous restrained live-action first-person shot. Lin Daiyu is a young late-imperial Chinese woman in pale blue-white clothing, seen through the partially raised curtain of her sedan. Preserve her face, age, hair, ornaments and clothing exactly. She notices the player, asks softly in natural Mandarin with accurate restrained lip sync: ‘也是来做客的么？’ She is unsure whether the player heard her, and withdraws her gaze immediately after speaking. Generate synchronized quiet carriage ambience, cloth movement, distant horse steps and only that spoken line; no music.",
      timeline:
        "0.0–1.2s curtain and sedan motion establish her glance; 1.2–4.3s Daiyu says ‘也是来做客的么？’ with accurate lip sync; 4.3–6.0s she withdraws her gaze and the curtain settles.",
      negative: [
        ...commonNegative,
        "different face, adult makeup, romantic posing, flirtation, exaggerated smile, duplicated voice, English speech or background music",
      ],
      referenceIds: ["S01-SC01-REF-DAIYU-IDENTITY", "S01-SC01-REF-LETTER-COMPOSITION"],
      outputPath: "/jinling-rumeng/production/story/video/sc01-c01c-daiyu-react-16x9-v01.mp4",
      recordPath: "production/records/S01-SC01-C01C-VIDEO-REACT-CANDIDATE-V1.json",
    },
  ];

  const audioTasks = [
    audioTask("S01-P00-B01-VO-01", "VOICECARD-LEDGER-V1"),
    audioTask("S01-P00-B01-VO-02", "VOICECARD-LEDGER-V1"),
    audioTask("S01-P00-B02-VO-01", "VOICECARD-LEDGER-V1"),
    audioTask("S01-P00-B03-VO-01", "VOICECARD-LEDGER-V1"),
    audioTask("S01-SC01-B01-VO-01", "VOICECARD-DRIVER-V1"),
    audioTask("S01-SC01-C01A-VO-01", "VOICECARD-DRIVER-V1"),
    audioTask("S01-SC01-C01B-VO-01", "VOICECARD-LEDGER-V1"),
    audioTask("S01-SC02-B01-GATE-01", "VOICECARD-GATE-V1"),
    audioTask("S01-SC02-B01-GATE-02", "VOICECARD-GATE-V1"),
    audioTask("S01-SC02-B01-GATE-03", "VOICECARD-GATE-V1"),
    audioTask("S01-SC02-C02A-GATE-01", "VOICECARD-GATE-V1"),
    audioTask("S01-SC02-C02A-MSG-01", "VOICECARD-MESSENGER-V1"),
    audioTask("S01-SC02-C02B-GATE-01", "VOICECARD-GATE-V1"),
    audioTask("S01-SC02-C02B-GATE-02", "VOICECARD-GATE-V1"),
    audioTask("S01-SC02-C02C-GATE-01", "VOICECARD-GATE-V1"),
    audioTask("S01-SC02-C02C-GATE-02", "VOICECARD-GATE-V1"),
    audioTask("S01-SC02-C02C-GATE-03", "VOICECARD-GATE-V1"),
    audioTask("S01-SC02-B02-MSG-01", "VOICECARD-MESSENGER-V1"),
  ];

  const references: JinlingShotProductionPack["references"] = [
    {
      referenceId: "S01-SC01-REF-LETTER-COMPOSITION",
      path: "apps/web/public/jinling-rumeng/preview/story/sc01-letter.png",
      role: "SC01 first-person letter, carriage light and prop continuity reference",
      requiresVirtualPortrait: false,
    },
    {
      referenceId: "S01-SC01-REF-DAIYU-IDENTITY",
      path: "docs/jinling-rumeng/visual/review/CHAR-DAIYU-CAST-A-REF-V02.png",
      role: "Reviewed Lin Daiyu face, age, hair, ornaments and pale blue-white costume identity",
      requiresVirtualPortrait: true,
    },
    {
      referenceId: "S01-SC01-C01A-V2-FIRST",
      path: "docs/jinling-rumeng/visual/review/S01-SC01-C01A-V2-FIRST.png",
      role: "Exact final frame of the approved SC01 main shot; ordered first-frame continuity control",
      requiresVirtualPortrait: false,
    },
    {
      referenceId: "S01-SC01-C01A-V2-LAST",
      path: "docs/jinling-rumeng/visual/review/S01-SC01-C01A-V2-LAST.png",
      role: "Reviewed letter close-up with the sedan absent; ordered last-frame narrative-cost control",
      requiresVirtualPortrait: false,
    },
  ];

  const pack = parseJinlingShotProductionPack({
    schemaVersion: 1,
    productionVersion: "1.0.0",
    dialogueLockVersion: dialogue.lockVersion,
    dialogueManifestSha256,
    status: "LOCKED",
    title: dialogue.title,
    scopeSceneIds: ["S01-P00", "S01-SC01", "S01-SC02"],
    orientation: dialogue.orientation,
    aspectRatio: dialogue.aspectRatio,
    playerVoice: dialogue.playerVoice,
    references,
    existingVisuals: [
      {
        visualId: "S01-P00-B02-VIDEO-OPENING-V1",
        sceneId: "S01-P00",
        path: "/jinling-rumeng/production/p00/video/ledger-opening-16x9-v01.mp4",
        durationSeconds: 12,
        audioEmbedded: false,
        status: "REVIEW",
      },
      {
        visualId: "S01-P00-B03-VIDEO-CONFIRM-V1",
        sceneId: "S01-P00",
        path: "/jinling-rumeng/production/p00/video/ledger-confirm-16x9-v01.mp4",
        durationSeconds: 6,
        audioEmbedded: false,
        status: "REVIEW",
      },
      {
        visualId: "S01-SC01-C01B-VIDEO-REACT-CONTROLLED-V2",
        sceneId: "S01-SC01",
        path: "/jinling-rumeng/production/story/video/sc01-c01b-react-16x9-v02.mp4",
        durationSeconds: 6,
        audioEmbedded: false,
        status: "REVIEW",
      },
      {
        visualId: "S01-SC02-B01-VIDEO-MAIN-V2",
        sceneId: "S01-SC02",
        path: "/jinling-rumeng/production/story/video/sc02-b01-main-16x9-v02.mp4",
        durationSeconds: 12,
        audioEmbedded: false,
        status: "REVIEW",
      },
    ],
    audioTasks,
    videoTasks,
    assemblyNodes: [
      {
        nodeId: "S01-P00-B01-OPENING",
        sceneId: "S01-P00",
        condition: "always",
        cues: [
          {
            cueId: "P00-B01-VISUAL",
            kind: "visual",
            refId: "S01-P00-B02-VIDEO-OPENING-V1",
            trigger: "node-enter",
          },
          {
            cueId: "P00-B01-VO01",
            kind: "audio-task",
            refId: "S01-P00-B01-VO-01-AUDIO-V1",
            trigger: "visual-time",
            startSeconds: 0.8,
          },
          {
            cueId: "P00-B01-VO02",
            kind: "audio-task",
            refId: "S01-P00-B01-VO-02-AUDIO-V1",
            trigger: "visual-time",
            startSeconds: 7.2,
          },
        ],
      },
      {
        nodeId: "S01-P00-B02-PROFILE",
        sceneId: "S01-P00",
        condition: "always",
        cues: [
          {
            cueId: "P00-B02-INTERACTION",
            kind: "interaction",
            refId: "P00-PROFILE-INTERACTION",
            trigger: "node-enter",
          },
          {
            cueId: "P00-B02-VO01",
            kind: "audio-task",
            refId: "S01-P00-B02-VO-01-AUDIO-V1",
            trigger: "profile-ready",
          },
        ],
      },
      {
        nodeId: "S01-P00-B03-CONFIRM",
        sceneId: "S01-P00",
        condition: "profile.confirmed",
        cues: [
          {
            cueId: "P00-B03-VISUAL",
            kind: "visual",
            refId: "S01-P00-B03-VIDEO-CONFIRM-V1",
            trigger: "profile-confirmed",
          },
          {
            cueId: "P00-B03-VO01",
            kind: "audio-task",
            refId: "S01-P00-B03-VO-01-AUDIO-V1",
            trigger: "profile-confirmed",
          },
        ],
      },
      {
        nodeId: "S01-SC01-B01-MAIN",
        sceneId: "S01-SC01",
        condition: "always",
        cues: [
          {
            cueId: "SC01-B01-VISUAL",
            kind: "video-task",
            refId: "S01-SC01-B01-VIDEO-MAIN-V2",
            trigger: "node-enter",
          },
          {
            cueId: "SC01-B01-VO",
            kind: "audio-task",
            refId: "S01-SC01-B01-VO-01-AUDIO-V1",
            trigger: "visual-time",
            startSeconds: 3.2,
          },
        ],
      },
      {
        nodeId: "S01-SC01-C01A-REACT",
        sceneId: "S01-SC01",
        condition: "choice.C01-A",
        cues: [
          {
            cueId: "SC01-C01A-VISUAL",
            kind: "video-task",
            refId: "S01-SC01-C01A-VIDEO-REACT-V2",
            trigger: "node-enter",
          },
          {
            cueId: "SC01-C01A-VO",
            kind: "audio-task",
            refId: "S01-SC01-C01A-VO-01-AUDIO-V1",
            trigger: "visual-time",
            startSeconds: 1.0,
          },
        ],
      },
      {
        nodeId: "S01-SC01-C01B-REACT",
        sceneId: "S01-SC01",
        condition: "choice.C01-B",
        cues: [
          {
            cueId: "SC01-C01B-VISUAL",
            kind: "visual",
            refId: "S01-SC01-C01B-VIDEO-REACT-CONTROLLED-V2",
            trigger: "node-enter",
          },
          {
            cueId: "SC01-C01B-VO",
            kind: "audio-task",
            refId: "S01-SC01-C01B-VO-01-AUDIO-V1",
            trigger: "visual-time",
            startSeconds: 1.0,
          },
        ],
      },
      {
        nodeId: "S01-SC01-C01C-REACT",
        sceneId: "S01-SC01",
        condition: "choice.C01-C",
        cues: [
          {
            cueId: "SC01-C01C-VISUAL",
            kind: "video-task",
            refId: "S01-SC01-C01C-VIDEO-REACT-V1",
            trigger: "node-enter",
          },
        ],
      },
      {
        nodeId: "S01-SC02-B01-MAIN",
        sceneId: "S01-SC02",
        condition: "always",
        cues: [
          {
            cueId: "SC02-B01-VISUAL",
            kind: "visual",
            refId: "S01-SC02-B01-VIDEO-MAIN-V2",
            trigger: "node-enter",
          },
          {
            cueId: "SC02-B01-GATE-01",
            kind: "audio-task",
            refId: "S01-SC02-B01-GATE-01-AUDIO-V1",
            trigger: "visual-time",
            startSeconds: 0.2,
          },
          {
            cueId: "SC02-B01-GATE-02",
            kind: "audio-task",
            refId: "S01-SC02-B01-GATE-02-AUDIO-V1",
            trigger: "visual-time",
            startSeconds: 3.7,
          },
          {
            cueId: "SC02-B01-GATE-03",
            kind: "audio-task",
            refId: "S01-SC02-B01-GATE-03-AUDIO-V1",
            trigger: "visual-time",
            startSeconds: 6.1,
          },
        ],
      },
    ],
  });

  const seedanceManifest = parseJinlingAssetManifest({
    schemaVersion: 1,
    manifestId: "S01-SC01-SEEDANCE-MANIFEST-V1",
    gameId: "jinling-rumeng",
    releaseId: "season-01-production",
    contentVersion: "2026.07.11.sc01-production.1",
    sceneId: "S01-SC01",
    productionCardId: "S01-SC01-PRODUCTION-CARD-V1",
    status: "LOCKED",
    promptVersion: "sc01-locked-dialogue-v1",
    authoredAt: "2026-07-11T00:00:00.000Z",
    taskIds: videoTasks.map((task) => task.taskId),
    assets: videoTasks.map((task) => ({
      assetId: task.assetId,
      taskId: task.taskId,
      sceneId: task.sceneId,
      shotId: task.taskId,
      kind: "VIDEO",
      status: "REVIEW",
      purpose: `Production candidate for ${task.taskId} derived from locked dialogue v1.0.0`,
      source: {
        strategy: "seedance",
        provider: "byteplus-modelark",
        model: "seedance-2.0",
        endpointId: task.endpointId,
        mode: task.mode,
        enabledEnv: "BYTEPLUS_MODELARK_ENABLED",
        credentialEnv: "BYTEPLUS_MODELARK_API_KEY",
        baseUrlEnv: "BYTEPLUS_MODELARK_API_BASE_URL",
        generationParams: {
          resolution: task.resolution,
          ratio: "16:9",
          durationSeconds: task.durationSeconds,
          generateAudio: task.generateAudio,
          watermark: false,
          outputRole: "reference-trial",
        },
      },
      prompt: {
        positive: task.prompt,
        negative: task.negative,
        script: task.timeline,
        referenceAssetIds: task.referenceIds,
      },
      dependsOn: [],
      references: task.referenceIds.map((referenceId) => {
        const reference = references.find((candidate) => candidate.referenceId === referenceId);
        if (!reference) throw new Error(`Missing reference ${referenceId}`);
        return { assetId: reference.referenceId, path: reference.path, role: reference.role };
      }),
      submission: { state: "REFERENCE_TRIAL", blockers: [] },
      delivery: {
        type: "video",
        width: task.width,
        height: task.height,
        aspectRatio: "16:9",
        framesPerSecond: { numerator: task.framesPerSecond, denominator: 1 },
        frameCount: task.frameCount,
        durationSeconds: { min: task.durationSeconds, max: task.durationSeconds },
        container: "mp4",
        videoCodec: "h264",
        audio: task.generateAudio,
      },
      output: { publicPath: task.outputPath, recordPath: task.recordPath },
      acceptance: [
        "The output remains a stable 1920x1080 landscape first-person production candidate",
        task.generateAudio
          ? "The exact locked Mandarin line is present with synchronized natural lip motion"
          : "The output contains no audio stream so locked VO remains independently replaceable",
        "Identity, period objects, lighting and action continuity match every controlled reference",
      ],
      rejection: [
        "Reject identity drift, portrait framing, pseudo-text, modern objects, malformed anatomy or camera cuts",
        task.generateAudio
          ? "Reject missing audio, incorrect wording, duplicated voices, poor lip sync or background music"
          : "Reject any embedded audio stream or generated speech",
      ],
    })),
  });

  await writeFile(PACK_PATH, `${JSON.stringify(pack, null, 2)}\n`, "utf8");
  await writeFile(SEEDANCE_MANIFEST_PATH, `${JSON.stringify(seedanceManifest, null, 2)}\n`, "utf8");

  process.stdout.write(
    `${JSON.stringify(
      {
        ok: true,
        productionPack: path.relative(WEB_ROOT, PACK_PATH),
        seedanceManifest: path.relative(WEB_ROOT, SEEDANCE_MANIFEST_PATH),
        audioTasks: pack.audioTasks.length,
        videoTasks: pack.videoTasks.length,
        assemblyNodes: pack.assemblyNodes.length,
        dialogueManifestSha256,
      },
      null,
      2
    )}\n`
  );
}

void main();
