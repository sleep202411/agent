import { StoryTextPlayService } from './story-text-play.service';
import type { InteractiveStoryDraftContent } from './interactive-film.schema';

const USER = { userId: 'user-1' } as never;
const WORKSPACE_ID = '0197f4a2-0800-7000-8000-00000000aa01';
const PROJECT_ID = '0197f4a2-0800-7000-8000-00000000aa02';

/**
 * Pure branching tree: a node continues to one next node, fans into labelled
 * choices, pauses at a checkpoint, or resolves to an ending. There is no hidden
 * play state — a choice is just its label and its target node.
 */
function draft(): InteractiveStoryDraftContent {
  return {
    storyBible: {
      logline: 'A visitor probes a sealed villa.',
      synopsis: 'One night, one gate, one truth.',
      worldview: 'A mythic villa at night.',
      characters: [
        {
          id: 'keeper',
          name: { 'zh-CN': '守门人' },
          summary: 'Guards the gate.',
          images: [],
          voice: null,
        },
      ],
      endings: [
        {
          id: 'ending.truth',
          title: { 'zh-CN': '真相' },
          summary: { 'zh-CN': '门开了。' },
          kind: 'truth',
        },
        {
          id: 'ending.retreat',
          title: { 'zh-CN': '退却' },
          kind: 'failure',
        },
      ],
    },
    graph: {
      entryNodeId: 'node.opening',
      nodes: [
        {
          kind: 'text',
          nodeId: 'node.opening',
          title: { 'zh-CN': '夜访' },
          body: { 'zh-CN': '你站在别墅门前。' },
          exit: { kind: 'auto', nextNodeId: 'node.gate' },
        },
        {
          kind: 'text',
          nodeId: 'node.gate',
          body: { 'zh-CN': '守门人拦住了你。' },
          exit: {
            kind: 'choice',
            decisionId: 'decision.gate',
            prompt: { 'zh-CN': '怎么办?' },
            choices: [
              {
                choiceId: 'choice.push',
                label: { 'zh-CN': '硬闯' },
                nextNodeId: 'node.reveal',
              },
              {
                choiceId: 'choice.leave',
                label: { 'zh-CN': '离开' },
                nextNodeId: 'node.retreat',
              },
            ],
          },
        },
        {
          kind: 'text',
          nodeId: 'node.reveal',
          body: { 'zh-CN': '你越过门槛，走进庭院。' },
          exit: { kind: 'checkpoint', nextNodeId: 'node.truth' },
        },
        {
          kind: 'text',
          nodeId: 'node.truth',
          title: { 'zh-CN': '门后' },
          body: { 'zh-CN': '门后是真相。' },
          exit: { kind: 'ending', endingId: 'ending.truth' },
        },
        {
          kind: 'text',
          nodeId: 'node.retreat',
          body: { 'zh-CN': '你转身离去。' },
          exit: { kind: 'ending', endingId: 'ending.retreat' },
        },
      ],
    },
    productionNotes: [],
  };
}

function serviceWith(content: InteractiveStoryDraftContent) {
  const prisma = {
    storyDraft: {
      findUnique: jest.fn().mockResolvedValue({ content }),
    },
  };
  const permissions = {
    requireProject: jest.fn().mockResolvedValue({
      project: {
        workspaceId: WORKSPACE_ID,
        format: 'text_adventure',
        defaultLocale: 'zh-CN',
      },
    }),
  };
  return new StoryTextPlayService(prisma as never, permissions as never);
}

describe('StoryTextPlayService static engine', () => {
  it('starts at the entry node with an empty play state', async () => {
    const service = serviceWith(draft());
    const result = await service.start(USER, WORKSPACE_ID, PROJECT_ID);

    expect(result.ended).toBe(false);
    expect(result.state).toMatchObject({
      nodeId: 'node.opening',
      freeTurnsUsed: 0,
    });
    expect(result.events[0]).toMatchObject({
      kind: 'anchor',
      nodeId: 'node.opening',
      title: '夜访',
      body: '你站在别墅门前。',
    });
  });

  it('advances an auto exit to the choice node and lists every choice', async () => {
    const service = serviceWith(draft());
    const { state } = await service.start(USER, WORKSPACE_ID, PROJECT_ID);

    const result = await service.turn(USER, WORKSPACE_ID, PROJECT_ID, {
      state,
      action: { kind: 'continue' },
      freeTurnLimit: 0,
    });

    expect(result.state.nodeId).toBe('node.gate');
    const choices = result.events.find((event) => event.kind === 'choices');
    expect(choices?.prompt).toBe('怎么办?');
    expect(choices?.choices?.map((choice) => choice.choiceId)).toEqual([
      'choice.push',
      'choice.leave',
    ]);
  });

  it('applies a choice, continues through a checkpoint, and reaches the ending', async () => {
    const service = serviceWith(draft());
    const { state } = await service.start(USER, WORKSPACE_ID, PROJECT_ID);
    const atGate = await service.turn(USER, WORKSPACE_ID, PROJECT_ID, {
      state,
      action: { kind: 'continue' },
      freeTurnLimit: 0,
    });

    const atCheckpoint = await service.turn(USER, WORKSPACE_ID, PROJECT_ID, {
      state: atGate.state,
      action: { kind: 'choice', choiceId: 'choice.push' },
      freeTurnLimit: 0,
    });
    expect(atCheckpoint.ended).toBe(false);
    expect(atCheckpoint.state.nodeId).toBe('node.reveal');

    const result = await service.turn(USER, WORKSPACE_ID, PROJECT_ID, {
      state: atCheckpoint.state,
      action: { kind: 'continue' },
      freeTurnLimit: 0,
    });

    expect(result.state.nodeId).toBe('node.truth');
    expect(result.ended).toBe(true);
    expect(result.events.at(-1)).toMatchObject({
      kind: 'ending',
      endingId: 'ending.truth',
      title: '真相',
      summary: '门开了。',
    });
  });

  it('rejects an unavailable choice', async () => {
    const service = serviceWith(draft());
    const { state } = await service.start(USER, WORKSPACE_ID, PROJECT_ID);
    const atGate = await service.turn(USER, WORKSPACE_ID, PROJECT_ID, {
      state,
      action: { kind: 'continue' },
      freeTurnLimit: 0,
    });

    await expect(
      service.turn(USER, WORKSPACE_ID, PROJECT_ID, {
        state: atGate.state,
        action: { kind: 'choice', choiceId: 'choice.secret' },
        freeTurnLimit: 0,
      }),
    ).rejects.toMatchObject({
      response: { code: 'TEXT_PLAY_CHOICE_UNAVAILABLE' },
    });
  });

  it('refuses free actions in static mode', async () => {
    const service = serviceWith(draft());
    const { state } = await service.start(USER, WORKSPACE_ID, PROJECT_ID);

    await expect(
      service.turn(USER, WORKSPACE_ID, PROJECT_ID, {
        state,
        action: { kind: 'free', text: '砸门' },
        freeTurnLimit: 0,
      }),
    ).rejects.toMatchObject({
      response: { code: 'TEXT_PLAY_FREE_DISABLED' },
    });
  });
});
