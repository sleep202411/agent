import { buildHuBaoVillaImportBundle } from './import/hu-bao-villa.builder';
import { UnprocessableEntityException } from '@nestjs/common';
import { projectStoryFilmRevision } from './story-film-revision-projector';
import { filmClipProductionBlockReasons } from './story-film-production-read-model';
import {
  compileStoryFilmPrompt,
  providerImageReferencePromptOverhead,
} from './story-film-prompt-compiler';

const MODEL_ID = '01980f10-7a20-7c01-8000-000000000099';

describe('Story film provider prompt budget', () => {
  const bundle = buildHuBaoVillaImportBundle({
    defaultCanonicalModelId: MODEL_ID,
  });
  const projection = projectStoryFilmRevision({
    draft: bundle.draftContent,
    frameProfile: 'landscape_16_9',
    defaultLocale: 'zh-CN',
    defaultCanonicalModelId: MODEL_ID,
  });

  it('compiles all 21 HuBao clips into Seedance 4000-character budget', () => {
    expect(projection.clipSpecs).toHaveLength(21);
    let compacted = 0;
    projection.clipSpecs.forEach((clip) => {
      const referenceCount =
        bundle.clipReferencePlans.find((plan) => plan.clipKey === clip.key)
          ?.bindings.length ?? 0;
      const providerReservedLength =
        clip.generationControl.mode === 'omni_reference'
          ? providerImageReferencePromptOverhead(referenceCount)
          : 0;
      const compiled = compileStoryFilmPrompt({
        clip,
        maxLength: 4_000,
        providerReservedLength,
      });
      expect(compiled.text.length).toBeLessThanOrEqual(4_000);
      expect(compiled.stats.submittedLength).toBe(
        compiled.text.length + providerReservedLength,
      );
      expect(compiled.stats.submittedLength).toBeLessThanOrEqual(4_000);
      expect(compiled.stats.originalLength).toBeGreaterThanOrEqual(
        compiled.stats.submittedLength,
      );
      expect(compiled.text).toContain('分秒导演时间线：');
      expect(compiled.text).toContain(`-${clip.targetDurationMs / 1_000}秒]`);
      expect(compiled.text).toContain('结束状态：');
      if (compiled.stats.compacted) compacted += 1;
    });
    expect(compacted).toBeGreaterThan(0);
  });

  it('fails loud when even timecodes and the final end state cannot fit', () => {
    const clip = projection.clipSpecs[0];
    if (!clip) throw new Error('Expected HuBao opening clip.');
    expect(() => compileStoryFilmPrompt({ clip, maxLength: 20 })).toThrow(
      UnprocessableEntityException,
    );
  });

  it('deduplicates identical beat fields and preserves complete semantic units', () => {
    const base = projection.clipSpecs[0];
    if (!base) throw new Error('Expected HuBao opening clip.');
    const repeated = 'Keep her eyes fixed on the gate.';
    const clip = structuredClone(base);
    clip.prompt.timeline[0] = {
      ...clip.prompt.timeline[0],
      visual: repeated,
      camera: repeated,
      action: repeated,
    };
    const compiled = compileStoryFilmPrompt({ clip, maxLength: 4_000 });
    expect(
      compiled.text.match(/Keep her eyes fixed on the gate\./gu),
    ).toHaveLength(1);
    expect(compiled.text).not.toMatch(/Keep her eyes fixed on the gat$/u);
  });
});

describe('Story film initial production readiness', () => {
  it('does not treat an unmaterialized productionInputHash as a blocker', () => {
    expect(
      filmClipProductionBlockReasons(
        {
          generationControl: {
            mode: 'frame_lock',
            frameMode: 'first_frame',
          },
        },
        [
          {
            role: 'first_frame',
            required: true,
            approvedReferenceVersionId: '0197f4a2-0800-7000-8000-000000000001',
          },
        ],
      ),
    ).toEqual([]);
  });
});
