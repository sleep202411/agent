import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { COPILOT_DOCUMENT_MAX_PER_CONVERSATION } from '@repo/shared';
import { postgresFixtureUrl } from '../common/__tests__/postgres-fixture-url';
import { CopilotDocumentService } from './copilot-document.service';
const databaseUrl = process.env.TASK01_TEST_DATABASE_URL;
const integration = databaseUrl ? describe : describe.skip;
integration('Copilot document admission (owned PostgreSQL)', () => {
  let db: PrismaClient;
  const userId = randomUUID();
  const conversationId = 'document-limit-fixture';
  beforeAll(async () => {
    const url = postgresFixtureUrl(databaseUrl!);
    if (
      url.hostname !== '127.0.0.1' ||
      url.port !== '55439' ||
      url.pathname !== '/task01'
    )
      throw new Error('Owned fixture required');
    db = new PrismaClient({
      adapter: new PrismaPg({ connectionString: databaseUrl }),
    });
    await db.$connect();
  });
  afterAll(async () => {
    await db?.copilotDocument.deleteMany({ where: { userId } });
    await db?.$disconnect();
  });
  it('admits only one competing upload into the last document slot', async () => {
    await db.copilotDocument.createMany({
      data: Array.from(
        { length: COPILOT_DOCUMENT_MAX_PER_CONVERSATION - 1 },
        () => ({
          userId,
          conversationId,
          name: 'old.txt',
          mediaType: 'text/plain',
          sizeBytes: 1,
          charCount: 1,
          text: 'x',
        }),
      ),
    });
    // Delay returning actual counts to reproduce concurrent reads before insertion.
    const delayed = db.$extends({
      query: {
        copilotDocument: {
          async count({ args, query }) {
            const count = await query(args);
            await new Promise((resolve) => setTimeout(resolve, 100));
            return count;
          },
        },
      },
    });
    const service = new CopilotDocumentService(delayed as never);
    const results = await Promise.allSettled(
      Array.from({ length: 3 }, () =>
        service.create({
          userId,
          conversationId,
          file: { originalname: 'new.txt', size: 1, buffer: Buffer.from('x') },
        }),
      ),
    );
    expect(
      results.filter((result) => result.status === 'fulfilled'),
    ).toHaveLength(1);
    for (const result of results)
      if (result.status === 'rejected')
        expect(result.reason).toMatchObject({
          response: { code: 'COPILOT_DOCUMENT_LIMIT_REACHED' },
        });
    expect(
      await db.copilotDocument.count({ where: { userId, conversationId } }),
    ).toBe(COPILOT_DOCUMENT_MAX_PER_CONVERSATION);
  });
});
