import {
  collectInteractiveFilmRuntimeLocales,
  FilmClipSpecSchema,
  FilmSpecSchema,
  FilmTrailerSpecSchema,
  findInteractiveFilmRuntimeLocaleCoverageIssues,
  type FilmClipSpec,
  type FilmSpec,
  type FilmTrailerSpec,
  type InteractiveFilmDraftContent,
  type StoryClipPromptDraft,
  type StoryTrailerPromptDraft,
} from './interactive-film.schema';
import { STORY_FRAME_PROFILE_CONTRACTS, type StoryFrameProfile } from './dto';

const DEFAULT_FRAMES_PER_SECOND = 24;
const DEFAULT_AUDIO_SAMPLE_RATE_HZ = 48_000 as const;

export interface StoryFilmRevisionProjection {
  filmSpec: FilmSpec;
  clipSpecs: FilmClipSpec[];
  trailerSpec: FilmTrailerSpec | null;
}

export interface StoryFilmDraftClipProjectionInput {
  draft: InteractiveFilmDraftContent;
  frameProfile: StoryFrameProfile;
  graphNodeId: string;
}

/**
 * Projects exactly one saved draft clip for generation. Unlike a Build
 * projection this intentionally does not validate the rest of the story:
 * creators may produce an individual shot while neighbouring branches are
 * still being written. FilmClipSpecSchema remains the strict production gate
 * for the selected shot, so no placeholder prompt or output contract can
 * reach a provider.
 */
export function projectStoryFilmDraftClip(
  input: StoryFilmDraftClipProjectionInput,
): FilmClipSpec {
  const frame = STORY_FRAME_PROFILE_CONTRACTS[input.frameProfile];
  const clipNodes = input.draft.graph.nodes.filter(
    (node) => node.kind === 'clip',
  );
  const node = clipNodes.find(
    (candidate) => candidate.nodeId === input.graphNodeId,
  );
  if (!node) {
    throw new Error(`Draft clip node ${input.graphNodeId} was not found.`);
  }
  const prompt = input.draft.clipPrompts.find(
    (candidate) => candidate.graphNodeId === node.nodeId,
  );
  if (!prompt) {
    throw new Error(`Draft clip ${input.graphNodeId} has no director prompt.`);
  }
  const openingNodeIds = collectOpeningClipNodeIds(input.draft);
  const rank = clipNodes.findIndex(
    (candidate) => candidate.nodeId === node.nodeId,
  );
  return FilmClipSpecSchema.parse({
    key: node.clipKey,
    graphNodeId: node.nodeId,
    kind: openingNodeIds.has(node.nodeId)
      ? 'opening'
      : node.exit.kind === 'ending'
        ? 'ending'
        : 'scene',
    title: prompt.title,
    description: prompt.description,
    rank,
    targetDurationMs: prompt.targetDurationMs,
    generationControl: prompt.generationControl,
    prompt: {
      masterPrompt: compileStoryDirectorPrompt(prompt),
      negativeConstraints: prompt.negativeConstraints,
      timeline: prompt.beats.map((beat) => ({
        startMs: beat.startMs,
        endMs: beat.endMs,
        visual: beat.visual,
        camera: beat.camera,
        action: beat.action,
        ...(beat.performance.trim() ? { performance: beat.performance } : {}),
        ...(beat.emotion.trim() ? { emotion: beat.emotion } : {}),
        ...(beat.dialogue.trim() ? { dialogue: beat.dialogue } : {}),
        ...(beat.audio.trim() ? { audio: beat.audio } : {}),
        ...(beat.endState.trim() ? { endState: beat.endState } : {}),
        ...(beat.continuity.trim() ? { continuity: beat.continuity } : {}),
      })),
    },
    dialogueWindows: [],
    outputContract: {
      ...frame,
      durationMs: prompt.targetDurationMs,
      durationToleranceMs: 0,
      framesPerSecond: {
        numerator: DEFAULT_FRAMES_PER_SECOND,
        denominator: 1,
      },
      audio: 'embedded',
    },
    continuityNotes: prompt.continuityNotes,
  });
}

/**
 * Deterministically projects an immutable interactive-film revision into the
 * production plane. The projector accepts no database rows and invents no
 * media assets: reference slots/bindings are resolved separately only when a
 * real approved asset identity exists.
 */
export function projectStoryFilmRevision(input: {
  draft: InteractiveFilmDraftContent;
  frameProfile: StoryFrameProfile;
  defaultLocale: string;
  defaultCanonicalModelId: string;
}): StoryFilmRevisionProjection {
  const frame = STORY_FRAME_PROFILE_CONTRACTS[input.frameProfile];
  const clipNodes = input.draft.graph.nodes.filter(
    (node) => node.kind === 'clip',
  );
  const clipSpecs = clipNodes.map((node) =>
    projectStoryFilmDraftClip({
      draft: input.draft,
      frameProfile: input.frameProfile,
      graphNodeId: node.nodeId,
    }),
  );

  const durationContract = calculatePlaybackDurationContract(
    input.draft,
    new Map(clipSpecs.map((clip) => [clip.graphNodeId, clip.targetDurationMs])),
    new Map(clipSpecs.map((clip) => [clip.key, clip.targetDurationMs])),
  );
  const maxClipDurationMs = Math.max(
    ...clipSpecs.map((clip) => clip.targetDurationMs),
  );
  const enabledLocales = collectEnabledLocales(
    input.draft,
    input.defaultLocale,
  );
  const localeCoverageIssues = findInteractiveFilmRuntimeLocaleCoverageIssues(
    input.draft,
    enabledLocales,
  );
  if (localeCoverageIssues.length > 0) {
    const issue = localeCoverageIssues[0];
    throw new Error(
      `Runtime locale coverage is incomplete at ${issue.path.join('.')}: provide non-empty ${issue.locale} copy.`,
    );
  }
  const targetChoiceCount = new Set(
    input.draft.graph.nodes.flatMap((node) =>
      node.exit.kind === 'choice' ? [node.exit.decisionId] : [],
    ),
  ).size;
  const trailerSpec = input.draft.trailerPrompt
    ? FilmTrailerSpecSchema.parse({
        schemaVersion: 1,
        title: input.draft.trailerPrompt.title,
        description: input.draft.trailerPrompt.description,
        targetDurationMs: input.draft.trailerPrompt.targetDurationMs,
        generationControl: input.draft.trailerPrompt.generationControl,
        referenceRoleNotes: input.draft.trailerPrompt.referenceRoleNotes,
        prompt: {
          masterPrompt: compileStoryTrailerPrompt(input.draft.trailerPrompt),
          negativeConstraints: input.draft.trailerPrompt.negativeConstraints,
          timeline: input.draft.trailerPrompt.beats.map((beat) => ({
            startMs: beat.startMs,
            endMs: beat.endMs,
            visual: beat.visual,
            camera: beat.camera,
            action: beat.action,
            ...(beat.performance.trim()
              ? { performance: beat.performance }
              : {}),
            ...(beat.emotion.trim() ? { emotion: beat.emotion } : {}),
            ...(beat.dialogue.trim() ? { dialogue: beat.dialogue } : {}),
            ...(beat.audio.trim() ? { audio: beat.audio } : {}),
            ...(beat.endState.trim() ? { endState: beat.endState } : {}),
            ...(beat.continuity.trim() ? { continuity: beat.continuity } : {}),
          })),
        },
        outputContract: {
          ...frame,
          durationMs: input.draft.trailerPrompt.targetDurationMs,
          durationToleranceMs: 0,
          framesPerSecond: {
            numerator: DEFAULT_FRAMES_PER_SECOND,
            denominator: 1,
          },
          audio: 'embedded',
        },
        continuityNotes: input.draft.trailerPrompt.continuityNotes,
      })
    : null;

  return {
    filmSpec: FilmSpecSchema.parse({
      runtimeSchemaVersion: 1,
      frame: {
        ...frame,
        framesPerSecond: {
          numerator: DEFAULT_FRAMES_PER_SECOND,
          denominator: 1,
        },
      },
      audioSampleRateHz: DEFAULT_AUDIO_SAMPLE_RATE_HZ,
      duration: {
        targetMs: durationContract.targetMs,
        toleranceMs: durationContract.toleranceMs,
        maxContinuousMs: durationContract.maxContinuousMs,
        maxGeneratedClipMs: maxClipDurationMs,
      },
      targets: {
        clipCount: clipSpecs.length,
        choiceCount: targetChoiceCount,
        endingCount: input.draft.storyBible.endings.length,
      },
      locales: {
        defaultLocale: input.defaultLocale,
        enabledLocales,
      },
      generation: {
        defaultCanonicalModelId: input.defaultCanonicalModelId,
      },
    }),
    clipSpecs,
    trailerSpec,
  };
}

function collectOpeningClipNodeIds(
  draft: InteractiveFilmDraftContent,
): Set<string> {
  const result = new Set<string>();
  const byId = new Map(draft.graph.nodes.map((node) => [node.nodeId, node]));
  const visitedRouters = new Set<string>();

  const visit = (nodeId: string): void => {
    const node = byId.get(nodeId);
    if (!node) return;
    if (node.kind === 'clip') {
      result.add(node.nodeId);
      return;
    }
    if (visitedRouters.has(node.nodeId)) return;
    visitedRouters.add(node.nodeId);
    node.exit.routes.forEach((route) => visit(route.nextNodeId));
  };

  if (draft.graph.entryNodeId) visit(draft.graph.entryNodeId);
  return result;
}

function calculatePlaybackDurationContract(
  draft: InteractiveFilmDraftContent,
  durationByNodeId: Map<string, number>,
  durationByClipKey: Map<string, number>,
): { targetMs: number; toleranceMs: number; maxContinuousMs: number } {
  const byId = new Map(draft.graph.nodes.map((node) => [node.nodeId, node]));
  const memo = new Map<
    string,
    {
      minTotalMs: number;
      maxTotalMs: number;
      prefixMs: number;
      maxContinuousMs: number;
    }
  >();
  const visiting = new Set<string>();

  const visit = (
    nodeId: string,
  ): {
    minTotalMs: number;
    maxTotalMs: number;
    prefixMs: number;
    maxContinuousMs: number;
  } => {
    const cached = memo.get(nodeId);
    if (cached !== undefined) return cached;
    if (visiting.has(nodeId)) {
      throw new Error(`Interactive-film graph contains a cycle at ${nodeId}.`);
    }
    const node = byId.get(nodeId);
    if (!node) throw new Error(`Interactive-film graph references ${nodeId}.`);
    visiting.add(nodeId);
    const ownDurationMs = durationByNodeId.get(nodeId) ?? 0;
    let result: {
      minTotalMs: number;
      maxTotalMs: number;
      prefixMs: number;
      maxContinuousMs: number;
    };
    if (node.exit.kind === 'ending') {
      result = {
        minTotalMs: ownDurationMs,
        maxTotalMs: ownDurationMs,
        prefixMs: ownDurationMs,
        maxContinuousMs: ownDurationMs,
      };
    } else if (node.exit.kind === 'auto') {
      const successors = node.exit.routes.map((route) =>
        visit(route.nextNodeId),
      );
      result = successors.reduce(
        (current, successor) => ({
          minTotalMs: Math.min(
            current.minTotalMs,
            ownDurationMs + successor.minTotalMs,
          ),
          maxTotalMs: Math.max(
            current.maxTotalMs,
            ownDurationMs + successor.maxTotalMs,
          ),
          prefixMs: Math.max(
            current.prefixMs,
            ownDurationMs + successor.prefixMs,
          ),
          maxContinuousMs: Math.max(
            current.maxContinuousMs,
            ownDurationMs + successor.prefixMs,
            successor.maxContinuousMs,
          ),
        }),
        {
          minTotalMs: Number.POSITIVE_INFINITY,
          maxTotalMs: ownDurationMs,
          prefixMs: ownDurationMs,
          maxContinuousMs: ownDurationMs,
        },
      );
    } else if (node.exit.kind === 'checkpoint') {
      // A checkpoint is an explicit interaction after this clip. It preserves
      // total path duration while starting a fresh uninterrupted segment at
      // its successor.
      const successor = visit(node.exit.nextNodeId);
      result = {
        minTotalMs: ownDurationMs + successor.minTotalMs,
        maxTotalMs: ownDurationMs + successor.maxTotalMs,
        prefixMs: ownDurationMs,
        maxContinuousMs: Math.max(ownDurationMs, successor.maxContinuousMs),
      };
    } else {
      // The decision UI is an interaction boundary after this node. A reaction
      // video starts the next uninterrupted segment and may run directly into
      // the selected successor before another decision is shown.
      result = node.exit.choices.reduce(
        (current, choice) => {
          const successor = visit(choice.nextNodeId);
          const reactionDurationMs =
            choice.afterSelect.kind === 'play'
              ? (durationByClipKey.get(choice.afterSelect.reactionClipKey) ?? 0)
              : 0;
          return {
            minTotalMs: Math.min(
              current.minTotalMs,
              ownDurationMs + reactionDurationMs + successor.minTotalMs,
            ),
            maxTotalMs: Math.max(
              current.maxTotalMs,
              ownDurationMs + reactionDurationMs + successor.maxTotalMs,
            ),
            prefixMs: ownDurationMs,
            maxContinuousMs: Math.max(
              current.maxContinuousMs,
              ownDurationMs,
              reactionDurationMs + successor.prefixMs,
              successor.maxContinuousMs,
            ),
          };
        },
        {
          minTotalMs: Number.POSITIVE_INFINITY,
          maxTotalMs: ownDurationMs,
          prefixMs: ownDurationMs,
          maxContinuousMs: ownDurationMs,
        },
      );
    }
    visiting.delete(nodeId);
    memo.set(nodeId, result);
    return result;
  };

  if (!draft.graph.entryNodeId) {
    throw new Error('Interactive-film graph has no entry node.');
  }
  const result = visit(draft.graph.entryNodeId);
  const minTotalMs = Number.isFinite(result.minTotalMs)
    ? result.minTotalMs
    : result.maxTotalMs;
  const targetMs = Math.floor((minTotalMs + result.maxTotalMs) / 2);
  return {
    targetMs,
    toleranceMs: Math.max(targetMs - minTotalMs, result.maxTotalMs - targetMs),
    maxContinuousMs: result.maxContinuousMs,
  };
}

function collectEnabledLocales(
  draft: InteractiveFilmDraftContent,
  defaultLocale: string,
): string[] {
  return collectInteractiveFilmRuntimeLocales(draft, defaultLocale);
}

/** Global direction only; timed beats remain structured and are compiled once. */
export function compileStoryDirectorPrompt(
  prompt: StoryClipPromptDraft,
): string {
  return compileGlobalDirectorPrompt(prompt);
}

export function compileStoryTrailerPrompt(
  prompt: StoryTrailerPromptDraft,
): string {
  return [
    compileGlobalDirectorPrompt(prompt),
    ...prompt.referenceRoleNotes.map(
      (reference) =>
        `Reference ${reference.role} ${reference.referenceId}: ${reference.note.trim()}`,
    ),
  ]
    .filter(Boolean)
    .join('\n');
}

function compileGlobalDirectorPrompt(prompt: {
  masterDirection: string;
  emotionalArc: string;
}): string {
  return [
    prompt.masterDirection.trim(),
    prompt.emotionalArc.trim()
      ? `Emotional arc: ${prompt.emotionalArc.trim()}`
      : '',
  ]
    .filter(Boolean)
    .join('\n');
}
