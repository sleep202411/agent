import { CrewProductionKind } from '@prisma/client';
import {
  productionFolderTree,
  productionTaskPipeline,
  systemTaskKindTemplates,
} from './production-bootstrap';

describe('production bootstrap templates', () => {
  it('keeps stable folder keys for series and interactive film', () => {
    const series = productionFolderTree(CrewProductionKind.series);
    const film = productionFolderTree(CrewProductionKind.interactive_film);
    expect(series.map((folder) => folder.key)).toEqual([
      'script',
      'art',
      'music',
      'video',
    ]);
    expect(film.map((folder) => folder.key)).toEqual([
      'script',
      'art',
      'music',
      'video',
      'plot_tree',
      'playtest',
    ]);
    expect(
      series
        .find((folder) => folder.key === 'video')
        ?.children?.map((c) => c.key),
    ).toContain('video.final');
  });

  it('seeds typed pipelines in production order', () => {
    expect(
      productionTaskPipeline(CrewProductionKind.interactive_film).map(
        (task) => task.key,
      ),
    ).toEqual([
      'script',
      'gameplay',
      'plot_tree',
      'assets',
      'storyboard',
      'edit',
      'qa',
    ]);
    expect(
      productionTaskPipeline(CrewProductionKind.series).map(
        (task) => task.kind,
      ),
    ).toEqual([
      'script',
      'storyboard',
      'art',
      'voice',
      'edit',
      'edit',
      'edit',
      'qa',
    ]);
  });

  it('exposes system templates for every locale', () => {
    expect(systemTaskKindTemplates('zh-CN').map((row) => row.kind)).toContain(
      'art',
    );
    expect(
      systemTaskKindTemplates('en-US').find((row) => row.kind === 'script')
        ?.title,
    ).toBe('Script');
  });
});
