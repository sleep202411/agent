import { ForbiddenException } from '@nestjs/common';
import type { ModuleRef } from '@nestjs/core';
import type { AuthUser } from '../auth';
import type { PrismaService } from '../infra/db/db.module';
import type { IpCommerceService } from './ip-commerce.service';
import { IpKnowledgeService } from './ip-knowledge.controller';

const user = { userId: 'viewer' } as AuthUser;
const ipId = '0197f4a2-0800-7000-8000-000000000001';
function setup(published = false, documents?: Array<Record<string, unknown>>) {
  const access = jest.fn().mockResolvedValue(undefined);
  const worker = {
    answerFilmKnowledge: jest.fn().mockResolvedValue({
      answer: 'Answer',
      citedDocumentIds: [],
      unanswered: false,
    }),
  };
  const get = jest.fn().mockReturnValue(worker);
  const service = new IpKnowledgeService(
    {
      $queryRaw: jest.fn().mockResolvedValue([
        {
          audience_documents: documents ?? [
            {
              id: ipId,
              title: 'Source',
              content: 'Private unless published',
              isPublished: published,
            },
          ],
          version: 1,
        },
      ]),
    } as unknown as PrismaService,
    {
      ensurePublicEngagementTarget: access,
      getPublicIp: jest.fn().mockResolvedValue({ ip: { title: 'Film' } }),
    } as unknown as IpCommerceService,
    { get } as unknown as ModuleRef,
  );
  return { service, access, get, worker };
}
it.each(['en-US', 'zh-CN', 'zh-HK'] as const)(
  'returns an unanswered %s response without a worker for draft-only materials',
  async (locale) => {
    const { service, get, access } = setup();
    get.mockImplementation(() => {
      throw new Error('Worker disabled');
    });
    const result = await service.askKnowledge(
      user,
      ipId,
      { locale, question: 'Who?' },
      new AbortController().signal,
    );
    expect(result).toMatchObject({ unanswered: true, citedDocumentIds: [] });
    expect(result.answer).toContain(
      locale === 'en-US'
        ? 'no published materials'
        : locale === 'zh-CN'
          ? '已发布公开资料'
          : '已發佈公開資料',
    );
    expect(get).not.toHaveBeenCalled();
    expect(access).toHaveBeenCalledTimes(2);
  },
);
it('still rejects a viewer without access', async () => {
  const { service, access, get } = setup();
  access.mockRejectedValueOnce(new ForbiddenException());
  await expect(
    service.askKnowledge(
      user,
      ipId,
      { locale: 'en-US', question: 'Who?' },
      new AbortController().signal,
    ),
  ).rejects.toBeInstanceOf(ForbiddenException);
  expect(get).not.toHaveBeenCalled();
});
it('does not answer a cancelled request', async () => {
  const { service, get } = setup();
  const controller = new AbortController();
  controller.abort(new Error('Cancelled'));
  await expect(
    service.askKnowledge(
      user,
      ipId,
      { locale: 'en-US', question: 'Who?' },
      controller.signal,
    ),
  ).rejects.toThrow('Cancelled');
  expect(get).not.toHaveBeenCalled();
});
it('continues using the worker for published materials', async () => {
  const { service, worker, access } = setup(true);
  await expect(
    service.askKnowledge(
      user,
      ipId,
      { locale: 'en-US', question: 'Who?' },
      new AbortController().signal,
    ),
  ).resolves.toMatchObject({ answer: 'Answer', unanswered: false });
  expect(worker.answerFilmKnowledge).toHaveBeenCalledWith(
    expect.objectContaining({
      sources: [expect.objectContaining({ documentId: ipId })],
    }),
    expect.any(AbortSignal),
  );
  expect(access).toHaveBeenCalledTimes(2);
});

it('rechecks access before returning an empty-material response', async () => {
  const { service, access, get } = setup();
  access
    .mockResolvedValueOnce(undefined)
    .mockRejectedValueOnce(new ForbiddenException());
  await expect(
    service.askKnowledge(
      user,
      ipId,
      { locale: 'en-US', question: 'Who?' },
      new AbortController().signal,
    ),
  ).rejects.toBeInstanceOf(ForbiddenException);
  expect(get).not.toHaveBeenCalled();
});

it.each(['unpublish', 'edit', 'remove'])(
  'does not return an in-flight answer after its source changes (%s)',
  async (change) => {
    const documents = [
      {
        id: ipId,
        title: 'Source',
        content: 'Sensitive source',
        isPublished: true,
      },
    ];
    const { service, worker } = setup(true, documents);
    worker.answerFilmKnowledge.mockImplementation(async () => {
      if (change === 'unpublish') documents[0].isPublished = false;
      else if (change === 'edit') documents[0].content = 'Corrected source';
      else documents.splice(0);
      return {
        answer: 'Outdated answer',
        citedDocumentIds: [ipId],
        unanswered: false,
      };
    });
    await expect(
      service.askKnowledge(
        user,
        ipId,
        { locale: 'en-US', question: 'What?' },
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({ status: 409 });
  },
);
