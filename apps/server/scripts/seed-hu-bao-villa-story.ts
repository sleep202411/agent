import 'dotenv/config';

import {
  Prisma,
  StoryFilmClipReferenceRole,
  StoryFilmDependencyKind,
  StoryFilmDependencyTransition,
  StoryFilmFrameMode,
  StoryFilmGenerationMode,
  StoryFilmReferenceKind,
  StoryFormat,
  StoryFrameProfile,
  StoryProjectMemberRole,
  StoryProjectMemberStatus,
  StoryProjectStatus,
  StoryRevisionSource,
  StoryVisibility,
  WorkspaceMemberRole,
  WorkspaceMemberStatus,
  WorkspaceStatus,
  WorkspaceType,
  type PrismaClient,
} from '@prisma/client';
import { buildPrisma } from '../src/infra/db/db.module';
import { canonicalJsonHash } from '../src/story-studio/canonical-json';
import { frameContractMatchesStoryProfile } from '../src/story-studio/dto';
import { INTERACTIVE_FILM_DRAFT_SCHEMA_VERSION } from '../src/story-studio/interactive-film.schema';
import {
  buildHuBaoVillaImportBundle,
  type HuBaoVillaClipDependencyPlan,
  type HuBaoVillaClipReferencePlan,
  type HuBaoVillaImportBundle,
} from '../src/story-studio/import/hu-bao-villa.builder';
import {
  HU_BAO_VILLA_DRAFT_CONTENT,
  HU_BAO_VILLA_FRAME_PROFILE,
  HU_BAO_VILLA_PROJECT_ID,
} from '../src/story-studio/import/hu-bao-villa.fixture';

const DRAFT_SCHEMA_VERSION = INTERACTIVE_FILM_DRAFT_SCHEMA_VERSION;
const IMPORT_LABEL = '虎豹别墅：龙口入夜 · 锁定制作版 v1.1';
const IMPORT_SESSION_ID = 'local-seed:hu-bao-villa-v1.1';
const CANONICAL_MODEL_SLUG = 'seedance-2-0';

interface CliOptions {
  userId: string;
  workspaceName?: string;
}

interface ImportResult {
  created: boolean;
  workspaceId: string;
  projectId: string;
  revisionId: string;
  productionRevision: number;
  referenceSlotCount: number;
  clipCount: number;
  clipReferenceCount: number;
  clipDependencyCount: number;
}

async function main(): Promise<void> {
  const options = parseCliOptions(process.argv.slice(2));
  const prisma = buildPrisma();
  await prisma.$connect();

  try {
    const model = await prisma.aiCanonicalModel.findFirst({
      where: {
        slug: CANONICAL_MODEL_SLUG,
        modality: 'video',
        status: 'active',
        archivedAt: null,
      },
      select: { id: true },
    });
    if (!model) {
      throw new Error(
        `Active video model ${CANONICAL_MODEL_SLUG} is required. Run npm run seed:ai-image first.`,
      );
    }

    const bundle = buildHuBaoVillaImportBundle({
      defaultCanonicalModelId: model.id,
    });
    assertBundleFrameContract(bundle);
    const workspaceId = await ensurePersonalWorkspace(prisma, options);
    const existing = await prisma.storyProject.findUnique({
      where: { id: HU_BAO_VILLA_PROJECT_ID },
      select: { id: true },
    });

    const result = existing
      ? await verifyExistingImport(prisma, workspaceId, options.userId, bundle)
      : await createImport(prisma, workspaceId, options.userId, bundle);

    console.log(
      [
        result.created
          ? 'Created locked Story Studio import.'
          : 'Verified existing locked Story Studio import.',
        `workspaceId=${result.workspaceId}`,
        `projectId=${result.projectId}`,
        `revisionId=${result.revisionId}`,
        `productionRevision=${result.productionRevision}`,
        `referenceSlots=${result.referenceSlotCount}`,
        `clips=${result.clipCount}`,
        `clipReferences=${result.clipReferenceCount}`,
        `clipDependencies=${result.clipDependencyCount}`,
        'mediaAssets=0 takes=0 builds=0 releases=0',
      ].join('\n'),
    );
  } finally {
    await prisma.$disconnect();
  }
}

function parseCliOptions(args: string[]): CliOptions {
  let userId: string | undefined;
  let workspaceName: string | undefined;

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === '--help') {
      console.log(
        'Usage: npm run story:seed:hu-bao-villa -- --user-id <external-user-id> [--workspace-name <name>]',
      );
      process.exit(0);
    }
    if (argument === '--user-id' || argument === '--workspace-name') {
      const value = args[index + 1]?.trim();
      if (!value || value.startsWith('--')) {
        throw new Error(`${argument} requires a value.`);
      }
      if (argument === '--user-id') userId = value;
      else workspaceName = value;
      index += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${argument}`);
  }

  if (!userId) {
    throw new Error('--user-id is required; never infer a StoryProject owner.');
  }
  if (userId.length > 64)
    throw new Error('--user-id must be at most 64 characters.');
  if (workspaceName && workspaceName.length > 120) {
    throw new Error('--workspace-name must be at most 120 characters.');
  }
  return { userId, ...(workspaceName ? { workspaceName } : {}) };
}

async function ensurePersonalWorkspace(
  prisma: PrismaClient,
  options: CliOptions,
): Promise<string> {
  return prisma.$transaction(async (tx) => {
    let workspace = await tx.workspace.findFirst({
      where: {
        type: WorkspaceType.personal,
        ownerUserId: options.userId,
        deletedAt: null,
      },
    });

    if (!workspace) {
      workspace = await tx.workspace.create({
        data: {
          type: WorkspaceType.personal,
          status: WorkspaceStatus.active,
          name: options.workspaceName ?? `${options.userId}'s Workspace`,
          ownerUserId: options.userId,
          createdById: options.userId,
        },
      });
    }
    if (workspace.status !== WorkspaceStatus.active) {
      throw new Error(`Personal workspace ${workspace.id} is not active.`);
    }

    const membership = await tx.workspaceMember.findFirst({
      where: {
        workspaceId: workspace.id,
        userId: options.userId,
        removedAt: null,
      },
    });
    if (!membership) {
      await tx.workspaceMember.create({
        data: {
          workspaceId: workspace.id,
          userId: options.userId,
          role: WorkspaceMemberRole.owner,
          status: WorkspaceMemberStatus.active,
          seatAssigned: true,
        },
      });
    } else if (
      membership.status !== WorkspaceMemberStatus.active ||
      membership.role !== WorkspaceMemberRole.owner
    ) {
      throw new Error(
        `Personal workspace ${workspace.id} must have an active owner membership for ${options.userId}.`,
      );
    }
    return workspace.id;
  });
}

async function createImport(
  prisma: PrismaClient,
  workspaceId: string,
  userId: string,
  bundle: HuBaoVillaImportBundle,
): Promise<ImportResult> {
  const contentHash = canonicalJsonHash(bundle.draftContent);
  const specHash = canonicalJsonHash(bundle.filmSpec);
  const clipHashes = new Map(
    bundle.clipSpecs.map((clip) => [clip.key, canonicalJsonHash(clip)]),
  );

  return prisma.$transaction(async (tx) => {
    await tx.storyProject.create({
      data: {
        id: HU_BAO_VILLA_PROJECT_ID,
        workspaceId,
        format: StoryFormat.interactive_film,
        frameProfile: StoryFrameProfile[HU_BAO_VILLA_FRAME_PROFILE],
        status: StoryProjectStatus.active,
        visibility: StoryVisibility.private,
        title: HU_BAO_VILLA_DRAFT_CONTENT.title,
        summary: HU_BAO_VILLA_DRAFT_CONTENT.logline,
        defaultLocale: 'zh-CN',
        tags: asJson(HU_BAO_VILLA_DRAFT_CONTENT.genre),
        createdByUserId: userId,
      },
    });
    await tx.storyProjectMember.create({
      data: {
        storyProjectId: HU_BAO_VILLA_PROJECT_ID,
        userId,
        role: StoryProjectMemberRole.owner,
        status: StoryProjectMemberStatus.active,
        grantedByUserId: userId,
      },
    });
    await tx.storyDraft.create({
      data: {
        storyProjectId: HU_BAO_VILLA_PROJECT_ID,
        schemaVersion: DRAFT_SCHEMA_VERSION,
        content: asJson(bundle.draftContent),
        contentHash,
        revision: 1,
        updatedByUserId: userId,
        updatedBySessionId: IMPORT_SESSION_ID,
      },
    });
    const revision = await tx.storyRevision.create({
      data: {
        storyProjectId: HU_BAO_VILLA_PROJECT_ID,
        number: 1,
        sourceDraftRevision: 1,
        schemaVersion: DRAFT_SCHEMA_VERSION,
        content: asJson(bundle.draftContent),
        contentHash,
        label: IMPORT_LABEL,
        source: StoryRevisionSource.import,
        createdByUserId: userId,
      },
    });
    await tx.storyFilmSpec.create({
      data: {
        revisionId: revision.id,
        storyProjectId: HU_BAO_VILLA_PROJECT_ID,
        runtimeSchemaVersion: bundle.filmSpec.runtimeSchemaVersion,
        targetDurationMs: bundle.filmSpec.duration.targetMs,
        durationToleranceMs: bundle.filmSpec.duration.toleranceMs,
        maxContinuousDurationMs: bundle.filmSpec.duration.maxContinuousMs,
        maxGeneratedClipDurationMs: bundle.filmSpec.duration.maxGeneratedClipMs,
        targetClipCount: bundle.filmSpec.targets.clipCount,
        targetChoiceCount: bundle.filmSpec.targets.choiceCount,
        targetEndingCount: bundle.filmSpec.targets.endingCount,
        frameWidth: bundle.filmSpec.frame.width,
        frameHeight: bundle.filmSpec.frame.height,
        frameRateNumerator: bundle.filmSpec.frame.framesPerSecond.numerator,
        frameRateDenominator: bundle.filmSpec.frame.framesPerSecond.denominator,
        audioSampleRate: bundle.filmSpec.audioSampleRateHz,
        defaultLocale: bundle.filmSpec.locales.defaultLocale,
        enabledLocales: asJson(bundle.filmSpec.locales.enabledLocales),
        defaultCanonicalModelId:
          bundle.filmSpec.generation.defaultCanonicalModelId,
        reviewPolicy: 'explicit_approval',
        specJson: asJson(bundle.filmSpec),
        specHash,
        createdByUserId: userId,
        updatedByUserId: userId,
      },
    });

    await tx.storyFilmReferenceSlot.createMany({
      data: bundle.referenceSlotSpecs.map((slot) => ({
        storyProjectId: HU_BAO_VILLA_PROJECT_ID,
        revisionId: revision.id,
        key: slot.key,
        kind: StoryFilmReferenceKind[slot.kind],
        label: slot.label,
        description: slot.description,
        required: slot.required,
        rank: slot.rank,
      })),
    });
    await tx.storyFilmClip.createMany({
      data: bundle.clipSpecs.map((clip) => ({
        storyProjectId: HU_BAO_VILLA_PROJECT_ID,
        revisionId: revision.id,
        key: clip.key,
        graphNodeId: clip.graphNodeId,
        title: clip.title,
        generationMode:
          clip.generationControl.mode === 'omni_reference'
            ? StoryFilmGenerationMode.omni_reference
            : StoryFilmGenerationMode.frame_lock,
        frameMode:
          clip.generationControl.mode === 'frame_lock'
            ? StoryFilmFrameMode[clip.generationControl.frameMode]
            : null,
        targetDurationMs: clip.targetDurationMs,
        specJson: asJson(clip),
        specHash: requiredMapValue(clipHashes, clip.key, 'clip hash'),
        productionInputHash: null,
        rank: clip.rank,
        createdByUserId: userId,
        updatedByUserId: userId,
      })),
    });

    const slots = await tx.storyFilmReferenceSlot.findMany({
      where: { revisionId: revision.id },
      select: { id: true, key: true },
    });
    const clips = await tx.storyFilmClip.findMany({
      where: { revisionId: revision.id },
      select: { id: true, key: true },
    });
    const slotIdByKey = new Map(slots.map((slot) => [slot.key, slot.id]));
    const clipIdByKey = new Map(clips.map((clip) => [clip.key, clip.id]));

    const clipReferences = flattenClipReferencePlans(
      bundle.clipReferencePlans,
      clipIdByKey,
      slotIdByKey,
      revision.id,
    );
    await tx.storyFilmClipReference.createMany({ data: clipReferences });

    const clipDependencies = flattenClipDependencyPlans(
      bundle.clipDependencyPlans,
      clipIdByKey,
      slotIdByKey,
      revision.id,
    );
    await tx.storyFilmClipDependency.createMany({ data: clipDependencies });

    const filmSpec = await tx.storyFilmSpec.findUniqueOrThrow({
      where: { revisionId: revision.id },
      select: { productionRevision: true },
    });
    return {
      created: true,
      workspaceId,
      projectId: HU_BAO_VILLA_PROJECT_ID,
      revisionId: revision.id,
      productionRevision: filmSpec.productionRevision,
      referenceSlotCount: slots.length,
      clipCount: clips.length,
      clipReferenceCount: clipReferences.length,
      clipDependencyCount: clipDependencies.length,
    };
  });
}

function flattenClipReferencePlans(
  plans: HuBaoVillaClipReferencePlan[],
  clipIdByKey: Map<string, string>,
  slotIdByKey: Map<string, string>,
  revisionId: string,
): Prisma.StoryFilmClipReferenceCreateManyInput[] {
  return plans.flatMap((plan) =>
    plan.bindings.map((binding) => ({
      storyProjectId: HU_BAO_VILLA_PROJECT_ID,
      revisionId,
      clipId: requiredMapValue(clipIdByKey, plan.clipKey, 'clip'),
      referenceSlotId: requiredMapValue(
        slotIdByKey,
        binding.referenceSlotKey,
        'reference slot',
      ),
      role: StoryFilmClipReferenceRole[binding.role],
      position: binding.position,
      required: binding.required,
    })),
  );
}

function flattenClipDependencyPlans(
  plans: HuBaoVillaClipDependencyPlan[],
  clipIdByKey: Map<string, string>,
  slotIdByKey: Map<string, string>,
  revisionId: string,
): Prisma.StoryFilmClipDependencyCreateManyInput[] {
  return plans.map((plan) => ({
    storyProjectId: HU_BAO_VILLA_PROJECT_ID,
    revisionId,
    predecessorClipId: requiredMapValue(
      clipIdByKey,
      plan.predecessorClipKey,
      'predecessor clip',
    ),
    successorClipId: requiredMapValue(
      clipIdByKey,
      plan.successorClipKey,
      'successor clip',
    ),
    kind: StoryFilmDependencyKind[plan.kind],
    transition: StoryFilmDependencyTransition[plan.transition.kind],
    joinFrameSlotId:
      plan.transition.kind === 'shared_join_frame'
        ? requiredMapValue(
            slotIdByKey,
            plan.transition.joinFrameReferenceSlotKey,
            'join-frame slot',
          )
        : null,
  }));
}

async function verifyExistingImport(
  prisma: PrismaClient,
  workspaceId: string,
  userId: string,
  bundle: HuBaoVillaImportBundle,
): Promise<ImportResult> {
  const project = await prisma.storyProject.findUniqueOrThrow({
    where: { id: HU_BAO_VILLA_PROJECT_ID },
  });
  assertImport(
    project.workspaceId === workspaceId,
    'project belongs to another workspace',
  );
  assertImport(
    project.format === StoryFormat.interactive_film,
    'project format differs',
  );
  assertImport(
    project.frameProfile === StoryFrameProfile[HU_BAO_VILLA_FRAME_PROFILE],
    'project frame profile differs',
  );
  assertImport(
    project.status === StoryProjectStatus.active,
    'project is not active',
  );
  assertImport(
    project.title === HU_BAO_VILLA_DRAFT_CONTENT.title,
    'project title differs',
  );

  const [owner, draft, revision, slots, clips, references, dependencies] =
    await Promise.all([
      prisma.storyProjectMember.findFirst({
        where: {
          storyProjectId: project.id,
          userId,
          role: StoryProjectMemberRole.owner,
          status: StoryProjectMemberStatus.active,
        },
      }),
      prisma.storyDraft.findUnique({ where: { storyProjectId: project.id } }),
      prisma.storyRevision.findFirst({
        where: { storyProjectId: project.id, number: 1 },
      }),
      prisma.storyFilmReferenceSlot.findMany({
        where: { storyProjectId: project.id, archivedAt: null },
      }),
      prisma.storyFilmClip.findMany({
        where: { storyProjectId: project.id, archivedAt: null },
      }),
      prisma.storyFilmClipReference.findMany({
        where: { storyProjectId: project.id },
        include: {
          clip: { select: { key: true } },
          referenceSlot: { select: { key: true } },
        },
      }),
      prisma.storyFilmClipDependency.findMany({
        where: { storyProjectId: project.id },
        include: {
          predecessorClip: { select: { key: true } },
          successorClip: { select: { key: true } },
          joinFrameSlot: { select: { key: true } },
        },
      }),
    ]);

  assertImport(Boolean(owner), 'active owner membership is missing');
  const expectedContentHash = canonicalJsonHash(bundle.draftContent);
  assertImport(Boolean(draft), 'draft is missing');
  assertImport(
    draft?.schemaVersion === DRAFT_SCHEMA_VERSION,
    'draft schema differs',
  );
  assertImport(draft?.revision === 1, 'draft revision differs');
  assertImport(
    draft?.contentHash === expectedContentHash,
    'draft hash differs',
  );
  assertImport(
    draft ? canonicalJsonHash(draft.content) === expectedContentHash : false,
    'draft content differs',
  );
  assertImport(Boolean(revision), 'locked revision 1 is missing');
  assertImport(
    revision?.source === StoryRevisionSource.import,
    'revision source differs',
  );
  assertImport(
    revision?.sourceDraftRevision === 1,
    'source draft revision differs',
  );
  assertImport(
    revision?.contentHash === expectedContentHash,
    'revision hash differs',
  );
  assertImport(
    revision
      ? canonicalJsonHash(revision.content) === expectedContentHash
      : false,
    'revision content differs',
  );
  if (!revision) throw new Error('Locked revision 1 is missing.');

  const filmSpec = await prisma.storyFilmSpec.findUnique({
    where: { revisionId: revision.id },
  });
  assertImport(Boolean(filmSpec), 'film specification is missing');
  assertImport(
    filmSpec?.specHash === canonicalJsonHash(bundle.filmSpec),
    'film specification hash differs',
  );
  assertImport(
    filmSpec
      ? canonicalJsonHash(filmSpec.specJson) === filmSpec.specHash
      : false,
    'stored film specification is corrupt',
  );

  assertExactSet(
    slots.map((slot) =>
      [slot.key, slot.kind, slot.label, slot.required, slot.rank].join('|'),
    ),
    bundle.referenceSlotSpecs.map((slot) =>
      [slot.key, slot.kind, slot.label, slot.required, slot.rank].join('|'),
    ),
    'reference slots',
  );
  const expectedClipHashByKey = new Map(
    bundle.clipSpecs.map((clip) => [clip.key, canonicalJsonHash(clip)]),
  );
  assertExactSet(
    clips.map((clip) => {
      assertImport(
        clip.productionInputManifest === null &&
          clip.productionInputHash === null,
        `${clip.key} has resolved or fabricated production inputs`,
      );
      return [
        clip.key,
        clip.graphNodeId,
        clip.specHash,
        clip.targetDurationMs,
        clip.rank,
      ].join('|');
    }),
    bundle.clipSpecs.map((clip) =>
      [
        clip.key,
        clip.graphNodeId,
        requiredMapValue(expectedClipHashByKey, clip.key, 'clip hash'),
        clip.targetDurationMs,
        clip.rank,
      ].join('|'),
    ),
    'film clips',
  );
  assertExactSet(
    references.map((reference) =>
      [
        reference.clip.key,
        reference.referenceSlot.key,
        reference.role,
        reference.position,
        reference.required,
      ].join('|'),
    ),
    bundle.clipReferencePlans.flatMap((plan) =>
      plan.bindings.map((binding) =>
        [
          plan.clipKey,
          binding.referenceSlotKey,
          binding.role,
          binding.position,
          binding.required,
        ].join('|'),
      ),
    ),
    'clip references',
  );
  assertExactSet(
    dependencies.map((dependency) =>
      [
        dependency.predecessorClip.key,
        dependency.successorClip.key,
        dependency.kind,
        dependency.transition,
        dependency.joinFrameSlot?.key ?? '',
      ].join('|'),
    ),
    bundle.clipDependencyPlans.map((plan) =>
      [
        plan.predecessorClipKey,
        plan.successorClipKey,
        plan.kind,
        plan.transition.kind,
        plan.transition.kind === 'shared_join_frame'
          ? plan.transition.joinFrameReferenceSlotKey
          : '',
      ].join('|'),
    ),
    'clip dependencies',
  );

  return {
    created: false,
    workspaceId,
    projectId: project.id,
    revisionId: revision.id,
    productionRevision: filmSpec?.productionRevision ?? 0,
    referenceSlotCount: slots.length,
    clipCount: clips.length,
    clipReferenceCount: references.length,
    clipDependencyCount: dependencies.length,
  };
}

function assertExactSet(
  actual: string[],
  expected: string[],
  label: string,
): void {
  const actualSorted = [...actual].sort();
  const expectedSorted = [...expected].sort();
  assertImport(
    JSON.stringify(actualSorted) === JSON.stringify(expectedSorted),
    `${label} differ from the locked import`,
  );
}

function assertBundleFrameContract(bundle: HuBaoVillaImportBundle): void {
  assertImport(
    frameContractMatchesStoryProfile(
      HU_BAO_VILLA_FRAME_PROFILE,
      bundle.filmSpec.frame,
    ),
    'film specification does not match the landscape project frame profile',
  );
  bundle.clipSpecs.forEach((clip) => {
    assertImport(
      frameContractMatchesStoryProfile(
        HU_BAO_VILLA_FRAME_PROFILE,
        clip.outputContract,
      ),
      `${clip.key} output contract does not match the landscape project frame profile`,
    );
  });
}

function assertImport(condition: unknown, detail: string): asserts condition {
  if (!condition) {
    throw new Error(
      `Existing ${HU_BAO_VILLA_PROJECT_ID} is not the locked v1.1 import: ${detail}.`,
    );
  }
}

function requiredMapValue<K, V>(map: Map<K, V>, key: K, label: string): V {
  const value = map.get(key);
  if (value === undefined)
    throw new Error(`Missing ${label} for ${String(key)}.`);
  return value;
}

function asJson(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

main().catch((error) => {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    console.error(error.message, { code: error.code, meta: error.meta });
    const driverError = error.meta?.driverAdapterError as
      | { cause?: unknown }
      | undefined;
    if (driverError?.cause) console.error(driverError.cause);
  } else {
    console.error(error instanceof Error ? error.stack : String(error));
  }
  process.exit(1);
});
