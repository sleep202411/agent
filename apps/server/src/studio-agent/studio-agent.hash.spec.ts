import {
  canonicalStudioAgentJson,
  hashStudioAgentJson,
  studioAgentScopeKey,
} from './studio-agent.hash';

describe('Studio Agent canonical hashing', () => {
  it('is stable across object insertion order while preserving array order', () => {
    const left = {
      nested: { second: 2, first: 1 },
      values: ['a', 'b'],
    };
    const right = {
      values: ['a', 'b'],
      nested: { first: 1, second: 2 },
    };

    expect(canonicalStudioAgentJson(left)).toBe(
      canonicalStudioAgentJson(right),
    );
    expect(hashStudioAgentJson(left)).toBe(hashStudioAgentJson(right));
    expect(hashStudioAgentJson({ values: ['b', 'a'] })).not.toBe(
      hashStudioAgentJson({ values: ['a', 'b'] }),
    );
  });

  it('keeps mutable revisions and focus out of durable thread identity', () => {
    const container = {
      resourceType: 'story.chapter',
      resourceId: 'chapter-1',
      revision: '3',
    };

    expect(studioAgentScopeKey('workspace-1', container)).toBe(
      studioAgentScopeKey('workspace-1', {
        ...container,
        revision: '4',
      }),
    );
  });
});
