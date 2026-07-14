/**
 * TEMP: jinling-v2 route-B validation clips — Seedance 2.0 omni-reference with
 * reference_image (character/prop refs as base64 data URLs, no asset:// needed
 * on the no-prefilter endpoint) AND reference_audio (the chosen voice cards,
 * which v1's seedance-reference-trial never sent — the cause of "说日语").
 * Direct call, bypasses the strict production manifest. Delete after validation.
 *
 *   npx tsx scripts/jinling-production/run-validation-clips.ts s05-letter-reveal
 */
import { readFile, readdir, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { __test } from "./seedance-reference-trial";
import { loadRunnerEnvironment, resolveSeedanceProviderConfig } from "./environment";

const { requestJson } = __test;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../../../..");
const SPEC = path.join(REPO_ROOT, "docs/jinling-rumeng/21-V2-VIDEO-GENERATION-SPEC.md");
const REVIEW = path.join(REPO_ROOT, "apps/web/tmp/jinling-production/seedaudio-review");
const OUT_DIR = path.join(REPO_ROOT, "apps/web/tmp/jinling-production/validation-clips");
const DOWNLOADS = path.join(os.homedir(), "Downloads");
const REVIEW_IMG = path.join(REPO_ROOT, "docs/jinling-rumeng/visual/review");
const ENDPOINT = "ep-20260708234913-w8kjv"; // no-prefilter access point (same as hu-bao-villa)

const DIRECTOR_PREFIX =
  "真人古装电影质感的《红楼梦》荣国府场景，第一视角亲密感，表演克制，材质光线物理动作可信。荣国府用深木、黛青、月白、旧金；淡红印纹是唯一强色。超自然只通过纸张、水面、灯火、反射和不可能的淡红纹路出现，绝不用粒子魔法、仙侠光效或科幻HUD，绝不生成可读姓名、字幕、判词或信中文字。玩家永不露脸，用同一套锁定的成年画外主角声线。全片16:9横屏1920×1080 24fps一镜到底，无剪切无跳时无突然变焦；末帧达到稳定态。";

// clipId → cast (registered asset:// face refs) + props (base64 data-url,
// non-real-person) + audios (voice cards). Real faces MUST be asset:// (the
// real-person pre-filter rejects base64 faces); props/POV can go inline.
const CLIP_REFS: Record<string, { cast: string[]; props: string[]; audios: string[] }> = {
  "s05-letter-reveal": {
    cast: ["REF-DAIYU"],
    props: [
      path.join(REVIEW_IMG, "PROP-LETTER-REF-V01.png"),
      path.join(REVIEW_IMG, "PLAYER-POV-HAND-GEOMETRY-REF-V01.png"),
    ],
    audios: ["CAST-DAIYU-AUDITION-V1"],
  },
  "s03-xifeng-boundary": {
    cast: ["REF-XIFENG", "REF-WANG", "REF-DAIYU"],
    props: [
      path.join(REVIEW_IMG, "PROP-LETTER-REF-V01.png"),
      path.join(REVIEW_IMG, "PLAYER-POV-HAND-GEOMETRY-REF-V01.png"),
    ],
    audios: ["CAST-XIFENG-AUDITION-V1", "CAST-WANG-AUDITION-V1"],
  },
};

// CAST_ASSETS is loaded inside main() — no top-level await under cjs output.

async function fileToDataUrl(filePath: string, mime: string): Promise<string> {
  const buf = await readFile(filePath);
  return `data:${mime};base64,${buf.toString("base64")}`;
}

async function voiceMaster(cardDir: string): Promise<string> {
  const dir = path.join(REVIEW, cardDir);
  const files = await readdir(dir);
  const master = files.find((f) => f.endsWith("-master.wav"));
  if (!master) throw new Error(`no master.wav in ${dir}`);
  return path.join(dir, master);
}

function extractPrompt(spec: string, clipId: string): { positive: string; timeline: string } {
  const start = spec.indexOf("`" + clipId + "`");
  if (start < 0) throw new Error(`clip ${clipId} not found in spec`);
  const next = spec.indexOf("\n## ", start);
  const section = spec.slice(start, next < 0 ? undefined : next);
  const blocks = [...section.matchAll(/```text\n([\s\S]*?)```/g)].map((m) => m[1].trim());
  // order in doc: [0]=positive prompt, [1]=宽节拍时间线, [2]=精确时间码
  return { positive: blocks[0] ?? "", timeline: blocks[1] ?? "" };
}

async function main(): Promise<void> {
  const clipId = process.argv[2] ?? "s05-letter-reveal";
  const refs = CLIP_REFS[clipId];
  if (!refs) throw new Error(`no ref map for ${clipId}`);
  const CAST_ASSETS: Record<string, string> = JSON.parse(
    await readFile(path.join(REPO_ROOT, "docs/jinling-rumeng/v2-cast-assets.json"), "utf8")
  ).assets;
  const spec = await readFile(SPEC, "utf8");
  const { positive, timeline } = extractPrompt(spec, clipId);
  const prompt = `${DIRECTOR_PREFIX}\n\n${positive}\n\n分镜节拍：\n${timeline}`;

  const env = await loadRunnerEnvironment(REPO_ROOT);
  const source = {
    enabledEnv: "BYTEPLUS_MODELARK_ENABLED",
    credentialEnv: "BYTEPLUS_MODELARK_API_KEY",
    baseUrlEnv: "BYTEPLUS_MODELARK_API_BASE_URL",
  } as never;
  const provider = resolveSeedanceProviderConfig(source, env);
  console.log(
    "clip:",
    clipId,
    "| host:",
    new URL(provider.apiBaseUrl).host,
    "| key:",
    Boolean(provider.apiKey)
  );

  const content: Array<Record<string, unknown>> = [{ type: "text", text: prompt }];
  for (const ref of refs.cast) {
    const asset = CAST_ASSETS[ref];
    if (!asset) throw new Error(`no registered asset:// for ${ref}`);
    content.push({ type: "image_url", image_url: { url: asset }, role: "reference_image" });
  }
  for (const p of refs.props) {
    const mime = p.toLowerCase().endsWith(".png") ? "image/png" : "image/jpeg";
    content.push({
      type: "image_url",
      image_url: { url: await fileToDataUrl(p, mime) },
      role: "reference_image",
    });
  }
  for (const card of refs.audios) {
    const wav = await voiceMaster(card);
    content.push({
      type: "audio_url",
      audio_url: { url: await fileToDataUrl(wav, "audio/wav") },
      role: "reference_audio",
    });
  }
  console.log(
    `refs: ${refs.cast.length} cast asset:// + ${refs.props.length} prop base64 + ${refs.audios.length} reference_audio`
  );

  const request = {
    model: ENDPOINT,
    content,
    resolution: "1080p",
    ratio: "16:9",
    duration: 12,
    generate_audio: true,
    watermark: false,
  };

  console.log("submitting…");
  const created = await requestJson<{ id?: string }>(
    fetch,
    provider,
    "/contents/generations/tasks",
    {
      method: "POST",
      body: JSON.stringify(request),
    }
  );
  const taskId = created.id;
  if (!taskId) throw new Error("no task id returned");
  console.log("task:", taskId, "— polling…");

  const TERMINAL = new Set(["succeeded", "failed", "cancelled", "expired"]);
  let task: { status?: string; content?: { video_url?: string }; error?: { message?: string } } =
    {};
  const started = Date.now();
  while (Date.now() - started < 900_000) {
    await new Promise((r) => setTimeout(r, 8000));
    task = await requestJson(
      fetch,
      provider,
      `/contents/generations/tasks/${encodeURIComponent(taskId)}`,
      { method: "GET" }
    );
    process.stdout.write(`  ${task.status}\r`);
    if (TERMINAL.has(task.status ?? "")) break;
  }
  console.log("\nfinal status:", task.status);
  if (task.status !== "succeeded") {
    console.error("FAILED:", JSON.stringify(task.error ?? task));
    process.exit(1);
  }
  const videoUrl = task.content?.video_url;
  if (!videoUrl) throw new Error("no video_url");
  await mkdir(OUT_DIR, { recursive: true });
  const outPath = path.join(OUT_DIR, `${clipId}.mp4`);
  const resp = await fetch(videoUrl);
  await writeFile(outPath, Buffer.from(await resp.arrayBuffer()));
  console.log("✅ saved:", outPath);
}

void main();
