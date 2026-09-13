import {
  ConflictException,
  GoneException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  CreditCampaignStatus,
  Prisma,
  WalletAccountStatus,
  WalletBalanceKind,
  WalletCreditGrantType,
  WalletCurrencyType,
  WalletLedgerEntryType,
  WalletOwnerType,
  type CreditCampaign,
} from '@prisma/client';
import type { AuthUser } from '../auth';
import { PrismaService } from '../infra/db/db.module';
import { WalletLedgerService } from '../workspaces';
import { promoCreditExpiresAt } from './credit-policy';
import type {
  CreateCreditCampaignInput,
  ListCreditCampaignsQuery,
  UpdateCreditCampaignStatusInput,
} from './dto';

function isUniqueViolation(err: unknown): boolean {
  return (
    err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002'
  );
}

/**
 * Claimable free-credits campaigns (date-windowed giveaway). Any eligible user
 * claims once during the window — distinct from a Voucher (a single code). Claim
 * is financial-grade:
 *
 *   1. one-per-user — the CreditCampaignClaim unique index makes the claim insert
 *      the atomic guard (a concurrent second claim by the same user hits P2002).
 *   2. budget cap — a raw conditional `claim_count + 1 WHERE claim_count < max`
 *      (row-locked) in the SAME tx as the insert; if exhausted the insert rolls back.
 *   3. credit — walletLedger.postEntry keyed by the claim id (no double-credit;
 *      a same-user re-claim recovers a crash between claim and credit).
 */
@Injectable()
export class CampaignService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly walletLedger: WalletLedgerService,
  ) {}

  // --- admin ---------------------------------------------------------------

  async createCampaign(adminId: string, input: CreateCreditCampaignInput) {
    const campaign = await this.prisma.creditCampaign.create({
      data: {
        name: input.name,
        description: input.description ?? null,
        computeCreditAmount: input.computeCreditAmount,
        status: input.status as CreditCampaignStatus,
        startsAt: input.startsAt ?? null,
        endsAt: input.endsAt ?? null,
        maxClaims: input.maxClaims ?? null,
        note: input.note ?? null,
        createdById: adminId,
      },
    });
    return this.campaignDto(campaign);
  }

  async listCampaigns(query: ListCreditCampaignsQuery) {
    const where: Prisma.CreditCampaignWhereInput = {};
    if (query.status) where.status = query.status as CreditCampaignStatus;
    const rows = await this.prisma.creditCampaign.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 200,
    });
    return { items: rows.map((c) => this.campaignDto(c)) };
  }

  async updateCampaignStatus(
    campaignId: string,
    status: UpdateCreditCampaignStatusInput['status'],
  ) {
    const existing = await this.prisma.creditCampaign.findUnique({
      where: { id: campaignId },
    });
    if (!existing) {
      throw new NotFoundException({
        code: 'CREDIT_CAMPAIGN_NOT_FOUND',
        msg: 'Campaign not found.',
      });
    }
    const updated = await this.prisma.creditCampaign.update({
      where: { id: campaignId },
      data: { status: status as CreditCampaignStatus },
    });
    return this.campaignDto(updated);
  }

  // --- user ----------------------------------------------------------------

  /** Active, in-window campaigns + whether the caller has already claimed each. */
  async listActiveCampaignsForUser(user: AuthUser) {
    const userId = String(user.userId);
    const now = new Date();
    const campaigns = await this.prisma.creditCampaign.findMany({
      where: {
        status: CreditCampaignStatus.active,
        AND: [
          { OR: [{ startsAt: null }, { startsAt: { lte: now } }] },
          { OR: [{ endsAt: null }, { endsAt: { gt: now } }] },
        ],
      },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });
    if (campaigns.length === 0) return { items: [] };
    const claims = await this.prisma.creditCampaignClaim.findMany({
      where: { userId, campaignId: { in: campaigns.map((c) => c.id) } },
      select: { campaignId: true },
    });
    const claimed = new Set(claims.map((c) => c.campaignId));
    return {
      items: campaigns
        // Hide exhausted campaigns the user can't claim; keep ones they claimed.
        .filter(
          (c) =>
            claimed.has(c.id) ||
            c.maxClaims == null ||
            c.claimCount < c.maxClaims,
        )
        .map((c) => ({ ...this.campaignDto(c), claimed: claimed.has(c.id) })),
    };
  }

  async claimCampaign(user: AuthUser, campaignId: string) {
    const userId = String(user.userId);
    const now = new Date();

    const campaign = await this.prisma.creditCampaign.findUnique({
      where: { id: campaignId },
    });
    if (!campaign) {
      throw new NotFoundException({
        code: 'CREDIT_CAMPAIGN_NOT_FOUND',
        msg: 'Campaign not found.',
      });
    }
    if (campaign.status !== CreditCampaignStatus.active) {
      throw new GoneException({
        code: 'CREDIT_CAMPAIGN_NOT_ACTIVE',
        msg: 'This campaign is not active.',
      });
    }
    if (campaign.startsAt && campaign.startsAt > now) {
      throw new GoneException({
        code: 'CREDIT_CAMPAIGN_NOT_STARTED',
        msg: 'This campaign has not started yet.',
      });
    }
    if (campaign.endsAt && campaign.endsAt <= now) {
      throw new GoneException({
        code: 'CREDIT_CAMPAIGN_ENDED',
        msg: 'This campaign has ended.',
      });
    }

    // compute_point is workspace-owned -> credits land in the default-workspace pot.
    const defaultWorkspace = await this.prisma.workspace.findFirst({
      where: {
        defaultForUserId: userId,
        deletedAt: null,
      },
      select: { id: true },
    });
    if (!defaultWorkspace) {
      throw new ConflictException({
        code: 'DEFAULT_WORKSPACE_MISSING',
        msg: 'No default workspace to receive the credits yet.',
      });
    }

    const existing = await this.prisma.creditCampaignClaim.findUnique({
      where: { campaignId_userId: { campaignId, userId } },
    });

    let claimId: string;
    let alreadyClaimed = false;
    if (existing) {
      claimId = existing.id;
      alreadyClaimed = true;
    } else {
      try {
        const created = await this.prisma.$transaction(async (tx) => {
          const claim = await tx.creditCampaignClaim.create({
            data: {
              campaignId,
              userId,
              workspaceId: defaultWorkspace.id,
              amount: campaign.computeCreditAmount,
            },
          });
          // Atomic budget guard (column-to-column comparison needs raw SQL); the
          // row lock serializes concurrent claims. 0 rows => budget exhausted, so
          // the whole tx (incl. the claim insert above) rolls back.
          const bumped = await tx.$executeRaw`
            UPDATE credit_campaigns
            SET claim_count = claim_count + 1, updated_at = now()
            WHERE id = ${campaignId}::uuid
              AND (max_claims IS NULL OR claim_count < max_claims)
          `;
          if (bumped === 0) {
            throw new ConflictException({
              code: 'CREDIT_CAMPAIGN_EXHAUSTED',
              msg: 'This campaign has reached its claim limit.',
            });
          }
          return claim;
        });
        claimId = created.id;
      } catch (err) {
        // Raced a concurrent claim by the same user -> they have a claim now.
        if (!isUniqueViolation(err)) throw err;
        const raced = await this.prisma.creditCampaignClaim.findUnique({
          where: { campaignId_userId: { campaignId, userId } },
        });
        if (!raced) throw err;
        claimId = raced.id;
        alreadyClaimed = true;
      }
    }

    // Credit. Idempotent by claim id: a retry / same-user re-claim credits once.
    const amount = BigInt(campaign.computeCreditAmount);
    const account = await this.prisma.walletAccount.upsert({
      where: {
        ownerType_ownerId_currency_balanceKind: {
          ownerType: WalletOwnerType.workspace,
          ownerId: defaultWorkspace.id,
          currency: WalletCurrencyType.compute_point,
          balanceKind: WalletBalanceKind.consumable,
        },
      },
      create: {
        ownerType: WalletOwnerType.workspace,
        ownerId: defaultWorkspace.id,
        currency: WalletCurrencyType.compute_point,
        balanceKind: WalletBalanceKind.consumable,
        status: WalletAccountStatus.active,
      },
      update: {},
    });
    const posted = await this.walletLedger.postEntry({
      accountId: account.id,
      entryType: WalletLedgerEntryType.adjustment,
      amount,
      availableDelta: amount,
      heldDelta: 0n,
      sourceType: 'credit_campaign_claim',
      sourceId: claimId,
      idempotencyKey: `campaign_claim:${claimId}`,
      actorUserId: userId,
      workspaceId: defaultWorkspace.id,
      description: `Campaign "${campaign.name}" claimed`,
      reason: 'campaign_compute_point_credit',
      metadata: { campaignId, campaignName: campaign.name, claimId },
      creditGrant: {
        grantType: WalletCreditGrantType.campaign_reward,
        expiresAt: promoCreditExpiresAt(),
        metadata: { campaignId, claimId },
      },
    });

    return {
      granted: {
        grantType: 'compute_credits' as const,
        currency: WalletCurrencyType.compute_point,
        amount: amount.toString(),
        workspaceId: defaultWorkspace.id,
      },
      alreadyClaimed: alreadyClaimed || posted.deduped,
    };
  }

  private campaignDto(c: CreditCampaign) {
    return {
      id: c.id,
      name: c.name,
      description: c.description,
      computeCreditAmount: c.computeCreditAmount,
      status: c.status,
      startsAt: c.startsAt?.toISOString() ?? null,
      endsAt: c.endsAt?.toISOString() ?? null,
      maxClaims: c.maxClaims,
      claimCount: c.claimCount,
      note: c.note,
      createdAt: c.createdAt.toISOString(),
    };
  }
}
