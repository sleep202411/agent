import { AiGenerationValidatorService } from './validator.service';
import { createBytePlusVideoRuntimeConfig } from './providers/byteplus/byteplus-runtime';
import { mapBytePlusVideoProviderRequest } from './providers/byteplus/byteplus-request.mapper';
import { BadRequestException } from '@nestjs/common';
import type { AiBillingPolicy, AiJsonValue } from './types';
describe('Seedance frame-ratio admission', () => {
  const makeRuntime = (endpointId = 'dreamina-seedance-2-5-260628') =>
    createBytePlusVideoRuntimeConfig({
      provider: 'byteplus-modelark',
      endpointId,
      name: 'Seedance 2.5',
      description: 'Seedance 2.5 test runtime',
      generationModes: [
        'text_to_video',
        'image_to_video',
        'first_last_frame_to_video',
        'multimodal_to_video',
      ],
      enabled: true,
      requiredPlan: null,
      queueName: 'ai-video-generation',
      globalConcurrency: 10,
      perUserRunning: 3,
      perUserQueued: 10,
      billingPolicy: {} as AiBillingPolicy,
      parameterPolicy: {
        defaultDurationSeconds: '5',
        durationOptions: ['auto', '4', '5', '8'],
        defaultAspectRatio: 'auto',
        supportedAspectRatios: ['auto', '16:9', '9:16'],
        defaultOmniReferenceTaskType: 'auto',
        omniReferenceTaskTypes: ['auto', 'reference', 'edit', 'extend'],
        referenceInputs: {
          enabled: true,
          images: { min: 0, max: 30 },
          videos: {
            min: 0,
            max: 10,
            minItemDurationSeconds: 2,
            maxItemDurationSeconds: 30,
          },
          audios: { min: 0, max: 10 },
          maxTotalFiles: 50,
          audioRequiresVisual: false,
        },
      } as AiJsonValue,
    });

  const runtime = makeRuntime();

  it.each(['startFrame', 'endFrame'])(
    'rejects fixed ratio with %s before dispatch',
    (field) => {
      const v = new AiGenerationValidatorService({
        ensureFacts: jest.fn(),
      } as never);
      try {
        v.normalizeInput(runtime.inputSchema, {
          prompt: 'move',
          [field]: { url: 'https://fixture.invalid/frame.png' },
          aspectRatio: '16:9',
          duration: '5',
        });
        throw new Error('Expected validation failure');
      } catch (error) {
        expect(error).toBeInstanceOf(BadRequestException);
        const response = (error as BadRequestException).getResponse() as {
          code: string;
          msg: string;
        };
        expect(response.code).toBe('VALIDATION_ERROR');
        expect(response.msg).toContain('Auto aspect ratio');
      }
    },
  );
  it('retains a fixed ratio for text-only generation', () => {
    const v = new AiGenerationValidatorService({
      ensureFacts: jest.fn(),
    } as never);
    expect(
      v.normalizeInput(runtime.inputSchema, {
        prompt: 'move',
        aspectRatio: '16:9',
      }).aspectRatio,
    ).toBe('16:9');
  });
  it('allows Auto through both catalog validation and the worker mapper', () => {
    const v = new AiGenerationValidatorService({
      ensureFacts: jest.fn(),
    } as never);
    const input = v.normalizeInput(runtime.inputSchema, {
      prompt: 'move toward the final composition',
      startFrame: { url: 'https://fixture.invalid/frame.png' },
      aspectRatio: 'auto',
      duration: '5',
    });
    expect(
      mapBytePlusVideoProviderRequest(runtime, input).ratio,
    ).toBeUndefined();
  });
  it('does not impose the 2.5 ratio rule on another endpoint', () => {
    const other = makeRuntime('seedance-other-endpoint');
    const v = new AiGenerationValidatorService({
      ensureFacts: jest.fn(),
    } as never);
    const input = v.normalizeInput(other.inputSchema, {
      prompt: 'move',
      startFrame: { url: 'https://fixture.invalid/frame.png' },
      aspectRatio: '16:9',
    });
    expect(mapBytePlusVideoProviderRequest(other, input).ratio).toBe('16:9');
  });
});
