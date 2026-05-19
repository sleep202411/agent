/**
 *   GET    /aurora/episodes/:episodeId/assignments       List
 *   GET    /aurora/episodes/:episodeId/activities        Activity log (paginated)
 *   POST   /aurora/episodes/:episodeId/assignments       Add (admin)
 *
 *   DELETE /aurora/assignments/:assignmentId             Remove (admin)
 *   POST   /aurora/assignments/:assignmentId/submit      Submit (self)
 *   POST   /aurora/assignments/:assignmentId/approve     Approve (admin)
 *   POST   /aurora/assignments/:assignmentId/reject      Reject (admin)
 *   POST   /aurora/assignments/:assignmentId/revenue     Set revenue (finance)
 */
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { CurrentUser } from '../../auth';
import type { AuthUser } from '../../auth';
import { parseIdParam } from '../params';
import { ZodValidationPipe } from '../zod.pipe';
import { AssignmentsService } from './assignments.service';
import {
  AddAssignmentSchema,
  type AddAssignmentInput,
  RejectAssignmentSchema,
  type RejectAssignmentInput,
  RevenueSchema,
  type RevenueInput,
  SubmitAssignmentSchema,
  type SubmitAssignmentInput,
} from './dto';

function actorName(user: AuthUser): string {
  return user.nickName || user.userName || user.userId;
}

@Controller()
export class AssignmentsController {
  constructor(private readonly svc: AssignmentsService) {}

  @Get('episodes/:episodeId/assignments')
  list(@Param('episodeId') idRaw: string, @CurrentUser() user: AuthUser) {
    return this.svc.list(parseIdParam(idRaw, 'episodeId'), user.userId);
  }

  @Get('episodes/:episodeId/activities')
  activity(
    @Param('episodeId') idRaw: string,
    @CurrentUser() user: AuthUser,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.svc.listActivity(
      parseIdParam(idRaw, 'episodeId'),
      user.userId,
      page ? Number.parseInt(page, 10) : 1,
      pageSize ? Number.parseInt(pageSize, 10) : 50,
    );
  }

  @Post('episodes/:episodeId/assignments')
  @HttpCode(HttpStatus.CREATED)
  add(
    @Param('episodeId') idRaw: string,
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(AddAssignmentSchema)) body: AddAssignmentInput,
  ) {
    return this.svc.add(
      parseIdParam(idRaw, 'episodeId'),
      user.userId,
      actorName(user),
      body,
    );
  }

  @Delete('assignments/:assignmentId')
  @HttpCode(HttpStatus.OK)
  remove(@Param('assignmentId') idRaw: string, @CurrentUser() user: AuthUser) {
    return this.svc.remove(
      parseIdParam(idRaw, 'assignmentId'),
      user.userId,
      actorName(user),
    );
  }

  @Post('assignments/:assignmentId/submit')
  @HttpCode(HttpStatus.OK)
  submit(
    @Param('assignmentId') idRaw: string,
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(SubmitAssignmentSchema))
    body: SubmitAssignmentInput,
  ) {
    return this.svc.submit(
      parseIdParam(idRaw, 'assignmentId'),
      user.userId,
      actorName(user),
      body,
    );
  }

  @Post('assignments/:assignmentId/approve')
  @HttpCode(HttpStatus.OK)
  approve(@Param('assignmentId') idRaw: string, @CurrentUser() user: AuthUser) {
    return this.svc.approve(
      parseIdParam(idRaw, 'assignmentId'),
      user.userId,
      actorName(user),
    );
  }

  @Post('assignments/:assignmentId/reject')
  @HttpCode(HttpStatus.OK)
  reject(
    @Param('assignmentId') idRaw: string,
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(RejectAssignmentSchema))
    body: RejectAssignmentInput,
  ) {
    return this.svc.reject(
      parseIdParam(idRaw, 'assignmentId'),
      user.userId,
      actorName(user),
      body,
    );
  }

  @Post('assignments/:assignmentId/revenue')
  @HttpCode(HttpStatus.OK)
  revenue(
    @Param('assignmentId') idRaw: string,
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(RevenueSchema)) body: RevenueInput,
  ) {
    return this.svc.setRevenue(
      parseIdParam(idRaw, 'assignmentId'),
      user.userId,
      actorName(user),
      body,
    );
  }
}
