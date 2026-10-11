import { createCopilotModel } from './copilot.model';

it.each([undefined, '  ', ' qwen-plus-2025-12-01 '])(
  'uses an available default and preserves explicit model configuration (%s)',
  (configured) => {
    const oldKey = process.env.ALIBABA_API_KEY;
    const oldModel = process.env.COPILOT_MODEL;
    process.env.ALIBABA_API_KEY = 'fixture';
    if (configured === undefined) delete process.env.COPILOT_MODEL;
    else process.env.COPILOT_MODEL = configured;
    try {
      expect(createCopilotModel()).toMatchObject({
        modelId: configured?.trim() || 'qwen-plus',
      });
    } finally {
      if (oldKey === undefined) delete process.env.ALIBABA_API_KEY;
      else process.env.ALIBABA_API_KEY = oldKey;
      if (oldModel === undefined) delete process.env.COPILOT_MODEL;
      else process.env.COPILOT_MODEL = oldModel;
    }
  },
);
