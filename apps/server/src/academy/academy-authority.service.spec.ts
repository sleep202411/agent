import { AcademyAuthorityService } from './academy-authority.service';

describe('Academy regional authority', () => {
  const service = new AcademyAuthorityService();
  let fetchMock: jest.SpyInstance;
  beforeEach(() => {
    fetchMock = jest.spyOn(globalThis, 'fetch');
  });
  afterEach(() => {
    fetchMock.mockRestore();
  });
  const reply = (data: unknown) =>
    new Response(JSON.stringify({ code: 200, data }));

  it('only offers live type-4 skill certificates', async () => {
    fetchMock.mockResolvedValue(
      reply([
        { id: 1, name: 'FD-I', type: 1 },
        { id: '13', name: 'AI Producer', type: 4 },
        { id: 20, name: 'Honorary', type: null },
      ]),
    );
    await expect(service.certificates()).resolves.toEqual([
      { id: 13, name: 'AI Producer', type: 4 },
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
      await expect(service.course('42')).resolves.toEqual({
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
});
