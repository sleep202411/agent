import { CrewTaskDraftService } from './task-draft.service';

it('drafts through the regional provider contract with local schema validation', async () => {
  const old = process.env.ALIBABA_API_KEY;
  process.env.ALIBABA_API_KEY = 'fixture';
  const draft = {
    title: 'Prepare the library',
    description: 'Prepare the scene.',
    priority: null,
    startDate: null,
    dueDate: null,
    estimatePoints: null,
    revisionLimit: null,
    cycleId: null,
    parentTaskNumber: null,
    blockedByTaskNumbers: [],
    assigneeUserIds: [],
    questions: [],
  };
  const fetch = jest
    .spyOn(globalThis, 'fetch')
    .mockImplementation((_url, init) => {
      const body = JSON.parse(init!.body as string) as {
        model: string;
        response_format?: { type: string };
        enable_thinking?: boolean;
      };
      if (
        body.model !== 'qwen-plus' ||
        body.response_format?.type !== 'json_object' ||
        body.enable_thinking !== false
      )
        return Promise.resolve(
          new Response(
            JSON.stringify({
              error: {
                code: 'InvalidParameter',
                type: 'invalid_request_error',
                message: 'Unsupported model or response format',
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
  const service = new CrewTaskDraftService(
    {
      crewMember: { findMany: () => Promise.resolve([]) },
      crewTask: { findMany: () => Promise.resolve([]) },
      crewTaskCycle: { findMany: () => Promise.resolve([]) },
    } as never,
    { require: () => Promise.resolve(undefined) } as never,
  );
  const input = {
    prompt: 'Prepare a library scene.',
    locale: 'en-US' as const,
    timeZone: 'UTC',
    memberHints: [],
  };
  try {
    await expect(service.draft('crew', 'user', input)).resolves.toMatchObject({
      title: draft.title,
      assigneeUserIds: [],
    });
    expect(fetch).toHaveBeenCalledTimes(1);
    draft.title = '';
    await expect(service.draft('crew', 'user', input)).rejects.toThrow();
  } finally {
    fetch.mockRestore();
    if (old === undefined) delete process.env.ALIBABA_API_KEY;
    else process.env.ALIBABA_API_KEY = old;
  }
});
