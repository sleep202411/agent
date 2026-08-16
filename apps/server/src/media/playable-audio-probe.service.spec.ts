import { parsePlayableAudioFfprobeOutput } from './playable-audio-probe.service';

describe('parsePlayableAudioFfprobeOutput', () => {
  it('derives durable MP3 metadata from ffprobe output', () => {
    expect(
      parsePlayableAudioFfprobeOutput(
        JSON.stringify({
          streams: [
            {
              codec_type: 'audio',
              codec_name: 'mp3',
              sample_rate: '24000',
              channels: 1,
              duration: '2.345',
            },
          ],
          format: { format_name: 'mp3', duration: '2.345' },
        }),
      ),
    ).toMatchObject({
      durationMs: 2345,
      durationSeconds: 2,
      durationSecondsExact: 2.345,
      contentType: 'audio/mpeg',
      fileExtension: 'mp3',
      audioCodec: 'mp3',
      sampleRate: 24000,
      channels: 1,
    });
  });
});
