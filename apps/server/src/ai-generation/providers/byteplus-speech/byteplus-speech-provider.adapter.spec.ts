import { BytePlusSpeechProviderAdapter } from './byteplus-speech-provider.adapter';
import type { BytePlusSpeechRuntimeConfig } from './byteplus-speech-runtime';

describe('BytePlusSpeechProviderAdapter', () => {
  it('returns decoded Seed Audio bytes with provider-reported billing duration', async () => {
    const runtime = runtimeFor('seed-audio');
    const client = {
      createAudio: jest.fn().mockResolvedValue({
        body: {
          code: 0,
          audio: Buffer.from('audio-bytes').toString('base64'),
          duration: 9000,
          original_duration: 12000,
        },
        status: 200,
        headers: { 'x-tt-logid': 'trace-1' },
        requestId: 'trace-1',
      }),
    };
    const adapter = new BytePlusSpeechProviderAdapter(
      { getRuntimeConfig: jest.fn().mockResolvedValue(runtime) } as never,
      client as never,
    );

    const result = await adapter.startGeneration(
      'seed-audio-1-0',
      {
        prompt: 'Night rain on the Qinhuai river',
        durationSeconds: 12,
        outputFormat: 'mp3',
        sampleRate: 48000,
      },
      { jobId: 'job-1', userId: 'user-1' },
    );

    expect(result).toMatchObject({
      kind: 'completed',
      outputs: [
        {
          type: 'audio',
          buffer: Buffer.from('audio-bytes'),
          mimeType: 'audio/mpeg',
          ext: 'mp3',
          durationSeconds: 12,
        },
      ],
      providerRequestId: 'trace-1',
      costAccounting: {
        meter: 'audio_seconds',
        quantity: 12,
        source: 'provider_response.original_duration',
      },
    });
  });

  it('records Unicode code points as the TTS billing meter', async () => {
    const runtime = runtimeFor('seed-tts');
    const client = {
      synthesizeTts: jest.fn().mockResolvedValue({
        audio: Buffer.from('tts-bytes'),
        status: 200,
        headers: {},
        requestId: 'trace-2',
      }),
    };
    const adapter = new BytePlusSpeechProviderAdapter(
      { getRuntimeConfig: jest.fn().mockResolvedValue(runtime) } as never,
      client as never,
    );

    const result = await adapter.startGeneration(
      'seed-tts-2-0',
      {
        prompt: 'Hi 🐉龙',
        speaker: 'en_male_tim_uranus_bigtts',
        outputFormat: 'mp3',
        sampleRate: 24000,
      },
      { jobId: 'job-2', userId: 'user-1' },
    );

    expect(result).toMatchObject({
      kind: 'completed',
      costAccounting: {
        meter: 'characters',
        quantity: 5,
        source: 'submitted_unicode_code_points',
      },
    });
  });
});

function runtimeFor(
  kind: 'seed-audio' | 'seed-tts',
): BytePlusSpeechRuntimeConfig {
  return {
    executionKind: kind,
    endpointId: kind === 'seed-audio' ? 'seed-audio-1.0' : 'seed-tts-2.0',
    enabled: true,
    billingPolicy: {
      mode: 'charge',
      unit: 'compute_point',
      displayCurrency: 'COMPUTE_POINTS',
      finalCostSource: 'product_pricing',
      refundPolicy: 'refund_on_final_failure',
    },
  } as BytePlusSpeechRuntimeConfig;
}
