import 'reflect-metadata';
import { BadRequestException, type PipeTransform } from '@nestjs/common';
import { ROUTE_ARGS_METADATA } from '@nestjs/common/constants';
import { ProjectTaskTemplatesAdminController } from './project-task-templates-admin.controller';
import { ProjectTaskTemplateService } from './project-task-template.service';

// Exercise the pipe attached to the real query parameter, then the service's
// database filter, without opening a network listener or connecting a database.
const parameters = Reflect.getMetadata(
  ROUTE_ARGS_METADATA,
  ProjectTaskTemplatesAdminController,
  'list',
) as Record<
  string,
  {
    index: number;
    pipes: PipeTransform<
      unknown,
      Parameters<ProjectTaskTemplatesAdminController['list']>[0]
    >[];
  }
>;
const queryPipe = Object.values(parameters).find((param) => param.index === 0)!
  .pipes[0];

it.each([
  [{}, { active: true }],
  [{ includeInactive: 'false' }, { active: true }],
  [{ includeInactive: 'true' }, {}],
  [
    { includeInactive: 'false', projectType: 'series' },
    { active: true, projectType: 'series' },
  ],
])('maps query %j to the intended template filter', async (raw, where) => {
  const findMany = jest.fn().mockResolvedValue([]);
  const service = new ProjectTaskTemplateService({
    projectTaskTemplate: { findMany },
  } as never);
  const controller = new ProjectTaskTemplatesAdminController(service);
  await controller.list(queryPipe.transform(raw, { type: 'query' }));
  expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ where }));
});

it.each(['no', '0', '', ['true', 'false'], { value: 'false' }])(
  'rejects ambiguous includeInactive input %j',
  (includeInactive) => {
    expect(() =>
      queryPipe.transform({ includeInactive }, { type: 'query' }),
    ).toThrow(BadRequestException);
  },
);
