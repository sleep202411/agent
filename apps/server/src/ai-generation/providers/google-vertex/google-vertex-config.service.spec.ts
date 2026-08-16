import { GoogleVertexConfigService } from './google-vertex-config.service';

const ENV_KEYS = [
  'GOOGLE_VERTEX_ENABLED',
  'GOOGLE_CLOUD_PROJECT',
  'GOOGLE_VERTEX_IMAGE_LOCATION',
  'GOOGLE_VERTEX_VIDEO_LOCATION',
  'GOOGLE_VERTEX_REQUEST_TIMEOUT_MS',
  'GOOGLE_VERTEX_MEDIA_ALLOWED_HOSTS',
  'MEDIA_PUBLIC_BASE_URL_S3_COMPATIBLE',
  'MEDIA_PUBLIC_BASE_URL_AZURE_BLOB',
  'AZURE_BLOB_PUBLIC_BASE_URL',
  'MEDIA_PUBLIC_BASE_URL_ALIYUN_OSS',
  'OSS_PUBLIC_BASE_URL',
  'LEGACY_OSS_BASE_URL',
] as const;

describe('GoogleVertexConfigService', () => {
  const original = new Map<string, string | undefined>();

  beforeEach(() => {
    for (const key of ENV_KEYS) {
      original.set(key, process.env[key]);
      delete process.env[key];
    }
  });

  afterEach(() => {
    for (const key of ENV_KEYS) {
      const value = original.get(key);
      if (value == null) delete process.env[key];
      else process.env[key] = value;
    }
    original.clear();
  });

  it('stays disabled without silently inventing project or location', () => {
    const config = new GoogleVertexConfigService().config;
    expect(config.enabled).toBe(false);
    expect(config.project).toBeNull();
    expect(config.imageLocation).toBeNull();
    expect(config.videoLocation).toBeNull();
  });

  it('fails boot configuration when enabled without required Vertex values', () => {
    process.env.GOOGLE_VERTEX_ENABLED = 'true';
    expect(() => new GoogleVertexConfigService()).toThrow(
      'GOOGLE_CLOUD_PROJECT is required',
    );
    process.env.GOOGLE_CLOUD_PROJECT = 'project-a';
    expect(() => new GoogleVertexConfigService()).toThrow(
      'GOOGLE_VERTEX_IMAGE_LOCATION is required',
    );
    process.env.GOOGLE_VERTEX_IMAGE_LOCATION = 'global';
    expect(() => new GoogleVertexConfigService()).toThrow(
      'GOOGLE_VERTEX_VIDEO_LOCATION is required',
    );
  });

  it('builds an exact media-host allowlist from storage and explicit config', () => {
    process.env.MEDIA_PUBLIC_BASE_URL_S3_COMPATIBLE =
      'https://media.fizzdragon.com/base';
    process.env.GOOGLE_VERTEX_MEDIA_ALLOWED_HOSTS =
      'assets.example.com, images.example.com';
    const hosts = new GoogleVertexConfigService().config.mediaAllowedHosts;
    expect([...hosts]).toEqual([
      'media.fizzdragon.com',
      'assets.example.com',
      'images.example.com',
    ]);
  });

  it('rejects malformed boolean and numeric configuration', () => {
    process.env.GOOGLE_VERTEX_ENABLED = 'sometimes';
    expect(() => new GoogleVertexConfigService()).toThrow(
      'GOOGLE_VERTEX_ENABLED must be a boolean',
    );
    process.env.GOOGLE_VERTEX_ENABLED = 'false';
    process.env.GOOGLE_VERTEX_REQUEST_TIMEOUT_MS = 'soon';
    expect(() => new GoogleVertexConfigService()).toThrow(
      'GOOGLE_VERTEX_REQUEST_TIMEOUT_MS must be an integer',
    );
  });
});
