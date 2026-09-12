import { createHash } from 'node:crypto';
import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  Prisma,
  WalletAccountStatus,
  WalletBalanceKind,
  WalletCurrencyType,
  WalletOwnerType,
} from '@prisma/client';
import {
  ExperienceRuntimeManifestSchema,
  type ExperienceAccessRequirement,
  type ExperienceRuntimeManifest,
} from '@repo/shared/experience-runtime';
import type { AuthUser } from '../auth';
import { requireModerationApproval } from '../media/media-moderation-policy';
import { PrismaService } from '../infra/db/db.module';
import {
  WalletLedgerService,
  expireLapsedGrantsTx,
} from '../workspaces/wallet-ledger.service';

const SOURCE = 'story_content_purchase';

/** The posted purchase journal is the durable receipt: one entry per viewer,
 * project and authored key, across all releases. No second balance or order ledger. */
export function storyPurchaseKey(
  userId: string,
  projectId: string,
  key: string,
): string {
  return `${SOURCE}:${createHash('sha256')
    .update(JSON.stringify([userId, projectId, key]))
    .digest('hex')}`;
}

export function storyAccessRequirements(
  manifest: ExperienceRuntimeManifest,
): ExperienceAccessRequirement[] {
  const requirements = new Map<string, ExperienceAccessRequirement>();
  for (const node of manifest.graph.nodes) {
    for (const access of [
      node.access,
      ...node.eventBindings.flatMap((binding) =>
        binding.routes.map((route) => route.access),
      ),
    ]) {
      if (access) requirements.set(access.key, access);
    }
  }
  return [...requirements.values()];
}

@Injectable()
export class StoryCommunityAccessService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: WalletLedgerService,
  ) {}

  private async loadRelease(projectId: string, buildId: string) {
    const build = await this.prisma.storyBuild.findFirst({
      where: {
        id: buildId,
        storyProjectId: projectId,
        status: 'ready',
        runtimeSchemaVersion: 2,
      },
      include: {
        project: true,
        assets: {
          include: {
            asset: { include: { placements: true } },
            variant: { include: { placements: true } },
          },
        },
        experiencePublication: true,
        experienceDraftRelease: true,
        gameReleaseChapters: { include: { release: true } },
      },
    });
    if (!build) throw new NotFoundException('Story release not found.');
    const authorized =
      (build.experiencePublication?.mediaAuthorizedAt &&
        !build.experiencePublication.mediaAuthorizationRevokedAt) ||
      (build.experienceDraftRelease &&
        build.experienceDraftRelease.status !== 'rejected') ||
      build.gameReleaseChapters.some(
        (chapter) =>
          chapter.release.status !== 'rejected' &&
          !chapter.release.mediaAuthorizationRevokedAt,
      );
    if (!authorized)
      throw new NotFoundException('Story release is not available.');
    const manifest = ExperienceRuntimeManifestSchema.parse(build.runtimeJson);
    const requirements = storyAccessRequirements(manifest);
    if (requirements.length) {
      for (const frozen of build.assets) {
        const asset = frozen.asset;
        const variant = frozen.variant;
        const active = [
          ...variant.placements,
          ...(variant.variantKey === 'original' ? asset.placements : []),
        ].filter(
          (placement) => placement.status === 'active' && !placement.deletedAt,
        );
        if (
          asset.status !== 'ready' ||
          variant.status !== 'ready' ||
          asset.deletedAt ||
          variant.deletedAt ||
          (requireModerationApproval() && asset.moderationStatus !== 'approved')
        ) {
          throw new ConflictException(
            'The story media is unavailable. No points have been charged.',
          );
        }
        // Proxy only managed storage origins, never creator-supplied external URLs.
        if (
          active.some(
            (placement) => placement.storageProvider === 'external_url',
          ) ||
          (!active.length &&
            (variant.variantKey !== 'original' ||
              asset.storageProvider === 'external_url' ||
              !asset.bucket ||
              !asset.objectKey))
        ) {
          throw new ConflictException(
            'Paid story media must be stored in managed storage before it can be unlocked.',
          );
        }
      }
    }
    return { build, manifest, requirements };
  }

  async ownedKeys(
    userId: string | undefined,
    projectId: string,
    requirements: ExperienceAccessRequirement[],
  ): Promise<string[]> {
    if (!userId || requirements.length === 0) return [];
    const keys = requirements.map((access) =>
      storyPurchaseKey(userId, projectId, access.key),
    );
    const rows = await this.prisma.walletTransaction.findMany({
      where: {
        idempotencyKey: { in: keys },
        status: 'posted',
        sourceType: SOURCE,
        actorUserId: userId,
      },
      select: { idempotencyKey: true },
    });
    const purchased = new Set(rows.map((row) => row.idempotencyKey));
    return requirements
      .filter((access) =>
        purchased.has(storyPurchaseKey(userId, projectId, access.key)),
      )
      .map((access) => access.key);
  }

  async quote(user: AuthUser | undefined, projectId: string, buildId: string) {
    const { build, requirements } = await this.loadRelease(projectId, buildId);
    const ownedKeys =
      user?.userId === build.project.createdByUserId
        ? requirements.map((access) => access.key)
        : await this.ownedKeys(user?.userId, projectId, requirements);
    let balance: string | null = null;
    if (user) {
      const accounts = await this.ledger.ensureDefaultAccounts(
        WalletOwnerType.user,
        user.userId,
      );
      const account = accounts.find(
        (account) => account.balanceKind === 'consumable',
      )!;
      await this.ledger.expireLapsedGrants(account.id);
      balance = (
        await this.prisma.walletAccount.findUniqueOrThrow({
          where: { id: account.id },
        })
      ).availableBalance.toString();
    }
    return { requirements, ownedKeys, balance, authenticated: Boolean(user) };
  }

  async purchase(
    user: AuthUser,
    projectId: string,
    buildId: string,
    input: { key: string; expectedPrice: number },
  ) {
    const { build, requirements } = await this.loadRelease(projectId, buildId);
    const access = requirements.find(
      (requirement) => requirement.key === input.key,
    );
    if (!access)
      throw new NotFoundException('This paid node is not part of the release.');
    if (user.userId === build.project.createdByUserId)
      return { key: access.key, alreadyOwned: true };
    const idempotencyKey = storyPurchaseKey(user.userId, projectId, access.key);
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${idempotencyKey})::bigint)`;
      const existing = await tx.walletTransaction.findUnique({
        where: { idempotencyKey },
      });
      if (existing?.status === 'posted')
        return { key: access.key, alreadyOwned: true };
      if (existing)
        throw new ConflictException(
          'This purchase has been reversed and cannot be replayed.',
        );
      if (access.communityPointPrice !== input.expectedPrice)
        throw new ConflictException({
          code: 'STORY_PRICE_CHANGED',
          message: 'The price changed. Review it before unlocking.',
        });
      const buyer = await ensureAccount(
        tx,
        user.userId,
        WalletBalanceKind.consumable,
      );
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`wallet:account:${buyer.id}`})::bigint)`;
      await expireLapsedGrantsTx(tx, buyer.id);
      const amount = BigInt(access.communityPointPrice);
      const receipt = await this.ledger.postEntryTx(tx, {
        accountId: buyer.id,
        entryType: 'debit',
        amount,
        availableDelta: -amount,
        heldDelta: 0n,
        reason: SOURCE,
        sourceType: SOURCE,
        sourceId: buildId,
        actorUserId: user.userId,
        idempotencyKey,
        description: 'Interactive film unlock',
        metadata: {
          projectId,
          buildId,
          accessKey: access.key,
          title: access.title,
          communityPointPrice: access.communityPointPrice,
        },
      });
      // Story ownership is pinned to the creator. Source IP and collaborators
      // do not participate in story earnings: the owner receives the full price.
      const ownerUserId = build.project.createdByUserId;
      const ownerAccount = await ensureAccount(
        tx,
        ownerUserId,
        WalletBalanceKind.withdrawable,
      );
      await this.ledger.postEntryTx(tx, {
        accountId: ownerAccount.id,
        entryType: 'credit',
        amount,
        availableDelta: amount,
        heldDelta: 0n,
        reason: 'story_content_revenue',
        sourceType: 'story_content_revenue',
        sourceId: receipt.transaction.id,
        idempotencyKey: `${receipt.transaction.id}:revenue:${ownerUserId}`,
        actorUserId: user.userId,
        description: 'Interactive film revenue',
        metadata: {
          projectId,
          buildId,
          accessKey: access.key,
          purchaseId: receipt.transaction.id,
          ownerUserId,
        },
      });
      return { key: access.key, alreadyOwned: false };
    });
  }

  async requireAssetAccess(
    user: AuthUser | undefined,
    projectId: string,
    buildId: string,
    assetId: string,
    variantId: string,
  ): Promise<void> {
    const { build, manifest, requirements } = await this.loadRelease(
      projectId,
      buildId,
    );
    if (!requirements.length || user?.userId === build.project.createdByUserId)
      return;
    const owned = new Set(
      await this.ownedKeys(user?.userId, projectId, requirements),
    );
    const reachable = reachableStoryScenes(manifest, owned);
    const targetAssets = manifest.assets.filter((asset) =>
      JSON.stringify(asset).includes(
        `/assets/${assetId}/variants/${variantId}/content`,
      ),
    );
    const contentAssets = targetAssets.filter(
      (asset) => asset.kind === 'video' || asset.kind === 'image',
    );
    if (!targetAssets.length)
      throw new ForbiddenException({
        code: 'STORY_CONTENT_LOCKED',
        message: 'This media is not part of the released story.',
      });
    if (!contentAssets.length) return;
    const allowed = manifest.graph.nodes.some(
      (node) =>
        reachable.has(node.sceneId) &&
        node.kind === 'scene' &&
        contentAssets.some((asset) =>
          JSON.stringify(node.renderers).includes(
            JSON.stringify(asset.assetId),
          ),
        ),
    );
    if (!allowed)
      throw new ForbiddenException({
        code: 'STORY_CONTENT_LOCKED',
        message: 'Unlock this content with Community Points before playing.',
      });
  }
}

export function reachableStoryScenes(
  manifest: ExperienceRuntimeManifest,
  owned: ReadonlySet<string>,
): Set<string> {
  const seen = new Set<string>();
  const pending = [manifest.graph.entrySceneId];
  while (pending.length) {
    const id = pending.pop()!;
    if (seen.has(id)) continue;
    const node = manifest.graph.nodes.find((node) => node.sceneId === id);
    if (!node || (node.access && !owned.has(node.access.key))) continue;
    seen.add(id);
    for (const binding of node.eventBindings)
      for (const route of binding.routes) {
        if (route.access && !owned.has(route.access.key)) continue;
        for (const action of route.actions)
          if (action.kind === 'scene.goto') pending.push(action.sceneId);
      }
  }
  return seen;
}

function ensureAccount(
  tx: Prisma.TransactionClient,
  userId: string,
  balanceKind: WalletBalanceKind,
) {
  const identity = {
    ownerType: WalletOwnerType.user,
    ownerId: userId,
    currency: WalletCurrencyType.community_point,
    balanceKind,
  };
  return tx.walletAccount.upsert({
    where: { ownerType_ownerId_currency_balanceKind: identity },
    create: { ...identity, status: WalletAccountStatus.active },
    update: {},
  });
}
