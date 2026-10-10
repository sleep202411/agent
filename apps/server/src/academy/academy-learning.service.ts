import { createHash } from 'node:crypto';
import { academyPayeesSql } from '../creator-withdrawals/academy-withdrawals';
import { lockMediaAssetReferences } from '../media/media-asset-lifecycle-lock';
import { LegacyCreatorsService } from '../legacy-creators/legacy-creators.service';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, type AcademyEnrollment } from '@prisma/client';
import { z } from 'zod';
import { PrismaService } from '../infra/db/db.module';
import { MediaStorageAccessService } from '../infra/storage/media-storage-access.service';
import {
  WalletLedgerService,
  expireLapsedGrantsTx,
} from '../workspaces/wallet-ledger.service';
import { ensureWalletAccount } from '../workspaces/wallet-account-admission';
import { AcademyAuthorityService } from './academy-authority.service';
import { AcademyMappingsService } from './academy-mappings.service';
import { type AdminActor, ADMIN_PERMISSION_KEYS } from '../admin-auth';
import { CURRENT_CELL } from '../common/region/current-cell';
import {
  SaveOffering,
  SubmitHomework,
  ReviewHomework,
  OfferingShare,
} from './academy-learning.dto';

export function teacherShare(price: bigint, bps: number) {
  return (price * BigInt(bps)) / 10000n;
}

type InstructorAssignment = {
  teacherId?: string | null;
  instructorShares?: Array<{ teacherId: string }> | null;
};

export function isCourseInstructor(
  course:
    | { instructors?: Array<{ userId: string | number }> }
    | null
    | undefined,
  userId: string | null | undefined,
  assigned?: InstructorAssignment | null,
) {
  if (!userId) return false;
  if (course?.instructors?.some((item) => String(item.userId) === userId))
    return true;
  if (assigned?.teacherId && String(assigned.teacherId) === userId) return true;
  return Boolean(
    assigned?.instructorShares?.some(
      (item) => String(item.teacherId) === userId,
    ),
  );
}

type JavaCourse = Awaited<ReturnType<AcademyAuthorityService['course']>>;

export function commerceFromJava(course: JavaCourse) {
  const instructorShares =
    course.instructorShares?.map((item) => ({
      teacherId: String(item.userId),
      shareBps: item.shareBps,
    })) ??
    course.instructors
      ?.filter((item) => item.shareBps != null)
      .map((item) => ({
        teacherId: String(item.userId),
        shareBps: item.shareBps as number,
      })) ??
    [];
  // Omitted keys: Java has not shipped the columns yet → Nest offering fallback.
  // Present keys (including 0 / false / []): Java is the source of truth.
  if (
    course.enrollmentEnabled == null &&
    course.priceCredits == null &&
    course.instructorShares == null
  )
    return null;
  const rawPrice = String(course.priceCredits ?? 0);
  if (!/^(0|[1-9]\d{0,11})$/.test(rawPrice))
    throw new ConflictException(
      'Course price must be a nonnegative whole number of community points.',
    );
  const price = BigInt(rawPrice);
  const teacherId =
    instructorShares[0]?.teacherId ||
    (course.instructors?.[0] ? String(course.instructors[0].userId) : '');
  return {
    teacherId,
    priceCredits: price,
    teacherShareBps: instructorShares[0]?.shareBps ?? 0,
    instructorShares,
    enabled:
      course.enrollmentEnabled === true || course.enrollmentEnabled === 1,
    version: 1,
  };
}

/** An opaque safe-integer quote version; clients echo it unchanged on enrollment.
 * Java does not expose an offering revision. Bind its actual terms instead of
 * accepting the unrelated Nest offering version. Keep the DB revision separate.
 */
export function javaOfferingVersion(course: JavaCourse): number {
  const terms = commerceFromJava(course);
  if (!terms) throw new ConflictException('Course sale terms are unavailable.');
  const canonical = JSON.stringify({
    cell: CURRENT_CELL,
    courseId: String(course.id),
    published: course.published,
    certificateId: course.certificateId ?? null,
    price: terms.priceCredits.toString(),
    enabled: terms.enabled,
    teacherId: terms.teacherId,
    shares: [...terms.instructorShares].sort((a, b) =>
      a.teacherId.localeCompare(b.teacherId),
    ),
    instructors: (course.instructors ?? [])
      .map((item) => String(item.userId))
      .sort(),
  });
  return (
    Number.parseInt(
      createHash('sha256').update(canonical).digest('hex').slice(0, 13),
      16,
    ) + 1
  );
}

export function javaCommerceLive(
  commerce: NonNullable<ReturnType<typeof commerceFromJava>>,
) {
  return (
    commerce.enabled ||
    commerce.priceCredits > 0n ||
    commerce.instructorShares.some((item) => item.shareBps > 0)
  );
}

type Share = z.infer<typeof OfferingShare>;

export function offeringShares(input: {
  teacherId: string;
  teacherShareBps: number;
  shares?: Share[];
}): Share[] {
  return input.shares?.length
    ? input.shares
    : [{ teacherId: input.teacherId, shareBps: input.teacherShareBps }];
}

export function parsedOfferingShares(
  value: Prisma.JsonValue | null | undefined,
  fallback: Share,
): Share[] {
  const parsed = z.array(OfferingShare).safeParse(value);
  return parsed.success && parsed.data.length ? parsed.data : [fallback];
}

export function teacherShareBpsFor(
  teacherId: string | null,
  input: {
    javaShares: Share[];
    offering?: {
      teacherId: string;
      teacherShareBps: number;
      instructorShares: Prisma.JsonValue | null | undefined;
    } | null;
    sample?: {
      teacherId: string;
      teacherCredits: bigint;
      priceCredits: bigint;
    } | null;
  },
): number | null {
  const offeringShares = input.offering
    ? parsedOfferingShares(input.offering.instructorShares, {
        teacherId: input.offering.teacherId,
        shareBps: input.offering.teacherShareBps,
      })
    : [];
  const shares = input.javaShares.length ? input.javaShares : offeringShares;
  if (teacherId) {
    const mine = shares.find((share) => share.teacherId === teacherId);
    if (mine) return mine.shareBps;
    if (input.offering?.teacherId === teacherId)
      return input.offering.teacherShareBps;
    const sample = input.sample;
    if (sample && sample.teacherId === teacherId && sample.priceCredits > 0n) {
      return Number((sample.teacherCredits * 10000n) / sample.priceCredits);
    }
    return null;
  }
  if (shares[0]) return shares[0].shareBps;
  if (input.offering) return input.offering.teacherShareBps;
  if (input.sample && input.sample.priceCredits > 0n) {
    return Number(
      (input.sample.teacherCredits * 10000n) / input.sample.priceCredits,
    );
  }
  return null;
}

function javaInstructorShares(course: JavaCourse | null): Share[] {
  if (!course) return [];
  const commerce = commerceFromJava(course);
  if (commerce?.instructorShares.length) return commerce.instructorShares;
  return (
    course.instructors
      ?.filter((item) => item.shareBps != null)
      .map((item) => ({
        teacherId: String(item.userId),
        shareBps: item.shareBps as number,
      })) ?? []
  );
}

function courseTitleOf(course: JavaCourse | null, courseId: string) {
  return (
    course?.localized?.['en-US']?.title ||
    course?.localized?.['zh-CN']?.title ||
    courseId
  );
}

function enrollmentPayouts(row: AcademyEnrollment): {
  teacherId: string;
  credits: bigint;
}[] {
  const parsed = z
    .array(
      z.object({
        teacherId: z.string().regex(/^[1-9]\d{0,15}$/),
        credits: z.string().regex(/^\d+$/),
      }),
    )
    .safeParse(row.instructorShares);
  if (parsed.success && parsed.data.length)
    return parsed.data.map((item) => ({
      teacherId: item.teacherId,
      credits: BigInt(item.credits),
    }));
  return [{ teacherId: row.teacherId, credits: row.teacherCredits }];
}

function incomeKey(enrollmentId: string, payeeId: string, count: number) {
  return count <= 1
    ? `academy:teacher-income:${enrollmentId}`
    : `academy:teacher-income:${enrollmentId}:${payeeId}`;
}
function dto(row: AcademyEnrollment) {
  return {
    ...row,
    priceCredits: row.priceCredits.toString(),
    teacherCredits: row.teacherCredits.toString(),
    submittedAt: row.updatedAt.toISOString(),
  };
}

function instructorWhere(userId: string) {
  return {
    OR: [
      { teacherId: userId },
      { instructorShares: { array_contains: [{ teacherId: userId }] } },
    ],
  };
}

function taughtInMonth(userId: string, createdAt: { gte: Date; lt?: Date }) {
  return {
    AND: [instructorWhere(userId), { createdAt }],
  };
}

/** Product days for Academy workbench metrics use UTC+8 (SG and CN ops). */
export function academyMonthBounds(now = new Date()) {
  const shifted = new Date(now.getTime() + 8 * 3600_000);
  const year = shifted.getUTCFullYear();
  const month = shifted.getUTCMonth();
  const start = new Date(Date.UTC(year, month, 1) - 8 * 3600_000);
  const previous = new Date(Date.UTC(year, month - 1, 1) - 8 * 3600_000);
  return { start, previous };
}
@Injectable()
export class AcademyLearningService {
  constructor(
    private readonly db: PrismaService,
    private readonly authority: AcademyAuthorityService,
    private readonly mappings: AcademyMappingsService,
    private readonly wallet: WalletLedgerService,
    private readonly storage: MediaStorageAccessService,
    private readonly creators: LegacyCreatorsService,
  ) {}

  async playbackAccess(courseId: string, userId: string | null) {
    const [course, offer] = await Promise.all([
      this.authority.course(courseId),
      this.db.academyOffering.findUnique({ where: { courseId } }),
    ]);
    if (!course.published) return { allowed: false };
    const java = commerceFromJava(course);
    const configured = java ? javaCommerceLive(java) : Boolean(offer);
    // Unconfigured catalogue entries retain existing free playback behavior.
    if (!configured) return { allowed: true };
    const assigned = java
      ? { teacherId: java.teacherId, instructorShares: java.instructorShares }
      : offer
        ? {
            teacherId: offer.teacherId,
            instructorShares: parsedOfferingShares(offer.instructorShares, {
              teacherId: offer.teacherId,
              shareBps: offer.teacherShareBps,
            }),
          }
        : null;
    if (isCourseInstructor(course, userId, assigned)) return { allowed: true };
    if (!userId) return { allowed: false };
    const enrollment = await this.db.academyEnrollment.findUnique({
      where: { courseId_studentId: { courseId, studentId: userId } },
    });
    return { allowed: !!enrollment };
  }

  async offering(courseId: string, studentId?: string) {
    const course = await this.authority.course(courseId);
    if (!course.published) throw new NotFoundException('Course not found.');
    const [stored, enrollment] = await Promise.all([
      this.db.academyOffering.findUnique({ where: { courseId } }),
      studentId
        ? this.db.academyEnrollment.findUnique({
            where: { courseId_studentId: { courseId, studentId } },
          })
        : null,
    ]);
    const java = commerceFromJava(course);
    const assigned = java
      ? { teacherId: java.teacherId, instructorShares: java.instructorShares }
      : stored
        ? {
            teacherId: stored.teacherId,
            instructorShares: parsedOfferingShares(stored.instructorShares, {
              teacherId: stored.teacherId,
              shareBps: stored.teacherShareBps,
            }),
          }
        : null;
    return {
      instructor: isCourseInstructor(course, studentId, assigned),
      offering: java
        ? javaCommerceLive(java)
          ? {
              teacherId: java.teacherId,
              priceCredits: java.priceCredits.toString(),
              teacherShareBps: java.teacherShareBps,
              instructorShares: java.instructorShares,
              enabled: java.enabled,
              version: javaOfferingVersion(course),
            }
          : null
        : stored
          ? {
              ...stored,
              priceCredits: stored.priceCredits.toString(),
              instructorShares: parsedOfferingShares(stored.instructorShares, {
                teacherId: stored.teacherId,
                shareBps: stored.teacherShareBps,
              }),
            }
          : null,
      enrollment: enrollment ? dto(enrollment) : null,
    };
  }

  async editor(admin: AdminActor, courseId: string) {
    await this.mappings.editor(admin, courseId); // regional CoursesRead gate
    const [course, offering] = await Promise.all([
      this.authority.course(courseId),
      this.db.academyOffering.findUnique({ where: { courseId } }),
    ]);
    return {
      instructors: course.instructors ?? [],
      offering: offering
        ? {
            ...offering,
            priceCredits: offering.priceCredits.toString(),
            instructorShares: parsedOfferingShares(offering.instructorShares, {
              teacherId: offering.teacherId,
              shareBps: offering.teacherShareBps,
            }),
          }
        : null,
    };
  }

  async configure(
    admin: AdminActor,
    courseId: string,
    input: z.infer<typeof SaveOffering>,
  ) {
    if (
      admin.status !== 'active' ||
      !admin.permissions.includes(ADMIN_PERMISSION_KEYS.CoursesWrite) ||
      (admin.siteScope !== 'all' &&
        admin.siteScope !== (CURRENT_CELL === 'cn' ? 'cn' : 'global'))
    )
      throw new ForbiddenException(
        'Course management access for this region is required.',
      );
    const course = await this.authority.course(courseId);
    const instructorIds = (course.instructors ?? []).map((item) =>
      String(item.userId),
    );
    const shares = offeringShares(input);
    const seen = new Set<string>();
    let totalBps = 0;
    for (const share of shares) {
      if (seen.has(share.teacherId))
        throw new BadRequestException(
          'Each instructor can only have one share.',
        );
      seen.add(share.teacherId);
      if (!instructorIds.includes(share.teacherId))
        throw new BadRequestException(
          'Select a teacher assigned to this course.',
        );
      totalBps += share.shareBps;
    }
    if (totalBps > 10000)
      throw new BadRequestException('Instructor shares cannot exceed 100%.');
    const teacherId = shares[0]?.teacherId ?? input.teacherId;
    const teacherShareBps = shares[0]?.shareBps ?? input.teacherShareBps;
    if (input.enabled && !(await this.mappings.published(courseId)).certificate)
      throw new BadRequestException(
        'Assign an Academy skill certificate before enabling enrollment.',
      );
    return this.db.$transaction(async (tx) => {
      await this.lock(tx, `offering:${courseId}`);
      const previous = await tx.academyOffering.findUnique({
        where: { courseId },
      });
      if ((previous?.version ?? 0) !== input.expectedVersion)
        throw new ConflictException(
          'Course terms changed. Reload before saving.',
        );
      const data = {
        teacherId,
        priceCredits: BigInt(input.priceCredits),
        teacherShareBps,
        instructorShares: shares as Prisma.InputJsonValue,
        enabled: input.enabled,
      };
      const saved = await tx.academyOffering.upsert({
        where: { courseId },
        create: { courseId, ...data },
        update: { ...data, version: { increment: 1 } },
      });
      await tx.adminAuditLog.create({
        data: {
          actorUserId: admin.id,
          actorSessionId: admin.sessionId,
          siteScope: CURRENT_CELL === 'cn' ? 'cn' : 'global',
          action: 'academy.offering.save',
          resourceType: 'academy_course',
          resourceId: courseId,
          before: previous
            ? {
                ...previous,
                priceCredits: previous.priceCredits.toString(),
                updatedAt: previous.updatedAt.toISOString(),
              }
            : {},
          after: { ...input, version: saved.version },
        },
      });
      return {
        ...saved,
        priceCredits: saved.priceCredits.toString(),
        instructorShares: shares,
      };
    });
  }

  async enroll(courseId: string, studentId: string, expectedVersion: number) {
    const course = await this.authority.course(courseId);
    if (!course.published) throw new NotFoundException('Course not found.');
    const certificate = (await this.mappings.published(courseId)).certificate;
    if (!certificate)
      throw new ConflictException(
        'This course has no skill certificate assigned.',
      );
    return this.db.$transaction(async (tx) => {
      await this.lock(tx, `offering:${courseId}`);
      await this.lock(tx, `enroll:${courseId}:${studentId}`);
      const existing = await tx.academyEnrollment.findUnique({
        where: { courseId_studentId: { courseId, studentId } },
      });
      if (existing) return dto(existing); // one paid enrollment, including response-loss retries
      const stored = await tx.academyOffering.findUnique({
        where: { courseId },
      });
      const java = commerceFromJava(course);
      const offer = java
        ? java
        : stored
          ? {
              teacherId: stored.teacherId,
              priceCredits: stored.priceCredits,
              teacherShareBps: stored.teacherShareBps,
              instructorShares: parsedOfferingShares(stored.instructorShares, {
                teacherId: stored.teacherId,
                shareBps: stored.teacherShareBps,
              }),
              enabled: stored.enabled,
              version: stored.version,
            }
          : null;
      if (
        !offer?.enabled ||
        (java ? javaOfferingVersion(course) : offer.version) !== expectedVersion
      )
        throw new ConflictException(
          'Course enrollment terms changed. Reload before purchasing.',
        );
      const shares = offer.instructorShares.length
        ? offer.instructorShares
        : parsedOfferingShares(null, {
            teacherId: offer.teacherId,
            shareBps: offer.teacherShareBps,
          });
      if (
        !/^[1-9]\d{0,15}$/.test(offer.teacherId) ||
        shares.some((share) => !/^[1-9]\d{0,15}$/.test(share.teacherId))
      )
        throw new ConflictException('Course teacher assignment is incomplete.');
      if (
        shares.some(
          (share) =>
            !course.instructors?.some(
              (i) => String(i.userId) === share.teacherId,
            ),
        )
      )
        throw new ConflictException(
          'The assigned teacher is no longer available.',
        );
      if (
        isCourseInstructor(course, studentId, {
          teacherId: offer.teacherId,
          instructorShares: shares,
        })
      )
        throw new ForbiddenException(
          'Course teachers cannot purchase their own course.',
        );
      const totalBps = shares.reduce((sum, share) => sum + share.shareBps, 0);
      if (totalBps > 10000)
        throw new ConflictException(
          'Course instructor shares are misconfigured.',
        );
      const payouts = shares.map((share) => ({
        teacherId: share.teacherId,
        credits: teacherShare(offer.priceCredits, share.shareBps),
      }));
      const teacherCredits = payouts.reduce(
        (sum, item) => sum + item.credits,
        0n,
      );
      if (teacherCredits > offer.priceCredits)
        throw new ConflictException(
          'Course instructor shares are misconfigured.',
        );
      try {
        const row = await tx.academyEnrollment.create({
          data: {
            courseId,
            studentId,
            teacherId: offer.teacherId,
            certificateId: certificate.id,
            offeringVersion: offer.version,
            priceCredits: offer.priceCredits,
            teacherCredits,
            instructorShares: payouts.map((item) => ({
              teacherId: item.teacherId,
              credits: item.credits.toString(),
            })),
          },
        });
        if (offer.priceCredits > 0n) {
          const account = await ensureWalletAccount(tx, {
            ownerType: 'user',
            ownerId: studentId,
            currency: 'community_point',
            balanceKind: 'consumable',
          });
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`wallet:account:${account.id}`})::bigint)`;
          await expireLapsedGrantsTx(tx, account.id);
          await this.wallet.postEntryTx(tx, {
            accountId: account.id,
            entryType: 'debit',
            amount: offer.priceCredits,
            availableDelta: -offer.priceCredits,
            heldDelta: 0n,
            reason: 'Academy course enrollment',
            sourceType: 'academy_enrollment',
            sourceId: row.id,
            idempotencyKey: `academy:purchase:${row.id}`,
            actorUserId: studentId,
          });
        }
        await this.event(tx, row, studentId, 'enrolled', {
          priceCredits: offer.priceCredits.toString(),
          certificateId: certificate.id,
        });
        return dto(row);
      } catch (error) {
        if (
          error instanceof BadRequestException ||
          error instanceof ConflictException ||
          error instanceof ForbiddenException ||
          error instanceof NotFoundException
        )
          throw error;
        const detail = error instanceof Error ? error.message : '';
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === 'P2002'
        )
          throw new ConflictException(
            'You are already enrolled in this course.',
          );
        if (/check constraint|academy_enrollments/i.test(detail))
          throw new ConflictException(
            'Course enrollment terms are invalid. Reload and try again.',
          );
        throw error;
      }
    });
  }

  async submit(
    id: string,
    studentId: string,
    input: z.infer<typeof SubmitHomework>,
  ) {
    return this.db.$transaction(async (tx) => {
      const row = await this.lockEnrollment(tx, id);
      if (row.studentId !== studentId)
        throw new NotFoundException('Enrollment not found.');
      if (
        row.version !== input.expectedVersion ||
        !['enrolled', 'revision'].includes(row.status)
      )
        throw new ConflictException(
          'Homework changed. Reload before submitting.',
        );
      await lockMediaAssetReferences(tx, input.assetIds);
      const assets = await tx.mediaAsset.findMany({
        where: {
          id: { in: input.assetIds },
          createdByUserId: studentId,
          status: 'ready',
          visibility: 'private',
          moderationStatus: { notIn: ['blocked'] },
          storageProvider: { not: 'external_url' },
        },
      });
      if (assets.length !== input.assetIds.length)
        throw new BadRequestException(
          'Use your own completed private uploads.',
        );
      // Keep all submitted versions reachable for review/audit and storage retention.
      await tx.mediaAssetUsage.createMany({
        data: input.assetIds.map((assetId) => ({
          assetId,
          userId: studentId,
          surface: 'system' as const,
          sourceSurface: 'academy_homework',
          role: 'attachment' as const,
          idempotencyKey: `academy-homework:${id}:${row.version + 1}:${assetId}`,
          metadata: { enrollmentId: id, version: row.version + 1 },
        })),
        skipDuplicates: true,
      });
      const updated = await tx.academyEnrollment.update({
        where: { id },
        data: {
          status: 'submitted',
          version: { increment: 1 },
          description: input.description,
          assetIds: input.assetIds,
          score: null,
          feedback: null,
          reviewedAt: null,
        },
      });
      await this.event(tx, updated, studentId, 'submitted', {
        description: input.description,
        assetIds: input.assetIds,
      });
      return dto(updated);
    });
  }

  async review(
    id: string,
    teacherId: string,
    input: z.infer<typeof ReviewHomework>,
  ) {
    const record = await this.db.academyEnrollment.findUnique({
      where: { id },
    });
    if (!record || record.studentId === teacherId)
      throw new NotFoundException('Homework not found.');
    await this.teacher(record, teacherId);
    return this.applyReview(id, teacherId, input);
  }

  /** Admin-ui review: bound lecturers act as themselves; unbound ops act for the course teacher. */
  async adminReview(
    admin: AdminActor,
    id: string,
    input: z.infer<typeof ReviewHomework>,
  ) {
    this.requireCoursesWrite(admin);
    const record = await this.db.academyEnrollment.findUnique({
      where: { id },
    });
    if (!record) throw new NotFoundException('Homework not found.');
    const boundTeacherId = admin.platformUserId?.trim() || null;
    if (boundTeacherId) {
      await this.teacher(record, boundTeacherId);
      return this.applyReview(id, boundTeacherId, input);
    }
    return this.applyReview(id, `admin:${admin.id}`, input, {
      walletActorUserId: record.teacherId,
    });
  }

  private async applyReview(
    id: string,
    actorId: string,
    input: z.infer<typeof ReviewHomework>,
    options?: { walletActorUserId?: string },
  ) {
    const walletActor = options?.walletActorUserId ?? actorId;
    const result = await this.db.$transaction(async (tx) => {
      const row = await this.lockEnrollment(tx, id);
      if (row.status !== 'submitted' || row.version !== input.expectedVersion)
        throw new ConflictException(
          'Homework changed or was already reviewed. Reload it.',
        );
      const updated = await tx.academyEnrollment.update({
        where: { id },
        data: {
          status: input.decision,
          score: input.score,
          feedback: input.feedback,
          reviewedAt: new Date(),
          version: { increment: 1 },
        },
      });
      if (input.decision === 'approved') {
        const payouts = enrollmentPayouts(row).filter(
          (item) => item.credits > 0n,
        );
        for (const payout of payouts) {
          const account = await ensureWalletAccount(tx, {
            ownerType: 'user',
            ownerId: payout.teacherId,
            currency: 'community_point',
            balanceKind: 'withdrawable',
          });
          await this.wallet.postEntryTx(tx, {
            accountId: account.id,
            entryType: 'credit',
            amount: payout.credits,
            availableDelta: payout.credits,
            heldDelta: 0n,
            reason: 'Academy homework approved',
            sourceType: 'HOMEWORK_REVIEW_INCOME',
            sourceId: id,
            idempotencyKey: incomeKey(id, payout.teacherId, payouts.length),
            actorUserId: walletActor,
          });
        }
      }
      await this.event(tx, updated, actorId, input.decision, {
        score: input.score,
        feedback: input.feedback,
      });
      return dto(updated);
    });
    if (input.decision === 'approved') await this.issueBadge(id);
    return result;
  }

  async adminHomework(
    admin: AdminActor,
    after?: string,
    status?: 'submitted' | 'all',
  ) {
    const teacherId = admin.platformUserId?.trim() || null;
    const rows = await this.db.academyEnrollment.findMany({
      where: {
        ...(teacherId ? instructorWhere(teacherId) : {}),
        ...(status === 'submitted' ? { status: 'submitted' } : {}),
        ...(after ? { id: { lt: after } } : {}),
      },
      orderBy: { id: 'desc' },
      take: 21,
    });
    const page = rows.slice(0, 20);
    const creatorRows = await this.creators.publicCreatorBatch([
      ...new Set([
        ...page.map((row) => row.studentId),
        ...page.map((row) => row.teacherId),
      ]),
    ]);
    const creators = new Map(
      await Promise.all(
        creatorRows.map(async (row) => {
          const display = await this.creators.publicCreatorDisplay(row);
          return [display.id, display] as const;
        }),
      ),
    );
    const items: Array<
      ReturnType<typeof dto> & {
        studentName: string;
        studentAvatar: string | null;
        teacherName: string;
        courseTitle: string;
      }
    > = [];
    for (const row of page) {
      const course = await this.authority
        .course(row.courseId)
        .catch((error: unknown) => {
          // A deleted course cannot authorize a lecturer. An unavailable authority
          // is not an empty queue: preserve the error so the operator can retry.
          if (error instanceof NotFoundException) return null;
          throw error;
        });
      if (teacherId) {
        if (!course?.instructors?.some((i) => String(i.userId) === teacherId))
          continue;
      }
      const student = creators.get(row.studentId);
      items.push({
        ...dto(row),
        studentName: student?.name ?? row.studentId,
        studentAvatar: student?.avatarUrl ?? null,
        teacherName: creators.get(row.teacherId)?.name ?? row.teacherId,
        courseTitle:
          course?.localized?.['en-US']?.title ||
          course?.localized?.['zh-CN']?.title ||
          row.courseId,
      });
    }
    return {
      items,
      nextCursor: rows.length > 20 ? page.at(-1)!.id : null,
      scope: teacherId ? ('lecturer' as const) : ('operator' as const),
      platformUserId: teacherId,
    };
  }

  async adminIncomeSummary(admin: AdminActor) {
    const teacherId = admin.platformUserId?.trim() || null;
    if (teacherId) {
      return {
        ...(await this.teachingSummary(teacherId)),
        scope: 'lecturer' as const,
        platformUserId: teacherId,
      };
    }
    const { start, previous } = academyMonthBounds();
    const [
      offered,
      enrolledCourses,
      students,
      pending,
      earnings,
      monthly,
      previousMonth,
    ] = await Promise.all([
      this.db.academyOffering.findMany({ select: { courseId: true } }),
      this.db.academyEnrollment.groupBy({
        by: ['courseId'],
        _count: { courseId: true },
      }),
      this.db.academyEnrollment.groupBy({
        by: ['studentId'],
        _count: { studentId: true },
      }),
      this.db.academyEnrollment.count({ where: { status: 'submitted' } }),
      this.db.academyEnrollment.aggregate({
        where: { status: 'approved' },
        _sum: { teacherCredits: true },
      }),
      this.db.academyEnrollment.groupBy({
        by: ['studentId'],
        where: { createdAt: { gte: start } },
        _count: { studentId: true },
      }),
      this.db.academyEnrollment.groupBy({
        by: ['studentId'],
        where: { createdAt: { gte: previous, lt: start } },
        _count: { studentId: true },
      }),
    ]);
    return {
      courses: new Set([
        ...offered.map((row) => row.courseId),
        ...enrolledCourses.map((row) => row.courseId),
      ]).size,
      students: students.length,
      pending,
      monthlyNewStudents: monthly.length,
      previousMonthNewStudents: previousMonth.length,
      earnedCredits: (earnings._sum.teacherCredits ?? 0n).toString(),
      scope: 'operator' as const,
      platformUserId: null as string | null,
    };
  }

  async adminTeachingCourses(admin: AdminActor) {
    const teacherId = admin.platformUserId?.trim() || null;
    const taught = teacherId ? instructorWhere(teacherId) : {};
    const [offerings, enrollments, earnings] = await Promise.all([
      this.db.academyOffering.findMany({
        where: taught,
        select: {
          courseId: true,
          teacherId: true,
          teacherShareBps: true,
          instructorShares: true,
        },
      }),
      this.db.academyEnrollment.findMany({
        where: taught,
        select: {
          courseId: true,
          studentId: true,
          teacherId: true,
          teacherCredits: true,
          priceCredits: true,
        },
      }),
      teacherId
        ? this.db.$queryRaw<{ courseId: string; earned: bigint }[]>`
            SELECT ae.course_id AS "courseId",
                   COALESCE(SUM(e.teacher_credits),0) AS earned
            FROM (${academyPayeesSql}) e
            INNER JOIN academy_enrollments ae ON ae.id = e.id
            WHERE e.teacher_id=${teacherId} AND e.status='approved'
            GROUP BY ae.course_id`
        : this.db.$queryRaw<{ courseId: string; earned: bigint }[]>`
            SELECT ae.course_id AS "courseId",
                   COALESCE(SUM(e.teacher_credits),0) AS earned
            FROM (${academyPayeesSql}) e
            INNER JOIN academy_enrollments ae ON ae.id = e.id
            WHERE e.status='approved'
            GROUP BY ae.course_id`,
    ]);
    const earnedByCourse = new Map(
      earnings.map((row) => [row.courseId, row.earned ?? 0n]),
    );
    const offeringByCourse = new Map(
      offerings.map((row) => [row.courseId, row] as const),
    );
    const courseIds = [
      ...new Set([
        ...offerings.map((row) => row.courseId),
        ...enrollments.map((row) => row.courseId),
      ]),
    ];
    const items: Array<{
      courseId: string;
      courseTitle: string;
      shareBps: number | null;
      students: number;
      earnedCredits: string;
    }> = [];
    for (const courseId of courseIds) {
      const course = await this.authority.course(courseId).catch(() => null);
      const rows = enrollments.filter((row) => row.courseId === courseId);
      items.push({
        courseId,
        courseTitle: courseTitleOf(course, courseId),
        shareBps: teacherShareBpsFor(teacherId, {
          javaShares: javaInstructorShares(course),
          offering: offeringByCourse.get(courseId) ?? null,
          sample: rows[0] ?? null,
        }),
        students: new Set(rows.map((row) => row.studentId)).size,
        earnedCredits: (earnedByCourse.get(courseId) ?? 0n).toString(),
      });
    }
    items.sort(
      (left, right) =>
        Number(right.earnedCredits) - Number(left.earnedCredits) ||
        left.courseTitle.localeCompare(right.courseTitle, 'zh-CN'),
    );
    return {
      items,
      scope: teacherId ? ('lecturer' as const) : ('operator' as const),
      platformUserId: teacherId,
    };
  }

  async adminAttachment(admin: AdminActor, id: string, assetId: string) {
    const row = await this.db.academyEnrollment.findUnique({ where: { id } });
    if (!row || !row.assetIds.includes(assetId))
      throw new NotFoundException('Attachment not found.');
    const teacherId = admin.platformUserId?.trim() || null;
    if (teacherId) await this.teacher(row, teacherId);
    const asset = await this.db.mediaAsset.findFirst({
      where: {
        id: assetId,
        createdByUserId: row.studentId,
        status: 'ready',
        moderationStatus: { notIn: ['blocked'] },
      },
    });
    if (!asset) throw new NotFoundException('Attachment is unavailable.');
    return this.storage.createReadUrl(asset, {
      expiresInSeconds: 120,
      cacheControl: 'private, no-store',
      filename: 'homework',
    });
  }

  private requireCoursesWrite(admin: AdminActor) {
    if (
      admin.status !== 'active' ||
      !admin.permissions.includes(ADMIN_PERMISSION_KEYS.CoursesWrite) ||
      (admin.siteScope !== 'all' &&
        admin.siteScope !== (CURRENT_CELL === 'cn' ? 'cn' : 'global'))
    )
      throw new ForbiddenException(
        'Course management access for this region is required.',
      );
  }

  async issueBadge(id: string) {
    // Approval is durable before the external call. Re-entry/retries serialize
    // by student+certificate and read Java first after uncertain responses.
    const record = await this.db.academyEnrollment.findUnique({
      where: { id },
    });
    if (!record || record.status !== 'approved' || record.badgeIssuedAt) return;
    try {
      await this.db.$transaction(
        async (tx) => {
          await this.lock(
            tx,
            `badge:${record.studentId}:${record.certificateId}`,
          );
          const fresh = await tx.academyEnrollment.findUniqueOrThrow({
            where: { id },
          });
          if (fresh.badgeIssuedAt) return;
          await this.authority.grantSkill(
            record.studentId,
            record.certificateId,
          );
          await tx.academyEnrollment.update({
            where: { id },
            data: { badgeIssuedAt: new Date(), badgeError: null },
          });
        },
        { timeout: 30000 },
      );
    } catch {
      await this.db.academyEnrollment.updateMany({
        where: { id, badgeIssuedAt: null },
        data: {
          badgeError:
            'Certificate delivery is pending. It will retry automatically.',
        },
      });
    }
  }

  async retryBadges() {
    const rows = await this.db.academyEnrollment.findMany({
      where: { status: 'approved', badgeIssuedAt: null },
      orderBy: { updatedAt: 'asc' },
      take: 10,
    });
    for (const row of rows) await this.issueBadge(row.id);
  }

  async teachingSummary(userId: string) {
    const taught = instructorWhere(userId);
    const { start, previous } = academyMonthBounds();
    const [
      offered,
      enrolledCourses,
      students,
      pending,
      earnings,
      monthly,
      previousMonth,
    ] = await Promise.all([
      this.db.academyOffering.findMany({
        where: taught,
        select: { courseId: true },
      }),
      this.db.academyEnrollment.groupBy({
        by: ['courseId'],
        where: taught,
        _count: { courseId: true },
      }),
      this.db.academyEnrollment.groupBy({
        by: ['studentId'],
        where: taught,
        _count: { studentId: true },
      }),
      this.db.academyEnrollment.count({
        where: { AND: [instructorWhere(userId), { status: 'submitted' }] },
      }),
      this.db.$queryRaw<
        { earned: bigint }[]
      >`SELECT COALESCE(SUM(e.teacher_credits),0) AS earned
        FROM (${academyPayeesSql}) e WHERE e.teacher_id=${userId} AND e.status='approved'`,
      this.db.academyEnrollment.groupBy({
        by: ['studentId'],
        where: taughtInMonth(userId, { gte: start }),
        _count: { studentId: true },
      }),
      this.db.academyEnrollment.groupBy({
        by: ['studentId'],
        where: taughtInMonth(userId, { gte: previous, lt: start }),
        _count: { studentId: true },
      }),
    ]);
    return {
      courses: new Set([
        ...offered.map((row) => row.courseId),
        ...enrolledCourses.map((row) => row.courseId),
      ]).size,
      students: students.length,
      pending,
      monthlyNewStudents: monthly.length,
      previousMonthNewStudents: previousMonth.length,
      earnedCredits: (earnings[0]?.earned ?? 0n).toString(),
    };
  }

  async list(userId: string, teacher: boolean, after?: string) {
    const rows = await this.db.academyEnrollment.findMany({
      where: {
        ...(teacher ? instructorWhere(userId) : { studentId: userId }),
        ...(after ? { id: { lt: after } } : {}),
      },
      orderBy: { id: 'desc' },
      take: 21,
    });
    // Instructors removed from a course lose access to its student work.
    const page = rows.slice(0, 20);
    const names = await this.creators.publicCreatorBatch([
      ...new Set(page.map((row) => row.studentId)),
    ]);
    const visible: (ReturnType<typeof dto> & {
      studentName: string;
      courseTitle: string;
    })[] = [];
    for (const row of page) {
      const course = await this.authority
        .course(row.courseId)
        .catch((error: unknown) => {
          // An enrollment outlives its catalogue record. Preserve the student's
          // history, but never infer teacher access when authority is unavailable.
          // Other upstream failures must remain visible rather than looking empty.
          if (error instanceof NotFoundException) return null;
          throw error;
        });
      if (teacher) {
        if (!isCourseInstructor(course, userId)) continue;
      }
      visible.push({
        ...dto(row),
        studentName:
          names.find((n) => n.id === row.studentId)?.nick_name ?? row.studentId,
        courseTitle:
          course?.localized?.['en-US']?.title ||
          course?.localized?.['zh-CN']?.title ||
          row.courseId,
      });
    }
    return {
      items: visible,
      nextCursor: rows.length > 20 ? page.at(-1)!.id : null,
    };
  }

  async attachment(id: string, assetId: string, userId: string) {
    const row = await this.db.academyEnrollment.findUnique({ where: { id } });
    if (!row || !row.assetIds.includes(assetId))
      throw new NotFoundException('Attachment not found.');
    if (row.studentId !== userId) {
      try {
        await this.teacher(row, userId);
      } catch (error: unknown) {
        if (
          error instanceof ForbiddenException ||
          error instanceof NotFoundException
        )
          throw new NotFoundException('Attachment not found.');
        throw error;
      }
    }
    const asset = await this.db.mediaAsset.findFirst({
      where: {
        id: assetId,
        createdByUserId: row.studentId,
        status: 'ready',
        moderationStatus: { notIn: ['blocked'] },
      },
    });
    if (!asset) throw new NotFoundException('Attachment is unavailable.');
    return this.storage.createReadUrl(asset, {
      expiresInSeconds: 120,
      cacheControl: 'private, no-store',
      filename: 'homework',
    });
  }
  private async teacher(row: AcademyEnrollment, userId: string) {
    const course = await this.authority.course(row.courseId);
    if (row.studentId === userId || !isCourseInstructor(course, userId))
      throw new ForbiddenException(
        'Only the assigned course teacher can review this homework.',
      );
  }
  private async lock(tx: Prisma.TransactionClient, key: string) {
    // hashtext is available on every supported Postgres; hashtextextended needs PG14+.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`academy:${key}`})::bigint)`;
  }
  private async lockEnrollment(tx: Prisma.TransactionClient, id: string) {
    await tx.$queryRaw`SELECT id FROM academy_enrollments WHERE id=${id}::uuid FOR UPDATE`;
    const row = await tx.academyEnrollment.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('Enrollment not found.');
    return row;
  }
  private async event(
    tx: Prisma.TransactionClient,
    row: AcademyEnrollment,
    actorId: string,
    kind: string,
    details: Prisma.InputJsonValue,
  ) {
    await tx.academyEnrollmentEvent.create({
      data: {
        enrollmentId: row.id,
        actorId,
        kind,
        version: row.version,
        details,
      },
    });
  }
}
