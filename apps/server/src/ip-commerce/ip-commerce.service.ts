import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  BillingSiteRegion,
  BillingSubjectType,
  IpCampaignStatus,
  IpContentType,
  IpCommerceTargetType,
  IpCollectionItemStatus,
  IpEntitlementStatus,
  IpImportEntityType,
  IpImportSourceSystem,
  IpListingVisibility,
  IpModerationActionType,
  IpModerationTargetType,
  IpPriceRuleStatus,
  IpPublicationStatus,
  IpPurchaseOrderStatus,
  IpReportStatus,
  IpReferralLinkStatus,
  IpRevenueLedgerEntryType,
  IpRevenueLedgerStatus,
  IpRevenueRuleStatus,
  IpReviewStatus,
  IpUserBlockTargetType,
  Prisma,
  WalletAccountStatus,
  WalletCurrencyType,
  WalletLedgerEntryType,
  WalletOwnerType,
  WalletTransactionStatus,
} from '@prisma/client';
import { randomUUID } from 'crypto';
import type { AuthUser } from '../auth';
import { PrismaService } from '../infra/db/db.module';
import { WalletLedgerService } from '../workspaces';
import type {
  CreateIpContentReportInput,
  CreateIpPurchaseInput,
  IpLegacyTitleQuery,
  IpTitleAccessQuery,
  ListAdminIpTitlesQuery,
  ListIpTitlesQuery,
  ResolveAdminIpReportInput,
  UpdateAdminIpTitlePublicationInput,
  UpsertIpUserBlockInput,
} from './dto';

const PUBLIC_TITLE_STATUSES: IpPublicationStatus[] = [
  IpPublicationStatus.scheduled,
  IpPublicationStatus.published,
];
const PUBLIC_EPISODE_STATUSES: IpPublicationStatus[] = [
  IpPublicationStatus.scheduled,
  IpPublicationStatus.published,
];

const titleInclude = {
  coverAsset: true,
  heroAsset: true,
  trailerAsset: true,
  episodes: {
    where: {
      deletedAt: null,
      status: { in: PUBLIC_EPISODE_STATUSES },
    },
    orderBy: [{ sortOrder: 'asc' }, { episodeNo: 'asc' }],
    include: {
      coverAsset: true,
      trailerAsset: true,
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
  },
} satisfies Prisma.IpTitleInclude;

type TitleWithCommerce = Prisma.IpTitleGetPayload<{
  include: typeof titleInclude;
}>;

const adminTitleInclude = {
  coverAsset: true,
  heroAsset: true,
  trailerAsset: true,
  episodes: {
    where: { deletedAt: null },
    orderBy: [{ sortOrder: 'asc' }, { episodeNo: 'asc' }],
    include: {
      coverAsset: true,
      mediaAsset: true,
      trailerAsset: true,
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
  priceRules: {
    where: { archivedAt: null },
    orderBy: [{ status: 'asc' }, { priority: 'desc' }, { amount: 'asc' }],
  },
  campaigns: {
    where: { archivedAt: null },
    orderBy: [{ startsAt: 'asc' }, { createdAt: 'desc' }],
  },
  contributors: {
    where: { removedAt: null },
    orderBy: [{ displayOrder: 'asc' }, { createdAt: 'asc' }],
  },
  revenueRules: {
    where: { archivedAt: null },
    orderBy: [{ createdAt: 'asc' }],
    include: { contributor: true },
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
      campaigns: true,
      priceRules: true,
      purchaseOrders: true,
      entitlements: true,
      contributors: true,
      reports: true,
    },
  },
} satisfies Prisma.IpTitleInclude;

type AdminTitleWithCommerce = Prisma.IpTitleGetPayload<{
  include: typeof adminTitleInclude;
}>;

@Injectable()
export class IpCommerceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly walletLedger: WalletLedgerService,
  ) {}

  async getAdminOverview(query: ListAdminIpTitlesQuery) {
    const siteRegion = query.siteRegion ?? siteRegionFromEnv();
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const titleWhere = adminTitleWhere(query);

    const [
      totalTitles,
      publishedTitles,
      pendingReviewTitles,
      activePriceRules,
      openReports,
      recentOrders,
      revenue,
      reviewQueue,
      reports,
      recentTitles,
    ] = await Promise.all([
      this.prisma.ipTitle.count({ where: titleWhere }),
      this.prisma.ipTitle.count({
        where: {
          ...titleWhere,
          status: {
            in: [IpPublicationStatus.scheduled, IpPublicationStatus.published],
          },
          listingVisibility: IpListingVisibility.public,
        },
      }),
      this.prisma.ipTitle.count({
        where: {
          ...titleWhere,
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
          siteRegion,
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
          siteRegion,
          createdAt: { gte: sevenDaysAgo },
        },
        orderBy: { createdAt: 'desc' },
        take: 8,
      }),
      this.prisma.ipRevenueLedgerEntry.aggregate({
        where: {
          status: IpRevenueLedgerStatus.posted,
          postedAt: { gte: sevenDaysAgo },
        },
        _sum: { amount: true },
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
        take: 8,
        include: {
          ipTitle: {
            select: {
              id: true,
              title: true,
              status: true,
              listingVisibility: true,
            },
          },
          episode: {
            select: {
              id: true,
              episodeNo: true,
              title: true,
              status: true,
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
          ipTitle: {
            select: {
              id: true,
              title: true,
              status: true,
              listingVisibility: true,
            },
          },
          episode: {
            select: {
              id: true,
              episodeNo: true,
              title: true,
              status: true,
            },
          },
        },
      }),
      this.prisma.ipTitle.findMany({
        where: titleWhere,
        include: adminTitleInclude,
        orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
        take: 8,
      }),
    ]);

    return {
      siteRegion,
      generatedAt: new Date().toISOString(),
      metrics: {
        totalTitles,
        publishedTitles,
        pendingReviewTitles,
        activePriceRules,
        openReports,
        ordersLast7Days: recentOrders.length,
        revenueCreditsLast7Days: (revenue._sum.amount ?? 0n).toString(),
      },
      reviewQueue: reviewQueue.map(adminReviewDto),
      reports: reports.map(adminReportDto),
      recentTitles: recentTitles.map((title) =>
        adminTitleSummaryDto(title, siteRegion),
      ),
      recentOrders: recentOrders.map(purchaseOrderDto),
    };
  }

  async listAdminTitles(query: ListAdminIpTitlesQuery) {
    const siteRegion = query.siteRegion ?? siteRegionFromEnv();
    const rows = await this.prisma.ipTitle.findMany({
      where: adminTitleWhere(query),
      cursor: query.cursor ? { id: query.cursor } : undefined,
      skip: query.cursor ? 1 : 0,
      include: adminTitleInclude,
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
      take: query.limit + 1,
    });

    const items = rows.slice(0, query.limit);
    return {
      siteRegion,
      items: items.map((title) => adminTitleSummaryDto(title, siteRegion)),
      nextCursor: rows.length > query.limit ? (items.at(-1)?.id ?? null) : null,
    };
  }

  async getAdminTitle(titleId: string) {
    const siteRegion = siteRegionFromEnv();
    const title = await this.prisma.ipTitle.findFirst({
      where: { id: titleId, deletedAt: null },
      include: adminTitleInclude,
    });
    if (!title) {
      throw new NotFoundException({
        code: 'IP_TITLE_NOT_FOUND',
        msg: 'IP title not found.',
      });
    }
    return { title: adminTitleDetailDto(title, siteRegion) };
  }

  async updateAdminTitlePublication(
    user: AuthUser,
    titleId: string,
    input: UpdateAdminIpTitlePublicationInput,
  ) {
    const title = await this.prisma.ipTitle.findFirst({
      where: { id: titleId, deletedAt: null },
    });
    if (!title) {
      throw new NotFoundException({
        code: 'IP_TITLE_NOT_FOUND',
        msg: 'IP title not found.',
      });
    }

    const now = new Date();
    const nextStatus = input.status as IpPublicationStatus;
    const scheduledAt =
      input.scheduledAt === null
        ? null
        : (input.scheduledAt ?? title.scheduledAt);
    if (nextStatus === IpPublicationStatus.scheduled) {
      if (!scheduledAt) {
        throw new BadRequestException({
          code: 'IP_TITLE_SCHEDULE_REQUIRED',
          msg: 'scheduledAt is required when scheduling an IP title.',
        });
      }
      if (scheduledAt <= now) {
        throw new BadRequestException({
          code: 'IP_TITLE_SCHEDULE_IN_PAST',
          msg: 'scheduledAt must be in the future.',
        });
      }
    }

    const nextVisibility =
      input.listingVisibility ??
      defaultVisibilityForStatus(nextStatus, title.listingVisibility);
    const actionType = moderationActionForPublicationStatus(nextStatus);
    const updateResult = await this.prisma.ipTitle.updateMany({
      where: {
        id: title.id,
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
            ? (title.publishedAt ?? now)
            : title.publishedAt,
        suspendedAt:
          nextStatus === IpPublicationStatus.suspended
            ? (title.suspendedAt ?? now)
            : nextStatus === IpPublicationStatus.approved ||
                nextStatus === IpPublicationStatus.published
              ? null
              : title.suspendedAt,
        archivedAt:
          nextStatus === IpPublicationStatus.archived
            ? (title.archivedAt ?? now)
            : title.archivedAt,
        updatedById: user.userId,
        version: { increment: 1 },
      },
    });
    if (updateResult.count !== 1) {
      throw new ConflictException({
        code: 'IP_TITLE_VERSION_CONFLICT',
        msg: 'IP title was updated by another operator. Refresh and retry.',
      });
    }

    const updated = await this.prisma.ipTitle.findUniqueOrThrow({
      where: { id: title.id },
      include: adminTitleInclude,
    });
    await this.prisma.ipModerationAction.create({
      data: {
        targetType: IpModerationTargetType.title,
        targetId: title.id,
        actionType,
        actorUserId: user.userId,
        reason: input.reason,
        before: moderationSnapshot(title) as Prisma.InputJsonValue,
        after: moderationSnapshot(updated) as Prisma.InputJsonValue,
        startsAt:
          nextStatus === IpPublicationStatus.scheduled ? scheduledAt : null,
        metadata: {
          source: 'admin_ip_commerce_publication',
        },
      },
    });

    return { title: adminTitleDetailDto(updated, siteRegionFromEnv()) };
  }

  async resolveAdminReport(
    user: AuthUser,
    reportId: string,
    input: ResolveAdminIpReportInput,
  ) {
    const report = await this.prisma.ipContentReport.findUnique({
      where: { id: reportId },
      include: {
        ipTitle: true,
        episode: true,
      },
    });
    if (!report) {
      throw new NotFoundException({
        code: 'IP_REPORT_NOT_FOUND',
        msg: 'IP report not found.',
      });
    }

    const now = new Date();
    const actionType = input.actionType as IpModerationActionType | undefined;
    if (actionType) {
      await this.applyModerationAction(user, report, actionType, {
        reason: input.reason ?? input.resolutionNote ?? 'Report resolved.',
        now,
      });
    }

    const updated = await this.prisma.ipContentReport.update({
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
        ipTitle: {
          select: {
            id: true,
            title: true,
            status: true,
            listingVisibility: true,
          },
        },
        episode: {
          select: {
            id: true,
            episodeNo: true,
            title: true,
            status: true,
          },
        },
      },
    });

    return { report: adminReportDto(updated) };
  }

  async listPublicTitles(query: ListIpTitlesQuery, user?: AuthUser) {
    const siteRegion = query.siteRegion ?? siteRegionFromEnv();
    const viewerBlockWhere = await this.viewerBlockWhere(user);
    const cursor = query.cursor
      ? await this.prisma.ipTitle.findUnique({
          where: { id: query.cursor },
          select: { publishedAt: true, createdAt: true },
        })
      : null;
    const cursorDate = cursor?.publishedAt ?? cursor?.createdAt ?? null;

    const rows = await this.prisma.ipTitle.findMany({
      where: {
        deletedAt: null,
        status: { in: PUBLIC_TITLE_STATUSES },
        listingVisibility: 'public',
        contentType: query.contentType,
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
      include: titleInclude,
      orderBy: [
        { publishedAt: { sort: 'desc', nulls: 'last' } },
        { createdAt: 'desc' },
      ],
      take: query.limit + 1,
    });

    const items = rows.slice(0, query.limit);
    return {
      items: items.map((title) => titleDto(title, siteRegion)),
      nextCursor: rows.length > query.limit ? (items.at(-1)?.id ?? null) : null,
    };
  }

  async getPublicTitle(titleId: string, user?: AuthUser) {
    const siteRegion = siteRegionFromEnv();
    const viewerBlockWhere = await this.viewerBlockWhere(user);
    const title = await this.prisma.ipTitle.findFirst({
      where: {
        id: titleId,
        deletedAt: null,
        status: { in: PUBLIC_TITLE_STATUSES },
        listingVisibility: { in: ['public', 'unlisted'] },
        ...viewerBlockWhere,
      },
      include: titleInclude,
    });
    if (!title) {
      throw new NotFoundException({
        code: 'IP_TITLE_NOT_FOUND',
        msg: 'IP title not found.',
      });
    }
    return { title: titleDto(title, siteRegion) };
  }

  async getPublicTitleByImportSource(
    input: Pick<IpLegacyTitleQuery, 'sourceSystem' | 'siteRegion'> & {
      sourceEntityId: string;
    },
  ) {
    const siteRegion = input.siteRegion ?? siteRegionFromEnv();
    const importMap = await this.prisma.ipImportMap.findFirst({
      where: {
        sourceSystem: input.sourceSystem as IpImportSourceSystem,
        sourceEntityType: IpImportEntityType.title,
        sourceEntityId: input.sourceEntityId,
        targetTitleId: { not: null },
      },
      include: {
        targetTitle: {
          include: titleInclude,
        },
      },
    });
    const targetTitle = importMap?.targetTitle;
    if (
      !importMap ||
      !targetTitle ||
      targetTitle.deletedAt ||
      !PUBLIC_TITLE_STATUSES.includes(targetTitle.status) ||
      !['public', 'unlisted'].includes(targetTitle.listingVisibility)
    ) {
      throw new NotFoundException({
        code: 'IP_LEGACY_TITLE_NOT_FOUND',
        msg: 'Migrated IP title was not found.',
      });
    }

    return {
      importMap: {
        id: importMap.id,
        sourceSystem: importMap.sourceSystem,
        sourceEntityType: importMap.sourceEntityType,
        sourceEntityId: importMap.sourceEntityId,
        targetTitleId: importMap.targetTitleId,
        lastImportedAt: importMap.lastImportedAt.toISOString(),
      },
      title: titleDto(targetTitle, siteRegion),
    };
  }

  async getTitleAccess(
    user: AuthUser | undefined,
    titleId: string,
    query: IpTitleAccessQuery,
  ) {
    const siteRegion = query.siteRegion ?? siteRegionFromEnv();
    const now = new Date();
    const viewerBlockWhere = await this.viewerBlockWhere(user);
    const title = await this.prisma.ipTitle.findFirst({
      where: {
        id: titleId,
        deletedAt: null,
        status: { in: PUBLIC_TITLE_STATUSES },
        listingVisibility: { in: ['public', 'unlisted'] },
        ...viewerBlockWhere,
      },
      include: titleInclude,
    });
    if (!title) {
      throw new NotFoundException({
        code: 'IP_TITLE_NOT_FOUND',
        msg: 'IP title not found.',
      });
    }

    const requestedEpisodeIds = new Set(query.episodeIds);
    const episodes =
      requestedEpisodeIds.size > 0
        ? title.episodes.filter((episode) =>
            requestedEpisodeIds.has(episode.id),
          )
        : title.episodes;

    const titlePrice = selectActivePrice(
      title.priceRules.filter(
        (rule) => rule.targetType === IpCommerceTargetType.title,
      ),
      siteRegion,
      now,
    );
    const entitlements = user
      ? await this.prisma.ipContentEntitlement.findMany({
          where: {
            subjectType: BillingSubjectType.user,
            subjectId: user.userId,
            titleId,
            status: IpEntitlementStatus.active,
            OR: [{ endsAt: null }, { endsAt: { gt: now } }],
          },
        })
      : [];
    const titleEntitlement = entitlements.find(
      (entitlement) =>
        entitlement.targetType === IpCommerceTargetType.title &&
        entitlement.episodeId === null,
    );
    const ownedEpisodeIds = new Set(
      entitlements
        .filter(
          (entitlement) =>
            entitlement.targetType === IpCommerceTargetType.episode,
        )
        .map((entitlement) => entitlement.episodeId)
        .filter(Boolean) as string[],
    );
    const communityPointAccount = user
      ? await this.prisma.walletAccount.findUnique({
          where: {
            ownerType_ownerId_currency: {
              ownerType: WalletOwnerType.user,
              ownerId: user.userId,
              currency: WalletCurrencyType.community_point,
            },
          },
        })
      : null;

    return {
      authenticated: Boolean(user),
      wallet: communityPointAccount
        ? {
            currency: communityPointAccount.currency,
            status: communityPointAccount.status,
            availableBalance: communityPointAccount.availableBalance.toString(),
            heldBalance: communityPointAccount.heldBalance.toString(),
          }
        : null,
      title: {
        id: title.id,
        owned: Boolean(titleEntitlement),
        access: titleEntitlement ? 'owned' : titlePrice ? 'locked' : 'free',
        price: titlePrice ? priceRuleDto(titlePrice) : null,
      },
      episodes: episodes.map((episode) => {
        const episodePrice = selectActivePrice(
          episode.priceRules,
          siteRegion,
          now,
        );
        const owned =
          Boolean(titleEntitlement) || ownedEpisodeIds.has(episode.id);
        const access = owned
          ? titleEntitlement
            ? 'owned_title'
            : 'owned_episode'
          : episode.isFreePreview
            ? 'free_preview'
            : episodePrice
              ? 'locked'
              : titlePrice
                ? 'locked_bundle'
                : 'free';
        return {
          id: episode.id,
          episodeNo: episode.episodeNo,
          owned,
          access,
          price: episodePrice ? priceRuleDto(episodePrice) : null,
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
    return {
      accounts: accounts.map((account) => ({
        id: account.id,
        ownerType: account.ownerType,
        ownerId: account.ownerId,
        currency: account.currency,
        status: account.status,
        availableBalance: account.availableBalance.toString(),
        heldBalance: account.heldBalance.toString(),
        updatedAt: account.updatedAt.toISOString(),
      })),
    };
  }

  async listUserCollection(user: AuthUser) {
    const items = await this.prisma.ipCollectionItem.findMany({
      where: {
        userId: user.userId,
        status: IpCollectionItemStatus.active,
        removedAt: null,
      },
      include: {
        ipTitle: {
          include: {
            coverAsset: true,
            heroAsset: true,
            trailerAsset: true,
          },
        },
        episode: {
          include: {
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
      items: items.map((item) => ({
        id: item.id,
        targetType: item.targetType,
        status: item.status,
        addedAt: item.addedAt.toISOString(),
        lastViewedAt: item.lastViewedAt?.toISOString() ?? null,
        title: {
          id: item.ipTitle.id,
          title: item.ipTitle.title,
          subtitle: item.ipTitle.subtitle,
          coverAsset: assetDto(item.ipTitle.coverAsset),
          heroAsset: assetDto(item.ipTitle.heroAsset),
        },
        episode: item.episode
          ? {
              id: item.episode.id,
              episodeNo: item.episode.episodeNo,
              title: item.episode.title,
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
      })),
    };
  }

  async purchaseContent(user: AuthUser, input: CreateIpPurchaseInput) {
    const siteRegion = input.siteRegion ?? siteRegionFromEnv();
    const now = new Date();

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

      const title = await tx.ipTitle.findFirst({
        where: {
          id: input.titleId,
          deletedAt: null,
          status: { in: PUBLIC_TITLE_STATUSES },
          listingVisibility: { in: ['public', 'unlisted'] },
        },
      });
      if (!title) {
        throw new NotFoundException({
          code: 'IP_TITLE_NOT_PURCHASABLE',
          msg: 'IP title is not available for purchase.',
        });
      }

      const episode =
        input.targetType === 'episode'
          ? await tx.ipEpisode.findFirst({
              where: {
                id: input.episodeId,
                titleId: input.titleId,
                deletedAt: null,
                status: { in: PUBLIC_EPISODE_STATUSES },
              },
            })
          : null;
      if (input.targetType === 'episode' && !episode) {
        throw new NotFoundException({
          code: 'IP_EPISODE_NOT_PURCHASABLE',
          msg: 'IP episode is not available for purchase.',
        });
      }

      const existingEntitlement = await findActiveEntitlementTx(tx, {
        userId: user.userId,
        titleId: input.titleId,
        targetType: input.targetType,
        episodeId: input.episodeId ?? null,
        now,
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

      const priceRule = await this.resolvePriceRuleTx(tx, {
        titleId: input.titleId,
        episodeId: input.episodeId ?? null,
        targetType: input.targetType,
        siteRegion,
        priceRuleId: input.priceRuleId,
        now,
      });
      await this.assertMaxPerUserTx(tx, priceRule, user.userId);

      const referralLink = input.referralCode
        ? await this.resolveReferralLinkTx(tx, {
            code: input.referralCode,
            titleId: input.titleId,
            episodeId: input.episodeId ?? null,
            now,
          })
        : null;

      const order = await tx.ipPurchaseOrder.create({
        data: {
          orderNo: createIpOrderNo(),
          userId: user.userId,
          workspaceId: title.workspaceId,
          subjectType: BillingSubjectType.user,
          subjectId: user.userId,
          titleId: title.id,
          episodeId: episode?.id ?? null,
          targetType: input.targetType,
          status: IpPurchaseOrderStatus.pending,
          siteRegion,
          priceRuleId: priceRule.id,
          campaignId: priceRule.campaignId,
          referralLinkId:
            referralLink && referralLink.userId !== user.userId
              ? referralLink.id
              : null,
          currency: priceRule.currency,
          priceAmount: priceRule.amount,
          discountAmount:
            priceRule.originalAmount &&
            priceRule.originalAmount > priceRule.amount
              ? priceRule.originalAmount - priceRule.amount
              : 0n,
          totalAmount: priceRule.amount,
          priceSnapshot: priceSnapshot(priceRule) as Prisma.InputJsonValue,
          idempotencyKey: input.idempotencyKey,
          metadata: {
            title: { id: title.id, title: title.title },
            episode: episode
              ? {
                  id: episode.id,
                  episodeNo: episode.episodeNo,
                  title: episode.title,
                }
              : null,
          },
        },
      });

      const walletTransaction =
        priceRule.amount > 0n
          ? await debitCommunityPointTx(tx, {
              userId: user.userId,
              amount: priceRule.amount,
              orderId: order.id,
              orderNo: order.orderNo,
              workspaceId: title.workspaceId,
            })
          : null;

      const entitlement = await tx.ipContentEntitlement.upsert({
        where: {
          sourceType_sourceId: {
            sourceType: 'ip_purchase_order',
            sourceId: order.id,
          },
        },
        create: {
          subjectType: BillingSubjectType.user,
          subjectId: user.userId,
          titleId: title.id,
          episodeId: episode?.id ?? null,
          targetType: input.targetType,
          status: IpEntitlementStatus.active,
          sourceType: 'ip_purchase_order',
          sourceId: order.id,
          sourceOrderId: order.id,
          startsAt: now,
          endsAt:
            priceRule.unlocksAt && priceRule.unlocksAt > now
              ? priceRule.unlocksAt
              : null,
          metadata: {
            orderNo: order.orderNo,
            priceRuleId: priceRule.id,
            unlocksAt: priceRule.unlocksAt?.toISOString() ?? null,
          },
        },
        update: {
          status: IpEntitlementStatus.active,
          startsAt: now,
          endsAt:
            priceRule.unlocksAt && priceRule.unlocksAt > now
              ? priceRule.unlocksAt
              : null,
        },
      });

      await ensureCollectionItemTx(tx, user.userId, entitlement);
      await this.postRevenueEntriesTx(tx, {
        orderId: order.id,
        titleId: title.id,
        episodeId: episode?.id ?? null,
        totalAmount: priceRule.amount,
        walletTransactionId: walletTransaction?.id ?? null,
        now,
      });
      if (referralLink && referralLink.userId !== user.userId) {
        await this.postReferralAttributionTx(tx, {
          referralLink,
          buyerUserId: user.userId,
          orderId: order.id,
          titleId: title.id,
          episodeId: episode?.id ?? null,
          totalAmount: priceRule.amount,
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

  async reportContent(user: AuthUser, input: CreateIpContentReportInput) {
    const target = await this.resolveReportTarget(input);
    const report = await this.prisma.ipContentReport.create({
      data: {
        targetType:
          input.targetType === 'title'
            ? IpModerationTargetType.title
            : IpModerationTargetType.episode,
        targetId: input.targetId,
        titleId: target.titleId,
        episodeId: target.episodeId,
        reporterUserId: user.userId,
        reason: input.reason,
        status: IpReportStatus.submitted,
        description: input.description,
        evidenceAssetId: input.evidenceAssetId,
        metadata: {},
      },
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
          titleId: input.targetType === 'title' ? input.targetId : null,
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

  private async applyModerationAction(
    user: AuthUser,
    report: {
      id: string;
      targetType: IpModerationTargetType;
      targetId: string;
      titleId: string | null;
      episodeId: string | null;
      ipTitle: {
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
      : IpModerationTargetType.title;
    const targetId = report.episodeId ?? report.titleId ?? report.targetId;
    const before =
      targetType === IpModerationTargetType.episode
        ? report.episode
        : report.ipTitle;
    if (!before) return;

    let after: unknown = before;
    if (targetType === IpModerationTargetType.title && report.titleId) {
      after = await this.prisma.ipTitle.update({
        where: { id: report.titleId },
        data: titlePublicationPatchForModeration(actionType, input.now),
      });
    }
    if (targetType === IpModerationTargetType.episode && report.episodeId) {
      after = await this.prisma.ipEpisode.update({
        where: { id: report.episodeId },
        data: episodePublicationPatchForModeration(actionType, input.now),
      });
    }

    await this.prisma.ipModerationAction.create({
      data: {
        targetType,
        targetId,
        actionType,
        actorUserId: user.userId,
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
  ): Promise<Prisma.IpTitleWhereInput> {
    if (!user) return {};
    const blocks = await this.prisma.ipUserContentBlock.findMany({
      where: {
        userId: user.userId,
        unblockedAt: null,
      },
      select: {
        targetType: true,
        targetId: true,
      },
    });
    const blockedTitleIds = blocks
      .filter((block) => block.targetType === IpUserBlockTargetType.title)
      .map((block) => block.targetId);
    const blockedCreatorIds = blocks
      .filter((block) => block.targetType === IpUserBlockTargetType.creator)
      .map((block) => block.targetId);
    const not: Prisma.IpTitleWhereInput[] = [];
    if (blockedTitleIds.length > 0) {
      not.push({ id: { in: blockedTitleIds } });
    }
    if (blockedCreatorIds.length > 0) {
      not.push({ createdById: { in: blockedCreatorIds } });
    }
    return not.length > 0 ? { NOT: not } : {};
  }

  private async resolveReportTarget(input: CreateIpContentReportInput) {
    if (input.targetType === 'title') {
      const title = await this.prisma.ipTitle.findFirst({
        where: {
          id: input.targetId,
          deletedAt: null,
          listingVisibility: { in: ['public', 'unlisted'] },
        },
      });
      if (!title) {
        throw new NotFoundException({
          code: 'IP_REPORT_TARGET_NOT_FOUND',
          msg: 'Report target was not found.',
        });
      }
      return { titleId: title.id, episodeId: null };
    }

    const episode = await this.prisma.ipEpisode.findFirst({
      where: {
        id: input.targetId,
        deletedAt: null,
        ipTitle: {
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
    return { titleId: episode.titleId, episodeId: episode.id };
  }

  private async assertBlockTargetExists(input: UpsertIpUserBlockInput) {
    if (input.targetType !== 'title') return;
    const title = await this.prisma.ipTitle.findFirst({
      where: {
        id: input.targetId,
        deletedAt: null,
        listingVisibility: { in: ['public', 'unlisted'] },
      },
    });
    if (!title) {
      throw new NotFoundException({
        code: 'IP_BLOCK_TARGET_NOT_FOUND',
        msg: 'Block target was not found.',
      });
    }
  }

  private async resolvePriceRuleTx(
    tx: Prisma.TransactionClient,
    input: {
      titleId: string;
      episodeId: string | null;
      targetType: IpCommerceTargetType;
      siteRegion: BillingSiteRegion;
      priceRuleId?: string;
      now: Date;
    },
  ) {
    const where: Prisma.IpPriceRuleWhereInput = {
      id: input.priceRuleId,
      titleId: input.titleId,
      episodeId:
        input.targetType === IpCommerceTargetType.episode
          ? input.episodeId
          : null,
      targetType: input.targetType,
      siteRegion: input.siteRegion,
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
    return priceRule;
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
      titleId: string;
      episodeId: string | null;
      now: Date;
    },
  ) {
    return tx.ipReferralLink.findFirst({
      where: {
        code: input.code,
        titleId: input.titleId,
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

  private async postRevenueEntriesTx(
    tx: Prisma.TransactionClient,
    input: {
      orderId: string;
      titleId: string;
      episodeId: string | null;
      totalAmount: bigint;
      walletTransactionId: string | null;
      now: Date;
    },
  ): Promise<void> {
    const rules = await tx.ipRevenueRule.findMany({
      where: {
        titleId: input.titleId,
        status: IpRevenueRuleStatus.active,
        archivedAt: null,
        OR: [{ episodeId: null }, { episodeId: input.episodeId }],
        AND: [
          { OR: [{ startsAt: null }, { startsAt: { lte: input.now } }] },
          { OR: [{ endsAt: null }, { endsAt: { gt: input.now } }] },
        ],
      },
      include: { contributor: true },
      orderBy: { createdAt: 'asc' },
    });

    for (const rule of rules) {
      const beneficiaryUserId =
        rule.beneficiaryUserId ?? rule.contributor?.userId ?? null;
      if (!beneficiaryUserId) continue;
      const amount =
        rule.fixedAmount ??
        (rule.shareBps
          ? (input.totalAmount * BigInt(rule.shareBps)) / 10000n
          : 0n);
      if (amount <= 0n) continue;

      const walletTransaction = await creditRevenueTx(tx, {
        userId: beneficiaryUserId,
        amount,
        sourceType: 'ip_revenue_rule',
        sourceId: `${input.orderId}:${rule.id}`,
        idempotencyKey: `ip_purchase_order:${input.orderId}:revenue:${rule.id}:${beneficiaryUserId}`,
        description: `IP revenue from order ${input.orderId}`,
        metadata: {
          orderId: input.orderId,
          titleId: input.titleId,
          episodeId: input.episodeId,
          ruleId: rule.id,
        },
      });

      await tx.ipRevenueLedgerEntry.create({
        data: {
          userId: beneficiaryUserId,
          titleId: input.titleId,
          episodeId: input.episodeId,
          orderId: input.orderId,
          ruleId: rule.id,
          walletTransactionId: walletTransaction.id,
          entryType:
            rule.ruleType === 'referral_commission'
              ? IpRevenueLedgerEntryType.referral_commission
              : rule.ruleType === 'production_fee'
                ? IpRevenueLedgerEntryType.production_fee
                : rule.ruleType === 'platform_fee'
                  ? IpRevenueLedgerEntryType.platform_fee
                  : IpRevenueLedgerEntryType.revenue_share,
          status: IpRevenueLedgerStatus.posted,
          currency: WalletCurrencyType.revenue_credit,
          amount,
          sourceAmount: input.totalAmount,
          shareBps: rule.shareBps,
          metadata: {
            sourceWalletTransactionId: input.walletTransactionId,
          },
          postedAt: input.now,
        },
      });
    }
  }

  private async postReferralAttributionTx(
    tx: Prisma.TransactionClient,
    input: {
      referralLink: {
        id: string;
        userId: string;
        commissionBps: number;
      };
      buyerUserId: string;
      orderId: string;
      titleId: string;
      episodeId: string | null;
      totalAmount: bigint;
      now: Date;
    },
  ): Promise<void> {
    await tx.ipReferralAttribution.create({
      data: {
        referralLinkId: input.referralLink.id,
        titleId: input.titleId,
        episodeId: input.episodeId,
        orderId: input.orderId,
        buyerUserId: input.buyerUserId,
        metadata: {},
        attributedAt: input.now,
      },
    });

    const amount =
      (input.totalAmount * BigInt(input.referralLink.commissionBps)) / 10000n;
    if (amount <= 0n) return;

    const walletTransaction = await creditRevenueTx(tx, {
      userId: input.referralLink.userId,
      amount,
      sourceType: 'ip_referral_link',
      sourceId: `${input.orderId}:${input.referralLink.id}`,
      idempotencyKey: `ip_purchase_order:${input.orderId}:referral:${input.referralLink.id}:${input.referralLink.userId}`,
      description: `IP referral commission from order ${input.orderId}`,
      metadata: {
        orderId: input.orderId,
        titleId: input.titleId,
        episodeId: input.episodeId,
        referralLinkId: input.referralLink.id,
      },
    });

    await tx.ipRevenueLedgerEntry.create({
      data: {
        userId: input.referralLink.userId,
        titleId: input.titleId,
        episodeId: input.episodeId,
        orderId: input.orderId,
        referralLinkId: input.referralLink.id,
        walletTransactionId: walletTransaction.id,
        entryType: IpRevenueLedgerEntryType.referral_commission,
        status: IpRevenueLedgerStatus.posted,
        currency: WalletCurrencyType.revenue_credit,
        amount,
        sourceAmount: input.totalAmount,
        shareBps: input.referralLink.commissionBps,
        metadata: {},
        postedAt: input.now,
      },
    });
  }
}

async function findActiveEntitlementTx(
  tx: Prisma.TransactionClient,
  input: {
    userId: string;
    titleId: string;
    targetType: IpCommerceTargetType;
    episodeId: string | null;
    now: Date;
  },
) {
  const titleEntitlement = await tx.ipContentEntitlement.findFirst({
    where: {
      subjectType: BillingSubjectType.user,
      subjectId: input.userId,
      titleId: input.titleId,
      targetType: IpCommerceTargetType.title,
      episodeId: null,
      status: IpEntitlementStatus.active,
      OR: [{ endsAt: null }, { endsAt: { gt: input.now } }],
    },
  });
  if (titleEntitlement) return titleEntitlement;

  if (input.targetType === IpCommerceTargetType.title) return null;
  return tx.ipContentEntitlement.findFirst({
    where: {
      subjectType: BillingSubjectType.user,
      subjectId: input.userId,
      titleId: input.titleId,
      episodeId: input.episodeId,
      targetType: IpCommerceTargetType.episode,
      status: IpEntitlementStatus.active,
      OR: [{ endsAt: null }, { endsAt: { gt: input.now } }],
    },
  });
}

async function ensureCollectionItemTx(
  tx: Prisma.TransactionClient,
  userId: string,
  entitlement: {
    id: string;
    titleId: string;
    episodeId: string | null;
    targetType: IpCommerceTargetType;
  },
) {
  const existing = await tx.ipCollectionItem.findFirst({
    where: {
      userId,
      titleId: entitlement.titleId,
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
      titleId: entitlement.titleId,
      episodeId: entitlement.episodeId,
      entitlementId: entitlement.id,
      targetType: entitlement.targetType,
      status: IpCollectionItemStatus.active,
    },
  });
}

async function debitCommunityPointTx(
  tx: Prisma.TransactionClient,
  input: {
    userId: string;
    amount: bigint;
    orderId: string;
    orderNo: string;
    workspaceId: string;
  },
) {
  const account = await tx.walletAccount.upsert({
    where: {
      ownerType_ownerId_currency: {
        ownerType: WalletOwnerType.user,
        ownerId: input.userId,
        currency: WalletCurrencyType.community_point,
      },
    },
    create: {
      ownerType: WalletOwnerType.user,
      ownerId: input.userId,
      currency: WalletCurrencyType.community_point,
      status: WalletAccountStatus.active,
    },
    update: {},
  });
  await tx.$executeRaw`
    SELECT pg_advisory_xact_lock(hashtext(${`wallet:account:${account.id}`})::bigint)
  `;

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
      workspaceId: input.workspaceId,
      description: `Community point purchase ${input.orderNo}`,
      metadata: {
        orderNo: input.orderNo,
      },
    },
  });

  await tx.walletLedgerEntry.create({
    data: {
      transactionId: transaction.id,
      accountId: locked.id,
      entryType: WalletLedgerEntryType.debit,
      currency: WalletCurrencyType.community_point,
      amount: input.amount,
      availableDelta: -input.amount,
      heldDelta: 0n,
      availableBalanceAfter: nextAvailable,
      heldBalanceAfter: locked.heldBalance,
      reason: 'ip_purchase',
    },
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

async function creditRevenueTx(
  tx: Prisma.TransactionClient,
  input: {
    userId: string;
    amount: bigint;
    sourceType: string;
    sourceId: string;
    idempotencyKey: string;
    description: string;
    metadata: Record<string, unknown>;
  },
) {
  const existing = await tx.walletTransaction.findUnique({
    where: { idempotencyKey: input.idempotencyKey },
  });
  if (existing) return existing;

  const account = await tx.walletAccount.upsert({
    where: {
      ownerType_ownerId_currency: {
        ownerType: WalletOwnerType.user,
        ownerId: input.userId,
        currency: WalletCurrencyType.revenue_credit,
      },
    },
    create: {
      ownerType: WalletOwnerType.user,
      ownerId: input.userId,
      currency: WalletCurrencyType.revenue_credit,
      status: WalletAccountStatus.active,
    },
    update: {},
  });
  await tx.$executeRaw`
    SELECT pg_advisory_xact_lock(hashtext(${`wallet:account:${account.id}`})::bigint)
  `;
  const locked = await tx.walletAccount.findUniqueOrThrow({
    where: { id: account.id },
  });
  const nextAvailable = locked.availableBalance + input.amount;
  const transaction = await tx.walletTransaction.create({
    data: {
      status: WalletTransactionStatus.posted,
      sourceType: input.sourceType,
      sourceId: input.sourceId,
      idempotencyKey: input.idempotencyKey,
      actorUserId: input.userId,
      description: input.description,
      metadata: input.metadata as Prisma.InputJsonValue,
    },
  });
  await tx.walletLedgerEntry.create({
    data: {
      transactionId: transaction.id,
      accountId: locked.id,
      entryType: WalletLedgerEntryType.credit,
      currency: WalletCurrencyType.revenue_credit,
      amount: input.amount,
      availableDelta: input.amount,
      heldDelta: 0n,
      availableBalanceAfter: nextAvailable,
      heldBalanceAfter: locked.heldBalance,
      reason: 'ip_revenue',
    },
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

function adminTitleWhere(
  query: ListAdminIpTitlesQuery,
): Prisma.IpTitleWhereInput {
  const search = query.q?.trim();
  return {
    deletedAt: null,
    contentType: query.contentType as IpContentType | undefined,
    status: query.status as IpPublicationStatus | undefined,
    listingVisibility: query.listingVisibility as
      | IpListingVisibility
      | undefined,
    ...(search
      ? {
          OR: [
            { title: { contains: search, mode: 'insensitive' } },
            { subtitle: { contains: search, mode: 'insensitive' } },
            { summary: { contains: search, mode: 'insensitive' } },
            { slug: { contains: search, mode: 'insensitive' } },
          ],
        }
      : {}),
  };
}

function adminTitleSummaryDto(
  title: AdminTitleWithCommerce,
  siteRegion: BillingSiteRegion,
) {
  const activeBundlePrice = selectActivePrice(
    title.priceRules.filter(
      (rule) => rule.targetType === IpCommerceTargetType.title,
    ),
    siteRegion,
  );
  const activeEpisodePrices = title.episodes
    .map((episode) => selectActivePrice(episode.priceRules, siteRegion))
    .filter(Boolean);
  return {
    id: title.id,
    workspaceId: title.workspaceId,
    sourceProjectId: title.sourceProjectId,
    slug: title.slug,
    title: title.title,
    subtitle: title.subtitle,
    summary: title.summary,
    contentType: title.contentType,
    status: title.status,
    listingVisibility: title.listingVisibility,
    ageRating: title.ageRating,
    language: title.language,
    genres: title.genres,
    tags: title.tags,
    version: title.version,
    coverAsset: assetDto(title.coverAsset),
    heroAsset: assetDto(title.heroAsset),
    trailerAsset: assetDto(title.trailerAsset),
    scheduledAt: title.scheduledAt?.toISOString() ?? null,
    publishedAt: title.publishedAt?.toISOString() ?? null,
    suspendedAt: title.suspendedAt?.toISOString() ?? null,
    archivedAt: title.archivedAt?.toISOString() ?? null,
    createdAt: title.createdAt.toISOString(),
    updatedAt: title.updatedAt.toISOString(),
    counts: {
      episodes: title._count.episodes,
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

function adminTitleDetailDto(
  title: AdminTitleWithCommerce,
  siteRegion: BillingSiteRegion,
) {
  return {
    ...adminTitleSummaryDto(title, siteRegion),
    description: title.description,
    copyrightOwner: title.copyrightOwner,
    rightsSummary: title.rightsSummary,
    aiDisclosure: title.aiDisclosure,
    episodes: title.episodes.map((episode) => ({
      id: episode.id,
      episodeNo: episode.episodeNo,
      sortOrder: episode.sortOrder,
      status: episode.status,
      title: episode.title,
      subtitle: episode.subtitle,
      summary: episode.summary,
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
    })),
    priceRules: title.priceRules.map(adminPriceRuleDto),
    campaigns: title.campaigns.map(adminCampaignDto),
    contributors: title.contributors.map((contributor) => ({
      id: contributor.id,
      userId: contributor.userId,
      displayName: contributor.displayName,
      role: contributor.role,
      customRole: contributor.customRole,
      isPublic: contributor.isPublic,
      revenueEligible: contributor.revenueEligible,
      displayOrder: contributor.displayOrder,
    })),
    revenueRules: title.revenueRules.map((rule) => ({
      id: rule.id,
      episodeId: rule.episodeId,
      contributorId: rule.contributorId,
      contributorName: rule.contributor?.displayName ?? null,
      beneficiaryUserId: rule.beneficiaryUserId,
      ruleType: rule.ruleType,
      status: rule.status,
      currency: rule.currency,
      shareBps: rule.shareBps,
      fixedAmount: rule.fixedAmount?.toString() ?? null,
      startsAt: rule.startsAt?.toISOString() ?? null,
      endsAt: rule.endsAt?.toISOString() ?? null,
    })),
    reports: title.reports.map(adminReportDto),
    recentOrders: title.purchaseOrders.map(purchaseOrderDto),
  };
}

function adminPriceRuleDto(rule: {
  id: string;
  targetType: IpCommerceTargetType;
  status: IpPriceRuleStatus;
  siteRegion: BillingSiteRegion;
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
    siteRegion: rule.siteRegion,
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

function adminCampaignDto(campaign: {
  id: string;
  campaignType: string;
  status: IpCampaignStatus;
  siteRegion: BillingSiteRegion;
  code: string;
  name: string;
  description: string | null;
  startsAt: Date | null;
  endsAt: Date | null;
  unlocksAt: Date | null;
}) {
  return {
    id: campaign.id,
    campaignType: campaign.campaignType,
    status: campaign.status,
    siteRegion: campaign.siteRegion,
    code: campaign.code,
    name: campaign.name,
    description: campaign.description,
    startsAt: campaign.startsAt?.toISOString() ?? null,
    endsAt: campaign.endsAt?.toISOString() ?? null,
    unlocksAt: campaign.unlocksAt?.toISOString() ?? null,
  };
}

function adminReviewDto(review: {
  id: string;
  targetType: string;
  targetId: string;
  titleId: string | null;
  episodeId: string | null;
  status: IpReviewStatus;
  changeSummary: string | null;
  submittedById: string;
  reviewerId: string | null;
  submittedAt: Date;
  ipTitle: {
    id: string;
    title: string;
    status: IpPublicationStatus;
    listingVisibility: IpListingVisibility;
  } | null;
  episode: {
    id: string;
    episodeNo: number;
    title: string;
    status: IpPublicationStatus;
  } | null;
}) {
  return {
    id: review.id,
    targetType: review.targetType,
    targetId: review.targetId,
    titleId: review.titleId,
    episodeId: review.episodeId,
    status: review.status,
    changeSummary: review.changeSummary,
    submittedById: review.submittedById,
    reviewerId: review.reviewerId,
    submittedAt: review.submittedAt.toISOString(),
    title: review.ipTitle,
    episode: review.episode,
  };
}

function adminReportDto(report: {
  id: string;
  targetType: IpModerationTargetType;
  targetId: string;
  titleId: string | null;
  episodeId: string | null;
  reporterUserId: string | null;
  reason: string;
  status: IpReportStatus;
  description: string | null;
  resolvedById: string | null;
  resolutionNote: string | null;
  createdAt: Date;
  resolvedAt: Date | null;
  ipTitle?: {
    id: string;
    title: string;
    status: IpPublicationStatus;
    listingVisibility: IpListingVisibility;
  } | null;
  episode?: {
    id: string;
    episodeNo: number;
    title: string;
    status: IpPublicationStatus;
  } | null;
}) {
  return {
    id: report.id,
    targetType: report.targetType,
    targetId: report.targetId,
    titleId: report.titleId,
    episodeId: report.episodeId,
    reporterUserId: report.reporterUserId,
    reason: report.reason,
    status: report.status,
    description: report.description,
    resolvedById: report.resolvedById,
    resolutionNote: report.resolutionNote,
    createdAt: report.createdAt.toISOString(),
    resolvedAt: report.resolvedAt?.toISOString() ?? null,
    title: report.ipTitle ?? null,
    episode: report.episode ?? null,
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

function titlePublicationPatchForModeration(
  actionType: IpModerationActionType,
  now: Date,
): Prisma.IpTitleUpdateInput {
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
    'title',
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function titleDto(title: TitleWithCommerce, siteRegion: BillingSiteRegion) {
  const activeTitlePrice = selectActivePrice(
    title.priceRules.filter(
      (rule) => rule.targetType === IpCommerceTargetType.title,
    ),
    siteRegion,
  );
  return {
    id: title.id,
    workspaceId: title.workspaceId,
    slug: title.slug,
    contentType: title.contentType,
    status: title.status,
    listingVisibility: title.listingVisibility,
    ageRating: title.ageRating,
    title: title.title,
    subtitle: title.subtitle,
    summary: title.summary,
    description: title.description,
    language: title.language,
    genres: title.genres,
    tags: title.tags,
    copyrightOwner: title.copyrightOwner,
    rightsSummary: title.rightsSummary,
    aiDisclosure: title.aiDisclosure,
    coverAsset: assetDto(title.coverAsset),
    heroAsset: assetDto(title.heroAsset),
    trailerAsset: assetDto(title.trailerAsset),
    publishedAt: title.publishedAt?.toISOString() ?? null,
    scheduledAt: title.scheduledAt?.toISOString() ?? null,
    price: activeTitlePrice ? priceRuleDto(activeTitlePrice) : null,
    campaigns: title.campaigns.map((campaign) => ({
      id: campaign.id,
      campaignType: campaign.campaignType,
      status: campaign.status,
      siteRegion: campaign.siteRegion,
      code: campaign.code,
      name: campaign.name,
      startsAt: campaign.startsAt?.toISOString() ?? null,
      endsAt: campaign.endsAt?.toISOString() ?? null,
      unlocksAt: campaign.unlocksAt?.toISOString() ?? null,
    })),
    episodes: title.episodes.map((episode) => {
      const price = selectActivePrice(episode.priceRules, siteRegion);
      return {
        id: episode.id,
        episodeNo: episode.episodeNo,
        sortOrder: episode.sortOrder,
        status: episode.status,
        title: episode.title,
        subtitle: episode.subtitle,
        summary: episode.summary,
        durationSeconds: episode.durationSeconds,
        isFreePreview: episode.isFreePreview,
        coverAsset: assetDto(episode.coverAsset),
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
    siteRegion: BillingSiteRegion;
    startsAt: Date | null;
    endsAt: Date | null;
    priority: number;
    amount: bigint;
  },
>(rules: T[], siteRegion: BillingSiteRegion, now = new Date()): T | null {
  return (
    rules
      .filter(
        (rule) =>
          rule.status === IpPriceRuleStatus.active &&
          !rule.archivedAt &&
          rule.siteRegion === siteRegion &&
          (!rule.startsAt || rule.startsAt <= now) &&
          (!rule.endsAt || rule.endsAt > now),
      )
      .sort(
        (a, b) => b.priority - a.priority || Number(a.amount - b.amount),
      )[0] ?? null
  );
}

function priceRuleDto(rule: {
  id: string;
  targetType: IpCommerceTargetType;
  currency: WalletCurrencyType;
  amount: bigint;
  originalAmount: bigint | null;
  campaignId: string | null;
  startsAt: Date | null;
  endsAt: Date | null;
  unlocksAt: Date | null;
  maxPerUser: number | null;
}) {
  return {
    id: rule.id,
    targetType: rule.targetType,
    currency: rule.currency,
    amount: rule.amount.toString(),
    originalAmount: rule.originalAmount?.toString() ?? null,
    campaignId: rule.campaignId,
    startsAt: rule.startsAt?.toISOString() ?? null,
    endsAt: rule.endsAt?.toISOString() ?? null,
    unlocksAt: rule.unlocksAt?.toISOString() ?? null,
    maxPerUser: rule.maxPerUser,
  };
}

function priceSnapshot(rule: {
  id: string;
  targetType: IpCommerceTargetType;
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
  workspaceId: string | null;
  titleId: string;
  episodeId: string | null;
  targetType: IpCommerceTargetType;
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
    userId: order.userId,
    workspaceId: order.workspaceId,
    titleId: order.titleId,
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
  subjectType: BillingSubjectType;
  subjectId: string;
  titleId: string;
  episodeId: string | null;
  targetType: IpCommerceTargetType;
  status: IpEntitlementStatus;
  sourceType: string;
  sourceId: string;
  startsAt: Date;
  endsAt: Date | null;
}) {
  return {
    id: entitlement.id,
    subjectType: entitlement.subjectType,
    subjectId: entitlement.subjectId,
    titleId: entitlement.titleId,
    episodeId: entitlement.episodeId,
    targetType: entitlement.targetType,
    status: entitlement.status,
    sourceType: entitlement.sourceType,
    sourceId: entitlement.sourceId,
    startsAt: entitlement.startsAt.toISOString(),
    endsAt: entitlement.endsAt?.toISOString() ?? null,
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
    width: number | null;
    height: number | null;
    durationSeconds: number | null;
  } | null,
) {
  if (!asset) return null;
  return {
    id: asset.id,
    kind: asset.kind,
    storageProvider: asset.storageProvider,
    bucket: asset.bucket,
    region: asset.region,
    objectKey: asset.objectKey,
    externalUrl: asset.externalUrl,
    contentType: asset.contentType,
    width: asset.width,
    height: asset.height,
    durationSeconds: asset.durationSeconds,
  };
}

function userBlockDto(block: {
  id: string;
  userId: string;
  targetType: IpUserBlockTargetType;
  targetId: string;
  titleId: string | null;
  reason: string | null;
  createdAt: Date;
  unblockedAt: Date | null;
}) {
  return {
    id: block.id,
    userId: block.userId,
    targetType: block.targetType,
    targetId: block.targetId,
    titleId: block.titleId,
    reason: block.reason,
    createdAt: block.createdAt.toISOString(),
    unblockedAt: block.unblockedAt?.toISOString() ?? null,
  };
}

function createIpOrderNo(): string {
  const stamp = new Date()
    .toISOString()
    .replace(/[-:TZ.]/g, '')
    .slice(0, 14);
  return `IP${stamp}${randomUUID().replace(/-/g, '').slice(0, 10).toUpperCase()}`;
}

function siteRegionFromEnv(): BillingSiteRegion {
  return process.env.NEXT_PUBLIC_SITE_REGION === 'cn'
    ? BillingSiteRegion.cn
    : BillingSiteRegion.global;
}
