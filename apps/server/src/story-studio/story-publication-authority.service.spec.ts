import { StoryPublicationAuthorityService } from './story-publication-authority.service';

describe('StoryPublicationAuthorityService', () => {
  const service = new StoryPublicationAuthorityService();
  let fetchSpy: jest.SpyInstance<
    ReturnType<typeof fetch>,
    Parameters<typeof fetch>
  >;
  beforeEach(() => {
    fetchSpy = jest.spyOn(globalThis, 'fetch');
  });
  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it('uses the anonymous existing player detail route and its exact version', async () => {
    fetchSpy.mockResolvedValue(
      Response.json({
        code: 200,
        data: { gameId: 'game/one', currentVersion: 'v2' },
      }),
    );
    expect(await service.currentPublicVersion('game/one')).toBe('v2');
    expect(fetchSpy).toHaveBeenCalledWith(
      expect.stringContaining('/api/player/interactive-film/games/game%2Fone'),
      expect.objectContaining({ headers: { accept: 'application/json' } }),
    );
  });
  it.each([404, 200])(
    'treats Java not-found as unpublished (HTTP %s)',
    async (status) => {
      fetchSpy.mockResolvedValue(
        Response.json({ code: 404, msg: 'Not found' }, { status }),
      );
      expect(await service.currentPublicVersion('game')).toBeNull();
    },
  );
  it.each(['reviewing', 'offline', 'draft'])(
    'honors explicit %s restrictions',
    async (status) => {
      fetchSpy.mockResolvedValue(
        Response.json({
          code: 200,
          data: { gameId: 'game', currentVersion: 'v2', status },
        }),
      );
      expect(await service.currentPublicVersion('game')).toBeNull();
    },
  );
  it('surfaces Java error text even when HTTP succeeds', async () => {
    fetchSpy.mockResolvedValue(
      Response.json({ code: 503, msg: 'Publication service unavailable' }),
    );
    await expect(service.currentPublicVersion('game')).rejects.toMatchObject({
      response: { message: 'Publication service unavailable' },
    });
  });
  it('fails closed when the configured Java target requires authentication', async () => {
    fetchSpy.mockResolvedValue(
      Response.json({ code: 302, msg: 'Not logged in!' }),
    );
    await expect(service.currentPublicVersion('game')).rejects.toMatchObject({
      response: {
        code: 'STORY_PUBLICATION_AUTHORITY_UNAVAILABLE',
        message: 'Not logged in!',
      },
    });
    const options = fetchSpy.mock.calls[0]?.[1] as RequestInit;
    expect(options.headers).toEqual({ accept: 'application/json' });
    expect(options.credentials).toBeUndefined();
  });
  it.each([
    { gameId: 'game' },
    { gameId: 'game', currentVersion: '' },
    { gameId: 'game', currentVersion: 3 },
    null,
  ])('rejects incomplete public version metadata %j', async (data) => {
    fetchSpy.mockResolvedValue(Response.json({ code: 200, data }));
    await expect(service.currentPublicVersion('game')).rejects.toMatchObject({
      response: { code: 'STORY_PUBLICATION_AUTHORITY_UNAVAILABLE' },
    });
  });
  it('does not authorize metadata returned with an HTTP error', async () => {
    fetchSpy.mockResolvedValue(
      Response.json(
        {
          code: 200,
          data: { gameId: 'game', currentVersion: 'v2' },
        },
        { status: 503 },
      ),
    );
    await expect(service.currentPublicVersion('game')).rejects.toMatchObject({
      response: { code: 'STORY_PUBLICATION_AUTHORITY_UNAVAILABLE' },
    });
  });
  it('fails closed for a non-JSON response', async () => {
    fetchSpy.mockResolvedValue(
      new Response('<html>Service unavailable</html>'),
    );
    await expect(service.currentPublicVersion('game')).rejects.toMatchObject({
      response: { code: 'STORY_PUBLICATION_AUTHORITY_UNAVAILABLE' },
    });
  });
  it('fails closed when the public lookup times out', async () => {
    fetchSpy.mockRejectedValue(new DOMException('Timed out', 'TimeoutError'));
    await expect(service.currentPublicVersion('game')).rejects.toMatchObject({
      response: { code: 'STORY_PUBLICATION_AUTHORITY_UNAVAILABLE' },
    });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
  it('rejects a mismatched game instead of authorizing its version', async () => {
    fetchSpy.mockResolvedValue(
      Response.json({
        code: 200,
        data: { gameId: 'other', currentVersion: 'v2' },
      }),
    );
    await expect(service.currentPublicVersion('game')).rejects.toMatchObject({
      response: { code: 'STORY_PUBLICATION_AUTHORITY_UNAVAILABLE' },
    });
  });
});
