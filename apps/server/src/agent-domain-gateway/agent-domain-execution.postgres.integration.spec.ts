import { ConflictException } from '@nestjs/common';
import type { PrismaClient } from '@prisma/client';

import { buildPrisma } from '../infra/db/db.module';
import { AgentDomainExecutionService } from './agent-domain-execution.service';
import { CrewAgentDomainService } from './crew-agent-domain.service';

const describePostgres =
  process.env.AGENT_DOMAIN_POSTGRES_INTEGRATION === '1'
    ? describe
    : describe.skip;

describePostgres('Agent Domain exactly-once PostgreSQL boundary', () => {
  let prisma: PrismaClient;

  beforeAll(async () => {
    prisma = buildPrisma();
    await prisma.$connect();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await prisma.agentDomainCommand.deleteMany({
      where: { scopeKey: 'integration-crew' },
    });
    await prisma.crew.deleteMany({ where: { id: 'integration-crew' } });
    await prisma.crew.create({
      data: {
        id: 'integration-crew',
        name: 'Before',
        description: 'Integration fixture',
        logo: 'https://example.test/logo.png',
        genres: [],
        styles: [],
        founderId: 'actor-1',
      },
    });
  });

  afterEach(async () => {
    await prisma.agentDomainCommand.deleteMany({
      where: { scopeKey: 'integration-crew' },
    });
    await prisma.crew.deleteMany({ where: { id: 'integration-crew' } });
  });

  it('commits a successful mutation and receipt once, then replays it', async () => {
    const crew = {
      applyManagementCommand: jest.fn(async (tx: PrismaClient) => {
        const updated = await tx.crew.update({
          where: { id: 'integration-crew' },
          data: { name: 'After', version: { increment: 1 } },
        });
        return {
          status: 'succeeded' as const,
          revision: updated.version,
          data: { name: updated.name },
        };
      }),
    };
    const service = new AgentDomainExecutionService(
      prisma as never,
      {} as never,
      crew as never,
      {} as never,
    );
    const body = requestBody('First reason');

    const first = await service.execute({
      toolId: 'crew_apply_management_command',
      idempotencyKey: 'integration-command-1',
      body,
    });
    const replay = await service.execute({
      toolId: 'crew_apply_management_command',
      idempotencyKey: 'integration-command-1',
      body,
    });

    expect(first).toMatchObject({ httpStatus: 200, replayed: false });
    expect(replay).toEqual({ ...first, replayed: true });
    expect(crew.applyManagementCommand).toHaveBeenCalledTimes(1);
    await expect(
      prisma.crew.findUniqueOrThrow({
        where: { id: 'integration-crew' },
        select: { name: true, version: true },
      }),
    ).resolves.toEqual({ name: 'After', version: 1 });
    await expect(
      prisma.agentDomainCommand.count({
        where: { idempotencyKey: 'integration-command-1' },
      }),
    ).resolves.toBe(1);
  });

  it('rejects reuse of an idempotency key with different canonical input', async () => {
    const crew = {
      applyManagementCommand: jest.fn(async (tx: PrismaClient) => {
        const updated = await tx.crew.update({
          where: { id: 'integration-crew' },
          data: { version: { increment: 1 } },
        });
        return {
          status: 'succeeded' as const,
          revision: updated.version,
          data: {},
        };
      }),
    };
    const service = new AgentDomainExecutionService(
      prisma as never,
      {} as never,
      crew as never,
      {} as never,
    );
    await service.execute({
      toolId: 'crew_apply_management_command',
      idempotencyKey: 'integration-command-2',
      body: requestBody('First reason'),
    });

    await expect(
      service.execute({
        toolId: 'crew_apply_management_command',
        idempotencyKey: 'integration-command-2',
        body: requestBody('Different reason'),
      }),
    ).resolves.toMatchObject({
      httpStatus: 409,
      replayed: true,
      body: {
        status: 'rejected',
        error: { code: 'AGENT_DOMAIN_IDEMPOTENCY_CONFLICT' },
      },
    });
    expect(crew.applyManagementCommand).toHaveBeenCalledTimes(1);
  });

  it('rolls back both business state and receipt on infrastructure failure', async () => {
    const crew = {
      applyManagementCommand: jest.fn(async (tx: PrismaClient) => {
        await tx.crew.update({
          where: { id: 'integration-crew' },
          data: { name: 'Must roll back', version: { increment: 1 } },
        });
        throw new Error('simulated database dependency failure');
      }),
    };
    const service = new AgentDomainExecutionService(
      prisma as never,
      {} as never,
      crew as never,
      {} as never,
    );

    await expect(
      service.execute({
        toolId: 'crew_apply_management_command',
        idempotencyKey: 'integration-command-3',
        body: requestBody('Rollback'),
      }),
    ).rejects.toThrow('simulated database dependency failure');
    await expect(
      prisma.crew.findUniqueOrThrow({
        where: { id: 'integration-crew' },
        select: { name: true, version: true },
      }),
    ).resolves.toEqual({ name: 'Before', version: 0 });
    await expect(
      prisma.agentDomainCommand.count({
        where: { idempotencyKey: 'integration-command-3' },
      }),
    ).resolves.toBe(0);
  });

  it('rolls back the business state a rejected command already wrote, keeping only the receipt', async () => {
    const crew = {
      applyManagementCommand: jest.fn(async (tx: PrismaClient) => {
        await tx.crew.update({
          where: { id: 'integration-crew' },
          data: { name: 'Half applied', version: { increment: 1 } },
        });
        throw new ConflictException('The command was rejected after writing.');
      }),
    };
    const service = new AgentDomainExecutionService(
      prisma as never,
      {} as never,
      crew as never,
      {} as never,
    );
    const body = requestBody('Rejected after write');

    const first = await service.execute({
      toolId: 'crew_apply_management_command',
      idempotencyKey: 'integration-command-4',
      body,
    });

    expect(first).toMatchObject({
      httpStatus: 409,
      replayed: false,
      body: { status: 'rejected', error: { code: 'AGENT_DOMAIN_CONFLICT' } },
    });
    await expect(
      prisma.crew.findUniqueOrThrow({
        where: { id: 'integration-crew' },
        select: { name: true, version: true },
      }),
    ).resolves.toEqual({ name: 'Before', version: 0 });
    await expect(
      service.execute({
        toolId: 'crew_apply_management_command',
        idempotencyKey: 'integration-command-4',
        body,
      }),
    ).resolves.toEqual({ ...first, replayed: true });
    expect(crew.applyManagementCommand).toHaveBeenCalledTimes(1);
  });

  it('leaves a Crew application pending when the position can no longer be filled', async () => {
    await prisma.crewPosition.create({
      data: {
        id: 'integration-position',
        crewId: 'integration-crew',
        positionType: 'director',
        description: 'Director',
        targetCount: 1,
        recruitedCount: 1,
        status: 'full',
      },
    });
    await prisma.crewApplication.create({
      data: {
        id: 'integration-application',
        crewId: 'integration-crew',
        positionId: 'integration-position',
        applicantId: 'applicant-1',
      },
    });
    const service = new AgentDomainExecutionService(
      prisma as never,
      {} as never,
      new CrewAgentDomainService({ send: jest.fn() } as never) as never,
      {} as never,
    );

    await expect(
      service.execute({
        toolId: 'crew_apply_management_command',
        idempotencyKey: 'integration-command-5',
        body: approveApplicationBody(await currentCrewVersion(prisma)),
      }),
    ).resolves.toMatchObject({
      httpStatus: 409,
      replayed: false,
      body: { status: 'rejected' },
    });
    await expect(
      prisma.crewApplication.findUniqueOrThrow({
        where: { id: 'integration-application' },
        select: { status: true, reviewedAt: true, reviewerId: true },
      }),
    ).resolves.toEqual({
      status: 'pending',
      reviewedAt: null,
      reviewerId: null,
    });
    await expect(
      prisma.crewMember.count({ where: { crewId: 'integration-crew' } }),
    ).resolves.toBe(0);
    await expect(
      prisma.crewPosition.findUniqueOrThrow({
        where: { id: 'integration-position' },
        select: { recruitedCount: true },
      }),
    ).resolves.toEqual({ recruitedCount: 1 });
    await expect(
      prisma.agentDomainCommand.findUniqueOrThrow({
        where: { idempotencyKey: 'integration-command-5' },
        select: { httpStatus: true },
      }),
    ).resolves.toEqual({ httpStatus: 409 });
  });

  it('bumps Crew revision for every authoritative child-table mutation', async () => {
    await prisma.crewPosition.create({
      data: {
        id: 'integration-position',
        crewId: 'integration-crew',
        positionType: 'director',
        description: 'Director',
        targetCount: 1,
      },
    });
    await expect(currentCrewVersion(prisma)).resolves.toBe(1);

    await prisma.crewPosition.update({
      where: { id: 'integration-position' },
      data: { description: 'Lead director' },
    });
    await expect(currentCrewVersion(prisma)).resolves.toBe(2);

    await prisma.crewPosition.delete({
      where: { id: 'integration-position' },
    });
    await expect(currentCrewVersion(prisma)).resolves.toBe(3);
  });
});

function requestBody(reason: string) {
  return {
    schemaVersion: 'agent-tool-request/v2',
    arguments: {
      schemaVersion: 'crew-management-command/v2',
      baseRevision: 0,
      reason,
      command: {
        type: 'crew.listing.update',
        listingStatus: 'listed',
      },
    },
    actor: {
      id: 'actor-1',
      displayName: 'Actor One',
      roles: ['crew.admin'],
      permissions: ['crew.read', 'crew.manage'],
    },
    scope: {
      surface: 'crew-management',
      conversationId: '0197f4a2-0800-7000-8000-000000000004',
      sessionName: 'agent:v1:conversation:0197f4a2-0800-7000-8000-000000000004',
      kind: 'crew',
      crewId: 'integration-crew',
    },
  };
}

function approveApplicationBody(baseRevision: number) {
  return {
    ...requestBody('Approve the pending application'),
    arguments: {
      schemaVersion: 'crew-management-command/v2',
      baseRevision,
      reason: 'Approve the pending application',
      command: {
        type: 'crew.application.approve',
        applicationId: 'integration-application',
      },
    },
  };
}

async function currentCrewVersion(prisma: PrismaClient): Promise<number> {
  return (
    await prisma.crew.findUniqueOrThrow({
      where: { id: 'integration-crew' },
      select: { version: true },
    })
  ).version;
}
