import { CrewQualificationsService } from './crew-qualifications.service';

// Synthetic IDs deliberately differ from any documented production example.
const catalog = {
  fdLevels: [1, 2, 3, 4, 5].map((rank) => ({ id: 100 + rank, rank })),
  skills: { editing: [901], music: [902, 903] },
};
const original = process.env.CREW_QUALIFICATION_CATALOG_JSON;
const service = new CrewQualificationsService();
const requirement = {
  experienceLevel: 'mid' as const,
  requiredSkills: ['Editing', 'music'],
};
let fetcher: jest.SpyInstance;
const response = (ids: number[] | null, id = '42', code = 200) => ({
  ok: true,
  json: () =>
    Promise.resolve({
      code,
      info: { id },
      level: ids?.map((id) => ({ id, type: id < 900 ? 1 : 4 })) ?? null,
    }),
});
beforeEach(() => {
  process.env.CREW_QUALIFICATION_CATALOG_JSON = JSON.stringify(catalog);
  fetcher = jest
    .spyOn(globalThis, 'fetch')
    .mockResolvedValue(response([103, 901, 903]) as Response);
});
afterEach(() => {
  jest.restoreAllMocks();
  if (original === undefined)
    delete process.env.CREW_QUALIFICATION_CATALOG_JSON;
  else process.env.CREW_QUALIFICATION_CATALOG_JSON = original;
});
describe('Current Java qualification admission', () => {
  it('offers the same configured skills used by application eligibility', () => {
    expect(service.catalog()).toEqual({ skills: ['editing', 'music'] });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('does not silently offer an empty catalog when configuration is missing', () => {
    delete process.env.CREW_QUALIFICATION_CATALOG_JSON;
    expect(() => service.catalog()).toThrow('Configure this site');
  });
  it('boots without a regional catalog but fails closed on qualified recruiting', async () => {
    // Catalog present: init succeeds.
    expect(() => service.onModuleInit()).not.toThrow();

    // Catalog removed: init still succeeds (deployment unblock, see onModuleInit).
    delete process.env.CREW_QUALIFICATION_CATALOG_JSON;
    expect(() => service.onModuleInit()).not.toThrow();

    // But recruiting for a qualified role still fails closed via assertEligible.
    await expect(
      service.assertEligible('42', 'fixture-session', requirement),
    ).rejects.toThrow('Configure this site');
  });
  it('requires FD and every skill, permitting explicitly configured equivalent certificates', async () => {
    await service.assertEligible('42', 'fixture-session', requirement);
    expect(fetcher).toHaveBeenCalledWith(
      expect.stringContaining('UserId=42'),
      expect.objectContaining({
        method: 'POST',
        redirect: 'error',
        headers: { Accept: 'application/json', Cookie: 'fixture-session' },
      }),
    );
  });
  it.each([[101, 901, 903], [103, 901], [], null])(
    'rejects insufficient or missing qualifications: %j',
    async (ids) => {
      fetcher.mockResolvedValue(response(ids) as Response);
      await expect(
        service.assertEligible('42', 'fixture-session', requirement),
      ).rejects.toMatchObject({ status: 403 });
    },
  );
  it('reads current qualifications again so later revocation is not hidden by login caching', async () => {
    await service.assertEligible('42', 'fixture-session', requirement);
    fetcher.mockResolvedValue(response([103, 903]) as Response);
    await expect(
      service.assertEligible('42', 'fixture-session', requirement),
    ).rejects.toMatchObject({ response: { missingSkills: ['Editing'] } });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it.each([
    response([103, 901, 903], 'other'),
    response([103, 901, 903], '42', 302),
    { ok: false },
  ])('fails closed on identity or upstream failures', async (result) => {
    fetcher.mockResolvedValue(result as Response);
    await expect(
      service.assertEligible('42', 'fixture-session', requirement),
    ).rejects.toMatchObject({ status: 503 });
  });
  it('requires an explicit site catalog instead of treating Java IDs as FD ranks', async () => {
    delete process.env.CREW_QUALIFICATION_CATALOG_JSON;
    await expect(
      service.assertEligible('42', 'fixture-session', requirement),
    ).rejects.toMatchObject({ status: 503 });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('does not treat a profession badge as an FD rank or an FD rank as a skill certificate', async () => {
    fetcher.mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          code: 200,
          info: { id: '42' },
          level: [
            { id: 103, type: 4 },
            { id: 901, type: 1 },
            { id: 903, type: 1 },
          ],
        }),
    } as Response);
    await expect(
      service.assertEligible('42', 'fixture-session', requirement),
    ).rejects.toMatchObject({ status: 403 });
  });
  it('rejects unmapped skills without pretending free-form text is certified', async () => {
    await expect(
      service.assertEligible('42', 'fixture-session', {
        ...requirement,
        requiredSkills: ['Unmapped skill'],
      }),
    ).rejects.toMatchObject({ status: 503 });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('does not require Java for an unrestricted position', async () => {
    delete process.env.CREW_QUALIFICATION_CATALOG_JSON;
    await service.assertEligible('local-fixture', undefined, {
      experienceLevel: 'any',
      requiredSkills: [],
    });
    expect(fetcher).not.toHaveBeenCalled();
  });
});
