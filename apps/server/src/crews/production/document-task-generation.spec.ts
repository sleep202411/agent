import { createAlibaba } from '@ai-sdk/alibaba';
import { generateDocumentTasks } from './document-task-generation';

const source = 'The library doors open and the librarian enters.';
const proposal = {
  tasks: [
    {
      title: 'Library',
      description: 'Design the library.',
      category: 'scenes',
      evidence: source,
    },
  ],
};
function requestBody(init?: RequestInit): string {
  if (typeof init?.body !== 'string')
    throw new Error('Expected a JSON request body');
  return init.body;
}
function transport(
  output: unknown = proposal,
  raw = false,
  finishReason = 'stop',
) {
  return jest
    .fn<ReturnType<typeof fetch>, Parameters<typeof fetch>>()
    .mockImplementation((_url, init) => {
      const body = JSON.parse(requestBody(init)) as {
        response_format?: { type: string };
        messages: unknown;
      };
      // Require portable JSON Object mode across regional Qwen endpoints.
      if (body.response_format?.type !== 'json_object')
        return Promise.resolve(
          new Response(
            JSON.stringify({
              error: {
                message: 'Unsupported response_format for qwen-plus',
                type: 'invalid_request_error',
                code: 'InvalidParameter',
              },
            }),
            { status: 400, headers: { 'content-type': 'application/json' } },
          ),
        );
      return Promise.resolve(
        new Response(
          JSON.stringify({
            id: 'fixture',
            created: 1,
            model: 'qwen-plus',
            choices: [
              {
                index: 0,
                message: {
                  role: 'assistant',
                  content: raw ? String(output) : JSON.stringify(output),
                },
                finish_reason: finishReason,
              },
            ],
            usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
          }),
          { headers: { 'content-type': 'application/json' } },
        ),
      );
    });
}
it('uses supported JSON Object mode through the real provider and AI SDK', async () => {
  const fetch = transport();
  const model = createAlibaba({ apiKey: 'fixture', fetch })('qwen-plus');
  await expect(generateDocumentTasks(source, model)).resolves.toEqual(proposal);
  const body = JSON.parse(requestBody(fetch.mock.calls[0][1])) as {
    messages: unknown;
    enable_thinking: boolean;
    max_tokens: number;
  };
  expect(JSON.stringify(body.messages)).toContain('JSON');
  expect(JSON.stringify(body.messages)).toContain('finalEditing');
  expect(body.enable_thinking).toBe(false);
  expect(body.max_tokens).toBe(8192);
  expect(fetch).toHaveBeenCalledTimes(1);
});
it.each([
  { tasks: [{ ...proposal.tasks[0], category: 'invented' }] },
  {
    tasks: [
      {
        ...proposal.tasks[0],
        evidence: 'An invented scene not in the source.',
      },
    ],
  },
  { tasks: [proposal.tasks[0], proposal.tasks[0]] },
])(
  'rejects invalid or ungrounded JSON even when the provider accepts the request',
  async (output) => {
    const fetch = transport(output);
    const model = createAlibaba({
      apiKey: 'fixture',
      fetch,
    })('qwen-plus');
    await expect(generateDocumentTasks(source, model)).rejects.toThrow();
    expect(fetch).toHaveBeenCalledTimes(2);
  },
);
it('repairs an unsupported quote once while preserving strict source validation', async () => {
  const invalid = {
    tasks: [
      {
        ...proposal.tasks[0],
        evidence: 'The librarian arrives at the castle.',
      },
    ],
  };
  const fetch = transport();
  fetch.mockImplementationOnce(transport(invalid));
  const model = createAlibaba({ apiKey: 'fixture', fetch })('qwen-plus');
  await expect(generateDocumentTasks(source, model)).resolves.toEqual(proposal);
  expect(fetch).toHaveBeenCalledTimes(2);
  const retry = JSON.parse(requestBody(fetch.mock.calls[1][1])) as {
    messages: unknown;
  };
  expect(JSON.stringify(retry.messages)).toContain('previousProposal');
  expect(JSON.stringify(retry.messages)).toContain(source);
});
it('does not retry rejected provider requests as evidence repairs', async () => {
  const fetch = jest
    .fn<
      ReturnType<typeof globalThis.fetch>,
      Parameters<typeof globalThis.fetch>
    >()
    .mockResolvedValue(
      new Response(
        JSON.stringify({
          error: {
            message: 'Model unavailable',
            type: 'invalid_request_error',
            code: 'model_not_found',
          },
        }),
        { status: 404, headers: { 'content-type': 'application/json' } },
      ),
    );
  const model = createAlibaba({ apiKey: 'fixture', fetch })('qwen-plus');
  await expect(generateDocumentTasks(source, model)).rejects.toThrow();
  expect(fetch).toHaveBeenCalledTimes(1);
});

it.each(['{"tasks": [not-json', ''])(
  'repairs malformed or empty provider JSON once (%s)',
  async (raw) => {
    const fetch = transport();
    fetch.mockImplementationOnce(transport(raw, true));
    const model = createAlibaba({ apiKey: 'fixture', fetch })('qwen-plus');
    await expect(generateDocumentTasks(source, model)).resolves.toEqual(
      proposal,
    );
    expect(fetch).toHaveBeenCalledTimes(2);
  },
);
it('stops after two malformed responses without returning partial tasks', async () => {
  const fetch = transport('{"tasks": [not-json', true);
  const model = createAlibaba({ apiKey: 'fixture', fetch })('qwen-plus');
  await expect(generateDocumentTasks(source, model)).rejects.toThrow();
  expect(fetch).toHaveBeenCalledTimes(2);
});

it('does not retry a provider content-filter response', async () => {
  const fetch = transport('', true, 'content_filter');
  const model = createAlibaba({ apiKey: 'fixture', fetch })('qwen-plus');
  await expect(generateDocumentTasks(source, model)).rejects.toThrow();
  expect(fetch).toHaveBeenCalledTimes(1);
});

it('aborts a stalled request at four minutes and does not start a repair', async () => {
  jest.useFakeTimers();
  const timeout = jest
    .spyOn(AbortSignal, 'timeout')
    .mockImplementation((ms) => {
      const controller = new AbortController();
      setTimeout(
        () => controller.abort(new DOMException('Timed out', 'TimeoutError')),
        ms,
      );
      return controller.signal;
    });
  const fetch = jest
    .fn<
      ReturnType<typeof globalThis.fetch>,
      Parameters<typeof globalThis.fetch>
    >()
    .mockImplementation(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          const signal = init?.signal;
          if (!signal) throw new Error('Expected request cancellation signal');
          if (signal.aborted) reject(signal.reason as Error);
          else
            signal.addEventListener(
              'abort',
              () => reject(signal.reason as Error),
              {
                once: true,
              },
            );
        }),
    );
  try {
    const model = createAlibaba({ apiKey: 'fixture', fetch })('qwen-plus');
    const result = generateDocumentTasks(source, model).catch(
      (error: unknown) => error,
    );
    await jest.advanceTimersByTimeAsync(239_999);
    expect(fetch).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(1);
    expect(await result).toMatchObject({ name: 'TimeoutError' });
    expect(timeout).toHaveBeenCalledWith(240_000);
    expect(fetch).toHaveBeenCalledTimes(1);
  } finally {
    timeout.mockRestore();
    jest.useRealTimers();
  }
});
it('shares the four-minute deadline with the correction attempt', async () => {
  jest.useFakeTimers();
  const timeout = jest
    .spyOn(AbortSignal, 'timeout')
    .mockImplementation((ms) => {
      const controller = new AbortController();
      setTimeout(
        () => controller.abort(new DOMException('Timed out', 'TimeoutError')),
        ms,
      );
      return controller.signal;
    });
  const fetch = transport();
  fetch.mockImplementationOnce(async (...args) => {
    await new Promise((resolve) => setTimeout(resolve, 150_000));
    return transport({ tasks: [] })(...args);
  });
  fetch.mockImplementationOnce(
    (_url, init) =>
      new Promise((_resolve, reject) => {
        const signal = init?.signal;
        if (!signal) throw new Error('Expected cancellation signal');
        if (signal.aborted) reject(signal.reason as Error);
        else
          signal.addEventListener(
            'abort',
            () => reject(signal.reason as Error),
            {
              once: true,
            },
          );
      }),
  );
  try {
    const model = createAlibaba({ apiKey: 'fixture', fetch })('qwen-plus');
    const result = generateDocumentTasks(source, model).catch(
      (error: unknown) => error,
    );
    await jest.advanceTimersByTimeAsync(150_000);
    expect(fetch).toHaveBeenCalledTimes(2);
    await jest.advanceTimersByTimeAsync(90_000);
    expect(await result).toMatchObject({ name: 'TimeoutError' });
    expect(timeout).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledTimes(2);
  } finally {
    timeout.mockRestore();
    jest.useRealTimers();
  }
});

it('repairs only rejected excerpts and preserves all validated tasks', async () => {
  const validTasks = Array.from({ length: 66 }, (_, index) => ({
    ...proposal.tasks[0],
    title: `Validated task ${index}`,
  }));
  const rejected = [
    {
      ...proposal.tasks[0],
      title: 'Rejected A',
      evidence: 'Invented castle passage.',
    },
    {
      ...proposal.tasks[0],
      title: 'Rejected B',
      evidence: 'Invented forest passage.',
    },
  ];
  const corrected = rejected.map((task) => ({ ...task, evidence: source }));
  const fetch = transport({ tasks: corrected });
  fetch.mockImplementationOnce(
    transport({ tasks: [...validTasks, ...rejected] }),
  );
  const model = createAlibaba({ apiKey: 'fixture', fetch })('qwen-plus');
  await expect(generateDocumentTasks(source, model)).resolves.toEqual({
    tasks: [...validTasks, ...corrected],
  });
  const body = JSON.parse(requestBody(fetch.mock.calls[1][1])) as {
    messages: Array<{
      role: string;
      content: string | Array<{ type: string; text: string }>;
    }>;
  };
  const content = body.messages.find(
    (message) => message.role === 'user',
  )!.content;
  const retry = JSON.parse(
    typeof content === 'string'
      ? content
      : content.map((part) => part.text).join(''),
  ) as {
    previousProposal: { tasks: unknown[] };
    correction: string;
  };
  expect(retry.previousProposal.tasks).toEqual(rejected);
  expect(retry.correction).toContain('exactly that many tasks');
  expect(fetch).toHaveBeenCalledTimes(2);
});

it.each(['missing', 'extra', 'identity', 'ungrounded'])(
  'rejects an incomplete or changed targeted repair (%s)',
  async (kind) => {
    const valid = { ...proposal.tasks[0], title: 'Keep this task' };
    const rejected = {
      ...proposal.tasks[0],
      evidence: 'An invented castle passage.',
    };
    const repaired =
      kind === 'missing'
        ? []
        : kind === 'extra'
          ? [proposal.tasks[0], valid]
          : kind === 'identity'
            ? [{ ...proposal.tasks[0], title: 'Different task' }]
            : [rejected];
    const fetch = transport({ tasks: repaired });
    fetch.mockImplementationOnce(transport({ tasks: [valid, rejected] }));
    const model = createAlibaba({ apiKey: 'fixture', fetch })('qwen-plus');
    await expect(generateDocumentTasks(source, model)).rejects.toThrow();
    expect(fetch).toHaveBeenCalledTimes(2);
  },
);
