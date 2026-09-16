import { Injectable } from '@nestjs/common';
import { GoogleVertexConfigService } from './google-vertex-config.service';
import { googleVertexError } from './google-vertex-error.mapper';

export const GOOGLE_GEMINI_INLINE_IMAGE_MAX_BYTES = 7 * 1024 * 1024;
export const GOOGLE_VERTEX_INLINE_REFERENCE_IMAGE_MAX_BYTES = 20 * 1024 * 1024;
export const GOOGLE_VERTEX_INLINE_VIDEO_MAX_BYTES = 50 * 1024 * 1024;
const MAX_INLINE_REQUEST_BYTES = 14 * GOOGLE_GEMINI_INLINE_IMAGE_MAX_BYTES;
const MAX_REDIRECTS = 3;

export interface GoogleVertexInlineImage {
  data: string;
  mimeType: 'image/jpeg' | 'image/png' | 'image/webp';
  byteLength: number;
}

export interface GoogleVertexInlineVideo {
  data: string;
  mimeType:
    | 'video/x-flv'
    | 'video/quicktime'
    | 'video/mpeg'
    | 'video/mpegs'
    | 'video/mpg'
    | 'video/mp4'
    | 'video/webm'
    | 'video/wmv'
    | 'video/3gpp';
  byteLength: number;
}

@Injectable()
export class GoogleVertexMediaLoaderService {
  constructor(private readonly configService: GoogleVertexConfigService) {}

  async loadImages(
    urls: readonly string[],
    options: { allowWebp: boolean; maxBytes: number },
  ): Promise<GoogleVertexInlineImage[]> {
    const images: GoogleVertexInlineImage[] = [];
    let totalBytes = 0;
    for (const url of urls) {
      const image = await this.loadImage(url, options);
      totalBytes += image.byteLength;
      if (totalBytes > MAX_INLINE_REQUEST_BYTES) {
        throw googleVertexError(
          'VALIDATION_ERROR',
          `Google Vertex AI inline image inputs exceed ${MAX_INLINE_REQUEST_BYTES} bytes.`,
          'Reference images exceed the supported total inline-input size.',
        );
      }
      images.push(image);
    }
    return images;
  }

  async loadVideo(
    url: string,
    options: { maxBytes: number },
  ): Promise<GoogleVertexInlineVideo> {
    const media = await this.download(url, {
      accept:
        'video/x-flv,video/quicktime,video/mpeg,video/mpegs,video/mpg,video/mp4,video/webm,video/wmv,video/3gpp',
      maxBytes: options.maxBytes,
      noun: 'video',
    });
    return {
      data: media.data,
      mimeType: videoMimeType(media.contentType),
      byteLength: media.byteLength,
    };
  }

  private async loadImage(
    rawUrl: string,
    options: { allowWebp: boolean; maxBytes: number },
  ): Promise<GoogleVertexInlineImage> {
    const media = await this.download(rawUrl, {
      accept: 'image/png,image/jpeg,image/webp',
      maxBytes: options.maxBytes,
      noun: 'image',
    });
    return {
      data: media.data,
      mimeType: imageMimeType(media.contentType, options.allowWebp),
      byteLength: media.byteLength,
    };
  }

  private async download(
    rawUrl: string,
    options: { accept: string; maxBytes: number; noun: 'image' | 'video' },
  ): Promise<{ data: string; contentType: string | null; byteLength: number }> {
    let url = this.assertTrustedUrl(rawUrl);
    let response: Response | null = null;

    for (let redirect = 0; redirect <= MAX_REDIRECTS; redirect += 1) {
      try {
        response = await fetch(url, {
          redirect: 'manual',
          signal: AbortSignal.timeout(
            this.configService.config.requestTimeoutMs,
          ),
          headers: { Accept: options.accept },
        });
      } catch (error) {
        throw googleVertexError(
          'PROVIDER_TIMEOUT',
          `Failed to read Google Vertex AI reference ${options.noun} from ${url.hostname}: ${error instanceof Error ? error.message : String(error)}`,
          `A reference ${options.noun} could not be read. Please upload it again.`,
        );
      }

      if (![301, 302, 303, 307, 308].includes(response.status)) break;
      void response.body?.cancel().catch(() => {});
      const location = response.headers.get('location');
      if (!location || redirect === MAX_REDIRECTS) {
        throw googleVertexError(
          'VALIDATION_ERROR',
          `Reference ${options.noun} redirect chain exceeded ${MAX_REDIRECTS} hops.`,
          `A reference ${options.noun} URL redirected too many times.`,
        );
      }
      url = this.assertTrustedUrl(new URL(location, url).toString());
      response = null;
    }

    if (!response?.ok || !response.body) {
      void response?.body?.cancel().catch(() => {});
      throw googleVertexError(
        'VALIDATION_ERROR',
        `Reference ${options.noun} download failed with HTTP ${response?.status ?? 'unknown'}.`,
        `A reference ${options.noun} is no longer available. Please upload it again.`,
      );
    }

    const contentLength = response.headers.get('content-length');
    if (contentLength && /^\d+$/.test(contentLength)) {
      const declared = Number(contentLength);
      if (!Number.isSafeInteger(declared) || declared > options.maxBytes) {
        void response.body.cancel().catch(() => {});
        throw mediaTooLarge(options.maxBytes, options.noun);
      }
    }

    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let byteLength = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!value) continue;
        byteLength += value.byteLength;
        if (byteLength > options.maxBytes) {
          void reader.cancel().catch(() => {});
          throw mediaTooLarge(options.maxBytes, options.noun);
        }
        chunks.push(value);
      }
    } finally {
      reader.releaseLock();
    }

    if (byteLength === 0) {
      throw googleVertexError(
        'VALIDATION_ERROR',
        `Reference ${options.noun} response was empty.`,
        `A reference ${options.noun} is empty. Please upload it again.`,
      );
    }

    return {
      data: Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).toString(
        'base64',
      ),
      contentType: response.headers.get('content-type'),
      byteLength,
    };
  }

  private assertTrustedUrl(rawUrl: string): URL {
    let url: URL;
    try {
      url = new URL(rawUrl);
    } catch {
      throw googleVertexError(
        'VALIDATION_ERROR',
        'Google Vertex AI reference media URL is invalid.',
        'A reference media URL is invalid.',
      );
    }
    if (url.protocol !== 'https:') {
      throw googleVertexError(
        'VALIDATION_ERROR',
        `Google Vertex AI reference media must use HTTPS, received ${url.protocol}`,
        'Reference media must use a secure HTTPS URL.',
      );
    }
    if (
      !this.configService.config.mediaAllowedHosts.has(
        url.hostname.toLowerCase(),
      )
    ) {
      throw googleVertexError(
        'PROVIDER_NOT_CONFIGURED',
        `Reference media host ${url.hostname} is not in GOOGLE_VERTEX_MEDIA_ALLOWED_HOSTS or a configured media storage base URL.`,
        'This reference media storage host is not enabled for Google Vertex AI.',
      );
    }
    if (url.username || url.password) {
      throw googleVertexError(
        'VALIDATION_ERROR',
        'Reference media URLs must not contain userinfo credentials.',
        'A reference media URL is invalid.',
      );
    }
    return url;
  }
}

function imageMimeType(
  raw: string | null,
  allowWebp: boolean,
): GoogleVertexInlineImage['mimeType'] {
  const mime = raw?.split(';', 1)[0]?.trim().toLowerCase();
  if (mime === 'image/jpeg' || mime === 'image/png') return mime;
  if (allowWebp && mime === 'image/webp') return mime;
  throw googleVertexError(
    'VALIDATION_ERROR',
    `Unsupported Google Vertex AI reference image content type: ${mime || '(missing)'}.`,
    allowWebp
      ? 'Reference images must be JPEG, PNG, or WebP.'
      : 'Veo reference frames must be JPEG or PNG.',
  );
}

function videoMimeType(
  raw: string | null,
): GoogleVertexInlineVideo['mimeType'] {
  const mime = raw?.split(';', 1)[0]?.trim().toLowerCase();
  if (
    mime === 'video/x-flv' ||
    mime === 'video/quicktime' ||
    mime === 'video/mpeg' ||
    mime === 'video/mpegs' ||
    mime === 'video/mpg' ||
    mime === 'video/mp4' ||
    mime === 'video/webm' ||
    mime === 'video/wmv' ||
    mime === 'video/3gpp'
  ) {
    return mime;
  }
  throw googleVertexError(
    'VALIDATION_ERROR',
    `Unsupported Google Vertex AI reference video content type: ${mime || '(missing)'}.`,
    'Reference videos must use a video format supported by Gemini Omni.',
  );
}

function mediaTooLarge(maxBytes: number, noun: 'image' | 'video') {
  return googleVertexError(
    'VALIDATION_ERROR',
    `Google Vertex AI inline reference ${noun} exceeds ${maxBytes} bytes.`,
    `Each reference ${noun} must be ${maxBytes / (1024 * 1024)} MB or smaller.`,
  );
}
