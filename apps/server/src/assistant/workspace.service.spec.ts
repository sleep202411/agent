import { BadRequestException, Logger, NotFoundException } from '@nestjs/common';
import { WorkspaceService } from './workspace.service';

const headers = { cookie: 'session=fixture' };
const response = (data: unknown) =>
  new Response(JSON.stringify({ code: 200, data }), { status: 200 });

describe('WorkspaceService request integrity', () => {
  let fetchMock: jest.SpiedFunction<typeof fetch>;
  let service: WorkspaceService;
  const originalBase = process.env.JAVA_STUDIO_URL;
  beforeEach(() => {
    process.env.JAVA_STUDIO_URL = 'https://workspace.fixture.invalid';
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    fetchMock = jest.spyOn(globalThis, 'fetch').mockResolvedValue(response({}));
    service = new WorkspaceService();
  });
  afterEach(() => {
    jest.restoreAllMocks();
    if (originalBase === undefined) delete process.env.JAVA_STUDIO_URL;
    else process.env.JAVA_STUDIO_URL = originalBase;
  });

  it.each([
    ['getProjectDetail', '/api/user/project/detail/'],
    ['getEpisodeScript', '/api/user/project/scripts/episode/detail/'],
    ['getWorldDetail', '/api/user/world/query/world?id='],
    ['deleteEpisode', '/api/user/world/delete/episode?id='],
    ['deleteCharacter', '/api/user/world/delete/worldrole?id='],
    ['deleteScene', '/api/user/world/delete/worldscene?id='],
    ['deleteProp', '/api/user/world/delete/worldprop?id='],
  ] as const)(
    'keeps the complete ID inside the %s request target',
    async (method, path) => {
      const id = 'part/one?other=x&id=two#section';
      await service[method](headers, id);
      expect(fetchMock).toHaveBeenCalledWith(
        `https://workspace.fixture.invalid${path}${encodeURIComponent(id)}`,
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            cookie: headers.cookie,
          }) as Record<string, string>,
        }),
      );
    },
  );

  it('encodes the project identifier during context retrieval', async () => {
    const projectId = 'project/one?other=two#part';
    fetchMock.mockImplementation(() => Promise.resolve(response({})));
    await service.getProjectContextSummary(headers, { projectId });
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      `https://workspace.fixture.invalid/api/user/project/detail/${encodeURIComponent(projectId)}`,
    );
  });

  it.each([{ list: [] }, { list: [{ id: 'other' }] }])(
    'stops replacement when the current episode is missing: %j',
    async ({ list }) => {
      fetchMock.mockResolvedValueOnce(response({ list }));
      await expect(
        service.updateEpisode(headers, {
          projectId: 'project',
          id: 'episode',
          title: 'new',
        }),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    },
  );

  it('preserves saved fields when updating one episode field', async () => {
    const current = {
      id: 'episode',
      projectId: 'project',
      title: 'old',
      introduction: 'intro',
      sort: 3,
      videoLength: 42,
      frontPrompt: 'front',
      behindPrompt: 'behind',
    };
    fetchMock
      .mockResolvedValueOnce(response({ list: [current] }))
      .mockResolvedValueOnce(response({}));
    await service.updateEpisode(headers, {
      projectId: 'project',
      id: 'episode',
      title: 'new',
    });
    expect(JSON.parse(fetchMock.mock.calls[1]?.[1]?.body as string)).toEqual({
      ...current,
      title: 'new',
    });
  });

  it('does not write after the upstream lookup fails', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ code: 500, msg: 'lookup failed' }), {
        status: 200,
      }),
    );
    await expect(
      service.updateEpisode(headers, {
        projectId: 'project',
        id: 'episode',
        title: 'new',
      }),
    ).rejects.toThrow('lookup failed');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it('rejects a mixed-project batch before any upstream request', async () => {
    await expect(
      service.batchUpdateEpisodes(headers, [
        { id: 'one', projectId: 'first' },
        { id: 'two', projectId: 'second' },
      ]),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('does not write a batch with a missing episode', async () => {
    fetchMock.mockResolvedValueOnce(response({ list: [{ id: 'one' }] }));
    await expect(
      service.batchUpdateEpisodes(headers, [
        { id: 'one', projectId: 'project' },
        { id: 'missing', projectId: 'project' },
      ]),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('preserves all saved fields in a valid batch update', async () => {
    const current = {
      id: 'one',
      projectId: 'project',
      title: 'old',
      introduction: 'intro',
      sort: 1,
      videoLength: 42,
      frontPrompt: 'front',
      behindPrompt: 'behind',
    };
    fetchMock
      .mockResolvedValueOnce(response({ list: [current] }))
      .mockResolvedValueOnce(response({}));
    await service.batchUpdateEpisodes(headers, [
      { id: 'one', projectId: 'project', title: 'new' },
    ]);
    expect(JSON.parse(fetchMock.mock.calls[1]?.[1]?.body as string)).toEqual({
      datas: [{ ...current, title: 'new' }],
    });
  });
});
