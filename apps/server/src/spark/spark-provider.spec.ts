import { SparkService } from './spark.service';

jest.mock('ioredis', () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => ({
    set: jest.fn().mockResolvedValue('OK'),
    on: jest.fn(),
  })),
}));

it('uses a supported regional model and validates generated IP metadata locally', async () => {
  const previous = process.env.ALIBABA_API_KEY;
  process.env.ALIBABA_API_KEY = 'fixture';
  let draft: unknown = {
    name: 'Library',
    description: 'A librarian opens a library.',
    tags: ['Drama'],
    bannerPrompt: 'A quiet library.',
  };
  const fetch = jest
    .spyOn(globalThis, 'fetch')
    .mockImplementation((_url, init) => {
      const body = JSON.parse(init!.body as string) as {
        model: string;
        response_format: { type: string };
        enable_thinking: boolean;
      };
      expect(body.model).toBe('qwen-plus');
      expect(body.response_format).toEqual({ type: 'json_object' });
      expect(body.enable_thinking).toBe(false);
      return Promise.resolve(
        new Response(
          JSON.stringify({
            id: 'fixture',
            created: 1,
            model: body.model,
            choices: [
              {
                index: 0,
                message: { role: 'assistant', content: JSON.stringify(draft) },
                finish_reason: 'stop',
              },
            ],
            usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
          }),
          { headers: { 'content-type': 'application/json' } },
        ),
      );
    });
  const service = new SparkService();
  const file = {
    originalname: 'fixture.txt',
    mimetype: 'text/plain',
    buffer: Buffer.from('A librarian opens the library doors.'),
  };
  try {
    await expect(service.analyzeUpload(file)).resolves.toMatchObject({
      name: 'Library',
      tags: ['Drama'],
    });
    draft = { name: 'Invalid' };
    await expect(service.analyzeUpload(file)).rejects.toThrow();
  } finally {
    fetch.mockRestore();
    if (previous === undefined) delete process.env.ALIBABA_API_KEY;
    else process.env.ALIBABA_API_KEY = previous;
  }
});
