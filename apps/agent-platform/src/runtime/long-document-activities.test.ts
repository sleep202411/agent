import { MockActivityEnvironment } from "@temporalio/testing";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AgentDocumentSectionAnalysisSchema } from "../domain/agent-platform-wire-v1.js";
import { DomainDocumentAnalysisError } from "../domain/domain-gateway.js";
import type {
  LongDocumentArtifactRef,
  LongDocumentFinalizeActivityInput,
  LongDocumentReduceActivityInput,
} from "./long-document-contracts.js";

const runtime = vi.hoisted(() => ({
  generateStructured: vi.fn(),
  readLongDocumentSection: vi.fn(),
  readLongDocumentArtifacts: vi.fn(),
  writeLongDocumentArtifact: vi.fn(),
}));

vi.mock("./dependencies.js", () => ({
  getRuntimeDependencies: () => ({
    longDocumentAnalyst: { generateStructured: runtime.generateStructured },
    domainGateway: {
      readLongDocumentSection: runtime.readLongDocumentSection,
      readLongDocumentArtifacts: runtime.readLongDocumentArtifacts,
      writeLongDocumentArtifact: runtime.writeLongDocumentArtifact,
    },
  }),
}));

const {
  mapLongDocumentSectionActivity,
  reduceLongDocumentAnalysisActivity,
  finalizeLongDocumentAnalysisActivity,
} = await import("./long-document-activities.js");

// Verbatim excerpt of the Chinese screenplay section that failed the live run.
// The dialogue runs on inside one pair of 「“ ”」, which is what the model
// mis-quotes: it lifts a clause out of the middle and re-closes the quotation.
const SECTION_TEXT = [
  "【镜头2】",
  "",
  "“欢迎来到拔舌狱第一层。”她声音甜得发腻，“我是守关人拔舌鬼。如今地狱搞‘中元节大酬宾’，只开七道门。你们既然进来了，就得守我的规矩。”",
  "",
  "【镜头5 - 大爆点】",
  "",
  "“只要我一开播，这些话就会被颠倒放大，在房间里循环播放。你们的任务——保持冷静，互不攻击，关掉所有收音机。当然啦，比登天还难哦~”",
].join("\n");

const MAP_INPUT = {
  schemaVersion: "agent-long-document-map-activity/v1",
  jobId: "019fb82b-eb82-76f3-bb5c-fd9b1a4b8951",
  chunkId: "chunk-000005",
  ordinal: 5,
} as const;

describe("mapLongDocumentSectionActivity", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    runtime.readLongDocumentSection.mockResolvedValue({
      schemaVersion: "agent-long-document-section-context/v1",
      jobId: MAP_INPUT.jobId,
      locale: "en-US",
      document: {
        title: "第一集：赌圣驾到与旗袍壮汉",
        format: "markdown",
        characterCount: 68_960,
        chunkCount: 39,
      },
      section: {
        chunkId: MAP_INPUT.chunkId,
        ordinal: MAP_INPUT.ordinal,
        heading: "第四集：地狱入口与派对惊魂",
        text: SECTION_TEXT,
      },
    });
    // The product gateway rejects the whole checkpoint when one citation is not
    // a literal substring of its chunk. Mirror that exactly.
    runtime.writeLongDocumentArtifact.mockImplementation(
      ({ artifact }: { artifact: { content: unknown } }) => {
        const source = SECTION_TEXT.normalize("NFC");
        for (const quote of quotesOf(artifact.content)) {
          if (!source.includes(quote.normalize("NFC"))) {
            throw new DomainDocumentAnalysisError(
              "AGENT_DOCUMENT_ANALYSIS_EVIDENCE_INVALID",
              "A document analysis checkpoint cited text that is not present in its source section.",
              false
            );
          }
        }
        return {
          artifactId: "019fb82c-0000-7000-8000-000000000005",
          kind: "section",
          level: 0,
          ordinal: MAP_INPUT.ordinal,
          sourceChunkIds: [MAP_INPUT.chunkId],
        };
      }
    );
  });

  it("realigns a re-closed excerpt onto the verbatim source span the gateway accepts", async () => {
    runtime.generateStructured.mockResolvedValue(
      analysis([
        finding("Rules of the Pulling Tongue Prison", [
          // Model output recorded from the live run: both spans are verbatim
          // except for the quotation mark it added to balance the excerpt.
          "“我是守关人拔舌鬼。”",
          "“如今地狱搞‘中元节大酬宾’，只开七道门。”",
        ]),
      ])
    );

    const result = await new MockActivityEnvironment().run<
      [typeof MAP_INPUT],
      LongDocumentArtifactRef,
      typeof mapLongDocumentSectionActivity
    >(mapLongDocumentSectionActivity, MAP_INPUT);

    expect(result.artifactId).toBe("019fb82c-0000-7000-8000-000000000005");
    expect(runtime.writeLongDocumentArtifact).toHaveBeenCalledTimes(1);
    expect(writtenQuotes()).toEqual([
      "“我是守关人拔舌鬼。",
      "如今地狱搞‘中元节大酬宾’，只开七道门。",
    ]);
  });

  it("keeps the longer real half of a citation that elides its own middle", async () => {
    runtime.generateStructured.mockResolvedValue(
      analysis([
        finding("Radio challenge", [
          // Recorded from the live run: both halves are verbatim, but the span
          // between them was never contiguous.
          "“只要我一开播...你们的任务——保持冷静，互不攻击，关掉所有收音机。",
        ]),
      ])
    );

    await new MockActivityEnvironment().run(mapLongDocumentSectionActivity, MAP_INPUT);

    expect(writtenQuotes()).toEqual(["你们的任务——保持冷静，互不攻击，关掉所有收音机。"]);
  });

  it("drops a spliced citation, and the finding it leaves without evidence", async () => {
    runtime.generateStructured.mockResolvedValue(
      analysis([
        finding("Intern ghost", [
          // Elided and spliced across two non-adjacent spans: there is no
          // honest verbatim reading of it, so it cannot be written.
          "“人家刚来地狱实习，还没转正...”“实习工号007”",
        ]),
        finding("Radio challenge", [
          "“人家刚来地狱实习，还没转正...”“实习工号007”",
          "“你们的任务——保持冷静，互不攻击，关掉所有收音机。”",
        ]),
      ])
    );

    await new MockActivityEnvironment().run(mapLongDocumentSectionActivity, MAP_INPUT);

    const written = writtenContent();
    expect(written.storyBeats).toHaveLength(1);
    expect(written.storyBeats[0]?.label).toBe("Radio challenge");
    expect(writtenQuotes()).toEqual(["你们的任务——保持冷静，互不攻击，关掉所有收音机。"]);
  });

  it("bounds the section model's thinking budget so it cannot eat the checkpoint's output budget", async () => {
    runtime.generateStructured.mockResolvedValue(
      analysis([finding("Rules", ["“我是守关人拔舌鬼。"])])
    );

    await new MockActivityEnvironment().run(mapLongDocumentSectionActivity, MAP_INPUT);

    const [request] = runtime.generateStructured.mock.calls[0] as [
      { maxOutputTokens: number; thinkingBudgetTokens: number },
    ];
    expect(request.thinkingBudgetTokens).toBeGreaterThan(0);
    expect(request.thinkingBudgetTokens).toBeLessThanOrEqual(request.maxOutputTokens / 8);
  });

  // The provider's structured-output decoder ignores the wire schema's
  // maxItems/maxLength, and maxOutputTokens only truncates a checkpoint into an
  // object that fails to parse the same way on every temperature-0 retry. The
  // request text is therefore the only place a size limit takes effect, and
  // checkpoint latency is linear in the size that comes back.
  it("states a numeric budget for every findings array the section schema exposes", async () => {
    runtime.generateStructured.mockResolvedValue(
      analysis([finding("Rules", ["“我是守关人拔舌鬼。"])])
    );

    await new MockActivityEnvironment().run(mapLongDocumentSectionActivity, MAP_INPUT);

    const prompt = requestedPrompt();
    for (const field of findingArrayFields()) {
      expect(prompt).toMatch(new RegExp(`\\b\\d+ ${field}\\b`, "u"));
    }
    expect(prompt).toMatch(/at most \d+ evidence quotes per finding/u);
    expect(prompt).toMatch(/at most \d+ characters per quote/u);
    expect(prompt).toMatch(/at most \d+ characters per analysis/u);
    // Untrusted source text must not be able to read as amending the budget.
    expect(prompt.indexOf("Output budget")).toBeLessThan(prompt.indexOf("<source-section>"));
  });

  it("maps a bounded section on the extraction tier", async () => {
    runtime.generateStructured.mockResolvedValue(
      analysis([finding("Rules", ["“我是守关人拔舌鬼。"])])
    );

    await new MockActivityEnvironment().run(mapLongDocumentSectionActivity, MAP_INPUT);

    expect(requestedStage()).toBe("extract");
  });

  // The live 39-section run died here: gemini-2.5-flash mis-echoed the chunk id
  // inside one evidence quote, the wire rule "section evidence must cite the
  // analyzed chunk" rejected the section, and because it is deterministic every
  // Temporal retry reproduced it until the job failed. The section id is a
  // constant the activity already holds, so it is no longer asked for.
  it("never lets the model name the chunk its evidence cites", async () => {
    runtime.generateStructured.mockResolvedValue(
      analysis([finding("Rules", ["“我是守关人拔舌鬼。", "只开七道门。"])])
    );

    await new MockActivityEnvironment().run(mapLongDocumentSectionActivity, MAP_INPUT);

    const requestedSchema = (
      runtime.generateStructured.mock.calls[0] as [{ schema: { parse(value: unknown): unknown } }]
    )[0].schema;
    // A response that names a chunk at all is refused before it can name the
    // wrong one — the field does not exist in what the model is handed.
    expect(() => requestedSchema.parse({ ...analysis([]), chunkId: MAP_INPUT.chunkId })).toThrow();

    // And the artifact that reaches the gateway still carries the citation the
    // wire contract requires, stamped from the section this activity fetched.
    const cited = writtenContent().storyBeats.flatMap((beat) => beat.evidence);
    expect(cited).toHaveLength(2);
    expect(cited.every((item) => item.chunkId === MAP_INPUT.chunkId)).toBe(true);
  });
});

describe("long-document reductions", () => {
  const REDUCE_INPUT: LongDocumentReduceActivityInput = {
    schemaVersion: "agent-long-document-reduce-activity/v1",
    jobId: MAP_INPUT.jobId,
    level: 2,
    ordinal: 0,
    inputArtifactIds: [
      "019fb82c-0000-7000-8000-00000000000a",
      "019fb82c-0000-7000-8000-00000000000b",
    ],
  };

  beforeEach(() => {
    vi.clearAllMocks();
    runtime.readLongDocumentArtifacts.mockResolvedValue({
      schemaVersion: "agent-long-document-artifacts-context/v1",
      jobId: MAP_INPUT.jobId,
      artifacts: REDUCE_INPUT.inputArtifactIds.map((artifactId, index) => ({
        artifactId,
        kind: "reduce" as const,
        level: 1,
        ordinal: index,
        sourceChunkIds: [`chunk-00000${index}`],
        content: synthesis(1),
      })),
    });
    runtime.writeLongDocumentArtifact.mockResolvedValue({
      artifactId: "019fb82c-0000-7000-8000-0000000000ff",
      kind: "reduce",
      level: REDUCE_INPUT.level,
      ordinal: 0,
      sourceChunkIds: ["chunk-000000", "chunk-000001"],
    });
  });

  // A reduce whose output budget is unstated writes past its token cap and
  // returns a truncated object; at temperature 0 every retry truncates in the
  // same place, so the whole job dies with its checkpoints stranded.
  it("tells a reduction its merge is a compression, and runs it on the synthesis tier", async () => {
    runtime.generateStructured.mockResolvedValue(synthesis(REDUCE_INPUT.level));

    await new MockActivityEnvironment().run(reduceLongDocumentAnalysisActivity, REDUCE_INPUT);

    const prompt = requestedPrompt();
    expect(prompt).toMatch(/at most \d+ entries per array/u);
    expect(prompt).toMatch(/at most \d+ evidence quotes per entry/u);
    expect(prompt).toMatch(/at most \d+ characters per analysis/u);
    expect(prompt.indexOf("Output budget")).toBeLessThan(prompt.indexOf("<checkpoint-artifacts>"));
    expect(requestedStage()).toBe("synthesize");
  });

  it("bounds the final analysis and runs it on the synthesis tier", async () => {
    runtime.readLongDocumentArtifacts.mockResolvedValue({
      schemaVersion: "agent-long-document-artifacts-context/v1",
      jobId: MAP_INPUT.jobId,
      artifacts: [
        {
          artifactId: REDUCE_INPUT.inputArtifactIds[0],
          kind: "reduce" as const,
          level: 2,
          ordinal: 0,
          sourceChunkIds: ["chunk-000000", "chunk-000001"],
          content: synthesis(2),
        },
      ],
    });
    runtime.generateStructured.mockResolvedValue(finalAnalysis(2));
    runtime.writeLongDocumentArtifact.mockResolvedValue({
      artifactId: "019fb82c-0000-7000-8000-0000000000fe",
      kind: "final",
      level: 3,
      ordinal: 0,
      sourceChunkIds: ["chunk-000000", "chunk-000001"],
    });

    const finalizeInput: LongDocumentFinalizeActivityInput = {
      schemaVersion: "agent-long-document-finalize-activity/v1",
      jobId: MAP_INPUT.jobId,
      level: 3,
      inputArtifactId: REDUCE_INPUT.inputArtifactIds[0]!,
      chunkCount: 2,
    };
    await new MockActivityEnvironment().run(finalizeLongDocumentAnalysisActivity, finalizeInput);

    const prompt = requestedPrompt();
    expect(prompt).toMatch(/at most \d+ entries per array/u);
    expect(prompt).toMatch(/at most \d+ evidence quotes per entry/u);
    expect(prompt).toMatch(/at most \d+ characters per analysis/u);
    expect(prompt.indexOf("Output budget")).toBeLessThan(prompt.indexOf("<root-checkpoint>"));
    expect(requestedStage()).toBe("synthesize");
  });
});

function findingArrayFields(): string[] {
  const shape = AgentDocumentSectionAnalysisSchema.shape as Record<string, unknown>;
  return Object.entries(shape)
    .filter(
      ([, field]) => (field as { _zod?: { def?: { type?: string } } })._zod?.def?.type === "array"
    )
    .map(([name]) => name);
}

function requestedPrompt(): string {
  const [request] = runtime.generateStructured.mock.calls[0] as [{ prompt: string }];
  return request.prompt;
}

function requestedStage(): string {
  const [request] = runtime.generateStructured.mock.calls[0] as [{ stage: string }];
  return request.stage;
}

function synthesis(level: number) {
  return {
    schemaVersion: "agent-document-synthesis/v1",
    level,
    summary: "Merged synthesis of the level below.",
    storyStructure: [],
    characters: [],
    locations: [],
    plotThreads: [],
    continuityFindings: [],
    themes: [],
  };
}

function finalAnalysis(chunkCount: number) {
  return {
    schemaVersion: "agent-document-final-analysis/v1",
    executiveSummary: "The complete creator-facing analysis.",
    sourceCoverage: {
      chunkCount,
      analyzedChunkCount: chunkCount,
      missingChunkIds: [],
    },
    storyStructure: [],
    characters: [],
    locations: [],
    plotThreads: [],
    continuityFindings: [],
    themes: [],
    productionRecommendations: [],
  };
}

type TestFinding = Readonly<{
  label: string;
  analysis: string;
  evidence: readonly Readonly<{ chunkId: string; quote: string }>[];
}>;

// What the model returns, which is the wire shape minus every chunkId — the
// activity stamps the dispatched section's id back on. Emitting one here would
// be rejected by the strict model schema, which is the whole point: a model
// that cannot name a chunk cannot name the wrong one.
type ModelFinding = Readonly<{
  label: string;
  analysis: string;
  evidence: readonly Readonly<{ quote: string }>[];
}>;

function finding(label: string, quotes: readonly string[]): ModelFinding {
  return {
    label,
    analysis: `Bounded analysis for ${label}.`,
    evidence: quotes.map((quote) => ({ quote })),
  };
}

function analysis(storyBeats: readonly ModelFinding[]) {
  return {
    schemaVersion: "agent-document-section-analysis/v1",
    heading: "第五集：拔舌狱·真心话大轰炸",
    summary: "The guardian of the first level of Hell sets the rules of her trial.",
    storyBeats,
    characters: [],
    locations: [],
    plotThreads: [],
    continuityFindings: [],
    themes: [],
  };
}

function writtenContent(): { storyBeats: TestFinding[] } {
  const [call] = runtime.writeLongDocumentArtifact.mock.calls as [
    [{ artifact: { content: { storyBeats: TestFinding[] } } }],
  ];
  return call[0].artifact.content;
}

function writtenQuotes(): string[] {
  return quotesOf(writtenContent());
}

function quotesOf(content: unknown): string[] {
  const findings = (content as { storyBeats?: readonly TestFinding[] }).storyBeats ?? [];
  return findings.flatMap((entry) => entry.evidence.map((item) => item.quote));
}
