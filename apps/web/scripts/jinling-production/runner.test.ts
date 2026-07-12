import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import sharp from "sharp";
import { deriveReviewPng } from "./derive-review-image";
import {
  mergeRunnerEnvironment,
  parseEnvFile,
  resolveSeedAudioProviderConfig,
  resolveSeedreamProviderConfig,
} from "./environment";
import { RunnerError } from "./errors";
import { canonicalJson } from "./fingerprint";
import {
  assertImageMimeAndMagic,
  detectImageFormat,
  inspectLocalReferenceImage,
  verifyImageDimensions,
} from "./image-file";
import { journalPath, newJournal, readJournal, writeJournal } from "./journal";
import {
  isReferenceTrialEligible,
  isSeedanceReferenceTrialEligible,
  loadProductionManifest,
  selectSeedanceAsset,
} from "./manifest-loader";
import { DEFAULT_MANIFEST_PATH, REPO_ROOT, WEB_ROOT } from "./paths";
import { assertAllowedProviderOutputUrl, secureDownloadProviderImage } from "./secure-download";
import {
  assertExpectedProviderFormat,
  buildProviderRequest,
  classifyTransportFailure,
  postSeedream,
  providerTimeoutMsFromSeconds,
  safeProviderMessage,
} from "./seedream-reference-trial";
import { __test as seedanceTest, runSeedanceReferenceTrial } from "./seedance-reference-trial";
import {
  __test as seedAudioTest,
  buildSeedAudioDescriptor,
  loadSeedAudioProductionPack,
  runSeedAudioProduction,
  selectSeedAudioTask,
} from "./seedaudio-production";

const SEEDAUDIO_PACK_PATH = path.join(
  WEB_ROOT,
  "src/features/jinling-rumeng/production/manifests/s01-p00-sc01-production-v1.json"
);
const SC02_ENVIRONMENT_MANIFEST_PATH = path.join(
  WEB_ROOT,
  "src/features/jinling-rumeng/production/manifests/s01-sc02-environment-v1.json"
);

test("canonical JSON is stable across object insertion order", () => {
  const first = { z: 3, a: { y: true, x: ["one", "two"] } };
  const second = { a: { x: ["one", "two"], y: true }, z: 3 };
  assert.equal(canonicalJson(first), canonicalJson(second));
});

test("resolves only the official BytePlus Voice host for direct Seed Audio", () => {
  assert.deepEqual(
    resolveSeedAudioProviderConfig({
      SEED_AUDIO_API_KEY: "test-key-never-printed",
      SEED_AUDIO_BASE_URL: "https://voice.ap-southeast-1.bytepluses.com",
    }),
    {
      apiKey: "test-key-never-printed",
      apiBaseUrl: "https://voice.ap-southeast-1.bytepluses.com",
    }
  );
  assert.throws(
    () =>
      resolveSeedAudioProviderConfig({
        SEED_AUDIO_API_KEY: "test-key-never-printed",
        SEED_AUDIO_BASE_URL: "https://example.com",
      }),
    /allowlisted BytePlus Voice/
  );
});

test("builds a reference-audio Seed Audio request without embedding voice bytes in its fingerprint", async () => {
  const pack = await loadSeedAudioProductionPack(SEEDAUDIO_PACK_PATH);
  const task = selectSeedAudioTask(pack, "S01-P00-B02-VO-01-AUDIO-V1");
  const descriptor = buildSeedAudioDescriptor(task, "a".repeat(64));
  assert.equal(descriptor.request.model, "seed-audio-1.0");
  assert.equal(descriptor.request.reference_sha256, "a".repeat(64));
  assert.match(String(descriptor.request.text_prompt), /@Audio1/);
  assert.match(String(descriptor.request.text_prompt), /册中无名，便没有命么？/);
  assert.equal("audio_data" in descriptor.request, false);
});

test("direct Seed Audio runner uses X-Api-Key and stages a 48 kHz 24-bit mono REVIEW master", async () => {
  const pack = await loadSeedAudioProductionPack(SEEDAUDIO_PACK_PATH);
  const task = selectSeedAudioTask(pack, "S01-P00-B02-VO-01-AUDIO-V1");
  const descriptor = buildSeedAudioDescriptor(task);
  const workRoot = await mkdtemp(path.join(os.tmpdir(), "jinling-seedaudio-"));
  const wav = makeStereoPcm16Wav(48_000, 0.25);
  let calls = 0;
  try {
    const result = await runSeedAudioProduction({
      task,
      confirmedFingerprint: descriptor.fingerprint,
      provider: {
        apiKey: "test-key-never-printed",
        apiBaseUrl: "https://voice.ap-southeast-1.bytepluses.com",
      },
      workRoot,
      fetchImpl: async (url, init) => {
        calls += 1;
        assert.equal(url, "https://voice.ap-southeast-1.bytepluses.com/api/v3/tts/create");
        assert.equal(new Headers(init?.headers).get("X-Api-Key"), "test-key-never-printed");
        const request = JSON.parse(String(init?.body)) as Record<string, unknown>;
        assert.equal(request.model, "seed-audio-1.0");
        assert.equal("reference_sha256" in request, false);
        return new Response(
          JSON.stringify({
            audio: wav.toString("base64"),
            duration: 0.25,
            original_duration: 0.25,
            subtitle: {
              text: task.text,
              sentences: [{ start_time: 0, end_time: 200, text: task.text, words: [] }],
            },
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      },
    });
    assert.equal(result.status, "REVIEW");
    assert.equal(result.sampleRateHz, 48_000);
    assert.equal(result.bitDepth, 24);
    assert.equal(result.channels, 1);
    assert.equal(calls, 1);
    await access(result.masterPath);

    const repeated = await runSeedAudioProduction({
      task,
      confirmedFingerprint: descriptor.fingerprint,
      provider: {
        apiKey: "test-key-never-printed",
        apiBaseUrl: "https://voice.ap-southeast-1.bytepluses.com",
      },
      workRoot,
      fetchImpl: async () => {
        calls += 1;
        throw new Error("must not resubmit");
      },
    });
    assert.equal(repeated.alreadyStaged, true);
    assert.equal(calls, 1);
  } finally {
    await rm(workRoot, { recursive: true, force: true });
  }
});

test("Seed Audio response parser requires a non-empty top-level audio payload", () => {
  assert.equal(seedAudioTest.parseProviderResponse('{"audio":"UklGRg=="}').audio, "UklGRg==");
  assert.throws(() => seedAudioTest.parseProviderResponse('{"url":"https://example.test"}'));
});

test("Seed Audio target extraction removes the appended reference segment", () => {
  const extracted = seedAudioTest.extractTargetSubtitle(
    {
      text: "怎么空了一页？册中无名，便没有命吗？",
      sentences: [
        { start_time: 20, end_time: 1_200, text: "怎么空了一页？", words: [] },
        { start_time: 1_500, end_time: 2_700, text: "册中无名，便没有命吗？", words: [] },
      ],
    },
    "怎么空了一页？"
  );
  assert.equal(extracted.subtitle.text, "怎么空了一页？");
  assert.equal(extracted.subtitle.sentences?.length, 1);
  assert.equal(extracted.clipEndSeconds, 1.28);
});

test("builds the reviewed Seedance opening request without random audio or non-raster references", async () => {
  const loaded = await loadProductionManifest(DEFAULT_MANIFEST_PATH, REPO_ROOT);
  const selected = selectSeedanceAsset(loaded, "S01-P00-B02-VIDEO-OPENING");
  assert.equal(isSeedanceReferenceTrialEligible(loaded.manifest.status, selected.asset), true);
  const request = await seedanceTest.buildSeedanceRequest(selected);
  assert.deepEqual(Object.keys(request).sort(), [
    "content",
    "duration",
    "generate_audio",
    "model",
    "ratio",
    "resolution",
    "watermark",
  ]);
  assert.equal(request.model, "ep-20260708234913-w8kjv");
  assert.equal(request.resolution, "1080p");
  assert.equal(request.ratio, "16:9");
  assert.equal(request.duration, 12);
  assert.equal(request.generate_audio, false);
  const content = request.content as Array<Record<string, unknown>>;
  assert.equal(content.length, 2);
  assert.equal(content[0]?.type, "text");
  assert.equal(content[1]?.type, "image_url");
  assert.equal(content[1]?.role, "reference_image");
  const dataUrl = (content[1]?.image_url as { url: string }).url;
  assert.match(dataUrl, /^data:image\/png;base64,/);
});

test("refuses to resubmit an orphaned Seedance submission journal", async () => {
  const loaded = await loadProductionManifest(DEFAULT_MANIFEST_PATH, REPO_ROOT);
  const selected = selectSeedanceAsset(loaded, "S01-P00-B02-VIDEO-OPENING");
  const workRoot = await mkdtemp(path.join(os.tmpdir(), "jinling-seedance-orphan-"));
  const journalPath = path.join(workRoot, "seedance-journal", `${selected.fingerprint}.json`);
  let fetchCalls = 0;
  try {
    await mkdir(path.dirname(journalPath), { recursive: true });
    await writeFile(
      journalPath,
      `${JSON.stringify({
        journalVersion: 1,
        strategy: "seedance-reference-trial",
        assetId: selected.asset.assetId,
        fingerprint: selected.fingerprint,
        manifestSha256: loaded.manifestSha256,
        endpointId: selected.asset.source.endpointId,
        state: "SUBMITTING",
        startedAt: "2026-07-11T00:00:00.000Z",
        updatedAt: "2026-07-11T00:00:00.000Z",
      })}\n`
    );
    await assert.rejects(
      runSeedanceReferenceTrial({
        loaded,
        selected,
        confirmedFingerprint: selected.fingerprint,
        provider: {
          apiKey: "test-key-never-printed",
          apiBaseUrl: "https://ark.ap-southeast.bytepluses.com/api/v3",
        },
        workRoot,
        maxOutputBytes: 32 * 1024 * 1024,
        fetchImpl: async () => {
          fetchCalls += 1;
          throw new Error("must not submit");
        },
      }),
      (error: unknown) => {
        assert.ok(error instanceof RunnerError);
        assert.equal(error.code, "PROVIDER_RESULT_UNKNOWN");
        return true;
      }
    );
    assert.equal(fetchCalls, 0);
    const journal = JSON.parse(await readFile(journalPath, "utf8")) as {
      state: string;
      failure?: { category?: string };
    };
    assert.equal(journal.state, "UNKNOWN");
    assert.equal(journal.failure?.category, "orphaned-submission");
  } finally {
    await rm(workRoot, { recursive: true, force: true });
  }
});

test("environment parser handles quotes without expanding values", () => {
  assert.deepEqual(
    parseEnvFile(`
# ignored
BYTEPLUS_MODELARK_API_KEY='not-printed'
BYTEPLUS_MODELARK_API_BASE_URL="https://ark.ap-southeast.bytepluses.com/api/v3"
PLAIN=value # comment
`),
    {
      BYTEPLUS_MODELARK_API_KEY: "not-printed",
      BYTEPLUS_MODELARK_API_BASE_URL: "https://ark.ap-southeast.bytepluses.com/api/v3",
      PLAIN: "value",
    }
  );
});

test("web media credentials override server defaults while process config remains explicit", () => {
  const merged = mergeRunnerEnvironment(
    {
      BYTEPLUS_MODELARK_API_KEY: "server-key",
      BYTEPLUS_MODELARK_API_BASE_URL: "https://ark.ap-southeast.bytepluses.com/api/v3",
      BYTEPLUS_MODELARK_ENABLED: "true",
    },
    {
      SEEDANCE_API_KEY: "web-key",
      SEEDANCE_BASE_URL: "https://ark.ap-southeast.bytepluses.com",
      SEEDANCE_MODEL: "must-not-be-mapped",
      SEED_AUDIO_API_KEY: "web-audio-key",
      SEED_AUDIO_BASE_URL: "https://voice.ap-southeast-1.bytepluses.com",
    },
    {}
  );
  assert.equal(merged.BYTEPLUS_MODELARK_API_KEY, "web-key");
  assert.equal(merged.BYTEPLUS_MODELARK_API_BASE_URL, "https://ark.ap-southeast.bytepluses.com");
  assert.equal(merged.BYTEPLUS_MODELARK_ENABLED, "true");
  assert.equal(merged.BYTEPLUS_MODELARK_MODEL, undefined);
  assert.equal(merged.SEED_AUDIO_API_KEY, "web-audio-key");
  assert.equal(merged.SEED_AUDIO_BASE_URL, "https://voice.ap-southeast-1.bytepluses.com");

  const overridden = mergeRunnerEnvironment(
    {},
    { SEEDANCE_API_KEY: "web-key" },
    {
      BYTEPLUS_MODELARK_API_KEY: "process-key",
    }
  );
  assert.equal(overridden.BYTEPLUS_MODELARK_API_KEY, "process-key");
});

test("provider diagnostics remove URLs, long tokens, and control characters", () => {
  const diagnostic = safeProviderMessage(
    "InvalidParameter\nsee https://provider.example/private?sig=abc token abcdefghijklmnopqrstuvwxyz0123456789"
  );
  assert.equal(diagnostic, "InvalidParameter see [url] token [token]");
});

function makeStereoPcm16Wav(sampleRate: number, durationSeconds: number): Buffer {
  const channels = 2;
  const bitsPerSample = 16;
  const sampleCount = Math.floor(sampleRate * durationSeconds);
  const dataSize = sampleCount * channels * (bitsPerSample / 8);
  const buffer = Buffer.alloc(44 + dataSize);
  buffer.write("RIFF", 0, "ascii");
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write("WAVE", 8, "ascii");
  buffer.write("fmt ", 12, "ascii");
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(channels, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * channels * (bitsPerSample / 8), 28);
  buffer.writeUInt16LE(channels * (bitsPerSample / 8), 32);
  buffer.writeUInt16LE(bitsPerSample, 34);
  buffer.write("data", 36, "ascii");
  buffer.writeUInt32LE(dataSize, 40);
  return buffer;
}

test("provider timeout policy defaults to 30 minutes and rejects premature settings", () => {
  assert.equal(providerTimeoutMsFromSeconds(undefined), 1_800_000);
  assert.equal(providerTimeoutMsFromSeconds("600"), 600_000);
  assert.equal(providerTimeoutMsFromSeconds("3600"), 3_600_000);
  assert.throws(() => providerTimeoutMsFromSeconds("599"), /600 to 3600/);
  assert.throws(() => providerTimeoutMsFromSeconds("1800.5"), /600 to 3600/);
  assert.throws(() => providerTimeoutMsFromSeconds("3601"), /600 to 3600/);
});

test("synchronous provider request keeps waiting until its configured deadline", async () => {
  const result = await postSeedream(
    {
      apiKey: "test-key-never-printed",
      apiBaseUrl: "https://ark.ap-southeast.bytepluses.com/api/v3",
    },
    { model: "test-endpoint" },
    {
      timeoutMs: 100,
      fetchImpl: async (_input, init) => {
        await delay(20);
        assert.equal(init?.signal?.aborted, false);
        return new Response(JSON.stringify({ data: [] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      },
    }
  );
  assert.equal(result.response.status, 200);
  assert.deepEqual(result.body.data, []);
});

test("provider deadline aborts once, records safe timing, and never retries", async () => {
  let calls = 0;
  await assert.rejects(
    postSeedream(
      {
        apiKey: "test-key-never-printed",
        apiBaseUrl: "https://ark.ap-southeast.bytepluses.com/api/v3",
      },
      { model: "test-endpoint" },
      {
        timeoutMs: 10,
        fetchImpl: async () => {
          calls += 1;
          return new Promise<Response>(() => undefined);
        },
      }
    ),
    (error: unknown) => {
      assert.ok(error instanceof RunnerError);
      assert.equal(error.code, "PROVIDER_RESULT_UNKNOWN");
      assert.equal(error.details?.transportReason, "client-timeout");
      assert.equal(error.details?.configuredTimeoutMs, 10);
      assert.equal(typeof error.details?.elapsedMs, "number");
      return true;
    }
  );
  assert.equal(calls, 1);
});

test("transport diagnostics distinguish remote close and non-JSON gateway response", async () => {
  assert.equal(classifyTransportFailure({ cause: { code: "UND_ERR_SOCKET" } }), "remote-closed");
  assert.equal(
    classifyTransportFailure({ cause: { code: "UND_ERR_HEADERS_TIMEOUT" } }),
    "transport-timeout"
  );

  await assert.rejects(
    postSeedream(
      {
        apiKey: "test-key-never-printed",
        apiBaseUrl: "https://ark.ap-southeast.bytepluses.com/api/v3",
      },
      { model: "test-endpoint" },
      {
        timeoutMs: 100,
        fetchImpl: async () =>
          new Response("gateway timeout", {
            status: 504,
            headers: { "content-type": "text/plain" },
          }),
      }
    ),
    (error: unknown) => {
      assert.ok(error instanceof RunnerError);
      assert.equal(error.details?.transportReason, "non-json-response");
      assert.equal(error.details?.httpStatus, 504);
      assert.equal(JSON.stringify(error.details).includes("gateway timeout"), false);
      return true;
    }
  );
});

test("provider output URL accepts only allowlisted HTTPS hosts", () => {
  assert.equal(
    assertAllowedProviderOutputUrl(
      "https://ark-content-generation-ap-southeast-1.tos-ap-southeast-1.volces.com/output.png?token=x"
    ),
    "https://ark-content-generation-ap-southeast-1.tos-ap-southeast-1.volces.com/output.png?token=x"
  );
  assert.throws(
    () => assertAllowedProviderOutputUrl("http://ark-content.example.com/output.png"),
    /allowlisted BytePlus HTTPS host/
  );
  assert.throws(
    () => assertAllowedProviderOutputUrl("https://volces.com.attacker.example/output.png"),
    /allowlisted BytePlus HTTPS host/
  );
});

test("image magic and explicit MIME must agree", () => {
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  assert.equal(detectImageFormat(png), "png");
  assert.equal(assertImageMimeAndMagic(png, "png", "image/png"), "image/png");
  assert.throws(() => assertImageMimeAndMagic(png, "jpg", "image/png"), /expected jpg/);
  assert.throws(() => assertImageMimeAndMagic(png, "png", "image/jpeg"), /MIME/);
});

test("journal is atomic, sanitized, and can only contain REVIEW result", async () => {
  const workRoot = await mkdtemp(path.join(os.tmpdir(), "jinling-runner-test-"));
  const fingerprint = "a".repeat(64);
  try {
    const journal = newJournal({
      assetId: "S01-P00-TEST-ASSET",
      fingerprint,
      model: "seedream-5-pro",
      endpointId: "dola-seedream-5-0-pro-260628",
      manifest: {
        schemaVersion: 1,
        manifestId: "S01-P00-ASSET-MANIFEST-V01",
        manifestSha256: "b".repeat(64),
        contentVersion: "2026.07.11.1",
        promptVersion: "p00-v01",
      },
      now: "2026-07-11T00:00:00.000Z",
    });
    await writeJournal(workRoot, journal);
    assert.deepEqual(await readJournal(workRoot, fingerprint), journal);
    const raw = await readFile(journalPath(workRoot, fingerprint), "utf8");
    assert.equal(raw.includes("Authorization"), false);
    assert.equal(raw.includes("apiKey"), false);
    assert.equal(raw.includes("signed"), false);

    const unknown = {
      ...journal,
      state: "UNKNOWN" as const,
      failure: {
        category: "result-unknown" as const,
        transportReason: "remote-closed" as const,
        elapsedMs: 62_916,
        configuredTimeoutMs: 1_800_000,
      },
    };
    await writeJournal(workRoot, unknown);
    assert.deepEqual(await readJournal(workRoot, fingerprint), unknown);

    await assert.rejects(
      writeJournal(workRoot, {
        ...journal,
        result: {
          status: "APPROVED",
        } as never,
      }),
      /only use the target REVIEW contract/
    );
  } finally {
    await rm(workRoot, { recursive: true, force: true });
  }
});

test("loads the P00 manifest and plans exact-pixel admitted reference trials", async () => {
  const loaded = await loadProductionManifest(DEFAULT_MANIFEST_PATH, REPO_ROOT);
  assert.equal(loaded.manifest.sceneId, "S01-P00");
  assert.equal(loaded.seedreamAssets.length, 1);
  const wide = loaded.seedreamAssets.find(
    (candidate) => candidate.asset.assetId === "S01-P00-B02-IMG-MATTE-TAIXU-16X9"
  );
  assert.ok(wide);
  assert.equal(wide.descriptor.request.size, "2816x1584");
  assert.equal(wide.descriptor.request.outputFormat, "png");
  assert.equal(wide.descriptor.request.watermark, false);
  assert.deepEqual(wide.descriptor.reviewDerivation, {
    purpose: "review-only",
    method: "lanczos3",
    sourceDimensions: { width: 2816, height: 1584 },
    targetDimensions: { width: 3840, height: 2160 },
  });
  assert.equal(isReferenceTrialEligible(loaded.manifest.status, wide.asset), true);
  assert.match(wide.fingerprint, /^[a-f0-9]{64}$/);
  assert.throws(
    () =>
      resolveSeedreamProviderConfig(wide.asset.source, {
        BYTEPLUS_MODELARK_API_KEY: "configured-but-never-printed",
        BYTEPLUS_MODELARK_ENABLED: "false",
      }),
    /must be explicitly enabled/
  );
  const configured = resolveSeedreamProviderConfig(wide.asset.source, {
    BYTEPLUS_MODELARK_API_KEY: "configured-but-never-printed",
    BYTEPLUS_MODELARK_API_BASE_URL: "https://ark.ap-southeast.bytepluses.com",
    BYTEPLUS_MODELARK_ENABLED: "TRUE",
  });
  assert.equal(configured.apiBaseUrl, "https://ark.ap-southeast.bytepluses.com/api/v3");
});

test("builds the exact Seedream 5 Pro PNG request without Lite-only controls", async () => {
  const loaded = await loadProductionManifest(DEFAULT_MANIFEST_PATH, REPO_ROOT);
  const wide = loaded.seedreamAssets.find(
    (candidate) => candidate.asset.assetId === "S01-P00-B02-IMG-MATTE-TAIXU-16X9"
  );
  assert.ok(wide);

  const request = await buildProviderRequest(wide);
  assert.deepEqual(Object.keys(request).sort(), [
    "image",
    "model",
    "output_format",
    "prompt",
    "response_format",
    "size",
    "watermark",
  ]);
  assert.equal(request.output_format, "png");
  assert.equal("stream" in request, false);
  assert.equal("sequential_image_generation" in request, false);
});

test("builds a Seedream 5 Pro text-to-image request without a fabricated image field", async () => {
  const loaded = await loadProductionManifest(SC02_ENVIRONMENT_MANIFEST_PATH, REPO_ROOT);
  const environment = loaded.seedreamAssets[0];
  assert.ok(environment);
  assert.equal(environment.asset.source.mode, "text-to-image");
  assert.equal(environment.references.length, 0);
  assert.equal(isReferenceTrialEligible(loaded.manifest.status, environment.asset), true);

  const request = await buildProviderRequest(environment);
  assert.equal("image" in request, false);
  assert.equal(request.model, "dola-seedream-5-0-pro-260628");
  assert.equal(request.size, "2816x1584");
  assert.equal(request.output_format, "png");
});

test("rejects an unexpected provider format after identifying the actual magic", () => {
  assert.doesNotThrow(() => assertExpectedProviderFormat("png", "png"));
  assert.doesNotThrow(() => assertExpectedProviderFormat("jpg", "jpeg"));
  assert.throws(
    () => assertExpectedProviderFormat("jpg", "png"),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /expected png, received jpg/);
      return true;
    }
  );
});

test("derivation utility keeps its JPEG input immutable while creating a PNG", async () => {
  const workRoot = await mkdtemp(path.join(os.tmpdir(), "jinling-sharp-test-"));
  const sourcePath = path.join(workRoot, "provider.jpg");
  const derivedPath = path.join(workRoot, "review.png");
  try {
    await sharp({
      create: {
        width: 2,
        height: 1,
        channels: 3,
        background: { r: 121, g: 42, b: 9 },
      },
    })
      .jpeg({ quality: 90 })
      .toFile(sourcePath);
    const source = await inspectLocalReferenceImage(sourcePath, 1_000_000);
    assert.equal(source.format, "jpg");
    const derived = await deriveReviewPng({
      source: { path: sourcePath, ...source },
      destinationPath: derivedPath,
      maxBytes: 1_000_000,
      derivation: {
        purpose: "review-only",
        method: "lanczos3",
        sourceDimensions: { width: 2, height: 1 },
        targetDimensions: { width: 4, height: 2 },
      },
    });
    assert.equal(derived.format, "png");
    assert.equal(detectImageFormat(await readFile(sourcePath)), "jpg");
    assert.equal(detectImageFormat(await readFile(derivedPath)), "png");
    assert.notEqual(derived.sha256, source.sha256);
    const dimensions = await verifyImageDimensions(derivedPath, { width: 4, height: 2 });
    assert.deepEqual([dimensions.width, dimensions.height], [4, 2]);
  } finally {
    await rm(workRoot, { recursive: true, force: true });
  }
});

test("secure downloader revalidates redirects and atomically stores actual magic", async () => {
  const workRoot = await mkdtemp(path.join(os.tmpdir(), "jinling-download-test-"));
  const destinationPath = path.join(workRoot, "provider-source");
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (async () => {
    calls += 1;
    if (calls === 1) {
      return new Response(null, {
        status: 302,
        headers: {
          location:
            "https://ark-content-generation-ap-southeast-1.tos-ap-southeast-1.volces.com/final.png?signature=redacted",
        },
      });
    }
    return new Response(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]), {
      status: 200,
      headers: { "content-type": "image/png", "content-length": "11" },
    });
  }) as typeof fetch;
  try {
    const stored = await secureDownloadProviderImage(
      "https://ark-content-generation-ap-southeast-1.tos-ap-southeast-1.volces.com/redirect",
      { destinationPath, maxBytes: 1024 }
    );
    assert.equal(calls, 2);
    assert.equal(stored.format, "png");
    assert.equal(stored.mimeType, "image/png");
    assert.equal(detectImageFormat(await readFile(destinationPath)), "png");
    await assert.rejects(access(`${destinationPath}.part`));
  } finally {
    globalThis.fetch = originalFetch;
    await rm(workRoot, { recursive: true, force: true });
  }
});
