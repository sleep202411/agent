import { PrismaClient, Prisma } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { CopilotDocumentService } from '../copilot/copilot-document.service';
import sharp from 'sharp';
import { randomUUID } from 'node:crypto';
import { AppStoryAgentService } from './app-story-agent.service';
import * as configuration from './app-story-agent.config';
import * as scriptStage from '../story-studio/story-script-stage';
import { STORY_SCREENPLAY_DOCUMENT_SCHEMA_VERSION } from '@repo/shared/story-agent';

const readAppStoryAgentConfig = configuration.appStoryAgentConfig;

const requireModule = process
  .getBuiltinModule('module')
  .createRequire(__filename);
const { PGlite } = requireModule(
  '@electric-sql/pglite',
) as typeof import('@electric-sql/pglite');
const { PGLiteSocketServer } = requireModule(
  '@electric-sql/pglite-socket',
) as typeof import('@electric-sql/pglite-socket');
const projectId = randomUUID(),
  chapterId = randomUUID(),
  workspaceId = randomUUID();
const user = { userId: 'app-user' };
const plan = {
  kind: 'production',
  goal: 'video',
  firstStage: 'script',
  title: 'Beijing',
  summary: 'A city film',
  brief: 'Make a linear city film.',
  profile: {
    frameProfile: 'landscape_16_9',
    durationPreset: 'short_5_15',
    visualStyle: 'cinematic-realism',
  },
};
const config = {
  workerUrl: 'http://worker.invalid',
  token: 'fixture-internal-token-with-32-characters',
  authorizationLimit: 100,
  planner: 'fixture-planner',
  author: 'fixture-author',
  image: 'image',
  video: 'video',
};

/** Disposable PostgreSQL engine; no environment database or production network is used. */
describe('App Story production recovery (Prisma + PostgreSQL)', () => {
  let directory: string,
    db: InstanceType<typeof PGlite>,
    socket: InstanceType<typeof PGLiteSocketServer>,
    prisma: PrismaClient,
    service: AppStoryAgentService;
  const permissions = { requireProject: jest.fn() };
  const projects = { get: jest.fn(), patch: jest.fn(), create: jest.fn() };
  const workspaces = { ensureDefaultWorkspace: jest.fn() };
  const authoring = {
    createAuthoringRun: jest.fn(),
    getRunForProject: jest.fn(),
    confirmForProject: jest.fn(),
    cancelFromApp: jest.fn(),
  };
  const production = {
    getProductionState: jest.fn(),
    listAssetSpecs: jest.fn(),
    getStoryboard: jest.fn(),
    listGenerationMedia: jest.fn(),
  };
  const batches = {
    get: jest.fn(),
    quoteAssets: jest.fn(),
    quoteStoryboardClips: jest.fn(),
    confirm: jest.fn(),
    resume: jest.fn(),
    cancel: jest.fn(),
  };
  const preview = { getWorkingPreview: jest.fn() };
  const ai = { listCatalog: jest.fn() };
  const documents = { create: jest.fn() };
  const nativeFetch = globalThis.fetch;
  const quoteDetails = {
    items: [{ outputKind: 'image' }],
    quoteExpiresAt: '2099-01-01T00:00:00.000Z',
  };
  beforeAll(async () => {
    directory = await mkdtemp('/tmp/app-story-pg-');
    db = await PGlite.create();
    await db.exec(`CREATE TYPE "StoryAgentRunStatus" AS ENUM ('authoring','authoring_failed','proposed','applying','succeeded','failed','cancelled','expired','stale');
      CREATE TYPE "StoryGenerationBatchStatus" AS ENUM ('awaiting_confirmation','queued','running','blocked','completed','failed','partial_failed','cancelling','cancelled','expired');
      CREATE TABLE story_chapters(id uuid PRIMARY KEY, story_project_id uuid, entry_node_id text, archived_at timestamptz, title text DEFAULT 'Chapter',rank int DEFAULT 0,created_at timestamptz DEFAULT now(),updated_at timestamptz DEFAULT now(), UNIQUE(id,story_project_id));
      CREATE TABLE copilot_documents(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),user_id text,conversation_id text,name text,media_type text,size_bytes int,char_count int,text text,created_at timestamptz DEFAULT now());
      CREATE TABLE story_agent_runs(id uuid PRIMARY KEY, source_agent_run_id uuid, status "StoryAgentRunStatus");
      CREATE TABLE agent_os_runs(id uuid PRIMARY KEY,project_id uuid,project_kind text,status text,actor_id text,assistant_text text,start_command jsonb,created_at timestamptz);
      CREATE TABLE story_generation_batches(id uuid PRIMARY KEY,story_project_id uuid,story_chapter_id uuid,actor_user_id text,idempotency_key text,status "StoryGenerationBatchStatus");
      CREATE TABLE story_drafts(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),story_project_id uuid UNIQUE,content jsonb);`);
    const legacyId = randomUUID();
    await db.query(
      "INSERT INTO story_agent_runs(id,status) VALUES ($1,'authoring')",
      [legacyId],
    );
    await db.exec(
      await readFile(
        join(
          __dirname,
          '../../prisma/migrations/20261010123000_app_story_agent/migration.sql',
        ),
        'utf8',
      ),
    );
    await db.exec(
      await readFile(
        join(
          __dirname,
          '../../prisma/migrations/20261010220000_app_story_harness_ui/migration.sql',
        ),
        'utf8',
      ),
    );
    await db.exec(
      'ALTER TABLE story_agent_runs ADD COLUMN initiated_by_user_id text',
    );
    expect(
      (
        await db.query(
          'SELECT status,source_app_story_run_id FROM story_agent_runs WHERE id=$1',
          [legacyId],
        )
      ).rows,
    ).toEqual([{ status: 'authoring', source_app_story_run_id: null }]);
    await db.exec(`ALTER TABLE story_generation_batches ADD COLUMN version int DEFAULT 1, ADD COLUMN cancelled_at timestamptz, ADD COLUMN updated_at timestamptz DEFAULT now();
      CREATE TYPE "StoryGenerationBatchItemStatus" AS ENUM ('awaiting_confirmation','ready','dispatching','submitted','completed','failed','cancelled');
      CREATE TABLE story_generation_batch_items(id uuid PRIMARY KEY,batch_id uuid,status "StoryGenerationBatchItemStatus",completed_at timestamptz,updated_at timestamptz DEFAULT now());`);
    await db.query(
      'INSERT INTO story_chapters(id,story_project_id) VALUES ($1,$2)',
      [chapterId, projectId],
    );
    await db.query(
      'INSERT INTO story_drafts(story_project_id,content) VALUES ($1,$2)',
      [projectId, JSON.stringify({ graph: { nodes: [] } })],
    );
    socket = new PGLiteSocketServer({
      db,
      path: join(directory, '.s.PGSQL.5432'),
    });
    await socket.start();
    prisma = new PrismaClient({
      adapter: new PrismaPg({
        host: directory,
        port: 5432,
        database: 'postgres',
        user: 'postgres',
        max: 1,
      }),
    });
  }, 30000);
  beforeEach(async () => {
    jest.resetAllMocks();
    jest
      .spyOn(configuration, 'appStoryAgentConfig')
      .mockReturnValue({ ...config });
    await db.exec(
      'TRUNCATE app_story_runs,app_story_conversations,app_story_attachments,copilot_documents,story_agent_runs,story_generation_batches,story_generation_batch_items,agent_os_runs CASCADE',
    );
    await db.query('UPDATE story_chapters SET entry_node_id=NULL');
    await db.query('UPDATE story_drafts SET content=$1', [
      JSON.stringify({ graph: { entryNodeId: null, nodes: [] } }),
    ]);
    documents.create.mockImplementation(
      (input: Parameters<CopilotDocumentService['create']>[0]) =>
        new CopilotDocumentService(prisma as never).create(input),
    );
    permissions.requireProject.mockResolvedValue({
      project: { workspaceId, defaultLocale: 'en-US' },
    });
    projects.get.mockResolvedValue({
      workspaceId,
      title: 'Project',
      ...plan.profile,
      projectVersion: 1,
      creativeProfileConfirmedAt: new Date(),
    });
    production.getProductionState.mockResolvedValue({
      script: { status: 'current' },
      plotTree: { status: 'current' },
      assets: { status: 'current' },
      storyboard: { status: 'current' },
    });
    production.listAssetSpecs.mockResolvedValue([]);
    production.listGenerationMedia.mockResolvedValue([]);
    production.getStoryboard.mockResolvedValue([
      { plotNodeId: 'one', clips: [{ selectedMediaVersionId: randomUUID() }] },
    ]);
    preview.getWorkingPreview.mockResolvedValue({
      runtime: {},
      diagnostics: [],
    });
    ai.listCatalog.mockResolvedValue({
      models: ['image', 'video'].map((type) => ({
        id: type,
        name: type,
        type,
        enabled: true,
        schemaVersion: 'v1',
        input_schema: {
          properties: {
            duration: {
              type: 'string',
              enum: Array.from({ length: 11 }, (_, index) => String(index + 5)),
            },
          },
        },
      })),
    });
    service = new AppStoryAgentService(
      prisma as never,
      permissions as never,
      projects as never,
      authoring as never,
      production as never,
      batches as never,
      preview as never,
      ai as never,
      documents as never,
      workspaces as never,
    );
    Object.assign(service.config, config);
  });
  afterAll(async () => {
    globalThis.fetch = nativeFetch;
    await prisma?.$disconnect();
    await socket?.stop();
    await db?.close();
    if (directory) await rm(directory, { recursive: true, force: true });
  });
  const start = (submissionId = randomUUID()) =>
    service.start(user, projectId, {
      submissionId,
      chapterId,
      message: 'Make a Beijing video',
      authorizedPoints: 100,
    });
  it('creates a private standalone entry without authoring or paid generation', async () => {
    const find = jest
      .spyOn(prisma.storyProject, 'findUnique')
      .mockResolvedValue(null);
    workspaces.ensureDefaultWorkspace.mockResolvedValue({ id: workspaceId });
    projects.create.mockResolvedValue({
      project: { id: projectId },
      chapter: { id: projectId },
    });
    try {
      expect(
        await service.createEntry(user, {
          entryId: projectId,
          locale: 'en-US',
          title: 'New story',
        }),
      ).toEqual({
        ready: true,
        locale: 'en-US',
        projectId,
        chapterId: projectId,
      });
      expect(projects.create).toHaveBeenCalledWith(
        user,
        {
          workspaceId,
          title: 'New story',
          defaultLocale: 'en-US',
          visibility: 'private',
        },
        { projectId, chapterId: projectId },
      );
      expect(authoring.createAuthoringRun).not.toHaveBeenCalled();
      expect(batches.confirm).not.toHaveBeenCalled();
    } finally {
      find.mockRestore();
    }
  });
  it('reconciles concurrent standalone creation only with the same owned, editable project', async () => {
    const find = jest
      .spyOn(prisma.storyProject, 'findUnique')
      .mockResolvedValueOnce(null)
      .mockResolvedValue({
        createdByUserId: user.userId,
        archivedAt: null,
        chapters: [{ id: projectId }],
      } as never);
    workspaces.ensureDefaultWorkspace.mockResolvedValue({ id: workspaceId });
    projects.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('Duplicate project', {
        code: 'P2002',
        clientVersion: 'test',
      }),
    );
    try {
      expect(
        await service.createEntry(user, {
          entryId: projectId,
          locale: 'en-US',
          title: 'New story',
        }),
      ).toEqual({
        ready: true,
        locale: 'en-US',
        projectId,
        chapterId: projectId,
      });
      expect(permissions.requireProject).toHaveBeenCalledWith(
        user.userId,
        projectId,
        'story.edit',
      );
      find.mockResolvedValue({
        createdByUserId: 'other-user',
        archivedAt: null,
        chapters: [{ id: chapterId }],
      } as never);
      await expect(
        service.createEntry(user, {
          entryId: projectId,
          locale: 'en-US',
          title: 'New story',
        }),
      ).rejects.toThrow('Story entry is not available.');
      expect(projects.create).toHaveBeenCalledTimes(1);
    } finally {
      find.mockRestore();
    }
  });
  const claim = async () => {
    await prisma.appStoryRun.updateMany({
      data: { nextAttemptAt: new Date(0) },
    });
    return (await service.claim('worker'))!;
  };
  const producing = async (phase = 'asset_media') => {
    const run = await start();
    await prisma.appStoryRun.update({
      where: { id: run.id },
      data: { status: 'producing', phase, plan },
    });
    return claim();
  };
  const pendingVideoEstimate = async () => {
    const run = await producing('clip_media'),
      batchId = randomUUID();
    const items = [
      {
        targetId: randomUUID(),
        sequenceId: randomUUID(),
        targetVersion: 3,
        outputKind: 'image',
      },
      {
        targetId: randomUUID(),
        sequenceId: randomUUID(),
        targetVersion: 4,
        outputKind: 'video',
      },
    ];
    await db.query(
      `INSERT INTO story_generation_batches(id,story_project_id,story_chapter_id,actor_user_id,idempotency_key,status)
      VALUES ($1,$2,$3,$4,$5,'awaiting_confirmation')`,
      [
        batchId,
        projectId,
        chapterId,
        user.userId,
        `app:${run.id}:clip_media:0`,
      ],
    );
    await db.query(
      `INSERT INTO story_generation_batch_items(id,batch_id,status) VALUES ($1,$2,'awaiting_confirmation')`,
      [randomUUID(), batchId],
    );
    await prisma.appStoryRun.update({
      where: { id: run.id },
      data: { batchId },
    });
    batches.get.mockResolvedValue({
      id: batchId,
      status: 'awaiting_confirmation',
      version: 1,
      totalPoints: 30,
      ...quoteDetails,
      items,
    });
    await service.step(
      { ...run, batchId },
      'worker',
      new AbortController().signal,
    );
    await service.finishAttempt(run, 'worker');
    const paused = await prisma.appStoryRun.findUniqueOrThrow({
      where: { id: run.id },
    });
    const catalog = (await ai.listCatalog()) as {
      models: Array<Record<string, unknown>>;
    };
    ai.listCatalog.mockResolvedValue({
      models: [
        ...catalog.models,
        ...[
          'seedance-2-5',
          'happyhorse-1-0',
          'minimax-h3',
          'minimax-h3-max',
        ].map((id) => ({
          id,
          name: id,
          type: 'video',
          enabled: true,
          schemaVersion: 'v2',
          input_schema: {
            properties: {
              durationSeconds: { type: 'integer', minimum: 5, maximum: 30 },
            },
          },
        })),
      ],
    });
    batches.quoteStoryboardClips.mockResolvedValue({
      id: randomUUID(),
      version: 1,
      totalPoints: 60,
      ...quoteDetails,
      items,
    });
    return {
      run: paused,
      items,
      input: {
        modelId: 'minimax-h3-max',
        runVersion: paused.version,
        quote: { batchId, version: 1, points: 30 },
      },
    };
  };

  it.each([
    { scenario: 'alternative endings', routeDurationMs: 20_000 },
    { scenario: 'a loop', routeDurationMs: null },
    { scenario: 'a missing scene timeline', routeDurationMs: null },
  ])(
    'quotes $scenario without adding branches or blocking on unknown duration',
    async ({ scenario, routeDurationMs }) => {
      const clip = (
        nodeId: string,
        routes: Array<{ target: { kind: 'node'; nodeId: string } | null }>,
      ) => ({
        kind: 'clip',
        nodeId,
        clipKey: nodeId.toUpperCase(),
        communityPointPrice: 0,
        exit: { kind: 'auto', routes },
      });
      await db.query('UPDATE story_chapters SET entry_node_id=$1', ['opening']);
      await db.query('UPDATE story_drafts SET content=$1', [
        JSON.stringify({
          graph: {
            entryNodeId: 'other_chapter',
            nodes: [
              clip('opening', [{ target: { kind: 'node', nodeId: 'choice' } }]),
              {
                kind: 'decision',
                nodeId: 'choice',
                exit: {
                  kind: 'choice',
                  decisionId: 'route_choice',
                  prompt: { 'en-US': 'Choose' },
                  choices: [
                    {
                      choiceId: 'short',
                      label: { 'en-US': 'Short' },
                      target: { kind: 'node', nodeId: 'short_end' },
                    },
                    {
                      choiceId: 'long',
                      label: { 'en-US': 'Long' },
                      target: { kind: 'node', nodeId: 'long_end' },
                    },
                  ],
                },
              },
              clip('short_end', [
                {
                  target:
                    scenario === 'a loop'
                      ? { kind: 'node', nodeId: 'opening' }
                      : null,
                },
              ]),
              clip('long_end', [{ target: null }]),
              clip('other_chapter', [{ target: null }]),
            ],
          },
        }),
      ]);
      production.getStoryboard.mockResolvedValue(
        [
          { plotNodeId: 'opening', durationMs: 5_000, clips: [] },
          { plotNodeId: 'short_end', durationMs: 10_000, clips: [] },
          { plotNodeId: 'long_end', durationMs: 15_000, clips: [] },
          { plotNodeId: 'other_chapter', durationMs: 60_000, clips: [] },
        ].filter(
          (sequence) =>
            scenario !== 'a missing scene timeline' ||
            sequence.plotNodeId !== 'long_end',
        ),
      );
      const { run, input } = await pendingVideoEstimate();
      expect(run.mediaQuote).toMatchObject({ routeDurationMs });
      const changed = await service.changeVideoModel(
        user,
        projectId,
        run.id,
        input,
      );
      expect(changed.mediaQuote).toMatchObject({ routeDurationMs });
      expect(batches.confirm).not.toHaveBeenCalled();
    },
  );

  it.each(['seedance-2-5', 'happyhorse-1-0', 'minimax-h3', 'minimax-h3-max'])(
    'requotes %s without admitting generation or rebuilding existing media',
    async (modelId) => {
      const { run, items, input } = await pendingVideoEstimate();
      const changed = await service.changeVideoModel(user, projectId, run.id, {
        ...input,
        modelId,
      });
      expect(changed.status).toBe('blocked');
      expect(changed.mediaQuote).toMatchObject({
        points: 60,
        approved: false,
        videoModelId: modelId,
        imageCount: 1,
        videoCount: 1,
      });
      expect(changed.committedPoints).toBe(0);
      expect(changed.authorizedPoints).toBe(run.authorizedPoints);
      expect(batches.confirm).not.toHaveBeenCalled();
      expect(production.getStoryboard).not.toHaveBeenCalled();
      expect(batches.quoteStoryboardClips).toHaveBeenCalledWith(
        user,
        projectId,
        chapterId,
        expect.any(String),
        {
          targets: items.map((item) => ({
            id: item.targetId,
            sequenceId: item.sequenceId,
            expectedVersion: item.targetVersion,
          })),
        },
        expect.objectContaining({
          models: expect.objectContaining({
            video: {
              modelId,
              schemaVersion: 'v2',
              clipDurationSeconds: [5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
              options: { aspectRatio: '16:9' },
            },
          }) as unknown,
        }),
      );
      expect(
        (
          await prisma.storyGenerationBatch.findUniqueOrThrow({
            where: { id: input.quote.batchId },
            select: { status: true },
          })
        ).status,
      ).toBe('cancelled');
      expect(
        (await db.query('SELECT status FROM story_generation_batch_items'))
          .rows[0],
      ).toEqual({ status: 'cancelled' });
      await expect(
        service.resume(user, projectId, run.id, undefined, input.quote),
      ).rejects.toThrow('Confirm the current');
      await service.resume(
        user,
        projectId,
        run.id,
        undefined,
        changed.mediaQuote!,
      );
      const approved = await prisma.appStoryRun.findUniqueOrThrow({
        where: { id: run.id },
      });
      expect(approved.mediaQuote).toMatchObject({
        approved: true,
        videoModelId: modelId,
      });
      expect(approved.modelConfig).toMatchObject({ video: { modelId } });
    },
  );

  it('rejects unavailable models and keeps the old quote when new parameters cannot be quoted', async () => {
    const { run, input } = await pendingVideoEstimate();
    await expect(
      service.changeVideoModel(user, projectId, run.id, {
        ...input,
        modelId: 'arbitrary-model',
      }),
    ).rejects.toThrow('unavailable');
    expect(batches.quoteStoryboardClips).not.toHaveBeenCalled();
    batches.quoteStoryboardClips.mockRejectedValue(
      new Error('Provider references are unsupported.'),
    );
    await expect(
      service.changeVideoModel(user, projectId, run.id, input),
    ).rejects.toThrow('references are unsupported');
    expect(
      (await prisma.appStoryRun.findUniqueOrThrow({ where: { id: run.id } }))
        .mediaQuote,
    ).toEqual(run.mediaQuote);
    expect(batches.confirm).not.toHaveBeenCalled();
  });

  it('removes Seedance 2.0 and requires a fresh supported-model quote for its pending work', async () => {
    const { run, input } = await pendingVideoEstimate();
    const catalog = (await ai.listCatalog()) as {
      models: Array<{ id: string; [key: string]: unknown }>;
    };
    ai.listCatalog.mockResolvedValue({
      models: [
        ...catalog.models,
        {
          ...catalog.models.find((model) => model.id === 'seedance-2-5'),
          id: 'seedance-2-0',
        },
      ],
    });
    service.config.video = 'seedance-2-0';
    await prisma.appStoryRun.update({
      where: { id: run.id },
      data: {
        modelConfig: {
          ...configuration.PinnedModelsSchema.parse(run.modelConfig),
          video: {
            modelId: 'seedance-2-0',
            schemaVersion: 'v1',
            clipDurationSeconds: [5, 10, 15],
          },
        },
      },
    });
    expect(
      (await service.videoModels(user, projectId, run.id)).models.map(
        (model) => model.id,
      ),
    ).toEqual([
      'seedance-2-5',
      'happyhorse-1-0',
      'minimax-h3',
      'minimax-h3-max',
    ]);
    await expect(
      service.changeVideoModel(user, projectId, run.id, {
        ...input,
        modelId: 'seedance-2-0',
      }),
    ).rejects.toThrow('unavailable');
    await expect(
      service.resume(user, projectId, run.id, undefined, input.quote),
    ).rejects.toThrow('no longer supported');
    expect(batches.quoteStoryboardClips).not.toHaveBeenCalled();
    const changed = await service.changeVideoModel(user, projectId, run.id, {
      ...input,
      modelId: 'seedance-2-5',
    });
    expect(changed.mediaQuote).toMatchObject({
      videoModelId: 'seedance-2-5',
      approved: false,
    });
    expect(changed.authorizedPoints).toBe(run.authorizedPoints);
    expect(batches.confirm).not.toHaveBeenCalled();
  });

  it('renews an expired unconfirmed quote when changing models, requiring fresh consent', async () => {
    const { run, input, items } = await pendingVideoEstimate();
    await db.query(
      "UPDATE story_generation_batches SET status='expired',version=2 WHERE id=$1",
      [input.quote.batchId],
    );
    batches.get.mockResolvedValue({
      id: input.quote.batchId,
      status: 'expired',
      confirmedAt: null,
      version: 2,
      items,
    });
    const changed = await service.changeVideoModel(
      user,
      projectId,
      run.id,
      input,
    );
    expect(changed.mediaQuote).toMatchObject({
      points: 60,
      approved: false,
      videoModelId: input.modelId,
    });
    expect(changed.committedPoints).toBe(0);
    await expect(
      service.changeVideoModel(user, projectId, run.id, input),
    ).rejects.toThrow('estimate changed');
    expect(batches.confirm).not.toHaveBeenCalled();
  });

  it.each(['cancel', 'confirm'] as const)(
    'does not replace or authorize a quote when %s wins during requoting',
    async (operation) => {
      const { run, input } = await pendingVideoEstimate();
      const quoted: unknown = await batches.quoteStoryboardClips();
      batches.quoteStoryboardClips.mockImplementation(async () => {
        if (operation === 'cancel')
          await service.cancel(user, projectId, run.id);
        else
          await service.resume(user, projectId, run.id, undefined, input.quote);
        return quoted;
      });
      await expect(
        service.changeVideoModel(user, projectId, run.id, input),
      ).rejects.toThrow('production changed');
      const current = await prisma.appStoryRun.findUniqueOrThrow({
        where: { id: run.id },
      });
      expect(current.modelConfig).toEqual(run.modelConfig);
      expect(current.batchId).toBe(input.quote.batchId);
      expect(current.committedPoints).toBe(0);
    },
  );

  it('admits one stable submission, rejects changed retries and competing requests', async () => {
    const submissionId = randomUUID();
    const first = await start(submissionId);
    const admitted = await prisma.appStoryRun.findUniqueOrThrow({
      where: { id: first.id },
    });
    expect(
      configuration.PinnedModelsSchema.parse(admitted.modelConfig).video,
    ).toEqual({
      modelId: 'video',
      schemaVersion: 'v1',
      clipDurationSeconds: Array.from({ length: 11 }, (_, index) => index + 5),
    });
    const replay = await start(submissionId);
    expect(replay.id).toBe(first.id);
    expect(await prisma.appStoryRun.count()).toBe(1);
    await expect(
      service.start(user, projectId, {
        submissionId,
        chapterId,
        message: 'different',
        authorizedPoints: 100,
      }),
    ).rejects.toThrow('different request');
    await expect(start()).rejects.toThrow('active production');
    await expect(
      service.start(user, projectId, {
        submissionId: randomUUID(),
        chapterId,
        message: 'new',
        authorizedPoints: 101,
      }),
    ).rejects.toThrow('advertised limit');
  });

  it('pins numeric duration contracts within the App ceiling and rejects incompatible models', async () => {
    const model = (property: Record<string, unknown>) => ({
      input_schema: { properties: { durationSeconds: property } },
    });
    expect(
      configuration.appStoryVideoDurations(
        model({
          type: 'integer',
          minimum: 2,
          maximum: 30,
          multipleOf: 2,
        }) as never,
      ),
    ).toEqual([2, 4, 6, 8, 10, 12, 14]);
    expect(
      configuration.appStoryVideoDurations(
        model({
          type: 'integer',
          exclusiveMinimum: 5,
          exclusiveMaximum: 15,
        }) as never,
      ),
    ).toEqual([6, 7, 8, 9, 10, 11, 12, 13, 14]);
    ai.listCatalog.mockResolvedValue({
      models: [
        { id: 'image', type: 'image', enabled: true, schemaVersion: 'v1' },
        {
          id: 'video',
          type: 'video',
          enabled: true,
          schemaVersion: 'v1',
          ...model({ type: 'integer', enum: [20, 30] }),
        },
      ],
    });
    await expect(start()).rejects.toThrow('15 seconds or less');
    expect(await prisma.appStoryRun.count()).toBe(0);
  });

  it('keeps configured H3 models without substituting another video model', () => {
    const env = {
      ALIBABA_API_KEY: 'fixture-key',
      ALIBABA_BASE_URL: 'https://author.test.invalid/v1',
      APP_STORY_AGENT_WORKER_URL: config.workerUrl,
      APP_STORY_AGENT_INTERNAL_TOKEN: config.token,
      APP_STORY_AGENT_AUTHORIZATION_POINTS: '100',
      APP_STORY_AGENT_MODEL: config.planner,
      APP_STORY_AGENT_AUTHOR_MODEL: config.author,
      APP_STORY_AGENT_IMAGE_MODEL: config.image,
      APP_STORY_AGENT_VIDEO_MODEL: 'seedance-2-5',
    };
    expect(readAppStoryAgentConfig(env).video).toBe('seedance-2-5');
    expect(() =>
      readAppStoryAgentConfig({
        ...env,
        APP_STORY_AGENT_VIDEO_MODEL: 'seedance-2-0',
      }),
    ).toThrow('Seedance 2.0 is no longer supported');
    for (const video of ['minimax-h3', 'minimax-h3-max', 'MiniMax-H3'])
      expect(
        readAppStoryAgentConfig({
          ...env,
          APP_STORY_AGENT_VIDEO_MODEL: video,
        }).video,
      ).toBe(video);
  });

  it('rejects start and recovery while a production from another surface is active', async () => {
    const run = await start();
    await prisma.appStoryRun.update({
      where: { id: run.id },
      data: { status: 'failed' },
    });
    await db.query(
      "INSERT INTO agent_os_runs(id,project_id,project_kind,status,actor_id,created_at) VALUES ($1,$2,'story','running',$3,now())",
      [randomUUID(), projectId, user.userId],
    );
    await expect(start()).rejects.toThrow('previous production');
    await expect(service.resume(user, projectId, run.id)).rejects.toThrow(
      'previous production',
    );
    expect(
      (await prisma.appStoryRun.findUniqueOrThrow({ where: { id: run.id } }))
        .status,
    ).toBe('failed');
  });

  it('recovers expired leases and fences stale owners, including cancellation during planning', async () => {
    const run = await start();
    const first = await claim();
    expect(await service.claim('other')).toBeNull();
    await prisma.appStoryRun.update({
      where: { id: run.id },
      data: { leaseExpiresAt: new Date(0) },
    });
    const next = await service.claim('replacement');
    expect(next?.id).toBe(first.id);
    expect(await service.renew(run.id, 'worker')).toBe(false);
    await service.cancel(user, projectId, run.id);
    expect(await service.renew(run.id, 'replacement')).toBe(false);
    await expect(
      service.step(next!, 'replacement', new AbortController().signal),
    ).rejects.toThrow('stopped');
    expect(
      (await prisma.appStoryRun.findUniqueOrThrow({ where: { id: run.id } }))
        .status,
    ).toBe('cancelling');
  });

  it('rejects an invalid planner result instead of reporting success, then releases the lease', async () => {
    await start();
    const run = await claim();
    globalThis.fetch = jest.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          kind: 'reply',
          text: 'story_read',
          model: 'injected',
        }),
        { status: 200 },
      ),
    );
    let error: unknown;
    try {
      await service.step(run, 'worker', new AbortController().signal);
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeDefined();
    await service.finishAttempt(run, 'worker', error);
    const failed = await prisma.appStoryRun.findUniqueOrThrow({
      where: { id: run.id },
    });
    expect(failed.status).toBe('cancelling');
    expect(failed.result).toBeNull();
    expect(failed.leaseOwner).toBeNull();
    const cleanup = await claim();
    await service.step(cleanup, 'worker', new AbortController().signal);
    await service.finishAttempt(cleanup, 'worker');
    expect(
      (await prisma.appStoryRun.findUniqueOrThrow({ where: { id: run.id } }))
        .status,
    ).toBe('failed');
  });

  it('clears a prior planning failure when the same request completes as a reply', async () => {
    const accepted = await start();
    await prisma.appStoryRun.update({
      where: { id: accepted.id },
      data: {
        errorCode: 'APP_STORY_PLANNING_FAILED',
        errorDetail: 'The model did not submit an executable decision.',
      },
    });
    const run = await claim();
    globalThis.fetch = jest.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          decision: { kind: 'reply', text: 'Hello!' },
          events: [],
        }),
        {
          status: 200,
        },
      ),
    );
    await service.step(run, 'worker', new AbortController().signal);
    await service.finishAttempt(run, 'worker');
    const history = await service.history(user, projectId);
    expect(history.runs[0]).toMatchObject({
      status: 'completed',
      assistantText: 'Hello!',
      error: null,
      result: null,
      committedPoints: 0,
    });
    expect(authoring.createAuthoringRun).not.toHaveBeenCalled();
  });

  it.each([0, 1, 2])(
    'queues capacity rejections with %i prior model attempts, then completes the same submission',
    async (priorAttempts) => {
      const accepted = await start();
      await prisma.appStoryRun.update({
        where: { id: accepted.id },
        data: { attempts: priorAttempts },
      });
      globalThis.fetch = jest.fn().mockImplementation(() =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              code: 'APP_STORY_PLANNER_BUSY',
              message: 'Story planning is busy. Please retry.',
            }),
            { status: 503 },
          ),
        ),
      );
      for (let index = 0; index < 4; index++) {
        const run = await claim();
        const error = await service
          .step(run, 'worker', new AbortController().signal)
          .catch((reason: unknown) => reason);
        expect(error).toBeDefined();
        const before = Date.now();
        await service.finishAttempt(run, 'worker', error);
        const queued = await prisma.appStoryRun.findUniqueOrThrow({
          where: { id: accepted.id },
        });
        expect(queued).toMatchObject({
          status: 'queued',
          attempts: priorAttempts,
          committedPoints: 0,
          leaseOwner: null,
        });
        expect(queued.nextAttemptAt.getTime()).toBeGreaterThan(before + 4000);
        expect(await service.claim('early-worker')).toBeNull();
        expect(
          (await service.history(user, projectId)).runs[0].error,
        ).toBeNull();
      }
      globalThis.fetch = jest.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            decision: { kind: 'reply', text: 'Hello!' },
            events: [],
          }),
        ),
      );
      const run = await claim();
      await service.step(run, 'worker', new AbortController().signal);
      await service.finishAttempt(run, 'worker');
      expect((await service.history(user, projectId)).runs).toMatchObject([
        {
          id: accepted.id,
          status: 'completed',
          assistantText: 'Hello!',
          committedPoints: 0,
        },
      ]);
      expect(authoring.createAuthoringRun).not.toHaveBeenCalled();
    },
  );

  it('keeps capacity waits cancellable and bounded by the production deadline', async () => {
    const accepted = await start();
    const run = await claim();
    globalThis.fetch = jest.fn().mockResolvedValue(
      new Response(JSON.stringify({ code: 'APP_STORY_PLANNER_BUSY' }), {
        status: 503,
      }),
    );
    const error = await service
      .step(run, 'worker', new AbortController().signal)
      .catch((reason: unknown) => reason);
    await service.finishAttempt(run, 'worker', error);
    await service.cancel(user, projectId, accepted.id);
    const stopped = await claim();
    await service.step(stopped, 'worker', new AbortController().signal);
    await service.finishAttempt(stopped, 'worker');
    expect((await service.history(user, projectId)).runs[0].status).toBe(
      'cancelled',
    );

    await start();
    await prisma.appStoryRun.updateMany({
      where: { status: 'queued' },
      data: { deadlineAt: new Date(0) },
    });
    const expired = await claim();
    const deadlineError = await service
      .step(expired, 'worker', new AbortController().signal)
      .catch((reason: unknown) => reason);
    await service.finishAttempt(expired, 'worker', deadlineError);
    expect(
      (
        await prisma.appStoryRun.findUniqueOrThrow({
          where: { id: expired.id },
        })
      ).status,
    ).toBe('cancelling');
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });

  it('recovers transient planning timeouts with backoff and retains a finite attempt budget', async () => {
    await start();
    globalThis.fetch = jest
      .fn()
      .mockRejectedValue(
        new DOMException('The planning request timed out.', 'TimeoutError'),
      );
    for (let index = 0; index < 3; index++) {
      const run = await claim();
      const error = await service
        .step(run, 'worker', new AbortController().signal)
        .catch((reason: unknown) => reason);
      const before = Date.now();
      await service.finishAttempt(run, 'worker', error);
      const next = await prisma.appStoryRun.findUniqueOrThrow({
        where: { id: run.id },
      });
      expect(next.attempts).toBe(index + 1);
      expect(next.status).toBe(index < 2 ? 'queued' : 'cancelling');
      if (index < 2) {
        expect(next.nextAttemptAt.getTime()).toBeGreaterThan(
          before + 1000 * 2 ** (index + 1) - 500,
        );
        expect(
          (await service.history(user, projectId)).runs[0].error,
        ).toBeNull();
      }
    }
    const cleanup = await claim();
    await service.step(cleanup, 'worker', new AbortController().signal);
    await service.finishAttempt(cleanup, 'worker');
    expect((await service.history(user, projectId)).runs[0]).toMatchObject({
      status: 'failed',
      committedPoints: 0,
      error: { message: 'The planning request timed out.' },
    });
    expect(globalThis.fetch).toHaveBeenCalledTimes(3);
  });

  it('reads the saved canonical script only within an authorized active chapter', async () => {
    const documentId = randomUUID();
    const document = {
      schemaVersion: STORY_SCREENPLAY_DOCUMENT_SCHEMA_VERSION,
      blocks: [
        { kind: 'paragraph' as const, text: '<script> is plain source text.' },
      ],
    };
    const read = jest
      .spyOn(scriptStage, 'readStoryScriptSourceSnapshot')
      .mockResolvedValue({
        documentId,
        sequence: 3,
        hash: 'fixture',
        hasContent: true,
        sourceText: '<p>canonical source</p>',
        document,
      });
    try {
      await expect(service.script(user, projectId, chapterId)).resolves.toEqual(
        {
          documentId,
          sequence: 3,
          document,
        },
      );
      expect(permissions.requireProject).toHaveBeenCalledWith(
        user.userId,
        projectId,
        'story.read',
      );
      expect(read).toHaveBeenCalledWith(prisma, projectId, chapterId);
      read.mockResolvedValueOnce(null);
      await expect(
        service.script(user, projectId, chapterId),
      ).resolves.toBeNull();
      await expect(
        service.script(user, projectId, randomUUID()),
      ).rejects.toThrow('Story chapter not found');
      permissions.requireProject.mockRejectedValueOnce(
        new Error('Project access denied'),
      );
      await expect(service.script(user, projectId, chapterId)).rejects.toThrow(
        'Project access denied',
      );
      expect(read).toHaveBeenCalledTimes(2);
    } finally {
      read.mockRestore();
    }
  });

  it('refuses unplayable previews and validates chapter access before compiling', async () => {
    production.getStoryboard.mockResolvedValueOnce([
      { plotNodeId: 'one', clips: [{ selectedMediaVersionId: null }] },
    ]);
    await expect(
      service.workingPreview(user, projectId, chapterId),
    ).rejects.toThrow(
      'The requested media has not been attached to every storyboard clip.',
    );
    expect(preview.getWorkingPreview).not.toHaveBeenCalled();
    preview.getWorkingPreview.mockResolvedValue({
      runtime: null,
      diagnostics: [{ severity: 'error', message: 'Missing playable media' }],
    });
    await expect(
      service.workingPreview(user, projectId, chapterId),
    ).rejects.toThrow('Missing playable media');
    expect(preview.getWorkingPreview).toHaveBeenCalledWith(
      user,
      projectId,
      chapterId,
    );
    await expect(
      service.workingPreview(user, projectId, randomUUID()),
    ).rejects.toThrow('Story chapter not found');
    permissions.requireProject.mockRejectedValueOnce(
      new Error('Project access denied'),
    );
    await expect(
      service.workingPreview(user, projectId, chapterId),
    ).rejects.toThrow('Project access denied');
    expect(preview.getWorkingPreview).toHaveBeenCalledTimes(1);
  });

  it('returns only readable selected media through the existing chapter authorization boundary', async () => {
    const imageId = randomUUID(),
      videoId = randomUUID();
    production.listAssetSpecs.mockResolvedValue([
      {
        name: 'Character',
        selectedMediaVersion: {
          id: imageId,
          mediaKind: 'image',
          mediaStatus: 'ready',
          previewUrl: 'https://media.example/image.png',
          thumbnailUrl: 'https://media.example/thumb.png',
        },
      },
      {
        name: 'Pending',
        selectedMediaVersion: {
          id: randomUUID(),
          mediaKind: 'image',
          mediaStatus: 'processing',
          previewUrl: 'https://media.example/pending.png',
        },
      },
    ]);
    production.getStoryboard.mockResolvedValue([
      {
        clips: [
          {
            title: 'Opening',
            durationMs: 5000,
            selectedMediaVersion: {
              id: videoId,
              mediaKind: 'video',
              mediaStatus: 'ready',
              previewUrl: 'https://media.example/clip.mp4',
            },
          },
        ],
      },
    ]);
    await expect(service.outputs(user, projectId, chapterId)).resolves.toEqual([
      {
        id: imageId,
        kind: 'image',
        title: 'Character',
        status: 'ready',
        url: 'https://media.example/image.png',
        posterUrl: 'https://media.example/thumb.png',
        durationMs: null,
        error: null,
      },
      {
        id: videoId,
        kind: 'video',
        title: 'Opening',
        status: 'ready',
        url: 'https://media.example/clip.mp4',
        posterUrl: null,
        durationMs: 5000,
        error: null,
      },
    ]);
    expect(production.listAssetSpecs).toHaveBeenCalledWith(
      user,
      projectId,
      chapterId,
    );
    expect(production.getStoryboard).toHaveBeenCalledWith(
      user,
      projectId,
      chapterId,
    );
    production.listAssetSpecs.mockRejectedValue(
      new Error('Chapter access denied'),
    );
    await expect(
      service.outputs(user, projectId, randomUUID()),
    ).rejects.toThrow('Chapter access denied');
  });

  it('reveals confirmed sequential media in stable cards, keeps receipts and separates video references from results', async () => {
    const run = await producing('clip_media');
    const assetId = randomUUID(),
      clipId = randomUUID(),
      imageGenerationId = randomUUID(),
      videoGenerationId = randomUUID();
    const imageItem = {
      id: randomUUID(),
      targetId: assetId,
      outputKind: 'image',
      status: 'ready',
      generationId: null,
      error: null,
    };
    const videoItem = {
      id: randomUUID(),
      targetId: clipId,
      outputKind: 'video',
      status: 'ready',
      generationId: null,
      error: null,
    };
    const unstarted = {
      ...imageItem,
      id: randomUUID(),
      targetId: randomUUID(),
    };
    production.listAssetSpecs.mockResolvedValue([{ id: assetId, name: 'Cat' }]);
    production.getStoryboard.mockResolvedValue([
      {
        clips: [
          {
            id: clipId,
            title: 'Home',
            durationMs: 5000,
            // This previous selection must never complete the new generation card.
            selectedMediaVersion: {
              mediaStatus: 'ready',
              previewUrl: 'https://media.example/old.mp4',
            },
            assetBindings: [
              {
                status: 'current',
                resolvedMediaVersion: {
                  mediaKind: 'image',
                  mediaStatus: 'ready',
                  previewUrl: 'https://media.example/cat.png',
                },
              },
            ],
          },
        ],
      },
    ]);
    const batch = {
      status: 'queued',
      items: [imageItem, videoItem, unstarted],
    };
    const records = [batch];
    const query = jest
      .spyOn(prisma.storyGenerationBatch, 'findMany')
      .mockResolvedValue(records as never);
    try {
      let rows = await service.outputs(user, projectId, chapterId, run.id);
      expect(rows).toMatchObject([
        { id: imageItem.id, status: 'queued', url: null },
        { id: videoItem.id, status: 'queued', durationMs: 5000, url: null },
      ]);
      expect(rows).toHaveLength(2);
      expect(query).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            storyProjectId: projectId,
            storyChapterId: chapterId,
            actorUserId: user.userId,
            idempotencyKey: { startsWith: `app:${run.id}:` },
            confirmedAt: { not: null },
          },
        }),
      );
      Object.assign(imageItem, {
        status: 'submitted',
        generationId: imageGenerationId,
      });
      rows = await service.outputs(user, projectId, chapterId, run.id);
      expect(rows).toHaveLength(2);
      expect(rows[0]).toMatchObject({
        id: imageItem.id,
        status: 'generating',
        url: null,
      });
      Object.assign(imageItem, { status: 'completed' });
      Object.assign(videoItem, {
        status: 'submitted',
        generationId: videoGenerationId,
        generation: {
          submissionSnapshot: { timelineDurationMs: 5000 },
          storyboardClip: { title: 'Home', durationMs: 9000 },
        },
      });
      production.listGenerationMedia.mockResolvedValue([
        {
          title: 'Cat',
          media: {
            generationId: imageGenerationId,
            mediaKind: 'image',
            previewUrl: 'https://media.example/cat.png',
          },
        },
      ]);
      rows = await service.outputs(user, projectId, chapterId, run.id);
      expect(rows).toHaveLength(2);
      expect(rows[0]).toMatchObject({
        id: imageItem.id,
        status: 'ready',
        url: 'https://media.example/cat.png',
      });
      expect(rows[1]).toMatchObject({
        id: videoItem.id,
        status: 'generating',
        url: null,
        posterUrl: 'https://media.example/cat.png',
        durationMs: 5000,
      });
      Object.assign(videoItem, {
        status: 'failed',
        error: { message: 'Provider rejected this reference.' },
      });
      // The item can settle before the batch summary catches up. Do not reveal
      // the next unstarted card during that reconciliation window.
      batch.status = 'running';
      expect(
        await service.outputs(user, projectId, chapterId, run.id),
      ).toHaveLength(2);
      batch.status = 'failed';
      rows = await service.outputs(user, projectId, chapterId, run.id);
      expect(rows).toHaveLength(2);
      expect(rows[1]).toMatchObject({
        status: 'failed',
        error: 'Provider rejected this reference.',
      });
      const retry = {
        ...videoItem,
        id: randomUUID(),
        status: 'submitted',
        error: null,
      };
      records.push({ status: 'running', items: [retry] });
      rows = await service.outputs(user, projectId, chapterId, run.id);
      expect(rows).toHaveLength(2);
      expect(rows[1]).toMatchObject({
        id: retry.id,
        status: 'generating',
        durationMs: 5000,
      });
      records.pop();
      Object.assign(videoItem, { status: 'cancelled', error: null });
      Object.assign(unstarted, { status: 'cancelled' });
      batch.status = 'cancelled';
      rows = await service.outputs(user, projectId, chapterId, run.id);
      expect(rows).toHaveLength(2);
      expect(rows[0].status).toBe('ready');
      expect(rows[1].status).toBe('cancelled');
      // Archived targets no longer occur in the current plan, but their exact
      // generation receipt still retains the original card and playable URL.
      production.listAssetSpecs.mockResolvedValue([]);
      production.getStoryboard.mockResolvedValue([]);
      expect(
        (await service.outputs(user, projectId, chapterId, run.id))[0],
      ).toMatchObject({
        id: imageItem.id,
        title: 'Cat',
        status: 'ready',
        url: 'https://media.example/cat.png',
      });
      await expect(
        service.outputs(user, projectId, randomUUID(), run.id),
      ).rejects.toThrow('Story run not found');
    } finally {
      query.mockRestore();
    }
  });

  it('does not expose internal automatic retry state as a user-facing error', async () => {
    const run = await producing();
    await prisma.appStoryRun.update({
      where: { id: run.id },
      data: {
        errorCode: 'APP_STORY_RETRY',
        errorDetail: 'Internal scheduler marker',
      },
    });
    const history = await service.history(user, projectId);
    expect(history.runs[0].error).toBeNull();
  });

  it('paginates complete history with stable positions and aggregates actual usage beyond the displayed page', async () => {
    const template = await service.start(user, projectId, {
      submissionId: randomUUID(),
      chapterId,
      message: 'Hello',
      authorizedPoints: 0,
    });
    const source = await prisma.appStoryRun.findUniqueOrThrow({
      where: { id: template.id },
    });
    await prisma.appStoryRun.update({
      where: { id: source.id },
      data: { status: 'completed' },
    });
    await prisma.appStoryRun.createMany({
      data: Array.from({ length: 105 }, (_, index) => ({
        id: randomUUID(),
        projectId,
        chapterId,
        actorId: user.userId,
        submissionId: randomUUID(),
        fingerprint: 'a'.repeat(64),
        message: 'History ' + index,
        locale: 'en-US',
        status: 'completed',
        phase: 'planning',
        authorizedPoints: 0,
        modelConfig: source.modelConfig as never,
        createdAt: new Date(Date.UTC(2026, 0, 1, 0, index)),
        harnessEvents: [
          {
            type: 'fizz/projections',
            data: {
              tokenUsage: {
                uncachedInputTokens: 3,
                outputTokens: 2,
                cacheReadTokens: 4,
                cacheWriteTokens: 0,
              },
            },
          },
        ],
      })),
    });
    const newest = await service.history(user, projectId);
    expect(newest.runs).toHaveLength(100);
    expect(newest.nextCursor).toBeTruthy();
    expect(newest.runs[0].historyIndex).toBe(6);
    expect(newest.usageByChapter[chapterId]).toEqual({
      uncachedInputTokens: 315,
      outputTokens: 210,
      cacheReadTokens: 420,
      cacheWriteTokens: 0,
    });
    const older = await service.history(user, projectId, newest.nextCursor!);
    expect(older.runs).toHaveLength(6);
    expect(older.runs[0].historyIndex).toBe(0);
    expect(older.nextCursor).toBeNull();
    await expect(
      service.history({ userId: 'another' }, projectId, newest.nextCursor!),
    ).rejects.toThrow('History cursor');
  });

  it('deduplicates concurrent uploads, scopes downloads, and atomically admits extracted references', async () => {
    const buffer = Buffer.from('Reference: a cat finds a blue door.');
    const file = { originalname: 'reference.md', buffer, size: buffer.length };
    const [one, two] = await Promise.all([
      service.attach(user, projectId, chapterId, file),
      service.attach(user, projectId, chapterId, file),
    ]);
    expect(one.id).toBe(two.id);
    expect(await prisma.appStoryAttachment.count()).toBe(1);
    expect(await prisma.copilotDocument.count()).toBe(1);
    expect(
      Buffer.from(
        (await service.attachment(user, projectId, chapterId, one.id)).data,
      ),
    ).toEqual(buffer);
    await expect(
      service.attachment({ userId: 'another' }, projectId, chapterId, one.id),
    ).rejects.toThrow('not found');
    const input = {
      submissionId: randomUUID(),
      chapterId,
      message: 'Summarize the reference only.',
      authorizedPoints: 0,
      attachmentIds: [one.id],
    };
    const [accepted, replayed] = await Promise.all([
      service.start(user, projectId, input),
      service.start(user, projectId, input),
    ]);
    expect(accepted.id).toBe(replayed.id);
    expect(accepted.authorizedPoints).toBe(0);
    expect(await prisma.copilotDocument.count()).toBe(2);
    const persisted = await prisma.appStoryRun.findUniqueOrThrow({
      where: { id: accepted.id },
    });
    const source = await prisma.copilotDocument.findUniqueOrThrow({
      where: { id: persisted.documentId! },
    });
    expect(source.text).toBe(buffer.toString('utf8'));
    expect(accepted.attachments).toMatchObject([
      { id: one.id, name: 'reference.md' },
    ]);
  });

  it('fully decodes image attachments and rejects unsupported, corrupt, oversized and foreign files', async () => {
    const buffer = await sharp({
      create: { width: 3, height: 2, channels: 3, background: 'blue' },
    })
      .png()
      .toBuffer();
    const image = await service.attach(user, projectId, chapterId, {
      originalname: 'scene.png',
      buffer,
      size: buffer.length,
    });
    expect(image).toMatchObject({
      mediaType: 'image/png',
      width: 3,
      height: 2,
    });
    await expect(
      service.attach(user, projectId, chapterId, {
        originalname: 'broken.png',
        buffer: Buffer.from('bad'),
        size: 3,
      }),
    ).rejects.toThrow('image');
    await expect(
      service.attach(user, projectId, chapterId, {
        originalname: 'unknown.exe',
        buffer: Buffer.from('bad'),
        size: 3,
      }),
    ).rejects.toThrow('Only .docx');
    await expect(
      service.attach(user, projectId, chapterId, {
        originalname: 'large.md',
        buffer,
        size: 11 * 1024 * 1024,
      }),
    ).rejects.toThrow('10MB');
    await expect(
      service.start({ userId: 'another' }, projectId, {
        submissionId: randomUUID(),
        chapterId,
        message: 'Hi',
        authorizedPoints: 0,
        attachmentIds: [image.id],
      }),
    ).rejects.toThrow('outside');
  });

  it('requires renewed consent when a live quote changes after approval and never authorizes an expired replacement', async () => {
    const run = await producing(),
      batchId = randomUUID();
    await prisma.appStoryRun.update({
      where: { id: run.id },
      data: { batchId },
    });
    batches.get.mockResolvedValue({
      id: batchId,
      status: 'awaiting_confirmation',
      version: 1,
      totalPoints: 30,
      ...quoteDetails,
    });
    await service.step(
      { ...run, batchId },
      'worker',
      new AbortController().signal,
    );
    await service.finishAttempt(run, 'worker');
    await service.resume(user, projectId, run.id, undefined, {
      batchId,
      version: 1,
      points: 30,
    });
    const approved = await claim();
    batches.get.mockResolvedValue({
      id: batchId,
      status: 'awaiting_confirmation',
      version: 2,
      totalPoints: 31,
      ...quoteDetails,
    });
    await service.step(approved, 'worker', new AbortController().signal);
    await service.finishAttempt(approved, 'worker');
    expect(batches.confirm).not.toHaveBeenCalled();
    const changed = await prisma.appStoryRun.findUniqueOrThrow({
      where: { id: run.id },
    });
    expect(changed.mediaQuote).toMatchObject({
      version: 2,
      points: 31,
      approved: false,
    });
    await expect(
      service.resume(user, projectId, run.id, undefined, {
        batchId,
        version: 1,
        points: 30,
      }),
    ).rejects.toThrow('Confirm the current');
    await prisma.appStoryRun.update({
      where: { id: run.id },
      data: {
        mediaQuote: {
          ...(changed.mediaQuote as object),
          expiresAt: '2020-01-01T00:00:00Z',
        },
      },
    });
    const refreshed = await service.resume(user, projectId, run.id, undefined, {
      batchId,
      version: 2,
      points: 31,
    });
    expect(refreshed.mediaQuote).toBeNull();
    expect(
      (await prisma.appStoryRun.findUniqueOrThrow({ where: { id: run.id } }))
        .batchId,
    ).toBeNull();
    expect(refreshed.committedPoints).toBe(0);
  });
  it('recovers an admitted quote before recalculating targets, and reserves authorization atomically once', async () => {
    const run = await producing();
    const batchId = randomUUID();
    await db.query(
      "INSERT INTO story_generation_batches(id,story_project_id,story_chapter_id,actor_user_id,idempotency_key,status) VALUES ($1,$2,$3,$4,$5,'awaiting_confirmation')",
      [
        batchId,
        projectId,
        chapterId,
        user.userId,
        `app:${run.id}:asset_media:0`,
      ],
    );
    await service.step(run, 'worker', new AbortController().signal);
    expect(production.listAssetSpecs).not.toHaveBeenCalled();
    expect(batches.quoteAssets).not.toHaveBeenCalled();
    await service.finishAttempt(run, 'worker');
    const recovered = await claim();
    let batchStatus = 'awaiting_confirmation';
    batches.get.mockImplementation(() => ({
      id: batchId,
      status: batchStatus,
      totalPoints: 30,
      version: 1,
      ...quoteDetails,
    }));
    batches.confirm.mockImplementation(
      async (
        _user,
        _project,
        _chapter,
        _batch,
        _input,
        _handoff,
        authority: (tx: unknown) => Promise<void>,
      ) => {
        await prisma.$transaction(async (tx) => {
          await authority(tx);
          batchStatus = 'queued';
        });
      },
    );
    await service.step(recovered, 'worker', new AbortController().signal);
    await service.finishAttempt(recovered, 'worker');
    expect(batches.confirm).not.toHaveBeenCalled();
    await service.resume(user, projectId, run.id, undefined, {
      batchId,
      version: 1,
      points: 30,
    });
    const approved = await claim();
    await service.step(approved, 'worker', new AbortController().signal);
    await service.finishAttempt(approved, 'worker');
    const again = await claim();
    await service.step(again, 'worker', new AbortController().signal);
    expect(batches.confirm).toHaveBeenCalledTimes(1);
    expect(
      (await prisma.appStoryRun.findUniqueOrThrow({ where: { id: run.id } }))
        .committedPoints,
    ).toBe(30);
  });

  it('pauses before exceeding authorization, resumes the same quote and renews an expired quote', async () => {
    const run = await producing(),
      batchId = randomUUID();
    await prisma.appStoryRun.update({
      where: { id: run.id },
      data: { batchId },
    });
    batches.get.mockResolvedValue({
      id: batchId,
      status: 'awaiting_confirmation',
      totalPoints: 120,
      version: 1,
      ...quoteDetails,
    });
    await service.step(
      { ...run, batchId },
      'worker',
      new AbortController().signal,
    );
    await service.finishAttempt(run, 'worker');
    let row = await prisma.appStoryRun.findUniqueOrThrow({
      where: { id: run.id },
    });
    expect(row.status).toBe('blocked');
    expect(row.requiredPoints).toBe(120);
    expect(row.committedPoints).toBe(0);
    await expect(
      service.resume(user, projectId, run.id, 99, {
        batchId,
        version: 1,
        points: 120,
      }),
    ).rejects.toThrow('Invalid production authorization');
    expect(batches.confirm).not.toHaveBeenCalled();
    // Raw SQL timestamps retain microseconds that a JavaScript Date cannot represent.
    await prisma.$executeRaw`UPDATE app_story_runs SET updated_at = '2026-10-10T12:00:00.123456Z'::timestamptz WHERE id = ${run.id}::uuid`;
    await expect(service.resume(user, projectId, run.id, 120)).rejects.toThrow(
      'Confirm the current',
    );
    await expect(
      service.resume(user, projectId, run.id, undefined, {
        batchId,
        version: 2,
        points: 120,
      }),
    ).rejects.toThrow('Confirm the current');
    await expect(
      service.resume(user, projectId, run.id, undefined, {
        batchId,
        version: 1,
        points: 119,
      }),
    ).rejects.toThrow('Confirm the current');
    await expect(
      service.resume(user, projectId, run.id, 120, {
        batchId,
        version: 1,
        points: 120,
      }),
    ).rejects.toThrow('Invalid production authorization');
    Object.assign(service.config, { authorizationLimit: 200 });
    await service.resume(user, projectId, run.id, 120, {
      batchId,
      version: 1,
      points: 120,
    });
    row = await claim();
    expect(row.status).toBe('producing');
    expect(row.batchId).toBe(batchId);
    batches.get.mockResolvedValue({ id: batchId, status: 'expired' });
    await service.step(row, 'worker', new AbortController().signal);
    const renewed = await prisma.appStoryRun.findUniqueOrThrow({
      where: { id: run.id },
    });
    expect(renewed.batchId).toBeNull();
    expect(renewed.stageAttempt).toBe(1);
    expect(renewed.committedPoints).toBe(0);
  });

  it('refreshes a quote without approving or increasing spending, then requires consent to its replacement', async () => {
    const run = await producing(),
      batchId = randomUUID();
    await prisma.appStoryRun.update({
      where: { id: run.id },
      data: { batchId, authorizedPoints: 0 },
    });
    batches.get.mockResolvedValue({
      id: batchId,
      status: 'awaiting_confirmation',
      totalPoints: 32,
      version: 1,
      ...quoteDetails,
    });
    await service.step(
      { ...run, batchId },
      'worker',
      new AbortController().signal,
    );
    await service.finishAttempt(run, 'worker');
    const original = { batchId, version: 1, points: 32 };
    await expect(
      service.resume(user, projectId, run.id, 32, original, true),
    ).rejects.toThrow('cannot authorize');
    await expect(
      service.resume(
        user,
        projectId,
        run.id,
        undefined,
        { ...original, version: 2 },
        true,
      ),
    ).rejects.toThrow('Confirm the current');
    await expect(
      service.resume(user, projectId, run.id, undefined, undefined, true),
    ).rejects.toThrow('Confirm the current');
    await service.resume(user, projectId, run.id, undefined, original, true);
    const refreshing = await claim();
    expect(refreshing).toMatchObject({
      status: 'producing',
      authorizedPoints: 0,
      committedPoints: 0,
      batchId: null,
      stageAttempt: 1,
      modelConfig: run.modelConfig,
    });
    expect(batches.confirm).not.toHaveBeenCalled();
    production.listAssetSpecs.mockResolvedValue([
      { id: randomUUID(), version: 1 },
    ]);
    const replacementId = randomUUID();
    batches.quoteAssets.mockResolvedValue({ id: replacementId });
    await service.step(refreshing, 'worker', new AbortController().signal);
    await service.finishAttempt(refreshing, 'worker');
    const quoting = await claim();
    batches.get.mockResolvedValue({
      id: replacementId,
      status: 'awaiting_confirmation',
      totalPoints: 36,
      version: 1,
      ...quoteDetails,
    });
    await service.step(quoting, 'worker', new AbortController().signal);
    await service.finishAttempt(quoting, 'worker');
    const fresh = await prisma.appStoryRun.findUniqueOrThrow({
      where: { id: run.id },
    });
    expect(fresh).toMatchObject({
      status: 'blocked',
      authorizedPoints: 0,
      committedPoints: 0,
      mediaQuote: { batchId: replacementId, points: 36, approved: false },
    });
    await expect(
      service.resume(user, projectId, run.id, undefined, original),
    ).rejects.toThrow('Confirm the current');
    expect(batches.confirm).not.toHaveBeenCalled();
    await service.resume(user, projectId, run.id, undefined, {
      batchId: replacementId,
      version: 1,
      points: 36,
    });
    const approved = await claim();
    await service.step(approved, 'worker', new AbortController().signal);
    expect(batches.confirm).toHaveBeenCalledTimes(1);
  });

  it('cancellation wins against a delayed batch confirmation without reserving points', async () => {
    const run = await producing(),
      batchId = randomUUID();
    await prisma.appStoryRun.update({
      where: { id: run.id },
      data: { batchId },
    });
    batches.get.mockResolvedValue({
      id: batchId,
      status: 'awaiting_confirmation',
      totalPoints: 30,
      version: 1,
      ...quoteDetails,
    });
    batches.confirm.mockImplementation(
      async (
        _user,
        _project,
        _chapter,
        _batch,
        _input,
        _handoff,
        authority: (tx: unknown) => Promise<void>,
      ) => {
        await service.cancel(user, projectId, run.id);
        await prisma.$transaction((tx) => authority(tx));
      },
    );
    await service.step(
      { ...run, batchId },
      'worker',
      new AbortController().signal,
    );
    await service.finishAttempt(run, 'worker');
    await service.resume(user, projectId, run.id, undefined, {
      batchId,
      version: 1,
      points: 30,
    });
    const approved = await claim();
    await expect(
      service.step(approved, 'worker', new AbortController().signal),
    ).rejects.toThrow('stopped');
    const stopped = await prisma.appStoryRun.findUniqueOrThrow({
      where: { id: run.id },
    });
    expect(stopped.status).toBe('cancelling');
    expect(stopped.committedPoints).toBe(0);
  });

  it('only completes after all selected clips and a playable preview are present', async () => {
    const run = await producing('verify');
    preview.getWorkingPreview.mockResolvedValueOnce({
      runtime: null,
      diagnostics: [{ severity: 'error', message: 'Missing playable media' }],
    });
    await expect(
      service.step(run, 'worker', new AbortController().signal),
    ).rejects.toThrow('Missing playable media');
    await service.step(run, 'worker', new AbortController().signal);
    const done = await prisma.appStoryRun.findUniqueOrThrow({
      where: { id: run.id },
    });
    expect(done.status).toBe('completed');
    expect(done.result).toMatchObject({ kind: 'video' });
    expect((done.result as { previewPath: string }).previewPath).toContain(
      chapterId,
    );
    await service.cancel(user, projectId, run.id);
    expect(
      (await prisma.appStoryRun.findUniqueOrThrow({ where: { id: run.id } }))
        .status,
    ).toBe('completed');
  });

  it('refreshes stale generated media while retaining uploaded and unchanged selections', async () => {
    const run = await producing();
    const staleId = randomUUID();
    production.listAssetSpecs.mockResolvedValue([
      {
        id: staleId,
        version: 2,
        sourceFingerprint: 'new',
        selectedMediaVersionId: randomUUID(),
        selectedMediaVersion: {
          generationId: randomUUID(),
          sourceFingerprint: 'old',
        },
      },
      {
        id: randomUUID(),
        version: 2,
        sourceFingerprint: 'new',
        selectedMediaVersionId: randomUUID(),
        selectedMediaVersion: {
          generationId: null,
          sourceFingerprint: 'uploaded',
        },
      },
      {
        id: randomUUID(),
        version: 2,
        sourceFingerprint: 'same',
        selectedMediaVersionId: randomUUID(),
        selectedMediaVersion: {
          generationId: randomUUID(),
          sourceFingerprint: 'same',
        },
      },
    ]);
    batches.quoteAssets.mockResolvedValue({ id: randomUUID() });
    await service.step(run, 'worker', new AbortController().signal);
    const input = (batches.quoteAssets.mock.calls[0] as unknown[])[4] as {
      targets: Array<{ id: string }>;
      modelId: string;
      schemaVersion: string;
    };
    expect(input.targets.map((target) => target.id)).toEqual([staleId]);
    expect(input.modelId).toBe('image');
    expect(input.schemaVersion).toBe('v1');
  });

  it('regenerates only named assets and their bound clips, without rebuilding the storyboard', async () => {
    const run = await producing(),
      assetId = randomUUID(),
      clipId = randomUUID();
    const scopedPlan = {
      ...plan,
      firstStage: 'media',
      mediaTargets: { assetIds: [assetId], clipIds: [] },
    };
    await prisma.appStoryRun.update({
      where: { id: run.id },
      data: { plan: scopedPlan },
    });
    production.listAssetSpecs.mockResolvedValue([
      { id: assetId, version: 1, selectedMediaVersionId: randomUUID() },
      { id: randomUUID(), version: 1, selectedMediaVersionId: randomUUID() },
    ]);
    const batchId = randomUUID();
    batches.quoteAssets.mockResolvedValue({ id: batchId });
    await service.step(
      { ...run, plan: scopedPlan },
      'worker',
      new AbortController().signal,
    );
    expect(
      (
        (batches.quoteAssets.mock.calls[0] as unknown[])[4] as {
          targets: unknown[];
        }
      ).targets,
    ).toHaveLength(1);
    await service.finishAttempt(run, 'worker');
    batches.get.mockResolvedValue({ id: batchId, status: 'completed' });
    const finished = await claim();
    await service.step(finished, 'worker', new AbortController().signal);
    await service.finishAttempt(finished, 'worker');
    const clips = await claim();
    expect(clips.phase).toBe('clip_media');
    production.getStoryboard.mockResolvedValue([
      {
        id: randomUUID(),
        clips: [
          {
            id: clipId,
            version: 1,
            assetBindings: [{ assetSpec: { id: assetId } }],
          },
          { id: randomUUID(), version: 1, assetBindings: [] },
        ],
      },
    ]);
    batches.quoteStoryboardClips.mockResolvedValue({ id: randomUUID() });
    await service.step(clips, 'worker', new AbortController().signal);
    expect(
      (
        (batches.quoteStoryboardClips.mock.calls[0] as unknown[])[4] as {
          targets: Array<{ id: string }>;
        }
      ).targets.map((target) => target.id),
    ).toEqual([clipId]);
    expect(authoring.createAuthoringRun).not.toHaveBeenCalled();
  });

  it('preserves the billing pause code and completed spending without confirming another batch', async () => {
    const run = await producing(),
      batchId = randomUUID();
    await prisma.appStoryRun.update({
      where: { id: run.id },
      data: { batchId, committedPoints: 30 },
    });
    batches.get.mockResolvedValue({
      id: batchId,
      status: 'blocked',
      blockReason: {
        code: 'INSUFFICIENT_COMPUTE_POINTS',
        message:
          'Not enough compute points. Recharge and continue from this item.',
      },
    });
    await service.step(
      { ...run, batchId, committedPoints: 30 },
      'worker',
      new AbortController().signal,
    );
    expect(
      await prisma.appStoryRun.findUniqueOrThrow({ where: { id: run.id } }),
    ).toMatchObject({
      status: 'blocked',
      errorCode: 'INSUFFICIENT_COMPUTE_POINTS',
      committedPoints: 30,
    });
    expect(batches.confirm).not.toHaveBeenCalled();
    expect(batches.resume).not.toHaveBeenCalled();
  });

  it('retries failed generation from its existing confirmed batch without reserving completed items again', async () => {
    const run = await producing(),
      batchId = randomUUID();
    await prisma.appStoryRun.update({
      where: { id: run.id },
      data: {
        status: 'failed',
        batchId,
        committedPoints: 30,
        leaseOwner: null,
        leaseExpiresAt: null,
      },
    });
    await service.resume(user, projectId, run.id);
    const resumed = await claim();
    expect(resumed.batchId).toBe(batchId);
    expect(resumed.stageAttempt).toBe(0);
    batches.get.mockResolvedValue({
      id: batchId,
      status: 'cancelled',
      confirmedAt: new Date(),
      totalPoints: 30,
    });
    batches.resume.mockImplementation(
      async (
        _user,
        _project,
        _chapter,
        _batch,
        authority: (tx: unknown) => Promise<void>,
      ) => prisma.$transaction((tx) => authority(tx)),
    );
    await service.step(resumed, 'worker', new AbortController().signal);
    expect(batches.resume).toHaveBeenCalledTimes(1);
    expect(batches.confirm).not.toHaveBeenCalled();
    expect(
      (await prisma.appStoryRun.findUniqueOrThrow({ where: { id: run.id } }))
        .committedPoints,
    ).toBe(30);
  });

  it('finishes a canonical prerequisite before returning to the requested authoring stage', async () => {
    const run = await producing('assets'),
      childId = randomUUID();
    await prisma.appStoryRun.update({
      where: { id: run.id },
      data: { authoringRunId: childId },
    });
    authoring.getRunForProject.mockResolvedValue({
      id: childId,
      status: 'succeeded',
      proposal: { schemaVersion: 'story-plot-proposal-v1' },
    });
    await service.step(
      { ...run, authoringRunId: childId },
      'worker',
      new AbortController().signal,
    );
    const next = await prisma.appStoryRun.findUniqueOrThrow({
      where: { id: run.id },
    });
    expect(next.phase).toBe('assets');
    expect(next.stageAttempt).toBe(1);
    expect(next.authoringRunId).toBeNull();
    expect(next.version).toBeGreaterThan(run.version);
  });

  it('automatically executes the persisted plan through all production stages to a playable result', async () => {
    await start();
    globalThis.fetch = jest.fn().mockResolvedValue(
      new Response(JSON.stringify({ decision: plan, events: [] }), {
        status: 200,
      }),
    );
    const schemas: Record<string, string> = {
      script: 'story-screenplay-proposal-v1',
      plot: 'story-plot-proposal-v1',
      assets: 'story-asset-proposal-v1',
      storyboard: 'story-storyboard-proposal-v1',
    };
    const children = new Map<
      string,
      { id: string; status: string; proposal: { schemaVersion: string } }
    >();
    authoring.createAuthoringRun.mockImplementation(
      async (
        _user,
        _workspace,
        _project,
        input: { regenerateStage?: string },
        _approval,
        authority: (tx: unknown) => Promise<void>,
      ) => {
        await prisma.$transaction((tx) => authority(tx));
        const id = randomUUID();
        children.set(id, {
          id,
          status: 'proposed',
          proposal: {
            schemaVersion: schemas[input.regenerateStage ?? 'script'],
          },
        });
        return { id };
      },
    );
    authoring.getRunForProject.mockImplementation(
      (_user, _project, id: string) => children.get(id),
    );
    authoring.confirmForProject.mockImplementation(
      async (
        _user,
        _project,
        id: string,
        _key,
        authority: (tx: unknown) => Promise<void>,
      ) => {
        await prisma.$transaction((tx) => authority(tx));
        children.get(id)!.status = 'succeeded';
      },
    );
    let assetReady = false,
      clipReady = false;
    const assetId = randomUUID(),
      sequenceId = randomUUID(),
      clipId = randomUUID();
    production.listAssetSpecs.mockImplementation(() => [
      {
        id: assetId,
        version: 1,
        sourceFingerprint: 'asset',
        selectedMediaVersionId: assetReady ? randomUUID() : null,
        selectedMediaVersion: assetReady
          ? { sourceFingerprint: 'asset', generationId: 'generated' }
          : null,
      },
    ]);
    production.getStoryboard.mockImplementation(() => [
      {
        id: sequenceId,
        plotNodeId: 'one',
        clips: [
          {
            id: clipId,
            version: 1,
            sourceFingerprint: 'clip',
            selectedMediaVersionId: clipReady ? randomUUID() : null,
            selectedMediaVersion: clipReady
              ? { sourceFingerprint: 'clip', generationId: 'generated' }
              : null,
            assetBindings: [],
          },
        ],
      },
    ]);
    const quoted = new Map<
      string,
      {
        id: string;
        status: string;
        version: number;
        totalPoints: number;
        phase: string;
        items: { outputKind: string }[];
        quoteExpiresAt: string;
      }
    >();
    const quote = (phase: string) => () => {
      const id = randomUUID();
      quoted.set(id, {
        id,
        phase,
        status: 'awaiting_confirmation',
        version: 0,
        totalPoints: 30,
        ...quoteDetails,
      });
      return Promise.resolve({ id });
    };
    batches.quoteAssets.mockImplementation(quote('asset_media'));
    batches.quoteStoryboardClips.mockImplementation(quote('clip_media'));
    batches.get.mockImplementation((_user, _project, _chapter, id: string) =>
      quoted.get(id),
    );
    batches.confirm.mockImplementation(
      async (
        _user,
        _project,
        _chapter,
        id: string,
        _input,
        _approval,
        authority: (tx: unknown) => Promise<void>,
      ) => {
        await prisma.$transaction((tx) => authority(tx));
        const batch = quoted.get(id)!;
        batch.status = 'completed';
        if (batch.phase === 'asset_media') assetReady = true;
        else clipReady = true;
      },
    );
    const visited = new Set<string>();
    for (let i = 0; i < 35; i++) {
      const run = await claim();
      if (!run) break;
      visited.add(run.phase);
      await service.step(run, 'worker', new AbortController().signal);
      await service.finishAttempt(run, 'worker');
      const paused = await prisma.appStoryRun.findUniqueOrThrow({
        where: { id: run.id },
      });
      if (paused.status === 'blocked') {
        const quote = paused.mediaQuote as {
          batchId: string;
          version: number;
          points: number;
        };
        await service.resume(user, projectId, run.id, undefined, {
          batchId: quote.batchId,
          version: quote.version,
          points: quote.points,
        });
      }
    }
    const done = await prisma.appStoryRun.findFirstOrThrow();
    expect(done.status).toBe('completed');
    expect(done.committedPoints).toBe(60);
    expect([...visited]).toEqual([
      'planning',
      'script',
      'plot',
      'assets',
      'asset_media',
      'storyboard',
      'clip_media',
      'verify',
    ]);
    expect(done.result).toMatchObject({ kind: 'video', title: 'Beijing' });
    expect(batches.confirm).toHaveBeenCalledTimes(2);
  });
});
