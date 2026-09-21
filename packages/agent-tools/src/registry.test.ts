import { describe, expect, it } from "vitest";
import { STORY_VISUAL_STYLE_SKILL_SLUGS } from "@repo/shared";

import { buildToolIdempotencyKey } from "./idempotency.js";
import {
  getTool,
  parseToolInput,
  parseToolOutput,
  riskForTool,
  toolDescriptorsForModel,
} from "./registry.js";

const QUESTION_TURN_COPY = {
  leadIn: "I need two quick choices before I continue.",
  resumeAcknowledgement: "Thanks — I have your choices and will continue.",
} as const;

describe("agent-tools registry", () => {
  it("registers golden-path tools", () => {
    expect(getTool("script.readSection").kind).toBe("query");
    expect(getTool("characters.upsert").kind).toBe("command");
    expect(riskForTool("characters.upsert")).toBe("sensitive");
    expect(riskForTool("storyboard.upsertShots")).toBe("sensitive");
    expect(riskForTool("storyboard.deleteShots")).toBe("sensitive");
    expect(toolDescriptorsForModel().some((t) => t.id === "storyboard.listShots")).toBe(true);
    expect(toolDescriptorsForModel().some((t) => t.id === "storyboard.deleteShots")).toBe(true);
    expect(toolDescriptorsForModel().some((t) => t.id === "canvas.applyPatch")).toBe(true);
    expect(toolDescriptorsForModel().some((t) => t.id === "request_user_input")).toBe(true);
    expect(toolDescriptorsForModel().some((t) => t.id === "story.confirmCreativeProfile")).toBe(
      true
    );
    expect(riskForTool("story.generation.quoteAssets")).toBe("reversible");
    expect(riskForTool("story.generation.confirmBatch")).toBe("critical");
    expect(riskForTool("story.generation.getBatch")).toBe("read");
    expect(riskForTool("story.generation.resumeBatch")).toBe("sensitive");
    expect(toolDescriptorsForModel().some((t) => t.id === "story.generation.resumeBatch")).toBe(
      true
    );
  });

  it("validates bounded structured user questions", () => {
    expect(
      parseToolInput("request_user_input", {
        ...QUESTION_TURN_COPY,
        formId: "generic_form",
        questions: [
          {
            id: "aspect_ratio",
            header: "Aspect ratio",
            question: "Choose a frame",
            options: [
              { value: "portrait_9_16", label: "9:16" },
              { value: "landscape_16_9", label: "16:9" },
            ],
          },
        ],
      })
    ).toMatchObject({ formId: "generic_form" });
    expect(() =>
      parseToolInput("request_user_input", {
        ...QUESTION_TURN_COPY,
        questions: [
          {
            id: "aspect_ratio",
            header: "Aspect ratio",
            question: "Choose a frame",
            options: [
              { value: "same", label: "A" },
              { value: "same", label: "B" },
            ],
          },
        ],
      })
    ).toThrow();
  });

  it("requires transcript lead-in and resume acknowledgement for HITL", () => {
    const questions = [
      {
        id: "format",
        header: "Format",
        question: "Choose a format",
        options: [
          { value: "short", label: "Short" },
          { value: "long", label: "Long" },
        ],
      },
    ];
    expect(() => parseToolInput("request_user_input", { questions })).toThrow();
    expect(() =>
      parseToolInput("request_user_input", {
        leadIn: QUESTION_TURN_COPY.leadIn,
        questions,
      })
    ).toThrow();
  });

  it("supports server-verifiable asset-kind generation scopes", () => {
    expect(
      parseToolInput("story.generation.quoteAssets", {
        assetKinds: ["character"],
        outputKind: "image",
      })
    ).toEqual({
      assetKinds: ["character"],
      outputKind: "image",
      options: {},
    });
    expect(() =>
      parseToolInput("story.generation.quoteAssets", {
        assetKinds: ["character", "costume"],
        outputKind: "image",
      })
    ).toThrow();
  });

  it("accepts canonical target identity on sequential Story generation batches", () => {
    const batchId = "10000000-0000-4000-8000-000000000001";
    const targetId = "20000000-0000-4000-8000-000000000002";
    expect(
      parseToolOutput("story.generation.quoteAssets", {
        id: batchId,
        projectId: "30000000-0000-4000-8000-000000000003",
        chapterId: "40000000-0000-4000-8000-000000000004",
        status: "awaiting_confirmation",
        dispatchMode: "sequential",
        totalPoints: 10,
        availablePoints: "100",
        itemCount: 1,
        version: 0,
        quoteExpiresAt: "2026-08-27T18:00:00.000Z",
        confirmedAt: null,
        completedAt: null,
        blockedAt: null,
        blockReason: null,
        canCancel: true,
        counts: {
          awaiting_confirmation: 1,
          ready: 0,
          dispatching: 0,
          submitted: 0,
          completed: 0,
          failed: 0,
          cancelled: 0,
        },
        items: [
          {
            id: "50000000-0000-4000-8000-000000000005",
            ordinal: 0,
            status: "awaiting_confirmation",
            targetKind: "asset_spec",
            targetId,
            sequenceId: null,
            targetVersion: 1,
            outputKind: "image",
            modelId: "fal-ai/nano-banana",
            schemaVersion: "v1",
            quotedPoints: 10,
            generationId: null,
            error: null,
          },
        ],
      })
    ).toMatchObject({
      id: batchId,
      dispatchMode: "sequential",
      items: [{ targetKind: "asset_spec", targetId, sequenceId: null }],
    });
  });

  it("requires attachmentId for script.readSection", () => {
    expect(() =>
      parseToolInput("script.readSection", {
        sectionIndex: 0,
        maxChars: 1000,
      })
    ).toThrow();
    const parsed = parseToolInput("script.readSection", {
      attachmentId: "00000000-0000-4000-8000-000000000001",
      sectionIndex: 0,
      maxChars: 1000,
    });
    expect(parsed).toMatchObject({ sectionIndex: 0 });
  });

  it("validates characters.upsert input", () => {
    const parsed = parseToolInput("characters.upsert", {
      baseRevision: 0,
      characters: [
        {
          id: "lin-daiyu",
          name: { "zh-CN": "林黛玉" },
          summary: "贾母外孙女，体弱多病。",
          intent: "create",
        },
      ],
    });
    expect(parsed).toMatchObject({ baseRevision: 0 });
  });

  it("validates semantic Story interaction input", () => {
    const parsed = parseToolInput("story.putInteraction", {
      baseDraftRevision: 4,
      nodeId: "scene.opening",
      interaction: {
        kind: "hotspot",
        interactionId: "interaction.dodge",
        label: { "zh-CN": "向右闪避" },
        trigger: { kind: "swipe", direction: "right" },
        rect: { x: 0.2, y: 0.25, width: 0.4, height: 0.5 },
        startMs: 800,
        endMs: 1_600,
        outcomes: {
          success: { kind: "continue" },
          failure: { kind: "goto", nodeId: "ending.caught" },
          timeout: { kind: "goto", nodeId: "ending.caught" },
        },
      },
    });
    expect(parsed).toMatchObject({
      nodeId: "scene.opening",
      interaction: {
        interactionId: "interaction.dodge",
        trigger: { kind: "swipe", direction: "right" },
      },
    });
    expect(() =>
      parseToolInput("story.putInteraction", {
        baseDraftRevision: 4,
        nodeId: "scene.opening",
        interaction: {
          kind: "hotspot",
          interactionId: "interaction.dodge",
          label: {},
          trigger: { kind: "press-hold", durationMs: 100 },
          rect: { x: 0.2, y: 0.25, width: 0.4, height: 0.5 },
          startMs: 800,
          endMs: 1_600,
          outcomes: { success: { kind: "continue" } },
        },
      })
    ).toThrow();
  });

  it("validates version-free Storyboard timeline and clip editing inputs", () => {
    expect(
      parseToolInput("story.storyboard.putTimeline", {
        sequenceId: "0197f4a2-0800-7000-8000-0000000000a1",
        durationMs: 6_000,
        clips: [
          {
            clipId: "0197f4a2-0800-7000-8000-0000000000a2",
            stableKey: "shot.scene.gate.opening",
            title: "Opening frame",
            description: "The gate in rain.",
            startMs: 0,
            durationMs: 1_500,
            kind: "image",
            imagePrompt: "A sealed gate in rain lit by @asset.prop.lantern.",
          },
          {
            stableKey: "shot.scene.gate.approach",
            title: "Approach",
            description: null,
            startMs: 1_500,
            durationMs: 4_500,
            kind: "video",
            videoPrompt: "The courier crosses the flooded square.",
          },
        ],
      })
    ).toMatchObject({
      sequenceId: "0197f4a2-0800-7000-8000-0000000000a1",
      durationMs: 6_000,
      clips: [
        { kind: "image", imagePrompt: expect.any(String) },
        { kind: "video", videoPrompt: expect.any(String) },
      ],
    });
    // Kind-correct prompts are a shape rule even before server validation.
    expect(() =>
      parseToolInput("story.storyboard.putTimeline", {
        sequenceId: "0197f4a2-0800-7000-8000-0000000000a1",
        durationMs: 1_500,
        clips: [
          {
            stableKey: "shot.scene.gate.opening",
            title: "Opening frame",
            description: null,
            startMs: 0,
            durationMs: 1_500,
            kind: "video",
            imagePrompt: "An image prompt cannot drive a video clip.",
          },
        ],
      })
    ).toThrow();
    expect(() =>
      parseToolInput("story.storyboard.putTimeline", {
        sequenceId: "0197f4a2-0800-7000-8000-0000000000a1",
        durationMs: 1_000,
        clips: [
          {
            stableKey: "shot.scene.gate.opening",
            title: "Too short",
            description: null,
            startMs: 0,
            durationMs: 100,
            kind: "image",
            imagePrompt: "A held frame.",
          },
        ],
      })
    ).toThrow();

    expect(
      parseToolInput("story.storyboard.patchClip", {
        clipId: "0197f4a2-0800-7000-8000-0000000000a2",
        imagePrompt: "A sealed gate in heavier rain.",
        negativePrompt: null,
      })
    ).toMatchObject({ clipId: "0197f4a2-0800-7000-8000-0000000000a2" });
    // A patch with only the address is a no-op and rejected.
    expect(() =>
      parseToolInput("story.storyboard.patchClip", {
        clipId: "0197f4a2-0800-7000-8000-0000000000a2",
      })
    ).toThrow();

    expect(() => parseToolInput("story.storyboard.read", {})).not.toThrow();
  });

  it("marks the Storyboard editing tools with the intended risk levels", () => {
    expect(riskForTool("story.storyboard.read")).toBe("read");
    expect(riskForTool("story.storyboard.putTimeline")).toBe("sensitive");
    expect(riskForTool("story.storyboard.patchClip")).toBe("sensitive");
  });

  it("requires story.read to project durable lifecycle and canonical production readiness", () => {
    const output = {
      chapterId: "00000000-0000-4000-8000-000000000001",
      draftRevision: 0,
      contentHash: "a".repeat(64),
      storyBible: {
        logline: "",
        synopsis: "",
        characters: [],
        stateVariables: [
          {
            key: "courage",
            name: { "en-US": "Courage" },
            valueType: "number",
            initialValue: 0,
          },
        ],
      },
      graph: { entryNodeId: null, nodes: [] },
      productionNotes: [],
      productionState: {
        projectId: "00000000-0000-4000-8000-000000000003",
        chapterId: "00000000-0000-4000-8000-000000000001",
        profile: { status: "current" },
        script: { status: "missing", documentId: null, sequence: null },
        plotTree: { status: "missing", nodeCount: 0 },
        assets: { status: "missing", currentCount: 0 },
        storyboard: {
          status: "missing",
          sequenceCount: 0,
          missingPlotNodeIds: [],
        },
        ready: false,
      },
      creativeProfile: {
        frameProfile: "landscape_16_9",
        durationPreset: "medium_15_30",
        visualStyle: "stylized-3d-cinema",
        storyLanguage: "zh-CN",
        confirmed: true,
      },
      authoringRun: {
        runId: "00000000-0000-4000-8000-000000000002",
        status: "cancelled",
      },
    };
    expect(parseToolOutput("story.read", output)).toMatchObject({
      authoringRun: { status: "cancelled" },
      productionState: { script: { status: "missing" }, ready: false },
    });
    const canonicalNodes = [
      {
        kind: "clip",
        nodeId: "opening",
        clipKey: "OPENING",
        onEnterEffects: [{ kind: "add", key: "courage", amount: 1 }],
        exit: {
          kind: "auto",
          routes: [
            {
              when: {
                kind: "compare",
                variableKey: "courage",
                operator: "at-least",
                value: 3,
              },
              target: { kind: "node", nodeId: "decision:opening" },
            },
            { target: null },
          ],
        },
      },
      {
        kind: "decision",
        nodeId: "decision:opening",
        exit: {
          kind: "choice",
          decisionId: "opening_choice",
          prompt: { "en-US": "Where next?" },
          choices: [
            {
              choiceId: "explore",
              label: { "en-US": "Explore" },
              target: { kind: "node", nodeId: "world" },
              effects: [{ kind: "add", key: "courage", amount: 1 }],
            },
          ],
        },
      },
      {
        kind: "world",
        nodeId: "world",
        worldId: null,
        maxExperienceSeconds: 60,
        exit: { kind: "auto", routes: [{ target: null }] },
      },
    ];
    expect(
      parseToolOutput("story.read", {
        ...output,
        graph: { entryNodeId: "opening", nodes: canonicalNodes },
      })
    ).toMatchObject({ graph: { nodes: canonicalNodes } });
    expect(() => parseToolOutput("story.read", { ...output, authoringRun: undefined })).toThrow();
    expect(() =>
      parseToolOutput("story.read", { ...output, productionState: undefined })
    ).toThrow();
    expect(() =>
      parseToolOutput("story.read", {
        ...output,
        productionState: { ...output.productionState, ready: true },
      })
    ).toThrow(/ready must exactly reflect/);
    expect(() =>
      parseToolOutput("story.read", {
        ...output,
        productionState: {
          ...output.productionState,
          script: { status: "current", documentId: null, sequence: null },
        },
      })
    ).toThrow(/requires its canonical document id and sequence/);
  });

  it("validates one atomic state-variable mutation command", () => {
    expect(
      parseToolInput("story.updateStateVariables", {
        baseDraftRevision: 4,
        upsert: [
          {
            key: "courage",
            name: { "en-US": "Courage" },
            valueType: "number",
            initialValue: 0,
          },
        ],
        removeKeys: ["met"],
      })
    ).toMatchObject({ upsert: [{ key: "courage" }], removeKeys: ["met"] });
    expect(() =>
      parseToolInput("story.updateStateVariables", {
        baseDraftRevision: 4,
        upsert: [],
        removeKeys: [],
      })
    ).toThrow(/Upsert or remove/);
  });

  it("makes the Server production-state projection the story.read routing authority", () => {
    const description = getTool("story.read").description;
    expect(description).toContain("Server-owned productionState");
    expect(description).toContain("before story.author");
    expect(description).toContain("selects create, incremental completion, or no-op");
  });

  it("accepts a four-step creative profile but keeps user-input forms bounded", () => {
    const question = (id: string) => ({
      id,
      header: id,
      question: `Choose ${id}`,
      options: [
        { value: `${id}_a`, label: "A" },
        { value: `${id}_b`, label: "B" },
      ],
    });
    expect(
      parseToolInput("request_user_input", {
        ...QUESTION_TURN_COPY,
        questions: [question("one"), question("two"), question("three"), question("four")],
      })
    ).toHaveProperty(
      "questions",
      expect.arrayContaining([expect.objectContaining({ id: "four" })])
    );
    expect(() =>
      parseToolInput("request_user_input", {
        ...QUESTION_TURN_COPY,
        questions: [
          question("one"),
          question("two"),
          question("three"),
          question("four"),
          question("five"),
        ],
      })
    ).toThrow();
  });

  it("constructs every unknown profile question without model-authored catalogs", () => {
    const result = parseToolInput("request_user_input", {
      ...QUESTION_TURN_COPY,
      formId: "story_creative_profile",
      knownValues: { story_language: "zh-CN" },
    }) as { questions: Array<{ id: string; options: Array<{ value: string }> }> };
    expect(result.questions.map((question) => question.id)).toEqual([
      "aspect_ratio",
      "target_runtime",
      "visual_direction",
    ]);
    expect(result.questions[2].options.map((option) => option.value)).toEqual(
      STORY_VISUAL_STYLE_SKILL_SLUGS
    );
    // A model that forgets the known language must ask it, never silently default.
    expect(
      parseToolInput("request_user_input", {
        ...QUESTION_TURN_COPY,
        formId: "story_creative_profile",
      })
    ).toHaveProperty(
      "questions",
      expect.arrayContaining([expect.objectContaining({ id: "story_language" })])
    );
    // The old failure repeated malformed three-question forms; fixed-form
    // questions now come only from the runtime, even if the model supplies them.
    expect(
      parseToolInput("request_user_input", {
        ...QUESTION_TURN_COPY,
        formId: "story_creative_profile",
        questions: [{ id: "aspect_ratio", options: [] }],
      })
    ).toHaveProperty(
      "questions",
      expect.arrayContaining([expect.objectContaining({ id: "story_language" })])
    );
  });

  it("rejects invented profile values and a question when no values are missing", () => {
    for (const knownValues of [
      { story_language: "invented" },
      { unexpected: "en-US" },
      {
        aspect_ratio: "landscape_16_9",
        target_runtime: "short_5_15",
        visual_direction: "cinematic-realism",
        story_language: "en-US",
      },
    ]) {
      expect(() =>
        parseToolInput("request_user_input", {
          ...QUESTION_TURN_COPY,
          formId: "story_creative_profile",
          knownValues,
        })
      ).toThrow();
    }
    expect(() =>
      parseToolInput("request_user_input", {
        ...QUESTION_TURN_COPY,
        knownValues: { story_language: "en-US" },
      })
    ).toThrow();
  });

  it("requires a complete typed profile when confirming with or without an interaction", () => {
    const complete = {
      aspectRatio: "landscape_16_9",
      targetRuntime: "short_5_15",
      visualDirection: "cinematic-realism",
      storyLanguage: "en-US",
    };
    expect(parseToolInput("story.confirmCreativeProfile", complete)).toEqual(complete);
    expect(
      parseToolInput("story.confirmCreativeProfile", {
        ...complete,
        requestId: "11111111-1111-4111-8111-111111111111",
      })
    ).toHaveProperty("requestId");
    expect(() =>
      parseToolInput("story.confirmCreativeProfile", {
        requestId: "11111111-1111-4111-8111-111111111111",
      })
    ).toThrow();
  });

  it("requires lifecycle copy and validates the Story external-job handoff", () => {
    const input = {
      title: "The Last Watch",
      summary: "A final imperial guard chooses whom to save.",
      brief: "Create an interactive film set on the final night of Ming rule.",
      continueThrough: "storyboard" as const,
      startedMessage: "I have your direction and am preparing the production plan now.",
      completionMessage:
        "The screenplay is ready for your review. No media has been generated; use Generate when you want to create it.",
    };
    expect(parseToolInput("story.author", input)).toEqual(input);
    expect(() =>
      parseToolInput("story.author", {
        title: input.title,
        summary: input.summary,
        brief: input.brief,
      })
    ).toThrow();
    expect(
      parseToolOutput("story.author", {
        runId: "11111111-1111-4111-8111-111111111111",
        status: "authoring",
        agentHandoff: {
          kind: "external_job",
          jobId: "11111111-1111-4111-8111-111111111111",
          startedMessage: input.startedMessage,
        },
      })
    ).toMatchObject({
      status: "authoring",
      agentHandoff: { kind: "external_job" },
    });
  });

  it("describes story.author as an intent-gated incremental production plan", () => {
    const description = getTool("story.author").description;
    expect(description).toContain("Never call for greetings");
    expect(description).toContain("Call story.read first");
    expect(description).toContain("reuses every other valid chapter stage");
    expect(description).toContain("regenerateStage");
    expect(description).toContain("sourceAttachmentId");
    expect(description).toContain("Only when no valid Script exists");
    expect(description).toContain("selects exactly one next artifact");
    expect(description).toContain("Set continueThrough once");
    expect(description).toContain("never asks the model to infer the old intent again");
    expect(description).toContain("single canonical Plot topology");
    expect(description).toContain("one Storyboard sequence per Plot node");
    expect(description).toContain("creator uses Generate later");
    expect(description).toContain("without a second Asset confirmation");
    expect(description).toContain("Storyboard remains a separate Continue/Don't continue boundary");
    expect(description).toContain("authoritative Server continuation");
    expect(description).not.toContain("five-baton");
    expect(description).not.toContain("proposal for the whole tree");
  });

  it("builds stable idempotency keys", () => {
    expect(
      buildToolIdempotencyKey({
        projectId: "p1",
        runId: "r1",
        toolCallId: "c1",
      })
    ).toBe("p1:r1:c1:v1");
  });

  it("mints valid operationId when canvas.applyPatch gets a fake UUID", () => {
    const parsed = parseToolInput("canvas.applyPatch", {
      baseDraftRevision: 1,
      baseLayoutRevision: 1,
      operations: [
        {
          operationId: "not-a-real-uuid",
          kind: "shot.upsert",
          payload: {
            id: "shot-04",
            title: "随笔爱你吧",
            prompt: "soft light",
          },
        },
      ],
    }) as {
      operations: Array<{ operationId: string }>;
    };
    expect(parsed.operations[0]?.operationId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    );
  });
});
