import { describe, expect, it } from "vitest";
import type {
  FilmCondition,
  InteractiveFilmRuntimeNode,
  RuntimeAutoExit,
} from "@repo/shared/interactive-film-runtime";
import {
  applyFilmEffects,
  createFilmChoiceTransition,
  createFilmCheckpointTransition,
  createStoryFilmPreviewSession,
  evaluateFilmCondition,
  filmSequenceTimeSeconds,
  filmTimecodeDelayWithinHoldMs,
  localizedFilmText,
  resolveFilmPlaybackLocale,
  resolveFilmRuntimeNode,
  resolveFilmSequenceEndAction,
  selectFilmAutoRoute,
  STORY_CHECKPOINT_CONTINUE_ACTION_ID,
  STORY_CHECKPOINT_RENDERER_ID,
  visibleFilmChoices,
} from "./story-film-runtime";

describe("story film runtime evaluator", () => {
  it("evaluates every condition family without coercing variable types", () => {
    const session = createStoryFilmPreviewSession({
      variables: { truth: 3, finalAction: "release", nullable: null },
      flags: { entered: true },
      relationships: { maya: 2 },
    });
    const condition: FilmCondition = {
      kind: "all",
      conditions: [
        { kind: "flag", flag: "entered", equals: true },
        { kind: "variable", key: "truth", operator: "at_least", value: 3 },
        { kind: "variable", key: "finalAction", operator: "equals", value: "release" },
        { kind: "relationship-at-least", characterId: "maya", value: 2 },
        {
          kind: "not",
          condition: { kind: "variable", key: "nullable", operator: "not_equals", value: null },
        },
      ],
    };

    expect(evaluateFilmCondition(condition, session)).toBe(true);
    expect(
      evaluateFilmCondition(
        { kind: "variable", key: "finalAction", operator: "greater_than", value: 1 },
        session
      )
    ).toBe(false);
    expect(evaluateFilmCondition({ kind: "flag", flag: "missing", equals: false }, session)).toBe(
      true
    );
  });

  it("applies effects immutably and deduplicates set-like session values", () => {
    const initial = createStoryFilmPreviewSession({
      variables: { score: 1, invalidCounter: "text" },
      flags: {},
      relationships: {},
    });
    const next = applyFilmEffects(initial, [
      { kind: "increment_variable", key: "score", amount: 2 },
      { kind: "increment_variable", key: "newScore", amount: 4 },
      { kind: "increment_variable", key: "invalidCounter", amount: 5 },
      { kind: "set_flag", flag: "opened", value: true },
      { kind: "adjust_relationship", characterId: "maya", amount: -1 },
      { kind: "mark_asset_watched", assetId: "clip-01" },
      { kind: "mark_asset_watched", assetId: "clip-01" },
      { kind: "unlock_ending", endingId: "ending-01" },
      { kind: "unlock_ending", endingId: "ending-01" },
    ]);

    expect(next).not.toBe(initial);
    expect(initial.variables).toEqual({ score: 1, invalidCounter: "text" });
    expect(next.variables).toEqual({ score: 3, invalidCounter: "text" });
    expect(next.flags).toEqual({ opened: true });
    expect(next.relationships).toEqual({ maya: -1 });
    expect(next.watchedAssetIds).toEqual(["clip-01"]);
    expect(next.unlockedEndingIds).toEqual(["ending-01"]);
  });

  it("selects the lowest matching priority and preserves author order for ties", () => {
    const session = createStoryFilmPreviewSession({
      variables: { score: 2 },
      flags: {},
      relationships: {},
    });
    const exit: RuntimeAutoExit = {
      kind: "auto",
      routes: [
        { nextNodeId: "fallback", priority: 9 },
        {
          nextNodeId: "first-match",
          priority: 1,
          when: { kind: "variable", key: "score", operator: "at_least", value: 2 },
        },
        { nextNodeId: "same-priority", priority: 1 },
      ],
    };

    expect(selectFilmAutoRoute(exit, session)?.nextNodeId).toBe("first-match");
  });

  it("filters choices against the post-effect session", () => {
    const session = createStoryFilmPreviewSession({ variables: {}, flags: {}, relationships: {} });
    const exit = {
      kind: "choice" as const,
      decisionId: "decision-01",
      prompt: { "en-US": "Choose" },
      trigger: { kind: "media-ended" as const },
      choices: [
        {
          choiceId: "visible",
          label: { "en-US": "Visible" },
          effects: [],
          nextNodeId: "scene-02",
          afterSelect: { kind: "immediate" as const },
        },
        {
          choiceId: "hidden",
          label: { "en-US": "Hidden" },
          visibleWhen: { kind: "flag" as const, flag: "secret", equals: true },
          effects: [],
          nextNodeId: "scene-03",
          afterSelect: { kind: "immediate" as const },
        },
      ],
    };

    expect(visibleFilmChoices(exit, session).map((choice) => choice.choiceId)).toEqual(["visible"]);
  });

  it("carries choice effects through reaction playback", () => {
    const session = createStoryFilmPreviewSession({
      variables: { score: 1 },
      flags: {},
      relationships: {},
    });
    const transition = createFilmChoiceTransition(session, {
      choiceId: "follow",
      label: { "en-US": "Follow" },
      effects: [
        { kind: "increment_variable", key: "score", amount: 2 },
        { kind: "set_flag", flag: "followed", value: true },
      ],
      nextNodeId: "scene-02",
      afterSelect: { kind: "play", reactionAssetId: "reaction-01" },
    });

    expect(transition).toMatchObject({
      nextNodeId: "scene-02",
      reactionAssetId: "reaction-01",
      session: { variables: { score: 3 }, flags: { followed: true } },
    });
    expect(session.variables.score).toBe(1);
  });

  it("resolves only the strict state-preserving built-in checkpoint contract", () => {
    const session = createStoryFilmPreviewSession({
      variables: { score: 1 },
      flags: {},
      relationships: {},
    });
    const exit = {
      kind: "external-overlay" as const,
      rendererId: STORY_CHECKPOINT_RENDERER_ID,
      routes: [
        {
          actionId: STORY_CHECKPOINT_CONTINUE_ACTION_ID,
          effects: [],
          nextNodeId: "epilogue",
        },
      ],
    };

    expect(createFilmCheckpointTransition(session, exit)).toMatchObject({
      nextNodeId: "epilogue",
      session: { variables: { score: 1 } },
    });
    expect(createFilmCheckpointTransition(session, exit)?.session).toBe(session);
    expect(session.variables.score).toBe(1);
    expect(
      createFilmCheckpointTransition(session, { ...exit, rendererId: "vendor.overlay" })
    ).toBeNull();
    expect(
      createFilmCheckpointTransition(session, {
        ...exit,
        routes: [{ actionId: "other", effects: [], nextNodeId: "epilogue" }],
      })
    ).toBeNull();
    expect(
      createFilmCheckpointTransition(session, {
        ...exit,
        routes: [
          {
            actionId: STORY_CHECKPOINT_CONTINUE_ACTION_ID,
            effects: [{ kind: "increment_variable", key: "score", amount: 1 }],
            nextNodeId: "epilogue",
          },
        ],
      })
    ).toBeNull();
    expect(
      createFilmCheckpointTransition(session, {
        ...exit,
        routes: [...exit.routes, { actionId: "other", effects: [], nextNodeId: "alternate" }],
      })
    ).toBeNull();
  });

  it("honours finite holds between sequence clips before advancing", () => {
    const heldClip = {
      clipId: "clip-01",
      assetId: "asset-01",
      endBehavior: { behavior: "hold-last-frame" as const, durationMs: 750 },
    };

    expect(resolveFilmSequenceEndAction(heldClip, 0, 2)).toEqual({
      kind: "hold",
      durationMs: 750,
      sequenceIndex: 1,
    });
    expect(
      resolveFilmSequenceEndAction(
        { ...heldClip, endBehavior: { behavior: "advance" as const } },
        1,
        2
      )
    ).toEqual({ kind: "complete" });
  });

  it("converts per-clip playback time into the authored sequence timecode", () => {
    expect(filmSequenceTimeSeconds([8, 7, 6], 1, 4.5)).toBe(12.5);
    expect(filmSequenceTimeSeconds([8, 7, 6], 2, 1)).toBe(16);
    expect(filmTimecodeDelayWithinHoldMs(8.5, 8, 1_000)).toBe(500);
    expect(filmTimecodeDelayWithinHoldMs(9.5, 8, 1_000)).toBeNull();
  });

  it("resolves conditional router chains and reports cycles", () => {
    const session = createStoryFilmPreviewSession({ variables: {}, flags: {}, relationships: {} });
    const scene = sceneNode("scene-01");
    const routerA: InteractiveFilmRuntimeNode = {
      kind: "router",
      nodeId: "router-a",
      exit: { kind: "auto", routes: [{ nextNodeId: "router-b", priority: 1 }] },
    };
    const routerB: InteractiveFilmRuntimeNode = {
      kind: "router",
      nodeId: "router-b",
      exit: { kind: "auto", routes: [{ nextNodeId: "scene-01", priority: 1 }] },
    };

    expect(
      resolveFilmRuntimeNode({ nodes: [routerA, routerB, scene] }, "router-a", session)
    ).toEqual({
      ok: true,
      node: scene,
      traversedNodeIds: ["router-a", "router-b", "scene-01"],
    });

    const cyclicB: InteractiveFilmRuntimeNode = {
      ...routerB,
      exit: { kind: "auto", routes: [{ nextNodeId: "router-a", priority: 1 }] },
    };
    const cycle = resolveFilmRuntimeNode({ nodes: [routerA, cyclicB] }, "router-a", session);
    expect(cycle).toMatchObject({ ok: false, code: "ROUTER_CYCLE", nodeId: "router-a" });
  });

  it("uses only authored exact, language, or declared-default locale copy", () => {
    const values = { "zh-CN": "中文", "en-US": "English" };
    expect(localizedFilmText(values, "zh-CN", "en-US")).toBe("中文");
    expect(localizedFilmText(values, "fr-FR", "en-US")).toBe("English");
    expect(localizedFilmText({ "zh-HK": "繁體", "en-US": "English" }, "zh-TW", "en-US")).toBe(
      "繁體"
    );
    expect(localizedFilmText({ "zh-HK": "繁體" }, "fr-FR", "en-US")).toBe("");
    expect(resolveFilmPlaybackLocale(["en-US", "zh-HK"], "zh-TW", "en-US")).toBe("zh-HK");
    expect(resolveFilmPlaybackLocale(["en-US", "zh-HK"], "fr-FR", "en-US")).toBe("en-US");
  });
});

function sceneNode(nodeId: string): InteractiveFilmRuntimeNode {
  return {
    nodeId,
    presentation: {
      kind: "video",
      sequence: [
        {
          clipId: `${nodeId}-clip`,
          assetId: `${nodeId}-asset`,
          endBehavior: { behavior: "advance" },
        },
      ],
      fit: "cover",
    },
    overlays: [],
    exit: { kind: "ending", endingId: "ending-01" },
  };
}
