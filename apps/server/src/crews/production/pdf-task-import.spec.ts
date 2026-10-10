jest.mock('../tasks/task-delivery-folder', () => ({
  provisionTaskDeliveryFolderTx: jest.fn().mockResolvedValue('folder'),
}));
jest.mock('ai', () => ({ generateObject: jest.fn() }));
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
    proposals,
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
    crewTaskFieldDefinition: { count: jest.fn().mockResolvedValue(0) },
    crewTaskWorkflowState: {
      findFirst: jest.fn().mockResolvedValue({ id: 'open' }),
    },
    crewTask: {
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({ id: 'task' }),
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
  const conversations = { broadcastCrewTaskChange: jest.fn() };
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
    jest
      .mocked(generateObject)
      .mockResolvedValue({ object: proposals } as never);
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
  jest.mocked(generateObject).mockResolvedValue({ object: proposals } as never);
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
