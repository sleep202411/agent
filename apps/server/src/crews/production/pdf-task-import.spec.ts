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
    proposals,
    createdAt: new Date(),
    selection: null as null | number[],
    taskIds: [] as string[],
  };
  const db = {
    $executeRaw: jest.fn(),
    $queryRaw: jest.fn(),
    crewPdfTaskImport: {
      findFirst: jest.fn().mockResolvedValue(row),
      findUnique: jest.fn().mockResolvedValue(null),
      count: jest.fn().mockResolvedValue(0),
      create: jest.fn(),
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
  expect(db.crewTask.create).toHaveBeenCalledWith(
    expect.objectContaining({
      data: expect.objectContaining({
        taskKind: 'art',
        metadata: expect.objectContaining({
          assetCategory: 'scenes',
          sourceEvidence: proposals.tasks[0].evidence,
        }),
      }),
    }),
  );
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
  ).rejects.toThrow('expired');
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
    const { service, db } = fixture();
    jest
      .mocked(pdfParse)
      .mockResolvedValue({ text: proposals.tasks[0].evidence } as never);
    jest
      .mocked(generateObject)
      .mockResolvedValue({ object: proposals } as never);
    await expect(
      service.analyze('crew', 'user', 'id', {
        buffer: Buffer.from('%PDF-fixture'),
        originalname: 'test.pdf',
      }),
    ).resolves.toMatchObject({ status: 'ready', tasks: proposals.tasks });
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
