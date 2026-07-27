import { generateObject } from 'ai';
import {
  StoryTextPlayService,
  StoryTextPlayStateSchema,
} from './story-text-play.service';
import type { InteractiveStoryDraftContent } from './interactive-film.schema';

/**
 * The narrator is stubbed, not skipped.
 *
 * Every turn between two authored beats goes through the model now — there is
 * no static path left to walk the graph, because that was the anchor-slideshow.
 * So the tests own the narrator's two decisions (what it writes and whether the
 * beat `converged`) and assert what the ENGINE does with them.
 */
jest.mock('./story-authoring-model', () => ({
  createStoryAuthoringModel: () => ({}),
}));
jest.mock('ai', () => ({ generateObject: jest.fn() }));

const narrator = generateObject as unknown as jest.Mock;
const NARRATION = '你听见铜环轻响。';

function narratorConverges(converged: boolean): void {
  narrator.mockReset();
  narrator.mockResolvedValue({
    object: {
      narration: NARRATION,
      converged,
      suggestions: ['敲门', '绕到后院'],
    },
  });
}

beforeEach(() => narratorConverges(true));

const USER = { userId: 'user-1' } as never;
const WORKSPACE_ID = '0197f4a2-0800-7000-8000-00000000aa01';
const PROJECT_ID = '0197f4a2-0800-7000-8000-00000000aa02';

/**
 * Pure branching tree: a node continues to one next node, fans into labelled
 * choices, or resolves to an ending. There is no hidden play state — a choice
 * is just its label and its target node.
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
        },
        {
          id: 'ending.retreat',
          title: { 'zh-CN': '退却' },
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
          exit: { kind: 'auto', nextNodeId: 'node.truth' },
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
      pace: 'standard',
      runawayTurnGuard: 18,
    });

    expect(result.state.nodeId).toBe('node.gate');
    const choices = result.events.find((event) => event.kind === 'choices');
    expect(choices?.prompt).toBe('怎么办?');
    expect(choices?.choices?.map((choice) => choice.choiceId)).toEqual([
      'choice.push',
      'choice.leave',
    ]);
  });

  it('applies a choice, continues through the next scene, and reaches the ending', async () => {
    const service = serviceWith(draft());
    const { state } = await service.start(USER, WORKSPACE_ID, PROJECT_ID);
    const atGate = await service.turn(USER, WORKSPACE_ID, PROJECT_ID, {
      state,
      action: { kind: 'continue' },
      pace: 'standard',
      runawayTurnGuard: 18,
    });

    const atReveal = await service.turn(USER, WORKSPACE_ID, PROJECT_ID, {
      state: atGate.state,
      action: { kind: 'choice', choiceId: 'choice.push' },
      pace: 'standard',
      runawayTurnGuard: 18,
    });
    expect(atReveal.ended).toBe(false);
    expect(atReveal.state.nodeId).toBe('node.reveal');

    const result = await service.turn(USER, WORKSPACE_ID, PROJECT_ID, {
      state: atReveal.state,
      action: { kind: 'continue' },
      pace: 'standard',
      runawayTurnGuard: 18,
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

  /**
   * The creator 试玩 carries its play state in the request body (only the public
   * runtime holds it server-side and refuses a finished run), so a panel that
   * replays its last turn hands back a state parked on an ending node. That run
   * is simply over — answering it by reading `choices` off an exit that has none
   * was a 500 on a session that had done nothing wrong.
   */
  it('ends the run again instead of throwing when a turn lands on an ending node', async () => {
    const service = serviceWith(draft());
    const { state } = await service.start(USER, WORKSPACE_ID, PROJECT_ID);
    const atGate = await service.turn(USER, WORKSPACE_ID, PROJECT_ID, {
      state,
      action: { kind: 'continue' },
      pace: 'standard',
      runawayTurnGuard: 18,
    });
    const atReveal = await service.turn(USER, WORKSPACE_ID, PROJECT_ID, {
      state: atGate.state,
      action: { kind: 'choice', choiceId: 'choice.push' },
      pace: 'standard',
      runawayTurnGuard: 18,
    });
    const finished = await service.turn(USER, WORKSPACE_ID, PROJECT_ID, {
      state: atReveal.state,
      action: { kind: 'continue' },
      pace: 'standard',
      runawayTurnGuard: 18,
    });
    expect(finished.ended).toBe(true);
    expect(finished.state.nodeId).toBe('node.truth');

    const afterEnd = await service.turn(USER, WORKSPACE_ID, PROJECT_ID, {
      state: finished.state,
      action: { kind: 'continue' },
      pace: 'standard',
      runawayTurnGuard: 18,
    });

    expect(afterEnd.ended).toBe(true);
    expect(afterEnd.state.nodeId).toBe('node.truth');
    expect(afterEnd.events.at(-1)).toMatchObject({
      kind: 'ending',
      endingId: 'ending.truth',
    });
    expect(afterEnd.events.some((event) => event.kind === 'choices')).toBe(
      false,
    );
  });

  it('rejects an unavailable choice', async () => {
    const service = serviceWith(draft());
    const { state } = await service.start(USER, WORKSPACE_ID, PROJECT_ID);
    const atGate = await service.turn(USER, WORKSPACE_ID, PROJECT_ID, {
      state,
      action: { kind: 'continue' },
      pace: 'standard',
      runawayTurnGuard: 18,
    });

    await expect(
      service.turn(USER, WORKSPACE_ID, PROJECT_ID, {
        state: atGate.state,
        action: { kind: 'choice', choiceId: 'choice.secret' },
        pace: 'standard',
        runawayTurnGuard: 18,
      }),
    ).rejects.toMatchObject({
      response: { code: 'TEXT_PLAY_CHOICE_UNAVAILABLE' },
    });
  });

  it('keeps the runaway guard off the path of a beat the narrator ends itself', async () => {
    const service = serviceWith(draft());
    const { state } = await service.start(USER, WORKSPACE_ID, PROJECT_ID);

    // A generous guard is never consulted: `converged` alone moves the story.
    const result = await service.turn(USER, WORKSPACE_ID, PROJECT_ID, {
      state,
      action: { kind: 'continue' },
      pace: 'slow',
      runawayTurnGuard: 24,
    });

    expect(result.state.nodeId).toBe('node.gate');
    expect(result.state.freeTurnsUsed).toBe(0);
  });

  it('narrates a free action and stays put while the beat is unfinished', async () => {
    const service = serviceWith(draft());
    const { state } = await service.start(USER, WORKSPACE_ID, PROJECT_ID);
    narratorConverges(false);

    const result = await service.turn(USER, WORKSPACE_ID, PROJECT_ID, {
      state,
      action: { kind: 'free', text: '砸门' },
      pace: 'standard',
      runawayTurnGuard: 18,
    });

    expect(result.state.nodeId).toBe('node.opening');
    expect(result.state.freeTurnsUsed).toBe(1);
    expect(result.events.at(-1)).toMatchObject({ kind: 'suggestions' });
  });

  /**
   * A decision point never forces the player, so a run can sit at one for as
   * long as the player likes. The turn counter is per BEAT, not per run, so
   * lingering must stay healthy indefinitely — it used to accumulate until the
   * state failed its own schema and the player's run died of patience.
   */
  it('keeps a run healthy while the player lingers at a decision point', async () => {
    const service = serviceWith(draft());
    const { state } = await service.start(USER, WORKSPACE_ID, PROJECT_ID);
    const atGate = await service.turn(USER, WORKSPACE_ID, PROJECT_ID, {
      state,
      action: { kind: 'continue' },
      pace: 'standard',
      runawayTurnGuard: 18,
    });
    expect(atGate.state.nodeId).toBe('node.gate');

    // Far past the schema's max(100), with the narrator refusing to converge so
    // every turn also drives the guard.
    narratorConverges(false);
    let current = atGate.state;
    for (let turn = 0; turn < 150; turn += 1) {
      current = (
        await service.turn(USER, WORKSPACE_ID, PROJECT_ID, {
          state: current,
          action: { kind: 'continue' },
          pace: 'standard',
          runawayTurnGuard: 3,
        })
      ).state;
      // The state stays persistable: this is the parse the wire performs on the
      // next turn, and the counter it carries is bounded by the guard.
      expect(StoryTextPlayStateSchema.safeParse(current).success).toBe(true);
      expect(current.freeTurnsUsed).toBeLessThan(3);
    }

    // And the authored exit is still exactly where it was left.
    narratorConverges(true);
    expect(current.nodeId).toBe('node.gate');
    const chosen = await service.turn(USER, WORKSPACE_ID, PROJECT_ID, {
      state: current,
      action: { kind: 'choice', choiceId: 'choice.push' },
      pace: 'standard',
      runawayTurnGuard: 18,
    });
    expect(chosen.state.nodeId).toBe('node.reveal');
  });

  it('arrives at the next beat when the runaway guard finally trips', async () => {
    const service = serviceWith(draft());
    const { state } = await service.start(USER, WORKSPACE_ID, PROJECT_ID);
    narratorConverges(false);

    // A narrator that never converges must not narrate forever: at the guard
    // the story arrives, and it arrives as an ordinary anchor — no counter is
    // ever shown to the player.
    const stuck = await service.turn(USER, WORKSPACE_ID, PROJECT_ID, {
      state,
      action: { kind: 'continue' },
      pace: 'standard',
      runawayTurnGuard: 1,
    });

    expect(stuck.state.nodeId).toBe('node.gate');
    expect(stuck.events.some((event) => event.kind === 'anchor')).toBe(true);
  });
});
