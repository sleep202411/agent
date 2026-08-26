import { BadRequestException } from '@nestjs/common';
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
import { PutStoryStoryboardTimelineSchema } from './story-production-plan.schema';
import {
  assertStoryboardClipMediaKind,
  storyboardClipSemanticPatch,
  storyAssetSemanticPatch,
  storyAssetPlanFingerprint,
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
      `Storyboard clip "${clip.stableKey}" uses Asset Spec "asset.unknown" without chapter-node lineage to "${value.storyboardSequences[0].plotNodeId}".`,
    );
  });

  it('rejects cross-node asset lineage and missing canonical character specs', () => {
    const value = plan();
    value.assetSpecs[0].sourceNodeIds = ['scene.wait', 'scene.run'];
    value.assetSpecs[0].sourceCharacterId = 'character.unknown';
    const issues = validateProductionPlanAgainstScreenplay(value, screenplay());
    expect(issues.some((issue) => issue.includes('unknown character'))).toBe(
      true,
    );
    expect(
      issues.some((issue) => issue.includes('without chapter-node lineage')),
    ).toBe(true);
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

  it('keeps Plot non-current after Script approval even when the graph happens to match', async () => {
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
    expect(state.plotTree).toEqual({ status: 'stale', nodeCount: 3 });
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

  it('marks Assets and Storyboard stale when current rows lack an approved Asset marker', async () => {
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
            planDisposition: 'planned',
          },
        ]),
      },
      storyStoryboardSequence: {
        findMany: jest.fn().mockResolvedValue(
          source.scenes.map((scene) => ({
            plotNodeId: scene.nodeId,
            status: StoryProductionSpecStatus.current,
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
    expect(state.assets.status).toBe('stale');
    expect(state.storyboard).toMatchObject({
      status: 'stale',
      sequenceCount: source.scenes.length,
      staleCount: 0,
      missingPlotNodeIds: [],
    });
    expect(state.ready).toBe(false);

    chapterRow.approvedAssetPlanSnapshotId =
      '0197f4a2-0800-7000-8000-000000000073';
    const unexpectedPlannedState =
      await service.getProductionStateInTransaction(
        tx as never,
        'project-1',
        'chapter-1',
      );
    expect(unexpectedPlannedState.assets.status).toBe('stale');

    tx.storyAssetSpec.findMany.mockResolvedValue([
      {
        stableKey: 'asset.character.courier',
        status: StoryProductionSpecStatus.current,
        planDisposition: 'user_override',
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

  it('rejects a Storyboard @Asset binding outside the Asset Plot-node lineage', () => {
    const source = screenplay();
    const value = plan();
    value.assetSpecs[0].sourceNodeIds = ['scene.wait', 'scene.run'];

    let error: unknown;
    try {
      service.validateApprovedStoryboardPlan({
        storyboardPlan: {
          storyboardSequences: value.storyboardSequences,
        },
        assetPlan: { assetSpecs: value.assetSpecs },
        draft: chapterDraft(source),
        chapterNodeIds: source.scenes.map((scene) => scene.nodeId),
      });
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(BadRequestException);
    expect((error as BadRequestException).getResponse()).toMatchObject({
      code: 'STORY_PRODUCTION_ASSET_LINEAGE_INVALID',
    });
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

  it('applies Assets alone and invalidates, but never generates, Storyboard rows', async () => {
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
      sequencesMarkedStale: 2,
    });
    expect(sequenceUpdateMany).toHaveBeenCalledTimes(1);
    expect(sequenceCreate).not.toHaveBeenCalled();
    expect(sequenceUpdate).not.toHaveBeenCalled();
  });

  it('invalidates both Assets and Storyboard when an approved Plot changes', async () => {
    type StaleUpdate = {
      data: {
        status: StoryProductionSpecStatus;
        pendingPlanSnapshotId: string | null;
      };
    };
    let assetCall: StaleUpdate | undefined;
    let storyboardCall: StaleUpdate | undefined;
    const assetUpdateMany = jest.fn((input: StaleUpdate) => {
      assetCall = input;
      return Promise.resolve({ count: 2 });
    });
    const storyboardUpdateMany = jest.fn((input: StaleUpdate) => {
      storyboardCall = input;
      return Promise.resolve({ count: 3 });
    });
    const tx = {
      storyChapter: {
        findFirst: jest.fn().mockResolvedValue({
          approvedAssetPlanSnapshotId: null,
        }),
      },
      storyAssetSpec: { updateMany: assetUpdateMany },
      storyStoryboardSequence: { updateMany: storyboardUpdateMany },
    };

    await service.invalidateDownstreamAfterUpstreamApprovalInTransaction(
      tx as never,
      {
        storyProjectId: 'project-1',
        storyChapterId: 'chapter-1',
        actorUserId: 'user-1',
        sourceFingerprint: 'd'.repeat(64),
        upstreamStage: 'plot',
        upstreamRunId: 'run-plot-2',
      },
    );

    expect(assetCall?.data.status).toBe(StoryProductionSpecStatus.stale);
    expect(assetCall?.data.pendingPlanSnapshotId).toBeNull();
    expect(storyboardCall?.data.status).toBe(StoryProductionSpecStatus.stale);
    expect(storyboardCall?.data.pendingPlanSnapshotId).toBeNull();
  });

  it('rejects a Storyboard proposal when its immutable Asset source is no longer current', async () => {
    const source = screenplay();
    const combined = plan();
    const currentAsset = combined.assetSpecs[0];
    const changedAssetPlan = {
      assetSpecs: [
        { ...currentAsset, imagePrompt: 'A changed current reference.' },
      ],
    };
    const currentAssetRow = {
      id: 'asset-row-1',
      stableKey: currentAsset.stableKey,
      kind: currentAsset.kind,
      sourceCharacterId: currentAsset.sourceCharacterId,
      sourceNodeIds: currentAsset.sourceNodeIds,
      name: currentAsset.name,
      description: currentAsset.description,
      imagePrompt: changedAssetPlan.assetSpecs[0].imagePrompt,
      videoPrompt: null,
      negativePrompt: null,
      status: 'current',
    };
    const snapshotUpsert = jest.fn();
    const sequenceCreate = jest.fn();
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
      storyProductionPlanSnapshot: { upsert: snapshotUpsert },
      storyAssetSpec: {
        findMany: jest.fn().mockResolvedValue([currentAssetRow]),
      },
      storyStoryboardSequence: { create: sequenceCreate },
    };

    expect(storyAssetPlanFingerprint(changedAssetPlan)).not.toBe(
      storyAssetPlanFingerprint({ assetSpecs: combined.assetSpecs }),
    );
    jest
      .spyOn(service, 'readCurrentAssetPlanInTransaction')
      .mockResolvedValueOnce(changedAssetPlan);
    await expect(
      service.applyApprovedStoryboardPlanInTransaction(tx as never, {
        storyProjectId: 'project-1',
        storyChapterId: 'chapter-1',
        actorUserId: 'user-1',
        sourceFingerprint: 'c'.repeat(64),
        assetPlan: { assetSpecs: combined.assetSpecs },
        storyboardPlan: {
          storyboardSequences: combined.storyboardSequences,
        },
      }),
    ).rejects.toMatchObject({
      response: { code: 'STORY_PRODUCTION_ASSET_PLAN_STALE' },
    });
    expect(snapshotUpsert).not.toHaveBeenCalled();
    expect(sequenceCreate).not.toHaveBeenCalled();
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
