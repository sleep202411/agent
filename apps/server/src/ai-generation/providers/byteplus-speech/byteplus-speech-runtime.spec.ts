import {
  createBytePlusSpeechRuntimeConfig,
  toBytePlusSpeechModelDefinition,
} from './byteplus-speech-runtime';

describe('BytePlus Seed Speech runtime contracts', () => {
  it('exposes Seed Audio as audio output with bounded verified references', () => {
    const runtime = createBytePlusSpeechRuntimeConfig({
      modelId: 'seed-audio-1-0',
      endpointId: 'seed-audio-1.0',
      name: 'Seed Audio 1.0',
      description: 'Audio generation',
      generationModes: ['text_to_audio', 'audio_to_audio'],
      enabled: true,
      requiredPlan: null,
      globalConcurrency: 8,
      perUserRunning: 4,
      perUserQueued: 10,
      billingPolicy: billingPolicy(),
    });
    const definition = toBytePlusSpeechModelDefinition({
      config: runtime,
      source: 'byteplus-speech-config',
      ops: undefined,
    });

    expect(definition).toMatchObject({
      type: 'audio',
      family: 'audio',
      capability: 'audio_generation',
      capabilities: { textToAudio: true, audioToAudio: true, maxOutputs: 1 },
      queue: { queueName: 'ai-audio-generation' },
      output_schema: {
        properties: {
          outputs: { 'x-output': { control: 'audio_player' } },
        },
      },
    });
    expect(runtime.inputSchema.properties.referenceAudios).toMatchObject({
      maxItems: 3,
      'x-ui': {
        control: 'audio_upload',
        maxFileSizeMb: 10,
        maxItemDurationSeconds: 30,
      },
    });
  });

  it('publishes the curated Seed TTS voice enum and no SSML control', () => {
    const runtime = createBytePlusSpeechRuntimeConfig({
      modelId: 'seed-tts-2-0',
      endpointId: 'seed-tts-2.0',
      name: 'Seed TTS 2.0',
      description: 'Speech synthesis',
      generationModes: ['text_to_audio'],
      enabled: true,
      requiredPlan: null,
      globalConcurrency: 8,
      perUserRunning: 4,
      perUserQueued: 10,
      billingPolicy: billingPolicy(),
    });

    expect(runtime.inputSchema.properties.speaker?.type).toBe('string');
    expect(runtime.inputSchema.properties.speaker?.enum).toEqual(
      expect.arrayContaining([
        'zh_female_vv_uranus_bigtts',
        'zh_female_liuchangnv_uranus_bigtts',
        'zh_male_dayi_uranus_bigtts',
        'zh_male_liufei_uranus_bigtts',
        'en_male_tim_uranus_bigtts',
      ]),
    );
    expect(runtime.inputSchema.properties).not.toHaveProperty('ssml');
    expect(runtime.inputSchema.properties).toHaveProperty('contextText');
  });
});

function billingPolicy() {
  return {
    mode: 'charge' as const,
    unit: 'compute_point' as const,
    displayCurrency: 'COMPUTE_POINTS',
    finalCostSource: 'product_pricing' as const,
    refundPolicy: 'refund_on_final_failure' as const,
  };
}
