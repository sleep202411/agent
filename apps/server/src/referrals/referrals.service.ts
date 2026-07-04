import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  BillingOrderStatus,
  BillingOrderType,
  BillingSubjectType,
  Prisma,
  WalletAccountStatus,
  WalletBalanceKind,
  WalletCreditGrantType,
  WalletCurrencyType,
  WalletLedgerEntryType,
  WalletOwnerType,
} from '@prisma/client';
import {
  PROMO_CREDIT_VALIDITY_DAYS,
  promoCreditExpiresAt,
} from '../billing/credit-policy';
import { PrismaService } from '../infra/db/db.module';
import { LegacyMysqlService } from '../infra/legacy-mysql/legacy-mysql.service';
import {
  COMMUNITY_MEMBERSHIP_PLAN_KEY,
  EntitlementService,
} from '../entitlements/entitlement.service';
import { JavaUserLookupService } from '../integrations/java/user-lookup.service';
import { WalletLedgerService, WorkspacesService } from '../workspaces';
import type { RowDataPacket } from 'mysql2';
import type {
  CreateReferralMilestoneInput,
  ReferralDashboardDTO,
  ReferralMilestoneDTO,
  ReferralRewardDTO,
  ReferralRewardItemDTO,
  UpdateReferralMilestoneInput,
  UpdateReferralProgramInput,
  UpsertReferralCommissionRateInput,
} from './dto';

/** Single-program install for now; the schema already keys by program. */
const PROGRAM_KEY = 'default';
/** Entry compute-tier plan granted for "算力会员" referral rewards. */
const COMPUTE_PLAN_KEY = 'basic';
const DAY_MS = 24 * 60 * 60 * 1000;

const EMPTY_DASHBOARD: ReferralDashboardDTO = {
  programAvailable: false,
  inviteCode: null,
  inviteUrl: null,
  currency: null,
  totals: {
    pendingMinor: '0',
    confirmedMinor: '0',
    reversedMinor: '0',
    inviteeCount: 0,
  },
  inviteeBenefit: { title: null, detail: null, expiresInDays: null },
  milestones: [],
  rewards: [],
};

@Injectable()
export class ReferralsService {
  private readonly logger = new Logger(ReferralsService.name);
  /** Invite-link base — the apps/web origin. The shared link lands on /register
   *  with the code prefilled (recommendationCode). .com default; CN overrides. */
  private readonly inviteBase = (
    process.env.REFERRAL_INVITE_BASE_URL ?? 'https://fizzdragon.com'
  ).replace(/\/+$/, '');

  constructor(
    private readonly prisma: PrismaService,
    private readonly legacy: LegacyMysqlService,
    private readonly entitlements: EntitlementService,
    private readonly walletLedger: WalletLedgerService,
    private readonly workspaces: WorkspacesService,
    private readonly javaUsers: JavaUserLookupService,
  ) {}

  /** The signed-in user's dashboard. Returns the empty/unavailable shape when
   *  no active program exists, so the client renders a graceful "off" state. */
  async getDashboard(
    userId: string,
    viewerCookie?: string,
  ): Promise<ReferralDashboardDTO> {
    // Lazy backstop: if this viewer is a referee who has since made their first
    // purchase, qualify + accrue before rendering. Best-effort (never throws).
    await this.qualifyRefereePurchase(userId).catch((e) =>
      this.logger.warn(
        `lazy qualify failed for ${userId}: ${e instanceof Error ? e.message : e}`,
      ),
    );
    // Same for per-order commissions the webhook hook may have missed (its
    // failures are log-only — the provider event is already marked processed).
    await this.backfillRefereeCommissions(userId).catch((e) =>
      this.logger.warn(
        `lazy commission backfill failed for ${userId}: ${e instanceof Error ? e.message : e}`,
      ),
    );
    const program = await this.prisma.referralProgram.findUnique({
      where: { key: PROGRAM_KEY },
      include: {
        milestones: {
          where: { archivedAt: null },
          orderBy: { rank: 'asc' },
          include: { items: { orderBy: { rank: 'asc' } } },
        },
      },
    });
    if (!program || !program.enabled) return EMPTY_DASHBOARD;

    // The invite code IS the user's own Java recommendation_code, minted lazily
    // by /user/recommendationcode — most rows are still null, so we hit the
    // endpoint via the forwarded viewer cookie rather than reading the column.
    // A null just hides the share UI; the rest of the dashboard still renders.
    const code = viewerCookie
      ? await this.javaUsers.findRecommendationCode(viewerCookie)
      : null;

    // Milestone accrual is REGISTRATION-based and LAZY: this is the ONLY place
    // Java MySQL is queried for the referrer's referral count (there is no
    // signup webhook). Count how many people registered with this referrer's
    // code, then grant any newly-crossed tiers before rendering. Best-effort.
    const referralCount = code
      ? await this.countReferralRegistrations(code)
      : 0;
    if (referralCount > 0) {
      await this.accrueMilestonesForReferrer(userId, referralCount).catch((e) =>
        this.logger.warn(
          `lazy milestone accrual failed for ${userId}: ${e instanceof Error ? e.message : e}`,
        ),
      );
    }

    // The reward LIST is windowed, but claimable (accrued) rewards are fetched
    // separately so per-order commission churn can never push an unclaimed
    // reward out of reach; the headline money TOTALS are a full-table
    // aggregate, not a sum of the visible window.
    const [accruedRewards, recentRewards, cashByStatus] = await Promise.all([
      this.prisma.referralReward.findMany({
        where: { userId, status: 'accrued' },
        orderBy: { createdAt: 'desc' },
        take: 100,
        include: { items: { orderBy: { rank: 'asc' } } },
      }),
      this.prisma.referralReward.findMany({
        where: { userId, status: { not: 'accrued' } },
        orderBy: { createdAt: 'desc' },
        take: 50,
        include: { items: { orderBy: { rank: 'asc' } } },
      }),
      this.prisma.referralReward.groupBy({
        by: ['status'],
        where: { userId, payoutType: 'cash' },
        _sum: { amountMinor: true },
      }),
    ]);
    const rewards = [...accruedRewards, ...recentRewards].sort(
      (a, b) => b.createdAt.getTime() - a.createdAt.getTime(),
    );

    // Milestone progress tracks REGISTRATIONS with this code (matches accrual).
    // First unmet tier is "active"; lower complete, higher locked.
    let activeAssigned = false;
    const milestones: ReferralMilestoneDTO[] = program.milestones.map((m) => {
      let status: ReferralMilestoneDTO['status'];
      if (referralCount >= m.inviteeThreshold) {
        status = 'complete';
      } else if (!activeAssigned) {
        status = 'active';
        activeAssigned = true;
      } else {
        status = 'locked';
      }
      return {
        id: m.id,
        title: m.title,
        detail: m.detail,
        status,
        inviteeThreshold: m.inviteeThreshold,
        payoutType: m.payoutType,
        amountMinor: m.rewardMinor.toString(),
        days: m.payoutDays,
        currency: m.payoutType === 'cash' ? program.currency : null,
        items: m.items.length ? m.items.map(mapBundleItem) : undefined,
      };
    });

    return {
      programAvailable: true,
      inviteCode: code,
      inviteUrl:
        code && this.inviteBase
          ? `${this.inviteBase}/register?recommendationCode=${encodeURIComponent(code)}`
          : null,
      currency: program.currency,
      totals: computeTotals(cashByStatus, referralCount),
      inviteeBenefit: {
        title: program.inviteeBenefitTitle,
        detail: program.inviteeBenefitDetail,
        expiresInDays: program.inviteeBenefitExpiresInDays,
      },
      milestones,
      rewards: rewards.map(mapReward),
    };
  }

  // ─── Admin config (reuses billing.read / billing.write permission) ──────

  /** Program config + ALL milestones (incl. archived) for the admin panel. */
  async getAdminConfig() {
    return this.loadAdminConfig();
  }

  async updateProgram(adminId: string, input: UpdateReferralProgramInput) {
    const data: Prisma.ReferralProgramUpdateInput = { updatedById: adminId };
    if (input.enabled !== undefined) data.enabled = input.enabled;
    if (input.currency !== undefined) data.currency = input.currency;
    if (input.holdDays !== undefined) data.holdDays = input.holdDays;
    if (input.rewardPerReferralMinor !== undefined) {
      data.rewardPerReferralMinor = BigInt(input.rewardPerReferralMinor);
    }
    if (input.maxRewardedReferees !== undefined) {
      data.maxRewardedReferees = input.maxRewardedReferees;
    }
    if (input.commissionBps !== undefined) {
      data.commissionBps = input.commissionBps;
    }
    if (input.refereeMaxAccountAgeHours !== undefined) {
      data.refereeMaxAccountAgeHours = input.refereeMaxAccountAgeHours;
    }
    if (input.inviteeBenefitTitle !== undefined) {
      data.inviteeBenefitTitle = input.inviteeBenefitTitle;
    }
    if (input.inviteeBenefitDetail !== undefined) {
      data.inviteeBenefitDetail = input.inviteeBenefitDetail;
    }
    if (input.inviteeBenefitMinor !== undefined) {
      data.inviteeBenefitMinor = BigInt(input.inviteeBenefitMinor);
    }
    if (input.inviteeBenefitExpiresInDays !== undefined) {
      data.inviteeBenefitExpiresInDays = input.inviteeBenefitExpiresInDays;
    }
    // Invitee welcome-perk BUNDLE — replace the whole set when provided (empty
    // array = clear the perk). Mirror the primary cash item into the legacy
    // inviteeBenefitMinor so single-reward clients keep working.
    if (input.inviteeBenefitItems !== undefined) {
      const items = input.inviteeBenefitItems.map((it, idx) => ({
        payoutType: it.kind,
        amountMinor: BigInt(it.amountMinor ?? 0),
        days: it.days ?? 0,
        rank: idx,
      }));
      data.inviteeBenefitItems = { deleteMany: {}, create: items };
      const primary = items[0];
      data.inviteeBenefitMinor =
        primary && primary.payoutType === 'cash' ? primary.amountMinor : 0n;
    }
    await this.prisma.referralProgram.update({
      where: { key: PROGRAM_KEY },
      data,
    });
    return this.loadAdminConfig();
  }

  async createMilestone(input: CreateReferralMilestoneInput) {
    const program = await this.prisma.referralProgram.findUniqueOrThrow({
      where: { key: PROGRAM_KEY },
      select: { id: true },
    });
    // The bundle (items) is the source of truth; mirror its primary item into
    // the legacy payout columns so single-reward clients (shipped mobile) work.
    const items = resolveTierItems(input);
    if (!items?.length) {
      throw new BadRequestException('Reward bundle is required');
    }
    const legacy = legacyColumnsFromItems(items);
    await this.prisma.referralMilestoneConfig.create({
      data: {
        programId: program.id,
        inviteeThreshold: input.inviteeThreshold,
        payoutType: legacy.payoutType,
        rewardMinor: legacy.rewardMinor,
        payoutDays: legacy.payoutDays,
        title: input.title,
        detail: input.detail,
        rank: input.rank,
        items: {
          create: items.map((it) => ({
            payoutType: it.payoutType,
            amountMinor: it.amountMinor,
            days: it.days,
            rank: it.rank,
          })),
        },
      },
    });
    return this.loadAdminConfig();
  }

  async updateMilestone(id: string, input: UpdateReferralMilestoneInput) {
    const data: Prisma.ReferralMilestoneConfigUpdateInput = {};
    if (input.inviteeThreshold !== undefined) {
      data.inviteeThreshold = input.inviteeThreshold;
    }
    if (input.title !== undefined) data.title = input.title;
    if (input.detail !== undefined) data.detail = input.detail;
    if (input.rank !== undefined) data.rank = input.rank;
    // When the reward changed (new rewardItems[] or legacy payout fields),
    // REPLACE the bundle and re-mirror the legacy payout columns from items[0].
    const items = resolveTierItems(input);
    if (items?.length) {
      const legacy = legacyColumnsFromItems(items);
      data.payoutType = legacy.payoutType;
      data.rewardMinor = legacy.rewardMinor;
      data.payoutDays = legacy.payoutDays;
      data.items = {
        deleteMany: {},
        create: items.map((it) => ({
          payoutType: it.payoutType,
          amountMinor: it.amountMinor,
          days: it.days,
          rank: it.rank,
        })),
      };
    }
    await this.prisma.referralMilestoneConfig.update({ where: { id }, data });
    return this.loadAdminConfig();
  }

  async archiveMilestone(id: string) {
    await this.prisma.referralMilestoneConfig.update({
      where: { id },
      data: { archivedAt: new Date() },
    });
    return this.loadAdminConfig();
  }

  private async loadAdminConfig() {
    const program = await this.prisma.referralProgram.findUnique({
      where: { key: PROGRAM_KEY },
      include: {
        milestones: {
          orderBy: { rank: 'asc' },
          include: { items: { orderBy: { rank: 'asc' } } },
        },
        inviteeBenefitItems: { orderBy: { rank: 'asc' } },
      },
    });
    if (!program) return null;
    return {
      key: program.key,
      enabled: program.enabled,
      currency: program.currency,
      holdDays: program.holdDays,
      rewardPerReferralMinor: program.rewardPerReferralMinor.toString(),
      maxRewardedReferees: program.maxRewardedReferees,
      commissionBps: program.commissionBps,
      refereeMaxAccountAgeHours: program.refereeMaxAccountAgeHours,
      // Read-only for the admin: gifted point rewards (社区/算力积分) expire this
      // many days after they're granted — a platform-wide policy constant shared
      // with check-in/voucher/campaign, not per-program editable. Surfaced so the
      // admin knows the rewards they configure aren't permanent. Paid recharge
      // and cash payouts never expire.
      giftedPointsValidityDays: PROMO_CREDIT_VALIDITY_DAYS,
      inviteeBenefitTitle: program.inviteeBenefitTitle,
      inviteeBenefitDetail: program.inviteeBenefitDetail,
      inviteeBenefitMinor: program.inviteeBenefitMinor.toString(),
      inviteeBenefitExpiresInDays: program.inviteeBenefitExpiresInDays,
      // The invitee welcome-perk bundle the admin edits (same item shape as tiers).
      inviteeBenefitItems: program.inviteeBenefitItems.map((it) => ({
        kind: it.payoutType,
        amountMinor: it.amountMinor.toString(),
        days: it.days,
      })),
      milestones: program.milestones.map((m) => ({
        id: m.id,
        inviteeThreshold: m.inviteeThreshold,
        payoutType: m.payoutType,
        rewardMinor: m.rewardMinor.toString(),
        payoutDays: m.payoutDays,
        title: m.title,
        detail: m.detail,
        rank: m.rank,
        archivedAt: m.archivedAt ? m.archivedAt.toISOString() : null,
        // The reward bundle the admin edits (one tier → many items).
        rewardItems: m.items.map((it) => ({
          kind: it.payoutType,
          amountMinor: it.amountMinor.toString(),
          days: it.days,
        })),
      })),
    };
  }

  // ─── Admin: 消费返佣 per-user rates (KOL whitelist) ─────────────────────

  async listCommissionRates() {
    const rows = await this.prisma.referralCommissionRate.findMany({
      where: { programKey: PROGRAM_KEY },
      orderBy: { createdAt: 'desc' },
    });
    const users = await this.lookupLegacyUsers(rows.map((r) => r.userId));
    return rows.map((r) => ({
      id: r.id,
      userId: r.userId,
      commissionBps: r.commissionBps,
      note: r.note,
      nickName: users.get(r.userId)?.nickName ?? null,
      email: users.get(r.userId)?.email ?? null,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
    }));
  }

  async upsertCommissionRate(
    adminId: string,
    input: UpsertReferralCommissionRateInput,
  ) {
    const userId = input.userId.trim();
    // Reject unknown ids up front — a typo'd whitelist row would silently
    // never match any attribution. A bridge outage must NOT masquerade as
    // "unknown user" (that reads as an admin typo): surface it as a 503.
    let exists = false;
    try {
      const row = await this.legacy.queryOne<
        RowDataPacket & { id: number | string }
      >('SELECT id FROM client_user WHERE id = ? LIMIT 1', [userId]);
      exists = row?.id != null;
    } catch {
      throw new ServiceUnavailableException(
        'User lookup is unavailable — cannot validate the user id right now; try again later',
      );
    }
    if (!exists) {
      throw new BadRequestException(`Unknown user id: ${userId}`);
    }
    await this.prisma.referralCommissionRate.upsert({
      where: { programKey_userId: { programKey: PROGRAM_KEY, userId } },
      create: {
        programKey: PROGRAM_KEY,
        userId,
        commissionBps: input.commissionBps,
        note: input.note ?? null,
        createdById: adminId,
        updatedById: adminId,
      },
      update: {
        commissionBps: input.commissionBps,
        note: input.note ?? null,
        updatedById: adminId,
      },
    });
    return this.listCommissionRates();
  }

  async removeCommissionRate(userId: string) {
    await this.prisma.referralCommissionRate.deleteMany({
      where: { programKey: PROGRAM_KEY, userId },
    });
    return this.listCommissionRates();
  }

  /**
   * Admin lookup for the 消费返佣 whitelist dialog: search client_user by
   * email / phone / nickname / id → matched users so the admin picks the right
   * person instead of hand-typing a raw Java id. Bridge outage → 503.
   */
  async lookupUsers(query: string): Promise<
    Array<{
      userId: string;
      nickName: string | null;
      email: string | null;
      phone: string | null;
    }>
  > {
    const q = query.trim();
    if (!q) return [];
    const like = `%${q}%`;
    try {
      const rows = await this.legacy.query<
        RowDataPacket & {
          id: number | string;
          nick_name: string | null;
          email: string | null;
          phone: string | null;
        }
      >(
        `SELECT id, nick_name, email, phone FROM client_user
           WHERE phone LIKE ? OR email LIKE ? OR nick_name LIKE ? OR CAST(id AS CHAR) LIKE ?
           ORDER BY id DESC LIMIT 10`,
        [like, like, like, like],
      );
      return rows.map((r) => ({
        userId: String(r.id),
        nickName: r.nick_name ?? null,
        email: r.email ?? null,
        phone: r.phone ?? null,
      }));
    } catch {
      throw new ServiceUnavailableException(
        'User lookup is unavailable right now; try again later',
      );
    }
  }

  /** Best-effort display info for admin lists (nick/email via the Java bridge). */
  private async lookupLegacyUsers(
    userIds: string[],
  ): Promise<Map<string, { nickName: string | null; email: string | null }>> {
    const out = new Map<
      string,
      { nickName: string | null; email: string | null }
    >();
    const ids = [...new Set(userIds.filter(Boolean))];
    if (!ids.length) return out;
    try {
      const rows = await this.legacy.query<
        RowDataPacket & {
          id: number | string;
          nick_name: string | null;
          email: string | null;
        }
      >(
        `SELECT id, nick_name, email FROM client_user WHERE id IN (${ids
          .map(() => '?')
          .join(',')})`,
        ids,
      );
      for (const r of rows) {
        out.set(String(r.id), {
          nickName: r.nick_name ?? null,
          email: r.email ?? null,
        });
      }
    } catch {
      // bridge unavailable — names just render blank in the admin list
    }
    return out;
  }

  /**
   * Billing hook — call AFTER the payment transaction commits (own tx,
   * best-effort), so a referral bug can never roll back a paid order. Resolves
   * the order's buyer, qualifies them if they were referred (one-time), then
   * accrues the per-order consumption commission (every order). Idempotent;
   * safe to call for any matched order (non-paid / adjustments are ignored).
   */
  async accrueForOrder(orderId: string): Promise<void> {
    const order = await this.prisma.billingOrder.findUnique({
      where: { id: orderId },
      select: {
        id: true,
        userId: true,
        status: true,
        orderType: true,
        amountMinor: true,
        currency: true,
      },
    });
    if (!order) return;
    if (
      order.status !== BillingOrderStatus.paid &&
      order.status !== BillingOrderStatus.fulfilled
    ) {
      return;
    }
    if (order.orderType === BillingOrderType.manual_adjustment) return;
    await this.qualifyRefereePurchase(order.userId);
    await this.accrueCommissionForOrder(order);
  }

  /**
   * Per-order consumption commission (消费返佣): the referee's referrer earns
   * `commissionBps` of this order's ACTUAL-PAID amount (`amountMinor` is
   * discount-applied AND provider-reconciled before the post-commit hook
   * fires). Unlike the one-time qualify reward this fires on EVERY paid
   * order; idempotent per order via the (orderId, kind) unique. Rate: the
   * per-user whitelist row → else the program default (0 = off). USD-only:
   * commission is cash and the cash grant maps 积分 ≡ US cent.
   */
  private async accrueCommissionForOrder(order: {
    id: string;
    userId: string;
    amountMinor: bigint;
    currency: string;
  }): Promise<void> {
    if (order.amountMinor <= 0n) return;
    const attribution = await this.prisma.referralAttribution.findUnique({
      where: { refereeUserId: order.userId },
    });
    if (!attribution || attribution.status !== 'qualified') return;
    const program = await this.prisma.referralProgram.findUnique({
      where: { key: attribution.programKey },
    });
    if (!program || !program.enabled) return;
    const override = await this.prisma.referralCommissionRate.findUnique({
      where: {
        programKey_userId: {
          programKey: attribution.programKey,
          userId: attribution.referrerUserId,
        },
      },
    });
    const bps = override ? override.commissionBps : program.commissionBps;
    if (bps <= 0) return;
    if (order.currency !== 'USD') {
      // Skip loudly rather than throw — this hook must never read as a
      // billing failure. (.cn needs its own payout mapping before commission.)
      this.logger.warn(
        `commission skipped for order ${order.id}: unsupported currency ${order.currency}`,
      );
      return;
    }
    const amount = (order.amountMinor * BigInt(bps)) / 10000n;
    if (amount <= 0n) return;

    const availableAt = new Date(Date.now() + program.holdDays * DAY_MS);
    try {
      await this.prisma.referralReward.create({
        data: {
          programKey: program.key,
          userId: attribution.referrerUserId,
          kind: 'commission',
          status: 'accrued',
          payoutType: 'cash',
          amountMinor: amount,
          currency: order.currency,
          title: 'Purchase commission',
          subtitle: `${formatBpsPercent(bps)} of a friend's ${formatUsdMinor(order.amountMinor)} purchase`,
          orderId: order.id,
          commissionBps: bps,
          sourceAmountMinor: order.amountMinor,
          availableAt,
          items: {
            create: [
              {
                payoutType: 'cash',
                amountMinor: amount,
                days: 0,
                currency: order.currency,
                rank: 0,
              },
            ],
          },
        },
      });
      this.logger.log(
        `Commission accrued: order=${order.id} referrer=${attribution.referrerUserId} bps=${bps} amountMinor=${amount}`,
      );
    } catch (e) {
      // (orderId, kind) unique → a duplicate webhook delivery already accrued.
      if (!isUniqueViolation(e)) throw e;
    }
  }

  /**
   * Lazy backstop (dashboard-read time) for commissions the webhook hook
   * missed — its failures are log-only because the provider event is already
   * marked processed, so nothing retries them. Sweeps THIS viewer's recent
   * paid orders (48h window: transient-failure recovery, NOT retroactive
   * minting for newly-whitelisted referrers) and accrues any missing
   * commission. Idempotent via the (orderId, kind) unique.
   */
  private async backfillRefereeCommissions(
    refereeUserId: string,
  ): Promise<void> {
    const attribution = await this.prisma.referralAttribution.findUnique({
      where: { refereeUserId },
      select: { status: true },
    });
    if (!attribution || attribution.status !== 'qualified') return;
    const orders = await this.prisma.billingOrder.findMany({
      where: {
        userId: refereeUserId,
        status: {
          in: [BillingOrderStatus.paid, BillingOrderStatus.fulfilled],
        },
        orderType: { not: BillingOrderType.manual_adjustment },
        createdAt: { gte: new Date(Date.now() - 48 * 60 * 60 * 1000) },
      },
      orderBy: { createdAt: 'desc' },
      take: 20,
      select: { id: true, userId: true, amountMinor: true, currency: true },
    });
    if (!orders.length) return;
    const existing = new Set(
      (
        await this.prisma.referralReward.findMany({
          where: {
            orderId: { in: orders.map((o) => o.id) },
            kind: 'commission',
          },
          select: { orderId: true },
        })
      ).map((r) => r.orderId),
    );
    for (const order of orders) {
      if (existing.has(order.id)) continue;
      await this.accrueCommissionForOrder(order);
    }
  }

  /**
   * Core qualify + reward accrual for a referee's first paid purchase. The
   * whole accrual is ONE transaction, so partial states can't persist;
   * idempotency comes from the pending→qualified guard (only the winner
   * accrues) plus milestone existence checks. Also the lazy-read backstop.
   */
  async qualifyRefereePurchase(refereeUserId: string): Promise<void> {
    // Build the attribution from Java's recommendation_code (set at signup) if
    // it isn't recorded Nest-side yet — no client claim needed.
    await this.ensureAttribution(refereeUserId);
    const attribution = await this.prisma.referralAttribution.findUnique({
      where: { refereeUserId },
    });
    if (!attribution || attribution.status !== 'pending') return;

    const program = await this.prisma.referralProgram.findUnique({
      where: { key: attribution.programKey },
      include: {
        // Milestones are NOT needed here — they accrue registration-based on the
        // referrer's dashboard. This path only needs the invitee-perk bundle.
        inviteeBenefitItems: { orderBy: { rank: 'asc' } },
      },
    });
    if (!program || !program.enabled) return;

    // Genuine conversion: the referee actually paid. "Already-paying customer"
    // protection lives at attribution CREATION (ensureAttribution backdates to
    // registration + the account-age gate) — invite codes are only enterable
    // at registration, so an attributed referee cannot have pre-referral
    // purchases. The old paid-before-attribution check misfired on the
    // standard funnel (register → buy without ever opening /referral) because
    // this row is created lazily AT accrual time, i.e. after the order.
    const paidTotal = await this.prisma.billingOrder.count({
      where: {
        userId: refereeUserId,
        status: {
          in: [BillingOrderStatus.paid, BillingOrderStatus.fulfilled],
        },
        orderType: { not: BillingOrderType.manual_adjustment },
      },
    });
    if (paidTotal === 0) return;

    const now = new Date();
    const availableAt = new Date(now.getTime() + program.holdDays * DAY_MS);

    await this.prisma.$transaction(async (tx) => {
      // Atomic guard: only the winner of pending→qualified gets to accrue.
      const claimed = await tx.referralAttribution.updateMany({
        where: { id: attribution.id, status: 'pending' },
        data: { status: 'qualified', qualifiedAt: now },
      });
      if (claimed.count === 0) return;

      // 1) Referrer per-referral reward (respect the per-referrer cap).
      if (program.rewardPerReferralMinor > 0n) {
        const cap = program.maxRewardedReferees;
        const within =
          cap === 0 ||
          (await tx.referralReward.count({
            where: { userId: attribution.referrerUserId, kind: 'referral' },
          })) < cap;
        if (within) {
          await tx.referralReward.create({
            data: {
              programKey: program.key,
              userId: attribution.referrerUserId,
              kind: 'referral',
              status: 'accrued',
              amountMinor: program.rewardPerReferralMinor,
              currency: program.currency,
              title: 'Referral reward',
              subtitle: 'A friend joined and made their first purchase',
              attributionId: attribution.id,
              availableAt,
              // Snapshot as a one-item bundle so the grant path is uniform.
              items: {
                create: [
                  {
                    payoutType: 'cash',
                    amountMinor: program.rewardPerReferralMinor,
                    days: 0,
                    currency: program.currency,
                    rank: 0,
                  },
                ],
              },
            },
          });
        }
      }

      // 2) Invitee welcome perk (被邀请人) — the configured reward BUNDLE
      //    (社区/算力积分, 会员, or cash; multi-item). Legacy mirror columns =
      //    primary item (items[0]) so single-reward clients keep working.
      if (program.inviteeBenefitItems.length) {
        const items = program.inviteeBenefitItems.map((it) => ({
          payoutType: it.payoutType,
          amountMinor: it.amountMinor,
          days: it.days,
          currency: it.payoutType === 'cash' ? program.currency : null,
          rank: it.rank,
        }));
        const primary = items[0];
        const primaryIsMembership = primary.payoutType.startsWith('membership');
        await tx.referralReward.create({
          data: {
            programKey: program.key,
            userId: refereeUserId,
            kind: 'invitee',
            payoutType: primary.payoutType,
            status: 'accrued',
            amountMinor: primaryIsMembership ? 0n : primary.amountMinor,
            days: primaryIsMembership ? primary.days : 0,
            currency: primary.currency,
            title: program.inviteeBenefitTitle ?? 'Welcome bonus',
            subtitle: program.inviteeBenefitDetail ?? undefined,
            availableAt,
            items: { create: items },
          },
        });
      }

      // Milestones are NO LONGER accrued here. They moved to a REGISTRATION-
      // based, referrer-side lazy path (accrueMilestonesForReferrer, called from
      // getDashboard): a tier unlocks by how many people registered with the
      // code, not by qualified purchases. This tx only qualifies the attribution
      // (which gates commission) + the flat per-referral / invitee perks.
    });

    this.logger.log(
      `Referral qualified: referee=${refereeUserId} referrer=${attribution.referrerUserId}`,
    );
  }

  /**
   * Milestone accrual — REGISTRATION-based (老板 2026-07-04). A tier unlocks by
   * how many people registered with the referrer's own code (`reachedCount`);
   * any registration counts (Java OTP-verifies email/phone at signup). Accrued
   * LAZILY on the referrer's dashboard — there is no signup webhook. Idempotent:
   * each tier is granted at most once per referrer (existence check +
   * @@unique[userId,milestoneId]).
   */
  private async accrueMilestonesForReferrer(
    referrerUserId: string,
    reachedCount: number,
  ): Promise<void> {
    if (reachedCount <= 0) return;
    const program = await this.prisma.referralProgram.findUnique({
      where: { key: PROGRAM_KEY },
      include: {
        milestones: {
          where: { archivedAt: null },
          include: { items: { orderBy: { rank: 'asc' } } },
        },
      },
    });
    if (!program || !program.enabled || !program.milestones.length) return;
    const availableAt = new Date(Date.now() + program.holdDays * DAY_MS);

    await this.prisma.$transaction(async (tx) => {
      const earned = new Set(
        (
          await tx.referralReward.findMany({
            where: { userId: referrerUserId, kind: 'milestone' },
            select: { milestoneId: true },
          })
        ).map((r) => r.milestoneId),
      );
      const newTiers = program.milestones
        .filter((m) => reachedCount >= m.inviteeThreshold && !earned.has(m.id))
        .map((m) => ({
          programKey: program.key,
          userId: referrerUserId,
          kind: 'milestone' as const,
          payoutType: m.payoutType,
          status: 'accrued' as const,
          amountMinor: m.rewardMinor,
          days: m.payoutDays,
          currency: m.payoutType === 'cash' ? program.currency : null,
          title: m.title,
          subtitle: m.detail,
          milestoneId: m.id,
          availableAt,
        }));
      if (!newTiers.length) return;
      // skipDuplicates → ON CONFLICT DO NOTHING; a concurrent crossing can't
      // P2002-poison this tx.
      await tx.referralReward.createMany({
        data: newTiers,
        skipDuplicates: true,
      });
      // Snapshot each tier's bundle onto its freshly-created reward row.
      // Idempotent: only rewards without items yet get them.
      const tierById = new Map(program.milestones.map((m) => [m.id, m]));
      const created = await tx.referralReward.findMany({
        where: {
          userId: referrerUserId,
          kind: 'milestone',
          milestoneId: { in: newTiers.map((t) => t.milestoneId) },
        },
        select: {
          id: true,
          milestoneId: true,
          _count: { select: { items: true } },
        },
      });
      const itemRows: Prisma.ReferralRewardItemCreateManyInput[] = [];
      for (const r of created) {
        if (r._count.items > 0 || !r.milestoneId) continue;
        const tier = tierById.get(r.milestoneId);
        if (!tier) continue;
        const items: BundleItem[] = tier.items.length
          ? tier.items.map((it) => ({
              payoutType: it.payoutType as BundleItemKind,
              amountMinor: it.amountMinor,
              days: it.days,
              rank: it.rank,
            }))
          : expandLegacyToItems(
              tier.payoutType,
              tier.rewardMinor,
              tier.payoutDays,
            );
        for (const it of items) {
          itemRows.push({
            rewardId: r.id,
            payoutType: it.payoutType,
            amountMinor: it.amountMinor,
            days: it.days,
            currency: it.payoutType === 'cash' ? program.currency : null,
            rank: it.rank,
          });
        }
      }
      if (itemRows.length) {
        await tx.referralRewardItem.createMany({ data: itemRows });
      }
    });

    this.logger.log(
      `Milestones accrued (registration-based): referrer=${referrerUserId} reached=${reachedCount}`,
    );
  }

  /**
   * Count referees who registered with this referrer's code — the milestone
   * (阶梯) count. Any registration counts (registration is the qualifying
   * event; Java already OTP-verifies email/phone at signup). Best-effort;
   * returns 0 on a bridge outage so the dashboard still renders.
   */
  private async countReferralRegistrations(
    referrerCode: string,
  ): Promise<number> {
    try {
      const row = await this.legacy.queryOne<
        RowDataPacket & { n: number | string }
      >(
        'SELECT COUNT(*) AS n FROM client_user WHERE recommendation_code_source = ?',
        [referrerCode],
      );
      return row?.n != null ? Number(row.n) : 0;
    } catch {
      return 0;
    }
  }

  /**
   * Refund hook (post-commit, best-effort). When a referee FULLY refunds and no
   * other paid order still backs their qualification, reverse the attribution +
   * its still-accrued referral/invitee rewards so we never pay out for a
   * refunded purchase. Already paid_out rewards are NOT clawed back here.
   */
  async reverseForOrder(orderId: string): Promise<void> {
    const order = await this.prisma.billingOrder.findUnique({
      where: { id: orderId },
      select: { id: true, userId: true, status: true },
    });
    if (!order || order.status !== BillingOrderStatus.refunded) return;

    // THIS order's commission reverses unconditionally — its money went back,
    // whether or not other orders still back the qualification. Only while
    // still accrued: the hold window exists to cover the refund window, so a
    // claimed (paid_out) commission is not clawed back here.
    const reversedCommission = await this.prisma.referralReward.updateMany({
      where: { orderId: order.id, kind: 'commission', status: 'accrued' },
      data: { status: 'reversed' },
    });
    if (reversedCommission.count > 0) {
      this.logger.log(`Commission reversed (refund): order=${order.id}`);
    }

    // Keep the qualification if another paid purchase still backs it.
    const stillPaid = await this.prisma.billingOrder.count({
      where: {
        userId: order.userId,
        status: {
          in: [BillingOrderStatus.paid, BillingOrderStatus.fulfilled],
        },
        orderType: { not: BillingOrderType.manual_adjustment },
      },
    });
    if (stillPaid > 0) return;
    const attribution = await this.prisma.referralAttribution.findUnique({
      where: { refereeUserId: order.userId },
    });
    if (!attribution || attribution.status !== 'qualified') return;

    await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.referralAttribution.updateMany({
        where: { id: attribution.id, status: 'qualified' },
        data: { status: 'reversed' },
      });
      if (claimed.count === 0) return;
      // Reverse the referrer's per-referral reward (only while still accrued).
      await tx.referralReward.updateMany({
        where: { attributionId: attribution.id, status: 'accrued' },
        data: { status: 'reversed' },
      });
      // Reverse the referee's invitee perk (only while still accrued).
      await tx.referralReward.updateMany({
        where: { userId: order.userId, kind: 'invitee', status: 'accrued' },
        data: { status: 'reversed' },
      });
      // Milestone tiers are intentionally NOT reversed — a tier can still be
      // backed by other qualified referees. Revisit if it becomes an issue.
    });

    this.logger.log(`Referral reversed (refund): referee=${order.userId}`);
  }

  /**
   * Claim an accrued, out-of-hold reward → mark it paid_out, then grant it by
   * payout type. The accrued→paid_out CAS runs FIRST so a concurrent refund
   * reversal can never interleave with the grant: once paid_out, reverse
   * skips the reward (documented no-clawback); if reverse wins the CAS, we
   * never grant. A crash between the CAS and the grant self-heals on re-claim
   * — the paid_out path re-runs the grant, which is idempotent per item
   * (grantedAt) and per wallet entry (idempotencyKey).
   */
  async claimReward(
    userId: string,
    rewardId: string,
  ): Promise<{ status: string }> {
    const reward = await this.prisma.referralReward.findUnique({
      where: { id: rewardId },
    });
    if (!reward || reward.userId !== userId) {
      throw new NotFoundException('Reward not found');
    }
    if (reward.status === 'paid_out') {
      // Heal a claim that crashed after the status flip: grant whatever is
      // still ungranted (no-op when everything already went out).
      await this.grantIgnoringUniqueRace(reward);
      return { status: reward.status };
    }
    if (reward.status !== 'accrued') {
      throw new BadRequestException('Reward is not claimable');
    }
    if (reward.availableAt && reward.availableAt.getTime() > Date.now()) {
      throw new BadRequestException('Reward is still in its hold window');
    }

    const won = await this.prisma.referralReward.updateMany({
      where: { id: reward.id, status: 'accrued' },
      data: { status: 'paid_out', paidOutAt: new Date() },
    });
    if (won.count === 0) {
      // Lost the CAS: either a concurrent claim won (fine — it grants), or a
      // refund reversal got here first (nothing to pay).
      const current = await this.prisma.referralReward.findUnique({
        where: { id: reward.id },
        select: { status: true },
      });
      if (current?.status === 'paid_out') return { status: 'paid_out' };
      throw new BadRequestException('Reward is not claimable');
    }

    await this.grantIgnoringUniqueRace(reward);
    return { status: 'paid_out' };
  }

  /** grantReward, swallowing unique-key races (a concurrent grant won → the
   *  payout already exists; every grant path is idempotent). */
  private async grantIgnoringUniqueRace(reward: {
    id: string;
    userId: string;
    currency: string | null;
  }): Promise<void> {
    try {
      await this.grantReward(reward);
    } catch (e) {
      if (!isUniqueViolation(e)) throw e;
    }
  }

  /**
   * Grant a reward by iterating its bundle items (each a single payout), with
   * per-item idempotency (item.grantedAt) so a re-claim — or a crash partway
   * through a multi-item bundle — only grants what's still pending. Every
   * reward has carried an items snapshot since migration 20260629000000
   * backfilled the pre-bundle rows — a reward without items is a broken
   * invariant, so it fails loud instead of guessing from the mirror columns.
   */
  private async grantReward(reward: {
    id: string;
    userId: string;
    currency: string | null;
  }): Promise<void> {
    const items = await this.prisma.referralRewardItem.findMany({
      where: { rewardId: reward.id },
      orderBy: { rank: 'asc' },
    });
    if (items.length === 0) {
      throw new Error(
        `Referral reward ${reward.id} has no bundle items (snapshot invariant broken)`,
      );
    }
    for (const item of items) {
      if (item.grantedAt) continue;
      await this.grantSingle(
        reward.userId,
        item.payoutType,
        item.amountMinor,
        item.days,
        item.currency ?? reward.currency,
        `${reward.id}:${item.id}`,
      );
      await this.prisma.referralRewardItem.updateMany({
        where: { id: item.id, grantedAt: null },
        data: { grantedAt: new Date() },
      });
    }
  }

  /** Grant ONE payout (single kind), idempotent on `idemId`. */
  private async grantSingle(
    userId: string,
    payoutType: string,
    amountMinor: bigint,
    days: number,
    currency: string | null,
    idemId: string,
  ): Promise<void> {
    switch (payoutType) {
      case 'membership_compute':
        await this.grantMembership(userId, COMPUTE_PLAN_KEY, days, idemId);
        break;
      case 'membership_community':
        await this.grantMembership(
          userId,
          COMMUNITY_MEMBERSHIP_PLAN_KEY,
          days,
          idemId,
        );
        break;
      case 'points_compute':
        await this.creditComputePoints(userId, amountMinor, idemId);
        break;
      case 'points_community':
        await this.creditCommunityPoints(
          userId,
          amountMinor,
          idemId,
          WalletBalanceKind.consumable,
        );
        break;
      case 'cash':
        // Cash → the WITHDRAWABLE community_point pool where 积分 ≡ US cent, so
        // ONLY a USD program maps 1:1. Fail loud on any other currency rather
        // than mis-pay real money. (The 提现 cash-out is a separate TODO.)
        if (currency !== 'USD') {
          throw new BadRequestException(
            `Cash referral payout is USD-only for now (got ${currency ?? 'null'})`,
          );
        }
        await this.creditCommunityPoints(
          userId,
          amountMinor,
          idemId,
          WalletBalanceKind.withdrawable,
        );
        break;
      default:
        // Bundle items are always a single concrete kind (membership_both is
        // expressed as two items). Anything else means a new payout type
        // reached the grant path without an implementation — fail loud rather
        // than mark the item granted while paying nothing.
        throw new Error(`Unsupported referral payout type: ${payoutType}`);
    }
  }

  private async grantMembership(
    userId: string,
    planKey: string,
    days: number,
    rewardId: string,
  ): Promise<void> {
    if (days <= 0) return;
    await this.entitlements.grantComplimentary({
      subjectType: BillingSubjectType.user,
      subjectId: userId,
      planKey,
      durationDays: days,
      sourceType: 'referral_reward',
      sourceId: `${rewardId}:${planKey}`,
      metadata: { rewardId },
    });
  }

  private async creditComputePoints(
    userId: string,
    amount: bigint,
    rewardId: string,
  ): Promise<void> {
    if (amount <= 0n) return;
    const ws = await this.workspaces.ensurePersonalWorkspace({ userId });
    const account = await this.prisma.walletAccount.upsert({
      where: {
        ownerType_ownerId_currency_balanceKind: {
          ownerType: WalletOwnerType.workspace,
          ownerId: ws.id,
          currency: WalletCurrencyType.compute_point,
          balanceKind: WalletBalanceKind.consumable,
        },
      },
      create: {
        ownerType: WalletOwnerType.workspace,
        ownerId: ws.id,
        currency: WalletCurrencyType.compute_point,
        balanceKind: WalletBalanceKind.consumable,
        status: WalletAccountStatus.active,
      },
      update: {},
    });
    await this.walletLedger.postEntry({
      accountId: account.id,
      entryType: WalletLedgerEntryType.credit,
      amount,
      availableDelta: amount,
      heldDelta: 0n,
      sourceType: 'referral_reward',
      sourceId: rewardId,
      idempotencyKey: `referral_reward:${rewardId}:compute`,
      actorUserId: userId,
      workspaceId: ws.id,
      reason: 'referral_reward',
      description: 'Referral reward — compute points',
      metadata: { rewardId },
      creditGrant: {
        grantType: WalletCreditGrantType.system_grant,
        // Referral-gifted compute points are promotional credits — they expire
        // per the platform-wide policy (30d), same as check-in/voucher/campaign.
        expiresAt: promoCreditExpiresAt(),
        metadata: { rewardId },
      },
    });
  }

  private async creditCommunityPoints(
    userId: string,
    amount: bigint,
    rewardId: string,
    balanceKind: WalletBalanceKind,
  ): Promise<void> {
    if (amount <= 0n) return;
    const account = await this.prisma.walletAccount.upsert({
      where: {
        ownerType_ownerId_currency_balanceKind: {
          ownerType: WalletOwnerType.user,
          ownerId: userId,
          currency: WalletCurrencyType.community_point,
          balanceKind,
        },
      },
      create: {
        ownerType: WalletOwnerType.user,
        ownerId: userId,
        currency: WalletCurrencyType.community_point,
        balanceKind,
        status: WalletAccountStatus.active,
      },
      update: {},
    });
    await this.walletLedger.postEntry({
      accountId: account.id,
      entryType: WalletLedgerEntryType.credit,
      amount,
      availableDelta: amount,
      heldDelta: 0n,
      sourceType: 'referral_reward',
      sourceId: rewardId,
      idempotencyKey: `referral_reward:${rewardId}:community:${balanceKind}`,
      actorUserId: userId,
      reason: 'referral_reward',
      description: 'Referral reward — community points',
      metadata: { rewardId },
      // Gifted (consumable) community points are promotional — they expire per
      // the platform policy (30d), same as gifted compute points. The
      // WITHDRAWABLE cash-out pool is NOT grant-backed (earned money never
      // expires), so its credit ignores this grant spec.
      creditGrant:
        balanceKind === WalletBalanceKind.consumable
          ? {
              grantType: WalletCreditGrantType.system_grant,
              expiresAt: promoCreditExpiresAt(),
              metadata: { rewardId },
            }
          : undefined,
    });
  }

  /**
   * Lazily build a referee's attribution from Java's referral codes (captured
   * at web /register), so attribution needs no client claim. The referee's
   * `recommendation_code_source` is the code they entered = the referrer's own
   * `recommendation_code`; we resolve the referrer by that and record a pending
   * attribution. Best-effort; no-ops on missing / unknown / self code.
   */
  private async ensureAttribution(refereeUserId: string): Promise<void> {
    const existing = await this.prisma.referralAttribution.findUnique({
      where: { refereeUserId },
      select: { id: true },
    });
    if (existing) return;

    let referrerUserId: string | null = null;
    let sourceCode: string | null = null;
    let registeredAt: Date | null = null;
    try {
      const referee = await this.legacy.queryOne<
        RowDataPacket & {
          recommendation_code_source: string | null;
          create_time: Date | string | null;
        }
      >(
        'SELECT recommendation_code_source, create_time FROM client_user WHERE id = ? LIMIT 1',
        [refereeUserId],
      );
      sourceCode = referee?.recommendation_code_source?.trim() || null;
      if (!sourceCode) return; // this user wasn't referred
      if (referee?.create_time) {
        const t = new Date(referee.create_time);
        if (!Number.isNaN(t.getTime())) registeredAt = t;
      }
      const referrer = await this.legacy.queryOne<
        RowDataPacket & { id: number | string }
      >('SELECT id FROM client_user WHERE recommendation_code = ? LIMIT 1', [
        sourceCode,
      ]);
      referrerUserId = referrer?.id != null ? String(referrer.id) : null;
    } catch {
      return; // bridge unavailable — skip
    }
    // Unknown code or a self-referral → nothing to attribute.
    if (!referrerUserId || referrerUserId === refereeUserId) return;

    // Anti-fraud age gate (refereeMaxAccountAgeHours, 0 = no limit): the code
    // is only enterable at registration, so a LATE first attribution for an
    // old account is legacy-data noise, not a fresh conversion — skip it.
    const program = await this.prisma.referralProgram.findUnique({
      where: { key: PROGRAM_KEY },
      select: { refereeMaxAccountAgeHours: true },
    });
    const maxAgeHours = program?.refereeMaxAccountAgeHours ?? 0;
    if (
      maxAgeHours > 0 &&
      registeredAt &&
      Date.now() - registeredAt.getTime() > maxAgeHours * 3_600_000
    ) {
      return;
    }

    try {
      await this.prisma.referralAttribution.create({
        data: {
          programKey: PROGRAM_KEY,
          referrerUserId,
          refereeUserId,
          inviteCode: sourceCode,
          status: 'pending',
          // Backdate to the referee's REGISTRATION — the moment the code was
          // actually entered — not this lazy row-creation moment (which is
          // typically DURING their first purchase's webhook).
          ...(registeredAt ? { createdAt: registeredAt } : {}),
        },
      });
    } catch (e) {
      if (!isUniqueViolation(e)) throw e; // raced another writer — fine
    }
  }
}

/** Headline cash totals from a full-table groupBy(status) aggregate (already
 *  filtered to payoutType='cash' in the query — never from the paged list).
 *  Exported for tests. */
export function computeTotals(
  cashByStatus: { status: string; _sum: { amountMinor: bigint | null } }[],
  inviteeCount: number,
) {
  let pending = 0n;
  let confirmed = 0n;
  let reversed = 0n;
  for (const row of cashByStatus) {
    const amount = row._sum.amountMinor ?? 0n;
    if (row.status === 'pending' || row.status === 'qualified') {
      pending += amount;
    } else if (row.status === 'accrued' || row.status === 'paid_out') {
      confirmed += amount;
    } else if (row.status === 'reversed' || row.status === 'voided') {
      reversed += amount;
    }
  }
  return {
    pendingMinor: pending.toString(),
    confirmedMinor: confirmed.toString(),
    reversedMinor: reversed.toString(),
    inviteeCount,
  };
}

function mapReward(r: {
  id: string;
  title: string;
  subtitle: string | null;
  payoutType: string;
  amountMinor: bigint;
  days: number;
  currency: string | null;
  status: string;
  createdAt: Date;
  availableAt: Date | null;
  items?: { payoutType: string; amountMinor: bigint; days: number }[];
}): ReferralRewardDTO {
  return {
    id: r.id,
    title: r.title,
    subtitle: r.subtitle ?? undefined,
    payoutType: r.payoutType as ReferralRewardDTO['payoutType'],
    amountMinor: r.amountMinor.toString(),
    days: r.days,
    currency: r.currency,
    status: r.status as ReferralRewardDTO['status'],
    claimable:
      r.status === 'accrued' &&
      (!r.availableAt || r.availableAt.getTime() <= Date.now()),
    createdAt: r.createdAt.toISOString(),
    availableAt: r.availableAt ? r.availableAt.toISOString() : null,
    items: r.items?.length ? r.items.map(mapBundleItem) : undefined,
  };
}

/** A bundle item row → its wire DTO (additive `items[]`). */
function mapBundleItem(it: {
  payoutType: string;
  amountMinor: bigint;
  days: number;
}): ReferralRewardItemDTO {
  return {
    kind: it.payoutType as ReferralRewardItemDTO['kind'],
    amountMinor: it.amountMinor.toString(),
    days: it.days,
  };
}

function isUniqueViolation(e: unknown): boolean {
  return (
    e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002'
  );
}

/** 3000 → "30%", 250 → "2.5%" (server-owned reward subtitles). Exported for tests. */
export function formatBpsPercent(bps: number): string {
  const pct = bps / 100;
  return Number.isInteger(pct)
    ? `${pct}%`
    : `${pct.toFixed(2).replace(/0+$/, '').replace(/\.$/, '')}%`;
}

/** USD minor units → "$12.34" (server-owned reward subtitles). */
function formatUsdMinor(minor: bigint): string {
  return `$${(Number(minor) / 100).toFixed(2)}`;
}

// ─── Reward bundle helpers ──────────────────────────────────────────────

/** A single payout inside a bundle — never membership_both (that's two items). */
type BundleItemKind =
  | 'cash'
  | 'points_compute'
  | 'points_community'
  | 'membership_compute'
  | 'membership_community';

interface BundleItem {
  payoutType: BundleItemKind;
  amountMinor: bigint;
  days: number;
  rank: number;
}

/** Normalize admin input (new `rewardItems[]` OR legacy
 *  payoutType/rewardMinor/payoutDays) into a bundle. Legacy membership_both →
 *  two items. Returns null when neither is provided (a partial update that
 *  doesn't touch rewards). */
function resolveTierItems(input: {
  rewardItems?: { kind: BundleItemKind; amountMinor?: number; days?: number }[];
  payoutType?: string;
  rewardMinor?: number;
  payoutDays?: number;
}): BundleItem[] | null {
  if (input.rewardItems?.length) {
    return input.rewardItems.map((it, idx) => ({
      payoutType: it.kind,
      amountMinor: BigInt(it.amountMinor ?? 0),
      days: it.days ?? 0,
      rank: idx,
    }));
  }
  if (input.payoutType) {
    return expandLegacyToItems(
      input.payoutType,
      BigInt(input.rewardMinor ?? 0),
      input.payoutDays ?? 0,
    );
  }
  return null;
}

/** Expand a single legacy payout into bundle items; membership_both → two. */
function expandLegacyToItems(
  payoutType: string,
  amountMinor: bigint,
  days: number,
): BundleItem[] {
  if (payoutType === 'membership_both') {
    return [
      { payoutType: 'membership_compute', amountMinor: 0n, days, rank: 0 },
      { payoutType: 'membership_community', amountMinor: 0n, days, rank: 1 },
    ];
  }
  return [
    { payoutType: payoutType as BundleItemKind, amountMinor, days, rank: 0 },
  ];
}

/** Legacy single-reward columns mirrored from a bundle's PRIMARY item (items[0])
 *  so the shipped mobile + headline totals keep working. A {compute,community}
 *  membership pair collapses back to membership_both. */
function legacyColumnsFromItems(items: BundleItem[]): {
  payoutType:
    | 'cash'
    | 'points_compute'
    | 'points_community'
    | 'membership_compute'
    | 'membership_community'
    | 'membership_both';
  rewardMinor: bigint;
  payoutDays: number;
} {
  const kinds = new Set(items.map((i) => i.payoutType));
  const bothMembership =
    items.length === 2 &&
    kinds.has('membership_compute') &&
    kinds.has('membership_community');
  const primary = items[0];
  const isMembership = primary.payoutType.startsWith('membership');
  return {
    payoutType: bothMembership ? 'membership_both' : primary.payoutType,
    rewardMinor: isMembership ? 0n : primary.amountMinor,
    payoutDays: isMembership ? primary.days : 0,
  };
}
