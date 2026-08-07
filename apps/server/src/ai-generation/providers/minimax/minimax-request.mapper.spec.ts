import { mapMiniMaxVideoProviderRequest } from './minimax-request.mapper';
import { MiniMaxProviderError } from './minimax-error.mapper';

describe('mapMiniMaxVideoProviderRequest', () => {
  it('maps text-to-video with required concrete ratio', () => {
    const body = mapMiniMaxVideoProviderRequest({
      prompt: 'A dancer on a drone',
      duration: 5,
      resolution: '2K',
      aspectRatio: '16:9',
    });
    expect(body).toEqual({
      model: 'MiniMax-H3',
      content: [{ type: 'text', text: 'A dancer on a drone' }],
      resolution: '2K',
      duration: 5,
      ratio: '16:9',
    });
  });

  it('defaults text-to-video auto/empty ratio to 16:9', () => {
    const empty = mapMiniMaxVideoProviderRequest({
      prompt: 'ocean waves',
      duration: 6,
      resolution: '768P',
    });
    expect(empty.ratio).toBe('16:9');

    const auto = mapMiniMaxVideoProviderRequest({
      prompt: 'ocean waves',
      duration: 6,
      resolution: '768P',
      aspectRatio: 'auto',
    });
    expect(auto.ratio).toBe('16:9');
  });

  it('maps first-frame image-to-video as adaptive ratio', () => {
    const body = mapMiniMaxVideoProviderRequest({
      prompt: 'camera pushes in',
      duration: 5,
      resolution: '2K',
      startFrame: 'https://cdn.example.com/frame.png',
      aspectRatio: '16:9', // ignored → adaptive
    });
    expect(body.content).toEqual([
      { type: 'text', text: 'camera pushes in' },
      {
        type: 'image_url',
        image_url: { url: 'https://cdn.example.com/frame.png' },
        role: 'first_frame',
      },
    ]);
    expect(body.ratio).toBe('adaptive');
  });

  it('maps first+last frame', () => {
    const body = mapMiniMaxVideoProviderRequest({
      prompt: 'grow up',
      duration: 8,
      resolution: '768P',
      startFrame: { url: 'https://cdn.example.com/a.jpg' },
      endFrame: { url: 'https://cdn.example.com/b.jpg' },
    });
    expect(body.content).toHaveLength(3);
    expect(body.content?.[2]).toMatchObject({ role: 'last_frame' });
    expect(body.resolution).toBe('768P');
  });

  it('maps reference images/videos/audios', () => {
    const body = mapMiniMaxVideoProviderRequest({
      prompt: 'walk the alley',
      duration: 5,
      resolution: '2K',
      aspectRatio: 'auto',
      referenceImages: ['https://cdn.example.com/ref.png'],
      referenceVideos: ['https://cdn.example.com/ref.mp4'],
      referenceAudios: ['https://cdn.example.com/ref.mp3'],
    });
    expect(body.content).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ role: 'reference_image' }),
        expect.objectContaining({ role: 'reference_video' }),
        expect.objectContaining({ role: 'reference_audio' }),
      ]),
    );
    expect(body.ratio).toBe('adaptive');
  });

  it('rejects mixing first_frame with reference media', () => {
    expect(() =>
      mapMiniMaxVideoProviderRequest({
        prompt: 'mix',
        duration: 5,
        resolution: '2K',
        startFrame: 'https://cdn.example.com/a.png',
        referenceImages: ['https://cdn.example.com/b.png'],
      }),
    ).toThrow(/cannot be combined/i);
  });

  it('requires non-empty prompt', () => {
    expect(() =>
      mapMiniMaxVideoProviderRequest({
        prompt: '  ',
        duration: 5,
        resolution: '2K',
        aspectRatio: '16:9',
      }),
    ).toThrow(MiniMaxProviderError);
  });
});
