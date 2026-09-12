import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { CurrentUser, type AuthUser } from '../../auth';
import { parseIdParam } from '../../common/params';
import { ZodValidationPipe } from '../../common/zod.pipe';
import { CrewAccountabilityService } from './accountability.service';
import {
  AccountabilityQuerySchema,
  CommitmentActionSchema,
  FeedbackResponseSchema,
  FeedbackSchema,
  HandoverSchema,
  WithdrawalSchema,
  type CommitmentAction,
} from './accountability.dto';

@Controller()
export class CrewAccountabilityController {
  constructor(private readonly service: CrewAccountabilityService) {}
  @Get('crew-tasks/:taskId/commitments')
  commitments(@Param('taskId') id: string, @CurrentUser() user: AuthUser) {
    return this.service.taskCommitments(
      parseIdParam(id, 'taskId'),
      user.userId,
    );
  }
  @Post('crew-tasks/:taskId/commitments')
  commit(
    @Param('taskId') id: string,
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(CommitmentActionSchema)) body: CommitmentAction,
  ) {
    return this.service.commit(parseIdParam(id, 'taskId'), user.userId, body);
  }
  @Post('crew-commitments/:id/handover')
  handover(
    @Param('id') id: string,
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(HandoverSchema)) body: { note: string },
  ) {
    return this.service.handover(
      parseIdParam(id, 'id'),
      user.userId,
      body.note,
    );
  }
  @Get('crews/:crewId/accountability')
  project(
    @Param('crewId') id: string,
    @CurrentUser() user: AuthUser,
    @Query(new ZodValidationPipe(AccountabilityQuerySchema))
    query: { page: number },
  ) {
    return this.service.project(
      parseIdParam(id, 'crewId'),
      user.userId,
      query.page,
    );
  }
  @Post('crews/:crewId/withdrawal')
  withdraw(
    @Param('crewId') id: string,
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(WithdrawalSchema)) body: { reason: string },
  ) {
    return this.service.withdrawProject(
      parseIdParam(id, 'crewId'),
      user.userId,
      body.reason,
    );
  }
  @Post('crews/:crewId/withdrawals/:userId/resolve')
  resolve(
    @Param('crewId') id: string,
    @Param('userId') subject: string,
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(HandoverSchema)) body: { note: string },
  ) {
    return this.service.resolveWithdrawal(
      parseIdParam(id, 'crewId'),
      parseIdParam(subject, 'userId'),
      user.userId,
      body.note,
    );
  }
  @Post('crews/:crewId/peer-feedback')
  feedback(
    @Param('crewId') id: string,
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(FeedbackSchema))
    body: { subjectUserId: string; rating: number; comment: string },
  ) {
    return this.service.feedback(parseIdParam(id, 'crewId'), user.userId, body);
  }
  @Post('crew-peer-feedback/:id/response')
  respond(
    @Param('id') id: string,
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(FeedbackResponseSchema))
    body: { response: string },
  ) {
    return this.service.respond(
      parseIdParam(id, 'id'),
      user.userId,
      body.response,
    );
  }
  @Post('crews/:crewId/completion-rewards/:userId')
  reward(
    @Param('crewId') id: string,
    @Param('userId') subject: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.recognize(
      parseIdParam(id, 'crewId'),
      parseIdParam(subject, 'userId'),
      user.userId,
    );
  }
}
