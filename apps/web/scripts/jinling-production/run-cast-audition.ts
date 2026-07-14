/**
 * TEMP: generate 5 main-cast voice-audition samples directly (bypasses the
 * strict shot-production pack schema by calling the runner's exported core
 * functions with hand-built tasks). Delete after voice cards are chosen.
 *
 *   npx tsx scripts/jinling-production/run-cast-audition.ts
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildSeedAudioDescriptor, runSeedAudioProduction } from "./seedaudio-production";
import { loadRunnerEnvironment, resolveSeedAudioProviderConfig } from "./environment";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../../../..");
const WORK_ROOT = path.resolve(REPO_ROOT, "apps/web/tmp/jinling-production");

const delivery = { format: "wav", sampleRateHz: 48000, bitDepth: 24, channels: 1 } as const;

const CAST = [
  {
    short: "daiyu",
    speakerId: "CHAR-DAIYU",
    text: "册中多一人，世间便多一种可能。",
    performance: "轻、短、气息真实、咬字清楚；反问保护边界，禁止甜美偶像腔。",
  },
  {
    short: "jiamu",
    speakerId: "CHAR-JIAMU",
    text: "我的儿，今日才见着你了。",
    performance: "温暖、缓慢、有权威；轻声即可让全室停下。",
  },
  {
    short: "xifeng",
    speakerId: "CHAR-XIFENG",
    text: "旧纸，新印。你这封信，倒会挑日子。",
    performance: "明快、带笑、句子精准；真正危险时降低音量，禁止纯反派腔。",
  },
  {
    short: "wang",
    speakerId: "CHAR-WANG",
    text: "既是客，便守客人的分寸。",
    performance: "平稳、少情绪、信息明确；压力来自秩序而非恶意。",
  },
  {
    short: "baoyu",
    speakerId: "CHAR-BAOYU",
    text: "这个妹妹，我曾见过的。",
    performance: "明亮、自然、想到便说、情绪起伏明显；发怒时仍保留有情。",
  },
  {
    short: "player",
    speakerId: "VOICE-PLAYER-A",
    text: "我也不知道。可每做一个选择，它便多一道纹。",
    performance:
      "成年、音域居中、咬字清楚、克制有礼但不怯懦；画外独白感，禁止现代口语、偶像剧气声与播音腔。",
  },
  {
    short: "gate",
    speakerId: "CHAR-GATE",
    text: "林姑娘的帖子在此。你的凭据呢？",
    performance: "中年男仆、守礼、不卑不亢、平稳；话少而稳。",
  },
  {
    short: "maid",
    speakerId: "CHAR-MAID",
    text: "廊下风紧，姑娘仔细。",
    performance: "青衣仆妇、安静、守礼、不急不缓，无戏剧腔。",
  },
  {
    short: "narrator",
    speakerId: "VOICE-NARRATOR",
    text: "册中有名，便有定数。册中无名，未必无路。",
    performance: "未知女声、近而不露身、克制、略带古意的旁白语气，不煽情不播音腔。",
  },
];

function buildTask(entry: (typeof CAST)[number]) {
  return {
    taskId: `CAST-${entry.short.toUpperCase()}-AUDITION-V1`,
    sceneId: "CAST-AUDITION",
    condition: "always",
    dialogueIds: [],
    speakerId: entry.speakerId,
    provider: "seedaudio",
    task: "voice",
    voiceCardId: `VOICECARD-${entry.short.toUpperCase()}-AUDITION-V1`,
    text: entry.text,
    performance: entry.performance,
    targetDurationSeconds: 6,
    delivery,
    outputPath: `/jinling-rumeng/production/audio/cast-audition/${entry.short}-v1.wav`,
  };
}

async function main(): Promise<void> {
  const environment = await loadRunnerEnvironment(REPO_ROOT);
  const provider = resolveSeedAudioProviderConfig(environment);
  console.log(
    "provider host:",
    new URL(provider.apiBaseUrl).host,
    "| key configured:",
    Boolean(provider.apiKey)
  );

  for (const entry of CAST) {
    const task = buildTask(entry) as never;
    try {
      const descriptor = buildSeedAudioDescriptor(task);
      const result = await runSeedAudioProduction({
        task,
        confirmedFingerprint: descriptor.fingerprint,
        provider,
        workRoot: WORK_ROOT,
      });
      const r = result as Record<string, unknown>;
      console.log(
        `✅ ${entry.speakerId}: staged=${r.alreadyStaged ?? false} out=${r.outputPath ?? r.reviewPath ?? "?"} status=${r.state ?? r.status ?? "?"}`
      );
    } catch (error) {
      console.error(
        `❌ ${entry.speakerId}:`,
        error instanceof Error ? error.message : String(error)
      );
    }
  }
}

void main();
