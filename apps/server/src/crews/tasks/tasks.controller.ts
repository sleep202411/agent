import { CloseCrewTaskSchema, type CloseCrewTaskInput } from '../dto';
import { TaskDeliveryTemplateInput } from './task-delivery-template';
import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { CurrentUser } from '../../auth';
import type { AuthUser } from '../../auth';
import { parseIdParam } from '../../common/params';
import { ZodValidationPipe } from '../../common/zod.pipe';
import { z } from 'zod';
import {
  CreateCrewTaskSchema,
  type CreateCrewTaskInput,
  CreateCrewTaskKindTemplateSchema,
  type CreateCrewTaskKindTemplateInput,
  DraftCrewTaskSchema,
  type DraftCrewTaskInput,
  CreateCrewTaskCommentSchema,
  type CreateCrewTaskCommentInput,
  ListCrewTaskTimelineQuerySchema,
  type ListCrewTaskTimelineQuery,
  ReviewCrewTaskSchema,
  type ReviewCrewTaskInput,
  SetTaskDeliveryFolderSchema,
  type SetTaskDeliveryFolderInput,
  SubmitCrewTaskSchema,
  type SubmitCrewTaskInput,
  UpdateCrewTaskSchema,
  type UpdateCrewTaskInput,
  UpdateCrewTaskCommentSchema,
  type UpdateCrewTaskCommentInput,
} from '../dto';
import {
  CrewTaskCenterQuerySchema,
  type CrewTaskCenterQuery,
} from './project-dto';
import { CrewTasksService } from './tasks.service';
import {
  BatchUpdateCrewTasksSchema,
  type BatchUpdateCrewTasksInput,
  CreateCrewTaskCycleSchema,
  type CreateCrewTaskCycleInput,
  CreateCrewTaskFieldSchema,
  type CreateCrewTaskFieldInput,
  CreateCrewTaskLabelSchema,
  type CreateCrewTaskLabelInput,
  CreateCrewTaskViewSchema,
  type CreateCrewTaskViewInput,
  CreateCrewTaskWorkflowStateSchema,
  type CreateCrewTaskWorkflowStateInput,
  ReorderCrewTaskSchema,
  type ReorderCrewTaskInput,
  ReorderCrewTaskWorkflowStatesSchema,
  type ReorderCrewTaskWorkflowStatesInput,
  ListCrewTaskOptionsQuerySchema,
  type ListCrewTaskOptionsQuery,
  ListCrewTasksQuerySchema,
  type ListCrewTasksQuery,
  UpdateCrewTaskCycleSchema,
  type UpdateCrewTaskCycleInput,
  UpdateCrewTaskFieldSchema,
  type UpdateCrewTaskFieldInput,
  UpdateCrewTaskLabelSchema,
  type UpdateCrewTaskLabelInput,
  UpdateCrewTaskViewSchema,
  type UpdateCrewTaskViewInput,
  UpdateCrewTaskWorkflowStateSchema,
  type UpdateCrewTaskWorkflowStateInput,
} from './project-dto';
import { CrewTaskDraftService } from './task-draft.service';

@Controller()
export class CrewTasksController {
  constructor(
    private readonly tasks: CrewTasksService,
    private readonly taskDrafts: CrewTaskDraftService,
  ) {}

  @Post('crew-tasks/:taskId/close')
  close(
    @Param('taskId') taskId: string,
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(CloseCrewTaskSchema)) body: CloseCrewTaskInput,
  ) {
    return this.tasks.close(parseIdParam(taskId, 'taskId'), user.userId, body);
  }

  @Get('crew-task-center')
  taskCenter(
    @CurrentUser() user: AuthUser,
    @Query(new ZodValidationPipe(CrewTaskCenterQuerySchema))
    query: CrewTaskCenterQuery,
  ) {
    return this.tasks.listCenter(user.userId, query);
  }

  @Get('crews/:crewId/task-project')
  project(@Param('crewId') crewId: string, @CurrentUser() user: AuthUser) {
    return this.tasks.getProject(parseIdParam(crewId, 'crewId'), user.userId);
  }

  @Get('crews/:crewId/task-kind-templates')
  listTaskKindTemplates(
    @Param('crewId') crewId: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.tasks.listTaskKindTemplates(
      parseIdParam(crewId, 'crewId'),
      user.userId,
    );
  }

  @Post('crews/:crewId/task-kind-templates')
  @HttpCode(HttpStatus.CREATED)
  createTaskKindTemplate(
    @Param('crewId') crewId: string,
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(CreateCrewTaskKindTemplateSchema))
    body: CreateCrewTaskKindTemplateInput,
  ) {
    return this.tasks.createTaskKindTemplate(
      parseIdParam(crewId, 'crewId'),
      user.userId,
      body,
    );
  }

  @Delete('crews/:crewId/task-kind-templates/:templateId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteTaskKindTemplate(
    @Param('crewId') crewId: string,
    @Param('templateId') templateId: string,
    @CurrentUser() user: AuthUser,
  ) {
    await this.tasks.deleteTaskKindTemplate(
      parseIdParam(crewId, 'crewId'),
      user.userId,
      parseIdParam(templateId, 'templateId'),
    );
  }

  @Post('crews/:crewId/task-views')
  @HttpCode(HttpStatus.CREATED)
  createView(
    @Param('crewId') crewId: string,
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(CreateCrewTaskViewSchema))
    body: CreateCrewTaskViewInput,
  ) {
    return this.tasks.createView(
      parseIdParam(crewId, 'crewId'),
      user.userId,
      body,
    );
  }

  @Patch('crew-task-views/:viewId')
  updateView(
    @Param('viewId') viewId: string,
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(UpdateCrewTaskViewSchema))
    body: UpdateCrewTaskViewInput,
  ) {
    return this.tasks.updateView(
      parseIdParam(viewId, 'viewId'),
      user.userId,
      body,
    );
  }

  @Delete('crew-task-views/:viewId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteView(
    @Param('viewId') viewId: string,
    @CurrentUser() user: AuthUser,
  ) {
    await this.tasks.deleteView(parseIdParam(viewId, 'viewId'), user.userId);
  }

  @Post('crews/:crewId/task-workflow-states')
  @HttpCode(HttpStatus.CREATED)
  createWorkflowState(
    @Param('crewId') crewId: string,
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(CreateCrewTaskWorkflowStateSchema))
    body: CreateCrewTaskWorkflowStateInput,
  ) {
    return this.tasks.createWorkflowState(
      parseIdParam(crewId, 'crewId'),
      user.userId,
      body,
    );
  }

  @Patch('crew-task-workflow-states/:stateId')
  updateWorkflowState(
    @Param('stateId') stateId: string,
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(UpdateCrewTaskWorkflowStateSchema))
    body: UpdateCrewTaskWorkflowStateInput,
  ) {
    return this.tasks.updateWorkflowState(
      parseIdParam(stateId, 'stateId'),
      user.userId,
      body,
    );
  }

  @Post('crews/:crewId/task-workflow-states/reorder')
  reorderWorkflowStates(
    @Param('crewId') crewId: string,
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(ReorderCrewTaskWorkflowStatesSchema))
    body: ReorderCrewTaskWorkflowStatesInput,
  ) {
    return this.tasks.reorderWorkflowStates(
      parseIdParam(crewId, 'crewId'),
      user.userId,
      body,
    );
  }

  @Delete('crew-task-workflow-states/:stateId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteWorkflowState(
    @Param('stateId') stateId: string,
    @CurrentUser() user: AuthUser,
  ) {
    await this.tasks.deleteWorkflowState(
      parseIdParam(stateId, 'stateId'),
      user.userId,
    );
  }

  @Post('crews/:crewId/task-cycles')
  @HttpCode(HttpStatus.CREATED)
  createCycle(
    @Param('crewId') crewId: string,
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(CreateCrewTaskCycleSchema))
    body: CreateCrewTaskCycleInput,
  ) {
    return this.tasks.createCycle(
      parseIdParam(crewId, 'crewId'),
      user.userId,
      body,
    );
  }

  @Patch('crew-task-cycles/:cycleId')
  updateCycle(
    @Param('cycleId') cycleId: string,
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(UpdateCrewTaskCycleSchema))
    body: UpdateCrewTaskCycleInput,
  ) {
    return this.tasks.updateCycle(
      parseIdParam(cycleId, 'cycleId'),
      user.userId,
      body,
    );
  }

  @Delete('crew-task-cycles/:cycleId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteCycle(
    @Param('cycleId') cycleId: string,
    @CurrentUser() user: AuthUser,
  ) {
    await this.tasks.deleteCycle(parseIdParam(cycleId, 'cycleId'), user.userId);
  }

  @Post('crews/:crewId/task-labels')
  @HttpCode(HttpStatus.CREATED)
  createLabel(
    @Param('crewId') crewId: string,
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(CreateCrewTaskLabelSchema))
    body: CreateCrewTaskLabelInput,
  ) {
    return this.tasks.createLabel(
      parseIdParam(crewId, 'crewId'),
      user.userId,
      body,
    );
  }

  @Patch('crew-task-labels/:labelId')
  updateLabel(
    @Param('labelId') labelId: string,
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(UpdateCrewTaskLabelSchema))
    body: UpdateCrewTaskLabelInput,
  ) {
    return this.tasks.updateLabel(
      parseIdParam(labelId, 'labelId'),
      user.userId,
      body,
    );
  }

  @Delete('crew-task-labels/:labelId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteLabel(
    @Param('labelId') labelId: string,
    @CurrentUser() user: AuthUser,
  ) {
    await this.tasks.deleteLabel(parseIdParam(labelId, 'labelId'), user.userId);
  }

  @Post('crews/:crewId/task-fields')
  @HttpCode(HttpStatus.CREATED)
  createField(
    @Param('crewId') crewId: string,
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(CreateCrewTaskFieldSchema))
    body: CreateCrewTaskFieldInput,
  ) {
    return this.tasks.createField(
      parseIdParam(crewId, 'crewId'),
      user.userId,
      body,
    );
  }

  @Patch('crew-task-fields/:fieldId')
  updateField(
    @Param('fieldId') fieldId: string,
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(UpdateCrewTaskFieldSchema))
    body: UpdateCrewTaskFieldInput,
  ) {
    return this.tasks.updateField(
      parseIdParam(fieldId, 'fieldId'),
      user.userId,
      body,
    );
  }

  @Delete('crew-task-fields/:fieldId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteField(
    @Param('fieldId') fieldId: string,
    @CurrentUser() user: AuthUser,
  ) {
    await this.tasks.deleteField(parseIdParam(fieldId, 'fieldId'), user.userId);
  }

  @Patch('crews/:crewId/tasks/batch')
  batchUpdate(
    @Param('crewId') crewId: string,
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(BatchUpdateCrewTasksSchema))
    body: BatchUpdateCrewTasksInput,
  ) {
    return this.tasks.batchUpdate(
      parseIdParam(crewId, 'crewId'),
      user.userId,
      body,
    );
  }

  @Get('crews/:crewId/tasks')
  list(
    @Param('crewId') crewId: string,
    @CurrentUser() user: AuthUser,
    @Query(new ZodValidationPipe(ListCrewTasksQuerySchema))
    query: ListCrewTasksQuery,
  ) {
    return this.tasks.list(parseIdParam(crewId, 'crewId'), user.userId, query);
  }

  @Get('crews/:crewId/task-summary')
  summary(@Param('crewId') crewId: string, @CurrentUser() user: AuthUser) {
    return this.tasks.summary(parseIdParam(crewId, 'crewId'), user.userId);
  }

  @Get('crews/:crewId/task-activity')
  activity(
    @Param('crewId') crewId: string,
    @CurrentUser() user: AuthUser,
    @Query(new ZodValidationPipe(ListCrewTaskTimelineQuerySchema))
    query: ListCrewTaskTimelineQuery,
  ) {
    return this.tasks.listActivity(
      parseIdParam(crewId, 'crewId'),
      user.userId,
      query,
    );
  }

  @Get('crews/:crewId/task-options')
  listOptions(
    @Param('crewId') crewId: string,
    @CurrentUser() user: AuthUser,
    @Query(new ZodValidationPipe(ListCrewTaskOptionsQuerySchema))
    query: ListCrewTaskOptionsQuery,
  ) {
    return this.tasks.listOptions(
      parseIdParam(crewId, 'crewId'),
      user.userId,
      query,
    );
  }

  @Post('crews/:crewId/tasks')
  @HttpCode(HttpStatus.CREATED)
  create(
    @Param('crewId') crewId: string,
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(CreateCrewTaskSchema))
    body: CreateCrewTaskInput,
  ) {
    return this.tasks.create(parseIdParam(crewId, 'crewId'), user.userId, body);
  }

  @Post('crews/:crewId/task-drafts')
  draft(
    @Param('crewId') crewId: string,
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(DraftCrewTaskSchema))
    body: DraftCrewTaskInput,
  ) {
    return this.taskDrafts.draft(
      parseIdParam(crewId, 'crewId'),
      user.userId,
      body,
    );
  }

  @Get('crew-tasks/:taskId/recruitment-terms')
  recruitmentTerms(
    @Param('taskId') taskId: string,
    @CurrentUser() user: AuthUser,
    @Query(
      new ZodValidationPipe(
        z.object({ applicantId: z.string().min(1).max(128) }).strict(),
      ),
    )
    query: { applicantId: string },
  ) {
    return this.tasks.recruitmentTerms(
      parseIdParam(taskId, 'taskId'),
      user.userId,
      query.applicantId,
    );
  }

  @Get('crew-tasks/:taskId')
  get(@Param('taskId') taskId: string, @CurrentUser() user: AuthUser) {
    return this.tasks.get(parseIdParam(taskId, 'taskId'), user.userId);
  }

  @Patch('crew-tasks/:taskId')
  update(
    @Param('taskId') taskId: string,
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(UpdateCrewTaskSchema))
    body: UpdateCrewTaskInput,
  ) {
    return this.tasks.update(parseIdParam(taskId, 'taskId'), user.userId, body);
  }

  @Delete('crew-tasks/:taskId')
  @HttpCode(HttpStatus.NO_CONTENT)
  deleteTask(
    @Param('taskId') taskId: string,
    @CurrentUser() user: AuthUser,
    @Body(
      new ZodValidationPipe(
        z.strictObject({ expectedVersion: z.int().positive() }),
      ),
    )
    body: { expectedVersion: number },
  ) {
    return this.tasks.delete(
      parseIdParam(taskId, 'taskId'),
      user.userId,
      body.expectedVersion,
    );
  }

  @Post('crew-tasks/:taskId/reorder')
  reorder(
    @Param('taskId') taskId: string,
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(ReorderCrewTaskSchema))
    body: ReorderCrewTaskInput,
  ) {
    return this.tasks.reorder(
      parseIdParam(taskId, 'taskId'),
      user.userId,
      body,
    );
  }

  @Get('crew-tasks/:taskId/timeline')
  timeline(
    @Param('taskId') taskId: string,
    @CurrentUser() user: AuthUser,
    @Query(new ZodValidationPipe(ListCrewTaskTimelineQuerySchema))
    query: ListCrewTaskTimelineQuery,
  ) {
    return this.tasks.listTimeline(
      parseIdParam(taskId, 'taskId'),
      user.userId,
      query,
    );
  }

  @Post('crew-tasks/:taskId/comments')
  @HttpCode(HttpStatus.CREATED)
  comment(
    @Param('taskId') taskId: string,
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(CreateCrewTaskCommentSchema))
    body: CreateCrewTaskCommentInput,
  ) {
    return this.tasks.createComment(
      parseIdParam(taskId, 'taskId'),
      user.userId,
      body,
    );
  }

  @Patch('crew-task-comments/:commentId')
  updateComment(
    @Param('commentId') commentId: string,
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(UpdateCrewTaskCommentSchema))
    body: UpdateCrewTaskCommentInput,
  ) {
    return this.tasks.updateComment(
      parseIdParam(commentId, 'commentId'),
      user.userId,
      body,
    );
  }

  @Delete('crew-task-comments/:commentId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteComment(
    @Param('commentId') commentId: string,
    @CurrentUser() user: AuthUser,
  ) {
    await this.tasks.deleteComment(
      parseIdParam(commentId, 'commentId'),
      user.userId,
    );
  }

  @Get('crew-tasks/:taskId/delivery-template')
  async getDeliveryTemplate(
    @Param('taskId') id: string,
    @CurrentUser() user: AuthUser,
    @Res() response: Response,
  ) {
    // Nest sends a bare null as an empty response; this endpoint promises JSON.
    const template = await this.tasks.getDeliveryTemplate(
      parseIdParam(id, 'taskId'),
      user.userId,
    );
    response.json(template);
  }
  @Post('crew-tasks/:taskId/delivery-template')
  setDeliveryTemplate(
    @Param('taskId') id: string,
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(TaskDeliveryTemplateInput))
    input: z.infer<typeof TaskDeliveryTemplateInput>,
  ) {
    return this.tasks.setDeliveryTemplate(
      parseIdParam(id, 'taskId'),
      user.userId,
      input,
    );
  }

  @Put('crew-tasks/:taskId/delivery-folder')
  setDeliveryFolder(
    @Param('taskId') id: string,
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(SetTaskDeliveryFolderSchema))
    input: SetTaskDeliveryFolderInput,
  ) {
    return this.tasks.setDeliveryFolder(
      parseIdParam(id, 'taskId'),
      user.userId,
      input,
    );
  }

  @Post('crew-tasks/:taskId/submissions')
  @HttpCode(HttpStatus.CREATED)
  submit(
    @Param('taskId') taskId: string,
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(SubmitCrewTaskSchema))
    body: SubmitCrewTaskInput,
  ) {
    return this.tasks.submit(parseIdParam(taskId, 'taskId'), user.userId, body);
  }

  @Post('crew-tasks/:taskId/review')
  review(
    @Param('taskId') taskId: string,
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(ReviewCrewTaskSchema))
    body: ReviewCrewTaskInput,
    @Headers('cookie') cookie?: string,
  ) {
    return this.tasks.review(
      parseIdParam(taskId, 'taskId'),
      user.userId,
      body,
      cookie,
    );
  }
}
