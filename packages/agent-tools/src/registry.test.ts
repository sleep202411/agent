import { describe, expect, it } from "vitest";

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

  it("requires story.read to project durable lifecycle and canonical production readiness", () => {
    const output = {
      chapterId: "00000000-0000-4000-8000-000000000001",
      draftRevision: 0,
      contentHash: "a".repeat(64),
      storyBible: { logline: "", synopsis: "", characters: [] },
      graph: { entryNodeId: null, nodes: [] },
      productionNotes: [],
      productionState: {
        projectId: "00000000-0000-4000-8000-000000000003",
        chapterId: "00000000-0000-4000-8000-000000000001",
        profile: { status: "current" },
        script: { status: "missing", documentId: null, sequence: null },
        plotTree: { status: "missing", nodeCount: 0 },
        assets: { status: "missing", currentCount: 0, staleCount: 0 },
        storyboard: {
          status: "missing",
          sequenceCount: 0,
          staleCount: 0,
          missingPlotNodeIds: [],
        },
        ready: false,
      },
      creativeProfile: {
        frameProfile: "landscape_16_9",
        durationPreset: "medium_15_30",
        visualStyle: "stylized_3d",
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
          script: { status: "stale", documentId: null, sequence: null },
        },
      })
    ).toThrow(/requires its canonical document id and sequence/);
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

  it("accepts canonical missing-field subsets and rejects reordered creative-profile forms", () => {
    const questions = [
      {
        id: "aspect_ratio",
        header: "Aspect ratio",
        question: "Choose a frame",
        options: [
          { value: "portrait_9_16", label: "9:16" },
          { value: "landscape_16_9", label: "16:9" },
        ],
      },
      {
        id: "target_runtime",
        header: "Target runtime",
        question: "Choose a runtime",
        options: [
          { value: "short_5_15", label: "5–15 min" },
          { value: "medium_15_30", label: "15–30 min" },
          { value: "long_30_60", label: "30–60 min" },
        ],
      },
      {
        id: "visual_direction",
        header: "Visual direction",
        question: "Choose a style",
        options: [
          { value: "cinematic_realism", label: "Cinematic realism" },
          { value: "stylized_3d", label: "Stylized 3D" },
          { value: "graphic_novel", label: "Graphic novel" },
          { value: "anime_cinematic", label: "Cinematic anime" },
        ],
      },
      {
        id: "story_language",
        header: "Story language",
        question: "Choose the authored language",
        options: [
          { value: "zh-CN", label: "简体中文" },
          { value: "zh-HK", label: "繁體中文" },
          { value: "en-US", label: "English" },
        ],
      },
    ];
    expect(
      parseToolInput("request_user_input", {
        ...QUESTION_TURN_COPY,
        formId: "story_creative_profile",
        knownValues: {},
        questions,
      })
    ).toMatchObject({
      questions: expect.arrayContaining([expect.objectContaining({ id: "story_language" })]),
    });
    expect(
      parseToolInput("request_user_input", {
        ...QUESTION_TURN_COPY,
        formId: "story_creative_profile",
        knownValues: {
          aspect_ratio: "landscape_16_9",
          visual_direction: "cinematic_realism",
        },
        questions: [questions[1], questions[3]],
      })
    ).toMatchObject({
      questions: [
        expect.objectContaining({ id: "target_runtime" }),
        expect.objectContaining({ id: "story_language" }),
      ],
    });
    expect(() =>
      parseToolInput("request_user_input", {
        ...QUESTION_TURN_COPY,
        formId: "story_creative_profile",
        knownValues: {},
        questions: [questions[3], ...questions.slice(0, 3)],
      })
    ).toThrow();
    expect(() =>
      parseToolInput("request_user_input", {
        ...QUESTION_TURN_COPY,
        formId: "story_creative_profile",
        knownValues: { target_runtime: "short_5_15" },
        questions,
      })
    ).toThrow();
  });

  it("requires a complete typed profile when confirming with or without an interaction", () => {
    const complete = {
      aspectRatio: "landscape_16_9",
      targetRuntime: "short_5_15",
      visualDirection: "cinematic_realism",
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
    expect(description).toContain("reuses every valid chapter stage");
    expect(description).toContain("Only when no valid Script exists");
    expect(description).toContain("single canonical Plot topology");
    expect(description).toContain("one Storyboard sequence per Plot node");
    expect(description).toContain("zero generated media");
    expect(description).toContain("creator must use Generate later");
    expect(description).toContain("say only that the screenplay is ready for creator review");
    expect(description).toContain("never present production specifications as a second review");
    expect(description).toContain("authoritative Server apply continuation");
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
