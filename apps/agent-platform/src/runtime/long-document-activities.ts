import { ApplicationFailure, Context } from "@temporalio/activity";
import { z } from "zod";

import {
  AgentDocumentFinalAnalysisSchema,
  AgentDocumentSectionAnalysisSchema,
  AgentDocumentSynthesisSchema,
} from "../domain/agent-platform-wire-v1.js";

import {
  DomainDocumentAnalysisError,
  DomainGatewayUnavailableError,
} from "../domain/domain-gateway.js";
import { getRuntimeDependencies } from "./dependencies.js";
import {
  longDocumentCompleteActivityInputSchema,
  longDocumentFailActivityInputSchema,
  longDocumentFinalizeActivityInputSchema,
  longDocumentMapActivityInputSchema,
  longDocumentReduceActivityInputSchema,
  longDocumentWorkflowInputSchema,
  type LongDocumentCompleteActivityInput,
  type LongDocumentArtifactRef,
  type LongDocumentFailActivityInput,
  type LongDocumentFinalizeActivityInput,
  type LongDocumentManifest,
  type LongDocumentMapActivityInput,
  type LongDocumentReduceActivityInput,
} from "./long-document-contracts.js";

const ACTIVITY_HEARTBEAT_INTERVAL_MS = 500;
// Headroom above the stated section budget, not a target: the provider bills
// what it generates, but a section that overshoots the cap comes back as a
// truncated object that fails identically on every retry. The largest budgeted
// section of the live screenplay produced ~15 KB of JSON.
const MAP_OUTPUT_TOKENS = 16_384;
const REDUCE_OUTPUT_TOKENS = 16_384;
const FINAL_OUTPUT_TOKENS = 20_000;
/**
 * The output budget every checkpoint prompt has to state.
 *
 * Checkpoint latency is generation-bound and linear in how much JSON comes
 * back: across the 39 sections of the live screenplay run, section wall clock
 * tracked artifact size at r = 0.87 and about 3 seconds per emitted kilobyte.
 * Nothing in the request bounded that size. The wire schema's `maxItems` and
 * `maxLength` do not reach the provider's structured-output decoder — a
 * section schema rebuilt with `evidence` capped at two still came back with
 * eight, four times out of four — and `maxOutputTokens` only truncates, which
 * at temperature 0 turns into the same unparseable object on every Activity
 * retry until the job dies. The prompt is therefore the only place a budget
 * can be stated, and stating it is what keeps a checkpoint bounded.
 */
const SECTION_BUDGET = Object.freeze({
  storyBeats: 8,
  characters: 8,
  locations: 6,
  plotThreads: 6,
  continuityFindings: 6,
  themes: 4,
  evidencePerFinding: 3,
  quoteChars: 200,
  analysisChars: 400,
  summaryChars: 800,
});
/**
 * What the model is actually asked to produce for one section — the wire shape
 * minus every `chunkId`.
 *
 * The activity already knows which section it dispatched. Making the model echo
 * that constant back, once at the top level and again inside every single
 * evidence quote, buys nothing and creates a failure mode: the wire schema
 * requires each evidence `chunkId` to equal the section's, so one mis-echoed id
 * anywhere in the response fails that whole section. It is deterministic per
 * section, so Temporal's retries reproduce it exactly, and on a 39-section
 * document a ~2.6% per-section rate means a majority of documents never finish.
 * Stamping the id we already hold makes the invariant true by construction.
 *
 * Caps mirror SECTION_BUDGET because that is what the prompt states; the wider
 * wire caps remain the outer contract that the stamped result is parsed against.
 */
const modelEvidenceSchema = z
  .object({ quote: z.string().trim().min(1).max(SECTION_BUDGET.quoteChars) })
  .strict();
const modelFindingSchema = z
  .object({
    label: z.string().trim().min(1).max(160),
    analysis: z.string().trim().min(1).max(SECTION_BUDGET.analysisChars),
    evidence: z.array(modelEvidenceSchema).min(1).max(SECTION_BUDGET.evidencePerFinding),
  })
  .strict();
const modelEntitySchema = z
  .object({
    name: z.string().trim().min(1).max(160),
    analysis: z.string().trim().min(1).max(SECTION_BUDGET.analysisChars),
    evidence: z.array(modelEvidenceSchema).min(1).max(SECTION_BUDGET.evidencePerFinding),
  })
  .strict();
const modelSectionAnalysisSchema = z
  .object({
    schemaVersion: z.literal("agent-document-section-analysis/v1"),
    heading: z.string().max(240).nullable(),
    summary: z.string().trim().min(1).max(SECTION_BUDGET.summaryChars),
    storyBeats: z.array(modelFindingSchema).max(SECTION_BUDGET.storyBeats),
    characters: z.array(modelEntitySchema).max(SECTION_BUDGET.characters),
    locations: z.array(modelEntitySchema).max(SECTION_BUDGET.locations),
    plotThreads: z.array(modelFindingSchema).max(SECTION_BUDGET.plotThreads),
    continuityFindings: z.array(modelFindingSchema).max(SECTION_BUDGET.continuityFindings),
    themes: z.array(modelFindingSchema).max(SECTION_BUDGET.themes),
  })
  .strict();

type ModelSectionAnalysis = z.infer<typeof modelSectionAnalysisSchema>;

/** Restores the wire shape by stamping the dispatched section's identity. */
export function stampSectionChunkId(
  analysis: ModelSectionAnalysis,
  chunkId: string
): Record<string, unknown> {
  const cite = <T extends { evidence: ReadonlyArray<{ quote: string }> }>(finding: T) => ({
    ...finding,
    evidence: finding.evidence.map((item) => ({ chunkId, quote: item.quote })),
  });
  return {
    ...analysis,
    chunkId,
    storyBeats: analysis.storyBeats.map(cite),
    characters: analysis.characters.map(cite),
    locations: analysis.locations.map(cite),
    plotThreads: analysis.plotThreads.map(cite),
    continuityFindings: analysis.continuityFindings.map(cite),
    themes: analysis.themes.map(cite),
  };
}

const SYNTHESIS_BUDGET = Object.freeze({
  entriesPerArray: 24,
  evidencePerEntry: 3,
  analysisChars: 600,
});
const FINAL_BUDGET = Object.freeze({
  entriesPerArray: 24,
  evidencePerEntry: 3,
  analysisChars: 800,
});
// Mapping a bounded section is extraction, not deliberation: measured against
// the reasoning model an unbounded budget spent ~1,700 thinking tokens per
// section for the same answer and nearly doubled the section's wall clock.
// Reductions merge up to eight checkpoints and do earn a real budget. 128 is
// the smallest budget every Gemini 2.5 tier accepts.
const MAP_THINKING_TOKENS = 128;
const SYNTHESIS_THINKING_TOKENS = 2_048;
// Every field across the three checkpoint schemas that holds evidence-backed
// findings. Absent fields are skipped, so one pass covers all three shapes.
const EVIDENCE_FIELDS = [
  "storyBeats",
  "storyStructure",
  "characters",
  "locations",
  "plotThreads",
  "continuityFindings",
  "themes",
  "productionRecommendations",
] as const;
// Decoration a model adds around an excerpt it lifts out of a longer quoted
// line. Sentence punctuation is deliberately absent: trimming it would quietly
// shorten a citation that is wrong for some other reason.
const QUOTE_DECORATION = new Set([
  '"',
  "'",
  "“",
  "”",
  "‘",
  "’",
  "「",
  "」",
  "『",
  "』",
  "…",
  " ",
  "\t",
  "\n",
  "\r",
]);
const MAX_QUOTE_TRIM_CHARS = 2;
// An elided citation reads "<verbatim span>…<verbatim span>". Splitting on the
// marker recovers real spans; the floor keeps a fragment like "灶神：「" out of
// the record, because a four character stub anchors nothing.
const QUOTE_ELISION_PATTERN = /…+|\.{3,}|。{3,}/u;
const MIN_ELIDED_QUOTE_CHARS = 8;

type EvidenceItem = Readonly<{ chunkId: string; quote: string }>;
type EvidenceFinding = Readonly<{ evidence: readonly EvidenceItem[] }>;
type SourceQuoteIndex = ReadonlyMap<string, readonly string[]>;

export async function claimLongDocumentAnalysisActivity(
  rawInput: Readonly<{ schemaVersion: string; jobId: string }>
): Promise<LongDocumentManifest> {
  const input = longDocumentWorkflowInputSchema.parse(rawInput);
  return runDocumentActivity("claim", () =>
    getRuntimeDependencies().domainGateway.claimLongDocumentAnalysis({
      jobId: input.jobId,
      signal: Context.current().cancellationSignal,
    })
  );
}

export async function mapLongDocumentSectionActivity(
  rawInput: LongDocumentMapActivityInput
): Promise<LongDocumentArtifactRef> {
  const input = longDocumentMapActivityInputSchema.parse(rawInput);
  return runDocumentActivity("map", async () => {
    const { domainGateway, longDocumentAnalyst } = getRuntimeDependencies();
    const context = await domainGateway.readLongDocumentSection({
      jobId: input.jobId,
      chunkId: input.chunkId,
      signal: Context.current().cancellationSignal,
    });
    if (context.section.ordinal !== input.ordinal) {
      throw ApplicationFailure.nonRetryable(
        "The indexed source section ordinal changed during analysis.",
        "AGENT_DOCUMENT_ANALYSIS_INDEX_CHANGED"
      );
    }
    const analysis = AgentDocumentSectionAnalysisSchema.parse(
      stampSectionChunkId(
        modelSectionAnalysisSchema.parse(
          await longDocumentAnalyst.generateStructured({
            prompt: [
              `Analysis locale: ${context.locale}`,
              `Document: ${context.document.title}`,
              `Document format: ${context.document.format}`,
              `Section ${input.ordinal + 1}/${context.document.chunkCount}`,
              `Heading: ${context.section.heading ?? "(none)"}`,
              "",
              "Output budget for this section — stay inside it:",
              `at most ${SECTION_BUDGET.storyBeats} storyBeats, ${SECTION_BUDGET.characters} characters, ` +
                `${SECTION_BUDGET.locations} locations, ${SECTION_BUDGET.plotThreads} plotThreads, ` +
                `${SECTION_BUDGET.continuityFindings} continuityFindings, ${SECTION_BUDGET.themes} themes;`,
              `at most ${SECTION_BUDGET.evidencePerFinding} evidence quotes per finding and at most ` +
                `${SECTION_BUDGET.quoteChars} characters per quote;`,
              `at most ${SECTION_BUDGET.analysisChars} characters per analysis and ` +
                `${SECTION_BUDGET.summaryChars} characters for summary.`,
              "Report only what this section actually establishes; do not pad to the budget.",
              "",
              "Analyze this bounded source section. Cite exact quotes from this section for every finding.",
              "<source-section>",
              context.section.text,
              "</source-section>",
            ].join("\n"),
            schema: modelSectionAnalysisSchema,
            stage: "extract",
            maxOutputTokens: MAP_OUTPUT_TOKENS,
            thinkingBudgetTokens: MAP_THINKING_TOKENS,
            signal: Context.current().cancellationSignal,
          })
        ),
        context.section.chunkId
      )
    );
    // No "did the model answer about the right section?" guard here any more:
    // identity is stamped from the section this activity fetched, so it cannot
    // disagree. The ordinal check above is what still proves the fetched
    // section is the one the workflow asked for.
    const content = AgentDocumentSectionAnalysisSchema.parse(
      alignCheckpointEvidence(
        analysis,
        new Map([[context.section.chunkId, [context.section.text]]])
      )
    );
    return domainGateway.writeLongDocumentArtifact({
      artifact: {
        schemaVersion: "agent-long-document-artifact-write/v1",
        jobId: input.jobId,
        kind: "section",
        level: 0,
        ordinal: input.ordinal,
        sourceChunkIds: [input.chunkId],
        inputArtifactIds: [],
        content,
      },
      signal: Context.current().cancellationSignal,
    });
  });
}

export async function reduceLongDocumentAnalysisActivity(
  rawInput: LongDocumentReduceActivityInput
): Promise<LongDocumentArtifactRef> {
  const input = longDocumentReduceActivityInputSchema.parse(rawInput);
  return runDocumentActivity("reduce", async () => {
    const { domainGateway, longDocumentAnalyst } = getRuntimeDependencies();
    const context = await domainGateway.readLongDocumentArtifacts({
      jobId: input.jobId,
      artifactIds: input.inputArtifactIds,
      signal: Context.current().cancellationSignal,
    });
    const sourceChunkIds = uniqueOrdered(
      context.artifacts.flatMap((artifact) => artifact.sourceChunkIds)
    );
    const synthesis = AgentDocumentSynthesisSchema.parse(
      await longDocumentAnalyst.generateStructured({
        prompt: [
          `Reduction level: ${input.level}`,
          `Input checkpoint count: ${context.artifacts.length}`,
          "",
          "Output budget — the merge is a compression, not a concatenation. Emit at most " +
            `${SYNTHESIS_BUDGET.entriesPerArray} entries per array,`,
          `at most ${SYNTHESIS_BUDGET.evidencePerEntry} evidence quotes per entry, and at most ` +
            `${SYNTHESIS_BUDGET.analysisChars} characters per analysis.`,
          "When the inputs exceed the budget, merge overlapping findings and keep the strongest evidence for each.",
          "",
          "Merge all checkpoint findings into one loss-minimizing synthesis.",
          "Preserve exact evidence quotes and chunk IDs; remove only true duplicates.",
          "<checkpoint-artifacts>",
          JSON.stringify(context.artifacts.map((artifact) => artifact.content)),
          "</checkpoint-artifacts>",
        ].join("\n"),
        schema: AgentDocumentSynthesisSchema,
        stage: "synthesize",
        maxOutputTokens: REDUCE_OUTPUT_TOKENS,
        thinkingBudgetTokens: SYNTHESIS_THINKING_TOKENS,
        signal: Context.current().cancellationSignal,
      })
    );
    if (synthesis.level !== input.level) {
      throw ApplicationFailure.nonRetryable(
        "The model returned a synthesis for a different reduction level.",
        "AGENT_DOCUMENT_ANALYSIS_REDUCE_LEVEL_INVALID"
      );
    }
    const content = AgentDocumentSynthesisSchema.parse(
      alignCheckpointEvidence(
        synthesis,
        checkpointQuoteIndex(context.artifacts.map((artifact) => artifact.content))
      )
    );
    return domainGateway.writeLongDocumentArtifact({
      artifact: {
        schemaVersion: "agent-long-document-artifact-write/v1",
        jobId: input.jobId,
        kind: "reduce",
        level: input.level,
        ordinal: input.ordinal,
        sourceChunkIds,
        inputArtifactIds: [...input.inputArtifactIds],
        content,
      },
      signal: Context.current().cancellationSignal,
    });
  });
}

export async function finalizeLongDocumentAnalysisActivity(
  rawInput: LongDocumentFinalizeActivityInput
): Promise<LongDocumentArtifactRef> {
  const input = longDocumentFinalizeActivityInputSchema.parse(rawInput);
  return runDocumentActivity("finalize", async () => {
    const { domainGateway, longDocumentAnalyst } = getRuntimeDependencies();
    const context = await domainGateway.readLongDocumentArtifacts({
      jobId: input.jobId,
      artifactIds: [input.inputArtifactId],
      signal: Context.current().cancellationSignal,
    });
    const source = context.artifacts[0];
    if (!source || source.sourceChunkIds.length !== input.chunkCount) {
      throw ApplicationFailure.nonRetryable(
        "The final checkpoint does not cover the complete source index.",
        "AGENT_DOCUMENT_ANALYSIS_COVERAGE_INCOMPLETE"
      );
    }
    const analysis = AgentDocumentFinalAnalysisSchema.parse(
      await longDocumentAnalyst.generateStructured({
        prompt: [
          `Source chunk count: ${input.chunkCount}`,
          "",
          `Output budget — emit at most ${FINAL_BUDGET.entriesPerArray} entries per array, at most ` +
            `${FINAL_BUDGET.evidencePerEntry} evidence quotes per entry,`,
          `and at most ${FINAL_BUDGET.analysisChars} characters per analysis. Merge overlapping ` +
            "findings rather than truncating the report.",
          "",
          "Produce the final exhaustive, creator-facing document analysis.",
          "Preserve exact evidence quotes and chunk IDs from the source checkpoint.",
          "Set sourceCoverage chunkCount and analyzedChunkCount to the supplied count, with no missing chunks.",
          "<root-checkpoint>",
          JSON.stringify(source.content),
          "</root-checkpoint>",
        ].join("\n"),
        schema: AgentDocumentFinalAnalysisSchema,
        stage: "synthesize",
        maxOutputTokens: FINAL_OUTPUT_TOKENS,
        thinkingBudgetTokens: SYNTHESIS_THINKING_TOKENS,
        signal: Context.current().cancellationSignal,
      })
    );
    if (
      analysis.sourceCoverage.chunkCount !== input.chunkCount ||
      analysis.sourceCoverage.analyzedChunkCount !== input.chunkCount
    ) {
      throw ApplicationFailure.nonRetryable(
        "The final analysis reported incomplete source coverage.",
        "AGENT_DOCUMENT_ANALYSIS_COVERAGE_INCOMPLETE"
      );
    }
    const content = AgentDocumentFinalAnalysisSchema.parse(
      alignCheckpointEvidence(analysis, checkpointQuoteIndex([source.content]))
    );
    return domainGateway.writeLongDocumentArtifact({
      artifact: {
        schemaVersion: "agent-long-document-artifact-write/v1",
        jobId: input.jobId,
        kind: "final",
        level: input.level,
        ordinal: 0,
        sourceChunkIds: source.sourceChunkIds,
        inputArtifactIds: [source.artifactId],
        content,
      },
      signal: Context.current().cancellationSignal,
    });
  });
}

export async function completeLongDocumentAnalysisActivity(
  rawInput: LongDocumentCompleteActivityInput
): Promise<LongDocumentArtifactRef> {
  const input = longDocumentCompleteActivityInputSchema.parse(rawInput);
  return runDocumentActivity("complete", () =>
    getRuntimeDependencies().domainGateway.completeLongDocumentAnalysis({
      jobId: input.jobId,
      finalArtifactId: input.finalArtifactId,
      signal: Context.current().cancellationSignal,
    })
  );
}

export async function failLongDocumentAnalysisActivity(
  rawInput: LongDocumentFailActivityInput
): Promise<void> {
  const input = longDocumentFailActivityInputSchema.parse(rawInput);
  return runDocumentActivity("fail", () =>
    getRuntimeDependencies().domainGateway.failLongDocumentAnalysis({
      jobId: input.jobId,
      error: input.error,
      signal: Context.current().cancellationSignal,
    })
  );
}

async function runDocumentActivity<T>(stage: string, operation: () => Promise<T>): Promise<T> {
  const context = Context.current();
  context.heartbeat({ stage });
  const heartbeat = setInterval(() => context.heartbeat({ stage }), ACTIVITY_HEARTBEAT_INTERVAL_MS);
  heartbeat.unref();
  try {
    return await operation();
  } catch (error) {
    if (context.cancellationSignal.aborted) throw error;
    if (error instanceof ApplicationFailure) throw error;
    if (error instanceof DomainDocumentAnalysisError) {
      if (!error.retryable && !isCorrectableCheckpointError(error.code)) {
        throw ApplicationFailure.nonRetryable(error.message, error.code);
      }
      throw ApplicationFailure.create({
        message: error.message,
        type: error.code,
        nonRetryable: false,
        cause: error,
      });
    }
    if (error instanceof DomainGatewayUnavailableError) throw error;
    throw ApplicationFailure.create({
      message: "Long-document analysis activity failed.",
      type: "AGENT_DOCUMENT_ANALYSIS_ACTIVITY_FAILED",
      nonRetryable: false,
      cause: error instanceof Error ? error : undefined,
    });
  } finally {
    clearInterval(heartbeat);
  }
}

function uniqueOrdered(values: readonly string[]): string[] {
  return [...new Set(values)];
}

/**
 * Rewrites every citation in a checkpoint to a span that provably occurs in its
 * own source, and drops the ones that cannot be located.
 *
 * The product gateway rejects an entire checkpoint when a single quote is not a
 * literal substring of the chunk it cites, and the models produce one specific
 * near-miss constantly: an excerpt lifted out of a longer quoted line comes back
 * with the opening or closing quotation mark re-attached. Checkpoints run at
 * temperature 0, so every Activity retry reproduces the same near-miss and one
 * dialogue-heavy section exhausts its retry budget and takes the whole
 * hours-long job with it. Deciding this where the source text is in hand keeps
 * the citation verbatim instead of losing the section.
 */
function alignCheckpointEvidence<T extends object>(content: T, sources: SourceQuoteIndex): T {
  const aligned = { ...content } as Record<string, unknown>;
  for (const field of EVIDENCE_FIELDS) {
    const findings = aligned[field];
    if (!Array.isArray(findings)) continue;
    aligned[field] = (findings as readonly EvidenceFinding[]).flatMap((finding) => {
      const evidence = finding.evidence.flatMap((item) => {
        const quote = alignQuote(item.quote, sources.get(item.chunkId) ?? []);
        return quote === null ? [] : [{ ...item, quote }];
      });
      return evidence.length === 0 ? [] : [{ ...finding, evidence }];
    });
  }
  return aligned as T;
}

function alignQuote(quote: string, sources: readonly string[]): string | null {
  // The gateway compares NFC-normalized text, so normalize before matching:
  // an alignment that only holds in one normal form is not an alignment.
  const normalized = quote.normalize("NFC");
  const candidates = sources.map((source) => source.normalize("NFC"));
  const whole = alignSpan(normalized, candidates);
  if (whole !== null) return whole;
  // The citation elides its own middle. Both halves are real source spans, and
  // the longer one still anchors the finding, so keep it instead of losing the
  // citation to a span that was never contiguous in the first place.
  let longest: string | null = null;
  for (const span of normalized.split(QUOTE_ELISION_PATTERN)) {
    if (span.length < MIN_ELIDED_QUOTE_CHARS) continue;
    const aligned = alignSpan(span, candidates);
    if (aligned !== null && aligned.length > (longest?.length ?? 0)) longest = aligned;
  }
  return longest;
}

function alignSpan(span: string, candidates: readonly string[]): string | null {
  // Widen the trim one character at a time so the accepted span is the longest
  // one that matches, and only ever give up decoration the model added.
  for (let trimmed = 0; trimmed <= MAX_QUOTE_TRIM_CHARS * 2; trimmed += 1) {
    for (let lead = Math.max(0, trimmed - MAX_QUOTE_TRIM_CHARS); lead <= trimmed; lead += 1) {
      const end = span.length - (trimmed - lead);
      if (lead > MAX_QUOTE_TRIM_CHARS || end <= lead) continue;
      if (!isDecoration(span.slice(0, lead)) || !isDecoration(span.slice(end))) continue;
      const attempt = span.slice(lead, end);
      if (candidates.some((source) => source.includes(attempt))) return attempt;
    }
  }
  return null;
}

function isDecoration(value: string): boolean {
  return [...value].every((character) => QUOTE_DECORATION.has(character));
}

/**
 * The reference text a reduction's citations must come from.
 *
 * A reduction never sees the source document, only checkpoints whose quotes are
 * already verbatim spans of the chunks they name. A quote that occurs inside an
 * input quote for the same chunk therefore occurs in that chunk.
 */
function checkpointQuoteIndex(contents: readonly unknown[]): SourceQuoteIndex {
  const index = new Map<string, string[]>();
  for (const content of contents) {
    const fields = (content ?? {}) as Record<string, unknown>;
    for (const field of EVIDENCE_FIELDS) {
      const findings = fields[field];
      if (!Array.isArray(findings)) continue;
      for (const finding of findings as readonly EvidenceFinding[]) {
        for (const item of finding.evidence) {
          const quotes = index.get(item.chunkId);
          if (quotes) quotes.push(item.quote);
          else index.set(item.chunkId, [item.quote]);
        }
      }
    }
  }
  return index;
}

function isCorrectableCheckpointError(code: string): boolean {
  return new Set([
    "AGENT_DOCUMENT_ANALYSIS_EVIDENCE_INVALID",
    "AGENT_DOCUMENT_ANALYSIS_ARTIFACT_TOO_LARGE",
  ]).has(code);
}
