import {
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { AgentOsAttachmentService } from './agent-os-attachment.service';
import type { AgentOsProjectContext } from './agent-os-project-context.service';

const PLATFORM_PROJECT = {
  projectId: '11111111-1111-4111-8111-111111111111',
  projectKind: 'platform' as const,
  workspaceId: 'aaaaaaaa-1111-4111-8111-111111111111',
};
const STORY_PROJECT = {
  projectId: '22222222-2222-4222-8222-222222222222',
  projectKind: 'story' as const,
  workspaceId: 'aaaaaaaa-1111-4111-8111-111111111111',
};

type AttachmentCreateInput = {
  data: {
    id: string;
    filename: string;
    mimeType: string;
    sizeBytes: number;
    status: string;
    sections: string[];
    errorMessage: string | null;
    [key: string]: unknown;
  };
};

function makeService(project: AgentOsProjectContext = PLATFORM_PROJECT) {
  const create = jest.fn(({ data }: AttachmentCreateInput) =>
    Promise.resolve({
      ...data,
      createdAt: new Date('2026-08-09T12:00:00.000Z'),
    }),
  );
  const attachment = {
    create,
    findMany: jest.fn().mockResolvedValue([]),
    findFirst: jest.fn(),
  };
  const prisma = { agentOsAttachment: attachment };
  const projects = {
    requireRead: jest.fn().mockResolvedValue(project),
    requireWrite: jest.fn().mockResolvedValue(project),
  };
  const service = new AgentOsAttachmentService(
    prisma as never,
    projects as never,
  );
  return { service, attachment, projects };
}

function textFile(name = 'source.md', text = '# Source\nA scene.') {
  const buffer = Buffer.from(text, 'utf8');
  return {
    originalname: name,
    mimetype: 'text/markdown; charset=utf-8',
    size: buffer.length,
    buffer,
  };
}

describe('AgentOsAttachmentService', () => {
  it('stores a Platform attachment behind the Platform foreign key', async () => {
    const { service, attachment, projects } = makeService(PLATFORM_PROJECT);
    const result = await service.upload(
      'actor-1',
      PLATFORM_PROJECT.projectId,
      textFile(),
    );

    expect(projects.requireWrite).toHaveBeenCalledWith(
      'actor-1',
      PLATFORM_PROJECT.projectId,
    );
    expect(attachment.create).toHaveBeenCalledTimes(1);
    expect(attachment.create.mock.calls[0]?.[0].data).toMatchObject({
      projectKind: 'platform',
      platformProjectId: PLATFORM_PROJECT.projectId,
      storyProjectId: null,
      workspaceId: PLATFORM_PROJECT.workspaceId,
      status: 'ready',
      mimeType: 'text/markdown',
    });
    expect(result).toMatchObject({
      filename: 'source.md',
      status: 'ready',
      sectionCount: 1,
    });
  });

  it('stores a Story attachment behind the Story foreign key', async () => {
    const { service, attachment } = makeService(STORY_PROJECT);
    await service.upload(
      'actor-1',
      STORY_PROJECT.projectId,
      textFile('outline.fdx', '<FinalDraft/>'),
    );

    expect(attachment.create).toHaveBeenCalledTimes(1);
    expect(attachment.create.mock.calls[0]?.[0].data).toMatchObject({
      projectKind: 'story',
      platformProjectId: null,
      storyProjectId: STORY_PROJECT.projectId,
    });
  });

  it('rejects unsupported binary files without persisting failed rows', async () => {
    const { service, attachment } = makeService(STORY_PROJECT);
    await expect(
      service.upload('actor-1', STORY_PROJECT.projectId, {
        originalname: 'reference.png',
        mimetype: 'image/png',
        size: 4,
        buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47]),
      }),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
    expect(attachment.create).not.toHaveBeenCalled();
  });

  it('scopes tool reads to both project kind and project id', async () => {
    const { service, attachment } = makeService(STORY_PROJECT);
    attachment.findFirst.mockResolvedValue({
      id: '33333333-3333-4333-8333-333333333333',
      filename: 'source.md',
      status: 'ready',
      sections: ['one'],
      errorMessage: null,
    });

    await service.getForTool(
      'story',
      STORY_PROJECT.projectId,
      '33333333-3333-4333-8333-333333333333',
    );
    expect(attachment.findFirst).toHaveBeenCalledWith({
      where: {
        id: '33333333-3333-4333-8333-333333333333',
        projectKind: 'story',
        storyProjectId: STORY_PROJECT.projectId,
        platformProjectId: null,
      },
    });
  });

  it('fails a run before dispatch when any attachment is outside its project', async () => {
    const { service, attachment } = makeService(STORY_PROJECT);
    attachment.findMany.mockResolvedValue([
      {
        id: '33333333-3333-4333-8333-333333333333',
        filename: 'source.md',
        status: 'ready',
        errorMessage: null,
      },
    ]);

    await expect(
      service.validateForRun('story', STORY_PROJECT.projectId, [
        '33333333-3333-4333-8333-333333333333',
        '44444444-4444-4444-8444-444444444444',
      ]),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('deduplicates validated attachments while preserving turn order', async () => {
    const { service, attachment } = makeService(STORY_PROJECT);
    const first = '33333333-3333-4333-8333-333333333333';
    const second = '44444444-4444-4444-8444-444444444444';
    attachment.findMany.mockResolvedValue([
      {
        id: second,
        filename: 'second.md',
        status: 'ready',
        errorMessage: null,
      },
      {
        id: first,
        filename: 'first.fountain',
        status: 'ready',
        errorMessage: null,
      },
    ]);

    await expect(
      service.validateForRun('story', STORY_PROJECT.projectId, [
        first,
        second,
        first,
      ]),
    ).resolves.toEqual([
      { id: first, filename: 'first.fountain' },
      { id: second, filename: 'second.md' },
    ]);
  });
});
