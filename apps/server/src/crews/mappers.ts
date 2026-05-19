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
  CrewPosition,
  Episode,
  EpisodeActivity,
  EpisodeAssignment,
} from '@prisma/client';
import type {
  CrewApplicationDTO,
  CrewDTO,
  CrewMemberDTO,
  CrewPositionDTO,
  EpisodeActivityDTO,
  EpisodeAssignmentDTO,
  EpisodeDTO,
} from '@repo/shared/crew';

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);
const isoReq = (d: Date) => d.toISOString();

interface CrewExtras {
  memberCount?: number;
  openPositionCount?: number;
  /** Top-N (≤3) newest open positionType strings — for plaza card
   *  preview ("招募: 配音演员 · 音效师 +1"). */
  openPositionPreview?: string[];
  pendingApplicationCount?: number;
}

export function toCrewDTO(c: Crew, extras: CrewExtras = {}): CrewDTO {
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
    founderId: c.founderId,
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

export function toPositionDTO(p: CrewPosition): CrewPositionDTO {
  return {
    id: p.id,
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
    salary: {
      period: (p.salaryPeriod as CrewPositionDTO['salary']['period']) ?? null,
      currency:
        (p.salaryCurrency as CrewPositionDTO['salary']['currency']) ?? null,
      minAmount: p.salaryMinAmount !== null ? Number(p.salaryMinAmount) : null,
      maxAmount: p.salaryMaxAmount !== null ? Number(p.salaryMaxAmount) : null,
      negotiable: p.salaryNegotiable,
    },
    closeDate: p.closeDate ? p.closeDate.toISOString().slice(0, 10) : null,
    createdAt: isoReq(p.createdAt),
  };
}

export function toMemberDTO(m: CrewMember): CrewMemberDTO {
  return {
    id: m.id,
    crewId: m.crewId,
    userId: m.userId,
    roleType: m.roleType,
    positionId: m.positionId ?? null,
    via: m.via as CrewMemberDTO['via'],
    isFinance: m.isFinance,
    joinedAt: isoReq(m.joinedAt),
  };
}

export function toApplicationDTO(a: CrewApplication): CrewApplicationDTO {
  return {
    id: a.id,
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

export function toEpisodeDTO(e: Episode): EpisodeDTO {
  return {
    id: e.id,
    crewId: e.crewId,
    number: e.number,
    title: e.title,
    description: e.description,
    status: e.status as EpisodeDTO['status'],
    deadline: e.deadline ? e.deadline.toISOString().slice(0, 10) : null,
    approvedAt: iso(e.approvedAt),
    createdAt: isoReq(e.createdAt),
    updatedAt: isoReq(e.updatedAt),
  };
}

export function toAssignmentDTO(a: EpisodeAssignment): EpisodeAssignmentDTO {
  return {
    id: a.id,
    crewId: a.crewId,
    episodeId: a.episodeId,
    userId: a.userId,
    positionId: a.positionId ?? null,
    roleName: a.roleName,
    status: a.status as EpisodeAssignmentDTO['status'],
    submission: a.submittedAt
      ? {
          url: a.submissionUrl,
          note: a.submissionNote,
          submittedAt: isoReq(a.submittedAt),
        }
      : null,
    reviewNote: a.rejectedAt
      ? {
          reason: a.rejectReason ?? '',
          suggestion: a.rejectSuggestion,
          rejectedAt: isoReq(a.rejectedAt),
        }
      : null,
    revenue:
      a.revenueAmount !== null && a.revenueSetAt
        ? {
            amount: Number(a.revenueAmount),
            // DB column is VARCHAR(8) constrained to ALL_CURRENCIES;
            // legacy rows default to "CNY". The cast is safe because
            // the CHECK constraint upstream guarantees the value.
            currency: (a.revenueCurrency ??
              'CNY') as EpisodeAssignmentDTO['revenue'] extends infer R
              ? R extends { currency: infer C }
                ? C
                : never
              : never,
            setAt: isoReq(a.revenueSetAt),
            setByUserId: a.revenueSetById ?? '',
          }
        : null,
    updatedAt: isoReq(a.updatedAt),
  };
}

export function toActivityDTO(a: EpisodeActivity): EpisodeActivityDTO {
  return {
    id: a.id,
    crewId: a.crewId,
    episodeId: a.episodeId,
    type: a.type,
    actorUserId: a.actorUserId,
    actorName: a.actorName,
    payload: (a.payload ?? {}) as Record<string, unknown>,
    createdAt: isoReq(a.createdAt),
  };
}
