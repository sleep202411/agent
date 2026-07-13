import assert from "node:assert/strict";
import test from "node:test";
import { parseInteractiveFilmRelease } from "./release-manifest";

type ParsedRelease = ReturnType<typeof parseInteractiveFilmRelease>;

function parsedSceneAt(release: ParsedRelease, index: number) {
  const node = release.nodes[index];
  if (!node || !("presentation" in node)) {
    throw new Error(`Expected runtime scene at index ${index}`);
  }
  return node;
}

function fixture() {
  const sha256 = "a".repeat(64);
  return {
    schemaVersion: 1,
    channel: "preview",
    gameId: "jinling-rumeng",
    releaseId: "season-01-production",
    contentVersion: "2026.07.11.video-first.1",
    entryNodeId: "S01-P00-CREATE",
    defaultLocale: "zh-CN",
    locales: ["en-US", "zh-CN", "zh-HK"],
    media: [
      {
        assetId: "P00-OPENING",
        kind: "video",
        orientationPolicy: "paired-required",
        variants: {
          landscape: {
            sourceAssetId: "SOURCE-OPENING-LANDSCAPE",
            sha256,
            src: "/jinling-rumeng/p00/opening-16x9.mp4",
            width: 1920,
            height: 1080,
            durationSeconds: 8,
            framesPerSecond: { numerator: 24, denominator: 1 },
            codec: "h264",
          },
          portrait: {
            sourceAssetId: "SOURCE-OPENING-PORTRAIT",
            sha256,
            src: "/jinling-rumeng/p00/opening-9x16.mp4",
            width: 1080,
            height: 1920,
            durationSeconds: 8,
            framesPerSecond: { numerator: 24, denominator: 1 },
            codec: "h264",
          },
        },
        audio: "none",
      },
      {
        assetId: "P00-WAIT",
        kind: "video",
        orientationPolicy: "paired-required",
        variants: {
          landscape: {
            sourceAssetId: "SOURCE-WAIT-LANDSCAPE",
            sha256,
            src: "/jinling-rumeng/p00/wait-16x9.mp4",
            width: 1920,
            height: 1080,
            durationSeconds: 6,
            framesPerSecond: { numerator: 24, denominator: 1 },
            codec: "h264",
          },
          portrait: {
            sourceAssetId: "SOURCE-WAIT-PORTRAIT",
            sha256,
            src: "/jinling-rumeng/p00/wait-9x16.mp4",
            width: 1080,
            height: 1920,
            durationSeconds: 6,
            framesPerSecond: { numerator: 24, denominator: 1 },
            codec: "h264",
          },
        },
        audio: "none",
      },
      {
        assetId: "P00-POSTER",
        kind: "image",
        orientationPolicy: "paired-required",
        variants: {
          landscape: {
            sourceAssetId: "SOURCE-POSTER-LANDSCAPE",
            sha256,
            src: "/jinling-rumeng/p00/poster-16x9.png",
            width: 3840,
            height: 2160,
          },
          portrait: {
            sourceAssetId: "SOURCE-POSTER-PORTRAIT",
            sha256,
            src: "/jinling-rumeng/p00/poster-9x16.png",
            width: 2160,
            height: 3840,
          },
        },
      },
    ],
    nodes: [
      {
        nodeId: "S01-P00-CREATE",
        presentation: {
          kind: "video",
          sequence: [
            {
              clipId: "P00-OPENING-CLIP",
              assetId: "P00-OPENING",
              endBehavior: { assetId: "P00-WAIT", behavior: "loop" },
            },
          ],
          posterAssetId: "P00-POSTER",
          fit: "cover",
        },
        overlays: [
          {
            overlayId: "PLAYER-NAME",
            kind: "bound-text",
            binding: "player.displayName",
            landscapeSafeArea: { x: 0.55, y: 0.45, width: 0.3, height: 0.2 },
            portraitSafeArea: { x: 0.15, y: 0.55, width: 0.7, height: 0.18 },
          },
        ],
        exit: {
          kind: "external-overlay",
          rendererId: "jinling-profile-creator",
          routes: [{ actionId: "PROFILE-COMPLETED", effects: [], endingId: "P00-COMPLETE" }],
        },
      },
    ],
  };
}

function setSequenceEndBehavior(
  release: ReturnType<typeof fixture>,
  endBehavior: unknown,
  clipIndex = 0
): void {
  const clip = release.nodes[0]?.presentation.sequence[clipIndex] as
    | { endBehavior: unknown }
    | undefined;
  if (!clip) throw new Error(`Fixture is missing sequence clip ${clipIndex}`);
  clip.endBehavior = endBehavior;
}

function repeatedDecisionFixture() {
  const release = fixture() as ReturnType<typeof fixture> & {
    initialState?: unknown;
  };
  const sceneTemplate = structuredClone(release.nodes[0]) as unknown as {
    nodeId: string;
    exit: unknown;
  };
  const choices = [
    {
      choiceId: "CHOICE-A",
      label: { "en-US": "A", "zh-CN": "甲", "zh-HK": "甲" },
      effects: [],
      nextNodeId: "DECISION-REPEATED",
      afterSelect: { kind: "immediate" },
    },
    {
      choiceId: "CHOICE-B",
      label: { "en-US": "B", "zh-CN": "乙", "zh-HK": "乙" },
      effects: [],
      nextNodeId: "ENDING-B",
      afterSelect: { kind: "immediate" },
    },
  ];
  (release.nodes[0] as unknown as { exit: unknown }).exit = {
    kind: "choice",
    decisionId: "DECISION-SHARED",
    prompt: { "en-US": "Choose", "zh-CN": "选择", "zh-HK": "選擇" },
    trigger: { kind: "media-ended" },
    choices,
  };
  (release.nodes as unknown[]).push(
    {
      ...structuredClone(sceneTemplate),
      nodeId: "DECISION-REPEATED",
      exit: {
        kind: "choice",
        decisionId: "DECISION-SHARED",
        prompt: { "zh-HK": "選擇", "zh-CN": "选择", "en-US": "Choose" },
        trigger: { kind: "media-ended" },
        choices: structuredClone(choices)
          .map((choice) => ({
            ...choice,
            nextNodeId: choice.choiceId === "CHOICE-A" ? "ENDING-A" : "ENDING-B",
          }))
          .reverse(),
      },
    },
    {
      ...structuredClone(sceneTemplate),
      nodeId: "ENDING-A",
      exit: { kind: "ending", endingId: "ENDING-A" },
    },
    {
      ...structuredClone(sceneTemplate),
      nodeId: "ENDING-B",
      exit: { kind: "ending", endingId: "ENDING-B" },
    }
  );
  return release;
}

test("parses a video-first release with independent wide and portrait masters", () => {
  const parsed = parseInteractiveFilmRelease(fixture());
  assert.equal(parsed.entryNodeId, "S01-P00-CREATE");
  assert.equal(parsed.media[0]?.kind, "video");
  assert.equal(parsedSceneAt(parsed, 0).presentation.kind, "video");
  assert.deepEqual(parsed.initialState, { variables: {}, flags: {}, relationships: {} });
  assert.deepEqual(parsed.endings, []);
});

test("parses build-backed media without inventing poster, codec, or frame-rate metadata", () => {
  const release = fixture();
  for (const asset of release.media.slice(0, 2)) {
    for (const variant of Object.values(asset.variants)) {
      const buildBackedVariant = variant as {
        codec?: unknown;
        framesPerSecond?: unknown;
      };
      delete buildBackedVariant.codec;
      delete buildBackedVariant.framesPerSecond;
    }
  }
  delete (release.nodes[0].presentation as { posterAssetId?: unknown }).posterAssetId;

  const parsed = parseInteractiveFilmRelease(release);
  assert.equal(parsedSceneAt(parsed, 0).presentation.kind, "video");
});

test("supports authored initial state, six variable operators, prioritized routes, and routers", () => {
  const release = fixture() as ReturnType<typeof fixture> & {
    initialState: unknown;
    endings: unknown[];
  };
  release.initialState = {
    variables: { truth: 0, finalAction: "unset" },
    flags: { heardWarning: false },
    relationships: { maya: 0 },
  };
  release.endings = [
    {
      endingId: "ENDING-TRUTH",
      title: {
        "en-US": "The whole tape",
        "zh-CN": "完整母带",
        "zh-HK": "完整母帶",
      },
      summary: {
        "en-US": "The complete record survives.",
        "zh-CN": "完整记录被保存。",
        "zh-HK": "完整記錄被保存。",
      },
      kind: "truth",
    },
  ];
  (release.nodes[0] as { exit: unknown }).exit = {
    kind: "auto",
    routes: [
      ["equals", 0],
      ["not_equals", 1],
      ["greater_than", -1],
      ["at_least", 0],
      ["less_than", 1],
      ["at_most", 0],
    ].map(([operator, value], index) => ({
      nextNodeId: "ROUTER-ENDING",
      when: { kind: "variable", key: "truth", operator, value },
      priority: 100 - index,
    })),
  };
  (release.nodes as unknown[]).push(
    {
      kind: "router",
      nodeId: "ROUTER-ENDING",
      exit: {
        kind: "auto",
        routes: [{ nextNodeId: "SCENE-ENDING", priority: 10 }],
      },
    },
    {
      ...release.nodes[0],
      nodeId: "SCENE-ENDING",
      exit: { kind: "ending", endingId: "ENDING-TRUTH" },
    }
  );

  const parsed = parseInteractiveFilmRelease(release);
  assert.deepEqual(parsed.initialState.variables, { truth: 0, finalAction: "unset" });
  const router = parsed.nodes.find((node) => node.nodeId === "ROUTER-ENDING");
  assert.ok(router && "kind" in router && router.kind === "router");
  assert.equal(router.exit.routes[0]?.priority, 10);
  assert.equal(parsed.endings[0]?.title["zh-CN"], "完整母带");
});

test("keeps stable decision metadata and localized prompts in choice exits", () => {
  const release = fixture() as ReturnType<typeof fixture> & { endings: unknown[] };
  release.endings = [
    {
      endingId: "ENDING-A",
      title: { "en-US": "A", "zh-CN": "甲", "zh-HK": "甲" },
      kind: "custom",
    },
    {
      endingId: "ENDING-B",
      title: { "en-US": "B", "zh-CN": "乙", "zh-HK": "乙" },
      kind: "custom",
    },
  ];
  (release.nodes[0] as { exit: unknown }).exit = {
    kind: "choice",
    decisionId: "DECISION-TAPE",
    prompt: {
      "en-US": "Which track should play?",
      "zh-CN": "先播放哪一轨？",
      "zh-HK": "先播放哪一軌？",
    },
    trigger: { kind: "media-ended" },
    choices: [
      {
        choiceId: "CHOICE-A",
        label: { "en-US": "Side A", "zh-CN": "A 面", "zh-HK": "A 面" },
        effects: [],
        nextNodeId: "SCENE-END-A",
        afterSelect: { kind: "immediate" },
      },
      {
        choiceId: "CHOICE-B",
        label: { "en-US": "Side B", "zh-CN": "B 面", "zh-HK": "B 面" },
        effects: [],
        nextNodeId: "SCENE-END-B",
        afterSelect: { kind: "immediate" },
      },
    ],
  };
  (release.nodes as unknown[]).push(
    {
      ...release.nodes[0],
      nodeId: "SCENE-END-A",
      exit: { kind: "ending", endingId: "ENDING-A" },
    },
    {
      ...release.nodes[0],
      nodeId: "SCENE-END-B",
      exit: { kind: "ending", endingId: "ENDING-B" },
    }
  );

  const parsed = parseInteractiveFilmRelease(release);
  const exit = parsed.nodes[0]?.exit;
  assert.equal(exit?.kind, "choice");
  assert.equal(exit?.kind === "choice" ? exit.decisionId : null, "DECISION-TAPE");
  assert.equal(exit?.kind === "choice" ? exit.prompt["zh-CN"] : null, "先播放哪一轨？");
});

test("accepts consistent repeated decisions with predecessor-specific targets", () => {
  const parsed = parseInteractiveFilmRelease(repeatedDecisionFixture());
  const repeated = parsed.nodes.filter((node) => node.exit.kind === "choice");
  assert.equal(repeated.length, 2);
  assert.deepEqual(
    repeated.map((node) => node.exit.kind === "choice" && node.exit.decisionId),
    ["DECISION-SHARED", "DECISION-SHARED"]
  );
});

test("rejects a conflicting copy of a repeated runtime decision", () => {
  const release = repeatedDecisionFixture();
  const repeatedExit = (
    release.nodes[1] as unknown as {
      exit: { choices: Array<{ choiceId: string; label: Record<string, string> }> };
    }
  ).exit;
  const choice = repeatedExit.choices.find((candidate) => candidate.choiceId === "CHOICE-A");
  assert.ok(choice);
  choice.label["zh-CN"] = "冲突选项";

  assert.throws(
    () => parseInteractiveFilmRelease(release),
    /Decision DECISION-SHARED conflicts.*choice CHOICE-A label must match/
  );
});

test("validates runtime variable conditions and effects against their initial types", () => {
  const valid = repeatedDecisionFixture();
  valid.initialState = {
    variables: { score: 0, mode: "idle" },
    flags: {},
    relationships: {},
  };
  for (const node of valid.nodes as unknown as Array<{
    exit: {
      kind: string;
      choices?: Array<{
        choiceId: string;
        visibleWhen?: unknown;
        effects: unknown[];
      }>;
    };
  }>) {
    if (node.exit.kind !== "choice") continue;
    const choice = node.exit.choices?.find((candidate) => candidate.choiceId === "CHOICE-A");
    assert.ok(choice);
    choice.visibleWhen = {
      kind: "variable",
      key: "score",
      operator: "at_least",
      value: 0,
    };
    choice.effects = [{ kind: "set_variable", key: "mode", value: "active" }];
  }
  assert.equal(parseInteractiveFilmRelease(valid).initialState.variables.score, 0);

  const badComparison = structuredClone(valid);
  for (const node of badComparison.nodes as unknown as Array<{
    exit: {
      kind: string;
      choices?: Array<{ choiceId: string; visibleWhen?: { value: unknown } }>;
    };
  }>) {
    if (node.exit.kind !== "choice") continue;
    const choice = node.exit.choices?.find((candidate) => candidate.choiceId === "CHOICE-A");
    if (choice?.visibleWhen) choice.visibleWhen.value = "0";
  }
  assert.throws(
    () => parseInteractiveFilmRelease(badComparison),
    /at_least requires a numeric comparison value/
  );

  const badEffect = structuredClone(valid);
  for (const node of badEffect.nodes as unknown as Array<{
    exit: {
      kind: string;
      choices?: Array<{ choiceId: string; effects: unknown[] }>;
    };
  }>) {
    if (node.exit.kind !== "choice") continue;
    const choice = node.exit.choices?.find((candidate) => candidate.choiceId === "CHOICE-A");
    if (choice) {
      choice.effects = [{ kind: "set_variable", key: "score", value: "one" }];
    }
  }
  assert.throws(
    () => parseInteractiveFilmRelease(badEffect),
    /set_variable value must match runtime variable score/
  );
});

test("rejects a paired asset with a missing portrait master", () => {
  const release = fixture();
  delete (release.media[0].variants as { portrait?: unknown }).portrait;
  assert.throws(
    () => parseInteractiveFilmRelease(release),
    /independent landscape and portrait variants/
  );
});

test("rejects unknown or wrong-kind presentation assets", () => {
  const unknown = fixture();
  unknown.nodes[0].presentation.posterAssetId = "P00-MISSING";
  assert.throws(() => parseInteractiveFilmRelease(unknown), /Unknown media asset P00-MISSING/);

  const wrongKind = fixture();
  wrongKind.nodes[0].presentation.posterAssetId = "P00-WAIT";
  assert.throws(() => parseInteractiveFilmRelease(wrongKind), /must be image, received video/);

  const wrongClipPoster = fixture();
  (
    wrongClipPoster.nodes[0].presentation.sequence[0] as {
      posterAssetId?: string;
    }
  ).posterAssetId = "P00-WAIT";
  assert.throws(
    () => parseInteractiveFilmRelease(wrongClipPoster),
    /must be image, received video/
  );
});

test("rejects unsafe runtime URLs and overlays that escape their authored safe area", () => {
  const unsafe = fixture();
  unsafe.media[0].variants.landscape.src = "blob:temporary-video";
  assert.throws(() => parseInteractiveFilmRelease(unsafe), /root-relative or a permanent HTTPS/);

  const overflow = fixture();
  overflow.nodes[0].overlays[0].portraitSafeArea = {
    x: 0.5,
    y: 0.55,
    width: 0.7,
    height: 0.18,
  };
  assert.throws(() => parseInteractiveFilmRelease(overflow), /remain inside the frame/);
});

test("requires every branch target and reaction asset to resolve", () => {
  const release = fixture();
  (release.nodes[0] as { exit: unknown }).exit = {
    kind: "choice",
    decisionId: "DECISION-MISSING",
    prompt: { "en-US": "Go?", "zh-CN": "前进？", "zh-HK": "前進？" },
    trigger: { kind: "media-ended" },
    choices: [
      {
        choiceId: "Q-A",
        label: { "zh-CN": "向前" },
        effects: [],
        nextNodeId: "MISSING-A",
        afterSelect: { kind: "play", reactionAssetId: "P00-MISSING-REACTION" },
      },
      {
        choiceId: "Q-B",
        label: { "zh-CN": "停下" },
        effects: [],
        nextNodeId: "MISSING-B",
        afterSelect: { kind: "immediate" },
      },
    ],
  };
  assert.throws(
    () => parseInteractiveFilmRelease(release),
    /Unknown target node MISSING-A|Unknown media asset P00-MISSING-REACTION/
  );
});

test("expresses a last-frame hold without inventing a second media asset", () => {
  const release = fixture();
  setSequenceEndBehavior(release, { behavior: "hold-last-frame" });
  const parsed = parseInteractiveFilmRelease(release);
  const presentation = parsedSceneAt(parsed, 0).presentation;
  assert.equal(presentation?.kind, "video");
  assert.deepEqual(presentation?.kind === "video" ? presentation.sequence[0]?.endBehavior : null, {
    behavior: "hold-last-frame",
  });
});

test("supports finite inter-shot holds but rejects indefinite waits before the last clip", () => {
  const release = fixture();
  const presentation = release.nodes[0].presentation;
  (presentation as { sequence: unknown[] }).sequence = [
    {
      clipId: "P00-OPENING-CLIP-A",
      assetId: "P00-OPENING",
      endBehavior: { behavior: "hold-last-frame", durationMs: 750 },
    },
    {
      clipId: "P00-OPENING-CLIP-B",
      assetId: "P00-OPENING",
      endBehavior: { behavior: "hold-last-frame" },
    },
  ];
  assert.equal(parsedSceneAt(parseInteractiveFilmRelease(release), 0).presentation.kind, "video");

  setSequenceEndBehavior(release, { behavior: "hold-last-frame" });
  assert.throws(
    () => parseInteractiveFilmRelease(release),
    /Only the final clip may hold its last frame indefinitely/
  );
});

test("tail loops are final-only and cannot repeat embedded dialogue", () => {
  const release = fixture();
  release.media[0].audio = "embedded";
  setSequenceEndBehavior(release, {
    behavior: "loop-tail",
    tailSeconds: 1.5,
  });
  assert.throws(
    () => parseInteractiveFilmRelease(release),
    /Tail loops require a silent picture asset/
  );
  release.media[0].audio = "none";
  assert.equal(parsedSceneAt(parseInteractiveFilmRelease(release), 0).presentation.kind, "video");
});

test("rejects unreachable nodes and dangling external action targets", () => {
  const unreachable = fixture();
  (unreachable.nodes as unknown[]).push({
    ...unreachable.nodes[0],
    nodeId: "UNREACHABLE-NODE",
    exit: { kind: "ending", endingId: "UNREACHABLE-END" },
  });
  assert.throws(() => parseInteractiveFilmRelease(unreachable), /is unreachable from entry/);

  const dangling = fixture();
  (dangling.nodes[0] as { exit: unknown }).exit = {
    kind: "external-overlay",
    rendererId: "jinling-profile-creator",
    routes: [{ actionId: "PROFILE-COMPLETED", effects: [], nextNodeId: "MISSING-NODE" }],
  };
  assert.throws(() => parseInteractiveFilmRelease(dangling), /Unknown target node MISSING-NODE/);
});

test("resolves a seal overlay only to an immutable SVG runtime asset", () => {
  const release = fixture();
  (release.media as unknown[]).push({
    assetId: "P00-SEAL",
    kind: "data",
    sourceAssetId: "SOURCE-SEAL",
    sha256: "b".repeat(64),
    src: "/jinling-rumeng/p00/seal.svg",
    format: "svg",
  });
  (release.nodes[0].overlays as unknown[]).push({
    overlayId: "PLAYER-SEAL",
    kind: "seal",
    assetId: "P00-SEAL",
    landscapeSafeArea: { x: 0.7, y: 0.7, width: 0.1, height: 0.1 },
    portraitSafeArea: { x: 0.65, y: 0.7, width: 0.15, height: 0.1 },
  });

  assert.equal(parseInteractiveFilmRelease(release).media.at(-1)?.kind, "data");

  const wrongFormat = fixture();
  (wrongFormat.media as unknown[]).push({
    assetId: "P00-SEAL",
    kind: "data",
    sourceAssetId: "SOURCE-SEAL",
    sha256: "b".repeat(64),
    src: "/jinling-rumeng/p00/seal.json",
    format: "json",
  });
  (wrongFormat.nodes[0].overlays as unknown[]).push({
    overlayId: "PLAYER-SEAL",
    kind: "seal",
    assetId: "P00-SEAL",
    landscapeSafeArea: { x: 0.7, y: 0.7, width: 0.1, height: 0.1 },
    portraitSafeArea: { x: 0.65, y: 0.7, width: 0.15, height: 0.1 },
  });
  assert.throws(() => parseInteractiveFilmRelease(wrongFormat), /must be SVG/);
});
