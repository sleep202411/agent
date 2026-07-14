/**
 * jinling-v2 route-B batch: generate all 26 clips of 21-V2-VIDEO-GENERATION-SPEC.md
 * via Seedance 2.0 omni-reference. Cast faces → asset:// (real-person filter),
 * props/POV → base64, voice cards → reference_audio (timbre lock).
 *
 * Extras clip refs (REF-MAID/REF-XIREN) have no image; they sit mid-list, so the
 * "图N/Image N" numbering is auto-remapped (placeholder pass) with the extra's
 * number dropped — the doc stays human-readable, the prompt stays consistent.
 *
 *   npx tsx scripts/jinling-production/run-v2-batch.ts              # all 26
 *   npx tsx scripts/jinling-production/run-v2-batch.ts p00-ledger-opening   # one
 */
import { readFile, readdir, mkdir, writeFile, access } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { __test } from "./seedance-reference-trial";
import { loadRunnerEnvironment, resolveSeedanceProviderConfig } from "./environment";

const { requestJson } = __test;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../../../..");
const SPEC = path.join(REPO_ROOT, "docs/jinling-rumeng/21-V2-VIDEO-GENERATION-SPEC.md");
const REVIEW = path.join(REPO_ROOT, "apps/web/tmp/jinling-production/seedaudio-review");
const REVIEW_IMG = path.join(REPO_ROOT, "docs/jinling-rumeng/visual/review");
const OUT_DIR = path.join(REPO_ROOT, "apps/web/tmp/jinling-production/v2-clips");
const ENDPOINT = "ep-20260708234913-w8kjv";
const DURATION = 12;
const CONCURRENCY = 3;

const DIRECTOR_PREFIX =
  "真人古装电影质感的《红楼梦》荣国府场景，第一视角亲密感，表演克制，材质光线物理动作可信。荣国府用深木、黛青、月白、旧金；淡红印纹是唯一强色。超自然只通过纸张、水面、灯火、反射和不可能的淡红纹路出现，绝不用粒子魔法、仙侠光效或科幻HUD，绝不生成可读姓名、字幕、判词或信中文字。玩家永不露脸，用同一套锁定的成年画外主角声线。全片16:9横屏1920×1080 24fps一镜到底，无剪切无跳时无突然变焦；末帧达到稳定态。";

const CLIPS = [
  "p00-ledger-opening",
  "s01-gate-arrival",
  "s02-corridor-crisis",
  "s03-jiamu-reunion",
  "s03-xifeng-boundary",
  "s04-baoyu-arrival",
  "s04-jade-throw",
  "s05-daiyu-night-visit",
  "s05-letter-reveal",
  "c1-r01-brocade",
  "c1-r02-old-seal",
  "c1-r03-medicine-pouch",
  "c2-r01-protect-daiyu",
  "c2-r02-steady-lantern",
  "c2-r03-protect-letter",
  "c3-r01-catch-jade",
  "c3-r02-shield-daiyu",
  "c3-r03-call-household",
  "c3-r04-observe-pattern",
  "e01-spring-with-daiyu",
  "e02-name-in-house",
  "e03-memory-shared",
  "e04-future-unwritten",
  "w01-identity-wait",
  "w02-corridor-wait",
  "w03-final-choice-wait",
];

// cast slots → key in v2-cast-assets.json (day/night/home variants share one face)
const CAST_SLOTS: Record<string, string> = {
  "REF-DAIYU": "REF-DAIYU",
  "REF-DAIYU-DAY": "REF-DAIYU",
  "REF-DAIYU-NIGHT": "REF-DAIYU",
  "REF-BAOYU": "REF-BAOYU",
  "REF-BAOYU-HOME": "REF-BAOYU",
  "REF-XIFENG": "REF-XIFENG",
  "REF-JIAMU": "REF-JIAMU",
  "REF-WANG": "REF-WANG",
};
// prop/POV slots → file under visual/review (token aliases collapse to one prop)
const PROP_SLOTS: Record<string, string> = {
  "REF-LEDGER": "PROP-LEDGER-REF-V01.png",
  "REF-LETTER": "PROP-LETTER-REF-V01.png",
  "REF-LANTERN": "PROP-LANTERN-REF-V01.png",
  "REF-JADE": "PROP-JADE-REF-V01.png",
  "REF-TOKEN-WEAVE": "PROP-TOKEN-WEAVE-REF-V01.png",
  "REF-TOKEN-BROCADE": "PROP-TOKEN-WEAVE-REF-V01.png",
  "REF-TOKEN-KIN": "PROP-TOKEN-KIN-REF-V01.png",
  "REF-TOKEN-SEAL": "PROP-TOKEN-KIN-REF-V01.png",
  "REF-TOKEN-MEDIC": "PROP-TOKEN-MEDIC-REF-V01.png",
  "REF-TOKEN-POUCH": "PROP-TOKEN-MEDIC-REF-V01.png",
  "REF-PLAYER-POV": "PLAYER-POV-HAND-GEOMETRY-REF-V01.png",
};
// extras with no image — described by text; their 图N slot is dropped + renumbered
const SKIP_SLOTS = new Set(["REF-MAID", "REF-XIREN"]);
// voice slots → voice-card dir (gate/gatekeeper share one, day/night faces N/A here)
const VOICE_SLOTS: Record<string, string> = {
  "VOICE-DAIYU": "CAST-DAIYU-AUDITION-V1",
  "VOICE-JIAMU": "CAST-JIAMU-AUDITION-V1",
  "VOICE-XIFENG": "CAST-XIFENG-AUDITION-V1",
  "VOICE-WANG": "CAST-WANG-AUDITION-V1",
  "VOICE-BAOYU": "CAST-BAOYU-AUDITION-V1",
  "VOICE-PLAYER-A": "CAST-PLAYER-AUDITION-V1",
  "VOICE-GATE": "CAST-GATE-AUDITION-V1",
  "VOICE-GATEKEEPER": "CAST-GATE-AUDITION-V1",
  "VOICE-MAID": "CAST-MAID-AUDITION-V1",
  "VOICE-NARRATOR": "CAST-NARRATOR-AUDITION-V1",
};

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

function extractClip(spec: string, clipId: string) {
  const start = spec.indexOf("`" + clipId + "`");
  if (start < 0) throw new Error(`clip ${clipId} not found in spec`);
  const next = spec.indexOf("\n## ", start + 1);
  const section = spec.slice(start, next < 0 ? undefined : next);
  const imgLine = /\*\*参考图\*\*：(.+)/.exec(section)?.[1] ?? "";
  const audLine = /\*\*声纹卡\*\*：(.+)/.exec(section)?.[1] ?? "";
  const imageSlots = imgLine
    .split(/[,，]/)
    .map((s) => s.trim())
    .filter(Boolean);
  const audioSlots = audLine
    .split(/[,，]/)
    .map((s) => s.trim())
    .filter((s) => s && !s.includes("无对白") && !s.includes("（无"));
  const blocks = [...section.matchAll(/```text\n([\s\S]*?)```/g)].map((m) => m[1].trim());
  return { positive: blocks[0] ?? "", timeline: blocks[1] ?? "", imageSlots, audioSlots };
}

// Renumber 图N / Image N after dropping skipped (imageless) slots. Placeholder
// pass avoids cascading rewrites; a dropped slot's parenthetical is stripped.
function remapImageRefs(text: string, oldToNew: Map<number, number | null>): string {
  let t = text
    .replace(/Image\s+(\d+)/g, (_, n) => `⟦I${n}⟧`)
    .replace(/图(\d+)/g, (_, n) => `⟦T${n}⟧`);
  for (const [oldN, newN] of oldToNew) {
    const toks = [`⟦I${oldN}⟧`, `⟦T${oldN}⟧`];
    if (newN === null) {
      for (const tok of toks) {
        t = t
          .split(`（${tok}，`)
          .join("（")
          .split(`(${tok},`)
          .join("(")
          .split(`（${tok}）`)
          .join("")
          .split(`(${tok})`)
          .join("")
          .split(tok)
          .join("");
      }
    } else {
      t = t.split(`⟦I${oldN}⟧`).join(`Image ${newN}`).split(`⟦T${oldN}⟧`).join(`图${newN}`);
    }
  }
  return t;
}

async function exists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

type Provider = Awaited<ReturnType<typeof resolveSeedanceProviderConfig>>;

async function runClip(
  spec: string,
  clipId: string,
  castAssets: Record<string, string>,
  provider: Provider
): Promise<{ clipId: string; status: string; out?: string }> {
  const outPath = path.join(OUT_DIR, `${clipId}.mp4`);
  if (await exists(outPath)) return { clipId, status: "skip-exists", out: outPath };

  const { positive, timeline, imageSlots, audioSlots } = extractClip(spec, clipId);

  const resolved: string[] = [];
  const oldToNew = new Map<number, number | null>();
  let newNum = 0;
  for (let i = 0; i < imageSlots.length; i += 1) {
    const slot = imageSlots[i];
    if (SKIP_SLOTS.has(slot)) {
      oldToNew.set(i + 1, null);
      continue;
    }
    if (CAST_SLOTS[slot]) {
      const url = castAssets[CAST_SLOTS[slot]];
      if (!url) throw new Error(`${clipId}: no asset:// for ${slot}`);
      newNum += 1;
      oldToNew.set(i + 1, newNum);
      resolved.push(url);
    } else if (PROP_SLOTS[slot]) {
      const url = await fileToDataUrl(path.join(REVIEW_IMG, PROP_SLOTS[slot]), "image/png");
      newNum += 1;
      oldToNew.set(i + 1, newNum);
      resolved.push(url);
    } else {
      throw new Error(`${clipId}: unknown image slot ${slot}`);
    }
  }

  const p2 = remapImageRefs(positive, oldToNew);
  const t2 = remapImageRefs(timeline, oldToNew);
  const prompt = `${DIRECTOR_PREFIX}\n\n${p2}\n\n分镜节拍：\n${t2}`;

  const content: Array<Record<string, unknown>> = [{ type: "text", text: prompt }];
  for (const url of resolved)
    content.push({ type: "image_url", image_url: { url }, role: "reference_image" });
  for (const slot of audioSlots) {
    const card = VOICE_SLOTS[slot];
    if (!card) throw new Error(`${clipId}: unknown voice slot ${slot}`);
    const wav = await voiceMaster(card);
    content.push({
      type: "audio_url",
      audio_url: { url: await fileToDataUrl(wav, "audio/wav") },
      role: "reference_audio",
    });
  }

  if (process.env.DRY_RUN) {
    console.log(`\n===== ${clipId} (${resolved.length}img, ${audioSlots.length}aud) =====`);
    console.log(p2);
    console.log("--- timeline ---\n" + t2);
    if (/⟦/u.test(prompt)) console.error(`⚠️ ${clipId}: RESIDUAL PLACEHOLDER`);
    return { clipId, status: "dry" };
  }

  const request = {
    model: ENDPOINT,
    content,
    resolution: "1080p",
    ratio: "16:9",
    duration: DURATION,
    generate_audio: true,
    watermark: false,
  };

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
  if (!taskId) throw new Error(`${clipId}: no task id`);
  console.log(`▶ ${clipId}: ${resolved.length}img+${audioSlots.length}aud → ${taskId}`);

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
    if (TERMINAL.has(task.status ?? "")) break;
  }
  if (task.status !== "succeeded") {
    console.error(`✗ ${clipId}: ${task.status} — ${JSON.stringify(task.error ?? {})}`);
    return { clipId, status: task.status ?? "unknown" };
  }
  const videoUrl = task.content?.video_url;
  if (!videoUrl) throw new Error(`${clipId}: no video_url`);
  const resp = await fetch(videoUrl);
  await writeFile(outPath, Buffer.from(await resp.arrayBuffer()));
  console.log(`✓ ${clipId} → ${outPath}`);
  return { clipId, status: "succeeded", out: outPath };
}

async function pool<T, R>(
  items: T[],
  n: number,
  worker: (item: T, i: number) => Promise<R>
): Promise<R[]> {
  const results: R[] = [];
  let idx = 0;
  const runners = Array.from({ length: Math.min(n, items.length) }, async () => {
    while (idx < items.length) {
      const i = idx;
      idx += 1;
      try {
        results[i] = await worker(items[i], i);
      } catch (e) {
        const extra = (e as { details?: unknown }).details;
        const detail = `${e instanceof Error ? e.message : String(e)}${extra ? ` ${JSON.stringify(extra)}` : ""}`;
        console.error(`✗ ${String(items[i])}: ${detail}`);
        results[i] = { clipId: String(items[i]), status: `error: ${detail}` } as R;
      }
    }
  });
  await Promise.all(runners);
  return results;
}

async function main(): Promise<void> {
  const castAssets: Record<string, string> = JSON.parse(
    await readFile(path.join(REPO_ROOT, "docs/jinling-rumeng/v2-cast-assets.json"), "utf8")
  ).assets;
  const spec = await readFile(SPEC, "utf8");
  const env = await loadRunnerEnvironment(REPO_ROOT);
  const source = {
    enabledEnv: "BYTEPLUS_MODELARK_ENABLED",
    credentialEnv: "BYTEPLUS_MODELARK_API_KEY",
    baseUrlEnv: "BYTEPLUS_MODELARK_API_BASE_URL",
  } as never;
  const provider = resolveSeedanceProviderConfig(source, env);
  await mkdir(OUT_DIR, { recursive: true });

  const arg = process.argv[2];
  const list = arg ? [arg] : CLIPS;
  console.log(
    `batch: ${list.length} clip(s), concurrency ${CONCURRENCY}, ${DURATION}s @1080p, host ${new URL(provider.apiBaseUrl).host}`
  );

  const results = await pool(list, CONCURRENCY, (clipId) =>
    runClip(spec, clipId, castAssets, provider)
  );

  console.log("\n=== SUMMARY ===");
  const ok = results.filter((r) => r.status === "succeeded" || r.status === "skip-exists");
  for (const r of results)
    console.log(
      `${r.status === "succeeded" || r.status === "skip-exists" ? "✓" : "✗"} ${r.clipId}: ${r.status}`
    );
  console.log(`\n${ok.length}/${results.length} done. Output: ${OUT_DIR}`);
}

void main();
