import { createAlibaba } from '@ai-sdk/alibaba';
import { reviewDocumentTasks } from './document-task-review';

const proposal = {
  tasks: [
    {
      title: 'Invented castle',
      description: 'Build a castle.',
      category: 'scenes' as const,
      evidence: 'The library doors open and the librarian enters.',
    },
  ],
};
function provider(output: unknown) {
  const fetch = jest
    .fn<
      ReturnType<typeof globalThis.fetch>,
      Parameters<typeof globalThis.fetch>
    >()
    .mockResolvedValue(
      new Response(
        JSON.stringify({
          id: 'review',
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
  return {
    fetch,
    model: createAlibaba({ apiKey: 'fixture', fetch })('qwen-plus'),
  };
}
it('reviews the actual task against source content rather than trusting its passage ID', async () => {
  const issues = [
    { taskIndex: 0, reason: 'The source has a library, not a castle.' },
  ];
  const { fetch, model } = provider({ issues });
  const signal = new AbortController().signal;
  expect(
    await reviewDocumentTasks(
      proposal.tasks[0].evidence,
      proposal,
      model,
      signal,
    ),
  ).toEqual(issues);
  const body = JSON.parse(fetch.mock.calls[0][1]!.body as string) as {
    response_format: unknown;
    messages: unknown;
  };
  expect(body.response_format).toEqual({ type: 'json_object' });
  expect(JSON.stringify(body.messages)).toContain('Invented castle');
  expect(JSON.stringify(body.messages)).toContain('library');
  expect(JSON.stringify(body.messages)).toContain('Music');
  expect(JSON.stringify(body.messages)).toContain('missing production');
  expect(fetch).toHaveBeenCalledTimes(1);
});
it.each([
  {},
  { issues: 'passed' },
  { issues: [{ taskIndex: -5, reason: 'invalid' }] },
])('fails closed on malformed review output', async (output) => {
  const { model } = provider(output);
  await expect(
    reviewDocumentTasks(
      proposal.tasks[0].evidence,
      proposal,
      model,
      new AbortController().signal,
    ),
  ).rejects.toThrow();
});

it('requires production and audio coverage for explicit screenplay cues before semantic review', async () => {
  const { fetch, model } = provider({ issues: [] });
  const source = '第三集 风雪\n镜头1 雪地。旁白：风雪中的旅人。';
  const tasks = {
    tasks: [
      {
        title: '第三集-雪地',
        description: 'Scene asset.',
        category: 'scenes' as const,
        evidence: source,
        episode: { number: 3, title: '风雪', label: '第三集' },
      },
    ],
  };
  const issues = await reviewDocumentTasks(
    source,
    tasks,
    model,
    new AbortController().signal,
  );
  expect(issues).toHaveLength(2);
  expect(issues[0].reason).toContain('production');
  expect(issues[1].reason).toContain('audio');
  expect(fetch).not.toHaveBeenCalled();
});
it('rejects verbose asset instruction titles locally', async () => {
  const { fetch, model } = provider({ issues: [] });
  expect(
    await reviewDocumentTasks(
      'The library doors open.',
      { tasks: [{ ...proposal.tasks[0], title: 'Design the library' }] },
      model,
      new AbortController().signal,
    ),
  ).toEqual([expect.objectContaining({ taskIndex: 0 })]);
  expect(fetch).not.toHaveBeenCalled();
});
