import { GoogleVertexConfigService } from './google-vertex-config.service';
import { GoogleVertexMediaLoaderService } from './google-vertex-media-loader.service';

describe('GoogleVertexMediaLoaderService', () => {
  const originalFetch = global.fetch;
  const originalHosts = process.env.GOOGLE_VERTEX_MEDIA_ALLOWED_HOSTS;
  const originalNodeEnv = process.env.NODE_ENV;

  beforeEach(() => {
    process.env.GOOGLE_VERTEX_MEDIA_ALLOWED_HOSTS = 'media.example.com';
  });

  afterEach(() => {
    global.fetch = originalFetch;
    if (originalHosts == null) {
      delete process.env.GOOGLE_VERTEX_MEDIA_ALLOWED_HOSTS;
    } else {
      process.env.GOOGLE_VERTEX_MEDIA_ALLOWED_HOSTS = originalHosts;
    }
    if (originalNodeEnv == null) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = originalNodeEnv;
    jest.restoreAllMocks();
  });

  it('downloads trusted HTTPS image bytes and converts them to inline base64', async () => {
    global.fetch = jest.fn().mockResolvedValue(
      new Response(Buffer.from('image-bytes'), {
        status: 200,
        headers: {
          'content-type': 'image/png',
          'content-length': '11',
        },
      }),
    );
    const loader = new GoogleVertexMediaLoaderService(
      new GoogleVertexConfigService(),
    );
    const [image] = await loader.loadImages(
      ['https://media.example.com/reference.png'],
      { allowWebp: true, maxBytes: 7 * 1024 * 1024 },
    );
    expect(image).toEqual({
      data: Buffer.from('image-bytes').toString('base64'),
      mimeType: 'image/png',
      byteLength: 11,
    });
  });

  it('does not relax HTTP for a non-loopback host in development', async () => {
    process.env.NODE_ENV = 'development';
    process.env.GOOGLE_VERTEX_MEDIA_ALLOWED_HOSTS = 'media.example.com';
    global.fetch = jest.fn();
    const loader = new GoogleVertexMediaLoaderService(
      new GoogleVertexConfigService(),
    );
    await expect(
      loader.loadImages(['http://media.example.com/reference.png'], {
        allowWebp: false,
        maxBytes: 20 * 1024 * 1024,
      }),
    ).rejects.toThrow('must use HTTPS');
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('rejects untrusted hosts before making a network request', async () => {
    global.fetch = jest.fn();
    const loader = new GoogleVertexMediaLoaderService(
      new GoogleVertexConfigService(),
    );
    await expect(
      loader.loadImages(['https://attacker.example/reference.png'], {
        allowWebp: true,
        maxBytes: 7 * 1024 * 1024,
      }),
    ).rejects.toThrow('is not in GOOGLE_VERTEX_MEDIA_ALLOWED_HOSTS');
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('revalidates redirect destinations against the exact allowlist', async () => {
    global.fetch = jest.fn().mockResolvedValue(
      new Response(null, {
        status: 302,
        headers: { location: 'https://attacker.example/image.png' },
      }),
    );
    const loader = new GoogleVertexMediaLoaderService(
      new GoogleVertexConfigService(),
    );
    await expect(
      loader.loadImages(['https://media.example.com/reference.png'], {
        allowWebp: true,
        maxBytes: 7 * 1024 * 1024,
      }),
    ).rejects.toThrow('attacker.example');
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('rejects WebP frames for Veo', async () => {
    global.fetch = jest.fn().mockResolvedValue(
      new Response(Buffer.from('webp'), {
        status: 200,
        headers: { 'content-type': 'image/webp' },
      }),
    );
    const loader = new GoogleVertexMediaLoaderService(
      new GoogleVertexConfigService(),
    );
    await expect(
      loader.loadImages(['https://media.example.com/frame.webp'], {
        allowWebp: false,
        maxBytes: 20 * 1024 * 1024,
      }),
    ).rejects.toThrow('Unsupported Google Vertex AI reference image');
  });

  it('loads an allowlisted QuickTime video with its official Omni MIME type', async () => {
    global.fetch = jest.fn().mockResolvedValue(
      new Response(Buffer.from('mov-bytes'), {
        status: 200,
        headers: { 'content-type': 'video/quicktime' },
      }),
    );
    const loader = new GoogleVertexMediaLoaderService(
      new GoogleVertexConfigService(),
    );
    await expect(
      loader.loadVideo('https://media.example.com/source.mov', {
        maxBytes: 50 * 1024 * 1024,
      }),
    ).resolves.toEqual({
      data: Buffer.from('mov-bytes').toString('base64'),
      mimeType: 'video/quicktime',
      byteLength: 9,
    });
  });

  it('rejects an inline image from headers before buffering oversized media', async () => {
    global.fetch = jest.fn().mockResolvedValue(
      new Response(Buffer.from('not-buffered'), {
        status: 200,
        headers: {
          'content-type': 'image/png',
          'content-length': String(7 * 1024 * 1024 + 1),
        },
      }),
    );
    const loader = new GoogleVertexMediaLoaderService(
      new GoogleVertexConfigService(),
    );
    await expect(
      loader.loadImages(['https://media.example.com/oversized.png'], {
        allowWebp: true,
        maxBytes: 7 * 1024 * 1024,
      }),
    ).rejects.toThrow('exceeds 7340032 bytes');
  });
});
