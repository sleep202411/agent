jest.mock('./document-task-review', () => ({
  ...jest.requireActual<typeof import('./document-task-review')>(
    './document-task-review',
  ),
  reviewDocumentTasks: jest.fn().mockResolvedValue([]),
}));
jest.mock('../tasks/task-delivery-folder', () => ({
  provisionTaskDeliveryFolderTx: jest.fn().mockResolvedValue('folder'),
}));
jest.mock('ai', () => ({
  ...jest.requireActual<typeof import('ai')>('ai'),
  generateObject: jest.fn(),
}));
jest.mock('@ai-sdk/alibaba', () => ({
  createAlibaba: jest.fn(() => jest.fn()),
}));
jest.mock('pdf-parse/lib/pdf-parse.js', () => ({
  __esModule: true,
  default: jest.fn(),
}));
import { CrewPdfTaskImportService } from './pdf-task-import';
import { provisionTaskDeliveryFolderTx } from '../tasks/task-delivery-folder';
import { generateObject } from 'ai';
import { createAlibaba } from '@ai-sdk/alibaba';
import pdfParse from 'pdf-parse/lib/pdf-parse.js';
const proposals = {
  tasks: [
    {
      title: 'Library',
      description: 'Design the library scene.',
      category: 'scenes',
      evidence: 'The library doors open and the librarian enters.',
    },
  ],
};
function fixture() {
  const row = {
    id: 'id',
    crewId: 'crew',
    userId: 'user',
    sourceHash: 'hash',
    status: 'ready',
    sourceText: null as string | null,
    proposals: proposals as {
      tasks: Array<
        (typeof proposals.tasks)[number] & {
          episode?: { number: number; title: string; label: string };
        }
      >;
    },
    createdAt: new Date(),
    selection: null as null | number[],
    taskIds: [] as string[],
  };
  const db = {
    $executeRaw: jest.fn(),
    $queryRaw: jest.fn<Promise<unknown[]>, [TemplateStringsArray]>(),
    crewPdfTaskImport: {
      updateMany: jest.fn(
        ({
          where,
          data,
        }: {
          where: { status?: string };
          data: Partial<typeof row>;
        }) => {
          if (where.status && row.status !== where.status)
            return Promise.resolve({ count: 0 });
          Object.assign(row, data);
          return Promise.resolve({ count: 1 });
        },
      ),
      findFirst: jest.fn().mockResolvedValue(row),
      findUnique: jest.fn().mockResolvedValue(null),
      count: jest.fn().mockResolvedValue(0),
      create: jest.fn(({ data }: { data: Partial<typeof row> }) =>
        Promise.resolve(Object.assign(row, data)),
      ),
      update: jest.fn(({ data }: { data: Partial<typeof row> }) =>
        Promise.resolve(Object.assign(row, data)),
      ),
    },
    crewEpisode: {
      findFirst: jest.fn(),
      aggregate: jest.fn().mockResolvedValue({ _max: { rank: null } }),
      create: jest
        .fn<Promise<{ id: string }>, [{ data: Record<string, unknown> }]>()
        .mockResolvedValue({ id: 'episode' }),
    },
    crewTaskFieldDefinition: { count: jest.fn().mockResolvedValue(0) },
    crewTaskWorkflowState: {
      findFirst: jest.fn().mockResolvedValue({ id: 'open' }),
    },
    crewTask: {
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest
        .fn<Promise<{ id: string }>, [{ data: Record<string, unknown> }]>()
        .mockResolvedValue({ id: 'task' }),
    },
    crewProductionActivity: { create: jest.fn() },
  };
  const database = {
    ...db,
    $transaction: jest.fn((run: (tx: typeof db) => Promise<unknown>) =>
      run(db),
    ),
  };
  const auth = { require: jest.fn() };
  const conversations = {
    broadcastCrewTaskChange: jest.fn(),
    broadcastCrewTaskProjectChange: jest.fn(),
  };
  const service = new CrewPdfTaskImportService(
    database as never,
    auth as never,
    conversations as never,
  );
  return { service, db: database, auth, row, conversations };
}
beforeEach(() => {
  jest.clearAllMocks();
});
it('denies access before reading or writing analysis', async () => {
  const { service, db, auth } = fixture();
  auth.require.mockRejectedValue(new Error('denied'));
  await expect(
    service.apply('crew', 'user', 'id', { indices: [0] }),
  ).rejects.toThrow('denied');
  expect(db.$transaction).not.toHaveBeenCalled();
});
it('creates selected source-grounded tasks, folders and an idempotent receipt', async () => {
  const { service, db, auth, row } = fixture();
  await expect(
    service.apply('crew', 'user', 'id', { indices: [0] }),
  ).resolves.toEqual({ taskIds: ['task'], replayed: false });
  const data = (
    db.crewTask.create.mock.calls[0] as unknown as [
      { data: { taskKind: string; metadata: Record<string, unknown> } },
    ]
  )[0].data;
  expect(data.taskKind).toBe('art');
  expect(data.metadata.assetCategory).toBe('scenes');
  expect(data.metadata.sourceEvidence).toBe(proposals.tasks[0].evidence);
  expect(provisionTaskDeliveryFolderTx).toHaveBeenCalledTimes(1);
  expect(auth.require).toHaveBeenCalledTimes(3);
  expect(row.status).toBe('applied');
  await expect(
    service.apply('crew', 'user', 'id', { indices: [0] }),
  ).resolves.toMatchObject({ replayed: true });
  expect(db.crewTask.create).toHaveBeenCalledTimes(1);
  await expect(
    service.apply('crew', 'user', 'id', { indices: [1] }),
  ).rejects.toThrow('different selection');
});
it.each(['analyzing', 'failed'])(
  'cannot apply a %s preview',
  async (status) => {
    const { service, db, row } = fixture();
    row.status = status;
    await expect(
      service.apply('crew', 'user', 'id', { indices: [0] }),
    ).rejects.toThrow('successful');
    expect(db.crewTask.create).not.toHaveBeenCalled();
  },
);
it('rejects expired, out-of-range and required-field imports before creating tasks', async () => {
  const { service, db, row } = fixture();
  row.createdAt = new Date(0);
  await expect(
    service.apply('crew', 'user', 'id', { indices: [0] }),
  ).rejects.toMatchObject({
    response: {
      code: 'PREVIEW_EXPIRED',
      message: 'This preview has expired. Analyze the PDF again.',
    },
  });
  row.createdAt = new Date();
  await expect(
    service.apply('crew', 'user', 'id', { indices: [1] }),
  ).rejects.toThrow('does not exist');
  db.crewTaskFieldDefinition.count.mockResolvedValue(1);
  await expect(
    service.apply('crew', 'user', 'id', { indices: [0] }),
  ).rejects.toThrow('custom task fields');
  expect(db.crewTask.create).not.toHaveBeenCalled();
});
it('does not fail a committed import when realtime delivery fails', async () => {
  const { service, conversations } = fixture();
  conversations.broadcastCrewTaskChange.mockRejectedValue(new Error('offline'));
  await expect(
    service.apply('crew', 'user', 'id', { indices: [0] }),
  ).resolves.toMatchObject({ taskIds: ['task'] });
});
it('rejects non-PDF content before provider work', async () => {
  const { service, db } = fixture();
  await expect(
    service.analyze('crew', 'user', 'id', {
      buffer: Buffer.from('not PDF'),
      originalname: 'test.pdf',
    }),
  ).rejects.toThrow('Upload a PDF');
  expect(db.$transaction).not.toHaveBeenCalled();
  expect(generateObject).not.toHaveBeenCalled();
});
it('parses and grounds a real analysis response without creating tasks', async () => {
  const old = process.env.ALIBABA_API_KEY;
  process.env.ALIBABA_API_KEY = 'fixture';
  try {
    const { service, db, row } = fixture();
    jest
      .mocked(
        pdfParse as unknown as (buffer: Buffer) => Promise<{ text: string }>,
      )
      .mockResolvedValue({ text: proposals.tasks[0].evidence } as never);
    jest.mocked(generateObject).mockResolvedValue({
      object: {
        tasks: proposals.tasks.map(({ title, description, category }) => ({
          title,
          description,
          category,
          sourceId: 0,
        })),
      },
    } as never);
    await expect(
      service.analyze('crew', 'user', 'id', {
        buffer: Buffer.from('%PDF-fixture'),
        originalname: 'test.pdf',
      }),
    ).resolves.toMatchObject({ status: 'queued', tasks: [] });
    expect(generateObject).not.toHaveBeenCalled();
    row.status = 'analyzing';
    await service.process('crew', 'user', 'id', proposals.tasks[0].evidence);
    await expect(service.get('crew', 'user', 'id')).resolves.toMatchObject({
      status: 'ready',
      tasks: proposals.tasks,
    });
    expect(generateObject).toHaveBeenCalledWith(
      expect.objectContaining({ maxRetries: 0 }),
    );
    expect(db.crewTask.create).not.toHaveBeenCalled();
  } finally {
    if (old === undefined) delete process.env.ALIBABA_API_KEY;
    else process.env.ALIBABA_API_KEY = old;
  }
});
it('reattaches an existing request without another provider call', async () => {
  const old = process.env.ALIBABA_API_KEY;
  process.env.ALIBABA_API_KEY = 'fixture';
  try {
    const { service, db, row } = fixture();
    const { createHash } = await import('node:crypto');
    const buffer = Buffer.from('%PDF-fixture');
    row.sourceHash = createHash('sha256').update(buffer).digest('hex');
    db.crewPdfTaskImport.findUnique.mockResolvedValue(row);
    await expect(
      service.analyze('crew', 'user', 'id', {
        buffer,
        originalname: 'script.pdf',
      }),
    ).resolves.toMatchObject({ status: 'ready' });
    expect(generateObject).not.toHaveBeenCalled();
    expect(db.crewPdfTaskImport.create).not.toHaveBeenCalled();
    row.userId = 'other';
    await expect(
      service.analyze('crew', 'user', 'id', {
        buffer,
        originalname: 'script.pdf',
      }),
    ).rejects.toThrow('different analysis');
  } finally {
    if (old === undefined) delete process.env.ALIBABA_API_KEY;
    else process.env.ALIBABA_API_KEY = old;
  }
});
it('reports abandoned analyses as failed so the user can start a new request', async () => {
  const { service, row } = fixture();
  row.status = 'analyzing';
  row.createdAt = new Date(0);
  await expect(service.get('crew', 'user', 'id')).resolves.toMatchObject({
    status: 'failed',
    tasks: [],
  });
});

it('does not revive a failed job after a late provider response', async () => {
  const { service, row } = fixture();
  row.status = 'failed';
  const old = process.env.ALIBABA_API_KEY;
  process.env.ALIBABA_API_KEY = 'fixture';
  jest.mocked(generateObject).mockResolvedValue({
    object: {
      tasks: proposals.tasks.map(({ title, description, category }) => ({
        title,
        description,
        category,
        sourceId: 0,
      })),
    },
  } as never);
  try {
    await service.process('crew', 'user', 'id', proposals.tasks[0].evidence);
    expect(row.status).toBe('failed');
  } finally {
    if (old === undefined) delete process.env.ALIBABA_API_KEY;
    else process.env.ALIBABA_API_KEY = old;
  }
});

it('claims queued jobs with SKIP LOCKED and serializes local draining', async () => {
  const { service, db } = fixture();
  db.$queryRaw.mockResolvedValue([
    { id: 'id', crew_id: 'crew', user_id: 'user', source_text: 'source' },
  ]);
  let finish!: () => void;
  const process = jest.spyOn(service, 'process').mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  const first = service.drain();
  await new Promise((resolve) => setImmediate(resolve));
  await service.drain();
  expect(process).toHaveBeenCalledTimes(1);
  expect(db.$queryRaw.mock.calls[0][0].join('')).toContain(
    'FOR UPDATE SKIP LOCKED',
  );
  finish();
  await first;
});

it.each(['doc', 'docx'])(
  'extracts a real %s document and queues it without calling AI',
  async (extension) => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const old = process.env.ALIBABA_API_KEY;
    process.env.ALIBABA_API_KEY = 'fixture';
    try {
      const { service, row, db } = fixture();
      await service.analyze('crew', 'user', 'id', {
        buffer: fs.readFileSync(
          path.join(__dirname, 'fixtures', `script.${extension}`),
        ),
        originalname: `script.${extension}`,
      });
      expect(row.sourceText).toContain('The library doors open');
      expect(row.status).toBe('queued');
      expect(db.crewTask.create).not.toHaveBeenCalled();
      expect(generateObject).not.toHaveBeenCalled();
    } finally {
      if (old === undefined) delete process.env.ALIBABA_API_KEY;
      else process.env.ALIBABA_API_KEY = old;
    }
  },
);

it('accepts a 20 MiB document and rejects anything larger before parsing', async () => {
  const old = process.env.ALIBABA_API_KEY;
  process.env.ALIBABA_API_KEY = 'fixture';
  try {
    const { service } = fixture();
    jest
      .mocked(
        pdfParse as unknown as (buffer: Buffer) => Promise<{ text: string }>,
      )
      .mockResolvedValue({ text: proposals.tasks[0].evidence } as never);
    const buffer = Buffer.alloc(20 * 1024 * 1024);
    buffer.write('%PDF-');
    await expect(
      service.analyze('crew', 'user', 'large', {
        buffer,
        originalname: 'large.pdf',
      }),
    ).resolves.toMatchObject({ status: 'queued' });
    jest
      .mocked(
        pdfParse as unknown as (buffer: Buffer) => Promise<{ text: string }>,
      )
      .mockClear();
    await expect(
      service.analyze('crew', 'user', 'larger', {
        buffer: Buffer.concat([buffer, Buffer.from('x')]),
        originalname: 'large.pdf',
      }),
    ).rejects.toThrow('20 MB');
    expect(pdfParse).not.toHaveBeenCalled();
  } finally {
    if (old === undefined) delete process.env.ALIBABA_API_KEY;
    else process.env.ALIBABA_API_KEY = old;
  }
});

it('persists a safe provider failure and returns it after polling', async () => {
  const old = process.env.ALIBABA_API_KEY;
  process.env.ALIBABA_API_KEY = 'fixture';
  try {
    const { service, row, db } = fixture();
    row.status = 'analyzing';
    jest.mocked(generateObject).mockRejectedValue(
      Object.assign(new Error('private-script secret-key'), {
        statusCode: 429,
      }),
    );
    await service.process('crew', 'user', 'id', 'private-script');
    const result = await service.get('crew', 'user', 'id');
    expect(result).toMatchObject({
      status: 'failed',
      failure: { code: 'provider_limit' },
      tasks: [],
    });
    expect(JSON.stringify(result)).not.toContain('private-script');
    expect(JSON.stringify(row.proposals)).not.toContain('secret-key');
    expect(db.crewTask.create).not.toHaveBeenCalled();
  } finally {
    if (old === undefined) delete process.env.ALIBABA_API_KEY;
    else process.env.ALIBABA_API_KEY = old;
  }
});

it.each([undefined, '  ', ' qwen-plus-2025-12-01 '])(
  'uses the supported document model or an explicit override (%s)',
  async (configured) => {
    const oldKey = process.env.ALIBABA_API_KEY;
    const oldModel = process.env.CREW_DOCUMENT_ANALYSIS_MODEL;
    process.env.ALIBABA_API_KEY = 'fixture';
    if (configured === undefined)
      delete process.env.CREW_DOCUMENT_ANALYSIS_MODEL;
    else process.env.CREW_DOCUMENT_ANALYSIS_MODEL = configured;
    try {
      const { service, row } = fixture();
      row.status = 'analyzing';
      jest.mocked(generateObject).mockResolvedValue({
        object: {
          tasks: proposals.tasks.map(({ title, description, category }) => ({
            title,
            description,
            category,
            sourceId: 0,
          })),
        },
      } as never);
      await service.process('crew', 'user', 'id', proposals.tasks[0].evidence);
      const provider = jest.mocked(createAlibaba).mock.results.at(-1)!
        .value as jest.Mock;
      expect(provider).toHaveBeenCalledWith(configured?.trim() || 'qwen-plus');
      expect(row.status).toBe('ready');
    } finally {
      if (oldKey === undefined) delete process.env.ALIBABA_API_KEY;
      else process.env.ALIBABA_API_KEY = oldKey;
      if (oldModel === undefined)
        delete process.env.CREW_DOCUMENT_ANALYSIS_MODEL;
      else process.env.CREW_DOCUMENT_ANALYSIS_MODEL = oldModel;
    }
  },
);

function episodeFixture() {
  const f = fixture();
  f.row.proposals = {
    tasks: [
      {
        ...proposals.tasks[0],
        title: '第三集-雪地',
        episode: { number: 3, title: '风雪中前行', label: '第三集' },
      },
    ],
  };
  return f;
}
it('creates an authorized episode and links imported tasks within the same transaction', async () => {
  const { service, db, auth, conversations } = episodeFixture();
  await service.apply('crew', 'user', 'id', { indices: [0] });
  expect(auth.require).toHaveBeenCalledWith(
    'crew',
    'user',
    'production.manage',
    expect.anything(),
  );
  expect(db.crewEpisode.create.mock.calls[0]?.[0]).toMatchObject({
    data: {
      crewId: 'crew',
      number: 3,
      title: '风雪中前行',
      createdByUserId: 'user',
    },
  });
  expect(db.crewTask.create.mock.calls[0]?.[0]).toMatchObject({
    data: {
      episodeId: 'episode',
      title: '第三集-雪地',
    },
  });
  expect(conversations.broadcastCrewTaskProjectChange).toHaveBeenCalledWith(
    'crew',
    'episode',
    'episode',
    'created',
    'user',
  );
});
it('reuses the matching episode without creating or renaming it', async () => {
  const { service, db } = episodeFixture();
  db.crewEpisode.findFirst.mockResolvedValue({
    id: 'existing',
    title: '风雪中前行',
    status: 'planned',
  });
  await service.apply('crew', 'user', 'id', { indices: [0] });
  expect(db.crewEpisode.create).not.toHaveBeenCalled();
  expect(db.crewTask.create.mock.calls[0]?.[0]).toMatchObject({
    data: { episodeId: 'existing' },
  });
});
it.each(['completed', 'in_review', 'cancelled'])(
  'rejects tasks for a closed episode (%s)',
  async (status) => {
    const { service, db } = episodeFixture();
    db.crewEpisode.findFirst.mockResolvedValue({
      id: 'existing',
      title: '风雪中前行',
      status,
    });
    await expect(
      service.apply('crew', 'user', 'id', { indices: [0] }),
    ).rejects.toThrow('closed');
    expect(db.crewTask.create).not.toHaveBeenCalled();
  },
);
it('does not overwrite a conflicting existing episode', async () => {
  const { service, db } = episodeFixture();
  db.crewEpisode.findFirst.mockResolvedValue({
    id: 'existing',
    title: 'Another script',
    status: 'planned',
  });
  await expect(
    service.apply('crew', 'user', 'id', { indices: [0] }),
  ).rejects.toThrow('different title');
  expect(db.crewTask.create).not.toHaveBeenCalled();
});
it('does not create an episode without production management authority', async () => {
  const { service, db, auth } = episodeFixture();
  auth.require.mockImplementation(
    (_crew: string, _user: string, permission: string) => {
      if (permission === 'production.manage') throw new Error('denied');
    },
  );
  await expect(
    service.apply('crew', 'user', 'id', { indices: [0] }),
  ).rejects.toThrow('denied');
  expect(db.crewEpisode.create).not.toHaveBeenCalled();
  expect(db.crewTask.create).not.toHaveBeenCalled();
});
