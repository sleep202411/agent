import { StudioAgentRegistry } from './studio-agent.registry';

describe('StudioAgentRegistry', () => {
  const registry = new StudioAgentRegistry();

  it('resolves one immutable scenario graph', () => {
    const scenario = registry.scenario({
      id: 'story.studio.assistant',
      version: '1.0.0',
    });

    expect(scenario.surfaceId).toBe('story.studio');
    expect(
      registry
        .scenarioCapabilities(scenario)
        .map((manifest) => manifest.capabilityId),
    ).toEqual([
      'studio.context.read',
      'story.canvas.read',
      'studio.task.delegate',
      'story.canvas.apply_patch',
    ]);
    expect(
      registry.scenarioSkills(scenario).map((manifest) => manifest.skillId),
    ).toEqual(['story.director']);
  });

  it('fails instead of substituting an unknown manifest version', () => {
    expect(() =>
      registry.scenario({
        id: 'story.studio.assistant',
        version: '2.0.0',
      }),
    ).toThrow('not registered');
  });

  it('validates strict capability inputs before an action is persisted', () => {
    expect(() =>
      registry.validateCapabilityInput(
        { id: 'story.canvas.read', version: '1.0.0' },
        { unexpected: true },
      ),
    ).toThrow('does not satisfy capability schema');
  });

  it('validates strict capability outputs before an action is committed', () => {
    const reference = {
      id: 'story.canvas.apply_patch',
      version: '1.0.0',
    };
    const output = {
      projectId: '42f83588-2010-4c56-8659-a55c991dcd40',
      chapterId: 'd59bb772-d9ea-412d-83c0-62843b49445a',
      draftRevision: 4,
      layoutRevision: 7,
      draftChanged: true,
      layoutChanged: false,
      affectedNodeIds: ['scene.opening'],
      createdNodeIds: [],
    };

    expect(registry.validateCapabilityOutput(reference, output)).toEqual(
      output,
    );
    expect(() =>
      registry.validateCapabilityOutput(reference, {
        ...output,
        undocumented: true,
      }),
    ).toThrow('does not satisfy capability schema');
  });
});
