import { FalCatalogService } from './providers/fal/fal-catalog.service';
import { BailianCatalogService } from './providers/bailian/bailian-catalog.service';
import { BytePlusCatalogService } from './providers/byteplus/byteplus-catalog.service';
import { BytePlusSpeechCatalogService } from './providers/byteplus-speech/byteplus-speech-catalog.service';
import { GoogleVertexCatalogService } from './providers/google-vertex/google-vertex-catalog.service';
import { MiniMaxCatalogService } from './providers/minimax/minimax-catalog.service';
import { AgnesCatalogService } from './providers/agnes/agnes-catalog.service';
const providers = [
  ['fal', FalCatalogService],
  ['bailian', BailianCatalogService],
  ['byteplus', BytePlusCatalogService],
  ['byteplus-speech', BytePlusSpeechCatalogService],
  ['google-vertex', GoogleVertexCatalogService],
  ['minimax', MiniMaxCatalogService],
  ['agnes', AgnesCatalogService],
] as const;
const deferred = () => {
  let resolve!: (rows: never[]) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<never[]>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
};
describe.each(providers)('%s catalog read ownership', (_name, Catalog) => {
  const build = () => {
    const findMany = jest
      .fn<Promise<never[]>, [unknown]>()
      .mockResolvedValue([]);
    const catalog = new Catalog(
      { config: { enabled: false, catalogRefreshMs: 100 } } as never,
      { aiProviderModelBinding: { findMany } } as never,
    );
    return { catalog, findMany };
  };
  afterEach(() => jest.restoreAllMocks());
  it('shares one pending database read across list, model and runtime requests', async () => {
    const { catalog, findMany } = build();
    const pending = deferred();
    findMany.mockReturnValueOnce(pending.promise);
    const list = catalog.listModels(),
      model = catalog.getModel('missing'),
      runtime = catalog.getRuntimeConfig('missing');
    expect(findMany).toHaveBeenCalledTimes(1);
    pending.resolve([]);
    expect(await list).toEqual([]);
    expect(await model).toBeNull();
    expect(await runtime).toBeNull();
    await catalog.listModels();
    expect(findMany).toHaveBeenCalledTimes(1);
  });
  it('releases a rejected pending read for a new retry', async () => {
    const { catalog, findMany } = build();
    const pending = deferred();
    findMany.mockReturnValueOnce(pending.promise);
    const results = Promise.allSettled([
      catalog.listModels(),
      catalog.getModel('missing'),
    ]);
    pending.reject(new Error('database unavailable'));
    expect((await results).every((r) => r.status === 'rejected')).toBe(true);
    expect(findMany).toHaveBeenCalledTimes(1);
    await expect(catalog.listModels()).resolves.toEqual([]);
    expect(findMany).toHaveBeenCalledTimes(2);
  });
  it('coalesces expired refreshes and retries after their failure', async () => {
    let now = 0;
    jest.spyOn(Date, 'now').mockImplementation(() => now);
    const { catalog, findMany } = build();
    await catalog.listModels();
    now = 30001;
    const pending = deferred();
    findMany.mockReturnValueOnce(pending.promise);
    const results = Promise.allSettled([
      catalog.listModels(),
      catalog.getRuntimeConfig('missing'),
    ]);
    expect(findMany).toHaveBeenCalledTimes(2);
    pending.reject(new Error('refresh unavailable'));
    expect((await results).every((r) => r.status === 'rejected')).toBe(true);
    await expect(catalog.listModels()).resolves.toEqual([]);
    expect(findMany).toHaveBeenCalledTimes(3);
  });
});
