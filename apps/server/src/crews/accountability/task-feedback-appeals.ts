import {
  Body,
  Controller,
  Injectable,
  NotFoundException,
  Param,
  Post,
} from '@nestjs/common';
import { z } from 'zod';
import { CurrentUser, type AuthUser } from '../../auth';
import { PrismaService } from '../../infra/db/db.module';
import { ZodValidationPipe } from '../../common/zod.pipe';
import { CrewTaskDisputesService } from '../tasks/task-disputes';

export const TaskFeedbackAppealInput = z
  .object({
    id: z.string().uuid(),
    reason: z.string().trim().min(3).max(1000),
  })
  .strict();
const FeedbackParam = z.object({ id: z.string().uuid() });

@Injectable()
export class CrewTaskFeedbackAppealsService {
  constructor(
    private readonly db: PrismaService,
    private readonly disputes: CrewTaskDisputesService,
  ) {}

  async open(
    feedbackId: string,
    userId: string,
    raw: z.infer<typeof TaskFeedbackAppealInput>,
  ) {
    const input = TaskFeedbackAppealInput.parse(raw);
    // The subject retains review rights after departure. Never accept caller-supplied
    // respondents, ratings or submission evidence; these come from the original review.
    const feedback = await this.db.crewTaskFeedback.findFirst({
      where: { id: feedbackId, subjectUserId: userId },
    });
    if (!feedback) throw new NotFoundException('Feedback not found.');
    const dispute = await this.disputes.open(feedback.taskId, userId, {
      id: input.id,
      respondentUserId: feedback.authorUserId,
      title: `Feedback review: ${feedback.id}`,
      // Preserve a readable, immutable snapshot in the existing dispute event.
      // The mutable subject response is deliberately not part of retry identity.
      message: [
        `Feedback ID: ${feedback.id}`,
        `Reason: ${input.reason}`,
        `Direction: ${feedback.direction}`,
        `Ratings: ${JSON.stringify(feedback.ratings)}`,
        `Original comment: ${feedback.comment}`,
      ].join('\n'),
      submissionIds: [feedback.submissionId],
    });
    return { feedbackId: feedback.id, dispute };
  }
}

@Controller()
export class CrewTaskFeedbackAppealsController {
  constructor(private readonly appeals: CrewTaskFeedbackAppealsService) {}

  @Post('crew-task-feedback/:id/appeals')
  open(
    @Param(new ZodValidationPipe(FeedbackParam))
    params: z.infer<typeof FeedbackParam>,
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(TaskFeedbackAppealInput))
    input: z.infer<typeof TaskFeedbackAppealInput>,
  ) {
    return this.appeals.open(params.id, user.userId, input);
  }
}
