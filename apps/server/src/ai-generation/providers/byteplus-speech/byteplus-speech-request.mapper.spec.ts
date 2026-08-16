import {
  mapBytePlusSpeechProviderRequest,
  safeBytePlusSpeechRequest,
} from './byteplus-speech-request.mapper';
import type { BytePlusSpeechRuntimeConfig } from './byteplus-speech-runtime';

const context = { jobId: 'job-1', userId: 'user-1' };

describe('mapBytePlusSpeechProviderRequest', () => {
  it('maps Seed Audio references, duration direction and AIGC metadata exactly', () => {
    const request = mapBytePlusSpeechProviderRequest(
      runtime('seed-audio'),
      {
        prompt: 'Rain against a wooden boat',
        referenceAudios: [
          {
            url: 'https://assets.example.com/rain.wav',
            durationSeconds: 8,
            bytes: 1024,
          },
        ],
        durationSeconds: 12,
        outputFormat: 'wav',
        sampleRate: 48000,
      },
      context,
    );

    expect(request).toMatchObject({
      kind: 'seed-audio',
      body: {
        model: 'seed-audio-1.0',
        text_prompt:
          'Rain against a wooden boat\n@Audio1\nTarget duration: approximately 12 seconds.',
        references: [{ audio_url: 'https://assets.example.com/rain.wav' }],
        watermark: {
          aigc_watermark: false,
          aigc_metadata: {
            enable: true,
            content_producer: 'FizzDragon',
            produce_id: 'job-1',
          },
        },
      },
    });
    expect(safeBytePlusSpeechRequest(request)).not.toEqual(
      expect.objectContaining({
        references: [{ audio_url: 'https://assets.example.com/rain.wav' }],
      }),
    );
  });

  it('maps Seed TTS style, language and pitch through additions JSON', () => {
    const request = mapBytePlusSpeechProviderRequest(
      runtime('seed-tts'),
      {
        prompt: 'Follow me.',
        speaker: 'en_male_tim_uranus_bigtts',
        contextText: 'The speaker has just heard footsteps outside.',
        language: 'en',
        outputFormat: 'mp3',
        sampleRate: 24000,
        pitch: -2,
      },
      context,
    );
    expect(request.kind).toBe('seed-tts');
    if (request.kind !== 'seed-tts') return;
    expect(request.body.req_params).toMatchObject({
      text: 'Follow me.',
      speaker: 'en_male_tim_uranus_bigtts',
      audio_params: { format: 'mp3', sample_rate: 24000, bit_rate: 128000 },
    });
    expect(JSON.parse(request.body.req_params.additions)).toEqual({
      context_texts: ['The speaker has just heard footsteps outside.'],
      explicit_language: ['en'],
      post_process: { pitch: -2 },
    });
  });

  it('rejects a Seed Audio prompt whose composed provider payload exceeds the limit', () => {
    expect(() =>
      mapBytePlusSpeechProviderRequest(
        runtime('seed-audio'),
        {
          prompt: 'x'.repeat(3000),
          durationSeconds: 12,
        },
        context,
      ),
    ).toThrow('The composed Seed Audio prompt exceeds 3,000 characters.');
  });
});

function runtime(kind: 'seed-audio' | 'seed-tts'): BytePlusSpeechRuntimeConfig {
  return {
    executionKind: kind,
  } as BytePlusSpeechRuntimeConfig;
}
