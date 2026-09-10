import { ConflictException, ForbiddenException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

type Db = Pick<Prisma.TransactionClient, '$queryRaw' | '$executeRaw'>;

export async function lockCrewStorage(tx: Db, crewId: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`crew-storage:${crewId}`}, 0))`;
}

/** One row per physical asset, including Trash and confirmed unclaimed uploads. */
export async function crewStorageUsage(tx: Db, crewId: string) {
  const [row] = await tx.$queryRaw<
    Array<{ total: bigint; used: bigint; reserved: bigint; unknown: bigint }>
  >(Prisma.sql`
    WITH ids AS (
      SELECT id FROM media_assets WHERE deleted_at IS NULL AND metadata->>'crewId'=${crewId}
      UNION SELECT media_asset_id FROM crew_asset_nodes WHERE crew_id=${crewId} AND media_asset_id IS NOT NULL
    ), usage AS (
      SELECT COALESCE(SUM(m.size_bytes),0)::bigint AS used,
        COUNT(*) FILTER (WHERE m.size_bytes IS NULL)::bigint AS unknown
      FROM media_assets m JOIN ids ON ids.id=m.id WHERE m.deleted_at IS NULL
    )
    SELECT c.storage_limit_bytes AS total, usage.used, usage.unknown,
      COALESCE((SELECT SUM(r.size_bytes) FROM crew_upload_reservations r WHERE r.crew_id=c.id AND r.state='pending' AND r.expires_at > clock_timestamp()),0)::bigint AS reserved
    FROM crews c CROSS JOIN usage WHERE c.id=${crewId}`);
  if (!row) throw new ForbiddenException('Crew not found');
  return {
    totalBytes: Number(row.total),
    usedBytes: Number(row.used),
    reservedBytes: Number(row.reserved),
    remainingBytes:
      row.unknown > 0n
        ? 0
        : Math.max(0, Number(row.total - row.used - row.reserved)),
    unknownSizeCount: Number(row.unknown),
  };
}

export async function reserveCrewUpload(
  tx: Db,
  crewId: string,
  userId: string,
  key: string,
  size: number,
  expiresAt: Date,
) {
  await lockCrewStorage(tx, crewId);
  const usage = await crewStorageUsage(tx, crewId);
  if (usage.unknownSizeCount || size > usage.remainingBytes)
    throw new ConflictException({
      code: 'CREW_STORAGE_QUOTA_EXCEEDED',
      message: usage.unknownSizeCount
        ? 'Crew storage includes files awaiting size verification.'
        : 'Crew storage allowance exceeded.',
    });
  await tx.$executeRaw`INSERT INTO crew_upload_reservations (storage_key, crew_id, user_id, size_bytes, expires_at) VALUES (${key}, ${crewId}, ${userId}, ${BigInt(size)}, ${expiresAt.toISOString()}::timestamptz)`;
}

export async function completeCrewUpload(
  tx: Db,
  crewId: string,
  userId: string,
  key: string,
  actualBytes: number,
) {
  await lockCrewStorage(tx, crewId);
  const reservation = await requireCrewReservation(tx, crewId, userId, key);
  const usage = await crewStorageUsage(tx, crewId);
  if (
    usage.unknownSizeCount ||
    usage.usedBytes +
      usage.reservedBytes -
      Number(reservation.size_bytes) +
      actualBytes >
      usage.totalBytes ||
    actualBytes > 5 * 1024 ** 3
  )
    throw new ConflictException(
      'Stored file exceeds the Crew upload allowance.',
    );
  await tx.$executeRaw`UPDATE crew_upload_reservations SET state='completed' WHERE storage_key=${key}`;
}

export async function cancelCrewUpload(
  tx: Db,
  crewId: string,
  userId: string,
  key: string,
) {
  await lockCrewStorage(tx, crewId);
  await tx.$executeRaw`UPDATE crew_upload_reservations SET state='cancelled', cleaned_at=NULL WHERE storage_key=${key} AND crew_id=${crewId} AND user_id=${userId} AND state IN ('pending','cancelled')`;
}

export async function requireCrewReservation(
  tx: Db,
  crewId: string,
  userId: string,
  key: string,
) {
  const [reservation] = await tx.$queryRaw<
    Array<{ size_bytes: bigint }>
  >`SELECT size_bytes FROM crew_upload_reservations WHERE storage_key=${key} AND crew_id=${crewId} AND user_id=${userId} AND state='pending' AND expires_at > clock_timestamp() FOR UPDATE`;
  if (!reservation)
    throw new ConflictException({
      code: 'CREW_UPLOAD_RESERVATION_EXPIRED',
      message:
        'Crew upload reservation expired or cancelled. Start the upload again.',
    });
  return reservation;
}
