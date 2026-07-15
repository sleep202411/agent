import {
  buildJinlingV2ImportBundle,
  JINLING_V2_CLIP_IDS,
} from './jinling-v2.builder';

describe('buildJinlingV2ImportBundle', () => {
  it('projects all 26 authored clips into one lockable reachable graph', () => {
    const bundle = buildJinlingV2ImportBundle(
      '01980f10-7a20-7c01-8000-000000000002',
    );

    expect(bundle.prompts).toHaveLength(26);
    expect(bundle.draftContent.graph.nodes).toHaveLength(26);
    expect(bundle.draftContent.clipPrompts).toHaveLength(26);
    expect(bundle.clipSpecs).toHaveLength(26);
    expect(new Set(bundle.prompts.map((row) => row.clipId))).toEqual(
      new Set(JINLING_V2_CLIP_IDS),
    );
    expect(bundle.filmSpec.targets.choiceCount).toBe(4);
    expect(bundle.filmSpec.targets.endingCount).toBe(4);
  });
});
