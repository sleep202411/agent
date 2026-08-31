import { createHash } from 'node:crypto';
import { HttpException, Injectable, Logger } from '@nestjs/common';
import { getTool, UnknownToolError } from '@repo/agent-tools';
import { AgentOsProjectContextService } from './agent-os-project-context.service';
import { AgentOsToolExecutionReceiptService } from './agent-os-tool-execution-receipt.service';
import type {
  AgentOsCapabilityExecuteInput,
  AgentOsCapabilityHandler,
} from './capabilities/capability-handler';
import { AttachmentAgentCapabilityHandler } from './capabilities/attachment.handler';
import { PlatformAgentCapabilityHandler } from './capabilities/platform.handler';
import { StoryAgentCapabilityHandler } from './capabilities/story.handler';

export type AgentOsDomainResult =
  | { ok: true; data: unknown }
  | {
      ok: false;
      code: string;
      message: string;
      retryable: boolean;
      details?: Record<string, unknown>;
    };

/** Resolve the trusted project kind, then delegate to its compiled handler. */
@Injectable()
export class AgentOsDomainService {
  private readonly logger = new Logger(AgentOsDomainService.name);
  private readonly handlers: ReadonlyMap<string, AgentOsCapabilityHandler>;

  constructor(
    private readonly projects: AgentOsProjectContextService,
    private readonly receipts: AgentOsToolExecutionReceiptService,
    private readonly attachmentHandler: AttachmentAgentCapabilityHandler,
    private readonly platformHandler: PlatformAgentCapabilityHandler,
    storyHandler: StoryAgentCapabilityHandler,
  ) {
    this.handlers = new Map<string, AgentOsCapabilityHandler>([
      [platformHandler.projectKind, platformHandler],
      [storyHandler.projectKind, storyHandler],
    ]);
  }

  /** Non-Agent read path kept outside the required run/turn execution DTO. */
  async listProjectCharacters(actorId: string, projectId: string) {
    return this.platformHandler.listCharactersForUser(actorId, projectId);
  }

  async execute(
    input: AgentOsCapabilityExecuteInput,
  ): Promise<AgentOsDomainResult> {
    try {
      const tool = getTool(input.toolId);
      const execute = (claimedInput: AgentOsCapabilityExecuteInput) =>
        this.executeHandler(claimedInput);
      return tool.kind === 'command'
        ? await this.receipts.executeCommand(input, execute)
        : await execute(input);
    } catch (error) {
      if (error instanceof UnknownToolError)
        return unsupportedTool(input.toolId);
      if (error instanceof HttpException) {
        return domainError(error);
      }
      throw error;
    }
  }

  private async executeHandler(
    input: AgentOsCapabilityExecuteInput,
  ): Promise<AgentOsDomainResult> {
    try {
      const project = await this.projects.resolve(input.projectId);
      if (this.attachmentHandler.supports(input.toolId)) {
        return {
          ok: true,
          data: await this.attachmentHandler.execute(input, project),
        };
      }
      const handler = this.handlers.get(project.projectKind);
      if (!handler || !handler.supports(input.toolId)) {
        return unsupportedTool(input.toolId);
      }
      return { ok: true, data: await handler.execute(input) };
    } catch (error) {
      if (error instanceof HttpException) return domainError(error);
      this.logger.error(
        `Unhandled ${input.toolId} domain error for run ${input.runId}, tool call ${input.toolCallId}`,
        error instanceof Error ? error.stack : String(error),
      );
      return {
        ok: false,
        code: 'AGENT_OS_DOMAIN_INTERNAL_ERROR',
        message:
          'The Agent domain could not complete this tool because of an internal error.',
        retryable: false,
        details: {
          runId: input.runId,
          toolCallId: input.toolCallId,
          toolId: input.toolId,
        },
      };
    }
  }
}

function domainError(error: HttpException): AgentOsDomainResult {
  const response = error.getResponse();
  const body =
    typeof response === 'object' && response !== null
      ? (response as Record<string, unknown>)
      : {};
  return {
    ok: false,
    code: typeof body.code === 'string' ? body.code : error.name,
    message: typeof body.message === 'string' ? body.message : error.message,
    retryable: [409, 423, 429, 502, 503, 504].includes(error.getStatus()),
    details: body,
  };
}

function unsupportedTool(toolId: string): AgentOsDomainResult {
  return {
    ok: false,
    code: 'TOOL_NOT_SUPPORTED',
    message: `Agent OS domain does not implement ${toolId}`,
    retryable: false,
  };
}

export function agentOsDomainRequestHash(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}
