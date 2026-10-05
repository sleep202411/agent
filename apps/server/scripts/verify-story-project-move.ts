/** Run against a migrated, isolated LOCAL database. Never contacts AI providers. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { AiGenerationBillingWalletService } from '../src/ai-generation/billing-wallet.service';
import { PrismaService } from '../src/infra/db/db.module';
import { StoryProjectsService } from '../src/story-studio/story-projects.service';
import { StoryProjectMoveService } from '../src/story-studio/story-project-move.service';
import { StoryPermissionService } from '../src/story-studio/story-permission.service';
import { StoryProjectWriteGuardService } from '../src/story-studio/story-project-write-guard.service';
import { WorkspacePermissionService } from '../src/workspaces/workspace-permission.service';
import { CrewAssetAccessService } from '../src/crews/assets/asset-access.service';
import { CrewAuthorizationService } from '../src/crews/crew-authorization.service';
import { StudioDocumentAccessService } from '../src/documents/studio-document-access.service';
import { MediaAccessService } from '../src/media/media-access.service';
import { CreateStoryProjectSchema } from '../src/story-studio/dto';
import { BillingService } from '../src/billing/billing.service';
import { CreateAdminWorkspaceWalletCreditSchema } from '../src/billing/dto';
import { WalletLedgerService } from '../src/workspaces/wallet-ledger.service';
import { Prisma, type AiJobStatus } from '@prisma/client';

async function main() {
  const url = new URL(process.env.DATABASE_URL ?? '');
  assert(
    ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname),
    'Local database required',
  );
  assert(
    url.pathname.endsWith('_workspace_preview'),
    'Use the isolated workspace preview database',
  );
  const p = new PrismaService();
  const owner = `move-owner-${randomUUID()}`;
  const direct = `move-direct-${randomUUID()}`;
  const sourcePeer = `move-source-${randomUUID()}`;
  const targetPeer = `move-target-${randomUUID()}`;
  const guard = new StoryProjectWriteGuardService(p);
  const permissions = new StoryPermissionService(p, guard);
  const workspacePermissions = new WorkspacePermissionService(p);
  const walletLedger = new WalletLedgerService(p);
  const billing = new BillingService(
    p,
    {} as never,
    workspacePermissions,
    walletLedger,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  );
  const media = new MediaAccessService(
    p,
    {} as never,
    workspacePermissions,
    new CrewAssetAccessService(p, new CrewAuthorizationService(p)),
    new StudioDocumentAccessService(p, workspacePermissions, permissions),
  );
  const projects = new StoryProjectsService(
    p,
    permissions,
    workspacePermissions,
    guard,
    media,
  );
  const revoked: string[] = [];
  const docRevocations: string[] = [];
  const moves = new StoryProjectMoveService(
    p,
    permissions,
    guard,
    {
      revokeUserFromDocuments: (_ids: string[], user: string) => {
        docRevocations.push(user);
        return Promise.resolve();
      },
    } as never,
    {
      revokeStoryProjectAccess: (id: string) => {
        revoked.push(id);
        return Promise.resolve();
      },
    } as never,
  );
  try {
    const source = await p.workspace.create({
      data: {
        name: 'Move verification source',
        ownerUserId: owner,
        createdById: owner,
        members: {
          create: [
            { userId: owner, role: 'owner' },
            { userId: sourcePeer, role: 'admin' },
            { userId: direct, role: 'viewer', accessScope: 'project_only' },
          ],
        },
      },
    });
    const target = await p.workspace.create({
      data: {
        name: 'Move verification destination',
        ownerUserId: owner,
        createdById: owner,
        members: {
          create: [
            { userId: owner, role: 'owner' },
            { userId: targetPeer, role: 'editor' },
            { userId: sourcePeer, role: 'admin' },
          ],
        },
      },
    });
    // sourcePeer can administer both workspaces, but isn't the project owner.
    const create = () =>
      projects.create(
        { userId: owner } as never,
        CreateStoryProjectSchema.parse({
          workspaceId: source.id,
          title: 'Move verification Story',
          defaultLocale: 'en-US',
        }),
      );
    const wb = await create();
    const projectId = wb.project.id;
    await p.storyProjectMember.create({
      data: {
        storyProjectId: projectId,
        userId: direct,
        role: 'editor',
        grantedByUserId: owner,
      },
    });
    const doc = await p.studioDocument.findFirstOrThrow({
      where: { storyProjectId: projectId },
    });
    const asset = await p.mediaAsset.create({
      data: {
        kind: 'image',
        storageProvider: 'external_url',
        externalUrl: `https://example.invalid/${owner}/move-test.png`,
        workspaceId: source.id,
        visibility: 'private',
        status: 'ready',
        moderationStatus: 'approved',
        createdByUserId: owner,
      },
    });
    await projects.addCandidateAsset(
      { userId: owner } as never,
      projectId,
      asset.id,
    );
    await p.storyProject.update({
      where: { id: projectId },
      data: { coverAssetId: asset.id },
    });
    const wallet = await p.walletAccount.create({
      data: {
        ownerType: 'workspace',
        ownerId: source.id,
        currency: 'compute_point',
        availableBalance: 1000n,
      },
    });
    const jobData = (
      workspaceId: string,
      status: AiJobStatus = 'created',
    ): Prisma.AiJobUncheckedCreateInput => ({
      id: randomUUID(),
      userId: owner,
      workspaceId,
      storyProjectId: projectId,
      documentId: doc.id,
      billingSubjectType: 'workspace',
      billingSubjectId: workspaceId,
      type: 'image',
      provider: 'local-test',
      modelId: 'local-test',
      deployment: 'local-test',
      schemaVersion: '1',
      status,
      stage: 'queued',
      queueName: 'local-test',
      prompt: 'No provider request',
      idempotencyKey: randomUUID(),
      input: {},
      normalizedInput: {},
      logs: [],
      metrics: {},
    });
    const history = await p.aiJob.create({
      data: jobData(source.id, 'completed'),
    });
    await p.aiJobOutput.create({
      data: {
        id: randomUUID(),
        jobId: history.id,
        assetId: asset.id,
        type: 'image',
        url: `https://example.invalid/${owner}/move-test.png`,
        storagePath: 'local-test',
        outputIndex: 0,
      },
    });
    const input = {
      targetWorkspaceId: target.id,
      expectedWorkspaceId: source.id,
      expectedProjectVersion: wb.project.projectVersion,
    };
    const reject = (run: () => Promise<unknown>, status: number) =>
      assert.rejects(
        run,
        (error: { getStatus?: () => number }) => error.getStatus?.() === status,
      );
    await reject(
      () => moves.move({ userId: sourcePeer } as never, projectId, input),
      403,
    );
    await reject(
      () =>
        moves.move({ userId: owner } as never, projectId, {
          ...input,
          expectedProjectVersion: 999,
        }),
      409,
    );
    const pending = await p.aiJob.create({ data: jobData(source.id) });
    await reject(
      () => moves.move({ userId: owner } as never, projectId, input),
      409,
    );
    assert.equal(
      (await p.storyProject.findUniqueOrThrow({ where: { id: projectId } }))
        .workspaceId,
      source.id,
    );
    await p.aiJob.update({
      where: { id: pending.id },
      data: { status: 'cancelled' },
    });
    // A failed audit write must roll the entire move (including roster) back.
    const rollbackDb = {} as typeof p;
    rollbackDb.$transaction = ((
      fn: (tx: Prisma.TransactionClient) => Promise<unknown>,
    ) =>
      p.$transaction(async (tx) => {
        const proxy = new Proxy(tx, {
          get(obj, key) {
            return key === 'platformAuditLog'
              ? {
                  create: () => {
                    throw new Error('forced rollback');
                  },
                }
              : (Reflect.get(obj, key) as unknown);
          },
        });
        return fn(proxy);
      })) as typeof p.$transaction;
    const rollbackMove = new StoryProjectMoveService(
      rollbackDb,
      permissions,
      guard,
      {} as never,
      {} as never,
    );
    await assert.rejects(
      () => rollbackMove.move({ userId: owner } as never, projectId, input),
      /forced rollback/,
    );
    assert.equal(
      (await p.studioDocument.findUniqueOrThrow({ where: { id: doc.id } }))
        .workspaceId,
      source.id,
    );
    assert.equal(
      await p.workspaceMember.count({
        where: { workspaceId: target.id, userId: direct },
      }),
      0,
    );
    console.log(
      'PASS owner-only, stale version, active task blocking and atomic rollback',
    );

    await moves.move({ userId: owner } as never, projectId, input);
    const moved = await projects.workbench(
      { userId: owner } as never,
      projectId,
      {} as never,
    );
    assert.equal(moved.project.id, projectId);
    assert.equal(moved.project.workspaceId, target.id);
    assert.equal(moved.project.canMove, true);
    assert.equal(moved.project.cover?.id, asset.id);
    assert.equal(
      (await p.studioDocument.findUniqueOrThrow({ where: { id: doc.id } }))
        .workspaceId,
      target.id,
    );
    assert.equal(
      (await p.mediaAsset.findUniqueOrThrow({ where: { id: asset.id } }))
        .workspaceId,
      source.id,
    );
    assert.equal(
      (await p.aiJob.findUniqueOrThrow({ where: { id: history.id } }))
        .workspaceId,
      source.id,
    );
    assert.equal(
      (await p.aiJob.findUniqueOrThrow({ where: { id: history.id } }))
        .billingSubjectId,
      source.id,
    );
    assert.equal(
      (await p.walletAccount.findUniqueOrThrow({ where: { id: wallet.id } }))
        .availableBalance,
      1000n,
    );
    // A stale direct viewer grant cannot downgrade the destination editor.
    await p.storyProjectMember.create({
      data: {
        storyProjectId: projectId,
        userId: targetPeer,
        role: 'viewer',
        grantedByUserId: owner,
      },
    });
    await permissions.requireProject(targetPeer, projectId, 'story.generate');
    await p.$transaction((tx) =>
      permissions.requireProjectInTransaction(
        tx,
        targetPeer,
        projectId,
        'story.edit',
      ),
    );
    await permissions.requireProject(direct, projectId, 'story.edit');
    const roster = await p.workspaceMember.findFirstOrThrow({
      where: { workspaceId: target.id, userId: direct, removedAt: null },
    });
    assert.equal(roster.accessScope, 'project_only');
    assert.equal(
      await p.workspaceMember.count({
        where: { workspaceId: source.id, userId: direct, removedAt: null },
      }),
      0,
    );
    // Remove the source peer's independent destination membership to isolate inherited access.
    await p.workspaceMember.updateMany({
      where: { workspaceId: target.id, userId: sourcePeer },
      data: { status: 'removed', removedAt: new Date() },
    });
    await reject(
      () => permissions.requireProject(sourcePeer, projectId, 'story.read'),
      404,
    );
    assert.deepEqual(revoked, [projectId]);
    assert(docRevocations.includes(sourcePeer));
    await media.requireUseAccessById(targetPeer, asset.id);
    await media.requireUseAccessById(direct, asset.id);
    const stranger = `move-stranger-${randomUUID()}`;
    await reject(() => media.requireUseAccessById(stranger, asset.id), 403);
    const unrelated = await p.mediaAsset.create({
      data: {
        kind: 'image',
        storageProvider: 'external_url',
        externalUrl: `https://example.invalid/${owner}/unrelated.png`,
        workspaceId: source.id,
        visibility: 'private',
        status: 'ready',
        moderationStatus: 'approved',
        createdByUserId: sourcePeer,
      },
    });
    await reject(
      () =>
        projects.addCandidateAsset(
          { userId: targetPeer } as never,
          projectId,
          unrelated.id,
        ),
      403,
    );
    await assert.rejects(
      () => p.aiJob.create({ data: jobData(source.id) }),
      /STORY_PROJECT_MOVED/,
    );
    const next = await p.aiJob.create({ data: jobData(target.id) });
    assert.equal(next.billingSubjectId, target.id);
    const grantInput = CreateAdminWorkspaceWalletCreditSchema.parse({
      workspaceId: target.id,
      amount: '1000',
      reason: 'Local workspace billing verification',
      idempotencyKey: randomUUID(),
    });
    const granted = await billing.createAdminWorkspaceWalletCredit(
      owner,
      grantInput,
    );
    assert.equal(granted.account.ownerId, target.id);
    assert.equal(granted.account.availableBalance, '1000');
    // A lost admin response and retry must not credit twice.
    assert.equal(
      (await billing.createAdminWorkspaceWalletCredit(owner, grantInput))
        .account.availableBalance,
      '1000',
    );
    const expiring = await billing.createAdminWorkspaceWalletCredit(owner, {
      ...grantInput,
      amount: 200n,
      idempotencyKey: randomUUID(),
      expiresAt: new Date(Date.now() + 60_000),
    });
    await p.walletCreditGrant.updateMany({
      where: { accountId: expiring.account.id, expiresAt: { not: null } },
      data: {
        validFrom: new Date(Date.now() - 60_000),
        expiresAt: new Date(Date.now() - 1000),
      },
    });
    const listed = await billing.listAdminWorkspaces({
      query: target.id,
      limit: 20,
    });
    assert.equal(listed.items[0]?.availableBalance, '1000');
    assert.equal(listed.items[0]?.memberCount, 3);
    assert.equal(
      (await billing.getComputeBalance({ userId: targetPeer }, target.id))
        .available,
      '1000',
    );
    assert.equal(
      (await billing.getComputeBalance({ userId: direct }, target.id))
        .available,
      '1000',
    );
    await reject(
      () => billing.getComputeBalance({ userId: sourcePeer }, target.id),
      403,
    );
    await billing.createAdminWorkspaceWalletCredit(owner, {
      ...grantInput,
      amount: -100n,
      idempotencyKey: randomUUID(),
    });
    await assert.rejects(() =>
      billing.createAdminWorkspaceWalletCredit(owner, {
        ...grantInput,
        amount: -10000n,
        idempotencyKey: randomUUID(),
      }),
    );
    assert.equal(
      (await billing.getComputeBalance({ userId: targetPeer }, target.id))
        .available,
      '900',
    );
    const charging = new AiGenerationBillingWalletService(p, walletLedger);
    const chargedJob = {
      ...next,
      routingSnapshot: { policy: { quota: { mode: 'metered', cost: 50 } } },
    } as never;
    await p.$transaction((tx) =>
      charging.reserveForJobInTransaction({ tx, job: chargedJob }),
    );
    const heldBalance = await billing.getComputeBalance(
      { userId: targetPeer },
      target.id,
    );
    assert.equal(heldBalance.available, '850');
    assert.equal(heldBalance.held, '50');
    await charging.settleForJob(chargedJob);
    await charging.settleForJob(chargedJob);
    const settled = await billing.getComputeBalance(
      { userId: targetPeer },
      target.id,
    );
    assert.equal(settled.available, '850');
    assert.equal(settled.held, '0');
    assert.equal(
      (await p.walletAccount.findUniqueOrThrow({ where: { id: wallet.id } }))
        .availableBalance,
      1000n,
    );
    assert(
      (await p.aiEventOutbox.count({
        where: {
          channel: `wallet:workspace:${target.id}`,
          eventType: 'wallet_changed',
        },
      })) > 0,
    );
    console.log(
      'PASS admin grant/retry/debit, expiry, creator balance/access, generation hold/settle and wallet events',
    );
    assert.deepEqual(
      await new AiGenerationBillingWalletService(
        p,
        {} as never,
      ).resolveStoryProjectPayer(projectId),
      { type: 'workspace', id: target.id },
    );
    await p.aiJob.update({
      where: { id: next.id },
      data: { status: 'cancelled' },
    });
    await assert.rejects(
      () =>
        p.aiJob.update({
          where: { id: pending.id },
          data: { status: 'in_queue' },
        }),
      /STORY_PROJECT_MOVED/,
    );
    await reject(
      () => moves.move({ userId: owner } as never, projectId, input),
      409,
    );
    console.log(
      'PASS content/documents, direct/inherited access, media reuse, historical wallet and new payer',
    );
    console.log(
      'PASS stale admission, old-job resume and duplicate move rejected',
    );
    const deferred = () => {
      let resolve!: () => void;
      const promise = new Promise<void>((done) => {
        resolve = done;
      });
      return { promise, resolve };
    };
    const back = {
      targetWorkspaceId: source.id,
      expectedWorkspaceId: target.id,
      expectedProjectVersion: moved.project.projectVersion,
    };
    const admitted = deferred(),
      releaseAdmission = deferred();
    let racingJobId = '';
    const admission = p.$transaction(async (tx) => {
      const job = await tx.aiJob.create({ data: jobData(target.id) });
      racingJobId = job.id;
      admitted.resolve();
      await releaseAdmission.promise;
    });
    await admitted.promise;
    const blockedMove = reject(
      () => moves.move({ userId: owner } as never, projectId, back),
      409,
    );
    releaseAdmission.resolve();
    await admission;
    await blockedMove;
    await p.aiJob.update({
      where: { id: racingJobId },
      data: { status: 'cancelled' },
    });

    const movedBeforeCommit = deferred(),
      releaseMove = deferred();
    const raceDb = {
      $transaction: (fn: (tx: Prisma.TransactionClient) => Promise<unknown>) =>
        p.$transaction(async (tx) => {
          const result = await fn(tx);
          movedBeforeCommit.resolve();
          await releaseMove.promise;
          return result;
        }),
    } as typeof p;
    const raceMove = new StoryProjectMoveService(
      raceDb,
      permissions,
      guard,
      { revokeUserFromDocuments: async () => {} } as never,
      { revokeStoryProjectAccess: async () => {} } as never,
    );
    const moving = raceMove.move({ userId: owner } as never, projectId, back);
    await movedBeforeCommit.promise;
    const rejectedAdmission = assert.rejects(
      () => p.aiJob.create({ data: jobData(target.id) }),
      /STORY_PROJECT_MOVED/,
    );
    releaseMove.resolve();
    await moving;
    await rejectedAdmission;
    assert.equal(
      (await p.storyProject.findUniqueOrThrow({ where: { id: projectId } }))
        .workspaceId,
      source.id,
    );
    console.log(
      'PASS concurrent admission before move blocks move; admission after move rejects stale payer',
    );
  } finally {
    await p.$disconnect();
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
