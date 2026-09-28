import { CrewProductionKind } from '@prisma/client';
import { ProjectTaskTemplateService } from './project-task-template.service';
import { TaskTemplateDefinitionSchema } from './project-task-template.schema';
import {
  DEFAULT_INTERACTIVE_FILM_TASK_TEMPLATE,
  DEFAULT_SERIES_TASK_TEMPLATE,
} from './project-task-template.types';
const item = DEFAULT_SERIES_TASK_TEMPLATE.items[0];

it.each([
  {},
  { version: 1, items: [] },
  { version: 1, items: [null] },
  { version: 1, items: [{ ...item, taskKind: 'not-a-kind' }] },
  { version: 1, items: [item, item] },
  { version: 1, items: [{ ...item, defaultDependencies: ['missing'] }] },
  { version: 1, items: [{ ...item, defaultDependencies: [item.templateKey] }] },
  {
    version: 1,
    items: [
      { ...item, templateKey: 'a', defaultDependencies: ['b'] },
      { ...item, templateKey: 'b', defaultDependencies: ['a'] },
    ],
  },
  { version: 1, items: [{ ...item, priceRange: { min: 100, max: 10 } }] },
  { version: 1, items: [item], plotTree: { nodes: [] } },
])(
  'rejects invalid template publication before any database mutation: %j',
  async (definition) => {
    const tx = {
      $executeRaw: jest.fn(),
      projectTaskTemplate: {
        findFirst: jest.fn().mockResolvedValue(null),
        updateMany: jest.fn(),
        create: jest.fn(),
      },
    };
    const transaction = jest.fn(
      (work: (client: typeof tx) => Promise<unknown>) => work(tx),
    );
    const service = new ProjectTaskTemplateService({
      $transaction: transaction,
    } as never);
    await expect(
      service.saveAdmin({
        projectType: CrewProductionKind.series,
        name: 'Invalid',
        definition,
      }),
    ).rejects.toThrow();
    expect(transaction).not.toHaveBeenCalled();
  },
);

it('accepts both shipped templates and forward dependencies without losing extension metadata', () => {
  expect(
    TaskTemplateDefinitionSchema.safeParse(DEFAULT_SERIES_TASK_TEMPLATE)
      .success,
  ).toBe(true);
  expect(
    TaskTemplateDefinitionSchema.safeParse(
      DEFAULT_INTERACTIVE_FILM_TASK_TEMPLATE,
    ).success,
  ).toBe(true);
  const definition = {
    version: 1,
    extension: 'retained',
    items: [
      { ...item, templateKey: 'first', defaultDependencies: ['later'] },
      { ...item, templateKey: 'later', defaultDependencies: [] },
    ],
  };
  expect(TaskTemplateDefinitionSchema.parse(definition)).toEqual(definition);
});
