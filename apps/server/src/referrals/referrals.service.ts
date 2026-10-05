import {
  referralCashTotalsQuery,
  type ReferralCashTotalRow,
} from './referral-cash-totals';
import {
  BadRequestException,
  ConflictException,
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
import { defaultCurrency } from '../common/currency';
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
import { decodeUserId, encodeUserId } from '@repo/shared';
import type { RowDataPacket } from 'mysql2';
import { resolveReferralInviteBaseUrl } from './referrals.config';
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

type ReferralGrantContext = {
  tx: Prisma.TransactionClient;
  workspaceId?: string;
};

@Injectable()
export class ReferralsService {
  private readonly logger = new Logger(ReferralsService.name);
  // Best-effort recovery position only; durable payout truth stays in the DB.
  private readonly recoveryCursors = new Map<string, string>();
  private readonly commissionCursors = new Map<string, string>();
  // Validate at service construction so a missing origin fails startup,
  // before an invitation can be sent to the wrong site's account system.
  private readonly inviteBase = resolveReferralInviteBaseUrl(process.env);

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
    // Registration-based invitee perk (新人礼): if this viewer is a referred user
    // who hasn't been granted their welcome perk yet, accrue it now (no purchase
    // needed) so it shows up claimable. Best-effort.
    await this.accrueInviteePerkForReferee(userId).catch((e) =>
      this.logger.warn(
        `lazy invitee perk failed for ${userId}: ${e instanceof Error ? e.message : e}`,
      ),
    );
    // Recover historical partial payouts. Current claims commit atomically,
    // but older paid_out rows can still contain ungranted bundle items.
    await this.settleUnfinishedPaidOutRewards(userId).catch((e) =>
      this.logger.warn(
        `lazy reward settle failed for ${userId}: ${e instanceof Error ? e.message : e}`,
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
      this.prisma.$queryRaw<ReferralCashTotalRow[]>(
        referralCashTotalsQuery(userId),
      ),
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
        currency: m.payoutType === 'cash' ? defaultCurrency() : null,
        items: m.items.length ? m.items.map(mapBundleItem) : undefined,
      };
    });

    return {
      programAvailable: true,
      inviteCode: code,
      inviteUrl: code
        ? `${this.inviteBase}/register?recommendationCode=${encodeURIComponent(code)}`
        : null,
      currency: defaultCurrency(),
      totals: computeTotals(
        cashByStatus
          .filter((row) => row.currency === defaultCurrency())
          .map((row) => ({
            status: row.status,
            _sum: { amountMinor: BigInt(row.amount) },
          })),
        referralCount,
      ),
      cashTotals: [...new Set(cashByStatus.map((row) => row.currency))].map(
        (currency) => ({
          currency,
          ...computeTotals(
            cashByStatus
              .filter((row) => row.currency === currency)
              .map((row) => ({
                status: row.status,
                _sum: { amountMinor: BigInt(row.amount) },
              })),
            referralCount,
          ),
        }),
      ),
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
    // Program currency is NOT admin-settable — it is cell-derived (defaultCurrency:
    // CNY on .cn, USD on .com), so an admin-supplied currency is intentionally
    // ignored. A program only ever operates in its cell's one currency.
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
      await this.assertBundlePayable(items);
      data.inviteeBenefitItems = { deleteMany: {}, create: items };
      const primary = items[0];
      data.inviteeBenefitMinor =
        primary && primary.payoutType === 'cash' ? primary.amountMinor : 0n;
    }
    return this.prisma.$transaction(async (tx) => {
      await tx.referralProgram.update({
        where: { key: PROGRAM_KEY },
        data,
      });
      return this.loadAdminConfig(tx);
    });
  }

  async createMilestone(input: CreateReferralMilestoneInput) {
    // The bundle (items) is the source of truth; mirror its primary item into
    // the legacy payout columns so single-reward clients (shipped mobile) work.
    const items = resolveTierItems(input);
    if (!items?.length) {
      throw new BadRequestException('Reward bundle is required');
    }
    await this.assertBundlePayable(items);
    const legacy = legacyColumnsFromItems(items);
    return this.prisma.$transaction(async (tx) => {
      const program = await tx.referralProgram.findUniqueOrThrow({
        where: { key: PROGRAM_KEY },
        select: { id: true },
      });
      await tx.referralMilestoneConfig.create({
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
      return this.loadAdminConfig(tx);
    });
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
      await this.assertBundlePayable(items);
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
    return this.prisma.$transaction(async (tx) => {
      await tx.referralMilestoneConfig.update({ where: { id }, data });
      return this.loadAdminConfig(tx);
    });
  }

  /**
   * Refuse a reward bundle the payout path could not honour. A membership item
   * is only as good as its plan row: archive `community_membership` and every
   * tier carrying it becomes unclaimable, which the operator learns from a
   * recipient's failed claim rather than from the save that caused it. Checking
   * here moves that discovery to the person who can still fix it, and each
   * membership kind is mapped to the SAME plan key `grantSingle` will use.
   */
  private async assertBundlePayable(
    items: { payoutType: string }[],
  ): Promise<void> {
    const planKeys = new Set<string>();
    for (const item of items) {
      if (item.payoutType === 'membership_compute') {
        planKeys.add(COMPUTE_PLAN_KEY);
      } else if (item.payoutType === 'membership_community') {
        planKeys.add(COMMUNITY_MEMBERSHIP_PLAN_KEY);
      }
    }
    for (const planKey of planKeys) {
      await this.entitlements.assertPlanGrantable(
        planKey,
        BillingSubjectType.user,
      );
    }
  }

  async archiveMilestone(id: string) {
    return this.prisma.$transaction(async (tx) => {
      await tx.referralMilestoneConfig.update({
        where: { id },
        data: { archivedAt: new Date() },
      });
      return this.loadAdminConfig(tx);
    });
  }

  private async loadAdminConfig(tx: Prisma.TransactionClient = this.prisma) {
    const program = await tx.referralProgram.findUnique({
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
      currency: defaultCurrency(),
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
      // Encoded public id out; the map lookup + storage stay on the raw id.
      userId: encodeUserId(r.userId),
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
    // The dialog sends the encoded public id; store/query on the real id.
    const userId = decodeUserId(input.userId.trim());
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
      where: { programKey: PROGRAM_KEY, userId: decodeUserId(userId) },
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
    // Match on the decoded public id too, so an admin can paste the id they see.
    const decodedId = decodeUserId(q);
    const publicIdMatch = /^\d+$/.test(decodedId) && decodedId !== q;
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
                 ${publicIdMatch ? 'OR id = ?' : ''}
           ORDER BY id DESC LIMIT 10`,
        publicIdMatch
          ? [like, like, like, like, decodedId]
          : [like, like, like, like],
      );
      return rows.map((r) => ({
        userId: encodeUserId(String(r.id)),
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
    const attribution = await this.prisma.referralAttribution.findUnique({
      where: { refereeUserId: order.userId },
    });
    if (!attribution || attribution.status !== 'qualified') return;
    try {
      await this.prisma.$transaction(async (tx) => {
        const programs = await tx.$queryRaw<
          { id: string }[]
        >`SELECT id FROM referral_programs WHERE key=${attribution.programKey} FOR SHARE`;
        if (!programs.length) return;
        await tx.$queryRaw`SELECT id FROM billing_orders WHERE id=${order.id}::uuid FOR UPDATE`;
        await tx.$queryRaw`SELECT id FROM referral_attributions WHERE id=${attribution.id}::uuid FOR SHARE`;
        const currentOrder = await tx.billingOrder.findUnique({
          where: { id: order.id },
        });
        const currentAttribution = await tx.referralAttribution.findUnique({
          where: { id: attribution.id },
        });
        if (
          !currentOrder ||
          currentOrder.userId !== order.userId ||
          currentOrder.amountMinor <= 0n ||
          (currentOrder.status !== BillingOrderStatus.paid &&
            currentOrder.status !== BillingOrderStatus.fulfilled) ||
          currentOrder.orderType === BillingOrderType.manual_adjustment ||
          !currentAttribution ||
          currentAttribution.status !== 'qualified' ||
          currentAttribution.programKey !== attribution.programKey ||
          currentAttribution.referrerUserId !== attribution.referrerUserId
        )
          return;
        const program = await tx.referralProgram.findUnique({
          where: { key: currentAttribution.programKey },
        });
        if (!program || !program.enabled) return;
        const override = await tx.referralCommissionRate.findUnique({
          where: {
            programKey_userId: {
              programKey: currentAttribution.programKey,
              userId: currentAttribution.referrerUserId,
            },
          },
        });
        const bps = override ? override.commissionBps : program.commissionBps;
        if (bps <= 0) return;
        if (
          currentOrder.currency !== 'USD' &&
          currentOrder.currency !== 'CNY'
        ) {
          // Skip loudly rather than throw — this hook must never read as a
          // billing failure.
          this.logger.warn(
            `commission skipped for order ${currentOrder.id}: unsupported currency ${currentOrder.currency}`,
          );
          return;
        }
        // NOTE: CNY commission accrues here AND its cash payout credits the WITHDRAWABLE
        // community_point pool 1:1 (1 point = 1 CNY 分, symmetric with USD's 1 point = 1
        // cent — see the 'cash' grant path). Only the final 提现 (points → real money via
        // WeChat 商家转账) remains unbuilt, the same as USD.
        const amount = (currentOrder.amountMinor * BigInt(bps)) / 10000n;
        if (amount <= 0n) return;

        const [clock] = await tx.$queryRaw<
          { now: Date }[]
        >`SELECT clock_timestamp() AS now`;
        const availableAt = new Date(
          clock.now.getTime() + program.holdDays * DAY_MS,
        );
        await tx.referralReward.create({
          data: {
            programKey: program.key,
            userId: currentAttribution.referrerUserId,
            kind: 'commission',
            status: 'accrued',
            payoutType: 'cash',
            amountMinor: amount,
            currency: currentOrder.currency,
            title: 'Purchase commission',
            subtitle: `${formatBpsPercent(bps)} of a friend's ${formatMoneyMinor(currentOrder.amountMinor, currentOrder.currency)} purchase`,
            orderId: currentOrder.id,
            commissionBps: bps,
            sourceAmountMinor: currentOrder.amountMinor,
            availableAt,
            items: {
              create: [
                {
                  payoutType: 'cash',
                  amountMinor: amount,
                  days: 0,
                  currency: currentOrder.currency,
                  rank: 0,
                },
              ],
            },
          },
        });
        this.logger.log(
          `Commission accrued: order=${currentOrder.id} referrer=${currentAttribution.referrerUserId} bps=${bps} amountMinor=${amount}`,
        );
      });
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
    if (!attribution || attribution.status !== 'qualified') {
      this.commissionCursors.delete(refereeUserId);
      return;
    }
    const cursor = this.commissionCursors.get(refereeUserId);
    const orders = await this.prisma.billingOrder.findMany({
      where: {
        userId: refereeUserId,
        ...(cursor ? { id: { gt: cursor } } : {}),
        status: {
          in: [BillingOrderStatus.paid, BillingOrderStatus.fulfilled],
        },
        orderType: { not: BillingOrderType.manual_adjustment },
        createdAt: { gte: new Date(Date.now() - 48 * 60 * 60 * 1000) },
      },
      orderBy: { id: 'asc' },
      take: 20,
      select: { id: true, userId: true, amountMinor: true, currency: true },
    });
    if (!orders.length) {
      this.commissionCursors.delete(refereeUserId);
      return;
    }
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
      try {
        await this.accrueCommissionForOrder(order);
      } catch (error) {
        // One failing order must not block independent commissions in this
        // bounded batch. Missing rewards remain eligible when the scan wraps.
        this.logger.warn(
          `commission backfill failed for order ${order.id}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
    // Traverse all eligible orders, including pages behind already rewarded or
    // failing orders. A short page wraps the next read back to retained failures.
    // This is only a bounded local cursor; transactional accrual stays authoritative.
    this.commissionCursors.delete(refereeUserId);
    if (orders.length === 20) {
      if (this.commissionCursors.size >= 1_000) {
        const oldest = this.commissionCursors.keys().next();
        if (!oldest.done) this.commissionCursors.delete(oldest.value);
      }
      this.commissionCursors.set(refereeUserId, orders[orders.length - 1].id);
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

    await this.prisma.$transaction(async (tx) => {
      const lockedProgram = await tx.$queryRaw<
        { id: string }[]
      >`SELECT id FROM referral_programs WHERE key=${attribution.programKey} FOR SHARE`;
      if (!lockedProgram.length) return;
      // The cap belongs to the referrer, not an individual invitee. Serialize
      // count-and-create across different invitees qualifying concurrently.
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`referral:qualification:${attribution.referrerUserId}`}, 0))::text`;
      await tx.$queryRaw`SELECT id FROM billing_orders WHERE user_id=${refereeUserId} AND status IN ('paid', 'fulfilled') AND order_type <> 'manual_adjustment' ORDER BY id FOR SHARE`;
      await tx.$queryRaw`SELECT id FROM referral_attributions WHERE id=${attribution.id}::uuid FOR UPDATE`;
      const current = await tx.referralAttribution.findUnique({
        where: { id: attribution.id },
      });
      if (
        !current ||
        current.status !== 'pending' ||
        current.referrerUserId !== attribution.referrerUserId ||
        current.programKey !== attribution.programKey
      )
        return;
      const program = await tx.referralProgram.findUnique({
        where: { key: current.programKey },
      });
      if (!program?.enabled) return;
      // Hold the backing purchases through qualification. A refund completed
      // during admission must not create a newly qualified attribution.
      const paidTotal = await tx.billingOrder.count({
        where: {
          userId: refereeUserId,
          status: {
            in: [BillingOrderStatus.paid, BillingOrderStatus.fulfilled],
          },
          orderType: { not: BillingOrderType.manual_adjustment },
        },
      });
      if (paidTotal === 0) return;
      const [clock] = await tx.$queryRaw<
        { now: Date }[]
      >`SELECT clock_timestamp() AS now`;
      const now = clock.now;
      const availableAt = new Date(now.getTime() + program.holdDays * DAY_MS);
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
              currency: defaultCurrency(),
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
                    currency: defaultCurrency(),
                    rank: 0,
                  },
                ],
              },
            },
          });
        }
      }

      // The invitee welcome perk (被邀请人福利) is NO LONGER accrued here — it
      // moved to a REGISTRATION-based lazy path (accrueInviteePerkForReferee):
      // the referred user earns it just for registering with a code, no purchase
      // required. Same as the milestone ladder. This tx only qualifies the
      // attribution (gates commission) + the flat per-referral reward.
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
    await this.prisma.$transaction(async (tx) => {
      const lockedProgram = await tx.$queryRaw<
        { id: string }[]
      >`SELECT id FROM referral_programs WHERE key=${PROGRAM_KEY} FOR SHARE`;
      if (!lockedProgram.length) return;
      await tx.$queryRaw`SELECT m.id FROM referral_milestone_configs m JOIN referral_programs p ON p.id=m.program_id WHERE p.key=${PROGRAM_KEY} ORDER BY m.id FOR SHARE OF m`;
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`referral:registration:${referrerUserId}`}, 0))::text`;
      const program = await tx.referralProgram.findUnique({
        where: { key: PROGRAM_KEY },
        include: {
          milestones: {
            where: { archivedAt: null },
            include: { items: { orderBy: { rank: 'asc' } } },
          },
        },
      });
      if (!program || !program.enabled || !program.milestones.length) return;
      // Immediately claimable — same as the invitee perk: tiers are registration-
      // based and reverseForOrder never reverses them, so the program's holdDays
      // (which exists to cover the refund window on purchase-backed cash rewards)
      // buys nothing here and only delays the 领取 button.
      const [clock] = await tx.$queryRaw<
        { now: Date }[]
      >`SELECT clock_timestamp() AS now`;
      const availableAt = clock.now;

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
          currency: m.payoutType === 'cash' ? defaultCurrency() : null,
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
            currency: it.payoutType === 'cash' ? defaultCurrency() : null,
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
   * Invitee welcome perk (新人礼) — REGISTRATION-based. The referred user earns
   * the configured bundle just for registering with a code; NO purchase needed
   * (community points can't buy generation, so there's nothing to farm). Accrued
   * LAZILY on the referee's own dashboard view — there is no signup webhook — as
   * an 'accrued' reward they then manually 领取. Idempotent: at most one invitee
   * reward per referee (partial unique index referral_reward_one_invitee_per_user
   * on user_id WHERE kind='invitee'); a lost race just P2002s and is swallowed.
   */
  private async accrueInviteePerkForReferee(
    refereeUserId: string,
  ): Promise<void> {
    const attribution = await this.prisma.referralAttribution.findUnique({
      where: { refereeUserId },
      select: { programKey: true },
    });
    if (!attribution) return; // not a referred user
    try {
      await this.prisma.$transaction(async (tx) => {
        const lockedProgram = await tx.$queryRaw<
          { id: string }[]
        >`SELECT id FROM referral_programs WHERE key=${attribution.programKey} FOR SHARE`;
        if (!lockedProgram.length) return;
        await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`referral:registration:${refereeUserId}`}, 0))::text`;
        const program = await tx.referralProgram.findUnique({
          where: { key: attribution.programKey },
          include: { inviteeBenefitItems: { orderBy: { rank: 'asc' } } },
        });
        if (
          !program ||
          !program.enabled ||
          !program.inviteeBenefitItems.length
        ) {
          return;
        }
        // One invitee reward per referee — cheap pre-check before the insert.
        const existing = await tx.referralReward.findFirst({
          where: { userId: refereeUserId, kind: 'invitee' },
          select: { id: true },
        });
        if (existing) return;

        const items = program.inviteeBenefitItems.map((it) => ({
          payoutType: it.payoutType,
          amountMinor: it.amountMinor,
          days: it.days,
          currency: it.payoutType === 'cash' ? defaultCurrency() : null,
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
            // Immediately claimable — a welcome gift, not a fraud-risk cash payout,
            // so no hold window. The user still has to press 领取.
            availableAt: new Date(),
            items: { create: items },
          },
        });
      });
      this.logger.log(
        `Invitee perk accrued (registration-based): referee=${refereeUserId}`,
      );
    } catch (e) {
      // Concurrent dashboard view already granted it — the partial unique index
      // rejects the duplicate. Any other error is real.
      if (
        !(
          e instanceof Prisma.PrismaClientKnownRequestError &&
          e.code === 'P2002'
        )
      ) {
        throw e;
      }
    }
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
    const result = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM billing_orders WHERE id=${orderId}::uuid FOR UPDATE`;
      const order = await tx.billingOrder.findUnique({
        where: { id: orderId },
        select: { id: true, userId: true, status: true },
      });
      if (!order || order.status !== BillingOrderStatus.refunded) return null;
      const commission = await tx.referralReward.updateMany({
        where: { orderId: order.id, kind: 'commission', status: 'accrued' },
        data: { status: 'reversed' },
      });
      const outcome = {
        commission: commission.count,
        refereeUserId: order.userId,
        reversed: false,
      };
      const paidWhere = {
        userId: order.userId,
        status: { in: [BillingOrderStatus.paid, BillingOrderStatus.fulfilled] },
        orderType: { not: BillingOrderType.manual_adjustment },
      };
      await tx.$queryRaw`SELECT id FROM billing_orders WHERE user_id=${order.userId} AND status IN ('paid', 'fulfilled') AND order_type <> 'manual_adjustment' ORDER BY id FOR SHARE`;
      if (await tx.billingOrder.count({ where: paidWhere })) return outcome;
      const attribution = await tx.referralAttribution.findUnique({
        where: { refereeUserId: order.userId },
      });
      if (!attribution || attribution.status !== 'qualified') return outcome;
      await tx.$queryRaw`SELECT id FROM referral_attributions WHERE id=${attribution.id}::uuid FOR UPDATE`;
      // A new backing purchase may have committed while attribution was locked.
      if (await tx.billingOrder.count({ where: paidWhere })) return outcome;
      const claimed = await tx.referralAttribution.updateMany({
        where: { id: attribution.id, status: 'qualified' },
        data: { status: 'reversed' },
      });
      if (claimed.count === 0) return outcome;
      await tx.referralReward.updateMany({
        where: { attributionId: attribution.id, status: 'accrued' },
        data: { status: 'reversed' },
      });
      await tx.referralReward.updateMany({
        where: { userId: order.userId, kind: 'invitee', status: 'accrued' },
        data: { status: 'reversed' },
      });
      // Already paid rewards and registration milestones retain existing policy.
      return { ...outcome, reversed: true };
    });
    if (result?.commission)
      this.logger.log(`Commission reversed (refund): order=${orderId}`);
    if (result?.reversed)
      this.logger.log(
        `Referral reversed (refund): referee=${result.refereeUserId}`,
      );
  }

  /** Commit the bundle, its markers and paid-out state together. Historical
   * paid-out rows can still recover missing items through their original intents. */
  async claimReward(
    userId: string,
    rewardId: string,
  ): Promise<{ status: string }> {
    const run = () =>
      this.prisma.$transaction(
        async (tx) => {
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`referral:claim-user:${userId}`})::bigint)`;
          await tx.$queryRaw`SELECT id FROM referral_rewards WHERE id=${rewardId}::uuid FOR UPDATE`;
          const reward = await tx.referralReward.findUnique({
            where: { id: rewardId },
          });
          if (!reward || reward.userId !== userId)
            throw new NotFoundException('Reward not found');
          if (reward.status !== 'accrued' && reward.status !== 'paid_out')
            throw new BadRequestException('Reward is not claimable');
          const [clock] = await tx.$queryRaw<
            Array<{ now: Date }>
          >`SELECT clock_timestamp() AS now`;
          if (
            reward.status === 'accrued' &&
            reward.availableAt &&
            reward.availableAt > clock.now
          )
            throw new BadRequestException('Reward is still in its hold window');
          const context: ReferralGrantContext = { tx };
          // Prepare default accounts before any bundle writes. The workspace service
          // uses its own transaction; calling it after an uncommitted wallet write
          // could wait on this very transaction. Existing credits retain their owner.
          const items = await tx.referralRewardItem.findMany({
            where: { rewardId },
            orderBy: { rank: 'asc' },
          });
          for (const item of items) {
            if (
              item.grantedAt ||
              item.payoutType !== 'points_compute' ||
              item.amountMinor <= 0n
            )
              continue;
            const prior = await tx.walletTransaction.findUnique({
              where: {
                idempotencyKey: `referral_reward:${rewardId}:${item.id}:compute`,
              },
            });
            if (!prior) {
              context.workspaceId = (
                await this.workspaces.ensureDefaultWorkspace({ userId })
              ).id;
              break;
            }
          }
          await this.grantReward(reward, context);
          if (reward.status === 'accrued')
            await tx.referralReward.updateMany({
              where: { id: reward.id, status: 'accrued' },
              data: { status: 'paid_out', paidOutAt: clock.now },
            });
          return { status: 'paid_out' };
        },
        { timeout: 15000, maxWait: 10000 },
      );
    try {
      return await run();
    } catch (e) {
      if (!isUniqueViolation(e)) throw e;
      return run();
    }
  }

  /**
   * Re-run the payout for this user's `paid_out` rewards that still hold
   * ungranted bundle items. `grantReward` skips anything already granted, so
   * this only ever pays the remainder; a still-broken item logs and leaves the
   * rest of the dashboard to render.
   */
  private async settleUnfinishedPaidOutRewards(userId: string): Promise<void> {
    const cursor = this.recoveryCursors.get(userId);
    const stranded = await this.prisma.referralReward.findMany({
      where: {
        userId,
        status: 'paid_out',
        items: { some: { grantedAt: null } },
        ...(cursor ? { id: { gt: cursor } } : {}),
      },
      select: { id: true, userId: true, currency: true },
      orderBy: { id: 'asc' },
      take: 20,
    });
    for (const reward of stranded) {
      try {
        await this.claimReward(userId, reward.id);
        this.logger.log(`Settled stranded reward ${reward.id} for ${userId}`);
      } catch (e) {
        this.logger.warn(
          `settle failed for reward ${reward.id}: ${e instanceof Error ? e.message : e}`,
        );
      }
    }
    // Advance even after payout failures, then wrap to retry skipped rewards.
    // Bound per-process memory; eviction/restart merely restarts a user's scan.
    this.recoveryCursors.delete(userId);
    if (stranded.length === 20) {
      if (this.recoveryCursors.size >= 1_000) {
        const oldest = this.recoveryCursors.keys().next();
        if (!oldest.done) this.recoveryCursors.delete(oldest.value);
      }
      this.recoveryCursors.set(userId, stranded[stranded.length - 1].id);
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
  private async grantReward(
    reward: {
      id: string;
      userId: string;
      currency: string | null;
    },
    context: ReferralGrantContext,
  ): Promise<void> {
    const items = await context.tx.referralRewardItem.findMany({
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
        context,
      );
      await context.tx.referralRewardItem.updateMany({
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
    context: ReferralGrantContext,
  ): Promise<void> {
    switch (payoutType) {
      case 'membership_compute':
        await this.grantMembership(
          userId,
          COMPUTE_PLAN_KEY,
          days,
          idemId,
          context,
        );
        break;
      case 'membership_community':
        await this.grantMembership(
          userId,
          COMMUNITY_MEMBERSHIP_PLAN_KEY,
          days,
          idemId,
          context,
        );
        break;
      case 'points_compute':
        await this.creditComputePoints(userId, amountMinor, idemId, context);
        break;
      case 'points_community':
        await this.creditCommunityPoints(
          userId,
          amountMinor,
          idemId,
          WalletBalanceKind.consumable,
          context,
        );
        break;
      case 'cash':
        // Cash → the WITHDRAWABLE community_point pool, 1 point = 1 minor unit of
        // the reward currency (1 point = 1 US cent in com, 1 CNY 分 in cn). Cells
        // are separate deployments so a user's withdrawable pool is single-
        // currency; crediting amountMinor 1:1 holds the money faithfully. The
        // 提现 cash-out (points → real money, e.g. WeChat 企业付款) is a separate
        // unbuilt step — until it ships the balance simply accrues.
        if (currency !== 'USD' && currency !== 'CNY') {
          throw new BadRequestException(
            `Cash referral payout supports USD/CNY only (got ${currency ?? 'null'})`,
          );
        }
        await this.creditCommunityPoints(
          userId,
          amountMinor,
          idemId,
          WalletBalanceKind.withdrawable,
          context,
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
    context: ReferralGrantContext,
  ): Promise<void> {
    if (days <= 0) return;
    await this.entitlements.grantComplimentary(
      {
        subjectType: BillingSubjectType.user,
        subjectId: userId,
        planKey,
        durationDays: days,
        sourceType: 'referral_reward',
        sourceId: `${rewardId}:${planKey}`,
        metadata: { rewardId },
      },
      context.tx,
    );
  }

  private async creditComputePoints(
    userId: string,
    amount: bigint,
    rewardId: string,
    context: ReferralGrantContext,
  ): Promise<void> {
    await this.creditReferralWallet(
      userId,
      amount,
      rewardId,
      WalletCurrencyType.compute_point,
      WalletBalanceKind.consumable,
      context,
    );
  }

  private async creditCommunityPoints(
    userId: string,
    amount: bigint,
    rewardId: string,
    balanceKind: WalletBalanceKind,
    context: ReferralGrantContext,
  ): Promise<void> {
    await this.creditReferralWallet(
      userId,
      amount,
      rewardId,
      WalletCurrencyType.community_point,
      balanceKind,
      context,
    );
  }

  private async creditReferralWallet(
    userId: string,
    amount: bigint,
    rewardId: string,
    currency: WalletCurrencyType,
    balanceKind: WalletBalanceKind,
    context: ReferralGrantContext,
  ): Promise<void> {
    if (amount <= 0n) return;
    const compute = currency === WalletCurrencyType.compute_point;
    const idempotencyKey = `referral_reward:${rewardId}:${compute ? 'compute' : `community:${balanceKind}`}`;
    const write = async (tx: Prisma.TransactionClient) => {
      // Serialize this reward before selecting its destination. A replacement
      // default workspace must not redirect an already committed credit.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`referral:credit:${idempotencyKey}`})::bigint)`;
      const prior = await tx.walletTransaction.findUnique({
        where: { idempotencyKey },
        include: { entries: { include: { account: true } } },
      });
      let account = prior?.entries[0]?.account;
      if (
        prior &&
        (prior.actorUserId !== userId ||
          prior.entries.length !== 1 ||
          !account ||
          account.currency !== currency ||
          account.balanceKind !== balanceKind ||
          account.ownerType !==
            (compute ? WalletOwnerType.workspace : WalletOwnerType.user) ||
          (!compute && account.ownerId !== userId))
      ) {
        throw new ConflictException({
          code: 'REFERRAL_CREDIT_INTENT_CONFLICT',
          msg: 'The recorded referral credit does not match this reward destination.',
        });
      }
      if (!account) {
        const ownerId = compute ? context.workspaceId : userId;
        if (!ownerId)
          throw new ConflictException(
            'Referral destination must be prepared before bundle writes',
          );
        const identity = {
          ownerType: compute ? WalletOwnerType.workspace : WalletOwnerType.user,
          ownerId,
          currency,
          balanceKind,
        };
        await tx.walletAccount.createMany({
          data: { ...identity, status: WalletAccountStatus.active },
          skipDuplicates: true,
        });
        account = await tx.walletAccount.findUniqueOrThrow({
          where: { ownerType_ownerId_currency_balanceKind: identity },
        });
      }
      await this.walletLedger.postEntryTx(tx, {
        accountId: account.id,
        entryType: WalletLedgerEntryType.credit,
        amount,
        availableDelta: amount,
        heldDelta: 0n,
        sourceType: 'referral_reward',
        sourceId: rewardId,
        idempotencyKey,
        actorUserId: userId,
        workspaceId: compute ? account.ownerId : undefined,
        reason: 'referral_reward',
        description: compute
          ? 'Referral reward — compute points'
          : 'Referral reward — community points',
        metadata: { rewardId },
        // Preserve the existing promotional-credit expiry and non-expiring
        // withdrawable pool. Replays retain the first recorded grant expiry.
        creditGrant:
          balanceKind === WalletBalanceKind.consumable
            ? {
                grantType: WalletCreditGrantType.system_grant,
                expiresAt: promoCreditExpiresAt(),
                metadata: { rewardId },
              }
            : undefined,
      });
    };
    await write(context.tx);
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
  items?: {
    payoutType: string;
    amountMinor: bigint;
    days: number;
    currency?: string | null;
  }[];
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
  currency?: string | null;
  payoutType: string;
  amountMinor: bigint;
  days: number;
}): ReferralRewardItemDTO {
  return {
    kind: it.payoutType as ReferralRewardItemDTO['kind'],
    currency:
      it.payoutType === 'cash' ? (it.currency ?? defaultCurrency()) : null,
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
/** Currency-aware money format for reward copy (USD / CNY). */
function formatMoneyMinor(minor: bigint, currency: string): string {
  const major = (Number(minor) / 100).toFixed(2);
  return currency === 'CNY' ? `¥${major}` : `$${major}`;
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
