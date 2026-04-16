import {
  Controller,
  Get,
  Post,
  Param,
  Res,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import type { Response } from 'express';
import { TaskService } from './task.service';
import { CurrentUser, type AuthUser } from '../../auth';

function ok<T>(data: T) {
  return { success: true, code: 'SUCCESS', message: '成功', data };
}

@Controller('task')
export class TaskController {
  constructor(private readonly taskService: TaskService) {}

  @Get('status/:taskId')
  async status(@Param('taskId') taskId: string, @CurrentUser() user: AuthUser) {
    const task = await this.taskService.getTask(taskId);
    if (!task) throw new NotFoundException('Task not found');
    if (task.userId && task.userId !== user.userId) {
      throw new ForbiddenException('Not your task');
    }
    return ok({
      taskId: task.id,
      type: task.type,
      status: task.status,
      phase: task.phase,
      progress: task.progress,
      chunksTotal: task.chunksTotal,
      chunksCompleted: task.chunksCompleted,
      message: task.message,
      result: task.status === 'done' ? task.result : undefined,
      error: task.error,
      createdAt: task.createdAt,
      startedAt: task.startedAt,
      completedAt: task.completedAt,
    });
  }

  @Get('stream/:taskId')
  async stream(
    @Param('taskId') taskId: string,
    @CurrentUser() user: AuthUser,
    @Res() res: Response,
  ) {
    const task = await this.taskService.getTask(taskId);
    if (!task) throw new NotFoundException('Task not found');
    if (task.userId && task.userId !== user.userId) {
      throw new ForbiddenException('Not your task');
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    const controller = new AbortController();

    res.on('close', () => {
      controller.abort();
    });

    try {
      for await (const event of this.taskService.streamProgress(
        taskId,
        controller.signal,
      )) {
        if (controller.signal.aborted) break;
        res.write(`data: ${JSON.stringify(event)}\n\n`);
        if (
          typeof (res as unknown as { flush?: () => void }).flush === 'function'
        ) {
          (res as unknown as { flush: () => void }).flush();
        }
      }
    } catch {
      // Stream closed
    }

    res.end();
  }

  @Post('cancel/:taskId')
  async cancel(@Param('taskId') taskId: string, @CurrentUser() user: AuthUser) {
    const task = await this.taskService.getTask(taskId);
    if (!task) throw new NotFoundException('Task not found');
    if (task.userId && task.userId !== user.userId) {
      throw new ForbiddenException('Not your task');
    }
    const success = await this.taskService.cancel(taskId);
    if (!success)
      throw new NotFoundException('Task not found or already completed');
    return ok({ cancelled: true });
  }
}
