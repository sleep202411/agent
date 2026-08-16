import { readTtsAudioStream } from './byteplus-speech-client';

describe('readTtsAudioStream', () => {
  it('assembles newline-delimited base64 frames until the completion code', async () => {
    const response = new Response(
      [
        JSON.stringify({
          code: 0,
          data: Buffer.from('hello ').toString('base64'),
        }),
        JSON.stringify({
          code: 0,
          data: Buffer.from('world').toString('base64'),
        }),
        JSON.stringify({ code: 20_000_000, data: null }),
      ].join('\n'),
    );

    await expect(readTtsAudioStream(response)).resolves.toEqual(
      Buffer.from('hello world'),
    );
  });

  it('rejects a truncated stream without the documented completion frame', async () => {
    const response = new Response(
      JSON.stringify({
        code: 0,
        data: Buffer.from('partial').toString('base64'),
      }),
    );

    await expect(readTtsAudioStream(response)).rejects.toThrow(
      'without its completion frame',
    );
  });
});
