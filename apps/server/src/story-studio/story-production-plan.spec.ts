import { BadRequestException, NotFoundException } from '@nestjs/common';
import { MediaAssetKind, StoryProductionSpecStatus } from '@prisma/client';
import * as Y from 'yjs';
import {
  STORY_PRODUCTION_PLAN_SCHEMA_VERSION,
  StoryProductionPlanSchema,
  type StoryProductionPlan,
} from '@repo/shared/story-production';
import {
  buildStoryScreenplayDocument,
  STORY_SCREENPLAY_SCHEMA_VERSION,
  StoryScreenplaySchema,
  type StoryScreenplay,
} from '@repo/shared/story-agent';
import { validateProductionPlanAgainstScreenplay } from './story-authoring-pipeline.service';
import { canonicalJsonHash } from './canonical-json';
import { InteractiveStoryDraftContentSchema } from './dto';
import {
  ArchiveStoryAssetSpecSchema,
  CreateStoryAssetSpecSchema,
  PatchStoryAssetSpecSchema,
  PatchStoryStoryboardClipSchema,
  PutStoryStoryboardTimelineSchema,
} from './story-production-plan.schema';
import {
  assertStoryboardClipMediaKind,
  resolveAgentStoryboardTimelineInput,
  resizeStoryboardTimelineClip,
  storyboardCueTimeAfterTimelineResize,
  storyboardClipSemanticPatch,
  storyAssetSemanticPatch,
  StoryProductionPlanService,
} from './story-production-plan.service';
import { readStoryScriptHead } from './story-script-stage';

function screenplay(): StoryScreenplay {
  return StoryScreenplaySchema.parse({
    schemaVersion: STORY_SCREENPLAY_SCHEMA_VERSION,
    storyLanguage: 'en-US',
    title: 'The Gate',
    logline: 'A courier reaches a sealed city.',
    synopsis: 'One final choice decides who escapes.',
    characters: [
      {
        id: 'character.courier',
        name: { 'en-US': 'The Courier' },
        summary: 'A sworn imperial courier.',
      },
    ],
    entrySceneId: 'scene.gate',
    scenes: [
      {
        nodeId: 'scene.gate',
        clipKey: 'GATE',
        name: 'At the gate',
        heading: 'EXT. CITY GATE - NIGHT',
        beat: 'The courier chooses a route.',
        action: 'Snow seals the road behind the courier.',
        dialogue: [],
        exit: {
          kind: 'choice',
          decisionId: 'decision.route',
          prompt: { 'en-US': 'Which route?' },
          choices: [
            {
              choiceId: 'choice.wait',
              label: { 'en-US': 'Wait' },
              nextNodeId: 'scene.wait',
            },
            {
              choiceId: 'choice.run',
              label: { 'en-US': 'Run' },
              nextNodeId: 'scene.run',
            },
          ],
        },
      },
      {
        nodeId: 'scene.wait',
        clipKey: 'WAIT',
        heading: 'EXT. CITY GATE - DAWN',
        beat: 'The gate opens.',
        action: 'The courier waits until dawn.',
        dialogue: [],
        exit: { kind: 'auto', nextNodeId: null },
      },
      {
        nodeId: 'scene.run',
        clipKey: 'RUN',
        heading: 'EXT. FROZEN MOAT - NIGHT',
        beat: 'The courier runs.',
        action: 'The courier crosses the frozen moat.',
        dialogue: [],
        exit: { kind: 'auto', nextNodeId: null },
      },
    ],
  });
}

function plan(): StoryProductionPlan {
  const nodes = ['scene.gate', 'scene.wait', 'scene.run'];
  return StoryProductionPlanSchema.parse({
    schemaVersion: STORY_PRODUCTION_PLAN_SCHEMA_VERSION,
    assetSpecs: [
      {
        stableKey: 'asset.character.courier',
        kind: 'character',
        name: 'The Courier',
        description: 'Imperial courier in a snow-dark cloak.',
        imagePrompt: 'Neutral full-body reference of the imperial courier.',
        sourceCharacterId: 'character.courier',
        sourceNodeIds: nodes,
      },
    ],
    storyboardSequences: nodes.map((plotNodeId) => ({
      plotNodeId,
      title: plotNodeId,
      description: `Footage of ${plotNodeId}.`,
      durationMs: 10_000,
      clips: [
        {
          stableKey: `shot.${plotNodeId}.main`,
          kind: 'video',
          title: plotNodeId,
          description: plotNodeId,
          startMs: 0,
          durationMs: 10_000,
          videoPrompt: `A cinematic rendering of ${plotNodeId} following @asset.character.courier.`,
        },
      ],
      cues:
        plotNodeId === 'scene.gate'
          ? [
              {
                stableKey: 'cue.scene.gate.route',
                kind: 'decision',
                atMs: 10_000,
                decisionId: 'decision.route',
              },
            ]
          : [],
    })),
  });
}

describe('validateProductionPlanAgainstScreenplay', () => {
  it('accepts one sequence per Plot node and a cue that only references Plot topology', () => {
    expect(
      validateProductionPlanAgainstScreenplay(plan(), screenplay()),
    ).toEqual([]);
  });

  it('rejects a mismatched decision cue without inventing a second graph', () => {
    const value = plan();
    value.storyboardSequences[0].cues[0].decisionId = 'decision.invented';
    expect(
      validateProductionPlanAgainstScreenplay(value, screenplay()).some(
        (issue) => issue.includes('exactly one cue'),
      ),
    ).toBe(true);
  });

  it('accepts Storyboard Specs after an explicitly approved empty Asset plan', () => {
    const value = plan();
    value.assetSpecs = [];
    for (const sequence of value.storyboardSequences) {
      for (const clip of sequence.clips) {
        if (clip.kind === 'video') {
          clip.videoPrompt = `A cinematic rendering of ${sequence.plotNodeId}.`;
        } else {
          clip.imagePrompt = `A cinematic rendering of ${sequence.plotNodeId}.`;
        }
      }
    }

    expect(
      validateProductionPlanAgainstScreenplay(value, screenplay()),
    ).toEqual([]);
  });

  it('still rejects an unknown @Asset mention when partial or empty Asset plans are allowed', () => {
    const value = plan();
    const clip = value.storyboardSequences[0].clips[0];
    if (clip.kind === 'video') {
      clip.videoPrompt = `${clip.videoPrompt} @asset.unknown`;
    } else {
      clip.imagePrompt = `${clip.imagePrompt} @asset.unknown`;
    }

    expect(
      validateProductionPlanAgainstScreenplay(value, screenplay()),
    ).toContain(
      `Storyboard clip "${clip.stableKey}" references unknown Asset Spec "asset.unknown".`,
    );
  });

  it('allows a scene to omit an Asset Spec that is only a planning hint', () => {
    const value = plan();
    const sequence = value.storyboardSequences[0];
    const clip = sequence.clips[0];
    if (clip.kind === 'video') {
      clip.videoPrompt = 'A cinematic rendering of the choice at the gate.';
    } else {
      clip.imagePrompt = 'A cinematic rendering of the choice at the gate.';
    }

    expect(
      validateProductionPlanAgainstScreenplay(value, screenplay()),
    ).toEqual([]);
  });

  it('still rejects a missing canonical character source', () => {
    const value = plan();
    value.assetSpecs[0].sourceNodeIds = ['scene.wait', 'scene.run'];
    value.assetSpecs[0].sourceCharacterId = 'character.unknown';
    const issues = validateProductionPlanAgainstScreenplay(value, screenplay());
    expect(issues.some((issue) => issue.includes('unknown character'))).toBe(
      true,
    );
  });
});

describe('StoryProductionPlanService canonical Plot coverage', () => {
  const service = new StoryProductionPlanService(
    null as never,
    null as never,
    null as never,
  );

  function chapterDraft(source: StoryScreenplay) {
    return {
      storyBible: {
        logline: source.logline,
        synopsis: source.synopsis,
        characters: source.characters,
      },
      graph: {
        entryNodeId: source.entrySceneId,
        nodes: source.scenes.map((scene) => ({
          kind: 'clip' as const,
          nodeId: scene.nodeId,
          clipKey: scene.clipKey,
          ...(scene.name ? { name: scene.name } : {}),
          description: `${scene.heading}\n\n${scene.action}`,
          interactions: [],
          exit: scene.exit,
        })),
      },
      productionNotes: [],
    };
  }

  it('fails loud instead of projecting a graph-only node as an unplanned Storyboard state', async () => {
    const source = screenplay();
    const prisma = {
      storyChapter: {
        findFirst: jest.fn().mockResolvedValue({ id: 'chapter-1' }),
        findFirstOrThrow: jest.fn().mockResolvedValue({
          nodeIds: source.scenes.map((scene) => scene.nodeId),
        }),
      },
      storyDraft: {
        findUniqueOrThrow: jest.fn().mockResolvedValue({
          content: chapterDraft(source),
        }),
      },
      storyStoryboardSequence: {
        findMany: jest.fn().mockResolvedValue([]),
      },
    };
    const permissions = {
      requireProject: jest.fn().mockResolvedValue(undefined),
    };
    const strictService = new StoryProductionPlanService(
      prisma as never,
      permissions as never,
      null as never,
    );

    await expect(
      strictService.getStoryboard(
        { userId: 'creator-1' } as never,
        'project-1',
        'chapter-1',
      ),
    ).rejects.toThrow(/Plot tree and Storyboard are not one-to-one/);
  });

  it('projects a slim version-free Storyboard view for the Agent tools', async () => {
    const source = screenplay();
    const gate = source.scenes[0];
    const prisma = {
      storyChapter: {
        findFirst: jest.fn().mockResolvedValue({ id: 'chapter-1' }),
        findFirstOrThrow: jest.fn().mockResolvedValue({
          nodeIds: source.scenes.map((scene) => scene.nodeId),
        }),
      },
      storyDraft: {
        findUniqueOrThrow: jest.fn().mockResolvedValue({
          content: chapterDraft(source),
        }),
      },
      storyStoryboardSequence: {
        findMany: jest.fn().mockResolvedValue(
          source.scenes.map((scene) => ({
            id: `sequence-${scene.nodeId}`,
            plotNodeId: scene.nodeId,
            description: `Footage of ${scene.nodeId}.`,
            suggestedDurationMs: 10_000,
            durationMs: 10_000,
            userModifiedAt: null,
            clips:
              scene.nodeId === gate.nodeId
                ? [
                    {
                      id: 'clip-gate-main',
                      stableKey: 'shot.scene.gate.main',
                      kind: 'video',
                      title: 'Gate',
                      description: null,
                      startMs: 0,
                      durationMs: 10_000,
                      imagePrompt: null,
                      videoPrompt: 'A cinematic rendering of the gate.',
                      negativePrompt: null,
                      userModifiedAt: null,
                    },
                  ]
                : [],
            cues:
              scene.nodeId === gate.nodeId
                ? [
                    {
                      id: 'cue-gate-route',
                      stableKey: 'cue.scene.gate.route',
                      kind: 'decision',
                      atMs: 10_000,
                      plotDecisionId: 'decision.route',
                    },
                  ]
                : [],
          })),
        ),
      },
    };
    const service = new StoryProductionPlanService(
      prisma as never,
      { requireProject: jest.fn().mockResolvedValue(undefined) } as never,
      null as never,
    );

    const view = await service.getStoryboardForAgent(
      { userId: 'creator-1' } as never,
      'project-1',
      'chapter-1',
    );

    expect(view.chapterId).toBe('chapter-1');
    expect(view.sequences).toHaveLength(source.scenes.length);
    const gateView = view.sequences[0];
    expect(gateView).toEqual({
      sequenceId: 'sequence-scene.gate',
      plotNodeId: 'scene.gate',
      description: 'Footage of scene.gate.',
      durationMs: 10_000,
      suggestedDurationMs: 10_000,
      userModifiedAt: null,
      clips: [
        {
          clipId: 'clip-gate-main',
          stableKey: 'shot.scene.gate.main',
          kind: 'video',
          title: 'Gate',
          description: null,
          startMs: 0,
          durationMs: 10_000,
          imagePrompt: null,
          videoPrompt: 'A cinematic rendering of the gate.',
          negativePrompt: null,
          userModifiedAt: null,
        },
      ],
      cues: [
        {
          cueId: 'cue-gate-route',
          stableKey: 'cue.scene.gate.route',
          kind: 'decision',
          atMs: 10_000,
          decisionId: 'decision.route',
        },
      ],
    });
    // Unplanned placeholders stay visible with zero clips.
    expect(view.sequences[1]?.clips).toEqual([]);
  });

  describe('resolveAgentStoryboardTimelineInput', () => {
    const liveClip = {
      id: '0197f4a2-0800-7000-8000-0000000000e1',
      version: 7,
      status: StoryProductionSpecStatus.current,
    };
    const archivedClip = {
      id: '0197f4a2-0800-7000-8000-0000000000e2',
      version: 2,
      status: StoryProductionSpecStatus.archived,
    };

    it('resolves CAS tokens from the current rows: retained clips keep their version, new clips start at zero', () => {
      const resolved = resolveAgentStoryboardTimelineInput(
        4,
        [liveClip, archivedClip],
        {
          durationMs: 6_000,
          clips: [
            {
              clipId: '0197f4a2-0800-7000-8000-0000000000e1',
              stableKey: 'shot.scene.gate.main',
              title: 'Gate',
              description: null,
              startMs: 0,
              durationMs: 2_000,
              kind: 'image',
              imagePrompt: 'A sealed gate in rain.',
            },
            {
              stableKey: 'shot.scene.gate.approach',
              title: 'Approach',
              description: null,
              startMs: 2_000,
              durationMs: 4_000,
              kind: 'video',
              videoPrompt: 'The courier crosses the square.',
            },
          ],
        },
      );

      expect(resolved.expectedVersion).toBe(4);
      expect(resolved.clips[0]).toMatchObject({
        id: '0197f4a2-0800-7000-8000-0000000000e1',
        expectedVersion: 7,
      });
      expect(resolved.clips[1]).toMatchObject({ expectedVersion: 0 });
    });

    it('rejects a clipId that is unknown or archived', () => {
      const base = {
        durationMs: 2_000,
        clips: [
          {
            clipId: '0197f4a2-0800-7000-8000-0000000000e1',
            stableKey: 'shot.scene.gate.main',
            title: 'Gate',
            description: null,
            startMs: 0,
            durationMs: 2_000,
            kind: 'image' as const,
            imagePrompt: 'A sealed gate in rain.',
          },
        ],
      };
      expect(() => resolveAgentStoryboardTimelineInput(1, [], base)).toThrow(
        NotFoundException,
      );
      expect(() =>
        resolveAgentStoryboardTimelineInput(1, [archivedClip], {
          ...base,
          clips: [
            {
              ...base.clips[0],
              clipId: archivedClip.id,
            },
          ],
        }),
      ).toThrow(NotFoundException);
    });

    it('re-validates continuity through the shared editor contract', () => {
      try {
        resolveAgentStoryboardTimelineInput(1, [], {
          durationMs: 3_000,
          clips: [
            {
              stableKey: 'shot.scene.gate.main',
              title: 'Gate',
              description: null,
              startMs: 500,
              durationMs: 2_500,
              kind: 'image',
              imagePrompt: 'A sealed gate in rain.',
            },
          ],
        });
        throw new Error('expected STORYBOARD_TIMELINE_INVALID');
      } catch (error) {
        expect(error).toBeInstanceOf(BadRequestException);
        expect((error as BadRequestException).getResponse()).toMatchObject({
          code: 'STORYBOARD_TIMELINE_INVALID',
        });
      }
    });
  });

  it('reports an existing Plot as current without tying it to Script approval lineage', async () => {
    const source = screenplay();
    const draft = chapterDraft(source);
    const scriptDocumentId = '0197f4a2-0800-7000-8000-000000000051';
    const scriptVersionId = '0197f4a2-0800-7000-8000-000000000052';
    const ydoc = new Y.Doc();
    const paragraph = new Y.XmlElement('paragraph');
    paragraph.insert(0, [new Y.XmlText('EXT. CITY GATE - NIGHT')]);
    ydoc.getXmlFragment('content').insert(0, [paragraph]);
    const crdtState = Buffer.from(Y.encodeStateAsUpdate(ydoc));
    ydoc.destroy();
    const tx = {
      storyProject: {
        findUniqueOrThrow: jest.fn().mockResolvedValue({
          creativeProfileConfirmedAt: new Date('2026-08-25T12:00:00.000Z'),
        }),
      },
      storyChapter: {
        findFirstOrThrow: jest.fn().mockResolvedValue({
          id: 'chapter-1',
          nodeIds: source.scenes.map((scene) => scene.nodeId),
          entryNodeId: source.entrySceneId,
          sourceScriptDocumentId: null,
          sourceScriptVersionId: null,
          sourceScriptSequence: null,
          sourceScriptHash: null,
        }),
        findFirst: jest.fn().mockResolvedValue({
          approvedAssetPlanSnapshotId: null,
        }),
      },
      storyDraft: {
        findUniqueOrThrow: jest.fn().mockResolvedValue({ content: draft }),
      },
      storyAssetSpec: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      storyStoryboardSequence: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      studioDocument: {
        findFirst: jest.fn().mockResolvedValue({
          id: scriptDocumentId,
          currentSequence: 1,
          currentVersionId: scriptVersionId,
          crdtState,
        }),
      },
      studioDocumentOperation: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      studioDocumentVersion: {
        findFirst: jest.fn().mockResolvedValue({
          id: scriptVersionId,
          documentId: scriptDocumentId,
          sequence: 1,
          snapshot: {
            screenplay: source,
            document: buildStoryScreenplayDocument(source),
          },
        }),
      },
    };

    const state = await service.getProductionStateInTransaction(
      tx as never,
      'project-1',
      'chapter-1',
    );

    expect(state.script.status).toBe('current');
    expect(state.plotTree).toEqual({ status: 'current', nodeCount: 3 });
  });

  it('treats a pinned approved empty Asset plan as current for the exact Plot source', async () => {
    const assetPlan = { assetSpecs: [] };
    const scriptDocumentId = '0197f4a2-0800-7000-8000-000000000060';
    const ydoc = new Y.Doc();
    const paragraph = new Y.XmlElement('paragraph');
    paragraph.insert(0, [new Y.XmlText('EXT. CITY GATE - NIGHT')]);
    ydoc.getXmlFragment('content').insert(0, [paragraph]);
    const scriptReads = {
      studioDocument: {
        findFirst: jest.fn().mockResolvedValue({
          id: scriptDocumentId,
          currentSequence: 1,
          currentVersionId: '0197f4a2-0800-7000-8000-000000000062',
          crdtState: Buffer.from(Y.encodeStateAsUpdate(ydoc)),
        }),
      },
      studioDocumentOperation: { findMany: jest.fn().mockResolvedValue([]) },
    };
    ydoc.destroy();
    const scriptHead = await readStoryScriptHead(
      scriptReads as never,
      'project-1',
      'chapter-1',
    );
    const source = screenplay();
    const draft = chapterDraft(source);
    const sourceFingerprint = canonicalJsonHash(
      InteractiveStoryDraftContentSchema.parse(draft),
    );
    const snapshot = {
      sourceFingerprint,
      planFingerprint: canonicalJsonHash({
        sourceFingerprint,
        productionPlan: assetPlan,
      }),
      productionPlan: assetPlan,
    };
    const tx = {
      ...scriptReads,
      storyAssetSpec: { findMany: jest.fn().mockResolvedValue([]) },
      storyChapter: {
        findFirst: jest.fn().mockResolvedValue({
          approvedAssetPlanSnapshotId: '0197f4a2-0800-7000-8000-000000000061',
          nodeIds: source.scenes.map((scene) => scene.nodeId),
          entryNodeId: source.entrySceneId,
          sourceScriptDocumentId: scriptHead.documentId,
          sourceScriptVersionId: '0197f4a2-0800-7000-8000-000000000062',
          sourceScriptSequence: scriptHead.sequence,
          sourceScriptHash: scriptHead.hash,
        }),
      },
      storyDraft: {
        findUnique: jest.fn().mockResolvedValue({ content: draft }),
      },
      studioDocumentVersion: {
        findFirst: jest.fn().mockResolvedValue({
          id: '0197f4a2-0800-7000-8000-000000000062',
          documentId: scriptHead.documentId,
          sequence: scriptHead.sequence,
          snapshot: {
            screenplay: source,
            document: buildStoryScreenplayDocument(source),
          },
        }),
      },
      storyProductionPlanSnapshot: {
        findFirst: jest.fn().mockResolvedValue(snapshot),
      },
    };

    await expect(
      service.readCurrentAssetPlanInTransaction(
        tx as never,
        'project-1',
        'chapter-1',
      ),
    ).resolves.toEqual(assetPlan);
  });

  it('reports existing Assets and Storyboard as current without requiring an Asset marker', async () => {
    const source = screenplay();
    const draft = chapterDraft(source);
    const scriptDocumentId = '0197f4a2-0800-7000-8000-000000000071';
    const scriptVersionId = '0197f4a2-0800-7000-8000-000000000072';
    const ydoc = new Y.Doc();
    const paragraph = new Y.XmlElement('paragraph');
    paragraph.insert(0, [new Y.XmlText('EXT. CITY GATE - NIGHT')]);
    ydoc.getXmlFragment('content').insert(0, [paragraph]);
    const crdtState = Buffer.from(Y.encodeStateAsUpdate(ydoc));
    ydoc.destroy();
    const scriptRow = {
      id: scriptDocumentId,
      currentSequence: 1,
      currentVersionId: scriptVersionId,
      crdtState,
    };
    const scriptReads = {
      studioDocument: {
        findFirst: jest.fn().mockResolvedValue(scriptRow),
      },
      studioDocumentOperation: {
        findMany: jest.fn().mockResolvedValue([]),
      },
    };
    const scriptHead = await readStoryScriptHead(
      scriptReads as never,
      'project-1',
      'chapter-1',
    );
    const chapterRow = {
      id: 'chapter-1',
      nodeIds: source.scenes.map((scene) => scene.nodeId),
      entryNodeId: source.entrySceneId,
      sourceScriptDocumentId: scriptDocumentId,
      sourceScriptVersionId: scriptVersionId,
      sourceScriptSequence: 1,
      sourceScriptHash: scriptHead.hash,
      approvedAssetPlanSnapshotId: null as string | null,
    };
    const emptyAssetPlan = { assetSpecs: [] };
    const sourceFingerprint = canonicalJsonHash(
      InteractiveStoryDraftContentSchema.parse(draft),
    );
    const tx = {
      ...scriptReads,
      storyProject: {
        findUniqueOrThrow: jest.fn().mockResolvedValue({
          creativeProfileConfirmedAt: new Date('2026-08-25T12:00:00.000Z'),
        }),
      },
      storyChapter: {
        findFirstOrThrow: jest.fn().mockResolvedValue(chapterRow),
        findFirst: jest.fn().mockResolvedValue(chapterRow),
      },
      storyDraft: {
        findUniqueOrThrow: jest.fn().mockResolvedValue({ content: draft }),
      },
      storyAssetSpec: {
        findMany: jest.fn().mockResolvedValue([
          {
            stableKey: 'asset.character.courier',
            status: StoryProductionSpecStatus.current,
          },
        ]),
      },
      storyStoryboardSequence: {
        findMany: jest.fn().mockResolvedValue(
          source.scenes.map((scene) => ({
            plotNodeId: scene.nodeId,
            clips: [{ id: `clip-${scene.nodeId}` }],
          })),
        ),
      },
      storyProductionPlanSnapshot: {
        findFirst: jest.fn().mockResolvedValue({
          sourceFingerprint,
          planFingerprint: canonicalJsonHash({
            sourceFingerprint,
            productionPlan: emptyAssetPlan,
          }),
          productionPlan: emptyAssetPlan,
        }),
      },
      studioDocumentVersion: {
        findFirst: jest.fn().mockResolvedValue({
          id: scriptVersionId,
          documentId: scriptDocumentId,
          sequence: 1,
          snapshot: {
            screenplay: source,
            document: buildStoryScreenplayDocument(source),
          },
        }),
      },
    };

    const state = await service.getProductionStateInTransaction(
      tx as never,
      'project-1',
      'chapter-1',
    );

    expect(state.plotTree.status).toBe('current');
    expect(state.assets.status).toBe('current');
    expect(state.storyboard).toMatchObject({
      status: 'current',
      sequenceCount: source.scenes.length,
      missingPlotNodeIds: [],
    });
    expect(state.ready).toBe(true);

    chapterRow.approvedAssetPlanSnapshotId =
      '0197f4a2-0800-7000-8000-000000000073';
    const unexpectedPlannedState =
      await service.getProductionStateInTransaction(
        tx as never,
        'project-1',
        'chapter-1',
      );
    expect(unexpectedPlannedState.assets.status).toBe('current');

    tx.storyAssetSpec.findMany.mockResolvedValue([
      {
        stableKey: 'asset.character.courier',
        status: StoryProductionSpecStatus.current,
      },
    ]);
    const keptOverrideState = await service.getProductionStateInTransaction(
      tx as never,
      'project-1',
      'chapter-1',
    );
    expect(keptOverrideState.assets.status).toBe('current');
    expect(keptOverrideState.storyboard.status).toBe('current');
  });

  it('treats clipless identity sequences as unplanned Storyboard, not current', async () => {
    const source = screenplay();
    const draft = chapterDraft(source);
    const scriptDocumentId = '0197f4a2-0800-7000-8000-000000000081';
    const scriptVersionId = '0197f4a2-0800-7000-8000-000000000082';
    const ydoc = new Y.Doc();
    const paragraph = new Y.XmlElement('paragraph');
    paragraph.insert(0, [new Y.XmlText('EXT. CITY GATE - NIGHT')]);
    ydoc.getXmlFragment('content').insert(0, [paragraph]);
    const crdtState = Buffer.from(Y.encodeStateAsUpdate(ydoc));
    ydoc.destroy();
    const scriptReads = {
      studioDocument: {
        findFirst: jest.fn().mockResolvedValue({
          id: scriptDocumentId,
          currentSequence: 1,
          currentVersionId: scriptVersionId,
          crdtState,
        }),
      },
      studioDocumentOperation: {
        findMany: jest.fn().mockResolvedValue([]),
      },
    };
    const scriptHead = await readStoryScriptHead(
      scriptReads as never,
      'project-1',
      'chapter-1',
    );
    const chapterRow = {
      id: 'chapter-1',
      nodeIds: source.scenes.map((scene) => scene.nodeId),
      entryNodeId: source.entrySceneId,
      sourceScriptDocumentId: scriptDocumentId,
      sourceScriptVersionId: scriptVersionId,
      sourceScriptSequence: 1,
      sourceScriptHash: scriptHead.hash,
      approvedAssetPlanSnapshotId: null as string | null,
    };
    const emptyAssetPlan = { assetSpecs: [] };
    const sourceFingerprint = canonicalJsonHash(
      InteractiveStoryDraftContentSchema.parse(draft),
    );
    // Every Plot node has its reconcile-pre-created identity sequence, but
    // none of them has ever been planned: zero live clips each.
    const sequenceRows = source.scenes.map((scene) => ({
      plotNodeId: scene.nodeId,
      clips: [] as Array<{ id: string }>,
    }));
    const tx = {
      ...scriptReads,
      storyProject: {
        findUniqueOrThrow: jest.fn().mockResolvedValue({
          creativeProfileConfirmedAt: new Date('2026-08-25T12:00:00.000Z'),
        }),
      },
      storyChapter: {
        findFirstOrThrow: jest.fn().mockResolvedValue(chapterRow),
        findFirst: jest.fn().mockResolvedValue(chapterRow),
      },
      storyDraft: {
        findUniqueOrThrow: jest.fn().mockResolvedValue({ content: draft }),
      },
      storyAssetSpec: {
        findMany: jest.fn().mockResolvedValue([
          {
            stableKey: 'asset.character.courier',
            status: StoryProductionSpecStatus.current,
          },
        ]),
      },
      storyStoryboardSequence: {
        findMany: jest.fn().mockResolvedValue(sequenceRows),
      },
      storyProductionPlanSnapshot: {
        findFirst: jest.fn().mockResolvedValue({
          sourceFingerprint,
          planFingerprint: canonicalJsonHash({
            sourceFingerprint,
            productionPlan: emptyAssetPlan,
          }),
          productionPlan: emptyAssetPlan,
        }),
      },
      studioDocumentVersion: {
        findFirst: jest.fn().mockResolvedValue({
          id: scriptVersionId,
          documentId: scriptDocumentId,
          sequence: 1,
          snapshot: {
            screenplay: source,
            document: buildStoryScreenplayDocument(source),
          },
        }),
      },
    };

    const state = await service.getProductionStateInTransaction(
      tx as never,
      'project-1',
      'chapter-1',
    );

    expect(state.plotTree.status).toBe('current');
    expect(state.assets.status).toBe('current');
    expect(state.storyboard).toMatchObject({
      status: 'missing',
      sequenceCount: source.scenes.length,
      missingPlotNodeIds: source.scenes.map((scene) => scene.nodeId),
    });
    expect(state.ready).toBe(false);

    // Once one sequence holds a live clip, only the still-empty shells stay
    // missing — per-sequence granularity, not all-or-nothing.
    sequenceRows[0].clips.push({ id: 'clip-scene.gate-main' });
    const partiallyPlannedState = await service.getProductionStateInTransaction(
      tx as never,
      'project-1',
      'chapter-1',
    );
    expect(partiallyPlannedState.storyboard).toMatchObject({
      status: 'missing',
      sequenceCount: source.scenes.length,
      missingPlotNodeIds: ['scene.wait', 'scene.run'],
    });
    expect(partiallyPlannedState.ready).toBe(false);
  });

  it('rejects a plan that omits any chapter Plot node', () => {
    const source = screenplay();
    const incomplete = plan();
    incomplete.storyboardSequences.pop();
    expect(() =>
      service.validateApprovedProductionPlan({
        productionPlan: incomplete,
        canonicalCharacterIds: source.characters.map(
          (character) => character.id,
        ),
        chapterNodeIds: source.scenes.map((scene) => scene.nodeId),
        draft: chapterDraft(source),
      }),
    ).toThrow(/Missing: scene\.run/);
  });

  it('treats Asset source-node ids as hints rather than binding gates', () => {
    const source = screenplay();
    const value = plan();
    value.assetSpecs[0].sourceNodeIds = ['scene.wait', 'scene.run'];

    expect(() =>
      service.validateApprovedStoryboardPlan({
        storyboardPlan: {
          storyboardSequences: value.storyboardSequences,
        },
        assetPlan: { assetSpecs: value.assetSpecs },
        draft: chapterDraft(source),
        chapterNodeIds: source.scenes.map((scene) => scene.nodeId),
      }),
    ).not.toThrow();
  });

  it('rejects incomplete coverage before the reconcile transaction can write any spec', async () => {
    const source = screenplay();
    const incomplete = plan();
    incomplete.storyboardSequences.pop();
    const assetCreate = jest.fn();
    const assetUpdate = jest.fn();
    const sequenceCreate = jest.fn();
    const sequenceUpdate = jest.fn();
    const tx = {
      storyChapter: {
        findFirst: jest.fn().mockResolvedValue({
          nodeIds: source.scenes.map((scene) => scene.nodeId),
        }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      storyDraft: {
        findUnique: jest.fn().mockResolvedValue({
          content: chapterDraft(source),
        }),
      },
      storyAssetSpec: {
        create: assetCreate,
        update: assetUpdate,
      },
      storyStoryboardSequence: {
        create: sequenceCreate,
        update: sequenceUpdate,
      },
    };

    await expect(
      service.applyApprovedProductionPlanInTransaction(tx as never, {
        storyProjectId: 'project-1',
        storyChapterId: 'chapter-1',
        actorUserId: 'user-1',
        sourceFingerprint: 'a'.repeat(64),
        canonicalCharacterIds: source.characters.map(
          (character) => character.id,
        ),
        productionPlan: incomplete,
      }),
    ).rejects.toMatchObject({
      response: {
        code: 'STORY_PRODUCTION_STORYBOARD_INCOMPLETE',
      },
    });
    expect(assetCreate).not.toHaveBeenCalled();
    expect(assetUpdate).not.toHaveBeenCalled();
    expect(sequenceCreate).not.toHaveBeenCalled();
    expect(sequenceUpdate).not.toHaveBeenCalled();
  });

  it('applies Assets without invalidating or generating Storyboard rows', async () => {
    const source = screenplay();
    const currentAsset = plan().assetSpecs[0];
    const currentAssetRow = {
      id: 'asset-row-1',
      stableKey: currentAsset.stableKey,
      kind: currentAsset.kind,
      sourceCharacterId: currentAsset.sourceCharacterId,
      sourceNodeIds: currentAsset.sourceNodeIds,
      name: currentAsset.name,
      description: currentAsset.description,
      imagePrompt: currentAsset.imagePrompt,
      videoPrompt: null,
      negativePrompt: null,
      sourceFingerprint: 'old-source',
      status: 'current',
      userModifiedAt: null,
    };
    const snapshotUpsert = jest.fn().mockImplementation(
      ({
        create,
      }: {
        create: {
          storyProjectId: string;
          sourceFingerprint: string;
          planFingerprint: string;
          productionPlan: unknown;
        };
      }) => ({
        id: 'asset-snapshot-1',
        storyProjectId: create.storyProjectId,
        sourceFingerprint: create.sourceFingerprint,
        planFingerprint: create.planFingerprint,
        productionPlan: create.productionPlan,
      }),
    );
    const sequenceCreate = jest.fn();
    const sequenceUpdate = jest.fn();
    const sequenceUpdateMany = jest.fn().mockResolvedValue({ count: 2 });
    const tx = {
      storyChapter: {
        findFirst: jest.fn().mockResolvedValue({
          nodeIds: source.scenes.map((scene) => scene.nodeId),
          approvedAssetPlanSnapshotId: 'asset-snapshot-1',
        }),
        findFirstOrThrow: jest.fn().mockResolvedValue({
          nodeIds: source.scenes.map((scene) => scene.nodeId),
          entryNodeId: source.entrySceneId,
        }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      storyDraft: {
        findUnique: jest.fn().mockResolvedValue({
          content: chapterDraft(source),
        }),
        findUniqueOrThrow: jest.fn().mockResolvedValue({
          content: chapterDraft(source),
        }),
      },
      storyProductionPlanSnapshot: {
        upsert: snapshotUpsert,
        findFirst: jest
          .fn()
          .mockImplementation(() =>
            snapshotUpsert.mock.results[0]?.value
              ? Promise.resolve(snapshotUpsert.mock.results[0].value)
              : Promise.resolve(null),
          ),
      },
      storyAssetSpec: {
        findMany: jest
          .fn()
          .mockResolvedValueOnce([currentAssetRow])
          .mockResolvedValueOnce([currentAssetRow])
          .mockResolvedValueOnce([]),
        update: jest.fn().mockResolvedValue({
          ...currentAssetRow,
          status: 'archived',
        }),
      },
      storyStoryboardSequence: {
        create: sequenceCreate,
        update: sequenceUpdate,
        updateMany: sequenceUpdateMany,
      },
    };
    jest
      .spyOn(service, 'readCurrentAssetPlanInTransaction')
      .mockResolvedValueOnce({ assetSpecs: [currentAsset] })
      .mockResolvedValueOnce({ assetSpecs: [] });

    const result = await service.applyApprovedAssetPlanInTransaction(
      tx as never,
      {
        storyProjectId: 'project-1',
        storyChapterId: 'chapter-1',
        actorUserId: 'user-1',
        sourceFingerprint: 'b'.repeat(64),
        canonicalCharacterIds: source.characters.map(
          (character) => character.id,
        ),
        canonicalNodeIds: source.scenes.map((scene) => scene.nodeId),
        assetPlan: { assetSpecs: [] },
      },
    );

    expect(result).toMatchObject({
      assetSpecsUpdated: 1,
      sequencesCreated: 0,
      sequencesUpdated: 0,
    });
    expect(sequenceUpdateMany).not.toHaveBeenCalled();
    expect(sequenceCreate).not.toHaveBeenCalled();
    expect(sequenceUpdate).not.toHaveBeenCalled();
  });

  it('leaves creator-edited Asset fields and versions untouched during replanning', async () => {
    const planned = plan().assetSpecs[0];
    const now = new Date('2026-09-03T12:00:00.000Z');
    const current = {
      id: 'asset-row-1',
      stableKey: planned.stableKey,
      sourceFingerprint: 'creator-owned-source',
      sourceNodeIds: ['scene.wait'],
      imagePrompt: 'The prompt the creator chose.',
      status: StoryProductionSpecStatus.current,
      userModifiedAt: new Date('2026-09-03T11:00:00.000Z'),
      version: 7,
    };
    const update = jest.fn();
    const reconcile = service as unknown as {
      reconcileAssetSpecs(
        tx: unknown,
        input: unknown,
        assetPlan: unknown,
        plannedAt: Date,
        result: unknown,
      ): Promise<unknown>;
    };

    await reconcile.reconcileAssetSpecs(
      {
        storyAssetSpec: {
          findMany: jest.fn().mockResolvedValue([current]),
          update,
        },
      },
      {
        storyProjectId: 'project-1',
        storyChapterId: 'chapter-1',
        actorUserId: 'user-1',
        sourceFingerprint: 'a'.repeat(64),
      },
      { assetSpecs: [planned] },
      now,
      { assetSpecsCreated: 0, assetSpecsUpdated: 0 },
    );

    expect(update).not.toHaveBeenCalled();
  });

  it('leaves a creator-edited Storyboard subtree untouched during replanning', async () => {
    const planned = plan().storyboardSequences[0];
    const now = new Date('2026-09-03T12:00:00.000Z');
    const current = {
      id: 'sequence-row-1',
      plotNodeId: planned.plotNodeId,
      sourceFingerprint: 'creator-owned-source',
      status: StoryProductionSpecStatus.current,
      userModifiedAt: new Date('2026-09-03T11:00:00.000Z'),
      version: 9,
      clips: [],
      cues: [],
    };
    const update = jest.fn();
    const reconcile = service as unknown as {
      reconcileStoryboard(
        tx: unknown,
        input: unknown,
        storyboardPlan: unknown,
        assetByKey: Map<string, never>,
        plannedAt: Date,
        result: unknown,
      ): Promise<void>;
    };

    await reconcile.reconcileStoryboard(
      {
        storyStoryboardSequence: {
          findMany: jest.fn().mockResolvedValue([current]),
          update,
        },
      },
      {
        storyProjectId: 'project-1',
        storyChapterId: 'chapter-1',
        actorUserId: 'user-1',
        sourceFingerprint: 'a'.repeat(64),
      },
      { storyboardSequences: [planned] },
      new Map<string, never>(),
      now,
      { sequencesCreated: 0, sequencesUpdated: 0 },
    );

    expect(update).not.toHaveBeenCalled();
  });

  it('applies a Storyboard proposal against live Assets without alias or deletion gates', async () => {
    const source = screenplay();
    const value = plan();
    const storyboardPlan = {
      storyboardSequences: value.storyboardSequences.map((sequence) => ({
        ...sequence,
        clips: sequence.clips.map((clip) =>
          clip.kind === 'video'
            ? {
                ...clip,
                videoPrompt: `${clip.videoPrompt.replace('@asset.character.courier', '@character.courier')} @asset.deleted`,
              }
            : clip,
        ),
      })),
    };
    const liveAssetPlan = { assetSpecs: value.assetSpecs };
    const reconcileStoryboard = jest.fn().mockResolvedValue(undefined);
    (
      service as unknown as {
        reconcileStoryboard: typeof reconcileStoryboard;
      }
    ).reconcileStoryboard = reconcileStoryboard;
    jest
      .spyOn(service, 'readCurrentAssetPlanInTransaction')
      .mockResolvedValueOnce(liveAssetPlan);
    const tx = {
      storyChapter: {
        findFirst: jest.fn().mockResolvedValue({
          nodeIds: source.scenes.map((scene) => scene.nodeId),
        }),
      },
      storyDraft: {
        findUnique: jest.fn().mockResolvedValue({
          content: chapterDraft(source),
        }),
      },
      storyAssetSpec: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'asset-row-1',
            stableKey: 'asset.character.courier',
            status: StoryProductionSpecStatus.current,
          },
        ]),
      },
    };

    await service.applyApprovedStoryboardPlanInTransaction(tx as never, {
      storyProjectId: 'project-1',
      storyChapterId: 'chapter-1',
      actorUserId: 'user-1',
      sourceFingerprint: 'a'.repeat(64),
      storyboardPlan,
    });

    const reconcileCalls = reconcileStoryboard.mock.calls as unknown as Array<
      [
        unknown,
        unknown,
        {
          storyboardSequences: Array<{
            clips: Array<{ videoPrompt?: string }>;
          }>;
        },
      ]
    >;
    const appliedPlan = reconcileCalls[0]?.[2] as {
      storyboardSequences: Array<{
        clips: Array<{ videoPrompt?: string }>;
      }>;
    };
    expect(appliedPlan.storyboardSequences[0]?.clips[0]?.videoPrompt).toContain(
      '@asset.character.courier',
    );
    expect(appliedPlan.storyboardSequences[0]?.clips[0]?.videoPrompt).toContain(
      'asset.deleted',
    );
    expect(
      appliedPlan.storyboardSequences[0]?.clips[0]?.videoPrompt,
    ).not.toContain('@asset.deleted');
  });
});

describe('PutStoryStoryboardTimelineSchema', () => {
  const imageClip = {
    expectedVersion: 0,
    stableKey: 'shot.gate.establishing',
    title: 'Establishing frame',
    kind: 'image' as const,
    startMs: 0,
    durationMs: 2_000,
    description: 'Snow closes around the city gate.',
    imagePrompt: 'A wide image of a city gate in falling snow.',
    videoPrompt: null,
    negativePrompt: null,
  };
  const videoClip = {
    expectedVersion: 0,
    stableKey: 'shot.gate.courier',
    title: 'Courier arrives',
    kind: 'video' as const,
    startMs: 2_000,
    durationMs: 8_000,
    description: 'The courier approaches the sealed gate.',
    imagePrompt: null,
    videoPrompt: 'Track the courier approaching the sealed gate.',
    negativePrompt: null,
  };

  it('accepts one complete ordered image/video visual track', () => {
    expect(
      PutStoryStoryboardTimelineSchema.parse({
        expectedVersion: 4,
        durationMs: 10_000,
        clips: [imageClip, videoClip],
      }),
    ).toEqual({
      expectedVersion: 4,
      durationMs: 10_000,
      clips: [imageClip, videoClip],
    });
  });

  it.each([
    {
      name: 'gap',
      value: {
        expectedVersion: 4,
        durationMs: 10_000,
        clips: [imageClip, { ...videoClip, startMs: 2_500, durationMs: 7_500 }],
      },
    },
    {
      name: 'overlap',
      value: {
        expectedVersion: 4,
        durationMs: 10_000,
        clips: [imageClip, { ...videoClip, startMs: 1_500, durationMs: 8_500 }],
      },
    },
    {
      name: 'incomplete tail',
      value: {
        expectedVersion: 4,
        durationMs: 11_000,
        clips: [imageClip, videoClip],
      },
    },
    {
      name: 'nonzero version for a new clip',
      value: {
        expectedVersion: 4,
        durationMs: 10_000,
        clips: [{ ...imageClip, expectedVersion: 2 }, videoClip],
      },
    },
    {
      name: 'duplicate stable key',
      value: {
        expectedVersion: 4,
        durationMs: 10_000,
        clips: [imageClip, { ...videoClip, stableKey: imageClip.stableKey }],
      },
    },
  ])('rejects a $name timeline', ({ value }) => {
    expect(PutStoryStoryboardTimelineSchema.safeParse(value).success).toBe(
      false,
    );
  });

  it('requires kind-correct prompts instead of coercing media semantics', () => {
    expect(
      PutStoryStoryboardTimelineSchema.safeParse({
        expectedVersion: 4,
        durationMs: 2_000,
        clips: [{ ...imageClip, videoPrompt: 'This must not be accepted.' }],
      }).success,
    ).toBe(false);
  });
});

describe('Story production semantic edit provenance', () => {
  it('does not classify media selection as a semantic Asset Spec edit', () => {
    expect(
      storyAssetSemanticPatch({
        expectedVersion: 2,
        selectedMediaVersionId: '0198f744-32a0-7000-8000-000000000001',
      }),
    ).toBe(false);
    expect(
      storyAssetSemanticPatch({
        expectedVersion: 2,
        sourceMediaAssetId: '0198f744-32a0-7000-8000-000000000002',
      }),
    ).toBe(false);
    expect(
      storyAssetSemanticPatch({
        expectedVersion: 2,
        imagePrompt: 'New prompt',
      }),
    ).toBe(true);
  });

  it('does not classify media selection as a semantic Storyboard clip edit', () => {
    expect(
      storyboardClipSemanticPatch({
        expectedVersion: 3,
        selectedMediaVersionId: '0198f744-32a0-7000-8000-000000000002',
      }),
    ).toBe(false);
    expect(
      storyboardClipSemanticPatch({
        expectedVersion: 3,
        videoPrompt: 'New movement',
      }),
    ).toBe(true);
    expect(
      storyboardClipSemanticPatch({
        expectedVersion: 3,
        sourceMediaAssetId: '0198f744-32a0-7000-8000-000000000003',
      }),
    ).toBe(false);
    expect(
      storyboardClipSemanticPatch({ expectedVersion: 3, kind: 'video' }),
    ).toBe(true);
  });
});

describe('PatchStoryAssetSpecSchema', () => {
  it('accepts candidate-image import and rejects two competing media selections', () => {
    const sourceMediaAssetId = '0198f744-32a0-7000-8000-000000000003';
    expect(
      PatchStoryAssetSpecSchema.safeParse({
        expectedVersion: 2,
        sourceMediaAssetId,
      }).success,
    ).toBe(true);
    expect(
      PatchStoryAssetSpecSchema.safeParse({
        expectedVersion: 2,
        sourceMediaAssetId,
        sourceMediaPurpose: 'turnaround',
      }).success,
    ).toBe(true);
    expect(
      PatchStoryAssetSpecSchema.safeParse({
        expectedVersion: 2,
        sourceMediaPurpose: 'turnaround',
      }).success,
    ).toBe(false);
    expect(
      PatchStoryAssetSpecSchema.safeParse({
        expectedVersion: 2,
        sourceMediaAssetId,
        selectedMediaVersionId: '0198f744-32a0-7000-8000-000000000004',
      }).success,
    ).toBe(false);
  });
});

describe('Manual Story Asset Spec schemas', () => {
  it('requires complete create data and a version-fenced archive', () => {
    expect(
      CreateStoryAssetSpecSchema.safeParse({
        kind: 'prop',
        name: 'Sealed letter',
        imagePrompt: 'A wax-sealed letter on dark wood.',
      }).success,
    ).toBe(true);
    expect(
      CreateStoryAssetSpecSchema.safeParse({ kind: 'prop', name: 'Letter' })
        .success,
    ).toBe(false);
    expect(
      ArchiveStoryAssetSpecSchema.safeParse({ expectedVersion: 2 }).success,
    ).toBe(true);
  });
});

describe('PatchStoryStoryboardClipSchema', () => {
  it('accepts candidate-media import and rejects two competing media selections', () => {
    const sourceMediaAssetId = '0198f744-32a0-7000-8000-000000000003';
    expect(
      PatchStoryStoryboardClipSchema.safeParse({
        expectedVersion: 3,
        sourceMediaAssetId,
      }).success,
    ).toBe(true);
    expect(
      PatchStoryStoryboardClipSchema.safeParse({
        expectedVersion: 3,
        sourceMediaAssetId,
        selectedMediaVersionId: '0198f744-32a0-7000-8000-000000000004',
      }).success,
    ).toBe(false);
  });
});

describe('Storyboard cue retiming', () => {
  it('moves only an end-anchored cue when the visual timeline duration changes', () => {
    expect(storyboardCueTimeAfterTimelineResize(10_000, 10_000, 14_000)).toBe(
      14_000,
    );
    expect(storyboardCueTimeAfterTimelineResize(6_000, 10_000, 14_000)).toBe(
      6_000,
    );
  });
});

describe('Storyboard video duration synchronization', () => {
  it('resizes the selected clip and reflows every following clip', () => {
    expect(
      resizeStoryboardTimelineClip(
        [
          { id: 'opening', rank: 0, startMs: 0, durationMs: 6_000 },
          { id: 'middle', rank: 1, startMs: 6_000, durationMs: 7_000 },
          { id: 'ending', rank: 2, startMs: 13_000, durationMs: 5_000 },
        ],
        'opening',
        111_000,
      ),
    ).toEqual({
      durationMs: 123_000,
      clips: [
        { id: 'opening', rank: 0, startMs: 0, durationMs: 111_000 },
        { id: 'middle', rank: 1, startMs: 111_000, durationMs: 7_000 },
        { id: 'ending', rank: 2, startMs: 118_000, durationMs: 5_000 },
      ],
    });
  });
});

describe('Storyboard clip media selection', () => {
  it('accepts only a media asset whose kind matches the clip', () => {
    expect(() =>
      assertStoryboardClipMediaKind('image', MediaAssetKind.image),
    ).not.toThrow();
    try {
      assertStoryboardClipMediaKind('video', MediaAssetKind.image);
      throw new Error('Expected the mismatched media kind to be rejected.');
    } catch (error) {
      expect(error).toBeInstanceOf(BadRequestException);
      expect((error as BadRequestException).getResponse()).toEqual({
        code: 'STORYBOARD_CLIP_MEDIA_KIND_MISMATCH',
        message: 'A video Storyboard clip can only select video media.',
        clipKind: 'video',
        mediaKind: 'image',
      });
    }
  });
});
