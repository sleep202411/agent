import { UnprocessableEntityException } from '@nestjs/common';
import { MediaStorageProvider } from '@prisma/client';
import { createHash } from 'node:crypto';
import { access, readFile } from 'node:fs/promises';
import { StoryUploadedVideoProbeService } from './story-uploaded-video-probe.service';
import { parsePlayableVideoFfprobeOutput } from '../media/playable-video-probe.service';

const PAYLOAD = Buffer.from('server-trusted-video-bytes');

function uploadedAsset(sizeBytes = BigInt(PAYLOAD.byteLength)) {
  return {
    storageProvider: MediaStorageProvider.azure_blob,
    bucket: 'media',
    region: 'eastus2',
    objectKey: 'media/story-clip-video/user/video.mp4',
    externalUrl: null,
    contentType: 'video/mp4',
    sizeBytes,
  };
}

describe('StoryUploadedVideoProbeService', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('streams the exact storage object, hashes it, probes it, and removes the spool file', async () => {
    const asset = uploadedAsset();
    const storageAccess = {
      createReadUrl: jest.fn().mockResolvedValue({
        url: 'https://signed.example.test/video',
        provider: 'azure_blob',
        bucket: asset.bucket,
        objectKey: asset.objectKey,
        expiresAt: '2026-07-17T12:00:00.000Z',
      }),
    };
    let spoolFile = '';
    const videoProbe = {
      probeFile: jest.fn(async (filePath: string) => {
        spoolFile = filePath;
        await expect(readFile(filePath)).resolves.toEqual(PAYLOAD);
        return {
          width: 1920,
          height: 1080,
          durationMs: 12400,
          durationSeconds: 12,
          durationSecondsExact: 12.4,
          hasAudio: true,
          contentType: 'video/mp4',
          fileExtension: 'mp4',
          videoCodec: 'h264',
          audioCodecs: ['aac'],
          browserSafeMp4: true,
        };
      }),
    };
    jest.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(PAYLOAD, {
        status: 200,
        headers: { 'content-length': String(PAYLOAD.byteLength) },
      }),
    );

    const service = new StoryUploadedVideoProbeService(
      storageAccess as never,
      videoProbe as never,
    );
    await expect(service.probe(asset)).resolves.toEqual({
      checksumSha256: createHash('sha256').update(PAYLOAD).digest('hex'),
      sizeBytes: BigInt(PAYLOAD.byteLength),
      width: 1920,
      height: 1080,
      durationMs: 12400,
      durationSeconds: 12,
      durationSecondsExact: 12.4,
      hasAudio: true,
      contentType: 'video/mp4',
      fileExtension: 'mp4',
      videoCodec: 'h264',
      audioCodecs: ['aac'],
      browserSafeMp4: true,
    });
    expect(storageAccess.createReadUrl).toHaveBeenCalledWith(asset, {
      expiresInSeconds: 3600,
    });
    expect(spoolFile).not.toBe('');
    await expect(access(spoolFile)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('rejects when streamed bytes differ from the confirmed storage size', async () => {
    const asset = uploadedAsset(BigInt(PAYLOAD.byteLength + 1));
    const storageAccess = {
      createReadUrl: jest.fn().mockResolvedValue({
        url: 'https://signed.example.test/video',
        provider: 'azure_blob',
        bucket: asset.bucket,
        objectKey: asset.objectKey,
        expiresAt: '2026-07-17T12:00:00.000Z',
      }),
    };
    const videoProbe = { probeFile: jest.fn() };
    jest.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(PAYLOAD, {
        status: 200,
        headers: { 'content-length': String(PAYLOAD.byteLength) },
      }),
    );
    const service = new StoryUploadedVideoProbeService(
      storageAccess as never,
      videoProbe as never,
    );

    await expect(service.probe(asset)).rejects.toMatchObject({
      status: 422,
      response: { code: 'STORY_VIDEO_UPLOAD_SIZE_MISMATCH' },
    });
    expect(videoProbe.probeFile).not.toHaveBeenCalled();
  });
});

describe('parsePlayableVideoFfprobeOutput', () => {
  it('uses format duration when stream duration is N/A and applies display rotation', () => {
    expect(
      parsePlayableVideoFfprobeOutput(
        JSON.stringify({
          streams: [
            {
              codec_type: 'video',
              codec_name: 'h264',
              profile: 'High',
              level: 40,
              pix_fmt: 'yuv420p',
              width: 1080,
              height: 1920,
              duration: 'N/A',
              side_data_list: [{ rotation: -90 }],
            },
          ],
          format: {
            format_name: 'mov,mp4,m4a,3gp,3g2,mj2',
            duration: '8.6',
            tags: { major_brand: 'mp42' },
          },
        }),
      ),
    ).toEqual({
      width: 1920,
      height: 1080,
      durationMs: 8600,
      durationSeconds: 9,
      durationSecondsExact: 8.6,
      hasAudio: false,
      contentType: 'video/mp4',
      fileExtension: 'mp4',
      videoCodec: 'h264',
      audioCodecs: [],
      browserSafeMp4: true,
    });
  });

  it('rejects invalid ffprobe JSON as an unreadable video', () => {
    expect(() => parsePlayableVideoFfprobeOutput('{not-json')).toThrow(
      UnprocessableEntityException,
    );
  });

  it('rejects non-H.264 video even inside an MP4 container', () => {
    expect(() =>
      parsePlayableVideoFfprobeOutput(
        JSON.stringify({
          streams: [
            {
              codec_type: 'video',
              codec_name: 'hevc',
              profile: 'Main',
              level: 40,
              pix_fmt: 'yuv420p',
              width: 1920,
              height: 1080,
              duration: '8',
            },
          ],
          format: {
            format_name: 'mov,mp4,m4a,3gp,3g2,mj2',
            duration: '8',
            tags: { major_brand: 'isom' },
          },
        }),
      ),
    ).toThrow(UnprocessableEntityException);
  });

  it('still measures non-browser-safe provider video when strict playback validation is disabled', () => {
    expect(
      parsePlayableVideoFfprobeOutput(
        JSON.stringify({
          streams: [
            {
              codec_type: 'video',
              codec_name: 'hevc',
              profile: 'Main',
              level: 153,
              pix_fmt: 'yuv420p10le',
              width: 3840,
              height: 2160,
              duration: '15.25',
            },
            { codec_type: 'audio', codec_name: 'aac' },
          ],
          format: {
            format_name: 'mov,mp4,m4a,3gp,3g2,mj2',
            duration: '15.25',
            tags: { major_brand: 'isom' },
          },
        }),
        { requireBrowserSafeMp4: false },
      ),
    ).toEqual({
      width: 3840,
      height: 2160,
      durationMs: 15250,
      durationSeconds: 15,
      durationSecondsExact: 15.25,
      hasAudio: true,
      contentType: 'video/mp4',
      fileExtension: 'mp4',
      videoCodec: 'hevc',
      audioCodecs: ['aac'],
      browserSafeMp4: false,
    });
  });

  it('rejects an MP4 when any audio stream is not AAC', () => {
    expect(() =>
      parsePlayableVideoFfprobeOutput(
        JSON.stringify({
          streams: [
            {
              codec_type: 'video',
              codec_name: 'h264',
              profile: 'High',
              level: 40,
              pix_fmt: 'yuv420p',
              width: 1920,
              height: 1080,
              duration: '8',
            },
            { codec_type: 'audio', codec_name: 'opus' },
          ],
          format: {
            format_name: 'mov,mp4,m4a,3gp,3g2,mj2',
            duration: '8',
            tags: { major_brand: 'isom' },
          },
        }),
      ),
    ).toThrow(UnprocessableEntityException);
  });

  it('rejects 10-bit or 4:4:4 H.264 pixel formats', () => {
    expect(() =>
      parsePlayableVideoFfprobeOutput(
        JSON.stringify({
          streams: [
            {
              codec_type: 'video',
              codec_name: 'h264',
              profile: 'High 10',
              level: 50,
              pix_fmt: 'yuv420p10le',
              width: 1920,
              height: 1080,
              duration: '8',
            },
          ],
          format: {
            format_name: 'mov,mp4,m4a,3gp,3g2,mj2',
            duration: '8',
            tags: { major_brand: 'isom' },
          },
        }),
      ),
    ).toThrow(UnprocessableEntityException);
  });

  it('rejects non-MP4 bytes even when the request content type said MP4', () => {
    expect(() =>
      parsePlayableVideoFfprobeOutput(
        JSON.stringify({
          streams: [
            {
              codec_type: 'video',
              codec_name: 'h264',
              profile: 'High',
              level: 40,
              pix_fmt: 'yuv420p',
              width: 1920,
              height: 1080,
              duration: '8',
            },
          ],
          format: {
            format_name: 'matroska,webm',
            duration: '8',
            tags: { major_brand: 'isom' },
          },
        }),
      ),
    ).toThrow(UnprocessableEntityException);
  });

  it('rejects a QuickTime MOV major brand renamed and signed as MP4', () => {
    expect(() =>
      parsePlayableVideoFfprobeOutput(
        JSON.stringify({
          streams: [
            {
              codec_type: 'video',
              codec_name: 'h264',
              profile: 'High',
              level: 40,
              pix_fmt: 'yuv420p',
              width: 1920,
              height: 1080,
              duration: '8',
            },
            { codec_type: 'audio', codec_name: 'aac' },
          ],
          format: {
            format_name: 'mov,mp4,m4a,3gp,3g2,mj2',
            duration: '8',
            tags: { major_brand: 'qt  ' },
          },
        }),
      ),
    ).toThrow(UnprocessableEntityException);
  });

  it('rejects an H.264 profile level outside the player contract', () => {
    expect(() =>
      parsePlayableVideoFfprobeOutput(
        JSON.stringify({
          streams: [
            {
              codec_type: 'video',
              codec_name: 'h264',
              profile: 'High',
              level: 60,
              pix_fmt: 'yuv420p',
              width: 1920,
              height: 1080,
              duration: '8',
            },
          ],
          format: {
            format_name: 'mov,mp4,m4a,3gp,3g2,mj2',
            duration: '8',
            tags: { major_brand: 'isom' },
          },
        }),
      ),
    ).toThrow(UnprocessableEntityException);
  });
});
