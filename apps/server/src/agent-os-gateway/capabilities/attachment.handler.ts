import { Injectable, UnprocessableEntityException } from '@nestjs/common';
import {
  AgentOsAttachmentService,
  contentHash,
} from '../agent-os-attachment.service';
import {
  ScriptReadSectionInputSchema,
  ScriptStoreInputSchema,
} from '../agent-os-domain.dto';
import {
  AgentOsProjectContextService,
  type AgentOsProjectContext,
} from '../agent-os-project-context.service';
import type { AgentOsCapabilityExecuteInput } from './capability-handler';

const ATTACHMENT_TOOL_IDS = new Set(['script.readSection', 'script.store']);

/**
 * Agent OS core attachment tools.
 *
 * Attachments are conversation input, not a Platform or Story business
 * capability. Keeping their execution here prevents either workbench handler
 * from becoming the accidental owner of the shared ingestion contract.
 */
@Injectable()
export class AttachmentAgentCapabilityHandler {
  constructor(
    private readonly attachments: AgentOsAttachmentService,
    private readonly projects: AgentOsProjectContextService,
  ) {}

  supports(toolId: string): boolean {
    return ATTACHMENT_TOOL_IDS.has(toolId);
  }

  async execute(
    input: AgentOsCapabilityExecuteInput,
    project: AgentOsProjectContext,
  ): Promise<unknown> {
    switch (input.toolId) {
      case 'script.store': {
        const args = ScriptStoreInputSchema.parse(input.arguments);
        const uploaded = await this.attachments.upload(
          input.actorId,
          project.projectId,
          {
            originalname: `agent-script-${Date.now()}.txt`,
            mimetype: 'text/plain',
            size: Buffer.byteLength(args.text, 'utf8'),
            buffer: Buffer.from(args.text, 'utf8'),
          },
          { sectionSize: args.sectionSize },
        );
        return {
          sectionCount: uploaded.sectionCount,
          attachmentId: uploaded.id,
        };
      }
      case 'script.readSection': {
        const args = ScriptReadSectionInputSchema.parse(input.arguments);
        await this.projects.authorizeRead(input.actorId, project);
        const attachment = await this.attachments.getForTool(
          project.projectKind,
          project.projectId,
          args.attachmentId,
        );
        if (args.sectionIndex >= attachment.sections.length) {
          throw new UnprocessableEntityException({
            code: 'SECTION_OUT_OF_RANGE',
            message: `sectionIndex ${args.sectionIndex} >= ${attachment.sections.length}`,
          });
        }
        const text = attachment.sections[args.sectionIndex].slice(
          0,
          args.maxChars ?? 8_000,
        );
        return {
          attachmentId: attachment.id,
          sectionIndex: args.sectionIndex,
          totalSections: attachment.sections.length,
          text,
          contentHash: contentHash(text),
        };
      }
      default:
        throw new Error(
          `Attachment handler does not implement ${input.toolId}`,
        );
    }
  }
}
