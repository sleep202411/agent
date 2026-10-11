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
function transport(output: unknown = proposal) {
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
                message: { role: 'assistant', content: JSON.stringify(output) },
                finish_reason: 'stop',
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
