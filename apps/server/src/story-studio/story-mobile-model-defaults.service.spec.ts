import { StoryMobileModelDefaultsService } from './story-mobile-model-defaults.service';

function catalogWith(models: Array<Record<string, unknown>>) {
  return {
    listModels: jest.fn().mockResolvedValue(
      models.map((model) => ({
        enabled: true,
        provider: 'minimax',
        ...model,
      })),
    ),
  };
}

describe('StoryMobileModelDefaultsService', () => {
  const ENV_NAMES = [
    'AGENT_OS_MOBILE_IMAGE_MODEL',
    'AGENT_OS_MOBILE_VIDEO_MODEL',
  ] as const;
  let saved: Record<string, string | undefined>;
  let savedKeys: Record<string, string | undefined>;

  beforeEach(() => {
    saved = {};
    savedKeys = {};
    for (const name of ENV_NAMES) {
      saved[name] = process.env[name];
      process.env[name] =
        name === 'AGENT_OS_MOBILE_IMAGE_MODEL' ? 'wan-image-2.7' : 'minimax-h3';
    }
    savedKeys.MINIMAX_API_KEY = process.env.MINIMAX_API_KEY;
    process.env.MINIMAX_API_KEY = 'key-present';
  });

  afterEach(() => {
    for (const name of ENV_NAMES) {
      if (saved[name] === undefined) delete process.env[name];
      else process.env[name] = saved[name];
    }
    if (savedKeys.MINIMAX_API_KEY === undefined)
      delete process.env.MINIMAX_API_KEY;
    else process.env.MINIMAX_API_KEY = savedKeys.MINIMAX_API_KEY;
  });

  it('boots when both defaults are catalogued, enabled, and credentialed', async () => {
    const catalog = catalogWith([
      { id: 'wan-image-2.7', type: 'image' },
      { id: 'minimax-h3', type: 'video' },
    ]);
    await expect(
      new StoryMobileModelDefaultsService(
        catalog as never,
      ).onApplicationBootstrap(),
    ).resolves.toBeUndefined();
  });

  it('fails boot when an env is missing — no silent fallback exists', async () => {
    delete process.env.AGENT_OS_MOBILE_VIDEO_MODEL;
    const catalog = catalogWith([{ id: 'wan-image-2.7', type: 'image' }]);
    await expect(
      new StoryMobileModelDefaultsService(
        catalog as never,
      ).onApplicationBootstrap(),
    ).rejects.toThrow(/AGENT_OS_MOBILE_VIDEO_MODEL is required/);
  });

  it('fails boot when the default is absent from this region catalog (the minimax-h3-max class)', async () => {
    const catalog = catalogWith([
      { id: 'wan-image-2.7', type: 'image' },
      { id: 'minimax-h3', type: 'video' },
    ]);
    process.env.AGENT_OS_MOBILE_VIDEO_MODEL = 'minimax-h3-max';
    await expect(
      new StoryMobileModelDefaultsService(
        catalog as never,
      ).onApplicationBootstrap(),
    ).rejects.toThrow(/not in this deployment's active catalog/);
  });

  it('fails boot when the default is disabled in the catalog', async () => {
    const catalog = catalogWith([
      { id: 'wan-image-2.7', type: 'image' },
      { id: 'minimax-h3', type: 'video', enabled: false },
    ]);
    await expect(
      new StoryMobileModelDefaultsService(
        catalog as never,
      ).onApplicationBootstrap(),
    ).rejects.toThrow(/disabled/);
  });

  it('fails boot when the provider credential is unset (PROVIDER_NOT_CONFIGURED at boot, not at the user)', async () => {
    delete process.env.MINIMAX_API_KEY;
    const catalog = catalogWith([
      { id: 'wan-image-2.7', type: 'image' },
      { id: 'minimax-h3', type: 'video' },
    ]);
    await expect(
      new StoryMobileModelDefaultsService(
        catalog as never,
      ).onApplicationBootstrap(),
    ).rejects.toThrow(/MINIMAX_API_KEY is unset/);
  });

  it('skips the credential check for workload-identity providers', async () => {
    const catalog = catalogWith([
      { id: 'wan-image-2.7', type: 'image', provider: 'google-vertex' },
      { id: 'minimax-h3', type: 'video', provider: 'google-vertex' },
    ]);
    delete process.env.MINIMAX_API_KEY;
    await expect(
      new StoryMobileModelDefaultsService(
        catalog as never,
      ).onApplicationBootstrap(),
    ).resolves.toBeUndefined();
  });
});
