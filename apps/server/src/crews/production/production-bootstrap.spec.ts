jest.mock('../tasks/task-delivery-folder', () => ({
  provisionTaskDeliveryFolderTx: jest.fn().mockResolvedValue('folder'),
}));
import { CrewProductionKind, type Prisma } from '@prisma/client';
import {
  productionFolderTree,
  productionTaskPipeline,
  systemTaskKindTemplates,
  seedCrewProductionTasks,
} from './production-bootstrap';

describe('production bootstrap templates', () => {
  it('persists an imported graph on its plot task and does not overwrite it on a repeated seed', async () => {
    const rows: Prisma.CrewTaskUncheckedCreateInput[] = [];
    const tx = {
      crewTask: {
        count: () => Promise.resolve(rows.length),
        create: ({ data }: { data: Prisma.CrewTaskUncheckedCreateInput }) => {
          rows.push(data);
          return Promise.resolve(data);
        },
      },
      crewEpisode: { findMany: () => Promise.resolve([]) },
      $queryRaw: () => Promise.resolve([]),
    };
    const plotTree = {
      title: 'Imported story',
      description: '',
      startNodeId: 'end',
      nodes: [
        {
          id: 'end',
          type: 'ending' as const,
          content: { title: 'Final scene' },
          transitions: [],
        },
      ],
    };
    const input = {
      crewId: 'crew',
      userId: 'creator',
      episodeId: 'episode',
      kind: CrewProductionKind.interactive_film,
      locale: 'en-US' as const,
      openWorkflowStateId: 'open',
      plotTree,
    };
    await seedCrewProductionTasks(tx as never, input);
    const plotTask = rows.find((row) => row.taskKind === 'plot_tree');
    expect(plotTask?.metadata).toEqual({ plotTree });
    const count = rows.length;
    await seedCrewProductionTasks(tx as never, {
      ...input,
      plotTree: { ...plotTree, title: 'Replacement' },
    });
    expect(rows).toHaveLength(count);
    expect(plotTask?.metadata).toEqual({ plotTree });
  });
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
