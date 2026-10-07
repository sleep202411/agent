import { lockMediaAssetReferences } from '../media/media-asset-lifecycle-lock';
import { LegacyCreatorsService } from '../legacy-creators/legacy-creators.service';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { AcademyEnrollment, Prisma } from '@prisma/client';
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
} from './academy-learning.dto';

export function teacherShare(price: bigint, bps: number) {
  return (price * BigInt(bps)) / 10000n;
}
function dto(row: AcademyEnrollment) {
  return {
    ...row,
    priceCredits: row.priceCredits.toString(),
    teacherCredits: row.teacherCredits.toString(),
  };
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
    const offer = await this.db.academyOffering.findUnique({
      where: { courseId },
    });
    // Unconfigured catalogue entries retain existing free playback behavior.
    if (!offer) return { allowed: true };
    if (!userId) return { allowed: false };
    const enrollment = await this.db.academyEnrollment.findUnique({
      where: { courseId_studentId: { courseId, studentId: userId } },
    });
    return { allowed: !!enrollment };
  }

  async offering(courseId: string, studentId?: string) {
    const course = await this.authority.course(courseId);
    if (!course.published) throw new NotFoundException('Course not found.');
    const [offering, enrollment] = await Promise.all([
      this.db.academyOffering.findUnique({ where: { courseId } }),
      studentId
        ? this.db.academyEnrollment.findUnique({
            where: { courseId_studentId: { courseId, studentId } },
          })
        : null,
    ]);
    return {
      offering: offering
        ? { ...offering, priceCredits: offering.priceCredits.toString() }
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
        ? { ...offering, priceCredits: offering.priceCredits.toString() }
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
    if (!course.instructors?.some((i) => String(i.userId) === input.teacherId))
      throw new BadRequestException(
        'Select a teacher assigned to this course.',
      );
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
        teacherId: input.teacherId,
        priceCredits: BigInt(input.priceCredits),
        teacherShareBps: input.teacherShareBps,
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
      return { ...saved, priceCredits: saved.priceCredits.toString() };
    });
  }

  async enroll(courseId: string, studentId: string, expectedVersion: number) {
    const course = await this.authority.course(courseId);
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
      const offer = await tx.academyOffering.findUnique({
        where: { courseId },
      });
      if (!offer?.enabled || offer.version !== expectedVersion)
        throw new ConflictException(
          'Course enrollment terms changed. Reload before purchasing.',
        );
      if (
        !course.instructors?.some((i) => String(i.userId) === offer.teacherId)
      )
        throw new ConflictException(
          'The assigned teacher is no longer available.',
        );
      if (course.instructors.some((i) => String(i.userId) === studentId))
        throw new ForbiddenException(
          'Course teachers cannot purchase their own course.',
        );
      const row = await tx.academyEnrollment.create({
        data: {
          courseId,
          studentId,
          teacherId: offer.teacherId,
          certificateId: certificate.id,
          offeringVersion: offer.version,
          priceCredits: offer.priceCredits,
          teacherCredits: teacherShare(
            offer.priceCredits,
            offer.teacherShareBps,
          ),
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
    if (!record || record.teacherId !== teacherId)
      throw new NotFoundException('Homework not found.');
    await this.teacher(record, teacherId);
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
      if (input.decision === 'approved' && row.teacherCredits > 0n) {
        const account = await ensureWalletAccount(tx, {
          ownerType: 'user',
          ownerId: teacherId,
          currency: 'community_point',
          balanceKind: 'withdrawable',
        });
        await this.wallet.postEntryTx(tx, {
          accountId: account.id,
          entryType: 'credit',
          amount: row.teacherCredits,
          availableDelta: row.teacherCredits,
          heldDelta: 0n,
          reason: 'Academy homework approved',
          sourceType: 'HOMEWORK_REVIEW_INCOME',
          sourceId: id,
          idempotencyKey: `academy:teacher-income:${id}`,
          actorUserId: teacherId,
        });
      }
      await this.event(tx, updated, teacherId, input.decision, {
        score: input.score,
        feedback: input.feedback,
      });
      return dto(updated);
    });
    if (input.decision === 'approved') await this.issueBadge(id);
    return result;
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
    const [courses, students, pending, earnings] = await Promise.all([
      this.db.academyOffering.count({ where: { teacherId: userId } }),
      this.db.academyEnrollment.count({ where: { teacherId: userId } }),
      this.db.academyEnrollment.count({
        where: { teacherId: userId, status: 'submitted' },
      }),
      this.db.academyEnrollment.aggregate({
        where: { teacherId: userId, status: 'approved' },
        _sum: { teacherCredits: true },
      }),
    ]);
    return {
      courses,
      students,
      pending,
      earnedCredits: (earnings._sum.teacherCredits ?? 0n).toString(),
    };
  }

  async list(userId: string, teacher: boolean, after?: string) {
    const rows = await this.db.academyEnrollment.findMany({
      where: {
        ...(teacher ? { teacherId: userId } : { studentId: userId }),
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
      const course = await this.authority.course(row.courseId);
      if (teacher) {
        if (!course.instructors?.some((i) => String(i.userId) === userId))
          continue;
      }
      visible.push({
        ...dto(row),
        studentName:
          names.find((n) => n.id === row.studentId)?.nick_name ?? row.studentId,
        courseTitle:
          course.localized?.['en-US']?.title ||
          course.localized?.['zh-CN']?.title ||
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
    if (
      !row ||
      !row.assetIds.includes(assetId) ||
      ![row.studentId, row.teacherId].includes(userId)
    )
      throw new NotFoundException('Attachment not found.');
    if (userId === row.teacherId) await this.teacher(row, userId);
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
    if (
      row.teacherId !== userId ||
      row.studentId === userId ||
      !course.instructors?.some((i) => String(i.userId) === userId)
    )
      throw new ForbiddenException(
        'Only the assigned course teacher can review this homework.',
      );
  }
  private async lock(tx: Prisma.TransactionClient, key: string) {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`academy:${key}`},0))`;
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
