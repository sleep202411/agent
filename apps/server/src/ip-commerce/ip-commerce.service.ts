import { listReportPurchases, requireReportPurchase } from './report-purchases';
import type { ListReportPurchasesQuery } from './dto';
import { lockMediaAssetReference } from '../media/media-asset-lifecycle-lock';
import { createCrewTx } from '../crews/create-crew';
import { hasCrewCreatePass } from '../integrations/java/user-level-gates';
import { ensureWalletAccount } from '../workspaces/wallet-account-admission';
import { ConversationsService } from '../conversations/conversations.service';
import { joinCrewFanTx } from '../crews/fan-community';
import { publishersFromAssignments } from './ip-publishers.service';
import { EPISODE_SOURCE_MAX_BYTES } from '@repo/shared';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  IpAclPermission,
  IpAccessMode,
  IpCampaignStatus,
  IpAgeRating,
  IpAssetPurpose,
  IpContributorRole,
  IpTargetType,
  IpCollectionItemStatus,
  IpDiscoveryPlacementKey,
  IpDiscoveryRecommendationStatus,
  IpEntitlementStatus,
  IpEngagementActorKind,
  IpLocalizationStatus,
  IpListingVisibility,
  IpLikeStatus,
  IpModerationActionType,
  IpModerationTargetType,
  IpPriceRuleStatus,
  IpPublicationStatus,
  IpPurchaseOrderStatus,
  IpReportStatus,
  IpReferralLinkStatus,
  IpReviewEventType,
  IpReviewStatus,
  IpReviewTargetType,
  IpRevenueLedgerEntryType,
  IpRevenueLedgerStatus,
  IpTaxonomyAssignmentSource,
  IpTaxonomyTermStatus,
  IpTaxonomyTermType,
  IpUserBlockTargetType,
  MediaAssetKind,
  MediaAssetStatus,
  MediaAssetVariantStatus,
  MediaAssetVisibility,
  MediaObjectPlacementStatus,
  Prisma,
  WalletAccountStatus,
  WalletBalanceKind,
  WalletCurrencyType,
  WalletLedgerEntryType,
  WalletOwnerType,
  WalletTransactionStatus,
} from '@prisma/client';
import { createHash, randomUUID } from 'crypto';
import { decodeUserId, encodeUserId } from '@repo/shared';
import { regionLabel as sharedRegionLabel } from '@repo/shared/regions';
import type { AuthUser } from '../auth';
import { hasFreeIpWatchPass } from '../integrations/java/user-level-gates';
import {
  applyMemberDiscount,
  clampBps,
  computeRevenueSplit,
} from './revenue-split';
import { formatSettlementPeriod } from './member-pool';
import {
  encodePublicIpRankCursor,
  publicIpRankQuery,
  type PublicIpRankRow,
} from './ip-plaza-ranking';
import { PrismaService } from '../infra/db/db.module';
import { OutputStorageService } from '../infra/storage/storage.types';
import {
  resolveMediaPlaybackUrl,
  type ResolvableMediaAssetVariant,
} from '../infra/storage/media-asset-url-resolver.service';
import { LegacyCnVideoResolverService } from './legacy-cn-video.service';
import {
  WalletLedgerService,
  consumeAvailableGrantsTx,
  expireLapsedGrantsTx,
} from '../workspaces';
import { EntitlementService } from '../entitlements';
import { LegacyMysqlService } from '../infra/legacy-mysql';
import type { RowDataPacket } from 'mysql2/promise';
import type {
  CreateIpDraftInput,
  CreateCreatorIpContributorInput,
  CreateCreatorIpEpisodeInput,
  GrantCreatorIpAclInput,
  TransferIpOwnerInput,
  CreatorRevenueQuery,
  ListAdminIpRevenueQuery,
  UpdateAdminIpRevenueConfigInput,
  CreateAdminIpTaxonomyTermInput,
  CreateAdminIpDiscoveryInput,
  CreateIpContentReportInput,
  ListMyContentReportsQuery,
  ListMyContentBlocksQuery,
  RecordMemberViewInput,
  RecordIpViewInput,
  CreateIpPurchaseInput,
  GrantAdminIpEntitlementInput,
  IpAccessQuery,
  ListIpTaxonomyTermsQuery,
  ListAdminIpEntitlementsQuery,
  ListAdminIpOrdersQuery,
  ListCreatorIpAssetsQuery,
  ListCreatorIpsQuery,
  ListAdminIpsQuery,
  ListAdminIpDiscoveryQuery,
  ListPublicIpDiscoveryQuery,
  ReorderAdminIpDiscoveryInput,
  UpdateAdminIpDiscoveryInput,
  ListIpsQuery,
  RandomIpSeedsQuery,
  RevokeAdminIpEntitlementInput,
  ResolveAdminIpReportInput,
  SubmitCreatorIpReviewInput,
  UploadCreatorIpMediaQuery,
  UploadCreatorIpMediaInput,
  UpdateCreatorIpAssetsInput,
  UpdateAdminIpTaxonomyTermInput,
  UpdateCreatorIpContributorInput,
  UpdateCreatorIpEpisodeInput,
  UpdateAdminIpPublicationInput,
  UpdateCreatorIpProfileInput,
  UpsertIpCollectionItemInput,
  UpsertCreatorIpPriceRuleInput,
  UpsertIpUserBlockInput,
} from './dto';

const PUBLIC_IP_STATUSES: IpPublicationStatus[] = [
  IpPublicationStatus.scheduled,
  IpPublicationStatus.published,
];
const PUBLIC_EPISODE_STATUSES: IpPublicationStatus[] = [
  IpPublicationStatus.scheduled,
  IpPublicationStatus.published,
];
const DEFAULT_IP_LOCALE = 'zh-CN';
const PUBLIC_LOCALIZATION_STATUSES: IpLocalizationStatus[] = [
  IpLocalizationStatus.published,
];

// (a)-policy: content (localization / episode) created or edited on a
// publicly-live IP (status `published`) goes live immediately instead of being
// reset to `draft` — editing a published IP no longer hides it / its episodes.
// On a not-yet-published IP, content still defaults to draft (pre-publish).
// NOTE: this relaxes the admin re-review gate for published IPs; revisit if UGC
// moderation is enforced.
function contentLocalizationStatus(
  ipStatus: IpPublicationStatus,
): IpLocalizationStatus {
  return ipStatus === IpPublicationStatus.published
    ? IpLocalizationStatus.published
    : IpLocalizationStatus.draft;
}
function contentEpisodeStatus(
  ipStatus: IpPublicationStatus,
): IpPublicationStatus {
  return ipStatus === IpPublicationStatus.published
    ? IpPublicationStatus.published
    : IpPublicationStatus.draft;
}
const IP_MEDIA_UPLOAD_LIMITS: Record<MediaAssetKind, number> = {
  [MediaAssetKind.image]: 20 * 1024 * 1024,
  [MediaAssetKind.video]: 2 * 1024 * 1024 * 1024,
  [MediaAssetKind.audio]: 64 * 1024 * 1024,
  [MediaAssetKind.document]: 20 * 1024 * 1024,
  [MediaAssetKind.other]: 20 * 1024 * 1024,
};

/// Admin-editable platform default for the creator revenue share (basis points
/// of each sale routed to the creator pool). Seeded at 5000 (50%) by migration.
const IP_CREATOR_REVENUE_SHARE_SETTING_KEY = 'ip.creator_revenue_share_bps';
/// Hard fallback if the settings row is ever missing.
const IP_CREATOR_REVENUE_SHARE_DEFAULT_BPS = 5000;
/// In-process TTL (ms) for the cached default share — busted on admin write.
const IP_CREATOR_REVENUE_SHARE_CACHE_TTL_MS = 30_000;

const IP_MEMBER_DISCOUNT_SETTING_KEY = 'ip.member_discount_bps';
/// Hard fallback if the settings row is ever missing (20% community-member discount).
const IP_MEMBER_DISCOUNT_DEFAULT_BPS = 2000;
/// In-process TTL (ms) for the cached default member discount — busted on admin write.
const IP_MEMBER_DISCOUNT_CACHE_TTL_MS = 30_000;

const taxonomyAssignmentInclude = {
  term: {
    include: {
      localizations: {
        orderBy: [{ locale: 'asc' }, { updatedAt: 'desc' }],
      },
    },
  },
} satisfies Prisma.IpTaxonomyAssignmentInclude;

const adminTaxonomyTermInclude = {
  localizations: {
    orderBy: [{ locale: 'asc' }, { updatedAt: 'desc' }],
  },
  _count: {
    select: {
      assignments: true,
    },
  },
} satisfies Prisma.IpTaxonomyTermInclude;

/**
 * For a VIDEO asset, load the ready ABR-HLS `stream` variant (+ its active
 * placement) so `assetDto` can prefer the HLS rendition over the original mp4
 * (`resolveMediaPlaybackUrl`). Filtering to `ready`/`active` here means a
 * pending/failed transcode never surfaces — playback transparently keeps the
 * mp4. Used for every video relation (episode media + trailers).
 */
const mediaAssetPlaybackInclude = {
  variants: {
    where: { deletedAt: null, status: MediaAssetVariantStatus.ready },
    include: {
      placements: {
        where: {
          deletedAt: null,
          status: MediaObjectPlacementStatus.active,
        },
      },
    },
  },
} satisfies Prisma.MediaAssetInclude;

const ipInclude = {
  coverAsset: true,
  trailerAsset: { include: mediaAssetPlaybackInclude },
  localizations: {
    where: { archivedAt: null },
    orderBy: [{ locale: 'asc' }, { updatedAt: 'desc' }],
    include: { coverAsset: true },
  },
  taxonomyAssignments: {
    orderBy: [{ displayOrder: 'asc' }, { createdAt: 'asc' }],
    include: taxonomyAssignmentInclude,
  },
  episodes: {
    where: {
      deletedAt: null,
      status: { in: PUBLIC_EPISODE_STATUSES },
    },
    orderBy: [{ sortOrder: 'asc' }, { episodeNo: 'asc' }],
    include: {
      localizations: {
        where: { archivedAt: null },
        orderBy: [{ locale: 'asc' }, { updatedAt: 'desc' }],
      },
      coverAsset: true,
      mediaAsset: { include: mediaAssetPlaybackInclude },
      trailerAsset: { include: mediaAssetPlaybackInclude },
      priceRules: {
        where: {
          status: IpPriceRuleStatus.active,
          archivedAt: null,
        },
        orderBy: [{ priority: 'desc' }, { amount: 'asc' }],
      },
    },
  },
  priceRules: {
    where: {
      status: IpPriceRuleStatus.active,
      archivedAt: null,
    },
    orderBy: [{ priority: 'desc' }, { amount: 'asc' }],
  },
  campaigns: {
    where: {
      status: { in: [IpCampaignStatus.scheduled, IpCampaignStatus.active] },
      archivedAt: null,
    },
    orderBy: [{ startsAt: 'asc' }, { createdAt: 'desc' }],
    include: {
      localizations: {
        where: { archivedAt: null },
        orderBy: [{ locale: 'asc' }, { updatedAt: 'desc' }],
      },
    },
  },
  // Public creator team — only listed members, ordered. Drives the IP detail
  // "creator team" card + the per-member avatars (resolved to live Java
  // name/avatar by userId on the web).
  contributors: {
    where: { isPublic: true, removedAt: null },
    orderBy: { displayOrder: 'asc' },
  },
  publisherAssignments: {
    orderBy: [{ displayOrder: 'asc' }, { createdAt: 'asc' }],
    include: { publisher: true },
  },
} satisfies Prisma.IpInclude;

type IpWithCommerce = Prisma.IpGetPayload<{
  include: typeof ipInclude;
}>;

export interface IpEngagementStats {
  viewCount: number;
  likeCount: number;
  collectionCount: number;
  humanViewCount: number;
  agentViewCount: number;
  humanLikeCount: number;
  agentLikeCount: number;
  viewerHasLiked: boolean;
}

type ViewerBlockLists = {
  blockedIpIds: string[];
  blockedCreatorIds: string[];
};

type IpEngagementActor = {
  userId: string | null;
  actorKind: IpEngagementActorKind;
};

type IpEngagementLikeActor = {
  userId: string;
  actorKind: IpEngagementActorKind;
};

const adminIpInclude = {
  coverAsset: true,
  trailerAsset: { include: mediaAssetPlaybackInclude },
  localizations: {
    where: { archivedAt: null },
    orderBy: [{ locale: 'asc' }, { updatedAt: 'desc' }],
    include: { coverAsset: true },
  },
  taxonomyAssignments: {
    orderBy: [{ displayOrder: 'asc' }, { createdAt: 'asc' }],
    include: taxonomyAssignmentInclude,
  },
  episodes: {
    where: { deletedAt: null },
    orderBy: [{ sortOrder: 'asc' }, { episodeNo: 'asc' }],
    include: {
      localizations: {
        where: { archivedAt: null },
        orderBy: [{ locale: 'asc' }, { updatedAt: 'desc' }],
      },
      coverAsset: true,
      mediaAsset: { include: mediaAssetPlaybackInclude },
      trailerAsset: { include: mediaAssetPlaybackInclude },
      priceRules: {
        where: { archivedAt: null },
        orderBy: [{ status: 'asc' }, { priority: 'desc' }, { amount: 'asc' }],
      },
      _count: {
        select: {
          purchaseOrders: true,
          entitlements: true,
          reports: true,
        },
      },
    },
  },
  assets: {
    where: { removedAt: null },
    orderBy: [{ displayOrder: 'asc' }, { createdAt: 'desc' }],
    include: {
      mediaAsset: true,
    },
  },
  priceRules: {
    where: { archivedAt: null },
    orderBy: [{ status: 'asc' }, { priority: 'desc' }, { amount: 'asc' }],
  },
  campaigns: {
    where: { archivedAt: null },
    orderBy: [{ startsAt: 'asc' }, { createdAt: 'desc' }],
    include: {
      localizations: {
        where: { archivedAt: null },
        orderBy: [{ locale: 'asc' }, { updatedAt: 'desc' }],
      },
    },
  },
  contributors: {
    where: { removedAt: null },
    orderBy: [{ displayOrder: 'asc' }, { createdAt: 'asc' }],
  },
  publisherAssignments: {
    orderBy: [{ displayOrder: 'asc' }, { createdAt: 'asc' }],
    include: { publisher: true },
  },
  aclGrants: {
    where: { revokedAt: null },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  },
  reports: {
    orderBy: { createdAt: 'desc' },
    take: 5,
  },
  purchaseOrders: {
    orderBy: { createdAt: 'desc' },
    take: 5,
  },
  _count: {
    select: {
      episodes: true,
      assets: true,
      campaigns: true,
      priceRules: true,
      purchaseOrders: true,
      entitlements: true,
      contributors: true,
      reports: true,
    },
  },
} satisfies Prisma.IpInclude;

type AdminIpWithCommerce = Prisma.IpGetPayload<{
  include: typeof adminIpInclude;
}>;

const commerceOrderInclude = {
  ip: {
    include: {
      localizations: {
        where: { archivedAt: null },
        orderBy: [{ locale: 'asc' }, { updatedAt: 'desc' }],
      },
    },
  },
  episode: {
    include: {
      localizations: {
        where: { archivedAt: null },
        orderBy: [{ locale: 'asc' }, { updatedAt: 'desc' }],
      },
    },
  },
  entitlements: true,
} satisfies Prisma.IpPurchaseOrderInclude;

type CommerceOrderWithRefs = Prisma.IpPurchaseOrderGetPayload<{
  include: typeof commerceOrderInclude;
}>;

const commerceEntitlementInclude = {
  ip: {
    include: {
      localizations: {
        where: { archivedAt: null },
        orderBy: [{ locale: 'asc' }, { updatedAt: 'desc' }],
      },
    },
  },
  episode: {
    include: {
      localizations: {
        where: { archivedAt: null },
        orderBy: [{ locale: 'asc' }, { updatedAt: 'desc' }],
      },
    },
  },
  sourceOrder: true,
} satisfies Prisma.IpContentEntitlementInclude;

type CommerceEntitlementWithRefs = Prisma.IpContentEntitlementGetPayload<{
  include: typeof commerceEntitlementInclude;
}>;

@Injectable()
export class IpCommerceService {
  /// Cached platform-default creator revenue share (see TTL above).
  private revenueShareDefaultCache: { bps: number; at: number } | null = null;
  private memberDiscountDefaultCache: { bps: number; at: number } | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly walletLedger: WalletLedgerService,
    private readonly outputStorage: OutputStorageService,
    private readonly legacyCnVideo: LegacyCnVideoResolverService,
    private readonly entitlements: EntitlementService,
    private readonly legacyMysql: LegacyMysqlService,
    private readonly conversations: ConversationsService,
  ) {}

  /**
   * Look up a platform user for ACL/member linking by EXACT phone or email —
   * the identifiers a granting owner actually knows. Single query against the
   * Java `client_user` table via the MySQL bridge (server↔RDS, same region),
   * replacing the old client-side 25-page scan. Exact match (no fuzzy LIKE, no
   * nickname/id browse) keeps it precise and cheap: phone is indexed, and a
   * contact maps to ~one account. Returns only public identity fields.
   */
  async searchPlatformUsers(query: string) {
    const q = query.trim();
    if (q.length < 3) return { users: [] };
    const rows = await this.legacyMysql.query<RowDataPacket>(
      `SELECT CAST(id AS CHAR) AS id, nick_name, avatar
         FROM client_user
        WHERE phone = ? OR email = ?
        ORDER BY id DESC`,
      [q, q],
    );
    return {
      users: rows.map((row) => ({
        userId: String(row.id),
        nickname: typeof row.nick_name === 'string' ? row.nick_name.trim() : '',
        avatar: row.avatar ? String(row.avatar) : null,
      })),
    };
  }

  async requireEditableIp(
    user: AuthUser,
    ipId: string,
    db: Prisma.TransactionClient = this.prisma,
  ) {
    const ip = await db.ip.findFirst({
      where: { id: ipId, deletedAt: null, ...this.ipEditAccessWhere(user) },
      select: { id: true },
    });
    if (!ip)
      throw new NotFoundException({
        code: 'IP_NOT_FOUND',
        msg: 'IP not found.',
      });
    return ip;
  }

  private ipEditAccessWhere(user: AuthUser): Prisma.IpWhereInput {
    return {
      OR: [
        { createdById: user.userId },
        {
          aclGrants: {
            some: {
              userId: user.userId,
              permission: IpAclPermission.edit,
              revokedAt: null,
            },
          },
        },
      ],
    };
  }

  private async hasActiveIpEditGrant(
    user: AuthUser | undefined,
    ipId: string,
    db: Pick<Prisma.TransactionClient, 'ipAclGrant'> = this.prisma,
  ): Promise<boolean> {
    if (!user) return false;
    const grant = await db.ipAclGrant.findFirst({
      where: {
        ipId,
        userId: user.userId,
        permission: IpAclPermission.edit,
        revokedAt: null,
      },
      select: { id: true },
    });
    return Boolean(grant);
  }

  private async requireIpWithEditAccess<T extends Prisma.IpSelect>(
    user: AuthUser,
    ipId: string,
    select: T,
  ): Promise<Prisma.IpGetPayload<{ select: T }>> {
    const ip = await this.prisma.ip.findFirst({
      where: {
        id: ipId,
        deletedAt: null,
        ...this.ipEditAccessWhere(user),
      },
      select,
    });
    if (!ip) {
      throw new NotFoundException({
        code: 'IP_NOT_FOUND',
        msg: 'IP not found.',
      });
    }
    return ip as Prisma.IpGetPayload<{ select: T }>;
  }

  /**
   * Platform-default creator revenue share (bps), read from ip_commerce_settings
   * with a short in-process TTL so the hot purchase path doesn't query per sale.
   * Falls back to the seeded default if the row is missing.
   */
  private async getCreatorRevenueShareDefaultBps(): Promise<number> {
    const cached = this.revenueShareDefaultCache;
    if (
      cached &&
      Date.now() - cached.at < IP_CREATOR_REVENUE_SHARE_CACHE_TTL_MS
    ) {
      return cached.bps;
    }
    const row = await this.prisma.ipCommerceSetting.findUnique({
      where: { key: IP_CREATOR_REVENUE_SHARE_SETTING_KEY },
    });
    const raw = row?.valueInt != null ? Number(row.valueInt) : NaN;
    const bps =
      Number.isFinite(raw) && raw >= 0 && raw <= 10000
        ? Math.trunc(raw)
        : IP_CREATOR_REVENUE_SHARE_DEFAULT_BPS;
    this.revenueShareDefaultCache = { bps, at: Date.now() };
    return bps;
  }

  /**
   * Platform-default community-member discount (bps) for points-priced IPs,
   * cached like the creator-share default. Falls back to the seeded default if
   * the row is missing.
   */
  private async getMemberDiscountDefaultBps(): Promise<number> {
    const cached = this.memberDiscountDefaultCache;
    if (cached && Date.now() - cached.at < IP_MEMBER_DISCOUNT_CACHE_TTL_MS) {
      return cached.bps;
    }
    const row = await this.prisma.ipCommerceSetting.findUnique({
      where: { key: IP_MEMBER_DISCOUNT_SETTING_KEY },
    });
    const raw = row?.valueInt != null ? Number(row.valueInt) : NaN;
    const bps =
      Number.isFinite(raw) && raw >= 0 && raw <= 10000
        ? Math.trunc(raw)
        : IP_MEMBER_DISCOUNT_DEFAULT_BPS;
    this.memberDiscountDefaultCache = { bps, at: Date.now() };
    return bps;
  }

  async listTaxonomyTerms(query: ListIpTaxonomyTermsQuery) {
    const locale = normalizeLocale(query.locale);
    const rows = await this.prisma.ipTaxonomyTerm.findMany({
      where: {
        ...(query.type ? { type: query.type as IpTaxonomyTermType } : {}),
        status: IpTaxonomyTermStatus.active,
        archivedAt: null,
      },
      include: {
        localizations: {
          orderBy: [{ locale: 'asc' }, { updatedAt: 'desc' }],
        },
      },
      orderBy: [{ type: 'asc' }, { displayOrder: 'asc' }, { code: 'asc' }],
    });

    return {
      items: rows.map((term) => taxonomyTermDto(term, locale)),
    };
  }

  async listAdminTaxonomyTerms(query: ListIpTaxonomyTermsQuery) {
    const locale = normalizeLocale(query.locale);
    const rows = await this.prisma.ipTaxonomyTerm.findMany({
      where: {
        ...(query.type ? { type: query.type as IpTaxonomyTermType } : {}),
      },
      include: adminTaxonomyTermInclude,
      orderBy: [{ type: 'asc' }, { displayOrder: 'asc' }, { code: 'asc' }],
    });

    return {
      items: rows.map((term) => adminTaxonomyTermDto(term, locale)),
    };
  }

  async createAdminTaxonomyTerm(
    user: AuthUser,
    input: CreateAdminIpTaxonomyTermInput,
  ) {
    const localizations = normalizeAdminTaxonomyLocalizations(
      input.localizations,
    );
    const code =
      normalizeTaxonomyCodes(input.code ? [input.code] : [], 1)[0] ??
      generateTaxonomyCode(input.type as IpTaxonomyTermType, localizations);
    const conflict = () =>
      new ConflictException({
        code: 'IP_TAXONOMY_TERM_CODE_EXISTS',
        msg: `Taxonomy code already exists: ${code}.`,
      });
    try {
      return await this.prisma.$transaction(async (tx) => {
        const existing = await tx.ipTaxonomyTerm.findUnique({
          where: {
            type_code: { type: input.type as IpTaxonomyTermType, code },
          },
          select: { id: true },
        });
        if (existing) throw conflict();
        const term = await tx.ipTaxonomyTerm.create({
          data: {
            type: input.type as IpTaxonomyTermType,
            code,
            status: input.status as IpTaxonomyTermStatus,
            displayOrder: input.displayOrder,
            createdById: user.userId,
            updatedById: user.userId,
            archivedAt:
              input.status === IpTaxonomyTermStatus.archived
                ? new Date()
                : null,
            localizations: { createMany: { data: localizations } },
          },
          include: adminTaxonomyTermInclude,
        });
        return {
          term: adminTaxonomyTermDto(term, input.localizations[0]?.locale),
        };
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        const existing = await this.prisma.ipTaxonomyTerm.findUnique({
          where: {
            type_code: { type: input.type as IpTaxonomyTermType, code },
          },
          select: { id: true },
        });
        if (existing) throw conflict();
      }
      throw error;
    }
  }

  async updateAdminTaxonomyTerm(
    user: AuthUser,
    termId: string,
    input: UpdateAdminIpTaxonomyTermInput,
  ) {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM ip_taxonomy_terms WHERE id=${termId}::uuid FOR UPDATE`;
      const existing = await tx.ipTaxonomyTerm.findUnique({
        where: { id: termId },
        select: { id: true },
      });
      if (!existing)
        throw new NotFoundException({
          code: 'IP_TAXONOMY_TERM_NOT_FOUND',
          msg: 'Taxonomy term not found.',
        });
      const localizations = input.localizations
        ? normalizeAdminTaxonomyLocalizations(input.localizations)
        : [];
      for (const localization of localizations) {
        await tx.ipTaxonomyTermLocalization.upsert({
          where: { termId_locale: { termId, locale: localization.locale } },
          create: { termId, ...localization },
          update: {
            label: localization.label,
            description: localization.description,
            aliases: localization.aliases,
          },
        });
      }
      const term = await tx.ipTaxonomyTerm.update({
        where: { id: termId },
        data: {
          ...(input.status !== undefined
            ? {
                status: input.status as IpTaxonomyTermStatus,
                archivedAt:
                  input.status === IpTaxonomyTermStatus.archived
                    ? new Date()
                    : null,
              }
            : {}),
          ...(input.displayOrder !== undefined
            ? { displayOrder: input.displayOrder }
            : {}),
          updatedById: user.userId,
        },
        include: adminTaxonomyTermInclude,
      });
      return {
        term: adminTaxonomyTermDto(term, input.localizations?.[0]?.locale),
      };
    });
  }

  // -------------------------------------------------------------------------
  // IP discovery placements (IP Plaza hero / for-you / pinned recommendations)
  // -------------------------------------------------------------------------

  async listAdminDiscovery(
    query: ListAdminIpDiscoveryQuery,
    tx: Prisma.TransactionClient = this.prisma,
  ) {
    const locale = normalizeLocale(query.locale);
    const rows = await tx.ipDiscoveryRecommendation.findMany({
      where: {
        ...(query.placementKey
          ? { placementKey: query.placementKey as IpDiscoveryPlacementKey }
          : {}),
        ...(query.status
          ? { status: query.status as IpDiscoveryRecommendationStatus }
          : {}),
      },
      include: adminIpDiscoveryInclude,
      orderBy: [
        { placementKey: 'asc' },
        { sortOrder: 'asc' },
        { updatedAt: 'desc' },
      ],
    });
    return { items: rows.map((row) => adminIpDiscoveryDto(row, locale)) };
  }

  // Whether the IP itself can back a hero placement that omits a curated
  // image/title (image → IP cover, title → IP localized title).
  private async resolveIpHeroFallback(
    client: Prisma.TransactionClient,
    ipId: string,
  ): Promise<{ ipCoverReady: boolean; ipHasTitle: boolean }> {
    const ip = await client.ip.findUnique({
      where: { id: ipId },
      select: {
        coverAsset: {
          select: { status: true, deletedAt: true, moderationStatus: true },
        },
        localizations: { select: { title: true } },
      },
    });
    const cover = ip?.coverAsset;
    return {
      ipCoverReady: Boolean(
        cover &&
        cover.status === MediaAssetStatus.ready &&
        !cover.deletedAt &&
        cover.moderationStatus !== 'blocked',
      ),
      ipHasTitle: Boolean(
        ip?.localizations.some((l) => l.title && l.title.trim()),
      ),
    };
  }

  async createAdminDiscovery(
    user: AuthUser,
    input: CreateAdminIpDiscoveryInput,
  ) {
    const heroFallback =
      input.status === IpDiscoveryRecommendationStatus.enabled &&
      input.placementKey === IpDiscoveryPlacementKey.ip_plaza_hero
        ? await this.resolveIpHeroFallback(this.prisma, input.ipId)
        : { ipCoverReady: false, ipHasTitle: false };
    assertDiscoveryEnablement(input.placementKey, input.status, {
      imageAssetId: input.imageAssetId ?? null,
      localizations: input.localizations ?? [],
      ipCoverReady: heroFallback.ipCoverReady,
      ipHasTitle: heroFallback.ipHasTitle,
    });

    const rec = await this.prisma.ipDiscoveryRecommendation.create({
      data: {
        placementKey: input.placementKey as IpDiscoveryPlacementKey,
        ipId: input.ipId,
        status: input.status as IpDiscoveryRecommendationStatus,
        sortOrder: input.sortOrder,
        startsAt: input.startsAt ?? null,
        endsAt: input.endsAt ?? null,
        imageAssetId: input.imageAssetId ?? null,
        mobileImageAssetId: input.mobileImageAssetId ?? null,
        trailerAssetId: input.trailerAssetId ?? null,
        createdById: user.userId,
        updatedById: user.userId,
        archivedAt:
          input.status === IpDiscoveryRecommendationStatus.archived
            ? new Date()
            : null,
        ...(input.localizations?.length
          ? {
              localizations: {
                createMany: {
                  data: normalizeDiscoveryLocalizations(input.localizations),
                },
              },
            }
          : {}),
      },
      include: adminIpDiscoveryInclude,
    });

    return {
      recommendation: adminIpDiscoveryDto(
        rec,
        input.localizations?.[0]?.locale,
      ),
    };
  }

  async updateAdminDiscovery(
    user: AuthUser,
    recommendationId: string,
    input: UpdateAdminIpDiscoveryInput,
  ) {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM ip_discovery_recommendations WHERE id=${recommendationId}::uuid FOR UPDATE`;
      const existing = await tx.ipDiscoveryRecommendation.findUnique({
        where: { id: recommendationId },
        select: {
          id: true,
          placementKey: true,
          status: true,
          imageAssetId: true,
          ipId: true,
        },
      });
      if (!existing) {
        throw new NotFoundException({
          code: 'IP_DISCOVERY_RECOMMENDATION_NOT_FOUND',
          msg: 'Discovery recommendation not found.',
        });
      }

      if (input.ipId !== undefined && input.ipId !== existing.ipId) {
        const ip = await tx.ip.findFirst({
          where: { id: input.ipId, deletedAt: null },
          select: { id: true },
        });
        if (!ip) {
          throw new NotFoundException({
            code: 'IP_NOT_FOUND',
            msg: 'IP not found.',
          });
        }
      }

      const nextStatus = input.status ?? existing.status;
      const nextIpId = input.ipId ?? existing.ipId;
      const nextPlacementKey =
        (input.placementKey as IpDiscoveryPlacementKey | undefined) ??
        existing.placementKey;
      const nextImageAssetId =
        input.imageAssetId !== undefined
          ? input.imageAssetId
          : existing.imageAssetId;

      if (input.localizations?.length) {
        for (const localization of normalizeDiscoveryLocalizations(
          input.localizations,
        )) {
          await tx.ipDiscoveryRecommendationLocalization.upsert({
            where: {
              recommendationId_locale: {
                recommendationId,
                locale: localization.locale,
              },
            },
            create: { recommendationId, ...localization },
            update: {
              eyebrow: localization.eyebrow,
              title: localization.title,
              description: localization.description,
              ctaLabel: localization.ctaLabel,
            },
          });
        }
      }

      // Service-layer hero-completeness gate (P1.2 copy) — spans the locale
      // table, so it lives here rather than in a DB trigger.
      if (nextStatus === IpDiscoveryRecommendationStatus.enabled) {
        const localizations =
          await tx.ipDiscoveryRecommendationLocalization.findMany({
            where: { recommendationId },
            select: { title: true },
          });
        const heroFallback =
          nextPlacementKey === IpDiscoveryPlacementKey.ip_plaza_hero
            ? await this.resolveIpHeroFallback(tx, nextIpId)
            : { ipCoverReady: false, ipHasTitle: false };
        assertDiscoveryEnablement(nextPlacementKey, nextStatus, {
          imageAssetId: nextImageAssetId,
          localizations,
          ipCoverReady: heroFallback.ipCoverReady,
          ipHasTitle: heroFallback.ipHasTitle,
        });
      }

      const rec = await tx.ipDiscoveryRecommendation.update({
        where: { id: recommendationId },
        data: {
          ...(input.placementKey !== undefined
            ? {
                placementKey: input.placementKey as IpDiscoveryPlacementKey,
              }
            : {}),
          ...(input.ipId !== undefined ? { ipId: input.ipId } : {}),
          ...(input.status !== undefined
            ? {
                status: input.status as IpDiscoveryRecommendationStatus,
                archivedAt:
                  input.status === IpDiscoveryRecommendationStatus.archived
                    ? new Date()
                    : null,
              }
            : {}),
          ...(input.sortOrder !== undefined
            ? { sortOrder: input.sortOrder }
            : {}),
          ...(input.startsAt !== undefined ? { startsAt: input.startsAt } : {}),
          ...(input.endsAt !== undefined ? { endsAt: input.endsAt } : {}),
          ...(input.imageAssetId !== undefined
            ? { imageAssetId: input.imageAssetId }
            : {}),
          ...(input.mobileImageAssetId !== undefined
            ? { mobileImageAssetId: input.mobileImageAssetId }
            : {}),
          ...(input.trailerAssetId !== undefined
            ? { trailerAssetId: input.trailerAssetId }
            : {}),
          updatedById: user.userId,
          version: { increment: 1 },
        },
        include: adminIpDiscoveryInclude,
      });
      return {
        recommendation: adminIpDiscoveryDto(
          rec,
          input.localizations?.[0]?.locale,
        ),
      };
    });
  }

  async deleteAdminDiscovery(user: AuthUser, recommendationId: string) {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM ip_discovery_recommendations WHERE id=${recommendationId}::uuid FOR UPDATE`;
      const existing = await tx.ipDiscoveryRecommendation.findUnique({
        where: { id: recommendationId },
        select: { id: true, placementKey: true, ipId: true },
      });
      if (!existing)
        throw new NotFoundException({
          code: 'IP_DISCOVERY_RECOMMENDATION_NOT_FOUND',
          msg: 'Discovery recommendation not found.',
        });
      await tx.ipDiscoveryRecommendation.delete({
        where: { id: recommendationId },
      });
      return {
        deleted: true,
        id: existing.id,
        placementKey: existing.placementKey,
        ipId: existing.ipId,
        deletedById: user.userId,
      };
    });
  }

  async reorderAdminDiscovery(
    user: AuthUser,
    input: ReorderAdminIpDiscoveryInput,
  ) {
    if (
      !input.orderedIds.length ||
      new Set(input.orderedIds).size !== input.orderedIds.length
    )
      throw new BadRequestException(
        'Discovery order must contain distinct recommendation IDs.',
      );
    return this.prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<
        { id: string }[]
      >`SELECT id FROM ip_discovery_recommendations WHERE id IN (${Prisma.join(input.orderedIds.map((id) => Prisma.sql`${id}::uuid`))}) AND placement_key::text=${input.placementKey} ORDER BY id FOR UPDATE`;
      if (locked.length !== input.orderedIds.length)
        throw new BadRequestException(
          'Every recommendation must exist in the selected placement.',
        );
      for (let index = 0; index < input.orderedIds.length; index += 1) {
        await tx.ipDiscoveryRecommendation.update({
          where: { id: input.orderedIds[index] },
          data: {
            sortOrder: index,
            updatedById: user.userId,
            version: { increment: 1 },
          },
        });
      }
      return this.listAdminDiscovery({ placementKey: input.placementKey }, tx);
    });
  }

  async listPublicDiscovery(
    query: ListPublicIpDiscoveryQuery,
    user?: AuthUser,
  ) {
    const locale = normalizeLocale(query.locale);
    const now = new Date();
    const viewerBlockWhere = await this.viewerBlockWhere(user);
    const rows = await this.prisma.ipDiscoveryRecommendation.findMany({
      where: {
        placementKey: query.placementKey as IpDiscoveryPlacementKey,
        status: IpDiscoveryRecommendationStatus.enabled,
        archivedAt: null,
        AND: [
          { OR: [{ startsAt: null }, { startsAt: { lte: now } }] },
          { OR: [{ endsAt: null }, { endsAt: { gt: now } }] },
        ],
        // P1.1 drift guard: only render placements whose IP is still displayable.
        ip: {
          channelType: query.channelType,
          status: IpPublicationStatus.published,
          listingVisibility: IpListingVisibility.public,
          deletedAt: null,
          ...viewerBlockWhere,
        },
      },
      include: publicIpDiscoveryInclude,
      orderBy: [{ sortOrder: 'asc' }, { updatedAt: 'desc' }],
    });

    const stats = await this.engagementStatsForIps(
      rows.map((row) => row.ipId),
      user,
    );
    const items = rows
      .filter((row) => isPublicDiscoveryRenderable(row))
      .map((row) => publicIpDiscoveryDto(row, locale, stats.get(row.ipId)));
    return { items };
  }

  async uploadAdminDiscoveryMedia(
    kind: 'image' | 'video',
    file:
      | { buffer: Buffer; originalname: string; mimetype: string; size: number }
      | undefined,
  ) {
    if (!file?.buffer?.byteLength) {
      throw new BadRequestException({
        code: 'IP_DISCOVERY_MEDIA_FILE_REQUIRED',
        msg: 'Missing upload file.',
      });
    }
    const assetKind =
      kind === 'video' ? MediaAssetKind.video : MediaAssetKind.image;
    this.assertUploadMatchesKind(file, assetKind);
    const limit = IP_MEDIA_UPLOAD_LIMITS[assetKind];
    if (file.size > limit) {
      throw new BadRequestException({
        code: 'IP_DISCOVERY_MEDIA_FILE_TOO_LARGE',
        msg: `File is too large for ${assetKind}.`,
      });
    }

    const objectKey = `ip-discovery/${assetKind}/${randomUUID()}-${sanitizeFilename(
      file.originalname,
    )}`;

    let uploaded: Awaited<ReturnType<OutputStorageService['upload']>>;
    try {
      uploaded = await this.outputStorage.upload({
        body: file.buffer,
        key: objectKey,
        contentType: file.mimetype || 'application/octet-stream',
        filename: sanitizeFilename(file.originalname),
      });
    } catch (err) {
      throw new ServiceUnavailableException({
        code: 'IP_DISCOVERY_MEDIA_STORAGE_UNAVAILABLE',
        msg:
          err instanceof Error && err.message
            ? err.message
            : 'Media storage is unavailable.',
      });
    }

    const asset = await this.prisma.mediaAsset.create({
      data: {
        kind: assetKind,
        storageProvider: uploaded.provider,
        bucket: uploaded.bucket,
        region: uploaded.region,
        objectKey: uploaded.storagePath,
        contentType: file.mimetype || 'application/octet-stream',
        sizeBytes: BigInt(uploaded.bytes),
        checksumSha256: createHash('sha256').update(file.buffer).digest('hex'),
        visibility: MediaAssetVisibility.public,
        status: MediaAssetStatus.ready,
      },
    });

    return { asset: assetDto(asset) };
  }

  async listCreatorIps(user: AuthUser, query: ListCreatorIpsQuery) {
    const rows = await this.prisma.ip.findMany({
      where: {
        deletedAt: null,
        ...this.ipEditAccessWhere(user),
      },
      cursor: query.cursor ? { id: query.cursor } : undefined,
      skip: query.cursor ? 1 : 0,
      include: adminIpInclude,
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
      take: query.limit + 1,
    });

    const items = rows.slice(0, query.limit);
    return {
      items: items.map((ip) =>
        creatorIpSummaryDto(ip, query.locale, user.userId),
      ),
      nextCursor: rows.length > query.limit ? (items.at(-1)?.id ?? null) : null,
    };
  }

  async getCreatorIp(
    user: AuthUser,
    ipReference: string,
    query: { locale?: string } = {},
  ) {
    const ip = await this.prisma.ip.findFirst({
      where: {
        ...ipIdentityWhere(ipReference),
        deletedAt: null,
        ...this.ipEditAccessWhere(user),
      },
      include: adminIpInclude,
    });

    if (!ip) {
      throw new NotFoundException({
        code: 'IP_NOT_FOUND',
        msg: 'IP not found.',
      });
    }

    return { ip: creatorIpDetailDto(ip, query.locale, user.userId) };
  }

  async getCreatorIpCommerce(
    user: AuthUser,
    ipId: string,
    query: { locale?: string } = {},
  ) {
    const ip = await this.prisma.ip.findFirst({
      where: {
        id: ipId,
        deletedAt: null,
        ...this.ipEditAccessWhere(user),
      },
      include: adminIpInclude,
    });

    if (!ip) {
      throw new NotFoundException({
        code: 'IP_NOT_FOUND',
        msg: 'IP not found.',
      });
    }

    const now = new Date();
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const defaultShareBps = await this.getCreatorRevenueShareDefaultBps();
    const recognizedOrderStatuses: IpPurchaseOrderStatus[] = [
      IpPurchaseOrderStatus.paid,
      IpPurchaseOrderStatus.fulfilled,
      IpPurchaseOrderStatus.partially_refunded,
    ];

    const [
      totalOrders,
      recognizedOrders,
      gross,
      last7Gross,
      last7Orders,
      uniqueBuyers,
      activeEntitlements,
      pendingUnlocks,
      recentOrders,
      recentEntitlements,
      ipOwnerRevenue,
      ownerWithdrawableAccount,
    ] = await Promise.all([
      this.prisma.ipPurchaseOrder.count({ where: { ipId: ip.id } }),
      this.prisma.ipPurchaseOrder.count({
        where: { ipId: ip.id, status: { in: recognizedOrderStatuses } },
      }),
      this.prisma.ipPurchaseOrder.aggregate({
        where: { ipId: ip.id, status: { in: recognizedOrderStatuses } },
        _sum: { totalAmount: true },
      }),
      this.prisma.ipPurchaseOrder.aggregate({
        where: {
          ipId: ip.id,
          status: { in: recognizedOrderStatuses },
          createdAt: { gte: sevenDaysAgo },
        },
        _sum: { totalAmount: true },
      }),
      this.prisma.ipPurchaseOrder.count({
        where: {
          ipId: ip.id,
          status: { in: recognizedOrderStatuses },
          createdAt: { gte: sevenDaysAgo },
        },
      }),
      this.prisma.ipPurchaseOrder.findMany({
        where: { ipId: ip.id, status: { in: recognizedOrderStatuses } },
        distinct: ['userId'],
        select: { userId: true },
      }),
      this.prisma.ipContentEntitlement.count({
        where: {
          ipId: ip.id,
          status: IpEntitlementStatus.active,
          startsAt: { lte: now },
          OR: [{ endsAt: null }, { endsAt: { gt: now } }],
        },
      }),
      this.prisma.ipContentEntitlement.count({
        where: {
          ipId: ip.id,
          status: IpEntitlementStatus.active,
          startsAt: { gt: now },
          OR: [{ endsAt: null }, { endsAt: { gt: now } }],
        },
      }),
      this.prisma.ipPurchaseOrder.findMany({
        where: { ipId: ip.id },
        include: commerceOrderInclude,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: 12,
      }),
      this.prisma.ipContentEntitlement.findMany({
        where: { ipId: ip.id },
        include: commerceEntitlementInclude,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: 12,
      }),
      // This IP's lifetime earnings credited to the owner (withdrawable).
      this.prisma.ipRevenueLedgerEntry.aggregate({
        where: {
          ipId: ip.id,
          userId: ip.createdById,
          status: IpRevenueLedgerStatus.posted,
        },
        _sum: { amount: true },
      }),
      // The owner's account-wide withdrawable community-point balance.
      this.prisma.walletAccount.findUnique({
        where: {
          ownerType_ownerId_currency_balanceKind: {
            ownerType: WalletOwnerType.user,
            ownerId: ip.createdById,
            currency: WalletCurrencyType.community_point,
            balanceKind: WalletBalanceKind.withdrawable,
          },
        },
        select: { availableBalance: true },
      }),
    ]);

    return {
      ip: ipReferenceDto(ip, query.locale),
      metrics: {
        totalOrders,
        recognizedOrders,
        grossCommunityPoints: (gross._sum.totalAmount ?? 0n).toString(),
        ordersLast7Days: last7Orders,
        grossCommunityPointsLast7Days: (
          last7Gross._sum.totalAmount ?? 0n
        ).toString(),
        uniqueBuyers: uniqueBuyers.length,
        activeEntitlements,
        pendingUnlocks,
      },
      pricingHealth: ipCommerceHealthDto(ip),
      settlement: {
        status: 'active' as const,
        currency: WalletCurrencyType.community_point,
        // Effective creator-pool share applied to this IP's sales.
        saleShareBps: ip.creatorRevenueShareBps ?? defaultShareBps,
        // Lifetime withdrawable revenue this IP credited to its owner.
        ipLifetimeEarnings: (ipOwnerRevenue._sum.amount ?? 0n).toString(),
        // The owner's account-wide withdrawable balance (across all their IPs).
        withdrawableBalance: (
          ownerWithdrawableAccount?.availableBalance ?? 0n
        ).toString(),
        note: 'Withdrawable revenue accrues from sales. Cash-out is coming soon.',
      },
      recentOrders: recentOrders.map((order) =>
        commercePurchaseOrderDto(order, query.locale),
      ),
      recentEntitlements: recentEntitlements.map((entitlement) =>
        commerceEntitlementDto(entitlement, query.locale),
      ),
    };
  }

  /**
   * The signed-in creator's withdrawable revenue: account-wide balance, lifetime
   * earned, and a paginated revenue-ledger history across all their IPs.
   * Earning-only — no cash-out path yet (the web surfaces label it accordingly).
   */
  async getCreatorRevenueSummary(
    user: AuthUser,
    query: Partial<CreatorRevenueQuery> = {},
  ) {
    const limit = Math.min(Math.max(query.limit ?? 20, 1), 50);

    const [account, totals, rows] = await Promise.all([
      this.prisma.walletAccount.findUnique({
        where: {
          ownerType_ownerId_currency_balanceKind: {
            ownerType: WalletOwnerType.user,
            ownerId: user.userId,
            currency: WalletCurrencyType.community_point,
            balanceKind: WalletBalanceKind.withdrawable,
          },
        },
        select: { availableBalance: true },
      }),
      this.prisma.ipRevenueLedgerEntry.aggregate({
        where: { userId: user.userId, status: IpRevenueLedgerStatus.posted },
        _sum: { amount: true },
      }),
      this.prisma.ipRevenueLedgerEntry.findMany({
        where: { userId: user.userId },
        include: {
          ip: {
            include: {
              localizations: {
                where: { archivedAt: null },
                orderBy: [{ locale: 'asc' }, { updatedAt: 'desc' }],
              },
            },
          },
          order: { select: { orderNo: true } },
        },
        cursor: query.cursor ? { id: query.cursor } : undefined,
        skip: query.cursor ? 1 : 0,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: limit + 1,
      }),
    ]);

    const items = rows.slice(0, limit);
    return {
      currency: WalletCurrencyType.community_point,
      withdrawableBalance: (account?.availableBalance ?? 0n).toString(),
      lifetimeEarned: (totals._sum.amount ?? 0n).toString(),
      note: 'Withdrawable revenue. Cash-out is coming soon.',
      entries: items.map((entry) => ({
        id: entry.id,
        ip: ipReferenceDto(entry.ip, query.locale),
        orderNo: entry.order?.orderNo ?? null,
        entryType: entry.entryType,
        status: entry.status,
        amount: entry.amount.toString(),
        // The sale total this credit was computed from. `shareBps` is the
        // beneficiary's share of the CREATOR POOL, not of the whole sale — the
        // true sale fraction is amount / sourceAmount.
        sourceAmount: entry.sourceAmount?.toString() ?? null,
        poolShareBps: entry.shareBps,
        createdAt: entry.createdAt.toISOString(),
      })),
      nextCursor: rows.length > limit ? (items.at(-1)?.id ?? null) : null,
    };
  }

  // --- Admin: revenue config + observability --------------------------------

  async getAdminIpCommerceSettings() {
    const rows = await this.prisma.ipCommerceSetting.findMany({
      orderBy: { key: 'asc' },
    });
    const creatorShare = rows.find(
      (r) => r.key === IP_CREATOR_REVENUE_SHARE_SETTING_KEY,
    );
    return {
      creatorRevenueShareBps:
        creatorShare?.valueInt != null
          ? Number(creatorShare.valueInt)
          : IP_CREATOR_REVENUE_SHARE_DEFAULT_BPS,
      settings: rows.map((r) => ({
        key: r.key,
        valueInt: r.valueInt != null ? Number(r.valueInt) : null,
        updatedById: r.updatedById,
        updatedAt: r.updatedAt.toISOString(),
      })),
    };
  }

  async updateAdminIpCommerceSetting(
    actor: AuthUser,
    key: string,
    valueInt: number,
  ) {
    const row = await this.prisma.ipCommerceSetting.upsert({
      where: { key },
      create: { key, valueInt: BigInt(valueInt), updatedById: actor.userId },
      update: { valueInt: BigInt(valueInt), updatedById: actor.userId },
    });
    if (key === IP_CREATOR_REVENUE_SHARE_SETTING_KEY) {
      this.revenueShareDefaultCache = null;
    }
    if (key === IP_MEMBER_DISCOUNT_SETTING_KEY) {
      this.memberDiscountDefaultCache = null;
    }
    return {
      key: row.key,
      valueInt: row.valueInt != null ? Number(row.valueInt) : null,
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  async getAdminIpRevenueConfig(ipId: string, locale?: string) {
    const ip = await this.prisma.ip.findFirst({
      where: { id: ipId, deletedAt: null },
      include: {
        localizations: {
          where: { archivedAt: null },
          orderBy: [{ locale: 'asc' }, { updatedAt: 'desc' }],
        },
        contributors: {
          where: { removedAt: null },
          orderBy: [{ displayOrder: 'asc' }, { createdAt: 'asc' }],
        },
      },
    });
    if (!ip) {
      throw new NotFoundException({
        code: 'IP_NOT_FOUND',
        msg: 'IP not found.',
      });
    }
    const defaultShareBps = await this.getCreatorRevenueShareDefaultBps();
    return {
      ip: ipReferenceDto(ip, locale),
      // Encoded public id out; the raw creator id stays server-side.
      ownerUserId: encodeUserId(ip.createdById),
      version: ip.version,
      creatorRevenueShareBps: ip.creatorRevenueShareBps,
      effectiveShareBps: ip.creatorRevenueShareBps ?? defaultShareBps,
      defaultShareBps,
      contributors: ip.contributors.map((c) => ({
        id: c.id,
        // Encoded public id out; the config is edited by contributor row id.
        userId: c.userId ? encodeUserId(c.userId) : c.userId,
        displayName: c.displayName,
        role: c.role,
        customRole: c.customRole,
        revenueEligible: c.revenueEligible,
        revenueShareBps: c.revenueShareBps,
      })),
    };
  }

  async updateAdminIpRevenueConfig(
    actor: AuthUser,
    ipId: string,
    input: UpdateAdminIpRevenueConfigInput,
  ) {
    await this.prisma.$transaction(async (tx) => {
      // Serialize concurrent revenue-config edits for this IP. Without this, two
      // admins could each read the same version, both pass the check, and both
      // commit (lost update) — and the final-sum validation below could miss the
      // other tx's uncommitted contributor changes. The xact-scoped advisory
      // lock makes the read-check-update-validate sequence atomic per IP.
      await tx.$executeRaw`
        SELECT pg_advisory_xact_lock(hashtext(${`ip:revenue-config:${ipId}`})::bigint)
      `;
      const ip = await tx.ip.findFirst({
        where: { id: ipId, deletedAt: null },
        select: { id: true, version: true },
      });
      if (!ip) {
        throw new NotFoundException({
          code: 'IP_NOT_FOUND',
          msg: 'IP not found.',
        });
      }
      if (
        input.expectedVersion != null &&
        input.expectedVersion !== ip.version
      ) {
        throw new ConflictException({
          code: 'IP_VERSION_CONFLICT',
          msg: 'IP was modified by someone else. Reload and retry.',
        });
      }

      const touchesShare = input.creatorRevenueShareBps !== undefined;
      const touchesContributors = (input.contributors ?? []).length > 0;

      for (const c of input.contributors ?? []) {
        // Scope by ipId so an id from another IP can't be flipped. A 0-row
        // result means a stale/removed/wrong-IP contributor id — fail loudly
        // (rolling back the version bump) instead of silently dropping the edit
        // and returning success.
        const res = await tx.ipContributor.updateMany({
          where: { id: c.id, ipId, removedAt: null },
          data: {
            revenueEligible: c.revenueEligible,
            revenueShareBps: c.revenueShareBps,
          },
        });
        if (res.count !== 1) {
          throw new ConflictException({
            code: 'IP_REVENUE_CONTRIBUTOR_NOT_FOUND',
            msg: 'A contributor in this update no longer exists on this IP. Reload and retry.',
          });
        }
      }

      // Bump the IP version on ANY revenue-config change (incl. contributor-only
      // edits) so concurrent admins collide on expectedVersion, and stamp the
      // override when provided — all in one update.
      if (touchesShare || touchesContributors) {
        await tx.ip.update({
          where: { id: ipId },
          data: {
            ...(touchesShare
              ? { creatorRevenueShareBps: input.creatorRevenueShareBps }
              : {}),
            updatedById: actor.userId,
            version: { increment: 1 },
          },
        });
      }

      // Validate the FINAL persisted state, not just this request's array: a
      // partial PATCH could otherwise push the IP's total eligible share past
      // 100% by combining with contributors left untouched.
      const eligible = await tx.ipContributor.findMany({
        where: { ipId, removedAt: null, revenueEligible: true },
        select: { userId: true, revenueShareBps: true },
      });
      // An account-less contributor cannot receive a withdrawable credit (the
      // purchase credit loop filters userId != null and the share would silently
      // fall back to the owner). Reject so admins can't configure a phantom split.
      if (eligible.some((c) => c.userId == null)) {
        throw new ConflictException({
          code: 'IP_REVENUE_CONTRIBUTOR_NO_ACCOUNT',
          msg: 'A contributor without a linked account cannot earn revenue. Link an account or turn off their revenue share.',
        });
      }
      const totalBps = eligible.reduce(
        (sum, c) => sum + (c.revenueShareBps ?? 0),
        0,
      );
      if (totalBps > 10000) {
        throw new ConflictException({
          code: 'IP_REVENUE_SHARE_OVERALLOCATED',
          msg: `Eligible contributor shares total ${(totalBps / 100).toFixed(
            2,
          )}% which exceeds 100%. Adjust the splits.`,
        });
      }
    });
    return this.getAdminIpRevenueConfig(ipId);
  }

  // --- Creator self-service contributors -----------------------------------
  //
  // Creators manage their IP's team (contributors) AND how the creator pool is
  // split among them — no admin approval. Ownership is enforced on every call
  // (ip.createdById === user.userId). Writes mirror updateAdminIpRevenueConfig:
  // the same per-IP advisory lock serialises edits, and the same final-state
  // validations run on the persisted set (eligible-requires-userId; eligible
  // pool shares must total <= 100%). The platform-vs-creator share stays
  // read-only to creators (admin-managed default / per-IP override).

  /**
   * Load an IP the caller owns, or throw IP_NOT_FOUND. This is intentionally
   * stricter than edit access and is reserved for owner-only operations such as
   * ACL management.
   */
  private async requireOwnedIp(
    user: AuthUser,
    ipId: string,
    select: Prisma.IpSelect,
  ) {
    const ip = await this.prisma.ip.findFirst({
      where: { id: ipId, createdById: user.userId, deletedAt: null },
      select,
    });
    if (!ip) {
      throw new NotFoundException({
        code: 'IP_NOT_FOUND',
        msg: 'IP not found.',
      });
    }
    return ip;
  }

  async listCreatorIpAcl(user: AuthUser, ipId: string) {
    const ip = await this.requireOwnedIp(user, ipId, {
      id: true,
      createdById: true,
    });
    const grants = await this.prisma.ipAclGrant.findMany({
      where: {
        ipId: ip.id,
        permission: IpAclPermission.edit,
        revokedAt: null,
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    return {
      ownerUserId: ip.createdById,
      grants: grants.map(ipAclGrantDto),
    };
  }

  async grantCreatorIpAcl(
    user: AuthUser,
    ipId: string,
    input: GrantCreatorIpAclInput,
  ) {
    const grant = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`
        SELECT pg_advisory_xact_lock(hashtext(${`ip:acl:${ipId}`})::bigint)
      `;
      const ip = await tx.ip.findFirst({
        where: { id: ipId, createdById: user.userId, deletedAt: null },
        select: { id: true, createdById: true },
      });
      if (!ip) {
        throw new NotFoundException({
          code: 'IP_NOT_FOUND',
          msg: 'IP not found.',
        });
      }
      if (input.userId === ip.createdById) {
        throw new ConflictException({
          code: 'IP_ACL_OWNER_IMPLICIT',
          msg: 'The owner already has full IP management access.',
        });
      }

      const existing = await tx.ipAclGrant.findFirst({
        where: {
          ipId: ip.id,
          userId: input.userId,
          permission: input.permission as IpAclPermission,
          revokedAt: null,
        },
      });
      if (existing) return existing;

      return tx.ipAclGrant.create({
        data: {
          ipId: ip.id,
          userId: input.userId,
          permission: input.permission as IpAclPermission,
          grantedById: user.userId,
        },
      });
    });

    return { grant: ipAclGrantDto(grant) };
  }

  async revokeCreatorIpAcl(user: AuthUser, ipId: string, grantId: string) {
    const revoked = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`
        SELECT pg_advisory_xact_lock(hashtext(${`ip:acl:${ipId}`})::bigint)
      `;
      const ip = await tx.ip.findFirst({
        where: { id: ipId, createdById: user.userId, deletedAt: null },
        select: { id: true },
      });
      if (!ip) {
        throw new NotFoundException({
          code: 'IP_NOT_FOUND',
          msg: 'IP not found.',
        });
      }
      const grant = await tx.ipAclGrant.findFirst({
        where: {
          id: grantId,
          ipId: ip.id,
          permission: IpAclPermission.edit,
          revokedAt: null,
        },
        select: { id: true },
      });
      if (!grant) {
        throw new NotFoundException({
          code: 'IP_ACL_GRANT_NOT_FOUND',
          msg: 'IP edit grant not found.',
        });
      }
      return tx.ipAclGrant.update({
        where: { id: grant.id },
        data: {
          revokedAt: new Date(),
          revokedById: user.userId,
        },
      });
    });

    return { grant: ipAclGrantDto(revoked), revoked: true };
  }

  /**
   * Hand IP ownership (createdById) to an existing editor. Owner-only,
   * self-service: the caller must be the current owner and the target must
   * already hold an active edit grant.
   *
   * Reconciliation, all under the same advisory lock as ACL edits:
   *   - the incoming owner's now-redundant edit grant is revoked (the owner
   *     has full access implicitly);
   *   - the outgoing owner is either dropped entirely (`removeOldOwner`) or
   *     kept on as an editor via a fresh edit grant (default).
   */
  async transferCreatorIpOwnership(
    user: AuthUser,
    ipId: string,
    input: TransferIpOwnerInput,
  ) {
    const target = input.toUserId.trim();
    const previousOwnerId = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`
        SELECT pg_advisory_xact_lock(hashtext(${`ip:acl:${ipId}`})::bigint)
      `;
      const ip = await tx.ip.findFirst({
        where: { id: ipId, createdById: user.userId, deletedAt: null },
        select: { id: true, createdById: true, version: true },
      });
      if (!ip) {
        throw new NotFoundException({
          code: 'IP_NOT_FOUND',
          msg: 'IP not found.',
        });
      }
      this.assertExpectedVersion(input.expectedVersion, ip.version);
      if (target === ip.createdById) {
        throw new ConflictException({
          code: 'IP_OWNER_ALREADY',
          msg: 'Target user is already the IP owner.',
        });
      }

      const collaborator = await tx.ipAclGrant.findFirst({
        where: {
          ipId: ip.id,
          userId: target,
          permission: IpAclPermission.edit,
          revokedAt: null,
        },
        select: { id: true },
      });
      if (!collaborator) {
        throw new BadRequestException({
          code: 'IP_TRANSFER_TARGET_NOT_COLLABORATOR',
          msg: 'Target user must be an existing editor of this IP.',
        });
      }

      await tx.ip.update({
        where: { id: ip.id },
        data: {
          createdById: target,
          updatedById: user.userId,
          version: { increment: 1 },
        },
      });

      // The new owner's edit grant is redundant now — owners have full
      // access implicitly (see grantCreatorIpAcl's IP_ACL_OWNER_IMPLICIT).
      await tx.ipAclGrant.updateMany({
        where: {
          ipId: ip.id,
          userId: target,
          permission: IpAclPermission.edit,
          revokedAt: null,
        },
        data: { revokedAt: new Date(), revokedById: user.userId },
      });

      if (!input.removeOldOwner) {
        const existing = await tx.ipAclGrant.findFirst({
          where: {
            ipId: ip.id,
            userId: ip.createdById,
            permission: IpAclPermission.edit,
            revokedAt: null,
          },
          select: { id: true },
        });
        if (!existing) {
          await tx.ipAclGrant.create({
            data: {
              ipId: ip.id,
              userId: ip.createdById,
              permission: IpAclPermission.edit,
              grantedById: user.userId,
            },
          });
        }
      }

      return ip.createdById;
    });

    return {
      ipId,
      previousOwnerId,
      newOwnerId: target,
      oldOwnerKept: !input.removeOldOwner,
    };
  }

  /**
   * Validate the FINAL persisted contributor set inside the write transaction
   * (not just the request), exactly like updateAdminIpRevenueConfig — a partial
   * edit must not push the IP past 100% or leave an account-less earner.
   */
  private async assertContributorRevenueStateValidTx(
    tx: Prisma.TransactionClient,
    ipId: string,
  ) {
    const eligible = await tx.ipContributor.findMany({
      where: { ipId, removedAt: null, revenueEligible: true },
      select: { userId: true, revenueShareBps: true },
    });
    assertEligibleContributorsHaveAccount(eligible);
    assertEligibleContributorSharesWithinPool(eligible);
  }

  async listCreatorIpContributors(user: AuthUser, ipId: string) {
    const ip = await this.requireIpWithEditAccess(user, ipId, {
      id: true,
      sourceLocale: true,
      creatorRevenueShareBps: true,
      localizations: {
        where: { archivedAt: null },
        orderBy: [{ locale: 'asc' }, { updatedAt: 'desc' }],
      },
    });
    const defaultShareBps = await this.getCreatorRevenueShareDefaultBps();
    const contributors = await this.prisma.ipContributor.findMany({
      where: { ipId, removedAt: null },
      orderBy: [{ displayOrder: 'asc' }, { createdAt: 'asc' }],
    });
    return creatorIpContributorListDto({
      ip,
      effectiveShareBps: ip.creatorRevenueShareBps ?? defaultShareBps,
      contributors,
    });
  }

  async createCreatorIpContributor(
    user: AuthUser,
    ipId: string,
    input: CreateCreatorIpContributorInput,
  ) {
    let createdId = '';
    await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`
        SELECT pg_advisory_xact_lock(hashtext(${`ip:revenue-config:${ipId}`})::bigint)
      `;
      const ip = await tx.ip.findFirst({
        where: {
          id: ipId,
          deletedAt: null,
          ...this.ipEditAccessWhere(user),
        },
        select: { id: true },
      });
      if (!ip) {
        throw new NotFoundException({
          code: 'IP_NOT_FOUND',
          msg: 'IP not found.',
        });
      }
      const maxOrder = await tx.ipContributor.aggregate({
        where: { ipId, removedAt: null },
        _max: { displayOrder: true },
      });
      const created = await tx.ipContributor.create({
        data: {
          ipId,
          displayName: input.displayName,
          userId: input.userId ?? null,
          role: input.role as IpContributorRole,
          customRole: input.customRole ?? null,
          revenueEligible: input.revenueEligible,
          revenueShareBps: input.revenueShareBps ?? null,
          displayOrder: (maxOrder._max.displayOrder ?? -1) + 1,
        },
        select: { id: true },
      });
      createdId = created.id;
      await this.assertContributorRevenueStateValidTx(tx, ipId);
    });
    return this.getCreatorIpContributor(ipId, createdId);
  }

  async updateCreatorIpContributor(
    user: AuthUser,
    ipId: string,
    contributorId: string,
    input: UpdateCreatorIpContributorInput,
  ) {
    await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`
        SELECT pg_advisory_xact_lock(hashtext(${`ip:revenue-config:${ipId}`})::bigint)
      `;
      const ip = await tx.ip.findFirst({
        where: {
          id: ipId,
          deletedAt: null,
          ...this.ipEditAccessWhere(user),
        },
        select: { id: true },
      });
      if (!ip) {
        throw new NotFoundException({
          code: 'IP_NOT_FOUND',
          msg: 'IP not found.',
        });
      }
      // Scope by ipId so a contributor id from another IP can't be edited; a
      // 0-row result fails loudly instead of silently succeeding.
      const res = await tx.ipContributor.updateMany({
        where: { id: contributorId, ipId, removedAt: null },
        data: {
          ...(input.displayName !== undefined
            ? { displayName: input.displayName }
            : {}),
          ...(input.userId !== undefined ? { userId: input.userId } : {}),
          ...(input.role !== undefined
            ? { role: input.role as IpContributorRole }
            : {}),
          ...(input.customRole !== undefined
            ? { customRole: input.customRole }
            : {}),
          ...(input.revenueEligible !== undefined
            ? { revenueEligible: input.revenueEligible }
            : {}),
          ...(input.revenueShareBps !== undefined
            ? { revenueShareBps: input.revenueShareBps }
            : {}),
        },
      });
      if (res.count !== 1) {
        throw new NotFoundException({
          code: 'IP_CONTRIBUTOR_NOT_FOUND',
          msg: 'Contributor not found on this IP.',
        });
      }
      await this.assertContributorRevenueStateValidTx(tx, ipId);
    });
    return this.getCreatorIpContributor(ipId, contributorId);
  }

  async removeCreatorIpContributor(
    user: AuthUser,
    ipId: string,
    contributorId: string,
  ) {
    await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`
        SELECT pg_advisory_xact_lock(hashtext(${`ip:revenue-config:${ipId}`})::bigint)
      `;
      const ip = await tx.ip.findFirst({
        where: {
          id: ipId,
          deletedAt: null,
          ...this.ipEditAccessWhere(user),
        },
        select: { id: true },
      });
      if (!ip) {
        throw new NotFoundException({
          code: 'IP_NOT_FOUND',
          msg: 'IP not found.',
        });
      }
      const res = await tx.ipContributor.updateMany({
        where: { id: contributorId, ipId, removedAt: null },
        data: { removedAt: new Date() },
      });
      if (res.count !== 1) {
        throw new NotFoundException({
          code: 'IP_CONTRIBUTOR_NOT_FOUND',
          msg: 'Contributor not found on this IP.',
        });
      }
      // Removing a contributor only shrinks the eligible set, so the sum can
      // never breach 100% — but re-validate for symmetry with the other writes.
      await this.assertContributorRevenueStateValidTx(tx, ipId);
    });
    return { removed: true };
  }

  /** Fetch a single contributor (scoped to its IP) in the contract shape. */
  private async getCreatorIpContributor(ipId: string, contributorId: string) {
    const contributor = await this.prisma.ipContributor.findFirst({
      where: { id: contributorId, ipId, removedAt: null },
    });
    if (!contributor) {
      throw new NotFoundException({
        code: 'IP_CONTRIBUTOR_NOT_FOUND',
        msg: 'Contributor not found on this IP.',
      });
    }
    return creatorIpContributorDto(contributor);
  }

  async getAdminOrderRevenueBreakdown(orderId: string) {
    const order = await this.prisma.ipPurchaseOrder.findUnique({
      where: { id: orderId },
      include: {
        revenueLedgerEntries: { orderBy: { createdAt: 'asc' } },
      },
    });
    if (!order) {
      throw new NotFoundException({
        code: 'IP_ORDER_NOT_FOUND',
        msg: 'Order not found.',
      });
    }
    const credited = order.revenueLedgerEntries.reduce(
      (sum, e) => sum + e.amount,
      0n,
    );
    return {
      orderId: order.id,
      orderNo: order.orderNo,
      currency: order.currency,
      totalAmount: order.totalAmount.toString(),
      creditedAmount: credited.toString(),
      platformCut: (order.totalAmount - credited).toString(),
      beneficiaries: order.revenueLedgerEntries.map((e) => ({
        id: e.id,
        userId: e.userId,
        entryType: e.entryType,
        status: e.status,
        amount: e.amount.toString(),
        poolShareBps: e.shareBps,
        walletTransactionId: e.walletTransactionId,
        createdAt: e.createdAt.toISOString(),
      })),
    };
  }

  async listAdminRevenueEntries(query: ListAdminIpRevenueQuery) {
    const rows = await this.prisma.ipRevenueLedgerEntry.findMany({
      where: {
        ipId: query.ipId,
        userId: query.userId,
        status: query.status as IpRevenueLedgerStatus | undefined,
      },
      include: {
        ip: {
          include: {
            localizations: {
              where: { archivedAt: null },
              orderBy: [{ locale: 'asc' }, { updatedAt: 'desc' }],
            },
          },
        },
        order: { select: { orderNo: true, totalAmount: true } },
      },
      cursor: query.cursor ? { id: query.cursor } : undefined,
      skip: query.cursor ? 1 : 0,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: query.limit + 1,
    });
    const items = rows.slice(0, query.limit);
    return {
      items: items.map((e) => ({
        id: e.id,
        ip: ipReferenceDto(e.ip, query.locale),
        orderId: e.orderId,
        orderNo: e.order?.orderNo ?? null,
        userId: e.userId,
        entryType: e.entryType,
        status: e.status,
        amount: e.amount.toString(),
        sourceAmount: e.sourceAmount?.toString() ?? null,
        poolShareBps: e.shareBps,
        createdAt: e.createdAt.toISOString(),
      })),
      nextCursor: rows.length > query.limit ? (items.at(-1)?.id ?? null) : null,
    };
  }

  async createCreatorIp(user: AuthUser, input: CreateIpDraftInput) {
    const sourceLocale = normalizeLocale(input.sourceLocale);
    const summary = input.summary?.trim() || input.title;

    const fingerprint = createHash('sha256')
      .update(
        JSON.stringify({
          title: input.title,
          summary: input.summary?.trim() || null,
          genreCodes: input.genreCodes,
          tagCodes: input.tagCodes ?? [],
          sourceLocale,
          productionKind: input.productionKind ?? 'series',
          studioWorkspaceId: input.studioWorkspaceId ?? null,
          region: input.region ?? null,
          channelType: input.channelType,
        }),
      )
      .digest('hex');
    const ip = await this.prisma.$transaction(async (tx) => {
      if (input.idempotencyKey) {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`ip:create:${user.userId}:${input.idempotencyKey}`}, 0))`;
        const previous = await tx.ip.findUnique({
          where: {
            createdById_creationKey: {
              createdById: user.userId,
              creationKey: input.idempotencyKey,
            },
          },
          include: adminIpInclude,
        });
        if (previous) {
          if (previous.creationFingerprint !== fingerprint)
            throw new ConflictException(
              'This creation request key was already used with different inputs.',
            );
          if (previous.deletedAt)
            throw new ConflictException(
              'The IP created by this request has been deleted.',
            );
          return previous;
        }
      }
      const created = await tx.ip.create({
        data: {
          channelType: input.channelType,
          status: IpPublicationStatus.draft,
          listingVisibility: IpListingVisibility.private,
          sourceLocale,
          region: input.region ?? null,
          createdById: user.userId,
          creationKey: input.idempotencyKey ?? null,
          creationFingerprint: input.idempotencyKey ? fingerprint : null,
          localizations: {
            create: {
              locale: sourceLocale,
              status: IpLocalizationStatus.draft,
              title: input.title,
              summary,
              description: input.summary?.trim() || null,
            },
          },
        },
      });

      // Private IP drafts must not create a public Crew or bypass certification.
      if (hasCrewCreatePass(user.levelIds)) {
        const crew = await createCrewTx(
          tx,
          this.conversations,
          user.userId,
          {
            name: input.title,
            description: summary,
            logo: '',
            genres: [],
            styles: [],
            socialLinks: [],
            showcaseWorks: [],
            productionTemplateLocale: input.sourceLocale,
            productionKind: input.productionKind ?? 'series',
            ...(input.studioWorkspaceId
              ? { studioWorkspaceId: input.studioWorkspaceId }
              : { createStudioWorkspace: { name: input.title } }),
          },
          'unlisted',
        );
        await tx.$executeRaw`INSERT INTO ip_crew_origins (ip_id, crew_id, linked_by_id) VALUES (${created.id}::uuid, ${crew.id}, ${user.userId})`;
      }

      await replaceIpTaxonomyAssignmentsTx(tx, {
        ipId: created.id,
        type: IpTaxonomyTermType.genre,
        codes: input.genreCodes,
        source: IpTaxonomyAssignmentSource.creator,
        createdById: user.userId,
      });
      await replaceIpTaxonomyAssignmentsTx(tx, {
        ipId: created.id,
        type: IpTaxonomyTermType.tag,
        codes: input.tagCodes,
        source: IpTaxonomyAssignmentSource.creator,
        createdById: user.userId,
      });

      return tx.ip.findUniqueOrThrow({
        where: { id: created.id },
        include: adminIpInclude,
      });
    });

    return { ip: creatorIpDetailDto(ip, sourceLocale, user.userId) };
  }

  async updateCreatorIpProfile(
    user: AuthUser,
    ipId: string,
    input: UpdateCreatorIpProfileInput,
  ) {
    const ip = await this.prisma.ip.findFirst({
      where: {
        id: ipId,
        deletedAt: null,
        ...this.ipEditAccessWhere(user),
      },
      include: {
        localizations: {
          where: { archivedAt: null },
          orderBy: [{ locale: 'asc' }, { updatedAt: 'desc' }],
        },
      },
    });

    if (!ip) {
      throw new NotFoundException({
        code: 'IP_NOT_FOUND',
        msg: 'IP not found.',
      });
    }

    if (
      input.expectedVersion !== undefined &&
      input.expectedVersion !== ip.version
    ) {
      throw new ConflictException({
        code: 'IP_VERSION_CONFLICT',
        msg: 'This IP was updated elsewhere. Refresh and try again.',
      });
    }

    const sourceLocale = normalizeLocale(ip.sourceLocale);
    const sourceCopy =
      ip.localizations.find(
        (item) => normalizeLocale(item.locale) === sourceLocale,
      ) ?? ip.localizations[0];
    const title = input.title?.trim();
    const summary = input.summary?.trim();
    const description =
      input.description === undefined
        ? undefined
        : input.description?.trim() || null;
    const genreCodes = input.genreCodes;
    const tagCodes = input.tagCodes;

    const updated = await this.prisma.$transaction(async (tx) => {
      await this.lockCreatorIpSnapshotTx(tx, ip.id, ip.version);
      if (
        title !== undefined ||
        summary !== undefined ||
        description !== undefined
      ) {
        await tx.ipLocalization.upsert({
          where: {
            ipId_locale: {
              ipId: ip.id,
              locale: sourceLocale,
            },
          },
          create: {
            ipId: ip.id,
            locale: sourceLocale,
            status: contentLocalizationStatus(ip.status),
            title: title ?? sourceCopy?.title ?? ip.id,
            summary: summary ?? sourceCopy?.summary ?? title ?? ip.id,
            description:
              description !== undefined
                ? description
                : (sourceCopy?.description ?? null),
          },
          update: {
            ...(title !== undefined ? { title } : {}),
            ...(summary !== undefined ? { summary } : {}),
            ...(description !== undefined ? { description } : {}),
            ...(ip.status === IpPublicationStatus.published
              ? { status: IpLocalizationStatus.published }
              : sourceCopy?.status === IpLocalizationStatus.published
                ? { status: IpLocalizationStatus.draft }
                : {}),
          },
        });
      }

      if (genreCodes !== undefined) {
        await replaceIpTaxonomyAssignmentsTx(tx, {
          ipId: ip.id,
          type: IpTaxonomyTermType.genre,
          codes: genreCodes,
          source: IpTaxonomyAssignmentSource.creator,
          createdById: user.userId,
        });
      }
      if (tagCodes !== undefined) {
        await replaceIpTaxonomyAssignmentsTx(tx, {
          ipId: ip.id,
          type: IpTaxonomyTermType.tag,
          codes: tagCodes,
          source: IpTaxonomyAssignmentSource.creator,
          createdById: user.userId,
        });
      }

      return tx.ip.update({
        where: { id: ip.id },
        data: {
          ...(input.listingVisibility !== undefined
            ? {
                listingVisibility:
                  input.listingVisibility as IpListingVisibility,
              }
            : {}),
          ...(input.ageRating !== undefined
            ? { ageRating: input.ageRating as IpAgeRating }
            : {}),
          ...(input.copyrightOwner !== undefined
            ? { copyrightOwner: input.copyrightOwner?.trim() || null }
            : {}),
          ...(input.rightsSummary !== undefined
            ? {
                rightsSummary: input.rightsSummary as Prisma.InputJsonValue,
              }
            : {}),
          ...(input.aiDisclosure !== undefined
            ? {
                aiDisclosure: input.aiDisclosure as Prisma.InputJsonValue,
              }
            : {}),
          updatedById: user.userId,
          version: { increment: 1 },
        },
        include: adminIpInclude,
      });
    });

    return { ip: creatorIpDetailDto(updated, sourceLocale, user.userId) };
  }

  async updateCreatorIpAssets(
    user: AuthUser,
    ipId: string,
    input: UpdateCreatorIpAssetsInput,
  ) {
    const ip = await this.findCreatorIpForMutation(user, ipId);
    this.assertExpectedVersion(input.expectedVersion, ip.version);

    const updated = await this.prisma.$transaction(async (tx) => {
      await this.lockCreatorIpSnapshotTx(tx, ip.id, ip.version);
      const coverAssetId = await this.resolveMediaAssetPatchTx(tx, {
        assetId: input.coverAssetId,
        kind: MediaAssetKind.image,
      });
      const trailerAssetId = await this.resolveMediaAssetPatchTx(tx, {
        assetId: input.trailerAssetId,
        kind: MediaAssetKind.video,
      });

      return tx.ip.update({
        where: { id: ip.id },
        data: {
          ...(coverAssetId !== undefined ? { coverAssetId } : {}),
          ...(trailerAssetId !== undefined ? { trailerAssetId } : {}),
          updatedById: user.userId,
          version: { increment: 1 },
        },
        include: adminIpInclude,
      });
    });

    return { ip: creatorIpDetailDto(updated, ip.sourceLocale, user.userId) };
  }

  /**
   * Associate an already-confirmed MediaAsset with an IP.
   *
   * The bytes are uploaded direct-to-storage by the client via the stateless
   * SAS pipeline (`/aurora/media/upload-url` → PUT → `/aurora/media/confirm`),
   * or the episode multipart pipeline, which mints the active MediaAsset.
   * This endpoint only references that confirmed asset; even 35 GB episode
   * videos never pass through the nginx request body. The public return shape
   * `{ asset, ipAsset }` is preserved so the episode-create flow that consumes
   * `asset.id` as videoAssetId/coverAssetId is unchanged.
   */
  async uploadCreatorIpMedia(
    user: AuthUser,
    ipId: string,
    query: UploadCreatorIpMediaQuery,
    body: UploadCreatorIpMediaInput,
  ) {
    const ip = await this.findCreatorIpForMutation(user, ipId);

    const kind = query.kind as MediaAssetKind;

    const mediaAsset = await this.prisma.mediaAsset.findFirst({
      where: { id: body.mediaAssetId, deletedAt: null },
    });
    if (!mediaAsset) {
      throw new NotFoundException({
        code: 'IP_MEDIA_ASSET_NOT_FOUND',
        msg: 'Media asset not found.',
      });
    }
    // Must be an asset THIS user just confirmed via /aurora/media/confirm —
    // confirm stamps createdByUserId with the authed user.
    if (mediaAsset.createdByUserId !== user.userId) {
      throw new ForbiddenException({
        code: 'IP_MEDIA_ASSET_FORBIDDEN',
        msg: 'You do not own this media asset.',
      });
    }
    // The confirmed asset's kind must match what this IP slot expects
    // (cover ⇒ image, trailer/episode media ⇒ video, …).
    if (mediaAsset.kind !== kind) {
      throw new BadRequestException({
        code: 'IP_MEDIA_KIND_MISMATCH',
        msg: `Media asset is not a ${kind}.`,
      });
    }
    // Defence-in-depth: the SAS pipeline already caps per-kind size, but
    // re-assert against the IP per-kind cap on the HEAD-verified size.
    const limit =
      kind === MediaAssetKind.video && query.purpose === 'episode_media'
        ? EPISODE_SOURCE_MAX_BYTES
        : IP_MEDIA_UPLOAD_LIMITS[kind];
    if (mediaAsset.sizeBytes !== null && mediaAsset.sizeBytes > BigInt(limit)) {
      throw new BadRequestException({
        code: 'IP_MEDIA_FILE_TOO_LARGE',
        msg: `File is too large for ${kind}.`,
      });
    }

    const { asset, ipAsset } = await this.prisma.$transaction(async (tx) => {
      // IP media is public-facing (covers/trailers/episode video resolve on
      // read). Confirm mints assets `private`; promote to `public` here to
      // preserve the prior display behavior. This is NOT the paywall.
      const publishedAsset = await tx.mediaAsset.update({
        where: { id: mediaAsset.id },
        data: { visibility: MediaAssetVisibility.public },
      });

      const libraryAsset =
        query.purpose === 'source_material'
          ? await tx.ipAsset.create({
              data: {
                ipId: ip.id,
                mediaAssetId: publishedAsset.id,
                purpose: IpAssetPurpose.source_material,
                title: deriveAssetTitle(publishedAsset.objectKey),
                createdById: user.userId,
              },
              include: { mediaAsset: true },
            })
          : null;

      return { asset: publishedAsset, ipAsset: libraryAsset };
    });

    return {
      asset: assetDto(asset),
      ipAsset: ipAsset ? ipAssetDto(ipAsset) : null,
    };
  }

  async listCreatorIpAssets(
    user: AuthUser,
    ipId: string,
    query: ListCreatorIpAssetsQuery = {},
  ) {
    const ip = await this.findCreatorIpForMutation(user, ipId);
    const items = await this.prisma.ipAsset.findMany({
      where: {
        ipId: ip.id,
        removedAt: null,
        ...(query.purpose ? { purpose: query.purpose } : {}),
      },
      include: { mediaAsset: true },
      orderBy: [{ displayOrder: 'asc' }, { createdAt: 'desc' }],
    });

    return { items: items.map(ipAssetDto) };
  }

  async removeCreatorIpAsset(user: AuthUser, ipId: string, assetId: string) {
    const ip = await this.findCreatorIpForMutation(user, ipId);
    const item = await this.prisma.ipAsset.findFirst({
      where: {
        id: assetId,
        ipId: ip.id,
        removedAt: null,
      },
      include: { mediaAsset: true },
    });
    if (!item) {
      throw new NotFoundException({
        code: 'IP_ASSET_NOT_FOUND',
        msg: 'IP asset not found.',
      });
    }

    const removed = await this.prisma.ipAsset.update({
      where: { id: item.id },
      data: {
        removedAt: new Date(),
        updatedById: user.userId,
      },
      include: { mediaAsset: true },
    });

    return { asset: ipAssetDto(removed) };
  }

  async createCreatorIpEpisode(
    user: AuthUser,
    ipId: string,
    input: CreateCreatorIpEpisodeInput,
  ) {
    const ip = await this.findCreatorIpForMutation(user, ipId);
    this.assertExpectedVersion(input.expectedVersion, ip.version);

    // Read-max-then-insert can race a concurrent create onto the same number.
    // The (ip_id, episode_no) unique index is the real guard; on a collision we
    // recompute and retry a few times rather than surfacing a 500.
    for (let attempt = 0; ; attempt += 1) {
      try {
        const updated = await this.prisma.$transaction(async (tx) => {
          await this.lockCreatorIpSnapshotTx(tx, ip.id, ip.version);
          const maxEpisode = await tx.ipEpisode.aggregate({
            where: { ipId: ip.id },
            _max: { episodeNo: true, sortOrder: true },
          });
          // Append-only, server-authoritative numbering: one past the highest
          // number ever used for this IP — including soft-deleted episodes,
          // whose rows still occupy their (ip_id, episode_no) unique slot. So a
          // deleted number is never reissued and a create can't collide with a
          // tombstone. The client no longer supplies episodeNo.
          const episodeNo = (maxEpisode._max.episodeNo ?? 0) + 1;

          const coverAssetId = await this.resolveMediaAssetCreateTx(tx, {
            assetId: input.coverAssetId,
            kind: MediaAssetKind.image,
          });
          const mediaAssetId = await this.resolveMediaAssetCreateTx(tx, {
            assetId: input.mediaAssetId,
            kind: MediaAssetKind.video,
          });
          const trailerAssetId = await this.resolveMediaAssetCreateTx(tx, {
            assetId: input.trailerAssetId,
            kind: MediaAssetKind.video,
          });

          await tx.ipEpisode.create({
            data: {
              ipId: ip.id,
              episodeNo,
              sortOrder:
                input.sortOrder ??
                (maxEpisode._max.sortOrder != null
                  ? maxEpisode._max.sortOrder + 1000
                  : episodeNo * 1000),
              status: contentEpisodeStatus(ip.status),
              durationSeconds: input.durationSeconds,
              isFreePreview: input.isFreePreview ?? false,
              coverAssetId,
              mediaAssetId,
              trailerAssetId,
              createdById: user.userId,
              localizations: {
                create: {
                  locale: ip.sourceLocale,
                  status: contentLocalizationStatus(ip.status),
                  title: input.title,
                  summary: input.summary?.trim() || null,
                  description: input.summary?.trim() || null,
                },
              },
            },
          });

          return tx.ip.update({
            where: { id: ip.id },
            data: {
              updatedById: user.userId,
              version: { increment: 1 },
            },
            include: adminIpInclude,
          });
        });

        return {
          ip: creatorIpDetailDto(updated, ip.sourceLocale, user.userId),
        };
      } catch (error) {
        if (
          attempt < 3 &&
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === 'P2002'
        ) {
          continue;
        }
        throw error;
      }
    }
  }

  async updateCreatorIpEpisode(
    user: AuthUser,
    ipId: string,
    episodeId: string,
    input: UpdateCreatorIpEpisodeInput,
  ) {
    const ip = await this.findCreatorIpForMutation(user, ipId);
    this.assertExpectedVersion(input.expectedVersion, ip.version);

    const episode = await this.prisma.ipEpisode.findFirst({
      where: { id: episodeId, ipId: ip.id, deletedAt: null },
      include: {
        localizations: {
          where: { archivedAt: null },
          orderBy: [{ locale: 'asc' }, { updatedAt: 'desc' }],
        },
      },
    });
    if (!episode) {
      throw new NotFoundException({
        code: 'IP_EPISODE_NOT_FOUND',
        msg: 'Episode not found.',
      });
    }

    if (
      input.status &&
      input.status !== IpPublicationStatus.draft &&
      input.status !== IpPublicationStatus.hidden
    ) {
      throw new BadRequestException({
        code: 'IP_EPISODE_STATUS_FORBIDDEN',
        msg: 'Creators can only keep an episode as draft or hidden before admin review.',
      });
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      await this.lockCreatorIpSnapshotTx(tx, ip.id, ip.version);
      if (
        input.episodeNo !== undefined &&
        input.episodeNo !== episode.episodeNo
      ) {
        const conflict = await tx.ipEpisode.findFirst({
          where: { ipId: ip.id, episodeNo: input.episodeNo },
          select: { id: true },
        });
        if (conflict) {
          throw new BadRequestException({
            code: 'IP_EPISODE_NUMBER_CONFLICT',
            msg: 'This episode number already exists.',
          });
        }
      }

      const coverAssetId = await this.resolveMediaAssetPatchTx(tx, {
        assetId: input.coverAssetId,
        kind: MediaAssetKind.image,
      });
      const mediaAssetId = await this.resolveMediaAssetPatchTx(tx, {
        assetId: input.mediaAssetId,
        kind: MediaAssetKind.video,
      });
      const trailerAssetId = await this.resolveMediaAssetPatchTx(tx, {
        assetId: input.trailerAssetId,
        kind: MediaAssetKind.video,
      });

      const title = input.title?.trim();
      const summary = input.summary?.trim();
      if (title !== undefined || summary !== undefined) {
        const sourceCopy =
          episode.localizations.find(
            (item) => normalizeLocale(item.locale) === ip.sourceLocale,
          ) ?? episode.localizations[0];
        await tx.ipEpisodeLocalization.upsert({
          where: {
            episodeId_locale: {
              episodeId: episode.id,
              locale: ip.sourceLocale,
            },
          },
          create: {
            episodeId: episode.id,
            locale: ip.sourceLocale,
            status: contentLocalizationStatus(ip.status),
            title: title ?? sourceCopy?.title ?? `Episode ${episode.episodeNo}`,
            summary: summary ?? sourceCopy?.summary ?? null,
            description:
              summary !== undefined
                ? summary || null
                : (sourceCopy?.description ?? null),
          },
          update: {
            ...(title !== undefined ? { title } : {}),
            ...(summary !== undefined
              ? { summary, description: summary || null }
              : {}),
            ...(ip.status === IpPublicationStatus.published
              ? { status: IpLocalizationStatus.published }
              : sourceCopy?.status === IpLocalizationStatus.published
                ? { status: IpLocalizationStatus.draft }
                : {}),
          },
        });
      }

      await tx.ipEpisode.update({
        where: { id: episode.id },
        data: {
          ...(input.episodeNo !== undefined
            ? { episodeNo: input.episodeNo }
            : {}),
          ...(input.sortOrder !== undefined
            ? { sortOrder: input.sortOrder }
            : {}),
          ...(input.durationSeconds !== undefined
            ? { durationSeconds: input.durationSeconds }
            : {}),
          ...(input.isFreePreview !== undefined
            ? { isFreePreview: input.isFreePreview }
            : {}),
          ...(input.status !== undefined ? { status: input.status } : {}),
          ...(coverAssetId !== undefined ? { coverAssetId } : {}),
          ...(mediaAssetId !== undefined ? { mediaAssetId } : {}),
          ...(trailerAssetId !== undefined ? { trailerAssetId } : {}),
          updatedById: user.userId,
          version: { increment: 1 },
        },
      });

      return tx.ip.update({
        where: { id: ip.id },
        data: {
          updatedById: user.userId,
          version: { increment: 1 },
        },
        include: adminIpInclude,
      });
    });

    return { ip: creatorIpDetailDto(updated, ip.sourceLocale, user.userId) };
  }

  async deleteCreatorIpEpisode(
    user: AuthUser,
    ipId: string,
    episodeId: string,
  ) {
    const ip = await this.findCreatorIpForMutation(user, ipId);
    const now = new Date();
    const updated = await this.prisma.$transaction(async (tx) => {
      // Serialize deletion with grants before reading protected-use counts.
      await tx.$queryRaw`SELECT id FROM ips WHERE id=${ip.id}::uuid FOR UPDATE`;
      const episode = await tx.ipEpisode.findFirst({
        where: { id: episodeId, ipId: ip.id, deletedAt: null },
        include: {
          _count: {
            select: {
              purchaseOrders: true,
              entitlements: true,
            },
          },
        },
      });
      if (!episode) {
        throw new NotFoundException({
          code: 'IP_EPISODE_NOT_FOUND',
          msg: 'Episode not found.',
        });
      }
      if (episode._count.purchaseOrders || episode._count.entitlements) {
        throw new BadRequestException({
          code: 'IP_EPISODE_HAS_ORDERS',
          msg: 'Episode already has orders or entitlements and cannot be deleted.',
        });
      }

      await tx.ipPriceRule.updateMany({
        where: {
          ipId: ip.id,
          episodeId: episode.id,
          archivedAt: null,
        },
        data: {
          status: IpPriceRuleStatus.archived,
          archivedAt: now,
          updatedById: user.userId,
        },
      });
      await tx.ipEpisode.update({
        where: { id: episode.id },
        data: {
          status: IpPublicationStatus.archived,
          deletedAt: now,
          archivedAt: now,
          updatedById: user.userId,
          version: { increment: 1 },
        },
      });
      return tx.ip.update({
        where: { id: ip.id },
        data: {
          updatedById: user.userId,
          version: { increment: 1 },
        },
        include: adminIpInclude,
      });
    });

    return { ip: creatorIpDetailDto(updated, ip.sourceLocale, user.userId) };
  }

  async upsertCreatorIpPriceRule(
    user: AuthUser,
    ipId: string,
    input: UpsertCreatorIpPriceRuleInput,
  ) {
    const ip = await this.findCreatorIpForMutation(user, ipId);
    this.assertExpectedVersion(input.expectedVersion, ip.version);

    const targetType = input.targetType as IpTargetType;
    const episodeId =
      targetType === IpTargetType.episode ? (input.episodeId ?? null) : null;
    if (episodeId) {
      const episode = await this.prisma.ipEpisode.findFirst({
        where: { id: episodeId, ipId: ip.id, deletedAt: null },
        select: { id: true },
      });
      if (!episode) {
        throw new NotFoundException({
          code: 'IP_EPISODE_NOT_FOUND',
          msg: 'Episode not found.',
        });
      }
    }

    const now = new Date();
    const status = input.status as IpPriceRuleStatus;
    const updated = await this.prisma.$transaction(async (tx) => {
      await this.lockCreatorIpSnapshotTx(tx, ip.id, ip.version);
      await tx.ipPriceRule.updateMany({
        where: {
          ipId: ip.id,
          targetType,
          episodeId,
          campaignId: null,
          archivedAt: null,
        },
        data: {
          status: IpPriceRuleStatus.archived,
          archivedAt: now,
          updatedById: user.userId,
        },
      });

      if (
        status !== IpPriceRuleStatus.disabled &&
        status !== IpPriceRuleStatus.archived
      ) {
        await tx.ipPriceRule.create({
          data: {
            ipId: ip.id,
            episodeId,
            targetType,
            status,
            currency: WalletCurrencyType.community_point,
            amount: BigInt(input.amount ?? '0'),
            originalAmount: input.originalAmount
              ? BigInt(input.originalAmount)
              : null,
            priority: input.priority,
            startsAt: input.startsAt ?? null,
            endsAt: input.endsAt ?? null,
            unlocksAt: input.unlocksAt ?? null,
            maxPerUser: input.maxPerUser ?? null,
            createdById: user.userId,
          },
        });
      }

      return tx.ip.update({
        where: { id: ip.id },
        data: {
          updatedById: user.userId,
          version: { increment: 1 },
        },
        include: adminIpInclude,
      });
    });

    return { ip: creatorIpDetailDto(updated, ip.sourceLocale, user.userId) };
  }

  async submitCreatorIpForReview(
    user: AuthUser,
    ipId: string,
    input: SubmitCreatorIpReviewInput,
  ) {
    const ip = await this.prisma.ip.findFirst({
      where: {
        id: ipId,
        deletedAt: null,
        ...this.ipEditAccessWhere(user),
      },
      include: adminIpInclude,
    });

    if (!ip) {
      throw new NotFoundException({
        code: 'IP_NOT_FOUND',
        msg: 'IP not found.',
      });
    }

    if (
      input.expectedVersion !== undefined &&
      input.expectedVersion !== ip.version
    ) {
      throw new ConflictException({
        code: 'IP_VERSION_CONFLICT',
        msg: 'This IP was updated elsewhere. Refresh and try again.',
      });
    }

    const lockedReviewStatuses = new Set<IpPublicationStatus>([
      IpPublicationStatus.scheduled,
      IpPublicationStatus.published,
      IpPublicationStatus.suspended,
      IpPublicationStatus.archived,
    ]);

    if (lockedReviewStatuses.has(ip.status)) {
      throw new BadRequestException({
        code: 'IP_REVIEW_STATE_INVALID',
        msg: 'This IP cannot be submitted for review from its current state.',
      });
    }

    const sourceLocale = normalizeLocale(ip.sourceLocale);
    const copy = selectIpLocalization(ip, sourceLocale, false).value;
    const title = copy?.title?.trim();
    if (!title) {
      throw new BadRequestException({
        code: 'IP_REVIEW_TITLE_REQUIRED',
        msg: 'Complete the IP title before submitting for review.',
      });
    }
    const summary = copy?.summary?.trim();
    if (!summary) {
      throw new BadRequestException({
        code: 'IP_REVIEW_SUMMARY_REQUIRED',
        msg: 'Complete the IP short summary before submitting for review.',
      });
    }
    const missingRequirements = getIpPublicationRequirementMissing(ip).filter(
      (item) => item !== 'title' && item !== 'short summary',
    );
    if (missingRequirements.length > 0) {
      throw new BadRequestException({
        code: 'IP_REVIEW_REQUIREMENTS_NOT_MET',
        msg: `Complete review requirements before submitting: ${missingRequirements.join(', ')}.`,
        missing: missingRequirements,
      });
    }

    const now = new Date();
    const updated = await this.prisma.$transaction(async (tx) => {
      await this.lockCreatorIpSnapshotTx(tx, ip.id, ip.version);
      await tx.ipReviewSubmission.updateMany({
        where: {
          targetType: IpReviewTargetType.ip,
          ipId: ip.id,
          status: {
            in: [
              IpReviewStatus.submitted,
              IpReviewStatus.in_review,
              IpReviewStatus.changes_requested,
            ],
          },
        },
        data: {
          status: IpReviewStatus.canceled,
          canceledAt: now,
          metadata: {
            reason: 'creator_resubmitted',
            canceledById: user.userId,
          },
        },
      });

      await tx.ipReviewSubmission.create({
        data: {
          targetType: IpReviewTargetType.ip,
          targetId: ip.id,
          ipId: ip.id,
          status: IpReviewStatus.submitted,
          snapshot: creatorReviewSnapshot(ip) as Prisma.InputJsonValue,
          changeSummary:
            input.changeSummary?.trim() ??
            (ip.status === IpPublicationStatus.changes_requested
              ? 'Resubmitted after requested changes.'
              : 'Submitted for publication review.'),
          submittedById: user.userId,
          events: {
            create: {
              eventType: IpReviewEventType.submitted,
              actorUserId: user.userId,
              message: input.changeSummary?.trim() ?? null,
            },
          },
        },
      });

      await tx.ipLocalization.updateMany({
        where: {
          ipId: ip.id,
          locale: sourceLocale,
          archivedAt: null,
        },
        data: {
          status: IpLocalizationStatus.needs_review,
        },
      });

      return tx.ip.update({
        where: { id: ip.id },
        data: {
          status: IpPublicationStatus.submitted,
          listingVisibility: IpListingVisibility.private,
          scheduledAt: null,
          updatedById: user.userId,
          version: { increment: 1 },
        },
        include: adminIpInclude,
      });
    });

    return { ip: creatorIpDetailDto(updated, sourceLocale, user.userId) };
  }

  async getAdminOverview(query: ListAdminIpsQuery) {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const ipWhere = adminIpWhere(query);

    const [
      totalIps,
      publishedIps,
      pendingReviewIps,
      activePriceRules,
      openReports,
      recentOrders,
      reviewQueue,
      reports,
      recentIps,
    ] = await Promise.all([
      this.prisma.ip.count({ where: ipWhere }),
      this.prisma.ip.count({
        where: {
          ...ipWhere,
          status: {
            in: [IpPublicationStatus.scheduled, IpPublicationStatus.published],
          },
          listingVisibility: IpListingVisibility.public,
        },
      }),
      this.prisma.ip.count({
        where: {
          ...ipWhere,
          status: {
            in: [
              IpPublicationStatus.submitted,
              IpPublicationStatus.in_review,
              IpPublicationStatus.changes_requested,
              IpPublicationStatus.approved,
            ],
          },
        },
      }),
      this.prisma.ipPriceRule.count({
        where: {
          status: IpPriceRuleStatus.active,
          archivedAt: null,
        },
      }),
      this.prisma.ipContentReport.count({
        where: {
          status: { in: [IpReportStatus.submitted, IpReportStatus.triaged] },
        },
      }),
      this.prisma.ipPurchaseOrder.findMany({
        where: {
          status: IpPurchaseOrderStatus.fulfilled,
          createdAt: { gte: sevenDaysAgo },
        },
        orderBy: { createdAt: 'desc' },
        take: 8,
      }),
      this.prisma.ipReviewSubmission.findMany({
        where: {
          status: {
            in: [
              IpReviewStatus.submitted,
              IpReviewStatus.in_review,
              IpReviewStatus.changes_requested,
            ],
          },
        },
        orderBy: { submittedAt: 'asc' },
        take: 100,
        include: {
          ip: {
            include: {
              localizations: {
                where: { archivedAt: null },
                orderBy: [{ locale: 'asc' }, { updatedAt: 'desc' }],
              },
            },
          },
          episode: {
            include: {
              localizations: {
                where: { archivedAt: null },
                orderBy: [{ locale: 'asc' }, { updatedAt: 'desc' }],
              },
            },
          },
        },
      }),
      this.prisma.ipContentReport.findMany({
        where: {
          status: { in: [IpReportStatus.submitted, IpReportStatus.triaged] },
        },
        orderBy: { createdAt: 'asc' },
        take: 8,
        include: {
          ip: {
            include: {
              localizations: {
                where: { archivedAt: null },
                orderBy: [{ locale: 'asc' }, { updatedAt: 'desc' }],
              },
            },
          },
          episode: {
            include: {
              localizations: {
                where: { archivedAt: null },
                orderBy: [{ locale: 'asc' }, { updatedAt: 'desc' }],
              },
            },
          },
        },
      }),
      this.prisma.ip.findMany({
        where: ipWhere,
        include: adminIpInclude,
        orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
        take: 8,
      }),
    ]);

    return {
      generatedAt: new Date().toISOString(),
      metrics: {
        totalIps,
        publishedIps,
        pendingReviewIps,
        activePriceRules,
        openReports,
        ordersLast7Days: recentOrders.length,
      },
      reviewQueue: reviewQueue.map((review) =>
        adminReviewDto(review, query.locale),
      ),
      reports: reports.map((report) => adminReportDto(report, query.locale)),
      recentIps: recentIps.map((ip) => adminIpSummaryDto(ip, query.locale)),
      recentOrders: recentOrders.map(purchaseOrderDto),
    };
  }

  async listAdminIps(query: ListAdminIpsQuery) {
    const rows = await this.prisma.ip.findMany({
      where: adminIpWhere(query),
      cursor: query.cursor ? { id: query.cursor } : undefined,
      skip: query.cursor ? 1 : 0,
      include: adminIpInclude,
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
      take: query.limit + 1,
    });

    const items = rows.slice(0, query.limit);
    return {
      items: items.map((ip) => adminIpSummaryDto(ip, query.locale)),
      nextCursor: rows.length > query.limit ? (items.at(-1)?.id ?? null) : null,
    };
  }

  async listAdminPurchaseOrders(query: ListAdminIpOrdersQuery) {
    const rows = await this.prisma.ipPurchaseOrder.findMany({
      where: adminPurchaseOrderWhere(query),
      cursor: query.cursor ? { id: query.cursor } : undefined,
      skip: query.cursor ? 1 : 0,
      include: commerceOrderInclude,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: query.limit + 1,
    });

    const items = rows.slice(0, query.limit);
    return {
      items: items.map((order) =>
        commercePurchaseOrderDto(order, query.locale),
      ),
      nextCursor: rows.length > query.limit ? (items.at(-1)?.id ?? null) : null,
    };
  }

  async listAdminEntitlements(query: ListAdminIpEntitlementsQuery) {
    const rows = await this.prisma.ipContentEntitlement.findMany({
      where: adminEntitlementWhere(query),
      cursor: query.cursor ? { id: query.cursor } : undefined,
      skip: query.cursor ? 1 : 0,
      include: commerceEntitlementInclude,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: query.limit + 1,
    });

    const items = rows.slice(0, query.limit);
    return {
      items: items.map((entitlement) =>
        commerceEntitlementDto(entitlement, query.locale),
      ),
      nextCursor: rows.length > query.limit ? (items.at(-1)?.id ?? null) : null,
    };
  }

  async getAdminIp(ipId: string, query: { locale?: string }) {
    const ip = await this.prisma.ip.findFirst({
      where: { id: ipId, deletedAt: null },
      include: adminIpInclude,
    });
    if (!ip) {
      throw new NotFoundException({
        code: 'IP_NOT_FOUND',
        msg: 'IP not found.',
      });
    }
    return { ip: adminIpDetailDto(ip, query.locale) };
  }

  async grantAdminEntitlement(
    user: AuthUser,
    input: GrantAdminIpEntitlementInput,
  ) {
    const targetType = input.targetType as IpTargetType;
    // The dialog sends the encoded public id; entitlements store the raw id.
    const targetUserId = decodeUserId(input.userId);
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM ips WHERE id = ${input.ipId}::uuid FOR SHARE`;
      const ip = await tx.ip.findFirst({
        where: { id: input.ipId, deletedAt: null },
        include: {
          episodes: {
            where: {
              deletedAt: null,
              ...(input.episodeId ? { id: input.episodeId } : {}),
            },
            include: {
              localizations: {
                where: { archivedAt: null },
                orderBy: [{ locale: 'asc' }, { updatedAt: 'desc' }],
              },
            },
          },
          localizations: {
            where: { archivedAt: null },
            orderBy: [{ locale: 'asc' }, { updatedAt: 'desc' }],
          },
        },
      });
      if (!ip) {
        throw new NotFoundException({
          code: 'IP_NOT_FOUND',
          msg: 'IP not found.',
        });
      }
      if (targetType === IpTargetType.episode) {
        const episode = ip.episodes.find((item) => item.id === input.episodeId);
        if (!episode) {
          throw new NotFoundException({
            code: 'IP_EPISODE_NOT_FOUND',
            msg: 'Episode not found for this IP.',
          });
        }
      }

      const result = await (async () => {
        const existing = await findCurrentOrPendingEntitlementTx(tx, {
          userId: targetUserId,
          ipId: ip.id,
          targetType,
          episodeId: input.episodeId ?? null,
        });
        if (existing) {
          return {
            entitlement: await tx.ipContentEntitlement.findUniqueOrThrow({
              where: { id: existing.id },
              include: commerceEntitlementInclude,
            }),
            alreadyGranted: true,
          };
        }

        const [{ now }] = await tx.$queryRaw<
          Array<{ now: Date }>
        >`SELECT clock_timestamp() AS now`;
        const entitlement = await tx.ipContentEntitlement.create({
          data: {
            userId: targetUserId,
            ipId: ip.id,
            episodeId:
              targetType === IpTargetType.episode
                ? (input.episodeId ?? null)
                : null,
            targetType,
            status: IpEntitlementStatus.active,
            sourceType: 'admin_grant',
            sourceId: randomUUID(),
            startsAt: input.startsAt ?? now,
            endsAt: input.endsAt ?? null,
            metadata: {
              reason: input.reason,
              grantedById: user.userId,
              grantedByName: user.userName ?? user.email ?? null,
            },
          },
        });
        await ensureCollectionItemTx(tx, targetUserId, entitlement);
        return {
          entitlement: await tx.ipContentEntitlement.findUniqueOrThrow({
            where: { id: entitlement.id },
            include: commerceEntitlementInclude,
          }),
          alreadyGranted: false,
        };
      })();
      return {
        entitlement: commerceEntitlementDto(
          result.entitlement,
          ip.sourceLocale,
        ),
        alreadyGranted: result.alreadyGranted,
      };
    });
  }

  async revokeAdminEntitlement(
    user: AuthUser,
    entitlementId: string,
    input: RevokeAdminIpEntitlementInput,
  ) {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM ip_content_entitlements WHERE id = ${entitlementId}::uuid FOR UPDATE`;
      const entitlement = await tx.ipContentEntitlement.findUnique({
        where: { id: entitlementId },
        include: commerceEntitlementInclude,
      });
      if (!entitlement) {
        throw new NotFoundException({
          code: 'IP_ENTITLEMENT_NOT_FOUND',
          msg: 'IP entitlement not found.',
        });
      }
      if (entitlement.status === IpEntitlementStatus.revoked) {
        return {
          entitlement: commerceEntitlementDto(
            entitlement,
            entitlement.ip.sourceLocale,
          ),
          alreadyRevoked: true,
        };
      }
      if (entitlement.status !== IpEntitlementStatus.active) {
        throw new BadRequestException({
          code: 'IP_ENTITLEMENT_NOT_ACTIVE',
          msg: 'Only active IP entitlements can be revoked.',
        });
      }

      const [{ now }] = await tx.$queryRaw<
        Array<{ now: Date }>
      >`SELECT clock_timestamp() AS now`;
      const row = await tx.ipContentEntitlement.update({
        where: { id: entitlement.id },
        data: {
          status: IpEntitlementStatus.revoked,
          revokedAt: now,
          endsAt:
            now <= entitlement.startsAt
              ? entitlement.endsAt
              : entitlement.endsAt && entitlement.endsAt < now
                ? entitlement.endsAt
                : now,
          metadata: {
            ...(isRecord(entitlement.metadata) ? entitlement.metadata : {}),
            revokeReason: input.reason,
            revokedById: user.userId,
            revokedByName: user.userName ?? user.email ?? null,
          },
        },
        include: commerceEntitlementInclude,
      });
      await tx.ipCollectionItem.updateMany({
        where: {
          entitlementId: entitlement.id,
          status: IpCollectionItemStatus.active,
          removedAt: null,
        },
        data: {
          status: IpCollectionItemStatus.removed,
          removedAt: now,
        },
      });
      return {
        entitlement: commerceEntitlementDto(row, row.ip.sourceLocale),
        alreadyRevoked: false,
      };
    });
  }

  async updateAdminIpChannel(
    user: AuthUser,
    ipId: string,
    input: { channelType: 'ip' | 'community'; expectedVersion: number },
  ) {
    return this.prisma.$transaction(async (tx) => {
      const result = await tx.ip.updateMany({
        where: { id: ipId, deletedAt: null, version: input.expectedVersion },
        data: {
          channelType: input.channelType,
          updatedById: user.userId,
          version: { increment: 1 },
        },
      });
      if (result.count !== 1)
        throw new ConflictException(
          'Channel changed or no longer exists. Refresh and retry.',
        );
      const ip = await tx.ip.findUniqueOrThrow({
        where: { id: ipId },
        include: adminIpInclude,
      });
      return { channelType: ip.channelType };
    });
  }

  async updateAdminIpPublication(
    user: AuthUser,
    ipId: string,
    input: UpdateAdminIpPublicationInput,
  ) {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM ips WHERE id=${ipId}::uuid FOR UPDATE`;
      const ip = await tx.ip.findFirst({
        where: { id: ipId, deletedAt: null },
        include: adminIpInclude,
      });
      if (!ip) {
        throw new NotFoundException({
          code: 'IP_NOT_FOUND',
          msg: 'IP not found.',
        });
      }

      const [{ now }] = await tx.$queryRaw<
        { now: Date }[]
      >`SELECT clock_timestamp() AS now`;
      const nextStatus = input.status as IpPublicationStatus;
      const scheduledAt =
        input.scheduledAt === null
          ? null
          : (input.scheduledAt ?? ip.scheduledAt);
      if (nextStatus === IpPublicationStatus.scheduled) {
        if (!scheduledAt) {
          throw new BadRequestException({
            code: 'IP_SCHEDULE_REQUIRED',
            msg: 'scheduledAt is required when scheduling an IP.',
          });
        }
        if (scheduledAt <= now) {
          throw new BadRequestException({
            code: 'IP_SCHEDULE_IN_PAST',
            msg: 'scheduledAt must be in the future.',
          });
        }
      }
      if (
        nextStatus === IpPublicationStatus.published ||
        nextStatus === IpPublicationStatus.scheduled
      ) {
        assertIpReadyForPublication(ip);
        const openReportCount = await tx.ipContentReport.count({
          where: {
            ipId: ip.id,
            status: {
              in: [IpReportStatus.submitted, IpReportStatus.triaged],
            },
          },
        });
        if (openReportCount > 0) {
          throw new BadRequestException({
            code: 'IP_PUBLISH_OPEN_REPORTS',
            msg: `Resolve ${openReportCount} open IP report(s) before publishing.`,
          });
        }
      }

      const nextVisibility =
        input.listingVisibility ??
        defaultVisibilityForStatus(nextStatus, ip.listingVisibility);
      const actionType = moderationActionForPublicationStatus(nextStatus);
      const updated = await (async () => {
        const updateResult = await tx.ip.updateMany({
          where: {
            id: ip.id,
            deletedAt: null,
            ...(input.expectedVersion !== undefined
              ? { version: input.expectedVersion }
              : {}),
          },
          data: {
            status: nextStatus,
            listingVisibility: nextVisibility,
            scheduledAt:
              nextStatus === IpPublicationStatus.scheduled ? scheduledAt : null,
            publishedAt:
              nextStatus === IpPublicationStatus.published
                ? (ip.publishedAt ?? now)
                : ip.publishedAt,
            suspendedAt:
              nextStatus === IpPublicationStatus.suspended
                ? (ip.suspendedAt ?? now)
                : nextStatus === IpPublicationStatus.approved ||
                    nextStatus === IpPublicationStatus.published
                  ? null
                  : ip.suspendedAt,
            archivedAt:
              nextStatus === IpPublicationStatus.archived
                ? (ip.archivedAt ?? now)
                : ip.archivedAt,
            updatedById: user.userId,
            version: { increment: 1 },
          },
        });
        if (updateResult.count !== 1) {
          throw new ConflictException({
            code: 'IP_VERSION_CONFLICT',
            msg: 'IP was updated by another operator. Refresh and retry.',
          });
        }

        await syncIpLocalizationStatusForPublication(tx, ip.id, nextStatus);
        // Episodes created while the IP was still draft stay `draft` until this
        // handoff — creators cannot publish them themselves. Mirror IP
        // localization sync so the first (pre-review) episode goes live with the IP.
        await syncIpEpisodeStatusForPublication(tx, ip.id, nextStatus, {
          now,
          scheduledAt:
            nextStatus === IpPublicationStatus.scheduled ? scheduledAt : null,
        });
        await settleIpReviewSubmissionsForPublication(tx, {
          ipId: ip.id,
          reviewerId: user.userId,
          status: nextStatus,
          reason: input.reason,
          now,
        });

        const updatedIp = await tx.ip.findUniqueOrThrow({
          where: { id: ip.id },
          include: adminIpInclude,
        });
        await tx.ipModerationAction.create({
          data: {
            targetType: IpModerationTargetType.ip,
            targetId: ip.id,
            actionType,
            actorUserId: user.userId,
            reason: input.reason,
            before: moderationSnapshot(ip) as Prisma.InputJsonValue,
            after: moderationSnapshot(updatedIp) as Prisma.InputJsonValue,
            startsAt:
              nextStatus === IpPublicationStatus.scheduled ? scheduledAt : null,
            metadata: {
              source: 'admin_ip_commerce_publication',
            },
          },
        });

        return updatedIp;
      })();
      return { ip: adminIpDetailDto(updated, ip.sourceLocale) };
    });
  }

  async resolveAdminReport(
    user: AuthUser,
    reportId: string,
    input: ResolveAdminIpReportInput,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const target = await tx.ipContentReport.findUnique({
        where: { id: reportId },
        select: { ipId: true, episodeId: true },
      });
      if (target?.ipId)
        await tx.$queryRaw`SELECT id FROM ips WHERE id=${target.ipId}::uuid FOR UPDATE`;
      if (target?.episodeId)
        await tx.$queryRaw`SELECT id FROM ip_episodes WHERE id=${target.episodeId}::uuid FOR UPDATE`;
      await tx.$queryRaw`SELECT id FROM ip_content_reports WHERE id=${reportId}::uuid FOR UPDATE`;
      const report = await tx.ipContentReport.findUnique({
        where: { id: reportId },
        include: {
          ip: true,
          episode: true,
        },
      });
      if (!report) {
        throw new NotFoundException({
          code: 'IP_REPORT_NOT_FOUND',
          msg: 'IP report not found.',
        });
      }

      const [{ now }] = await tx.$queryRaw<
        { now: Date }[]
      >`SELECT clock_timestamp() AS now`;
      const actionType = input.actionType as IpModerationActionType | undefined;
      if (actionType) {
        await this.applyModerationAction(tx, user.userId, report, actionType, {
          reason: input.reason ?? input.resolutionNote ?? 'Report resolved.',
          now,
        });
      }

      const updated = await tx.ipContentReport.update({
        where: { id: report.id },
        data: {
          status: input.status as IpReportStatus,
          resolvedById: user.userId,
          resolutionNote: input.resolutionNote,
          resolvedAt:
            input.status === IpReportStatus.triaged ? report.resolvedAt : now,
          metadata: {
            ...(isRecord(report.metadata) ? report.metadata : {}),
            actionType: actionType ?? null,
          },
        },
        include: {
          ip: {
            include: {
              localizations: {
                where: { archivedAt: null },
                orderBy: [{ locale: 'asc' }, { updatedAt: 'desc' }],
              },
            },
          },
          episode: {
            include: {
              localizations: {
                where: { archivedAt: null },
                orderBy: [{ locale: 'asc' }, { updatedAt: 'desc' }],
              },
            },
          },
        },
      });
      return { report: adminReportDto(updated, report.ip?.sourceLocale) };
    });
  }

  async recordIpView(
    user: AuthUser | undefined,
    ipId: string,
    input: RecordIpViewInput,
  ) {
    await this.ensurePublicEngagementTarget(user, ipId);
    return this.recordIpViewForActor(
      {
        userId: user?.userId ?? null,
        actorKind: this.actorKindForUser(),
      },
      user,
      ipId,
      input,
    );
  }

  async recordAgentIpView(
    agentUserId: string,
    ipId: string,
    input: RecordIpViewInput,
  ) {
    await this.ensurePublicEngagementTarget(undefined, ipId);
    return this.recordIpViewForActor(
      {
        userId: agentUserId,
        actorKind: IpEngagementActorKind.agent,
      },
      { userId: agentUserId },
      ipId,
      input,
    );
  }

  private async recordIpViewForActor(
    actor: IpEngagementActor,
    viewer: AuthUser | undefined,
    ipId: string,
    input: RecordIpViewInput,
  ) {
    const now = new Date();
    let recorded = false;

    try {
      recorded = await this.prisma.$transaction(async (tx) => {
        if (input.idempotencyKey) {
          await tx.$executeRaw`
            SELECT pg_advisory_xact_lock(hashtext(${`ip:view:${input.idempotencyKey}`})::bigint)
          `;
          const existing = await tx.ipViewEvent.findUnique({
            where: { idempotencyKey: input.idempotencyKey },
            select: { id: true },
          });
          if (existing) return false;
        }

        await tx.ipViewEvent.create({
          data: {
            ipId,
            userId: actor.userId,
            actorKind: actor.actorKind,
            idempotencyKey: input.idempotencyKey ?? null,
            source: input.source,
            metadata: {},
            viewedAt: now,
          },
        });
        await this.incrementViewAggregateTx(tx, ipId, actor.actorKind, now);
        return true;
      });
    } catch (error) {
      if (!isUniqueViolation(error) || !input.idempotencyKey) throw error;
      const existing = await this.prisma.ipViewEvent.findUnique({
        where: { idempotencyKey: input.idempotencyKey },
        select: { id: true },
      });
      if (!existing) throw error;
    }

    return {
      recorded,
      engagement: publicIpEngagementDto(
        await this.engagementStatsForIp(ipId, viewer),
      ),
    };
  }

  async likeIp(user: AuthUser, ipId: string) {
    await this.ensurePublicEngagementTarget(user, ipId);
    return this.likeIpForActor(
      {
        userId: user.userId,
        actorKind: this.actorKindForUser(),
      },
      user,
      ipId,
    );
  }

  async likeAgentIp(agentUserId: string, ipId: string) {
    await this.ensurePublicEngagementTarget(undefined, ipId);
    return this.likeIpForActor(
      {
        userId: agentUserId,
        actorKind: IpEngagementActorKind.agent,
      },
      { userId: agentUserId },
      ipId,
    );
  }

  private async likeIpForActor(
    actor: IpEngagementLikeActor,
    viewer: AuthUser,
    ipId: string,
  ) {
    const now = new Date();
    let changed = false;
    let conversationId: string | null = null;

    await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`
        SELECT pg_advisory_xact_lock(hashtext(${`ip:like:${ipId}:${actor.userId}`})::bigint)
      `;
      await tx.$queryRaw`SELECT id FROM ips WHERE id = ${ipId}::uuid FOR UPDATE`;
      await this.ensurePublicEngagementTarget(
        actor.actorKind === IpEngagementActorKind.human ? viewer : undefined,
        ipId,
        tx,
      );
      if (actor.actorKind === IpEngagementActorKind.human) {
        const [origin] = await tx.$queryRaw<
          { crewId: string }[]
        >`SELECT crew_id AS "crewId" FROM ip_crew_origins WHERE ip_id = ${ipId}::uuid`;
        if (origin)
          conversationId =
            (
              await joinCrewFanTx(
                tx,
                this.conversations,
                origin.crewId,
                actor.userId,
                true,
              )
            )?.id ?? null;
      }
      const existing = await tx.ipLike.findUnique({
        where: { ipId_userId: { ipId, userId: actor.userId } },
      });

      if (!existing) {
        await tx.ipLike.create({
          data: {
            ipId,
            userId: actor.userId,
            actorKind: actor.actorKind,
            status: IpLikeStatus.active,
            likedAt: now,
            removedAt: null,
          },
        });
        await this.incrementLikeAggregateTx(tx, ipId, actor.actorKind, now, 1);
        changed = true;
        return;
      }

      if (existing.status === IpLikeStatus.active && !existing.removedAt) {
        return;
      }

      await tx.ipLike.update({
        where: { id: existing.id },
        data: {
          actorKind: actor.actorKind,
          status: IpLikeStatus.active,
          likedAt: now,
          removedAt: null,
        },
      });
      await this.incrementLikeAggregateTx(tx, ipId, actor.actorKind, now, 1);
      changed = true;
    });

    return {
      liked: true,
      conversationId,
      changed,
      engagement: publicIpEngagementDto(
        await this.engagementStatsForIp(ipId, viewer),
      ),
    };
  }

  async unlikeIp(user: AuthUser, ipId: string) {
    await this.ensurePublicEngagementTarget(user, ipId);
    return this.unlikeIpForActor({ userId: user.userId }, user, ipId);
  }

  async unlikeAgentIp(agentUserId: string, ipId: string) {
    await this.ensurePublicEngagementTarget(undefined, ipId);
    return this.unlikeIpForActor(
      { userId: agentUserId },
      { userId: agentUserId },
      ipId,
    );
  }

  private async unlikeIpForActor(
    actor: { userId: string },
    viewer: AuthUser,
    ipId: string,
  ) {
    const now = new Date();
    let changed = false;

    await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`
        SELECT pg_advisory_xact_lock(hashtext(${`ip:like:${ipId}:${actor.userId}`})::bigint)
      `;
      const existing = await tx.ipLike.findUnique({
        where: { ipId_userId: { ipId, userId: actor.userId } },
      });
      if (
        !existing ||
        existing.status === IpLikeStatus.removed ||
        existing.removedAt
      ) {
        return;
      }

      await tx.ipLike.update({
        where: { id: existing.id },
        data: {
          status: IpLikeStatus.removed,
          removedAt: now,
        },
      });
      await this.incrementLikeAggregateTx(
        tx,
        ipId,
        existing.actorKind,
        now,
        -1,
      );
      changed = true;
    });

    return {
      liked: false,
      changed,
      engagement: publicIpEngagementDto(
        await this.engagementStatsForIp(ipId, viewer),
      ),
    };
  }

  async listPublicIps(query: ListIpsQuery, user?: AuthUser) {
    const ranked = await this.rankedPublicIpIds(query, user);
    const rows = ranked.pageIds.length
      ? await this.prisma.ip.findMany({
          where: { id: { in: ranked.pageIds } },
          include: ipInclude,
        })
      : [];
    const rowsById = new Map(rows.map((row) => [row.id, row]));
    const items = ranked.pageIds
      .map((id) => rowsById.get(id))
      .filter((row): row is IpWithCommerce => Boolean(row));
    const stats = await this.engagementStatsForIps(
      items.map((ip) => ip.id),
      user,
    );
    return {
      items: items.map((ip) =>
        ipDto(ip, query.locale, undefined, stats.get(ip.id)),
      ),
      nextCursor: ranked.nextCursor,
    };
  }

  /** GPS shares the catalogue's publication, taxonomy and viewer-block authority.
   * Both predicates use alias `ip`; caller supplies the same read transaction. */
  async contentGpsCatalogueFilters(
    genreCodes: string[],
    locale: ListIpsQuery['locale'],
    user: AuthUser | undefined,
    db: Prisma.TransactionClient,
  ) {
    const blocks = await this.viewerBlockLists(user, db);
    const query: ListIpsQuery = {
      genreCodes: [],
      tagCodes: [],
      regions: [],
      locale,
      limit: 20,
      channelType: 'ip',
    };
    return {
      accessible: publicIpRankBaseFilterSql(query, blocks),
      matching: publicIpRankBaseFilterSql({ ...query, genreCodes }, blocks),
    };
  }

  /** Bounded display hydration for IDs already authorized by the GPS SQL query.
   * Use the same transaction and media moderation gate as the public catalogue. */
  async contentGpsPresentations(
    ids: string[],
    locale: string,
    db: Prisma.TransactionClient,
  ) {
    if (!ids.length)
      return new Map<
        string,
        { roomNumber: string; summary: string; coverUrl: string | null }
      >();
    const cover = {
      storageProvider: true,
      bucket: true,
      region: true,
      objectKey: true,
      externalUrl: true,
      status: true,
      moderationStatus: true,
      deletedAt: true,
    } as const;
    const rows = await db.ip.findMany({
      where: { id: { in: ids } },
      select: {
        id: true,
        roomNumber: true,
        coverAsset: { select: cover },
        localizations: {
          where: { locale, status: 'published', archivedAt: null },
          select: { summary: true, coverAsset: { select: cover } },
          take: 1,
        },
      },
    });
    return new Map(
      rows.map((row) => {
        const copy = row.localizations[0];
        const asset = copy?.coverAsset ?? row.coverAsset;
        return [
          row.id,
          {
            roomNumber: row.roomNumber,
            summary: copy?.summary ?? '',
            coverUrl: asset ? resolveMediaPlaybackUrl(asset).url : null,
          },
        ];
      }),
    );
  }

  private async rankedPublicIpIds(query: ListIpsQuery, user?: AuthUser) {
    const viewerBlocks = await this.viewerBlockLists(user);
    const rows = await this.prisma.$queryRaw<PublicIpRankRow[]>(
      publicIpRankQuery(
        publicIpRankBaseFilterSql(query, viewerBlocks),
        query.limit,
        query.cursor,
      ),
    );
    const page = rows.slice(0, query.limit);
    const last = page.at(-1);
    return {
      pageIds: page.map((row) => row.id),
      // Preserve the boundary as it was shown. Re-reading the last IP would
      // move it when its engagement changes, or restart pagination if deleted.
      nextCursor:
        rows.length > query.limit && last
          ? encodePublicIpRankCursor(last)
          : null,
    };
  }

  /**
   * N DISTINCT random picks from the public plaza pool, projected lean
   * ({id, title, summary, coverUrl}) — inspiration seeds for the
   * story-studio empty canvas. Same public gate as listPublicIps.
   */
  async randomPublicIpSeeds(query: RandomIpSeedsQuery) {
    const idRows = await this.prisma.ip.findMany({
      where: {
        deletedAt: null,
        status: { in: PUBLIC_IP_STATUSES },
        listingVisibility: 'public',
        localizations: {
          some: {
            archivedAt: null,
            status: { in: PUBLIC_LOCALIZATION_STATUSES },
          },
        },
      },
      select: { id: true },
    });

    const pool = idRows.map((row) => row.id);
    // Fix the target BEFORE sampling — the pool shrinks as picks splice out.
    const target = Math.min(query.limit, pool.length);
    const picked: string[] = [];
    while (picked.length < target) {
      const [pickedId] = pool.splice(
        Math.floor(Math.random() * pool.length),
        1,
      );
      if (pickedId) picked.push(pickedId);
    }
    if (picked.length === 0) return { items: [] };

    const rows = await this.prisma.ip.findMany({
      where: { id: { in: picked } },
      include: {
        coverAsset: true,
        localizations: {
          where: {
            archivedAt: null,
            status: { in: PUBLIC_LOCALIZATION_STATUSES },
          },
          include: { coverAsset: true },
        },
      },
    });
    const byId = new Map(rows.map((row) => [row.id, row]));
    const stats = await this.engagementStatsForIps(picked);

    return {
      items: picked
        .map((id) => byId.get(id))
        .filter((ip): ip is NonNullable<typeof ip> => Boolean(ip))
        .map((ip) => {
          const copy =
            ip.localizations.find((loc) => loc.locale === query.locale) ??
            ip.localizations.find((loc) => loc.locale === ip.sourceLocale) ??
            ip.localizations[0] ??
            null;
          const cover = assetDto(copy?.coverAsset ?? ip.coverAsset);
          return {
            id: ip.id,
            title: copy?.title ?? ip.id,
            summary: copy?.summary ?? '',
            coverUrl: cover?.url ?? null,
            viewCount: stats.get(ip.id)?.viewCount ?? 0,
            likeCount: stats.get(ip.id)?.likeCount ?? 0,
          };
        }),
    };
  }

  /**
   * Public list of ONE creator's published, publicly-listed IPs — the visitor
   * view of a creator profile. Same public gating as listPublicIps (published +
   * public + a public localization + viewer blocks), scoped to createdById, so a
   * creator's drafts/private IPs never leak. Owners get the full set (incl.
   * drafts) via the owner-scoped me/ips instead.
   */
  async listPublicCreatorIps(
    creatorId: string,
    query: ListCreatorIpsQuery,
    user?: AuthUser,
  ) {
    const viewerBlockWhere = await this.viewerBlockWhere(user);
    const cursor = query.cursor
      ? await this.prisma.ip.findUnique({
          where: { id: query.cursor },
          select: { publishedAt: true, createdAt: true },
        })
      : null;
    const cursorDate = cursor?.publishedAt ?? cursor?.createdAt ?? null;

    const rows = await this.prisma.ip.findMany({
      where: {
        createdById: creatorId,
        deletedAt: null,
        status: { in: PUBLIC_IP_STATUSES },
        listingVisibility: 'public',
        localizations: {
          some: {
            archivedAt: null,
            status: { in: PUBLIC_LOCALIZATION_STATUSES },
          },
        },
        ...viewerBlockWhere,
        ...(cursorDate
          ? {
              OR: [
                { publishedAt: { lt: cursorDate } },
                { publishedAt: null, createdAt: { lt: cursorDate } },
              ],
            }
          : {}),
      },
      include: ipInclude,
      orderBy: [
        { publishedAt: { sort: 'desc', nulls: 'last' } },
        { createdAt: 'desc' },
      ],
      take: query.limit + 1,
    });

    const items = rows.slice(0, query.limit);
    const stats = await this.engagementStatsForIps(
      items.map((ip) => ip.id),
      user,
    );
    return {
      items: items.map((ip) =>
        ipDto(ip, query.locale, undefined, stats.get(ip.id)),
      ),
      nextCursor: rows.length > query.limit ? (items.at(-1)?.id ?? null) : null,
    };
  }

  /**
   * Public list of IPs carrying a TAG, for a generic tag landing page
   * (e.g. the SGWander competition: /tags/sgwander_ai_challenge). Unlike the
   * plaza, this matches the tag REGARDLESS of its active/hidden status and does
   * NOT apply the hidden-genre browse exclusion — the tag IS the scope, so a
   * hidden tag's entries appear on their own page. Still enforces base public
   * visibility (published/scheduled + public listing + a public localization +
   * viewer blocks), so non-public entries never leak. Returns the localized term
   * for the page header.
   */
  async listPublicTagIps(
    code: string,
    query: ListCreatorIpsQuery,
    user?: AuthUser,
  ) {
    const term = await this.prisma.ipTaxonomyTerm.findFirst({
      where: { type: IpTaxonomyTermType.tag, code },
      include: { localizations: true },
    });
    if (!term) {
      throw new NotFoundException({
        code: 'IP_TAXONOMY_TERM_NOT_FOUND',
        msg: 'Tag not found.',
      });
    }

    const viewerBlockWhere = await this.viewerBlockWhere(user);
    const whereBase: Prisma.IpWhereInput = {
      deletedAt: null,
      status: { in: PUBLIC_IP_STATUSES },
      listingVisibility: 'public',
      localizations: {
        some: {
          archivedAt: null,
          status: { in: PUBLIC_LOCALIZATION_STATUSES },
        },
      },
      taxonomyAssignments: {
        some: { term: { is: { type: IpTaxonomyTermType.tag, code } } },
      },
      ...viewerBlockWhere,
    };

    const cursor = query.cursor
      ? await this.prisma.ip.findUnique({
          where: { id: query.cursor },
          select: { publishedAt: true, createdAt: true },
        })
      : null;
    const cursorDate = cursor?.publishedAt ?? cursor?.createdAt ?? null;

    // Total of the whole set (for the header stat) — only on the first page to
    // avoid re-counting on every infinite-scroll fetch.
    const total = query.cursor
      ? null
      : await this.prisma.ip.count({ where: whereBase });

    const rows = await this.prisma.ip.findMany({
      where: {
        ...whereBase,
        ...(cursorDate
          ? {
              OR: [
                { publishedAt: { lt: cursorDate } },
                { publishedAt: null, createdAt: { lt: cursorDate } },
              ],
            }
          : {}),
      },
      include: ipInclude,
      orderBy: [
        { publishedAt: { sort: 'desc', nulls: 'last' } },
        { createdAt: 'desc' },
      ],
      take: query.limit + 1,
    });

    const items = rows.slice(0, query.limit);
    const stats = await this.engagementStatsForIps(
      items.map((ip) => ip.id),
      user,
    );
    return {
      term: taxonomyTermDto(term, query.locale),
      total,
      items: items.map((ip) =>
        ipDto(ip, query.locale, undefined, stats.get(ip.id)),
      ),
      nextCursor: rows.length > query.limit ? (items.at(-1)?.id ?? null) : null,
    };
  }

  async getPublicIp(
    ipReference: string,
    user?: AuthUser,
    query: { locale?: string } = {},
  ) {
    const viewerBlockWhere = await this.viewerBlockWhere(user);
    const ip = await this.prisma.ip.findFirst({
      where: {
        ...ipIdentityWhere(ipReference),
        deletedAt: null,
        status: { in: PUBLIC_IP_STATUSES },
        listingVisibility: { in: ['public', 'unlisted'] },
        localizations: {
          some: {
            archivedAt: null,
            status: { in: PUBLIC_LOCALIZATION_STATUSES },
          },
        },
        ...viewerBlockWhere,
      },
      include: ipInclude,
    });
    if (!ip) {
      throw new NotFoundException({
        code: 'IP_NOT_FOUND',
        msg: 'IP not found.',
      });
    }
    // Resolve the viewer's entitlements so ipDto can expose playable media only
    // for episodes they own (plus free + free-preview), not for paid-locked ones.
    const now = new Date();
    const entitlements = user
      ? await this.prisma.ipContentEntitlement.findMany({
          where: {
            userId: user.userId,
            ipId: ip.id,
            status: IpEntitlementStatus.active,
            ...currentOrPendingEntitlementWhere(now),
          },
        })
      : [];
    const activeEntitlements = entitlements.filter((entitlement) =>
      isEntitlementActiveForAccess(entitlement, now),
    );
    // IP managers always see their managed media — they can't (and the purchase
    // path won't let them) buy that content, so entitlement alone would wrongly
    // lock them out of a paid IP they manage.
    const isCreator = !!user && ip.createdById === user.userId;
    const hasEditGrant = await this.hasActiveIpEditGrant(user, ip.id);
    const hasManagementAccess = isCreator || hasEditGrant;
    const freeWatchPass = hasFreeIpWatchPass(user?.levelIds);
    const mediaAccess = {
      ipOwned:
        hasManagementAccess ||
        freeWatchPass ||
        activeEntitlements.some(
          (entitlement) =>
            entitlement.targetType === IpTargetType.ip &&
            entitlement.episodeId === null,
        ),
      ownedEpisodeIds: new Set(
        activeEntitlements
          .filter(
            (entitlement) => entitlement.targetType === IpTargetType.episode,
          )
          .map((entitlement) => entitlement.episodeId)
          .filter(Boolean) as string[],
      ),
    };
    const stats = await this.engagementStatsForIp(ip.id, user);
    const dto = ipDto(ip, query.locale, mediaAccess, stats);
    // Legacy CN IPs store video external_urls on the image CDN (banner.fizzspace.cn,
    // 404 for videos); mint the real signed video URL via Java getLink at read time.
    await this.legacyCnVideo.resolveDtoVideos(dto);
    return { ip: dto };
  }

  async getIpAccess(
    user: AuthUser | undefined,
    ipId: string,
    query: IpAccessQuery,
  ) {
    const now = new Date();
    const viewerBlockWhere = await this.viewerBlockWhere(user);
    const ip = await this.prisma.ip.findFirst({
      where: {
        id: ipId,
        deletedAt: null,
        status: { in: PUBLIC_IP_STATUSES },
        listingVisibility: { in: ['public', 'unlisted'] },
        ...viewerBlockWhere,
      },
      include: ipInclude,
    });
    if (!ip) {
      throw new NotFoundException({
        code: 'IP_NOT_FOUND',
        msg: 'IP not found.',
      });
    }

    const requestedEpisodeIds = new Set(query.episodeIds);
    const episodes =
      requestedEpisodeIds.size > 0
        ? ip.episodes.filter((episode) => requestedEpisodeIds.has(episode.id))
        : ip.episodes;

    const isMember = user
      ? (
          await this.entitlements.isActiveCommunityMember(user, {
            now: now.toISOString(),
          })
        ).member
      : false;
    // Resolve the platform default once; per-rule bps still overrides in the dto.
    const memberCtx = isMember
      ? { defaultBps: await this.getMemberDiscountDefaultBps() }
      : undefined;

    const ipPrice = selectActivePrice(
      ip.priceRules.filter((rule) => rule.targetType === IpTargetType.ip),
      now,
    );
    const entitlements = user
      ? await this.prisma.ipContentEntitlement.findMany({
          where: {
            userId: user.userId,
            ipId,
            status: IpEntitlementStatus.active,
            ...currentOrPendingEntitlementWhere(now),
          },
        })
      : [];
    const activeEntitlements = entitlements.filter((entitlement) =>
      isEntitlementActiveForAccess(entitlement, now),
    );
    const ipEntitlement = activeEntitlements.find(
      (entitlement) =>
        entitlement.targetType === IpTargetType.ip &&
        entitlement.episodeId === null,
    );
    const isCreator = !!user && ip.createdById === user.userId;
    const hasEditGrant = await this.hasActiveIpEditGrant(user, ip.id);
    const hasManagementAccess = isCreator || hasEditGrant;
    const freeWatchPass = hasFreeIpWatchPass(user?.levelIds);
    const pendingIpEntitlement = entitlements.find(
      (entitlement) =>
        entitlement.targetType === IpTargetType.ip &&
        entitlement.episodeId === null &&
        !isEntitlementActiveForAccess(entitlement, now),
    );
    const ownedEpisodeIds = new Set(
      activeEntitlements
        .filter(
          (entitlement) => entitlement.targetType === IpTargetType.episode,
        )
        .map((entitlement) => entitlement.episodeId)
        .filter(Boolean) as string[],
    );
    const pendingEpisodeIds = new Set(
      entitlements
        .filter(
          (entitlement) =>
            entitlement.targetType === IpTargetType.episode &&
            !isEntitlementActiveForAccess(entitlement, now),
        )
        .map((entitlement) => entitlement.episodeId)
        .filter(Boolean) as string[],
    );
    const communityPointAccount = user
      ? await this.prisma.walletAccount.findUnique({
          where: {
            ownerType_ownerId_currency_balanceKind: {
              ownerType: WalletOwnerType.user,
              ownerId: user.userId,
              currency: WalletCurrencyType.community_point,
              balanceKind: WalletBalanceKind.consumable,
            },
          },
        })
      : null;
    // Sweep lapsed gift grants so the displayed balance doesn't show expired
    // points as spendable (best-effort; the spend path re-sweeps anyway).
    if (communityPointAccount) {
      await this.walletLedger
        .expireLapsedGrants(communityPointAccount.id)
        .catch(() => undefined);
      Object.assign(
        communityPointAccount,
        await this.prisma.walletAccount.findUniqueOrThrow({
          where: { id: communityPointAccount.id },
          select: { availableBalance: true },
        }),
      );
    }

    const ipAccessState = resolveIpAccessState({
      hasManagementAccess,
      hasFreeWatchPass: freeWatchPass,
      hasIpEntitlement: Boolean(ipEntitlement),
      hasPendingIpEntitlement: Boolean(pendingIpEntitlement),
      accessMode: ip.accessMode,
      isMember,
      hasIpPrice: Boolean(ipPrice),
    });

    return {
      authenticated: Boolean(user),
      member: isMember,
      wallet: communityPointAccount
        ? {
            currency: communityPointAccount.currency,
            balanceKind: communityPointAccount.balanceKind,
            status: communityPointAccount.status,
            availableBalance: communityPointAccount.availableBalance.toString(),
            heldBalance: communityPointAccount.heldBalance.toString(),
          }
        : null,
      ip: {
        id: ip.id,
        owned: ipAccessState.owned,
        access: ipAccessState.access,
        price: ipPrice ? priceRuleDto(ipPrice, memberCtx) : null,
      },
      episodes: episodes.map((episode) => {
        const episodePrice = selectActivePrice(episode.priceRules, now);
        const episodeAccessState = resolveEpisodeAccessState({
          hasManagementAccess,
          hasFreeWatchPass: freeWatchPass,
          hasIpEntitlement: Boolean(ipEntitlement),
          hasEpisodeEntitlement: ownedEpisodeIds.has(episode.id),
          hasPendingIpEntitlement: Boolean(pendingIpEntitlement),
          hasPendingEpisodeEntitlement: pendingEpisodeIds.has(episode.id),
          isFreePreview: episode.isFreePreview,
          accessMode: ip.accessMode,
          isMember,
          hasEpisodePrice: Boolean(episodePrice),
          hasIpPrice: Boolean(ipPrice),
        });
        return {
          id: episode.id,
          episodeNo: episode.episodeNo,
          owned: episodeAccessState.owned,
          access: episodeAccessState.access,
          price: episodePrice ? priceRuleDto(episodePrice, memberCtx) : null,
        };
      }),
      entitlements: entitlements.map(entitlementDto),
    };
  }

  async getUserWallet(user: AuthUser) {
    const accounts = await this.walletLedger.ensureDefaultAccounts(
      WalletOwnerType.user,
      user.userId,
    );
    // Honest balance: sweep lapsed community credit grants (expiring promo
    // grants) before reporting, so an expired grant never shows as spendable.
    // Best-effort — a sweep hiccup must not break the wallet read.
    const community = accounts.find(
      (account) =>
        account.currency === WalletCurrencyType.community_point &&
        account.balanceKind === WalletBalanceKind.consumable,
    );
    if (community) {
      const { expired } = await this.walletLedger
        .expireLapsedGrants(community.id)
        .catch(() => ({ expired: 0n }));
      if (expired > 0n) {
        const fresh = await this.prisma.walletAccount.findUnique({
          where: { id: community.id },
          select: {
            availableBalance: true,
            heldBalance: true,
            updatedAt: true,
          },
        });
        if (fresh) Object.assign(community, fresh);
      }
    }
    return {
      accounts: accounts.map((account) => ({
        id: account.id,
        ownerType: account.ownerType,
        ownerId: account.ownerId,
        currency: account.currency,
        balanceKind: account.balanceKind,
        status: account.status,
        availableBalance: account.availableBalance.toString(),
        heldBalance: account.heldBalance.toString(),
        updatedAt: account.updatedAt.toISOString(),
      })),
    };
  }

  async listUserCollection(user: AuthUser, query: { locale?: string } = {}) {
    const items = await this.prisma.ipCollectionItem.findMany({
      where: {
        userId: user.userId,
        status: IpCollectionItemStatus.active,
        removedAt: null,
      },
      include: {
        ip: {
          include: {
            localizations: {
              where: { archivedAt: null },
              orderBy: [{ locale: 'asc' }, { updatedAt: 'desc' }],
            },
            coverAsset: true,
            trailerAsset: true,
          },
        },
        episode: {
          include: {
            localizations: {
              where: { archivedAt: null },
              orderBy: [{ locale: 'asc' }, { updatedAt: 'desc' }],
            },
            coverAsset: true,
            trailerAsset: true,
            mediaAsset: true,
          },
        },
        entitlement: true,
      },
      orderBy: { addedAt: 'desc' },
    });

    return {
      items: items.map((item) => {
        const ipCopy = selectIpLocalization(item.ip, query.locale, false);
        const episodeCopy = item.episode
          ? selectEpisodeLocalization(item.episode, query.locale, false)
          : null;
        return {
          id: item.id,
          targetType: item.targetType,
          status: item.status,
          addedAt: item.addedAt.toISOString(),
          lastViewedAt: item.lastViewedAt?.toISOString() ?? null,
          ip: {
            id: item.ip.id,
            title: ipCopy.value?.title ?? item.ip.id,
            subtitle: ipCopy.value?.subtitle ?? null,
            localization: ipCopy.meta,
            coverAsset: assetDto(item.ip.coverAsset),
          },
          episode:
            item.episode && episodeCopy
              ? {
                  id: item.episode.id,
                  episodeNo: item.episode.episodeNo,
                  title:
                    episodeCopy.value?.title ??
                    `Episode ${item.episode.episodeNo}`,
                  localization: episodeCopy.meta,
                  coverAsset: assetDto(item.episode.coverAsset),
                  mediaAsset: assetDto(item.episode.mediaAsset),
                }
              : null,
          entitlement: item.entitlement
            ? {
                id: item.entitlement.id,
                status: item.entitlement.status,
                startsAt: item.entitlement.startsAt.toISOString(),
                endsAt: item.entitlement.endsAt?.toISOString() ?? null,
              }
            : null,
        };
      }),
    };
  }

  async saveCollectionItem(user: AuthUser, input: UpsertIpCollectionItemInput) {
    const target = await this.resolveCollectionTarget(user, input);
    const now = new Date();
    const item = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`
        SELECT pg_advisory_xact_lock(hashtext(${`ip:collection:${user.userId}:${target.targetType}:${target.ipId}:${target.episodeId ?? 'ip'}`})::bigint)
      `;

      const active = await tx.ipCollectionItem.findFirst({
        where: {
          userId: user.userId,
          ipId: target.ipId,
          episodeId: target.episodeId,
          targetType: target.targetType,
          removedAt: null,
        },
      });
      if (active) {
        return tx.ipCollectionItem.update({
          where: { id: active.id },
          data: {
            status: IpCollectionItemStatus.active,
            addedAt: active.addedAt,
            lastViewedAt: active.lastViewedAt,
            removedAt: null,
          },
        });
      }

      const removed = await tx.ipCollectionItem.findFirst({
        where: {
          userId: user.userId,
          ipId: target.ipId,
          episodeId: target.episodeId,
          targetType: target.targetType,
          removedAt: { not: null },
        },
        orderBy: { removedAt: 'desc' },
      });
      if (removed) {
        return tx.ipCollectionItem.update({
          where: { id: removed.id },
          data: {
            status: IpCollectionItemStatus.active,
            addedAt: now,
            removedAt: null,
            lastViewedAt: null,
          },
        });
      }

      return tx.ipCollectionItem.create({
        data: {
          userId: user.userId,
          ipId: target.ipId,
          episodeId: target.episodeId,
          targetType: target.targetType,
          status: IpCollectionItemStatus.active,
        },
      });
    });

    return { item: collectionItemMutationDto(item) };
  }

  async removeCollectionItem(
    user: AuthUser,
    input: UpsertIpCollectionItemInput,
  ) {
    // Removing a user's own bookmark must remain possible after publication
    // is withdrawn or the viewer blocks its creator. No content access is granted.
    const target = {
      targetType: input.targetType as IpTargetType,
      ipId: input.ipId,
      episodeId: input.targetType === 'episode' ? input.episodeId : null,
    };
    const now = new Date();
    const item = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`
        SELECT pg_advisory_xact_lock(hashtext(${`ip:collection:${user.userId}:${target.targetType}:${target.ipId}:${target.episodeId ?? 'ip'}`})::bigint)
      `;
      const active = await tx.ipCollectionItem.findFirst({
        where: {
          userId: user.userId,
          ipId: target.ipId,
          episodeId: target.episodeId,
          targetType: target.targetType,
          removedAt: null,
        },
      });
      if (!active) return null;
      return tx.ipCollectionItem.update({
        where: { id: active.id },
        data: {
          status: IpCollectionItemStatus.removed,
          removedAt: now,
        },
      });
    });

    return { item: item ? collectionItemMutationDto(item) : null };
  }

  async saveAgentCollectionItem(agentUserId: string, ipId: string) {
    const target = await this.resolveAgentIpCollectionTarget(ipId);
    const now = new Date();
    const item = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`
        SELECT pg_advisory_xact_lock(hashtext(${`ip:collection:${agentUserId}:ip:${target.ipId}:ip`})::bigint)
      `;

      const active = await tx.ipCollectionItem.findFirst({
        where: {
          userId: agentUserId,
          ipId: target.ipId,
          episodeId: null,
          targetType: IpTargetType.ip,
          removedAt: null,
        },
      });
      if (active) {
        return tx.ipCollectionItem.update({
          where: { id: active.id },
          data: {
            status: IpCollectionItemStatus.active,
            addedAt: active.addedAt,
            removedAt: null,
          },
        });
      }

      const removed = await tx.ipCollectionItem.findFirst({
        where: {
          userId: agentUserId,
          ipId: target.ipId,
          episodeId: null,
          targetType: IpTargetType.ip,
          removedAt: { not: null },
        },
        orderBy: { removedAt: 'desc' },
      });
      if (removed) {
        return tx.ipCollectionItem.update({
          where: { id: removed.id },
          data: {
            status: IpCollectionItemStatus.active,
            addedAt: now,
            removedAt: null,
            lastViewedAt: null,
          },
        });
      }

      return tx.ipCollectionItem.create({
        data: {
          userId: agentUserId,
          ipId: target.ipId,
          episodeId: null,
          targetType: IpTargetType.ip,
          status: IpCollectionItemStatus.active,
          metadata: { actorKind: 'agent' },
        },
      });
    });

    return { item: collectionItemMutationDto(item) };
  }

  async removeAgentCollectionItem(agentUserId: string, ipId: string) {
    const target = await this.resolveAgentIpCollectionTarget(ipId);
    const now = new Date();
    const item = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`
        SELECT pg_advisory_xact_lock(hashtext(${`ip:collection:${agentUserId}:ip:${target.ipId}:ip`})::bigint)
      `;
      const active = await tx.ipCollectionItem.findFirst({
        where: {
          userId: agentUserId,
          ipId: target.ipId,
          episodeId: null,
          targetType: IpTargetType.ip,
          removedAt: null,
        },
      });
      if (!active) return null;
      return tx.ipCollectionItem.update({
        where: { id: active.id },
        data: {
          status: IpCollectionItemStatus.removed,
          removedAt: now,
        },
      });
    });

    return { item: item ? collectionItemMutationDto(item) : null };
  }

  async purchaseContent(user: AuthUser, input: CreateIpPurchaseInput) {
    const now = new Date();
    // Certified free-watch holders (Java user_level id=12) never spend points.
    // Return an owned-style no-op so a stale client purchase CTA cannot debit.
    if (hasFreeIpWatchPass(user.levelIds)) {
      return {
        alreadyProcessed: false,
        alreadyOwned: true,
        order: null,
        entitlements: [],
      };
    }
    const defaultRevenueShareBps =
      await this.getCreatorRevenueShareDefaultBps();
    // Membership status resolved once, before the tx — drives the member discount
    // and the member-free unlock (expiresAt bounds the free grant).
    const membership = await this.entitlements.isActiveCommunityMember(user, {
      now: now.toISOString(),
    });
    const isMember = membership.member;

    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`
        SELECT pg_advisory_xact_lock(hashtext(${`ip:purchase:${user.userId}:${input.idempotencyKey}`})::bigint)
      `;

      const existingOrder = await tx.ipPurchaseOrder.findUnique({
        where: {
          userId_idempotencyKey: {
            userId: user.userId,
            idempotencyKey: input.idempotencyKey,
          },
        },
        include: {
          entitlements: true,
        },
      });
      if (existingOrder) {
        return {
          alreadyProcessed: true,
          alreadyOwned: false,
          order: purchaseOrderDto(existingOrder),
          entitlements: existingOrder.entitlements.map(entitlementDto),
        };
      }

      // Keep availability valid until the order/entitlement commits. Creator
      // deletion and publication changes take an exclusive lock on this row.
      await tx.$queryRaw`SELECT id FROM ips WHERE id=${input.ipId}::uuid FOR SHARE`;

      const ip = await tx.ip.findFirst({
        where: {
          id: input.ipId,
          deletedAt: null,
          status: { in: PUBLIC_IP_STATUSES },
          listingVisibility: { in: ['public', 'unlisted'] },
          localizations: {
            some: {
              archivedAt: null,
              status: { in: PUBLIC_LOCALIZATION_STATUSES },
            },
          },
        },
        include: {
          localizations: {
            where: { archivedAt: null },
            orderBy: [{ locale: 'asc' }, { updatedAt: 'desc' }],
          },
        },
      });
      if (!ip) {
        throw new NotFoundException({
          code: 'IP_NOT_PURCHASABLE',
          msg: 'IP is not available for purchase.',
        });
      }
      const buyerHasEditAccess = await this.hasActiveIpEditGrant(
        user,
        ip.id,
        tx,
      );
      assertIpPurchaserAllowed({
        buyerUserId: user.userId,
        creatorUserId: ip.createdById,
        hasEditAccess: buyerHasEditAccess,
      });

      const episode =
        input.targetType === 'episode'
          ? await tx.ipEpisode.findFirst({
              where: {
                id: input.episodeId,
                ipId: input.ipId,
                deletedAt: null,
                status: { in: PUBLIC_EPISODE_STATUSES },
              },
              include: {
                localizations: {
                  where: { archivedAt: null },
                  orderBy: [{ locale: 'asc' }, { updatedAt: 'desc' }],
                },
              },
            })
          : null;
      if (input.targetType === 'episode' && !episode) {
        throw new NotFoundException({
          code: 'IP_EPISODE_NOT_PURCHASABLE',
          msg: 'IP episode is not available for purchase.',
        });
      }

      const existingEntitlement = await findCurrentOrPendingEntitlementTx(tx, {
        userId: user.userId,
        ipId: input.ipId,
        targetType: input.targetType,
        episodeId: input.episodeId ?? null,
      });
      if (existingEntitlement) {
        await ensureCollectionItemTx(tx, user.userId, existingEntitlement);
        return {
          alreadyProcessed: false,
          alreadyOwned: true,
          order: null,
          entitlements: [entitlementDto(existingEntitlement)],
        };
      }

      // Member-free viewing: an active community member unlocks the whole IP for
      // free (the creator is compensated from the monthly member pool at settlement,
      // not at point of sale). Reuses the entitlement + media-gating path; access
      // ends with the membership period, and an idempotent re-unlock (deterministic
      // sourceId) extends it on renewal. v1 is IP-level only (member_free = the
      // whole IP is free to members); paid episodes inside a member-free IP are not
      // supported yet.
      if (
        ip.accessMode === IpAccessMode.member_free &&
        input.targetType === IpTargetType.ip
      ) {
        if (!isMember) {
          throw new ForbiddenException({
            code: 'IP_MEMBER_ONLY',
            msg: 'This work is free for community members. Join to watch.',
          });
        }
        const memberFreeSourceId = `member_free:${user.userId}:ip:${ip.id}`;
        const memberFreeEntitlement = await tx.ipContentEntitlement.upsert({
          where: {
            sourceType_sourceId: {
              sourceType: 'member_free_grant',
              sourceId: memberFreeSourceId,
            },
          },
          create: {
            userId: user.userId,
            ipId: ip.id,
            episodeId: null,
            targetType: IpTargetType.ip,
            status: IpEntitlementStatus.active,
            sourceType: 'member_free_grant',
            sourceId: memberFreeSourceId,
            sourceOrderId: null,
            startsAt: now,
            endsAt: membership.expiresAt,
            metadata: { memberFree: true },
          },
          update: {
            status: IpEntitlementStatus.active,
            startsAt: now,
            endsAt: membership.expiresAt,
          },
        });
        await ensureCollectionItemTx(tx, user.userId, memberFreeEntitlement);
        return {
          alreadyProcessed: false,
          alreadyOwned: false,
          order: null,
          entitlements: [entitlementDto(memberFreeEntitlement)],
        };
      }

      const { priceRule, chargeAmount, memberDiscountBps } =
        await this.resolvePriceRuleTx(tx, {
          ipId: input.ipId,
          episodeId: input.episodeId ?? null,
          targetType: input.targetType,
          priceRuleId: input.priceRuleId,
          isMember,
          now,
        });
      await this.assertMaxPerUserTx(tx, priceRule, user.userId);

      const referralLink = input.referralCode
        ? await this.resolveReferralLinkTx(tx, {
            code: input.referralCode,
            ipId: input.ipId,
            episodeId: input.episodeId ?? null,
            now,
          })
        : null;

      const ipCopy = selectIpLocalization(ip, ip.sourceLocale, true);
      const episodeCopy = episode
        ? selectEpisodeLocalization(
            episode,
            ip.sourceLocale,
            true,
            ip.sourceLocale,
          )
        : null;

      const order = await tx.ipPurchaseOrder.create({
        data: {
          orderNo: createIpOrderNo(),
          userId: user.userId,
          ipId: ip.id,
          episodeId: episode?.id ?? null,
          targetType: input.targetType,
          status: IpPurchaseOrderStatus.pending,
          priceRuleId: priceRule.id,
          campaignId: priceRule.campaignId,
          referralLinkId:
            referralLink && referralLink.userId !== user.userId
              ? referralLink.id
              : null,
          currency: priceRule.currency,
          priceAmount: priceRule.amount,
          discountAmount:
            (priceRule.originalAmount &&
            priceRule.originalAmount > priceRule.amount
              ? priceRule.originalAmount - priceRule.amount
              : 0n) +
            (priceRule.amount - chargeAmount),
          totalAmount: chargeAmount,
          priceSnapshot: priceSnapshot(priceRule) as Prisma.InputJsonValue,
          idempotencyKey: input.idempotencyKey,
          metadata: {
            ip: {
              id: ip.id,
              title: ipCopy.value?.title ?? ip.id,
              locale: ipCopy.meta.locale,
            },
            episode: episode
              ? {
                  id: episode.id,
                  episodeNo: episode.episodeNo,
                  title:
                    episodeCopy?.value?.title ?? `Episode ${episode.episodeNo}`,
                  locale: episodeCopy?.meta.locale ?? ip.sourceLocale,
                }
              : null,
            memberDiscount:
              memberDiscountBps > 0
                ? {
                    bps: memberDiscountBps,
                    listAmount: priceRule.amount.toString(),
                    chargeAmount: chargeAmount.toString(),
                  }
                : null,
          },
        },
      });

      const walletTransaction =
        chargeAmount > 0n
          ? await debitCommunityPointTx(tx, {
              userId: user.userId,
              amount: chargeAmount,
              orderId: order.id,
              orderNo: order.orderNo,
            })
          : null;

      const entitlementWindow = resolveIpEntitlementWindow(priceRule, now);
      const entitlement = await tx.ipContentEntitlement.upsert({
        where: {
          sourceType_sourceId: {
            sourceType: 'ip_purchase_order',
            sourceId: order.id,
          },
        },
        create: {
          userId: user.userId,
          ipId: ip.id,
          episodeId: episode?.id ?? null,
          targetType: input.targetType,
          status: IpEntitlementStatus.active,
          sourceType: 'ip_purchase_order',
          sourceId: order.id,
          sourceOrderId: order.id,
          startsAt: entitlementWindow.startsAt,
          endsAt: entitlementWindow.endsAt,
          metadata: {
            orderNo: order.orderNo,
            priceRuleId: priceRule.id,
            unlocksAt: priceRule.unlocksAt?.toISOString() ?? null,
          },
        },
        update: {
          status: IpEntitlementStatus.active,
          startsAt: entitlementWindow.startsAt,
          endsAt: entitlementWindow.endsAt,
        },
      });

      await ensureCollectionItemTx(tx, user.userId, entitlement);
      if (referralLink && referralLink.userId !== user.userId) {
        await this.postReferralAttributionTx(tx, {
          referralLink,
          buyerUserId: user.userId,
          orderId: order.id,
          ipId: ip.id,
          episodeId: episode?.id ?? null,
          now,
        });
      }

      // Credit the creator pool to contributors' withdrawable wallets, atomic
      // with the buyer debit above. Free unlocks (amount 0) earn nothing.
      if (chargeAmount > 0n && ip.createdById) {
        await creditCreatorRevenueTx(tx, {
          order: {
            id: order.id,
            orderNo: order.orderNo,
            ipId: ip.id,
            episodeId: episode?.id ?? null,
            totalAmount: order.totalAmount,
          },
          ownerUserId: ip.createdById,
          shareBps: ip.creatorRevenueShareBps ?? defaultRevenueShareBps,
          now,
        });
      }

      const fulfilled = await tx.ipPurchaseOrder.update({
        where: { id: order.id },
        data: {
          status: IpPurchaseOrderStatus.fulfilled,
          walletTransactionId: walletTransaction?.id ?? null,
          paidAt: now,
          fulfilledAt: now,
          version: { increment: 1 },
        },
        include: {
          entitlements: true,
        },
      });

      return {
        alreadyProcessed: false,
        alreadyOwned: false,
        order: purchaseOrderDto(fulfilled),
        entitlements: fulfilled.entitlements.map(entitlementDto),
      };
    });
  }

  /**
   * Record a community member's view of a member-free episode for the monthly
   * revenue pool (Phase 5 settles by view weight). Idempotent per
   * (member, episode, settlementPeriod) — re-views in the same month no-op.
   * Returns recorded:false (NOT an error) for views that are not pool-eligible:
   * non-member viewer, non-member-free IP, owner-less IP, or content the member
   * has not unlocked — so the signal counts only genuine, authorized views.
   */
  async recordMemberView(user: AuthUser, input: RecordMemberViewInput) {
    const now = new Date();
    const episode = await this.prisma.ipEpisode.findFirst({
      where: { id: input.episodeId, ipId: input.ipId, deletedAt: null },
      select: {
        id: true,
        ip: { select: { id: true, createdById: true, accessMode: true } },
      },
    });
    if (!episode) {
      throw new NotFoundException({
        code: 'IP_EPISODE_NOT_FOUND',
        msg: 'IP episode not found.',
      });
    }
    if (episode.ip.accessMode !== IpAccessMode.member_free) {
      return { recorded: false, reason: 'not_member_free' as const };
    }
    if (!episode.ip.createdById) {
      return { recorded: false, reason: 'no_owner' as const };
    }
    const membership = await this.entitlements.isActiveCommunityMember(user, {
      now: now.toISOString(),
    });
    if (!membership.member) {
      return { recorded: false, reason: 'not_member' as const };
    }
    // Count only authorized views: the member must hold an active member_free_grant
    // for this IP (the same entitlement that gates the media).
    const entitlement = await this.prisma.ipContentEntitlement.findFirst({
      where: {
        userId: user.userId,
        ipId: input.ipId,
        sourceType: 'member_free_grant',
        status: IpEntitlementStatus.active,
        startsAt: { lte: now },
        ...currentOrPendingEntitlementWhere(now),
      },
      select: { id: true },
    });
    if (!entitlement) {
      return { recorded: false, reason: 'not_unlocked' as const };
    }
    const settlementPeriod = formatSettlementPeriod(now);
    await this.prisma.memberViewEvent.upsert({
      where: {
        userId_episodeId_settlementPeriod: {
          userId: user.userId,
          episodeId: input.episodeId,
          settlementPeriod,
        },
      },
      create: {
        userId: user.userId,
        ipId: input.ipId,
        episodeId: input.episodeId,
        ownerUserId: episode.ip.createdById,
        entitlementId: entitlement.id,
        settlementPeriod,
        viewedAt: now,
      },
      // Idempotent: the first view of the month sets the weight; re-views no-op.
      update: {},
    });
    return { recorded: true, settlementPeriod };
  }

  listMyReportPurchases(user: AuthUser, query: ListReportPurchasesQuery) {
    return listReportPurchases(this.prisma, user.userId, query);
  }

  async listMyContentReports(user: AuthUser, query: ListMyContentReportsQuery) {
    // Respondents see completed moderation outcomes on IPs they currently own;
    // reporter identities and supporting evidence are never projected here.
    const scope: Prisma.IpContentReportWhereInput =
      query.view === 'initiated'
        ? { reporterUserId: user.userId }
        : {
            ip: { createdById: user.userId, deletedAt: null },
            status: { in: ['actioned', 'dismissed'] },
          };
    if (
      query.cursor &&
      !(await this.prisma.ipContentReport.findFirst({
        where: { ...scope, id: query.cursor },
        select: { id: true },
      }))
    ) {
      throw new BadRequestException({
        code: 'CONTENT_REPORT_CURSOR_INVALID',
        msg: 'Restart the report list to refresh your access.',
      });
    }
    const rows = await this.prisma.ipContentReport.findMany({
      where: {
        ...scope,
        ...(query.cursor ? { id: { lt: query.cursor } } : {}),
      },
      orderBy: { id: 'desc' },
      take: query.limit + 1,
      select: {
        id: true,
        targetType: true,
        targetId: true,
        reason: true,
        status: true,
        createdAt: true,
        resolvedAt: true,
        resolutionNote: true,
        ...(query.view === 'initiated'
          ? { description: true, purchaseOrderId: true }
          : {}),
      },
    });
    return {
      items: rows.slice(0, query.limit),
      nextCursor: rows.length > query.limit ? rows[query.limit - 1].id : null,
    };
  }

  async reportContent(user: AuthUser, input: CreateIpContentReportInput) {
    const report = await this.prisma.$transaction(async (tx) => {
      if (input.requestId) {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`ip-content-report:${input.requestId}`},0))`;
        const previous = await tx.ipContentReport.findUnique({
          where: { id: input.requestId },
        });
        if (previous) {
          if (
            previous.reporterUserId !== user.userId ||
            previous.targetType !== input.targetType ||
            previous.targetId !== input.targetId ||
            previous.reason !== input.reason ||
            previous.purchaseOrderId !== (input.purchaseOrderId ?? null) ||
            previous.description !== (input.description ?? null) ||
            previous.evidenceAssetId !== (input.evidenceAssetId ?? null)
          )
            throw new ConflictException(
              'Report request identity was already used with different details.',
            );
          return previous;
        }
      }
      const target = input.purchaseOrderId
        ? await requireReportPurchase(
            tx,
            user.userId,
            input.purchaseOrderId,
            input.targetType,
            input.targetId,
          )
        : await this.resolveReportTarget(input);
      if (input.evidenceAssetId) {
        await lockMediaAssetReference(tx, input.evidenceAssetId);
      }
      if (
        input.evidenceAssetId &&
        !(await tx.mediaAsset.findFirst({
          where: {
            id: input.evidenceAssetId,
            createdByUserId: user.userId,
            deletedAt: null,
          },
          select: { id: true },
        }))
      )
        throw new BadRequestException({
          code: 'REPORT_EVIDENCE_UNAVAILABLE',
          msg: 'The evidence file is unavailable for your account.',
        });
      return tx.ipContentReport.create({
        data: {
          ...(input.requestId ? { id: input.requestId } : {}),
          targetType: input.targetType as IpTargetType,
          targetId: input.targetId,
          ipId: target.ipId,
          episodeId: target.episodeId,
          reporterUserId: user.userId,
          purchaseOrderId: input.purchaseOrderId,
          reason: input.reason,
          status: IpReportStatus.submitted,
          description: input.description,
          evidenceAssetId: input.evidenceAssetId,
          metadata: {},
        },
      });
    });

    return {
      report: {
        id: report.id,
        status: report.status,
        targetType: report.targetType,
        targetId: report.targetId,
        reason: report.reason,
        createdAt: report.createdAt.toISOString(),
      },
    };
  }

  async listMyContentBlocks(user: AuthUser, query: ListMyContentBlocksQuery) {
    if (
      query.cursor &&
      !(await this.prisma.ipUserContentBlock.findFirst({
        where: { id: query.cursor, userId: user.userId },
        select: { id: true },
      }))
    ) {
      throw new BadRequestException({
        code: 'CONTENT_BLOCK_CURSOR_INVALID',
        msg: 'Restart the blocked content list to refresh your access.',
      });
    }
    const rows = await this.prisma.ipUserContentBlock.findMany({
      where: {
        userId: user.userId,
        unblockedAt: null,
        ...(query.cursor ? { id: { lt: query.cursor } } : {}),
      },
      orderBy: { id: 'desc' },
      take: query.limit + 1,
      select: { id: true, targetType: true, targetId: true, createdAt: true },
    });
    const page = rows.slice(0, query.limit);
    const ipIds = page
      .filter((row) => row.targetType === 'ip')
      .map((row) => row.targetId);
    // A saved block is not permission to read unpublished content.
    const ips = ipIds.length
      ? await this.prisma.ip.findMany({
          where: {
            id: { in: ipIds },
            deletedAt: null,
            status: { in: PUBLIC_IP_STATUSES },
            listingVisibility: { in: ['public', 'unlisted'] },
          },
          select: {
            id: true,
            sourceLocale: true,
            localizations: { where: { archivedAt: null, status: 'published' } },
          },
        })
      : [];
    const titles = new Map(
      ips.map((ip) => [
        ip.id,
        selectIpLocalization(ip, query.locale, true).value?.title ?? null,
      ]),
    );
    return {
      items: page.map((row) => ({
        ...row,
        title: titles.get(row.targetId) ?? null,
      })),
      nextCursor: rows.length > query.limit ? rows[query.limit - 1].id : null,
    };
  }

  async removeMyContentBlock(user: AuthUser, blockId: string) {
    // Remove the exact listed record, not a newer block for the same target.
    const result = await this.prisma.ipUserContentBlock.updateMany({
      where: { id: blockId, userId: user.userId, unblockedAt: null },
      data: { unblockedAt: new Date() },
    });
    return { removed: result.count > 0 };
  }

  async blockContent(user: AuthUser, input: UpsertIpUserBlockInput) {
    await this.assertBlockTargetExists(input);
    const block = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`
        SELECT pg_advisory_xact_lock(hashtext(${`ip:block:${user.userId}:${input.targetType}:${input.targetId}`})::bigint)
      `;
      const existing = await tx.ipUserContentBlock.findFirst({
        where: {
          userId: user.userId,
          targetType: input.targetType as IpUserBlockTargetType,
          targetId: input.targetId,
          unblockedAt: null,
        },
      });
      if (existing) {
        return tx.ipUserContentBlock.update({
          where: { id: existing.id },
          data: { reason: input.reason },
        });
      }
      return tx.ipUserContentBlock.create({
        data: {
          userId: user.userId,
          targetType: input.targetType as IpUserBlockTargetType,
          targetId: input.targetId,
          ipId: input.targetType === 'ip' ? input.targetId : null,
          reason: input.reason,
        },
      });
    });

    return { block: userBlockDto(block) };
  }

  async unblockContent(user: AuthUser, input: UpsertIpUserBlockInput) {
    const block = await this.prisma.ipUserContentBlock.findFirst({
      where: {
        userId: user.userId,
        targetType: input.targetType as IpUserBlockTargetType,
        targetId: input.targetId,
        unblockedAt: null,
      },
    });
    if (!block) {
      return { block: null };
    }
    const updated = await this.prisma.ipUserContentBlock.update({
      where: { id: block.id },
      data: { unblockedAt: new Date() },
    });
    return { block: userBlockDto(updated) };
  }

  private async findCreatorIpForMutation(user: AuthUser, ipId: string) {
    const ip = await this.prisma.ip.findFirst({
      where: {
        id: ipId,
        deletedAt: null,
        ...this.ipEditAccessWhere(user),
      },
      select: {
        id: true,
        sourceLocale: true,
        version: true,
        status: true,
      },
    });
    if (!ip) {
      throw new NotFoundException({
        code: 'IP_NOT_FOUND',
        msg: 'IP not found.',
      });
    }
    return {
      ...ip,
      sourceLocale: normalizeLocale(ip.sourceLocale),
    };
  }

  private async lockCreatorIpSnapshotTx(
    tx: Prisma.TransactionClient,
    ipId: string,
    version: number,
  ) {
    // Preflight reads do not protect against another save committing before
    // this transaction. Lock the parent before touching any child rows, then
    // verify the snapshot used for validation is still current.
    const [current] = await tx.$queryRaw<Array<{ version: number }>>`
      SELECT version FROM ips
      WHERE id = ${ipId}::uuid AND deleted_at IS NULL
      FOR UPDATE
    `;
    if (!current) {
      throw new NotFoundException({
        code: 'IP_NOT_FOUND',
        msg: 'IP not found.',
      });
    }
    this.assertExpectedVersion(version, current.version);
  }

  private assertExpectedVersion(expected: number | undefined, actual: number) {
    if (expected === undefined || expected === actual) return;
    throw new ConflictException({
      code: 'IP_VERSION_CONFLICT',
      msg: 'This IP was updated elsewhere. Refresh and try again.',
    });
  }

  private async resolveMediaAssetCreateTx(
    tx: Prisma.TransactionClient,
    input: {
      assetId?: string;
      kind: MediaAssetKind;
    },
  ) {
    if (input.assetId) {
      return this.assertBindableMediaAssetTx(tx, input.assetId, input.kind);
    }
    return null;
  }

  private async resolveMediaAssetPatchTx(
    tx: Prisma.TransactionClient,
    input: {
      assetId?: string | null;
      kind: MediaAssetKind;
    },
  ) {
    if (input.assetId !== undefined) {
      return input.assetId
        ? this.assertBindableMediaAssetTx(tx, input.assetId, input.kind)
        : null;
    }
    return undefined;
  }

  private async assertBindableMediaAssetTx(
    tx: Prisma.TransactionClient,
    assetId: string,
    kind: MediaAssetKind,
  ) {
    const asset = await tx.mediaAsset.findFirst({
      where: {
        id: assetId,
        kind,
        status: MediaAssetStatus.ready,
        deletedAt: null,
      },
      select: { id: true },
    });
    if (!asset) {
      throw new BadRequestException({
        code: 'IP_MEDIA_ASSET_INVALID',
        msg: 'Media asset is missing, not ready, or has the wrong type.',
      });
    }
    return asset.id;
  }

  private assertUploadMatchesKind(
    file: { mimetype: string; originalname: string },
    kind: MediaAssetKind,
  ) {
    const mimetype = (file.mimetype || '').toLowerCase();
    if (kind === MediaAssetKind.image && !mimetype.startsWith('image/')) {
      throw new BadRequestException({
        code: 'IP_MEDIA_KIND_MISMATCH',
        msg: 'Cover assets must be image files.',
      });
    }
    if (kind === MediaAssetKind.video && !mimetype.startsWith('video/')) {
      throw new BadRequestException({
        code: 'IP_MEDIA_KIND_MISMATCH',
        msg: 'Trailer and episode media assets must be video files.',
      });
    }
    if (kind === MediaAssetKind.audio && !mimetype.startsWith('audio/')) {
      throw new BadRequestException({
        code: 'IP_MEDIA_KIND_MISMATCH',
        msg: 'Audio assets must be audio files.',
      });
    }
  }

  private async applyModerationAction(
    tx: Prisma.TransactionClient,
    actorId: string,
    report: {
      id: string;
      targetType: IpTargetType;
      targetId: string;
      ipId: string | null;
      episodeId: string | null;
      ip: {
        id: string;
        status: IpPublicationStatus;
        listingVisibility: IpListingVisibility;
        scheduledAt: Date | null;
        publishedAt: Date | null;
        suspendedAt: Date | null;
        archivedAt: Date | null;
        version: number;
      } | null;
      episode: {
        id: string;
        status: IpPublicationStatus;
        scheduledAt: Date | null;
        publishedAt: Date | null;
        suspendedAt: Date | null;
        archivedAt: Date | null;
        version: number;
      } | null;
    },
    actionType: IpModerationActionType,
    input: { reason: string; now: Date },
  ) {
    const targetType = report.episodeId
      ? IpModerationTargetType.episode
      : IpModerationTargetType.ip;
    const targetId = report.episodeId ?? report.ipId ?? report.targetId;
    const before =
      targetType === IpModerationTargetType.episode
        ? report.episode
        : report.ip;
    if (!before) return;

    let after: unknown = before;
    if (targetType === IpModerationTargetType.ip && report.ipId) {
      after = await tx.ip.update({
        where: { id: report.ipId },
        data: ipPublicationPatchForModeration(actionType, input.now),
      });
    }
    if (targetType === IpModerationTargetType.episode && report.episodeId) {
      after = await tx.ipEpisode.update({
        where: { id: report.episodeId },
        data: episodePublicationPatchForModeration(actionType, input.now),
      });
    }

    await tx.ipModerationAction.create({
      data: {
        targetType,
        targetId,
        actionType,
        actorUserId: actorId,
        reason: input.reason,
        before: moderationSnapshot(before) as Prisma.InputJsonValue,
        after: moderationSnapshot(after) as Prisma.InputJsonValue,
        metadata: {
          source: 'admin_ip_report_resolution',
          reportId: report.id,
        },
      },
    });
  }

  private async viewerBlockWhere(
    user?: AuthUser,
    db: Prisma.TransactionClient = this.prisma,
  ): Promise<Prisma.IpWhereInput> {
    const { blockedIpIds, blockedCreatorIds } = await this.viewerBlockLists(
      user,
      db,
    );
    const not: Prisma.IpWhereInput[] = [];
    if (blockedIpIds.length > 0) {
      not.push({ id: { in: blockedIpIds } });
    }
    if (blockedCreatorIds.length > 0) {
      not.push({ createdById: { in: blockedCreatorIds } });
    }
    return not.length > 0 ? { NOT: not } : {};
  }

  private async viewerBlockLists(
    user?: AuthUser,
    db: Prisma.TransactionClient = this.prisma,
  ): Promise<ViewerBlockLists> {
    if (!user) return { blockedIpIds: [], blockedCreatorIds: [] };
    const blocks = await db.ipUserContentBlock.findMany({
      where: {
        userId: user.userId,
        unblockedAt: null,
      },
      select: {
        targetType: true,
        targetId: true,
      },
    });
    return {
      blockedIpIds: blocks
        .filter((block) => block.targetType === IpUserBlockTargetType.ip)
        .map((block) => block.targetId),
      blockedCreatorIds: blocks
        .filter((block) => block.targetType === IpUserBlockTargetType.creator)
        .map((block) => block.targetId),
    };
  }

  private actorKindForUser(): IpEngagementActorKind {
    // Product user traffic is always human. Agent traffic enters through the
    // internal Agent User endpoints, which pass explicit actor provenance.
    return IpEngagementActorKind.human;
  }

  async ensurePublicEngagementTarget(
    user: AuthUser | undefined,
    ipId: string,
    db: Prisma.TransactionClient = this.prisma,
  ) {
    const viewerBlockWhere = await this.viewerBlockWhere(user, db);
    const ip = await db.ip.findFirst({
      where: {
        id: ipId,
        deletedAt: null,
        status: { in: PUBLIC_IP_STATUSES },
        listingVisibility: { in: ['public', 'unlisted'] },
        localizations: {
          some: {
            archivedAt: null,
            status: { in: PUBLIC_LOCALIZATION_STATUSES },
          },
        },
        ...viewerBlockWhere,
      },
      select: { id: true },
    });
    if (!ip) {
      throw new NotFoundException({
        code: 'IP_NOT_FOUND',
        msg: 'IP not found.',
      });
    }
    return ip;
  }

  private async engagementStatsForIp(
    ipId: string,
    user?: AuthUser,
  ): Promise<IpEngagementStats> {
    return (
      (await this.engagementStatsForIps([ipId], user)).get(ipId) ??
      emptyIpEngagementStats()
    );
  }

  private async engagementStatsForIps(
    ipIds: readonly string[],
    user?: AuthUser,
  ): Promise<Map<string, IpEngagementStats>> {
    const uniqueIds = Array.from(new Set(ipIds.filter(Boolean)));
    const out = new Map<string, IpEngagementStats>(
      uniqueIds.map((id) => [id, emptyIpEngagementStats()]),
    );
    if (uniqueIds.length === 0) return out;

    const aggregatesPromise = this.prisma.ipEngagementAggregate.findMany({
      where: { ipId: { in: uniqueIds } },
    });
    const collectionCountsPromise = this.prisma.ipCollectionItem.groupBy({
      by: ['ipId'],
      where: {
        ipId: { in: uniqueIds },
        targetType: IpTargetType.ip,
        status: IpCollectionItemStatus.active,
        removedAt: null,
      },
      _count: { _all: true },
    });
    const viewerLikesPromise: Promise<Array<{ ipId: string }>> = user
      ? this.prisma.ipLike.findMany({
          where: {
            userId: user.userId,
            ipId: { in: uniqueIds },
            status: IpLikeStatus.active,
            removedAt: null,
          },
          select: { ipId: true },
        })
      : Promise.resolve([]);
    const [aggregates, collectionCounts, viewerLikes] = await Promise.all([
      aggregatesPromise,
      collectionCountsPromise,
      viewerLikesPromise,
    ]);
    const likedIpIds = new Set(viewerLikes.map((like) => like.ipId));

    for (const row of aggregates) {
      const current = out.get(row.ipId) ?? emptyIpEngagementStats();
      out.set(row.ipId, {
        viewCount: bigintCount(row.totalViewCount),
        likeCount: bigintCount(row.totalLikeCount),
        collectionCount: current.collectionCount,
        humanViewCount: bigintCount(row.humanViewCount),
        agentViewCount: bigintCount(row.agentViewCount),
        humanLikeCount: bigintCount(row.humanLikeCount),
        agentLikeCount: bigintCount(row.agentLikeCount),
        viewerHasLiked: likedIpIds.has(row.ipId),
      });
    }
    for (const row of collectionCounts) {
      const current = out.get(row.ipId) ?? emptyIpEngagementStats();
      out.set(row.ipId, {
        ...current,
        collectionCount: bigintCount(row._count._all),
      });
    }
    for (const ipId of likedIpIds) {
      const current = out.get(ipId) ?? emptyIpEngagementStats();
      out.set(ipId, { ...current, viewerHasLiked: true });
    }
    return out;
  }

  private async incrementViewAggregateTx(
    tx: Prisma.TransactionClient,
    ipId: string,
    actorKind: IpEngagementActorKind,
    now: Date,
  ) {
    const human = actorKind === IpEngagementActorKind.human ? 1 : 0;
    const agent = actorKind === IpEngagementActorKind.agent ? 1 : 0;
    await tx.ipEngagementAggregate.upsert({
      where: { ipId },
      create: {
        ipId,
        humanViewCount: human,
        agentViewCount: agent,
        totalViewCount: 1,
        lastViewedAt: now,
      },
      update: {
        humanViewCount: { increment: human },
        agentViewCount: { increment: agent },
        totalViewCount: { increment: 1 },
        lastViewedAt: now,
      },
    });
  }

  private async incrementLikeAggregateTx(
    tx: Prisma.TransactionClient,
    ipId: string,
    actorKind: IpEngagementActorKind,
    now: Date,
    delta: 1 | -1,
  ) {
    const human = actorKind === IpEngagementActorKind.human ? delta : 0;
    const agent = actorKind === IpEngagementActorKind.agent ? delta : 0;
    await tx.ipEngagementAggregate.upsert({
      where: { ipId },
      create: {
        ipId,
        humanLikeCount: Math.max(human, 0),
        agentLikeCount: Math.max(agent, 0),
        totalLikeCount: delta > 0 ? 1 : 0,
        lastLikedAt: delta > 0 ? now : null,
      },
      update: {
        humanLikeCount: { increment: human },
        agentLikeCount: { increment: agent },
        totalLikeCount: { increment: delta },
        ...(delta > 0 ? { lastLikedAt: now } : {}),
      },
    });
  }

  private async resolveCollectionTarget(
    user: AuthUser,
    input: UpsertIpCollectionItemInput,
  ) {
    const targetType = input.targetType as IpTargetType;
    const viewerBlockWhere = await this.viewerBlockWhere(user);

    if (targetType === IpTargetType.ip) {
      const ip = await this.prisma.ip.findFirst({
        where: {
          id: input.ipId,
          deletedAt: null,
          status: { in: PUBLIC_IP_STATUSES },
          listingVisibility: { in: ['public', 'unlisted'] },
          ...viewerBlockWhere,
        },
        select: { id: true },
      });
      if (!ip) {
        throw new NotFoundException({
          code: 'IP_COLLECTION_TARGET_NOT_FOUND',
          msg: 'Collection target was not found.',
        });
      }
      return { ipId: ip.id, episodeId: null, targetType };
    }

    const episode = await this.prisma.ipEpisode.findFirst({
      where: {
        id: input.episodeId,
        ipId: input.ipId,
        deletedAt: null,
        status: { in: PUBLIC_EPISODE_STATUSES },
        ip: {
          deletedAt: null,
          status: { in: PUBLIC_IP_STATUSES },
          listingVisibility: { in: ['public', 'unlisted'] },
          ...viewerBlockWhere,
        },
      },
      select: { id: true, ipId: true },
    });
    if (!episode) {
      throw new NotFoundException({
        code: 'IP_COLLECTION_TARGET_NOT_FOUND',
        msg: 'Collection target was not found.',
      });
    }
    return { ipId: episode.ipId, episodeId: episode.id, targetType };
  }

  private async resolveAgentIpCollectionTarget(ipId: string) {
    const ip = await this.prisma.ip.findFirst({
      where: {
        id: ipId,
        deletedAt: null,
        status: { in: PUBLIC_IP_STATUSES },
        listingVisibility: IpListingVisibility.public,
      },
      select: { id: true },
    });
    if (!ip) {
      throw new NotFoundException({
        code: 'IP_COLLECTION_TARGET_NOT_FOUND',
        msg: 'Collection target was not found.',
      });
    }
    return { ipId: ip.id };
  }

  private async resolveReportTarget(input: CreateIpContentReportInput) {
    if (input.targetType === 'ip') {
      const ip = await this.prisma.ip.findFirst({
        where: {
          id: input.targetId,
          deletedAt: null,
          listingVisibility: { in: ['public', 'unlisted'] },
        },
      });
      if (!ip) {
        throw new NotFoundException({
          code: 'IP_REPORT_TARGET_NOT_FOUND',
          msg: 'Report target was not found.',
        });
      }
      return { ipId: ip.id, episodeId: null };
    }

    const episode = await this.prisma.ipEpisode.findFirst({
      where: {
        id: input.targetId,
        deletedAt: null,
        ip: {
          deletedAt: null,
          listingVisibility: { in: ['public', 'unlisted'] },
        },
      },
    });
    if (!episode) {
      throw new NotFoundException({
        code: 'IP_REPORT_TARGET_NOT_FOUND',
        msg: 'Report target was not found.',
      });
    }
    return { ipId: episode.ipId, episodeId: episode.id };
  }

  private async assertBlockTargetExists(input: UpsertIpUserBlockInput) {
    if (input.targetType !== 'ip') return;
    const ip = await this.prisma.ip.findFirst({
      where: {
        id: input.targetId,
        deletedAt: null,
        listingVisibility: { in: ['public', 'unlisted'] },
      },
    });
    if (!ip) {
      throw new NotFoundException({
        code: 'IP_BLOCK_TARGET_NOT_FOUND',
        msg: 'Block target was not found.',
      });
    }
  }

  private async resolvePriceRuleTx(
    tx: Prisma.TransactionClient,
    input: {
      ipId: string;
      episodeId: string | null;
      targetType: IpTargetType;
      priceRuleId?: string;
      isMember: boolean;
      now: Date;
    },
  ) {
    const where: Prisma.IpPriceRuleWhereInput = {
      id: input.priceRuleId,
      ipId: input.ipId,
      episodeId:
        input.targetType === IpTargetType.episode ? input.episodeId : null,
      targetType: input.targetType,
      currency: WalletCurrencyType.community_point,
      status: IpPriceRuleStatus.active,
      archivedAt: null,
      OR: [{ startsAt: null }, { startsAt: { lte: input.now } }],
      AND: [
        { OR: [{ endsAt: null }, { endsAt: { gt: input.now } }] },
        {
          OR: [
            { campaignId: null },
            {
              campaign: {
                status: {
                  in: [IpCampaignStatus.scheduled, IpCampaignStatus.active],
                },
                archivedAt: null,
                OR: [{ startsAt: null }, { startsAt: { lte: input.now } }],
                AND: [
                  { OR: [{ endsAt: null }, { endsAt: { gt: input.now } }] },
                ],
              },
            },
          ],
        },
      ],
    };

    const priceRule = await tx.ipPriceRule.findFirst({
      where,
      orderBy: [{ priority: 'desc' }, { amount: 'asc' }, { createdAt: 'desc' }],
    });
    if (!priceRule) {
      throw new ConflictException({
        code: 'IP_PRICE_RULE_NOT_FOUND',
        msg: 'No active price rule is available for this IP content.',
      });
    }

    // Community-member discount, applied AFTER rule selection (no member-specific
    // rule variant). bps from the rule (NULL inherits the platform default; 0
    // disables). `chargeAmount` is the single source of the charged number; the
    // list `priceRule.amount` is kept verbatim for the price snapshot / audit.
    let memberDiscountBps = 0;
    if (input.isMember && priceRule.amount > 0n) {
      const ruleBps = priceRule.memberDiscountBps;
      memberDiscountBps =
        ruleBps != null ? ruleBps : await this.getMemberDiscountDefaultBps();
    }
    const clampedBps = clampBps(memberDiscountBps);
    const chargeAmount = applyMemberDiscount(priceRule.amount, clampedBps);
    return { priceRule, chargeAmount, memberDiscountBps: clampedBps };
  }

  private async assertMaxPerUserTx(
    tx: Prisma.TransactionClient,
    priceRule: { id: string; maxPerUser: number | null },
    userId: string,
  ): Promise<void> {
    if (!priceRule.maxPerUser) return;
    const count = await tx.ipPurchaseOrder.count({
      where: {
        userId,
        priceRuleId: priceRule.id,
        status: {
          in: [IpPurchaseOrderStatus.paid, IpPurchaseOrderStatus.fulfilled],
        },
      },
    });
    if (count >= priceRule.maxPerUser) {
      throw new ConflictException({
        code: 'IP_PRICE_RULE_LIMIT_REACHED',
        msg: 'This purchase limit has already been reached.',
      });
    }
  }

  private async resolveReferralLinkTx(
    tx: Prisma.TransactionClient,
    input: {
      code: string;
      ipId: string;
      episodeId: string | null;
      now: Date;
    },
  ) {
    return tx.ipReferralLink.findFirst({
      where: {
        code: input.code,
        ipId: input.ipId,
        status: IpReferralLinkStatus.active,
        OR: [{ episodeId: null }, { episodeId: input.episodeId }],
        AND: [
          { OR: [{ startsAt: null }, { startsAt: { lte: input.now } }] },
          { OR: [{ endsAt: null }, { endsAt: { gt: input.now } }] },
        ],
      },
      orderBy: [{ episodeId: 'desc' }, { createdAt: 'desc' }],
    });
  }

  private async postReferralAttributionTx(
    tx: Prisma.TransactionClient,
    input: {
      referralLink: {
        id: string;
        userId: string;
      };
      buyerUserId: string;
      orderId: string;
      ipId: string;
      episodeId: string | null;
      now: Date;
    },
  ): Promise<void> {
    await tx.ipReferralAttribution.create({
      data: {
        referralLinkId: input.referralLink.id,
        ipId: input.ipId,
        episodeId: input.episodeId,
        orderId: input.orderId,
        buyerUserId: input.buyerUserId,
        metadata: {},
        attributedAt: input.now,
      },
    });
  }
}

export function assertIpPurchaserAllowed(input: {
  buyerUserId: string;
  creatorUserId: string;
  hasEditAccess?: boolean;
}) {
  if (input.buyerUserId === input.creatorUserId) {
    throw new ConflictException({
      code: 'IP_OWNER_CANNOT_PURCHASE',
      msg: 'Creators cannot purchase their own IP content.',
    });
  }
  if (input.hasEditAccess) {
    throw new ConflictException({
      code: 'IP_EDITOR_CANNOT_PURCHASE',
      msg: 'Editors cannot purchase IP content they can already manage.',
    });
  }
}

/**
 * Final-state validation for an IP's revenue-eligible contributors — shared by
 * the admin and creator revenue-config write paths. Pure (no Prisma) so it can
 * be unit-tested directly. An account-less contributor cannot receive a
 * withdrawable credit (the purchase split filters userId != null), so a
 * phantom split must be rejected rather than silently routed to the owner.
 */
export function assertEligibleContributorsHaveAccount(
  eligible: { userId: string | null }[],
) {
  if (eligible.some((c) => c.userId == null)) {
    throw new ConflictException({
      code: 'IP_REVENUE_CONTRIBUTOR_NO_ACCOUNT',
      msg: 'A contributor without a linked account cannot earn revenue. Link an account or turn off their revenue share.',
    });
  }
}

/**
 * Eligible contributors' pool shares must total <= 100% (10000 bps). Validates
 * the persisted set so a partial edit can't combine with untouched rows to
 * over-allocate the creator pool. Pure — unit-testable.
 */
export function assertEligibleContributorSharesWithinPool(
  eligible: { revenueShareBps: number | null }[],
) {
  const totalBps = eligible.reduce(
    (sum, c) => sum + (c.revenueShareBps ?? 0),
    0,
  );
  if (totalBps > 10000) {
    throw new ConflictException({
      code: 'IP_REVENUE_SHARE_OVERALLOCATED',
      msg: `Eligible contributor shares total ${(totalBps / 100).toFixed(
        2,
      )}% which exceeds 100%. Adjust the splits.`,
    });
  }
}

export function resolveIpEntitlementWindow(
  priceRule: { unlocksAt: Date | null },
  now: Date,
): { startsAt: Date; endsAt: Date | null } {
  return {
    startsAt:
      priceRule.unlocksAt && priceRule.unlocksAt > now
        ? priceRule.unlocksAt
        : now,
    endsAt: null,
  };
}

function currentOrPendingEntitlementWhere(
  now: Date,
): Prisma.IpContentEntitlementWhereInput {
  return {
    OR: [{ endsAt: null }, { endsAt: { gt: now } }],
  };
}

export function isEntitlementActiveForAccess(
  entitlement: { startsAt: Date; endsAt: Date | null },
  now: Date,
): boolean {
  return (
    entitlement.startsAt <= now &&
    (entitlement.endsAt === null || entitlement.endsAt > now)
  );
}

export function resolveIpAccessState(input: {
  hasManagementAccess: boolean;
  /** Java certification level free-watch pass (view unlock only). */
  hasFreeWatchPass?: boolean;
  hasIpEntitlement: boolean;
  hasPendingIpEntitlement: boolean;
  accessMode: IpAccessMode;
  isMember: boolean;
  hasIpPrice: boolean;
}): {
  owned: boolean;
  access:
    | 'free'
    | 'locked'
    | 'owned'
    | 'pending_unlock'
    | 'member_free'
    | 'member_locked';
} {
  if (
    input.hasManagementAccess ||
    input.hasFreeWatchPass ||
    input.hasIpEntitlement
  ) {
    return { owned: true, access: 'owned' };
  }
  if (input.hasPendingIpEntitlement) {
    return { owned: false, access: 'pending_unlock' };
  }
  if (input.accessMode === IpAccessMode.member_free) {
    return {
      owned: false,
      access: input.isMember ? 'member_free' : 'member_locked',
    };
  }
  return { owned: false, access: input.hasIpPrice ? 'locked' : 'free' };
}

export function resolveEpisodeAccessState(input: {
  hasManagementAccess: boolean;
  hasFreeWatchPass?: boolean;
  hasIpEntitlement: boolean;
  hasEpisodeEntitlement: boolean;
  hasPendingIpEntitlement: boolean;
  hasPendingEpisodeEntitlement: boolean;
  isFreePreview: boolean;
  accessMode: IpAccessMode;
  isMember: boolean;
  hasEpisodePrice: boolean;
  hasIpPrice: boolean;
}): {
  owned: boolean;
  access:
    | 'free'
    | 'free_preview'
    | 'locked'
    | 'locked_bundle'
    | 'pending_unlock_ip'
    | 'pending_unlock_episode'
    | 'owned_ip'
    | 'owned_episode'
    | 'member_free'
    | 'member_locked';
} {
  if (
    input.hasManagementAccess ||
    input.hasFreeWatchPass ||
    input.hasIpEntitlement
  ) {
    return { owned: true, access: 'owned_ip' };
  }
  if (input.hasEpisodeEntitlement) {
    return { owned: true, access: 'owned_episode' };
  }
  if (input.isFreePreview) {
    return { owned: false, access: 'free_preview' };
  }
  if (input.hasPendingIpEntitlement) {
    return { owned: false, access: 'pending_unlock_ip' };
  }
  if (input.hasPendingEpisodeEntitlement) {
    return { owned: false, access: 'pending_unlock_episode' };
  }
  if (input.accessMode === IpAccessMode.member_free) {
    return {
      owned: false,
      access: input.isMember ? 'member_free' : 'member_locked',
    };
  }
  if (input.hasEpisodePrice) {
    return { owned: false, access: 'locked' };
  }
  return { owned: false, access: input.hasIpPrice ? 'locked_bundle' : 'free' };
}

async function findCurrentOrPendingEntitlementTx(
  tx: Prisma.TransactionClient,
  input: {
    userId: string;
    ipId: string;
    targetType: IpTargetType;
    episodeId: string | null;
  },
) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`ip:entitlement:${input.userId}:${input.ipId}`})::bigint)`;
  const [{ now }] = await tx.$queryRaw<
    Array<{ now: Date }>
  >`SELECT clock_timestamp() AS now`;
  const titleEntitlement = await tx.ipContentEntitlement.findFirst({
    where: {
      userId: input.userId,
      ipId: input.ipId,
      targetType: IpTargetType.ip,
      episodeId: null,
      status: IpEntitlementStatus.active,
      ...currentOrPendingEntitlementWhere(now),
    },
  });
  if (titleEntitlement) return titleEntitlement;

  if (input.targetType === IpTargetType.ip) return null;
  return tx.ipContentEntitlement.findFirst({
    where: {
      userId: input.userId,
      ipId: input.ipId,
      episodeId: input.episodeId,
      targetType: IpTargetType.episode,
      status: IpEntitlementStatus.active,
      ...currentOrPendingEntitlementWhere(now),
    },
  });
}

async function ensureCollectionItemTx(
  tx: Prisma.TransactionClient,
  userId: string,
  entitlement: {
    id: string;
    ipId: string;
    episodeId: string | null;
    targetType: IpTargetType;
  },
) {
  const existing = await tx.ipCollectionItem.findFirst({
    where: {
      userId,
      ipId: entitlement.ipId,
      episodeId: entitlement.episodeId,
      targetType: entitlement.targetType,
      removedAt: null,
    },
  });
  if (existing) {
    await tx.ipCollectionItem.update({
      where: { id: existing.id },
      data: {
        status: IpCollectionItemStatus.active,
        entitlementId: entitlement.id,
      },
    });
    return;
  }

  await tx.ipCollectionItem.create({
    data: {
      userId,
      ipId: entitlement.ipId,
      episodeId: entitlement.episodeId,
      entitlementId: entitlement.id,
      targetType: entitlement.targetType,
      status: IpCollectionItemStatus.active,
    },
  });
}

function collectionItemMutationDto(item: {
  id: string;
  userId: string;
  ipId: string;
  episodeId: string | null;
  targetType: IpTargetType;
  status: IpCollectionItemStatus;
  addedAt: Date;
  removedAt: Date | null;
}) {
  return {
    id: item.id,
    userId: item.userId,
    ipId: item.ipId,
    episodeId: item.episodeId,
    targetType: item.targetType,
    status: item.status,
    addedAt: item.addedAt.toISOString(),
    removedAt: item.removedAt?.toISOString() ?? null,
  };
}

async function debitCommunityPointTx(
  tx: Prisma.TransactionClient,
  input: {
    userId: string;
    amount: bigint;
    orderId: string;
    orderNo: string;
  },
) {
  const account = await ensureWalletAccount(tx, {
    ownerType: WalletOwnerType.user,
    ownerId: input.userId,
    currency: WalletCurrencyType.community_point,
    balanceKind: WalletBalanceKind.consumable,
  });
  await tx.$executeRaw`
    SELECT pg_advisory_xact_lock(hashtext(${`wallet:account:${account.id}`})::bigint)
  `;

  // community_point/consumable is credit-grant-backed: sweep lapsed grants
  // BEFORE the balance check so an expired-but-not-yet-swept grant can't admit
  // a spend the FIFO consume below then can't fulfill (mirrors postEntry).
  await expireLapsedGrantsTx(tx, account.id);

  const locked = await tx.walletAccount.findUniqueOrThrow({
    where: { id: account.id },
  });
  if (locked.status !== WalletAccountStatus.active) {
    throw new ConflictException({
      code: 'WALLET_ACCOUNT_NOT_ACTIVE',
      msg: 'Wallet account is not active.',
    });
  }
  if (locked.availableBalance < input.amount) {
    throw new ConflictException({
      code: 'INSUFFICIENT_COMMUNITY_POINTS',
      msg: 'Community point balance is insufficient.',
    });
  }

  const idempotencyKey = `ip_purchase_order:${input.orderId}:community_point_debit`;
  const existing = await tx.walletTransaction.findUnique({
    where: { idempotencyKey },
  });
  if (existing) return existing;

  const nextAvailable = locked.availableBalance - input.amount;
  const transaction = await tx.walletTransaction.create({
    data: {
      status: WalletTransactionStatus.posted,
      sourceType: 'ip_purchase_order',
      sourceId: input.orderId,
      idempotencyKey,
      actorUserId: input.userId,
      description: `Community point purchase ${input.orderNo}`,
      metadata: {
        orderNo: input.orderNo,
      },
    },
  });

  const entry = await tx.walletLedgerEntry.create({
    data: {
      transactionId: transaction.id,
      accountId: locked.id,
      entryType: WalletLedgerEntryType.debit,
      currency: WalletCurrencyType.community_point,
      balanceKind: WalletBalanceKind.consumable,
      amount: input.amount,
      availableDelta: -input.amount,
      heldDelta: 0n,
      availableBalanceAfter: nextAvailable,
      heldBalanceAfter: locked.heldBalance,
      reason: 'ip_purchase',
    },
  });
  // FIFO-consume grant lots (expiring first) so the grant ledger stays in lock-
  // step with the balance. After the backfill every community balance is
  // grant-backed, so this always covers the debit; a shortfall throws
  // INSUFFICIENT_UNEXPIRED_WALLET_GRANTS (drift detector).
  await consumeAvailableGrantsTx(tx, {
    accountId: locked.id,
    transactionId: transaction.id,
    ledgerEntryId: entry.id,
    amount: input.amount,
    entryType: WalletLedgerEntryType.debit,
  });
  await tx.walletAccount.update({
    where: { id: locked.id },
    data: {
      availableBalance: nextAvailable,
      version: { increment: 1 },
    },
  });

  return transaction;
}

type RevenueCreditOrder = {
  id: string;
  orderNo: string;
  ipId: string;
  episodeId: string | null;
  totalAmount: bigint;
};

/**
 * Split a paid IP sale's creator pool across the IP's eligible contributors and
 * credit each beneficiary's WITHDRAWABLE community-point wallet — all inside the
 * caller's purchase transaction, so it is atomic with the buyer debit and the
 * entitlement grant. Earning-only: no fiat moves. Owner-only is the degenerate
 * case (no eligible contributors → the owner takes the whole pool).
 */
async function creditCreatorRevenueTx(
  tx: Prisma.TransactionClient,
  input: {
    order: RevenueCreditOrder;
    ownerUserId: string;
    shareBps: number;
    now: Date;
  },
) {
  if (input.order.totalAmount <= 0n || !input.ownerUserId) return;

  const eligible = await tx.ipContributor.findMany({
    where: {
      ipId: input.order.ipId,
      removedAt: null,
      revenueEligible: true,
      userId: { not: null },
    },
    select: { userId: true, revenueShareBps: true },
  });

  const split = computeRevenueSplit({
    totalAmount: input.order.totalAmount,
    shareBps: input.shareBps,
    ownerUserId: input.ownerUserId,
    contributors: eligible
      .filter((c): c is { userId: string; revenueShareBps: number | null } =>
        Boolean(c.userId),
      )
      .map((c) => ({ userId: c.userId, shareBps: c.revenueShareBps })),
  });

  // Deterministic order (computeRevenueSplit already sorts by userId) keeps the
  // wallet-account advisory-lock acquisition order stable across concurrent
  // sales, so two purchases crediting overlapping creators can't deadlock.
  for (const beneficiary of split.beneficiaries) {
    await creditWithdrawableCommunityPointTx(tx, {
      userId: beneficiary.userId,
      amount: beneficiary.amount,
      shareBps: beneficiary.shareBps,
      order: input.order,
      now: input.now,
    });
  }
}

/** Credit one beneficiary's withdrawable wallet + write the revenue ledger row. */
async function creditWithdrawableCommunityPointTx(
  tx: Prisma.TransactionClient,
  input: {
    userId: string;
    amount: bigint;
    shareBps: number;
    order: RevenueCreditOrder;
    now: Date;
  },
) {
  if (input.amount <= 0n) return;

  // Withdrawable accounts are only ever created here (always active); nothing
  // closes them in the earning-only loop, so a status gate that could roll back
  // the buyer's purchase is intentionally omitted.
  const account = await ensureWalletAccount(tx, {
    ownerType: WalletOwnerType.user,
    ownerId: input.userId,
    currency: WalletCurrencyType.community_point,
    balanceKind: WalletBalanceKind.withdrawable,
  });
  await tx.$executeRaw`
    SELECT pg_advisory_xact_lock(hashtext(${`wallet:account:${account.id}`})::bigint)
  `;

  const idempotencyKey = `ip_purchase_order:${input.order.id}:revenue:${input.userId}`;
  const existing = await tx.walletTransaction.findUnique({
    where: { idempotencyKey },
  });
  if (existing) return;

  const locked = await tx.walletAccount.findUniqueOrThrow({
    where: { id: account.id },
  });
  const nextAvailable = locked.availableBalance + input.amount;

  const transaction = await tx.walletTransaction.create({
    data: {
      status: WalletTransactionStatus.posted,
      sourceType: 'ip_purchase_order',
      sourceId: input.order.id,
      idempotencyKey,
      actorUserId: input.userId,
      description: `IP revenue ${input.order.orderNo}`,
      metadata: {
        orderNo: input.order.orderNo,
        ipId: input.order.ipId,
        shareBps: input.shareBps,
      },
    },
  });

  await tx.walletLedgerEntry.create({
    data: {
      transactionId: transaction.id,
      accountId: locked.id,
      entryType: WalletLedgerEntryType.credit,
      currency: WalletCurrencyType.community_point,
      balanceKind: WalletBalanceKind.withdrawable,
      amount: input.amount,
      availableDelta: input.amount,
      heldDelta: 0n,
      availableBalanceAfter: nextAvailable,
      heldBalanceAfter: locked.heldBalance,
      reason: 'ip_revenue_share',
    },
  });
  await tx.walletAccount.update({
    where: { id: locked.id },
    data: {
      availableBalance: nextAvailable,
      version: { increment: 1 },
    },
  });

  // System-of-record row. The @@unique(orderId, userId, entryType) constraint is
  // the durable double-pay backstop on top of the per-beneficiary wallet key.
  await tx.ipRevenueLedgerEntry.create({
    data: {
      userId: input.userId,
      ipId: input.order.ipId,
      episodeId: input.order.episodeId,
      orderId: input.order.id,
      walletTransactionId: transaction.id,
      entryType: IpRevenueLedgerEntryType.revenue_share,
      status: IpRevenueLedgerStatus.posted,
      currency: WalletCurrencyType.community_point,
      balanceKind: WalletBalanceKind.withdrawable,
      amount: input.amount,
      sourceAmount: input.order.totalAmount,
      shareBps: input.shareBps,
      postedAt: input.now,
    },
  });
}

function ipIdentityWhere(reference: string): Prisma.IpWhereInput {
  return /^\d+$/.test(reference)
    ? { roomNumber: reference }
    : { id: reference };
}

function adminIpWhere(query: ListAdminIpsQuery): Prisma.IpWhereInput {
  const search = query.q?.trim();
  return {
    deletedAt: null,
    channelType: query.channelType,
    status: query.status as IpPublicationStatus | undefined,
    listingVisibility: query.listingVisibility as
      | IpListingVisibility
      | undefined,
    ...ipTaxonomyFilterWhere(query.genreCodes, query.tagCodes),
    ...(search
      ? {
          OR: [
            { roomNumber: search },
            {
              localizations: {
                some: {
                  archivedAt: null,
                  OR: [
                    { title: { contains: search, mode: 'insensitive' } },
                    { subtitle: { contains: search, mode: 'insensitive' } },
                    { summary: { contains: search, mode: 'insensitive' } },
                    { slug: { contains: search, mode: 'insensitive' } },
                  ],
                },
              },
            },
          ],
        }
      : {}),
  };
}

function adminPurchaseOrderWhere(
  query: ListAdminIpOrdersQuery,
): Prisma.IpPurchaseOrderWhereInput {
  const search = query.q?.trim();
  return {
    ipId: query.ipId,
    // Filter arrives as the encoded public id; orders store the raw id.
    userId: query.userId ? decodeUserId(query.userId) : undefined,
    status: query.status as IpPurchaseOrderStatus | undefined,
    ...(search
      ? {
          OR: [
            { orderNo: { contains: search, mode: 'insensitive' } },
            { userId: { contains: search, mode: 'insensitive' } },
            {
              ip: {
                localizations: {
                  some: {
                    archivedAt: null,
                    OR: [
                      { title: { contains: search, mode: 'insensitive' } },
                      { subtitle: { contains: search, mode: 'insensitive' } },
                      { summary: { contains: search, mode: 'insensitive' } },
                      { slug: { contains: search, mode: 'insensitive' } },
                    ],
                  },
                },
              },
            },
            {
              episode: {
                localizations: {
                  some: {
                    archivedAt: null,
                    OR: [
                      { title: { contains: search, mode: 'insensitive' } },
                      { subtitle: { contains: search, mode: 'insensitive' } },
                      { summary: { contains: search, mode: 'insensitive' } },
                    ],
                  },
                },
              },
            },
          ],
        }
      : {}),
  };
}

function adminEntitlementWhere(
  query: ListAdminIpEntitlementsQuery,
): Prisma.IpContentEntitlementWhereInput {
  return {
    ipId: query.ipId,
    // Filter arrives as the encoded public id; entitlements store the raw id.
    userId: query.userId ? decodeUserId(query.userId) : undefined,
    targetType: query.targetType as IpTargetType | undefined,
    status: query.status as IpEntitlementStatus | undefined,
  };
}

type LocalizationBase = {
  locale: string;
  status: IpLocalizationStatus;
  archivedAt: Date | null;
  publishedAt?: Date | null;
  updatedAt?: Date;
};

type IpLocalizationLike = LocalizationBase & {
  slug: string | null;
  title: string;
  subtitle: string | null;
  summary: string;
  description: string | null;
  // Per-locale poster override; falls back to Ip.coverAsset when absent.
  coverAsset?: Parameters<typeof assetDto>[0];
};

type TaxonomyTermLocalizationLike = {
  locale: string;
  label: string;
  description: string | null;
  aliases: string[];
};

type TaxonomyAssignmentLike = {
  displayOrder: number;
  term: {
    id: string;
    type: IpTaxonomyTermType;
    code: string;
    status: IpTaxonomyTermStatus;
    localizations: TaxonomyTermLocalizationLike[];
  };
};

type IpTaxonomyHost = {
  sourceLocale: string;
  taxonomyAssignments: TaxonomyAssignmentLike[];
};

type EpisodeLocalizationLike = LocalizationBase & {
  title: string;
  subtitle: string | null;
  summary: string | null;
  description?: string | null;
};

type CampaignLocalizationLike = LocalizationBase & {
  name: string;
  description: string | null;
};

function normalizeLocale(locale?: string | null) {
  const raw = locale?.trim();
  if (!raw) return DEFAULT_IP_LOCALE;
  const parts = raw.split('-').filter(Boolean);
  if (parts.length === 0) return DEFAULT_IP_LOCALE;
  return [
    parts[0].toLowerCase(),
    ...parts
      .slice(1)
      .map((part) => (part.length === 2 ? part.toUpperCase() : part)),
  ].join('-');
}

function normalizeTaxonomyCodes(values: readonly string[], maxItems: number) {
  const normalized = values
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean)
    .filter((value) => /^[a-z0-9][a-z0-9_-]*$/.test(value))
    .map((value) => value.slice(0, 80));
  return Array.from(new Set(normalized)).slice(0, maxItems);
}

function normalizeAdminTaxonomyLocalizations(
  localizations: readonly {
    locale: string;
    label: string;
    description?: string | null;
    aliases?: readonly string[];
  }[],
) {
  const byLocale = new Map<
    string,
    {
      locale: string;
      label: string;
      description: string | null;
      aliases: string[];
    }
  >();

  for (const localization of localizations) {
    const locale = normalizeLocale(localization.locale);
    const label = localization.label.trim();
    if (!label) continue;
    byLocale.set(locale, {
      locale,
      label,
      description: localization.description?.trim() || null,
      aliases: Array.from(
        new Set(
          (localization.aliases ?? [])
            .map((alias) => alias.trim())
            .filter(Boolean),
        ),
      ).slice(0, 20),
    });
  }

  const normalized = Array.from(byLocale.values());
  if (!normalized.length) {
    throw new BadRequestException({
      code: 'IP_TAXONOMY_LOCALIZATION_REQUIRED',
      msg: 'At least one taxonomy localization is required.',
    });
  }
  return normalized;
}

function generateTaxonomyCode(
  type: IpTaxonomyTermType,
  localizations: ReturnType<typeof normalizeAdminTaxonomyLocalizations>,
) {
  const preferred =
    localizations.find((item) => item.locale === 'en-US')?.label ??
    localizations.find((item) => item.locale === DEFAULT_IP_LOCALE)?.label ??
    localizations[0]?.label ??
    type;
  const slug = preferred
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 48);
  if (slug) return slug;

  const digest = createHash('sha1')
    .update(`${type}:${preferred}`)
    .digest('hex')
    .slice(0, 12);
  return `${type}_${digest}`;
}

function publicIpRankBaseFilterSql(
  query: ListIpsQuery,
  viewerBlocks: ViewerBlockLists,
): Prisma.Sql {
  const genreFilter = query.genreCodes.length
    ? Prisma.sql`
        AND EXISTS (
          SELECT 1
          FROM ip_taxonomy_assignments genre_assignment
          JOIN ip_taxonomy_terms genre_term
            ON genre_term.id = genre_assignment.term_id
          WHERE genre_assignment.ip_id = ip.id
            AND genre_term.type::text = 'genre'
            AND genre_term.code IN (${Prisma.join(query.genreCodes)})
            AND genre_term.status::text = 'active'
            AND genre_term.archived_at IS NULL
        )
      `
    : Prisma.empty;
  const tagFilter = query.tagCodes.length
    ? Prisma.sql`
        AND EXISTS (
          SELECT 1
          FROM ip_taxonomy_assignments tag_assignment
          JOIN ip_taxonomy_terms tag_term
            ON tag_term.id = tag_assignment.term_id
          WHERE tag_assignment.ip_id = ip.id
            AND tag_term.type::text = 'tag'
            AND tag_term.code IN (${Prisma.join(query.tagCodes)})
            AND tag_term.status::text = 'active'
            AND tag_term.archived_at IS NULL
        )
      `
    : Prisma.empty;
  const regionFilter = query.regions.length
    ? Prisma.sql`AND ip.region IN (${Prisma.join(query.regions)})`
    : Prisma.empty;
  const blockedIpFilter = viewerBlocks.blockedIpIds.length
    ? Prisma.sql`AND ip.id::text NOT IN (${Prisma.join(viewerBlocks.blockedIpIds)})`
    : Prisma.empty;
  const blockedCreatorFilter = viewerBlocks.blockedCreatorIds.length
    ? Prisma.sql`AND ip.created_by_id NOT IN (${Prisma.join(viewerBlocks.blockedCreatorIds)})`
    : Prisma.empty;
  const searchNeedle = query.q?.trim();
  const searchFilter = searchNeedle
    ? (() => {
        const pattern = likeContainsPattern(searchNeedle);
        return Prisma.sql`
        AND (
          ip.room_number = ${searchNeedle}
          OR COALESCE(ip.copyright_owner, '') ILIKE ${pattern} ESCAPE '\\'
          OR EXISTS (
            SELECT 1
            FROM ip_localizations search_localization
            WHERE search_localization.ip_id = ip.id
              AND search_localization.archived_at IS NULL
              AND search_localization.status::text IN (${Prisma.join(PUBLIC_LOCALIZATION_STATUSES)})
              AND (
                search_localization.title ILIKE ${pattern} ESCAPE '\\'
                OR COALESCE(search_localization.subtitle, '') ILIKE ${pattern} ESCAPE '\\'
                OR search_localization.summary ILIKE ${pattern} ESCAPE '\\'
                OR COALESCE(search_localization.description, '') ILIKE ${pattern} ESCAPE '\\'
                OR COALESCE(search_localization.slug, '') ILIKE ${pattern} ESCAPE '\\'
              )
          )
          OR EXISTS (
            SELECT 1
            FROM ip_taxonomy_assignments search_assignment
            JOIN ip_taxonomy_terms search_term
              ON search_term.id = search_assignment.term_id
            LEFT JOIN ip_taxonomy_term_localizations search_term_loc
              ON search_term_loc.term_id = search_term.id
            WHERE search_assignment.ip_id = ip.id
              AND search_term.status::text = 'active'
              AND search_term.archived_at IS NULL
              AND (
                search_term.code ILIKE ${pattern} ESCAPE '\\'
                OR COALESCE(search_term_loc.label, '') ILIKE ${pattern} ESCAPE '\\'
              )
          )
        )
      `;
      })()
    : Prisma.empty;

  return Prisma.sql`
    ip.deleted_at IS NULL
    AND ip.status::text IN (${Prisma.join(PUBLIC_IP_STATUSES)})
    AND ip.listing_visibility::text = 'public'
    AND EXISTS (
      SELECT 1
      FROM ip_localizations localization
      WHERE localization.ip_id = ip.id
        AND localization.archived_at IS NULL
        AND localization.status::text IN (${Prisma.join(PUBLIC_LOCALIZATION_STATUSES)})
    )
    ${query.channelType ? Prisma.sql`AND ip.channel_type::text = ${query.channelType}` : Prisma.empty}
    ${genreFilter}
    ${tagFilter}
    ${regionFilter}
    ${searchFilter}
    ${blockedIpFilter}
    ${blockedCreatorFilter}
  `;
}

/** Escape `\`, `%`, `_` so user input is treated as a literal ILIKE substring. */
function likeContainsPattern(raw: string): string {
  return `%${raw.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_')}%`;
}

function ipTaxonomyFilterWhere(
  genreCodes?: readonly string[],
  tagCodes?: readonly string[],
): Prisma.IpWhereInput {
  const genreFilter = normalizeTaxonomyCodes(genreCodes ?? [], 8);
  const tagFilter = normalizeTaxonomyCodes(tagCodes ?? [], 20);
  const AND: Prisma.IpWhereInput[] = [];

  if (genreFilter.length) {
    AND.push({
      taxonomyAssignments: {
        some: {
          term: {
            is: {
              type: IpTaxonomyTermType.genre,
              code: { in: genreFilter },
              status: IpTaxonomyTermStatus.active,
              archivedAt: null,
            },
          },
        },
      },
    });
  }
  if (tagFilter.length) {
    AND.push({
      taxonomyAssignments: {
        some: {
          term: {
            is: {
              type: IpTaxonomyTermType.tag,
              code: { in: tagFilter },
              status: IpTaxonomyTermStatus.active,
              archivedAt: null,
            },
          },
        },
      },
    });
  }

  return AND.length ? { AND } : {};
}

async function replaceIpTaxonomyAssignmentsTx(
  tx: Prisma.TransactionClient,
  input: {
    ipId: string;
    type: IpTaxonomyTermType;
    codes: readonly string[];
    source: IpTaxonomyAssignmentSource;
    createdById: string;
  },
) {
  const maxItems = input.type === IpTaxonomyTermType.genre ? 8 : 20;
  const codes = normalizeTaxonomyCodes(input.codes, maxItems);

  if (input.type === IpTaxonomyTermType.genre && codes.length === 0) {
    throw new BadRequestException({
      code: 'IP_GENRE_REQUIRED',
      msg: 'Select at least one genre.',
    });
  }

  const terms = codes.length
    ? await tx.ipTaxonomyTerm.findMany({
        where: {
          type: input.type,
          status: IpTaxonomyTermStatus.active,
          archivedAt: null,
          code: { in: codes },
        },
        select: { id: true, code: true },
      })
    : [];
  const byCode = new Map(terms.map((term) => [term.code, term]));
  const missing = codes.filter((code) => !byCode.has(code));

  if (missing.length) {
    throw new BadRequestException({
      code: 'IP_TAXONOMY_TERM_INVALID',
      msg: `Invalid ${input.type} code(s): ${missing.join(', ')}.`,
      missing,
    });
  }

  const existing = await tx.ipTaxonomyAssignment.findMany({
    where: {
      ipId: input.ipId,
      term: {
        is: {
          type: input.type,
        },
      },
    },
    select: { id: true },
  });
  if (existing.length) {
    await tx.ipTaxonomyAssignment.deleteMany({
      where: { id: { in: existing.map((item) => item.id) } },
    });
  }

  if (!codes.length) return;

  await tx.ipTaxonomyAssignment.createMany({
    data: codes.map((code, index) => ({
      ipId: input.ipId,
      termId: byCode.get(code)!.id,
      source: input.source,
      displayOrder:
        input.type === IpTaxonomyTermType.tag ? 1000 + index : index,
      createdById: input.createdById,
    })),
    skipDuplicates: true,
  });
}

function localeCandidates(
  requestedLocale?: string | null,
  sourceLocale?: string | null,
) {
  const requested = normalizeLocale(requestedLocale);
  const source = normalizeLocale(sourceLocale);
  const baseLanguage = requested.split('-')[0];
  return Array.from(
    new Set([
      requested,
      baseLanguage,
      source,
      source.split('-')[0],
      DEFAULT_IP_LOCALE,
      DEFAULT_IP_LOCALE.split('-')[0],
    ]),
  ).filter(Boolean);
}

function localizationRank(status: IpLocalizationStatus) {
  switch (status) {
    case IpLocalizationStatus.published:
      return 0;
    case IpLocalizationStatus.approved:
      return 1;
    case IpLocalizationStatus.needs_review:
      return 2;
    case IpLocalizationStatus.machine_translated:
      return 3;
    case IpLocalizationStatus.draft:
      return 4;
    case IpLocalizationStatus.outdated:
      return 5;
    case IpLocalizationStatus.archived:
      return 6;
    default:
      return 99;
  }
}

function selectLocalization<T extends LocalizationBase>(
  localizations: T[] | undefined,
  requestedLocale?: string | null,
  sourceLocale?: string | null,
  publicOnly = false,
) {
  const requested = normalizeLocale(requestedLocale);
  const source = normalizeLocale(sourceLocale);
  const available = (localizations ?? []).filter(
    (item) =>
      !item.archivedAt &&
      // Public reads serve human-published localizations and machine translations
      // (the latter ranks below human via localizationRank, so a published locale
      // always wins when both exist).
      (!publicOnly ||
        item.status === IpLocalizationStatus.published ||
        item.status === IpLocalizationStatus.machine_translated),
  );
  const candidates = localeCandidates(requested, source);
  const selected =
    candidates
      .map((candidate) =>
        available.find(
          (item) => normalizeLocale(item.locale) === normalizeLocale(candidate),
        ),
      )
      .find(Boolean) ??
    [...available].sort((a, b) => {
      const statusDiff =
        localizationRank(a.status) - localizationRank(b.status);
      if (statusDiff !== 0) return statusDiff;
      return normalizeLocale(a.locale).localeCompare(normalizeLocale(b.locale));
    })[0] ??
    null;

  const availableLocales = Array.from(
    new Set(available.map((item) => normalizeLocale(item.locale))),
  );

  return {
    value: selected,
    meta: {
      requestedLocale: requested,
      locale: selected ? normalizeLocale(selected.locale) : source,
      sourceLocale: source,
      isFallback: !selected || normalizeLocale(selected.locale) !== requested,
      availableLocales,
      status: selected?.status ?? null,
    },
  };
}

function selectTaxonomyLocalization(
  localizations: TaxonomyTermLocalizationLike[] | undefined,
  requestedLocale?: string | null,
) {
  const requested = normalizeLocale(requestedLocale);
  const baseLanguage = requested.split('-')[0];
  const candidates = Array.from(
    new Set([requested, baseLanguage, 'en-US', DEFAULT_IP_LOCALE, 'zh-HK']),
  );
  const available = localizations ?? [];
  const selected =
    candidates
      .map((candidate) =>
        available.find(
          (item) => normalizeLocale(item.locale) === normalizeLocale(candidate),
        ),
      )
      .find(Boolean) ??
    available[0] ??
    null;

  return {
    value: selected,
    meta: {
      requestedLocale: requested,
      locale: selected ? normalizeLocale(selected.locale) : requested,
      sourceLocale: DEFAULT_IP_LOCALE,
      isFallback: !selected || normalizeLocale(selected.locale) !== requested,
      availableLocales: Array.from(
        new Set(available.map((item) => normalizeLocale(item.locale))),
      ),
      status: null,
    },
  };
}

function taxonomyTermDto(
  term: {
    id: string;
    type: IpTaxonomyTermType;
    code: string;
    status?: IpTaxonomyTermStatus;
    localizations: TaxonomyTermLocalizationLike[];
  },
  requestedLocale?: string | null,
) {
  const copy = selectTaxonomyLocalization(term.localizations, requestedLocale);
  return {
    id: term.id,
    type: term.type,
    code: term.code,
    label: copy.value?.label ?? term.code,
    description: copy.value?.description ?? null,
    aliases: copy.value?.aliases ?? [],
    localization: copy.meta,
  };
}

function adminTaxonomyTermDto(
  term: {
    id: string;
    type: IpTaxonomyTermType;
    code: string;
    status: IpTaxonomyTermStatus;
    displayOrder: number;
    archivedAt?: Date | null;
    createdAt?: Date;
    updatedAt?: Date;
    localizations: TaxonomyTermLocalizationLike[];
    _count?: {
      assignments: number;
    };
  },
  requestedLocale?: string | null,
) {
  return {
    ...taxonomyTermDto(term, requestedLocale),
    status: term.status,
    displayOrder: term.displayOrder,
    archivedAt: term.archivedAt?.toISOString() ?? null,
    createdAt: term.createdAt?.toISOString() ?? null,
    updatedAt: term.updatedAt?.toISOString() ?? null,
    assignmentCount: term._count?.assignments ?? 0,
    localizations: term.localizations.map((localization) => ({
      locale: normalizeLocale(localization.locale),
      label: localization.label,
      description: localization.description,
      aliases: localization.aliases,
    })),
  };
}

const discoveryAssetSelect = {
  id: true,
  kind: true,
  status: true,
  deletedAt: true,
  moderationStatus: true,
  storageProvider: true,
  bucket: true,
  region: true,
  objectKey: true,
  externalUrl: true,
  contentType: true,
  width: true,
  height: true,
  durationSeconds: true,
} satisfies Prisma.MediaAssetSelect;

const adminIpDiscoveryInclude = {
  ip: { include: { localizations: true } },
  localizations: { orderBy: { locale: 'asc' } },
  imageAsset: { select: discoveryAssetSelect },
  mobileImageAsset: { select: discoveryAssetSelect },
  trailerAsset: { select: discoveryAssetSelect },
} satisfies Prisma.IpDiscoveryRecommendationInclude;

type AdminIpDiscoveryRow = Prisma.IpDiscoveryRecommendationGetPayload<{
  include: typeof adminIpDiscoveryInclude;
}>;

// Public placements need the IP's native card data (cover, episode count,
// taxonomy) so non-hero placements (e.g. `ip_plaza_for_you`) — which carry no
// curated media of their own — can render the IP's own card on the plaza.
const publicIpDiscoveryInclude = {
  ip: { include: ipInclude },
  localizations: { orderBy: { locale: 'asc' } },
  imageAsset: { select: discoveryAssetSelect },
  mobileImageAsset: { select: discoveryAssetSelect },
  trailerAsset: { select: discoveryAssetSelect },
} satisfies Prisma.IpDiscoveryRecommendationInclude;

type PublicIpDiscoveryRow = Prisma.IpDiscoveryRecommendationGetPayload<{
  include: typeof publicIpDiscoveryInclude;
}>;

function normalizeDiscoveryLocalizations(
  localizations: readonly {
    locale: string;
    eyebrow?: string | null;
    title?: string | null;
    description?: string | null;
    ctaLabel?: string | null;
  }[],
) {
  return localizations.map((localization) => ({
    locale: normalizeLocale(localization.locale),
    eyebrow: localization.eyebrow?.trim() || null,
    title: localization.title?.trim() || null,
    description: localization.description?.trim() || null,
    ctaLabel: localization.ctaLabel?.trim() || null,
  }));
}

function assertDiscoveryEnablement(
  placementKey: string,
  status: string,
  data: {
    imageAssetId: string | null;
    localizations: readonly { title?: string | null }[];
    // Native fallbacks: a hero may omit a curated image/title and instead fall
    // back to the IP's own cover/title (the web renders ipCard when these are
    // absent).
    ipCoverReady?: boolean;
    ipHasTitle?: boolean;
  },
) {
  if (status !== IpDiscoveryRecommendationStatus.enabled) return;
  if (placementKey !== IpDiscoveryPlacementKey.ip_plaza_hero) return;
  if (!data.imageAssetId && !data.ipCoverReady) {
    throw new BadRequestException({
      code: 'IP_DISCOVERY_HERO_IMAGE_REQUIRED',
      msg: 'Enabled hero needs a default image, or the IP must have a ready cover.',
    });
  }
  const hasTitle =
    data.localizations.some((item) =>
      Boolean(item.title && item.title.trim()),
    ) || Boolean(data.ipHasTitle);
  if (!hasTitle) {
    throw new BadRequestException({
      code: 'IP_DISCOVERY_HERO_TITLE_REQUIRED',
      msg: 'Enabled hero needs a localized title, or the IP must have a title.',
    });
  }
}

function selectDiscoveryLocalization(
  localizations: AdminIpDiscoveryRow['localizations'],
  requestedLocale?: string | null,
) {
  if (!localizations.length) return null;
  const locale = normalizeLocale(requestedLocale);
  return (
    localizations.find((item) => normalizeLocale(item.locale) === locale) ??
    localizations[0]
  );
}

function isPublicDiscoveryRenderable(row: PublicIpDiscoveryRow) {
  if (row.placementKey !== IpDiscoveryPlacementKey.ip_plaza_hero) return true;
  const image = row.imageAsset;
  const imageReady =
    image &&
    image.status === MediaAssetStatus.ready &&
    !image.deletedAt &&
    image.moderationStatus !== 'blocked';
  // Fall back to the IP's native cover when no curated hero image is set.
  const ipCover = row.ip?.coverAsset;
  const ipCoverReady = Boolean(
    ipCover &&
    ipCover.status === MediaAssetStatus.ready &&
    !ipCover.deletedAt &&
    ipCover.moderationStatus !== 'blocked',
  );
  // A published IP always carries a localized title, so the title falls back to
  // the IP's own; a curated title is optional.
  const hasTitle =
    row.localizations.some((item) =>
      Boolean(item.title && item.title.trim()),
    ) || Boolean(row.ip);
  return Boolean((imageReady || ipCoverReady) && hasTitle);
}

function adminIpDiscoveryDto(
  rec: AdminIpDiscoveryRow,
  requestedLocale?: string | null,
) {
  return {
    id: rec.id,
    placementKey: rec.placementKey,
    status: rec.status,
    ipId: rec.ipId,
    ip: ipReferenceDto(rec.ip, requestedLocale),
    sortOrder: rec.sortOrder,
    startsAt: rec.startsAt?.toISOString() ?? null,
    endsAt: rec.endsAt?.toISOString() ?? null,
    imageAsset: assetDto(rec.imageAsset),
    mobileImageAsset: assetDto(rec.mobileImageAsset),
    trailerAsset: assetDto(rec.trailerAsset),
    metadata: rec.metadata,
    version: rec.version,
    createdById: rec.createdById,
    updatedById: rec.updatedById,
    createdAt: rec.createdAt.toISOString(),
    updatedAt: rec.updatedAt.toISOString(),
    archivedAt: rec.archivedAt?.toISOString() ?? null,
    localizations: rec.localizations.map((localization) => ({
      locale: normalizeLocale(localization.locale),
      eyebrow: localization.eyebrow,
      title: localization.title,
      description: localization.description,
      ctaLabel: localization.ctaLabel,
    })),
  };
}

function publicIpDiscoveryDto(
  rec: PublicIpDiscoveryRow,
  requestedLocale?: string | null,
  engagement?: IpEngagementStats,
) {
  const copy = selectDiscoveryLocalization(rec.localizations, requestedLocale);
  return {
    id: rec.id,
    placementKey: rec.placementKey,
    ipId: rec.ipId,
    ip: ipReferenceDto(rec.ip, requestedLocale),
    // Native IP card — drives non-hero placements (for-you rail) and enriches
    // the hero (episode count / genres) where the curated copy leaves gaps.
    ipCard: rec.ip
      ? ipDto(rec.ip, requestedLocale, undefined, engagement)
      : null,
    sortOrder: rec.sortOrder,
    eyebrow: copy?.eyebrow ?? null,
    title: copy?.title ?? null,
    description: copy?.description ?? null,
    ctaLabel: copy?.ctaLabel ?? null,
    image: assetDto(rec.imageAsset),
    mobileImage: assetDto(rec.mobileImageAsset),
    trailer: assetDto(rec.trailerAsset),
  };
}

function taxonomyBundleDto(
  ip: IpTaxonomyHost,
  requestedLocale?: string | null,
) {
  const items = (ip.taxonomyAssignments ?? [])
    .filter(
      (assignment) => assignment.term.status === IpTaxonomyTermStatus.active,
    )
    .map((assignment) => taxonomyTermDto(assignment.term, requestedLocale));
  const genres = items.filter((item) => item.type === IpTaxonomyTermType.genre);
  const tags = items.filter((item) => item.type === IpTaxonomyTermType.tag);

  return {
    genres: genres.map((item) => item.label),
    tags: tags.map((item) => item.label),
    genreCodes: genres.map((item) => item.code),
    tagCodes: tags.map((item) => item.code),
    taxonomy: {
      genres,
      tags,
    },
  };
}

function selectIpLocalization(
  ip: { sourceLocale: string; localizations: IpLocalizationLike[] },
  requestedLocale?: string | null,
  publicOnly = false,
) {
  return selectLocalization(
    ip.localizations,
    requestedLocale,
    ip.sourceLocale,
    publicOnly,
  );
}

function getIpPublicationRequirementMissing(ip: AdminIpWithCommerce) {
  const sourceLocale = normalizeLocale(ip.sourceLocale);
  const copy = selectIpLocalization(ip, sourceLocale, false).value;
  const rightsSummary = isRecord(ip.rightsSummary) ? ip.rightsSummary : {};
  const aiDisclosure = isRecord(ip.aiDisclosure) ? ip.aiDisclosure : {};
  const hasAiGeneratedContent =
    aiDisclosure.generatedVisuals === true ||
    aiDisclosure.generatedCopy === true;
  const missing: string[] = [];

  if (!copy?.title?.trim()) missing.push('title');
  if (!copy?.summary?.trim()) missing.push('short summary');
  if (!taxonomyBundleDto(ip, sourceLocale).genreCodes.length) {
    missing.push('genre');
  }
  if (!ip.coverAssetId && !ip.trailerAssetId) {
    missing.push('cover or trailer asset');
  }
  if (!ip.copyrightOwner?.trim()) missing.push('copyright owner');
  if (
    typeof rightsSummary.statement !== 'string' ||
    !rightsSummary.statement.trim()
  ) {
    missing.push('rights statement');
  }
  if (
    hasAiGeneratedContent &&
    (typeof aiDisclosure.statement !== 'string' ||
      !aiDisclosure.statement.trim())
  ) {
    missing.push('AI disclosure statement');
  }

  return missing;
}

function assertIpReadyForPublication(ip: AdminIpWithCommerce) {
  const missing = getIpPublicationRequirementMissing(ip);

  if (missing.length > 0) {
    throw new BadRequestException({
      code: 'IP_PUBLISH_REQUIREMENTS_NOT_MET',
      msg: `Complete publication requirements before publishing: ${missing.join(', ')}.`,
      missing,
    });
  }
}

function selectEpisodeLocalization(
  episode: { localizations: EpisodeLocalizationLike[] },
  requestedLocale?: string | null,
  publicOnly = false,
  sourceLocale = DEFAULT_IP_LOCALE,
) {
  return selectLocalization(
    episode.localizations,
    requestedLocale,
    sourceLocale,
    publicOnly,
  );
}

function selectCampaignLocalization(
  campaign: { localizations: CampaignLocalizationLike[] },
  requestedLocale?: string | null,
  publicOnly = false,
  sourceLocale = DEFAULT_IP_LOCALE,
) {
  return selectLocalization(
    campaign.localizations,
    requestedLocale,
    sourceLocale,
    publicOnly,
  );
}

function creatorIpContributorDto(contributor: {
  id: string;
  displayName: string;
  userId: string | null;
  role: IpContributorRole;
  customRole: string | null;
  revenueEligible: boolean;
  revenueShareBps: number | null;
  displayOrder: number;
}) {
  return {
    id: contributor.id,
    displayName: contributor.displayName,
    userId: contributor.userId,
    role: contributor.role,
    customRole: contributor.customRole,
    revenueEligible: contributor.revenueEligible,
    revenueShareBps: contributor.revenueShareBps,
    displayOrder: contributor.displayOrder,
  };
}

function creatorIpContributorListDto(input: {
  ip: { id: string; sourceLocale: string; localizations: IpLocalizationLike[] };
  effectiveShareBps: number;
  contributors: Parameters<typeof creatorIpContributorDto>[0][];
}) {
  const copy = selectIpLocalization(input.ip, input.ip.sourceLocale, false);
  const poolAllocatedBps = input.contributors
    .filter((c) => c.revenueEligible)
    .reduce((sum, c) => sum + (c.revenueShareBps ?? 0), 0);
  return {
    ip: { id: input.ip.id, title: copy.value?.title ?? input.ip.id },
    creatorShareBps: input.effectiveShareBps,
    poolAllocatedBps,
    contributors: input.contributors.map(creatorIpContributorDto),
  };
}

function ipAclGrantDto(grant: {
  id: string;
  ipId: string;
  userId: string;
  permission: IpAclPermission;
  grantedById: string;
  revokedById: string | null;
  createdAt: Date;
  updatedAt: Date;
  revokedAt: Date | null;
}) {
  return {
    id: grant.id,
    ipId: grant.ipId,
    userId: grant.userId,
    permission: grant.permission,
    grantedById: grant.grantedById,
    revokedById: grant.revokedById,
    createdAt: grant.createdAt.toISOString(),
    updatedAt: grant.updatedAt.toISOString(),
    revokedAt: grant.revokedAt?.toISOString() ?? null,
  };
}

function ipViewerAccessDto(
  title: Pick<AdminIpWithCommerce, 'createdById' | 'aclGrants'>,
  viewerUserId?: string | null,
) {
  const owner = Boolean(viewerUserId && title.createdById === viewerUserId);
  const hasEditGrant = Boolean(
    viewerUserId &&
    title.aclGrants.some(
      (grant) =>
        grant.userId === viewerUserId &&
        grant.permission === IpAclPermission.edit &&
        grant.revokedAt === null,
    ),
  );
  const canEdit = owner || hasEditGrant;
  return {
    owner,
    permissions: canEdit ? [IpAclPermission.edit] : [],
    canEdit,
    canManageAcl: owner,
    canTransferOwner: owner,
    canArchive: owner,
    canDelete: owner,
  };
}

function ipReferenceDto(
  ip:
    | {
        id: string;
        roomNumber: string;
        sourceLocale: string;
        status: IpPublicationStatus;
        listingVisibility: IpListingVisibility;
        channelType?: 'ip' | 'community';
        localizations: IpLocalizationLike[];
      }
    | null
    | undefined,
  requestedLocale?: string | null,
) {
  if (!ip) return null;
  const copy = selectIpLocalization(ip, requestedLocale, false);
  return {
    id: ip.id,
    roomNumber: ip.roomNumber,
    title: copy.value?.title ?? ip.id,
    status: ip.status,
    listingVisibility: ip.listingVisibility,
    channelType: ip.channelType ?? 'community',
    localization: copy.meta,
  };
}

function episodeReferenceDto(
  episode:
    | {
        id: string;
        episodeNo: number;
        status: IpPublicationStatus;
        localizations: EpisodeLocalizationLike[];
      }
    | null
    | undefined,
  requestedLocale?: string | null,
  sourceLocale = DEFAULT_IP_LOCALE,
) {
  if (!episode) return null;
  const copy = selectEpisodeLocalization(
    episode,
    requestedLocale,
    false,
    sourceLocale,
  );
  return {
    id: episode.id,
    episodeNo: episode.episodeNo,
    title: copy.value?.title ?? `Episode ${episode.episodeNo}`,
    status: episode.status,
    localization: copy.meta,
  };
}

function adminIpSummaryDto(
  title: AdminIpWithCommerce,
  requestedLocale?: string | null,
) {
  const activeBundlePrice = selectActivePrice(
    title.priceRules.filter((rule) => rule.targetType === IpTargetType.ip),
  );
  const activeEpisodePrices = title.episodes
    .map((episode) => selectActivePrice(episode.priceRules))
    .filter(Boolean);
  const copy = selectIpLocalization(title, requestedLocale, false);
  const taxonomy = taxonomyBundleDto(title, requestedLocale);
  return {
    id: title.id,
    roomNumber: title.roomNumber,
    channelType: title.channelType,
    slug: copy.value?.slug ?? null,
    title: copy.value?.title ?? title.id,
    subtitle: copy.value?.subtitle ?? null,
    summary: copy.value?.summary ?? '',
    localization: copy.meta,
    status: title.status,
    listingVisibility: title.listingVisibility,
    ageRating: title.ageRating,
    sourceLocale: title.sourceLocale,
    ...taxonomy,
    publishers: publishersFromAssignments(
      title.publisherAssignments,
      requestedLocale,
    ),
    version: title.version,
    coverAsset: assetDto(copy.value?.coverAsset ?? title.coverAsset),
    trailerAsset: assetDto(title.trailerAsset),
    scheduledAt: title.scheduledAt?.toISOString() ?? null,
    publishedAt: title.publishedAt?.toISOString() ?? null,
    suspendedAt: title.suspendedAt?.toISOString() ?? null,
    archivedAt: title.archivedAt?.toISOString() ?? null,
    createdAt: title.createdAt.toISOString(),
    updatedAt: title.updatedAt.toISOString(),
    counts: {
      episodes: title._count.episodes,
      assets: title._count.assets,
      campaigns: title._count.campaigns,
      priceRules: title._count.priceRules,
      purchaseOrders: title._count.purchaseOrders,
      entitlements: title._count.entitlements,
      contributors: title._count.contributors,
      reports: title._count.reports,
    },
    pricing: {
      bundle: activeBundlePrice ? adminPriceRuleDto(activeBundlePrice) : null,
      activeEpisodePriceCount: activeEpisodePrices.length,
      activePriceCount:
        (activeBundlePrice ? 1 : 0) + activeEpisodePrices.length,
    },
    review: {
      needsAttention:
        title.status === IpPublicationStatus.submitted ||
        title.status === IpPublicationStatus.in_review ||
        title.status === IpPublicationStatus.changes_requested ||
        title.status === IpPublicationStatus.approved,
      openReportCount: title.reports.filter(
        (report) =>
          report.status === IpReportStatus.submitted ||
          report.status === IpReportStatus.triaged,
      ).length,
    },
  };
}

function creatorIpSummaryDto(
  title: AdminIpWithCommerce,
  requestedLocale?: string | null,
  viewerUserId?: string | null,
) {
  const copy = selectIpLocalization(title, requestedLocale, false);
  const taxonomy = taxonomyBundleDto(title, requestedLocale);
  return {
    id: title.id,
    createdById: title.createdById,
    roomNumber: title.roomNumber,
    channelType: title.channelType,
    title: copy.value?.title ?? title.id,
    summary: copy.value?.summary ?? '',
    description: copy.value?.description ?? null,
    ...taxonomy,
    publishers: publishersFromAssignments(
      title.publisherAssignments,
      requestedLocale,
    ),
    localization: copy.meta,
    status: title.status,
    listingVisibility: title.listingVisibility,
    ageRating: title.ageRating,
    sourceLocale: title.sourceLocale,
    version: title.version,
    coverAsset: assetDto(copy.value?.coverAsset ?? title.coverAsset),
    trailerAsset: assetDto(title.trailerAsset),
    createdAt: title.createdAt.toISOString(),
    updatedAt: title.updatedAt.toISOString(),
    viewerAccess: ipViewerAccessDto(title, viewerUserId),
    counts: {
      episodes: title._count.episodes,
      assets: title._count.assets,
      campaigns: title._count.campaigns,
      priceRules: title._count.priceRules,
      reports: title._count.reports,
    },
  };
}

function creatorIpDetailDto(
  title: AdminIpWithCommerce,
  requestedLocale?: string | null,
  viewerUserId?: string | null,
) {
  const activeIpPrice = selectActivePrice(
    title.priceRules.filter((rule) => rule.targetType === IpTargetType.ip),
  );
  return {
    ...creatorIpSummaryDto(title, requestedLocale, viewerUserId),
    copyrightOwner: title.copyrightOwner,
    rightsSummary: title.rightsSummary,
    aiDisclosure: title.aiDisclosure,
    price: activeIpPrice ? priceRuleDto(activeIpPrice) : null,
    episodes: title.episodes.map((episode) => {
      const copy = selectEpisodeLocalization(
        episode,
        requestedLocale,
        false,
        title.sourceLocale,
      );
      const price = selectActivePrice(episode.priceRules);
      return {
        id: episode.id,
        episodeNo: episode.episodeNo,
        sortOrder: episode.sortOrder,
        status: episode.status,
        title: copy.value?.title ?? `Episode ${episode.episodeNo}`,
        subtitle: copy.value?.subtitle ?? null,
        summary: copy.value?.summary ?? null,
        localization: copy.meta,
        durationSeconds: episode.durationSeconds,
        isFreePreview: episode.isFreePreview,
        coverAsset: assetDto(episode.coverAsset),
        mediaAsset: assetDto(episode.mediaAsset),
        trailerAsset: assetDto(episode.trailerAsset),
        scheduledAt: episode.scheduledAt?.toISOString() ?? null,
        publishedAt: episode.publishedAt?.toISOString() ?? null,
        price: price ? priceRuleDto(price) : null,
      };
    }),
    campaigns: title.campaigns.map((campaign) =>
      adminCampaignDto(campaign, requestedLocale, title.sourceLocale),
    ),
    contributors: title.contributors.map((contributor) => ({
      id: contributor.id,
      userId: contributor.userId,
      displayName: contributor.displayName,
      role: contributor.role,
      customRole: contributor.customRole,
      isPublic: contributor.isPublic,
      displayOrder: contributor.displayOrder,
    })),
    assets: title.assets.map(ipAssetDto),
    priceRules: title.priceRules.map(adminPriceRuleDto),
  };
}

function adminIpDetailDto(
  title: AdminIpWithCommerce,
  requestedLocale?: string | null,
) {
  const titleCopy = selectIpLocalization(title, requestedLocale, false);
  return {
    ...adminIpSummaryDto(title, requestedLocale),
    description: titleCopy.value?.description ?? null,
    copyrightOwner: title.copyrightOwner,
    publishers: publishersFromAssignments(
      title.publisherAssignments,
      requestedLocale,
      { activeOnly: false },
    ),
    rightsSummary: title.rightsSummary,
    aiDisclosure: title.aiDisclosure,
    episodes: title.episodes.map((episode) => {
      const copy = selectEpisodeLocalization(
        episode,
        requestedLocale,
        false,
        title.sourceLocale,
      );
      return {
        id: episode.id,
        episodeNo: episode.episodeNo,
        sortOrder: episode.sortOrder,
        status: episode.status,
        title: copy.value?.title ?? `Episode ${episode.episodeNo}`,
        subtitle: copy.value?.subtitle ?? null,
        summary: copy.value?.summary ?? null,
        localization: copy.meta,
        durationSeconds: episode.durationSeconds,
        isFreePreview: episode.isFreePreview,
        coverAsset: assetDto(episode.coverAsset),
        mediaAsset: assetDto(episode.mediaAsset),
        trailerAsset: assetDto(episode.trailerAsset),
        scheduledAt: episode.scheduledAt?.toISOString() ?? null,
        publishedAt: episode.publishedAt?.toISOString() ?? null,
        suspendedAt: episode.suspendedAt?.toISOString() ?? null,
        archivedAt: episode.archivedAt?.toISOString() ?? null,
        counts: {
          purchaseOrders: episode._count.purchaseOrders,
          entitlements: episode._count.entitlements,
          reports: episode._count.reports,
        },
        priceRules: episode.priceRules.map(adminPriceRuleDto),
      };
    }),
    priceRules: title.priceRules.map(adminPriceRuleDto),
    assets: title.assets.map(ipAssetDto),
    campaigns: title.campaigns.map((campaign) =>
      adminCampaignDto(campaign, requestedLocale, title.sourceLocale),
    ),
    contributors: title.contributors.map((contributor) => ({
      id: contributor.id,
      userId: contributor.userId,
      displayName: contributor.displayName,
      role: contributor.role,
      customRole: contributor.customRole,
      isPublic: contributor.isPublic,
      displayOrder: contributor.displayOrder,
    })),
    reports: title.reports.map((report) =>
      adminReportDto(report, requestedLocale),
    ),
    recentOrders: title.purchaseOrders.map(purchaseOrderDto),
  };
}

function adminPriceRuleDto(rule: {
  id: string;
  targetType: IpTargetType;
  status: IpPriceRuleStatus;
  currency: WalletCurrencyType;
  amount: bigint;
  originalAmount: bigint | null;
  campaignId: string | null;
  priority: number;
  startsAt: Date | null;
  endsAt: Date | null;
  unlocksAt: Date | null;
  maxPerUser: number | null;
}) {
  return {
    id: rule.id,
    targetType: rule.targetType,
    status: rule.status,
    currency: rule.currency,
    amount: rule.amount.toString(),
    originalAmount: rule.originalAmount?.toString() ?? null,
    campaignId: rule.campaignId,
    priority: rule.priority,
    startsAt: rule.startsAt?.toISOString() ?? null,
    endsAt: rule.endsAt?.toISOString() ?? null,
    unlocksAt: rule.unlocksAt?.toISOString() ?? null,
    maxPerUser: rule.maxPerUser,
  };
}

function adminCampaignDto(
  campaign: {
    id: string;
    campaignType: string;
    status: IpCampaignStatus;
    code: string;
    localizations: CampaignLocalizationLike[];
    startsAt: Date | null;
    endsAt: Date | null;
    unlocksAt: Date | null;
  },
  requestedLocale?: string | null,
  sourceLocale = DEFAULT_IP_LOCALE,
) {
  const copy = selectCampaignLocalization(
    campaign,
    requestedLocale,
    false,
    sourceLocale,
  );
  return {
    id: campaign.id,
    campaignType: campaign.campaignType,
    status: campaign.status,
    code: campaign.code,
    name: copy.value?.name ?? campaign.code,
    description: copy.value?.description ?? null,
    localization: copy.meta,
    startsAt: campaign.startsAt?.toISOString() ?? null,
    endsAt: campaign.endsAt?.toISOString() ?? null,
    unlocksAt: campaign.unlocksAt?.toISOString() ?? null,
  };
}

function adminReviewDto(
  review: {
    id: string;
    targetType: string;
    targetId: string;
    ipId: string | null;
    episodeId: string | null;
    status: IpReviewStatus;
    changeSummary: string | null;
    submittedById: string;
    reviewerId: string | null;
    submittedAt: Date;
    ip: {
      id: string;
      roomNumber: string;
      sourceLocale: string;
      status: IpPublicationStatus;
      listingVisibility: IpListingVisibility;
      channelType?: 'ip' | 'community';
      localizations: IpLocalizationLike[];
    } | null;
    episode: {
      id: string;
      episodeNo: number;
      status: IpPublicationStatus;
      localizations: EpisodeLocalizationLike[];
    } | null;
  },
  requestedLocale?: string | null,
) {
  const sourceLocale = review.ip?.sourceLocale ?? DEFAULT_IP_LOCALE;
  return {
    id: review.id,
    targetType: review.targetType,
    targetId: review.targetId,
    ipId: review.ipId,
    episodeId: review.episodeId,
    status: review.status,
    changeSummary: review.changeSummary,
    submittedById: review.submittedById,
    reviewerId: review.reviewerId,
    submittedAt: review.submittedAt.toISOString(),
    ip: ipReferenceDto(review.ip, requestedLocale),
    episode: episodeReferenceDto(review.episode, requestedLocale, sourceLocale),
  };
}

function adminReportDto(
  report: {
    id: string;
    targetType: IpTargetType;
    targetId: string;
    ipId: string | null;
    episodeId: string | null;
    reporterUserId: string | null;
    purchaseOrderId: string | null;
    reason: string;
    status: IpReportStatus;
    description: string | null;
    resolvedById: string | null;
    resolutionNote: string | null;
    createdAt: Date;
    resolvedAt: Date | null;
    ip?: {
      id: string;
      roomNumber: string;
      sourceLocale: string;
      status: IpPublicationStatus;
      listingVisibility: IpListingVisibility;
      localizations: IpLocalizationLike[];
    } | null;
    episode?: {
      id: string;
      episodeNo: number;
      status: IpPublicationStatus;
      localizations: EpisodeLocalizationLike[];
    } | null;
  },
  requestedLocale?: string | null,
) {
  const sourceLocale = report.ip?.sourceLocale ?? DEFAULT_IP_LOCALE;
  return {
    id: report.id,
    targetType: report.targetType,
    targetId: report.targetId,
    ipId: report.ipId,
    episodeId: report.episodeId,
    reporterUserId: report.reporterUserId,
    purchaseOrderId: report.purchaseOrderId,
    reason: report.reason,
    status: report.status,
    description: report.description,
    resolvedById: report.resolvedById,
    resolutionNote: report.resolutionNote,
    createdAt: report.createdAt.toISOString(),
    resolvedAt: report.resolvedAt?.toISOString() ?? null,
    ip: ipReferenceDto(report.ip, requestedLocale),
    episode: episodeReferenceDto(report.episode, requestedLocale, sourceLocale),
  };
}

function defaultVisibilityForStatus(
  status: IpPublicationStatus,
  current: IpListingVisibility,
) {
  if (
    status === IpPublicationStatus.published ||
    status === IpPublicationStatus.scheduled
  ) {
    return IpListingVisibility.public;
  }
  if (
    status === IpPublicationStatus.hidden ||
    status === IpPublicationStatus.suspended ||
    status === IpPublicationStatus.archived ||
    status === IpPublicationStatus.draft
  ) {
    return IpListingVisibility.private;
  }
  return current;
}

async function syncIpLocalizationStatusForPublication(
  tx: Prisma.TransactionClient,
  ipId: string,
  status: IpPublicationStatus,
) {
  const localizationStatus =
    status === IpPublicationStatus.published ||
    status === IpPublicationStatus.scheduled
      ? IpLocalizationStatus.published
      : status === IpPublicationStatus.approved
        ? IpLocalizationStatus.approved
        : status === IpPublicationStatus.submitted ||
            status === IpPublicationStatus.in_review ||
            status === IpPublicationStatus.changes_requested
          ? IpLocalizationStatus.needs_review
          : null;

  if (!localizationStatus) return;
  await tx.ipLocalization.updateMany({
    where: {
      ipId,
      archivedAt: null,
    },
    data: {
      status: localizationStatus,
    },
  });
}

/** In-flight episode statuses that should follow the IP when admin publishes.
 *  Intentionally excludes `hidden` / `suspended` / `archived` (operator or
 *  creator chose to keep them off) and already-live `published` / `scheduled`. */
const EPISODE_STATUSES_PROMOTED_ON_IP_PUBLICATION: IpPublicationStatus[] = [
  IpPublicationStatus.draft,
  IpPublicationStatus.submitted,
  IpPublicationStatus.in_review,
  IpPublicationStatus.changes_requested,
  IpPublicationStatus.approved,
];

export function episodeStatusForIpPublication(
  ipStatus: IpPublicationStatus,
): IpPublicationStatus | null {
  if (ipStatus === IpPublicationStatus.published) {
    return IpPublicationStatus.published;
  }
  if (ipStatus === IpPublicationStatus.scheduled) {
    return IpPublicationStatus.scheduled;
  }
  if (ipStatus === IpPublicationStatus.approved) {
    return IpPublicationStatus.approved;
  }
  return null;
}

async function syncIpEpisodeStatusForPublication(
  tx: Prisma.TransactionClient,
  ipId: string,
  status: IpPublicationStatus,
  opts: { now: Date; scheduledAt: Date | null },
) {
  const nextEpisodeStatus = episodeStatusForIpPublication(status);
  if (!nextEpisodeStatus) return;

  const localizationStatus =
    nextEpisodeStatus === IpPublicationStatus.published ||
    nextEpisodeStatus === IpPublicationStatus.scheduled
      ? IpLocalizationStatus.published
      : IpLocalizationStatus.approved;

  const episodes = await tx.ipEpisode.findMany({
    where: {
      ipId,
      deletedAt: null,
      status: { in: EPISODE_STATUSES_PROMOTED_ON_IP_PUBLICATION },
    },
    select: { id: true, publishedAt: true },
  });
  if (episodes.length === 0) return;

  const episodeIds = episodes.map((episode) => episode.id);
  await tx.ipEpisodeLocalization.updateMany({
    where: {
      episodeId: { in: episodeIds },
      archivedAt: null,
    },
    data: { status: localizationStatus },
  });

  for (const episode of episodes) {
    await tx.ipEpisode.update({
      where: { id: episode.id },
      data: {
        status: nextEpisodeStatus,
        ...(nextEpisodeStatus === IpPublicationStatus.published
          ? { publishedAt: episode.publishedAt ?? opts.now }
          : {}),
        ...(nextEpisodeStatus === IpPublicationStatus.scheduled
          ? { scheduledAt: opts.scheduledAt }
          : {}),
        version: { increment: 1 },
      },
    });
  }
}

async function settleIpReviewSubmissionsForPublication(
  tx: Prisma.TransactionClient,
  input: {
    ipId: string;
    reviewerId: string;
    status: IpPublicationStatus;
    reason: string;
    now: Date;
  },
) {
  const status =
    input.status === IpPublicationStatus.approved ||
    input.status === IpPublicationStatus.scheduled ||
    input.status === IpPublicationStatus.published
      ? IpReviewStatus.approved
      : input.status === IpPublicationStatus.changes_requested
        ? IpReviewStatus.changes_requested
        : input.status === IpPublicationStatus.hidden ||
            input.status === IpPublicationStatus.suspended ||
            input.status === IpPublicationStatus.archived
          ? IpReviewStatus.rejected
          : input.status === IpPublicationStatus.in_review
            ? IpReviewStatus.in_review
            : null;
  if (!status) return;

  const eventType =
    status === IpReviewStatus.approved
      ? IpReviewEventType.approved
      : status === IpReviewStatus.changes_requested
        ? IpReviewEventType.changes_requested
        : status === IpReviewStatus.rejected
          ? IpReviewEventType.rejected
          : IpReviewEventType.assigned;

  const submissions = await tx.ipReviewSubmission.findMany({
    where: {
      targetType: IpReviewTargetType.ip,
      ipId: input.ipId,
      status: {
        in: [
          IpReviewStatus.submitted,
          IpReviewStatus.in_review,
          IpReviewStatus.changes_requested,
        ],
      },
    },
    select: { id: true },
  });
  if (!submissions.length) return;

  const reviewPatch: Prisma.IpReviewSubmissionUpdateManyMutationInput = {
    status,
    reviewerId: input.reviewerId,
  };
  if (status !== IpReviewStatus.in_review) {
    reviewPatch.reviewedAt = input.now;
    reviewPatch.decisionReason = input.reason;
  }

  await tx.ipReviewSubmission.updateMany({
    where: { id: { in: submissions.map((item) => item.id) } },
    data: reviewPatch,
  });

  for (const submission of submissions) {
    await tx.ipReviewEvent.create({
      data: {
        submissionId: submission.id,
        eventType,
        actorUserId: input.reviewerId,
        message: input.reason,
      },
    });
  }
}

function moderationActionForPublicationStatus(status: IpPublicationStatus) {
  if (
    status === IpPublicationStatus.approved ||
    status === IpPublicationStatus.scheduled ||
    status === IpPublicationStatus.published
  ) {
    return IpModerationActionType.approve;
  }
  if (status === IpPublicationStatus.hidden) return IpModerationActionType.hide;
  if (status === IpPublicationStatus.suspended) {
    return IpModerationActionType.suspend_sales;
  }
  if (status === IpPublicationStatus.archived) {
    return IpModerationActionType.takedown;
  }
  if (status === IpPublicationStatus.changes_requested) {
    return IpModerationActionType.reject;
  }
  return IpModerationActionType.restore;
}

function ipPublicationPatchForModeration(
  actionType: IpModerationActionType,
  now: Date,
): Prisma.IpUpdateInput {
  if (actionType === IpModerationActionType.hide) {
    return {
      status: IpPublicationStatus.hidden,
      listingVisibility: IpListingVisibility.private,
      version: { increment: 1 },
    };
  }
  if (actionType === IpModerationActionType.suspend_sales) {
    return {
      status: IpPublicationStatus.suspended,
      listingVisibility: IpListingVisibility.private,
      suspendedAt: now,
      version: { increment: 1 },
    };
  }
  if (actionType === IpModerationActionType.takedown) {
    return {
      status: IpPublicationStatus.archived,
      listingVisibility: IpListingVisibility.private,
      archivedAt: now,
      version: { increment: 1 },
    };
  }
  if (
    actionType === IpModerationActionType.restore ||
    actionType === IpModerationActionType.approve ||
    actionType === IpModerationActionType.age_gate ||
    actionType === IpModerationActionType.region_block
  ) {
    return {
      status: IpPublicationStatus.approved,
      listingVisibility: IpListingVisibility.unlisted,
      suspendedAt: null,
      version: { increment: 1 },
    };
  }
  return {
    status: IpPublicationStatus.changes_requested,
    listingVisibility: IpListingVisibility.private,
    version: { increment: 1 },
  };
}

function episodePublicationPatchForModeration(
  actionType: IpModerationActionType,
  now: Date,
): Prisma.IpEpisodeUpdateInput {
  if (actionType === IpModerationActionType.hide) {
    return {
      status: IpPublicationStatus.hidden,
      version: { increment: 1 },
    };
  }
  if (actionType === IpModerationActionType.suspend_sales) {
    return {
      status: IpPublicationStatus.suspended,
      suspendedAt: now,
      version: { increment: 1 },
    };
  }
  if (actionType === IpModerationActionType.takedown) {
    return {
      status: IpPublicationStatus.archived,
      archivedAt: now,
      version: { increment: 1 },
    };
  }
  if (
    actionType === IpModerationActionType.restore ||
    actionType === IpModerationActionType.approve ||
    actionType === IpModerationActionType.age_gate ||
    actionType === IpModerationActionType.region_block
  ) {
    return {
      status: IpPublicationStatus.approved,
      suspendedAt: null,
      version: { increment: 1 },
    };
  }
  return {
    status: IpPublicationStatus.changes_requested,
    version: { increment: 1 },
  };
}

function moderationSnapshot(entity: unknown): Record<string, unknown> {
  if (!isRecord(entity)) return {};
  const keys = [
    'id',
    'status',
    'listingVisibility',
    'scheduledAt',
    'publishedAt',
    'suspendedAt',
    'archivedAt',
    'version',
  ];
  return Object.fromEntries(
    keys
      .filter((key) => key in entity)
      .map((key) => {
        const value = entity[key];
        return [key, value instanceof Date ? value.toISOString() : value];
      }),
  );
}

function creatorReviewSnapshot(
  ip: AdminIpWithCommerce,
): Record<string, unknown> {
  const sourceCopy = selectIpLocalization(ip, ip.sourceLocale, false).value;
  const taxonomy = taxonomyBundleDto(ip, ip.sourceLocale);
  return {
    id: ip.id,
    status: ip.status,
    listingVisibility: ip.listingVisibility,
    ageRating: ip.ageRating,
    sourceLocale: ip.sourceLocale,
    title: sourceCopy?.title ?? null,
    summary: sourceCopy?.summary ?? null,
    description: sourceCopy?.description ?? null,
    genreCodes: taxonomy.genreCodes,
    tagCodes: taxonomy.tagCodes,
    version: ip.version,
    coverAssetId: ip.coverAssetId,
    trailerAssetId: ip.trailerAssetId,
    episodeCount: ip._count.episodes,
    priceRuleCount: ip._count.priceRules,
    submittedAt: new Date().toISOString(),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Localized display name for an IP's region code, from the hand-curated table
 * in @repo/shared — deliberately NOT Intl.DisplayNames, so sensitive region
 * naming stays under our editorial control (decision 2026-07-04). Unknown
 * codes render as the raw code. Additive payload field: released mobile
 * builds ignore it; newer clients prefer it.
 */
function regionDisplayLabel(
  region: string | null | undefined,
  requestedLocale?: string | null,
): string | null {
  const code = region?.trim().toUpperCase();
  if (!code) return null;
  return sharedRegionLabel(code, requestedLocale?.trim() || 'en-US');
}

/**
 * Display-owner fallback chain: the authored copyright line wins; otherwise
 * credit the creator via their public contributor snapshot. Derived purely
 * from data the DTO already ships (no live Java user lookup — public list
 * endpoints must not depend on session-scoped calls or extra fan-out), so
 * guest viewers see a real name instead of "anonymous creator" whenever the
 * optional copyright field was never filled. A private creator credit is
 * never leaked; the display simply keeps its client-side fallback.
 */
export function resolveIpOwnerName(title: {
  copyrightOwner?: string | null;
  createdById?: string | null;
  contributors: ReadonlyArray<{
    userId: string | null;
    displayName: string;
    isPublic: boolean;
  }>;
}): string | null {
  const owner = title.copyrightOwner?.trim();
  if (owner) return owner;
  if (!title.createdById) return null;
  const creator = title.contributors.find(
    (contributor) =>
      contributor.userId === title.createdById && contributor.isPublic,
  );
  return creator?.displayName?.trim() || null;
}

function ipDto(
  title: IpWithCommerce,
  requestedLocale?: string | null,
  // Entitlement-gated playback: when omitted (list / discovery / unauthenticated
  // detail) only free + free-preview episodes expose their playable media. When
  // provided, additionally expose media the viewer has unlocked.
  mediaAccess?: { ipOwned: boolean; ownedEpisodeIds: ReadonlySet<string> },
  engagement: IpEngagementStats = emptyIpEngagementStats(),
) {
  const activeIpPrice = selectActivePrice(
    title.priceRules.filter((rule) => rule.targetType === IpTargetType.ip),
  );
  const ipPaid = Boolean(activeIpPrice);
  const copy = selectIpLocalization(title, requestedLocale, true);
  const taxonomy = taxonomyBundleDto(title, requestedLocale);
  const publicEngagement = publicIpEngagementDto(engagement);
  return {
    id: title.id,
    roomNumber: title.roomNumber,
    channelType: title.channelType,
    slug: copy.value?.slug ?? null,
    status: title.status,
    listingVisibility: title.listingVisibility,
    ageRating: title.ageRating,
    region: title.region ?? null,
    regionLabel: regionDisplayLabel(title.region, requestedLocale),
    title: copy.value?.title ?? title.id,
    subtitle: copy.value?.subtitle ?? null,
    summary: copy.value?.summary ?? '',
    description: copy.value?.description ?? null,
    sourceLocale: title.sourceLocale,
    localization: copy.meta,
    ...taxonomy,
    // Display-ready owner line: the authored copyright text, else the
    // creator's public credit (see resolveIpOwnerName). Clients render
    // this directly before any "anonymous" fallback.
    copyrightOwner: resolveIpOwnerName(title),
    createdById: title.createdById,
    contributors: title.contributors.map((contributor) => ({
      id: contributor.id,
      userId: contributor.userId,
      displayName: contributor.displayName,
      role: contributor.role,
      customRole: contributor.customRole,
      isPublic: contributor.isPublic,
      displayOrder: contributor.displayOrder,
    })),
    publishers: publishersFromAssignments(
      title.publisherAssignments,
      requestedLocale,
    ),
    rightsSummary: title.rightsSummary,
    aiDisclosure: title.aiDisclosure,
    coverAsset: assetDto(copy.value?.coverAsset ?? title.coverAsset),
    trailerAsset: assetDto(title.trailerAsset),
    publishedAt: title.publishedAt?.toISOString() ?? null,
    scheduledAt: title.scheduledAt?.toISOString() ?? null,
    viewCount: publicEngagement.viewCount,
    likeCount: publicEngagement.likeCount,
    collectionCount: publicEngagement.collectionCount,
    viewerHasLiked: publicEngagement.viewerHasLiked,
    engagement: publicEngagement,
    price: activeIpPrice ? priceRuleDto(activeIpPrice) : null,
    campaigns: title.campaigns.map((campaign) => {
      const campaignCopy = selectCampaignLocalization(
        campaign,
        requestedLocale,
        true,
        title.sourceLocale,
      );
      return {
        id: campaign.id,
        campaignType: campaign.campaignType,
        status: campaign.status,
        code: campaign.code,
        name: campaignCopy.value?.name ?? campaign.code,
        localization: campaignCopy.meta,
        startsAt: campaign.startsAt?.toISOString() ?? null,
        endsAt: campaign.endsAt?.toISOString() ?? null,
        unlocksAt: campaign.unlocksAt?.toISOString() ?? null,
      };
    }),
    episodes: title.episodes.map((episode) => {
      const price = selectActivePrice(episode.priceRules);
      const episodeCopy = selectEpisodeLocalization(
        episode,
        requestedLocale,
        true,
        title.sourceLocale,
      );
      // Withhold the playable asset for paid, non-preview episodes the viewer
      // hasn't unlocked — server-side gate so a leaked/guessed URL in the
      // payload can't bypass the paywall. Cover + trailer (promotional) remain.
      const mediaUnlocked =
        !(Boolean(price) || ipPaid) ||
        episode.isFreePreview ||
        (mediaAccess?.ipOwned ?? false) ||
        (mediaAccess?.ownedEpisodeIds.has(episode.id) ?? false);
      return {
        id: episode.id,
        episodeNo: episode.episodeNo,
        sortOrder: episode.sortOrder,
        status: episode.status,
        title: episodeCopy.value?.title ?? `Episode ${episode.episodeNo}`,
        subtitle: episodeCopy.value?.subtitle ?? null,
        summary: episodeCopy.value?.summary ?? null,
        localization: episodeCopy.meta,
        durationSeconds: episode.durationSeconds,
        isFreePreview: episode.isFreePreview,
        mediaLocked: !mediaUnlocked,
        coverAsset: assetDto(episode.coverAsset),
        mediaAsset: mediaUnlocked ? assetDto(episode.mediaAsset) : null,
        trailerAsset: assetDto(episode.trailerAsset),
        scheduledAt: episode.scheduledAt?.toISOString() ?? null,
        publishedAt: episode.publishedAt?.toISOString() ?? null,
        price: price ? priceRuleDto(price) : null,
      };
    }),
  };
}

function selectActivePrice<
  T extends {
    status: IpPriceRuleStatus;
    archivedAt: Date | null;
    currency: WalletCurrencyType;
    startsAt: Date | null;
    endsAt: Date | null;
    priority: number;
    amount: bigint;
  },
>(rules: T[], now = new Date()): T | null {
  return (
    rules
      .filter(
        (rule) =>
          rule.status === IpPriceRuleStatus.active &&
          !rule.archivedAt &&
          rule.currency === WalletCurrencyType.community_point &&
          (!rule.startsAt || rule.startsAt <= now) &&
          (!rule.endsAt || rule.endsAt > now),
      )
      .sort(
        (a, b) => b.priority - a.priority || Number(a.amount - b.amount),
      )[0] ?? null
  );
}

function priceRuleDto(
  rule: {
    id: string;
    targetType: IpTargetType;
    currency: WalletCurrencyType;
    amount: bigint;
    originalAmount: bigint | null;
    memberDiscountBps?: number | null;
    campaignId: string | null;
    startsAt: Date | null;
    endsAt: Date | null;
    unlocksAt: Date | null;
    maxPerUser: number | null;
  },
  // Supplied only for a community-member viewer — surfaces the discounted price
  // the member would actually be charged. Omitted = no member fields (the default
  // for every public / non-member caller, keeping their output unchanged).
  memberCtx?: { defaultBps: number },
) {
  const effectiveMemberBps =
    memberCtx && rule.amount > 0n
      ? clampBps(rule.memberDiscountBps ?? memberCtx.defaultBps)
      : 0;
  const memberAmount =
    effectiveMemberBps > 0
      ? applyMemberDiscount(rule.amount, effectiveMemberBps)
      : null;
  return {
    id: rule.id,
    targetType: rule.targetType,
    currency: rule.currency,
    amount: rule.amount.toString(),
    originalAmount: rule.originalAmount?.toString() ?? null,
    memberAmount: memberAmount?.toString() ?? null,
    memberDiscountBps: memberAmount != null ? effectiveMemberBps : null,
    campaignId: rule.campaignId,
    startsAt: rule.startsAt?.toISOString() ?? null,
    endsAt: rule.endsAt?.toISOString() ?? null,
    unlocksAt: rule.unlocksAt?.toISOString() ?? null,
    maxPerUser: rule.maxPerUser,
  };
}

function priceSnapshot(rule: {
  id: string;
  targetType: IpTargetType;
  currency: WalletCurrencyType;
  amount: bigint;
  originalAmount: bigint | null;
  campaignId: string | null;
  startsAt: Date | null;
  endsAt: Date | null;
  unlocksAt: Date | null;
}) {
  return priceRuleDto({
    ...rule,
    maxPerUser: null,
  });
}

function purchaseOrderDto(order: {
  id: string;
  orderNo: string;
  status: IpPurchaseOrderStatus;
  userId: string;
  ipId: string;
  episodeId: string | null;
  targetType: IpTargetType;
  currency: WalletCurrencyType;
  priceAmount: bigint;
  discountAmount: bigint;
  totalAmount: bigint;
  priceRuleId: string | null;
  campaignId: string | null;
  referralLinkId: string | null;
  walletTransactionId: string | null;
  paidAt: Date | null;
  fulfilledAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: order.id,
    orderNo: order.orderNo,
    status: order.status,
    // Encoded public id out; the order row keeps the raw id.
    userId: encodeUserId(order.userId),
    ipId: order.ipId,
    episodeId: order.episodeId,
    targetType: order.targetType,
    currency: order.currency,
    priceAmount: order.priceAmount.toString(),
    discountAmount: order.discountAmount.toString(),
    totalAmount: order.totalAmount.toString(),
    priceRuleId: order.priceRuleId,
    campaignId: order.campaignId,
    referralLinkId: order.referralLinkId,
    walletTransactionId: order.walletTransactionId,
    paidAt: order.paidAt?.toISOString() ?? null,
    fulfilledAt: order.fulfilledAt?.toISOString() ?? null,
    createdAt: order.createdAt.toISOString(),
    updatedAt: order.updatedAt.toISOString(),
  };
}

function entitlementDto(entitlement: {
  id: string;
  userId: string;
  ipId: string;
  episodeId: string | null;
  targetType: IpTargetType;
  status: IpEntitlementStatus;
  sourceType: string;
  sourceId: string;
  startsAt: Date;
  endsAt: Date | null;
}) {
  return {
    id: entitlement.id,
    // Encoded public id out; the entitlement row keeps the raw id.
    userId: encodeUserId(entitlement.userId),
    ipId: entitlement.ipId,
    episodeId: entitlement.episodeId,
    targetType: entitlement.targetType,
    status: entitlement.status,
    sourceType: entitlement.sourceType,
    sourceId: entitlement.sourceId,
    startsAt: entitlement.startsAt.toISOString(),
    endsAt: entitlement.endsAt?.toISOString() ?? null,
  };
}

function commercePurchaseOrderDto(
  order: CommerceOrderWithRefs,
  requestedLocale?: string | null,
) {
  return {
    ...purchaseOrderDto(order),
    ip: ipReferenceDto(order.ip, requestedLocale),
    episode: episodeReferenceDto(
      order.episode,
      requestedLocale,
      order.ip.sourceLocale,
    ),
    entitlementCount: order.entitlements.length,
  };
}

function commerceEntitlementDto(
  entitlement: CommerceEntitlementWithRefs,
  requestedLocale?: string | null,
) {
  return {
    ...entitlementDto(entitlement),
    sourceOrderId: entitlement.sourceOrderId,
    sourceOrderNo: entitlement.sourceOrder?.orderNo ?? null,
    ip: ipReferenceDto(entitlement.ip, requestedLocale),
    episode: episodeReferenceDto(
      entitlement.episode,
      requestedLocale,
      entitlement.ip.sourceLocale,
    ),
    createdAt: entitlement.createdAt.toISOString(),
    updatedAt: entitlement.updatedAt.toISOString(),
    revokedAt: entitlement.revokedAt?.toISOString() ?? null,
  };
}

function ipCommerceHealthDto(ip: AdminIpWithCommerce) {
  const activeBundlePrice = selectActivePrice(
    ip.priceRules.filter((rule) => rule.targetType === IpTargetType.ip),
  );
  const publishedEpisodes = ip.episodes.filter((episode) =>
    PUBLIC_EPISODE_STATUSES.includes(episode.status),
  );
  const activeEpisodePriceCount = ip.episodes.filter((episode) =>
    Boolean(selectActivePrice(episode.priceRules)),
  ).length;
  const pricedEpisodeCount = publishedEpisodes.filter((episode) =>
    Boolean(selectActivePrice(episode.priceRules)),
  ).length;
  const freePreviewEpisodeCount = publishedEpisodes.filter(
    (episode) => episode.isFreePreview,
  ).length;
  const warnings: Array<{
    code: string;
    severity: 'blocker' | 'warning';
    message: string;
  }> = [];

  if (
    ip.listingVisibility !== IpListingVisibility.public ||
    !PUBLIC_IP_STATUSES.includes(ip.status)
  ) {
    warnings.push({
      code: 'not_public',
      severity: 'warning',
      message: 'IP is not publicly listed, so buyers cannot discover it.',
    });
  }
  if (!ip.episodes.length) {
    warnings.push({
      code: 'no_episodes',
      severity: 'warning',
      message: 'No episodes have been created for this IP.',
    });
  } else if (!publishedEpisodes.length) {
    warnings.push({
      code: 'no_published_episodes',
      severity: 'warning',
      message: 'No episode is published or scheduled for public playback.',
    });
  }
  if (!activeBundlePrice && activeEpisodePriceCount === 0) {
    warnings.push({
      code: 'no_active_price',
      severity: 'blocker',
      message: 'No active bundle or episode price is available for purchase.',
    });
  }
  if (
    publishedEpisodes.length > 1 &&
    !activeBundlePrice &&
    pricedEpisodeCount > 0
  ) {
    warnings.push({
      code: 'missing_bundle_price',
      severity: 'warning',
      message: 'Episode prices exist, but there is no IP bundle price.',
    });
  }
  if (
    publishedEpisodes.length > 0 &&
    freePreviewEpisodeCount === publishedEpisodes.length &&
    !activeBundlePrice &&
    activeEpisodePriceCount === 0
  ) {
    warnings.push({
      code: 'all_free_preview',
      severity: 'warning',
      message: 'All public episodes are free previews and no paid path exists.',
    });
  }

  return {
    status: warnings.some((warning) => warning.severity === 'blocker')
      ? 'blocked'
      : warnings.length
        ? 'attention'
        : 'ready',
    bundlePriceActive: Boolean(activeBundlePrice),
    activeEpisodePriceCount,
    pricedEpisodeCount,
    publishedEpisodeCount: publishedEpisodes.length,
    freePreviewEpisodeCount,
    warnings,
  };
}

function ipAssetDto(asset: {
  id: string;
  purpose: string;
  title: string | null;
  description: string | null;
  displayOrder: number;
  createdAt: Date;
  updatedAt: Date;
  mediaAsset: Parameters<typeof assetDto>[0];
}) {
  return {
    id: asset.id,
    purpose: asset.purpose,
    title: asset.title,
    description: asset.description,
    displayOrder: asset.displayOrder,
    createdAt: asset.createdAt.toISOString(),
    updatedAt: asset.updatedAt.toISOString(),
    asset: assetDto(asset.mediaAsset),
  };
}

function assetDto(
  asset: {
    id: string;
    kind: string;
    storageProvider: string;
    bucket: string | null;
    region: string | null;
    objectKey: string | null;
    externalUrl: string | null;
    contentType: string;
    // Required moderation-gate fields — a narrowed select that omits any of
    // these is a compile error (see GatedMediaAsset), closing the whole class
    // of "forgot to select moderationStatus → blocked asset leaks" bugs.
    status: string | null;
    deletedAt: Date | null;
    moderationStatus: string | null;
    width: number | null;
    height: number | null;
    durationSeconds: number | null;
    // Optional: when the query loads them (video relations via
    // mediaAssetPlaybackInclude), a ready HLS variant is preferred over the mp4.
    variants?: ResolvableMediaAssetVariant[];
  } | null,
) {
  if (!asset) return null;
  // Single source of truth for "asset → playable URL or null" (gate + build):
  // prefers a ready ABR-HLS variant, falls back to the original mp4.
  const playback = resolveMediaPlaybackUrl(asset);
  return {
    id: asset.id,
    kind: asset.kind,
    storageProvider: asset.storageProvider,
    bucket: asset.bucket,
    region: asset.region,
    objectKey: asset.objectKey,
    externalUrl: asset.externalUrl,
    url: playback.url,
    contentType: playback.contentType ?? asset.contentType,
    width: asset.width,
    height: asset.height,
    durationSeconds: asset.durationSeconds,
  };
}

function sanitizeFilename(value: string) {
  const clean = value
    .trim()
    .replace(/[/\\?%*:|"<>]/g, '-')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  return clean || 'upload.bin';
}

/**
 * The source-material ipAsset title was previously the uploaded filename. The
 * file no longer reaches this server, so derive a stable title from the
 * server-decided storage key's basename (UUID prefix stripped where present),
 * falling back to a neutral label.
 */
function deriveAssetTitle(objectKey: string | null): string {
  if (!objectKey) return 'Source material';
  const base = objectKey.split('/').pop() ?? '';
  const stripped = base.replace(
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-/i,
    '',
  );
  return sanitizeFilename(stripped || base) || 'Source material';
}

function userBlockDto(block: {
  id: string;
  userId: string;
  targetType: IpUserBlockTargetType;
  targetId: string;
  ipId: string | null;
  reason: string | null;
  createdAt: Date;
  unblockedAt: Date | null;
}) {
  return {
    id: block.id,
    userId: block.userId,
    targetType: block.targetType,
    targetId: block.targetId,
    ipId: block.ipId,
    reason: block.reason,
    createdAt: block.createdAt.toISOString(),
    unblockedAt: block.unblockedAt?.toISOString() ?? null,
  };
}

function emptyIpEngagementStats(): IpEngagementStats {
  return {
    viewCount: 0,
    likeCount: 0,
    collectionCount: 0,
    humanViewCount: 0,
    agentViewCount: 0,
    humanLikeCount: 0,
    agentLikeCount: 0,
    viewerHasLiked: false,
  };
}

function publicIpEngagementDto(engagement: IpEngagementStats) {
  return {
    viewCount: engagement.viewCount,
    likeCount: engagement.likeCount,
    collectionCount: engagement.collectionCount,
    viewerHasLiked: engagement.viewerHasLiked,
  };
}

function bigintCount(value: bigint | number | null | undefined): number {
  if (value == null) return 0;
  const numeric = typeof value === 'bigint' ? Number(value) : value;
  return Number.isFinite(numeric) && numeric > 0 ? numeric : 0;
}

function isUniqueViolation(err: unknown): boolean {
  return (
    err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002'
  );
}

function createIpOrderNo(): string {
  const stamp = new Date()
    .toISOString()
    .replace(/[-:TZ.]/g, '')
    .slice(0, 14);
  return `IP${stamp}${randomUUID().replace(/-/g, '').slice(0, 10).toUpperCase()}`;
}
