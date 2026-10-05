/**
 * Prisma row → wire DTO conversions.
 *
 * Now that IDs are CUID strings (not BigInt), mapping is mostly a
 * pass-through. We still:
 *   - Format Dates as ISO strings so the wire shape is stable
 *   - Convert BigInt revenueAmount to number (CNY 分 fits Int32 with
 *     headroom — millions of yuan per single assignment is the cap)
 *   - Massage submission / reviewNote / revenue from flat columns
 *     into nested objects so the client renders without joining fields
 */
import type {
  Crew,
  CrewApplication,
  CrewMember,
  CrewMemberPolicy,
  CrewMemberPosition,
  CrewOwnership,
  CrewPosition,
} from '@prisma/client';
import type {
  CrewApplicationDTO,
  CrewApplicationStatusCounts,
  CrewDTO,
  CrewMemberDTO,
  CrewPositionDTO,
} from '@repo/shared/crew';
import { isCrewPolicyKey, isPresetPosition } from '@repo/shared/crew';

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);
const isoReq = (d: Date) => d.toISOString();

/**
 * Crew logos are stored as relative keys in the region's banner bucket (the web
 * client historically prefixed them). Resolve to an absolute URL server-side so
 * admin surfaces get a ready-to-render URL. Absolute inputs pass through; if the
 * base env is missing we return the raw key rather than crash a display path.
 */
export function resolveCrewLogoUrl(logo: string): string {
  if (!logo || /^https?:\/\//i.test(logo)) return logo;
  const base = process.env.BANNER_BASE_URL?.replace(/\/+$/, '');
  return base ? `${base}/${logo.replace(/^\/+/, '')}` : logo;
}

/** Admin patrol row — the fields a moderator needs to decide + act. */
export interface AdminCrewListItem {
  id: string;
  name: string;
  logo: string;
  ownerUserId: string | null;
  listingStatus: string;
  moderationStatus: 'ok' | 'taken_down';
  moderatedAt: string | null;
  moderatedByAdminId: string | null;
  moderationReason: string | null;
  memberCount: number;
  createdAt: string;
}

export function toAdminCrewDTO(
  c: CrewWithOwnership,
  memberCount: number,
): AdminCrewListItem {
  return {
    id: c.id,
    name: c.name,
    logo: resolveCrewLogoUrl(c.logo),
    ownerUserId: c.ownership?.member.userId ?? null,
    listingStatus: c.listingStatus,
    moderationStatus: c.moderationStatus,
    moderatedAt: iso(c.moderatedAt),
    moderatedByAdminId: c.moderatedByAdminId,
    moderationReason: c.moderationReason,
    memberCount,
    createdAt: isoReq(c.createdAt),
  };
}

interface CrewExtras {
  memberCount?: number;
  openPositionCount?: number;
  /** Top-N (≤3) newest open positionType strings — for plaza card
   *  preview ("招募: 配音演员 · 音效师 +1"). */
  openPositionPreview?: string[];
  pendingApplicationCount?: number;
}

type CrewWithOwnership = Crew & {
  ownership: { member: { userId: string } } | null;
};

export function toCrewDTO(
  c: CrewWithOwnership,
  extras: CrewExtras = {},
): CrewDTO {
  if (!c.ownership) {
    throw new Error(`Crew ${c.id} has no owner`);
  }
  return {
    id: c.id,
    name: c.name,
    description: c.description,
    logo: c.logo,
    tagline: c.tagline ?? null,
    genres: (c.genres ?? []) as CrewDTO['genres'],
    styles: (c.styles ?? []) as CrewDTO['styles'],
    // Both JSONB fields are typed `Prisma.JsonValue` at the Prisma
    // layer; service-level Zod input + DB CHECK constraints upstream
    // guarantee shape, so the cast is safe.
    socialLinks: (c.socialLinks as CrewDTO['socialLinks'] | null) ?? [],
    showcaseWorks: (c.showcaseWorks as CrewDTO['showcaseWorks'] | null) ?? [],
    ownerUserId: c.ownership.member.userId,
    listingStatus: c.listingStatus as CrewDTO['listingStatus'],
    productionKind: c.productionKind as CrewDTO['productionKind'],
    studioWorkspaceId: c.studioWorkspaceId ?? null,
    listedAt: iso(c.listedAt),
    version: c.version,
    createdAt: isoReq(c.createdAt),
    updatedAt: isoReq(c.updatedAt),
    ...(extras.memberCount !== undefined
      ? { memberCount: extras.memberCount }
      : {}),
    ...(extras.openPositionCount !== undefined
      ? { openPositionCount: extras.openPositionCount }
      : {}),
    ...(extras.openPositionPreview !== undefined
      ? { openPositionPreview: extras.openPositionPreview }
      : {}),
    ...(extras.pendingApplicationCount !== undefined
      ? { pendingApplicationCount: extras.pendingApplicationCount }
      : {}),
  };
}

export function toPositionDTO(
  p: CrewPosition,
  applicationStats?: CrewApplicationStatusCounts,
): CrewPositionDTO {
  return {
    id: p.id,
    taskId: p.taskId,
    recruitmentVisibility: p.recruitmentVisibility as 'public' | 'private',
    crewId: p.crewId,
    positionType: p.positionType,
    description: p.description,
    targetCount: p.targetCount,
    recruitedCount: p.recruitedCount,
    status: p.status as CrewPositionDTO['status'],
    workMode: p.workMode as CrewPositionDTO['workMode'],
    location: p.location,
    employmentType: p.employmentType as CrewPositionDTO['employmentType'],
    experienceLevel: p.experienceLevel as CrewPositionDTO['experienceLevel'],
    requiredSkills: p.requiredSkills,
    paymentTerms: (p.paymentTerms as CrewPositionDTO['paymentTerms']) ?? null,
    salary: {
      period: (p.salaryPeriod as CrewPositionDTO['salary']['period']) ?? null,
      currency:
        (p.salaryCurrency as CrewPositionDTO['salary']['currency']) ?? null,
      minAmount: p.salaryMinAmount !== null ? Number(p.salaryMinAmount) : null,
      maxAmount: p.salaryMaxAmount !== null ? Number(p.salaryMaxAmount) : null,
      negotiable: p.salaryNegotiable,
    },
    durationMonths: p.durationMonths,
    // Storage is basis points (1bp = 0.01%); wire is plain percentage,
    // so divide by 100 to get a number like 2.5 from a stored 250.
    revenueSharePercent:
      p.revenueShareBp !== null ? p.revenueShareBp / 100 : null,
    closeDate: p.closeDate ? p.closeDate.toISOString().slice(0, 10) : null,
    ...(applicationStats ? { applicationStats } : {}),
    createdAt: isoReq(p.createdAt),
  };
}

type CrewMemberView = CrewMember & {
  ownership: CrewOwnership | null;
  positions: CrewMemberPosition[];
  policies: CrewMemberPolicy[];
};

export function toMemberDTO(m: CrewMemberView): CrewMemberDTO {
  return {
    id: m.id,
    crewId: m.crewId,
    userId: m.userId,
    status: m.status as CrewMemberDTO['status'],
    joinedVia: m.joinedVia as CrewMemberDTO['joinedVia'],
    isOwner: m.ownership !== null,
    positions: m.positions.map((position) => ({
      id: position.id,
      categoryKey:
        position.categoryKey && isPresetPosition(position.categoryKey)
          ? position.categoryKey
          : null,
      title: position.title,
      isPrimary: position.isPrimary,
      sourcePositionId: position.sourcePositionId,
    })),
    policyKeys: m.policies
      .map((policy) => policy.policyKey)
      .filter(isCrewPolicyKey),
    joinedAt: isoReq(m.joinedAt),
    removedAt: iso(m.removedAt),
    version: m.version,
  };
}

export function toApplicationDTO(
  a: CrewApplication & {
    interviewEvents?: Array<{
      state: string;
      version: number;
      scheduledAt: Date | null;
    }>;
  },
): CrewApplicationDTO {
  return {
    id: a.id,
    ...(a.interviewEvents
      ? {
          interview: {
            state: (a.interviewEvents[0]?.state ??
              'not_started') as NonNullable<
              CrewApplicationDTO['interview']
            >['state'],
            version: a.interviewEvents[0]?.version ?? 0,
            scheduledAt:
              a.interviewEvents[0]?.scheduledAt?.toISOString() ?? null,
          },
        }
      : {}),
    crewId: a.crewId,
    positionId: a.positionId,
    applicantId: a.applicantId,
    message: a.message,
    portfolioUrl: a.portfolioUrl,
    expectedCompensation:
      a.expectedCompensationAmount !== null &&
      a.expectedCompensationCurrency !== null
        ? {
            amount: Number(a.expectedCompensationAmount),
            currency: a.expectedCompensationCurrency as NonNullable<
              CrewApplicationDTO['expectedCompensation']
            >['currency'],
            period:
              (a.expectedCompensationPeriod as NonNullable<
                CrewApplicationDTO['expectedCompensation']
              >['period']) ?? null,
          }
        : null,
    availableStartDate: a.availableStartDate
      ? a.availableStartDate.toISOString().slice(0, 10)
      : null,
    yearsExperience: a.yearsExperience,
    status: a.status as CrewApplicationDTO['status'],
    createdAt: isoReq(a.createdAt),
    reviewedAt: iso(a.reviewedAt),
    reviewerId: a.reviewerId,
  };
}
