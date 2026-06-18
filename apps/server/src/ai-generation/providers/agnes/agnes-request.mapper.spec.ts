import { mapAgnesProviderRequest } from './agnes-request.mapper';
import type { AgnesRuntimeConfig } from './agnes-runtime';

const videoConfig = {
  type: 'video',
  endpointId: 'agnes-video-v2.0',
} as AgnesRuntimeConfig;

const imageConfig = {
  type: 'image',
  endpointId: 'agnes-image-2.1-flash',
} as AgnesRuntimeConfig;

describe('mapAgnesProviderRequest', () => {
  it('maps text-to-image to Agnes URL output format', () => {
    const body = mapAgnesProviderRequest(imageConfig, {
      prompt: 'a clean product photo',
      imageSize: '4:3',
    });

    expect(body).toEqual({
      model: 'agnes-image-2.1-flash',
      prompt: 'a clean product photo',
      size: '1024x768',
      extra_body: {
        response_format: 'url',
      },
    });
  });

  it('maps reference images to Agnes image-to-image extra body', () => {
    const body = mapAgnesProviderRequest(imageConfig, {
      prompt: 'make the object blue while preserving composition',
      imageSize: '1:1',
      referenceImages: [{ url: 'https://example.com/input.png' }],
    });

    expect(body).toEqual({
      model: 'agnes-image-2.1-flash',
      prompt: 'make the object blue while preserving composition',
      size: '1024x1024',
      extra_body: {
        response_format: 'url',
        image: ['https://example.com/input.png'],
      },
    });
  });

  it('maps text-to-video dimensions for Agnes Video V2.0', () => {
    const body = mapAgnesProviderRequest(videoConfig, {
      prompt: 'cinematic dragon flight',
      resolution: '720p',
      aspectRatio: '16:9',
      duration: '5',
    });

    expect(body).toEqual({
      model: 'agnes-video-v2.0',
      prompt: 'cinematic dragon flight',
      width: 1280,
      height: 720,
      num_frames: 121,
      frame_rate: 24,
    });
  });

  it('maps one reference image to Agnes image-to-video input', () => {
    const body = mapAgnesProviderRequest(videoConfig, {
      prompt: 'animate the character',
      referenceImages: [{ url: 'https://example.com/hero.png' }],
      resolution: '720p',
      aspectRatio: '16:9',
      duration: '5',
    });

    expect(body).toEqual({
      model: 'agnes-video-v2.0',
      prompt: 'animate the character',
      image: 'https://example.com/hero.png',
      num_frames: 121,
      frame_rate: 24,
    });
  });

  it('maps multiple reference images to Agnes extra_body.image', () => {
    const body = mapAgnesProviderRequest(videoConfig, {
      prompt: 'turn these storyboard panels into one motion shot',
      referenceImages: [
        { url: 'https://example.com/panel-1.png' },
        { url: 'https://example.com/panel-2.png' },
      ],
      resolution: '720p',
      aspectRatio: '16:9',
      duration: '5',
    });

    expect(body).toEqual({
      model: 'agnes-video-v2.0',
      prompt: 'turn these storyboard panels into one motion shot',
      extra_body: {
        image: [
          'https://example.com/panel-1.png',
          'https://example.com/panel-2.png',
        ],
      },
      num_frames: 121,
      frame_rate: 24,
    });
  });
});
