import {
  ForbiddenException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { prepareCardApproval } from './card-approval';
import { readTaskDeliveryTemplate } from './task-delivery-template';
import type { CrewQualificationsService } from '../crew-qualifications.service';
jest.mock('./task-delivery-template', () => ({
  readTaskDeliveryTemplate: jest.fn(),
}));
function fixture(fd3: string[] = []) {
  const db = {
    crewMember: {
      findMany: jest.fn().mockResolvedValue([{ userId: '1' }, { userId: '2' }]),
    },
    crewProductionPage: {
      findUnique: jest
        .fn()
        .mockResolvedValue({ leadMember: { userId: '1', status: 'active' } }),
    },
    $queryRaw: jest.fn().mockResolvedValue([{ userId: '2' }]),
  };
  const qualifications = {
    assertEligible: jest.fn((id: string) => {
      if (!fd3.includes(id))
        return Promise.reject(
          new ForbiddenException({ code: 'CREW_QUALIFICATIONS_REQUIRED' }),
        );
      return Promise.resolve();
    }),
  };
  const prepare = (reviewer = '1') =>
    prepareCardApproval(
      db as never,
      'crew',
      'task',
      reviewer,
      'session',
      qualifications as unknown as CrewQualificationsService,
    );
  return { db, qualifications, prepare };
}
beforeEach(() => {
  jest.resetAllMocks();
  jest.mocked(readTaskDeliveryTemplate).mockResolvedValue({
    categoryId: 'category',
    version: 1,
    definition: { approvalPolicy: 'fd3_or_production_lead' },
  } as never);
});
it('accepts a currently qualified FD3 reviewer', async () => {
  const f = fixture(['1']);
  const proof = await f.prepare();
  expect(proof.evidence.method).toBe('fd3');
  await proof.validate(f.db as never);
  expect(f.qualifications.assertEligible).toHaveBeenCalledWith('1', 'session', {
    experienceLevel: 'senior',
    requiredSkills: [],
  });
});
it('uses the production lead only after checking every other active member', async () => {
  const f = fixture();
  const proof = await f.prepare();
  expect(proof.evidence.method).toBe('production_lead');
  expect(f.qualifications.assertEligible).toHaveBeenCalledTimes(2);
});
it('does not use the lead fallback when an FD3 member exists', async () => {
  await expect(fixture(['2']).prepare()).rejects.toThrow('FD3 reviewer');
});
it('rejects a non-lead or more than one card artist', async () => {
  await expect(fixture().prepare('2')).rejects.toThrow('requires FD3');
  const f = fixture();
  f.db.$queryRaw.mockResolvedValue([{ userId: '1' }, { userId: '2' }]);
  await expect(f.prepare()).rejects.toThrow('requires FD3');
});
it('never interprets qualification outages as absence of an FD3 member', async () => {
  const f = fixture();
  f.qualifications.assertEligible.mockRejectedValue(
    new ServiceUnavailableException('unavailable'),
  );
  await expect(f.prepare()).rejects.toThrow('unavailable');
});
it('invalidates prepared approval when roster or director changes', async () => {
  const f = fixture();
  const proof = await f.prepare();
  f.db.crewProductionPage.findUnique.mockResolvedValue({
    leadMember: { userId: '2', status: 'active' },
  });
  await expect(proof.validate(f.db as never)).rejects.toThrow('changed');
});
it('does not reuse a stale or removed template proof', async () => {
  const f = fixture(['1']);
  const proof = await f.prepare();
  jest.mocked(readTaskDeliveryTemplate).mockResolvedValue(null);
  await expect(proof.validate(f.db as never)).rejects.toThrow('changed');
});
