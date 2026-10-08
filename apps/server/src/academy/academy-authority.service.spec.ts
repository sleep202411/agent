import { AcademyAuthorityService } from './academy-authority.service';

describe('Academy regional authority', () => {
  const service = new AcademyAuthorityService();
  let fetchMock: jest.SpyInstance<
    ReturnType<typeof fetch>,
    Parameters<typeof fetch>
  >;
  beforeEach(() => {
    fetchMock = jest.spyOn(globalThis, 'fetch');
  });
  afterEach(() => {
    fetchMock.mockRestore();
  });
  const reply = (data: unknown) =>
    new Response(JSON.stringify({ code: 200, data }));

  it('offers the full regional certificate catalogue', async () => {
    fetchMock.mockResolvedValue(
      reply([
        { id: 1, name: 'FD-I', type: 1 },
        { id: '13', name: 'AI Producer', type: 4 },
        { id: 20, name: 'Honorary', type: null },
      ]),
    );
    await expect(service.certificates()).resolves.toEqual([
      { id: 13, name: 'AI Producer', type: 4 },
      { id: 1, name: 'FD-I', type: 1 },
      { id: 20, name: 'Honorary', type: null },
    ]);
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/api/admin/user-levels/levels'),
      expect.objectContaining({
        redirect: 'error',
        signal: expect.any(AbortSignal) as AbortSignal,
      }),
    );
  });
  it.each([true, 1, false, 0])(
    'accepts the documented publication value %s',
    async (published) => {
      fetchMock.mockResolvedValue(reply({ id: 42, published }));
      await expect(service.course('42')).resolves.toMatchObject({
        id: 42,
        published: published === true || published === 1,
      });
    },
  );
  it('rejects a course identity mismatch', async () => {
    fetchMock.mockResolvedValue(reply({ id: 43, published: true }));
    await expect(service.course('42')).rejects.toThrow('Course not found');
  });
  it.each([
    () => new Response(JSON.stringify({ code: 403 })),
    () => new Response('', { status: 502 }),
    () => new Response('not json'),
  ])('fails closed on failed or malformed Java envelopes', async (response) => {
    fetchMock.mockResolvedValue(response());
    await expect(service.certificates()).rejects.toThrow(
      'could not be verified',
    );
  });
  it('rejects malformed certificate catalogues rather than treating them as empty', async () => {
    fetchMock.mockResolvedValue(reply({ items: [] }));
    await expect(service.certificates()).rejects.toThrow(
      'catalogue is invalid',
    );
  });

  it('does not replace an already awarded certificate on retry', async () => {
    fetchMock
      .mockResolvedValueOnce(reply([{ id: 13, name: 'Skill', type: 4 }]))
      .mockResolvedValueOnce(reply([{ userId: 100, levelId: 13 }]));
    await service.grantSkill('100', 13);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(
      fetchMock.mock.calls.every(([, options]) => options?.method === 'GET'),
    ).toBe(true);
  });
  it('uses the stored course certificate ID when granting the badge', async () => {
    fetchMock
      .mockResolvedValueOnce(reply([{ id: 13, name: 'Skill', type: 4 }]))
      .mockResolvedValueOnce(reply([]))
      .mockResolvedValueOnce(reply(undefined));
    await service.grantSkill('100', 13);
    expect(fetchMock.mock.calls[2][1]).toMatchObject({
      method: 'POST',
      body: JSON.stringify({
        userId: 100,
        levelId: 13,
        remark: 'Academy homework approved',
      }),
    });
  });
  it('does not mark a rejected Java grant successful even on HTTP 200', async () => {
    fetchMock
      .mockResolvedValueOnce(reply([{ id: 13, name: 'Skill', type: 4 }]))
      .mockResolvedValueOnce(reply([]))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ code: 500, msg: 'Grant failed' })),
      );
    await expect(service.grantSkill('100', 13)).rejects.toThrow('Grant failed');
  });
});
