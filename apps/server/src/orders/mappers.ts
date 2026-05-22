/**
 * DB row → wire DTO conversions for orders.
 */
import type { ServiceOrder } from '@prisma/client';
import {
  type OrderBindings,
  type OrderCancelInfo,
  type OrderCardDTO,
  type OrderDTO,
  type OrderPackageSnapshot,
  type OrderParticipantRole,
  type OrderQuestionnaireEntry,
  type OrderStatus,
} from '@repo/shared/order';

export function toOrderDTO(row: ServiceOrder): OrderDTO {
  return {
    id: row.id,
    buyerId: row.buyerId,
    creatorId: row.creatorId,
    serviceId: row.serviceId,
    packageSnapshot: row.packageSnapshot as unknown as OrderPackageSnapshot,
    status: row.status as OrderStatus,
    questionnaire: (row.questionnaire ??
      []) as unknown as OrderQuestionnaireEntry[],
    conversationId: row.conversationId,
    bindings: {
      ipId: row.ipId,
      episodeId: row.episodeId,
      crewId: row.crewId,
      crewPositionId: row.crewPositionId,
    } satisfies OrderBindings,
    version: row.version,
    createdAt: row.createdAt.toISOString(),
    acceptedAt: row.acceptedAt ? row.acceptedAt.toISOString() : null,
    deliveredAt: row.deliveredAt ? row.deliveredAt.toISOString() : null,
    completedAt: row.completedAt ? row.completedAt.toISOString() : null,
    cancelledAt: row.cancelledAt ? row.cancelledAt.toISOString() : null,
    cancelInfo: (row.cancelInfo ?? null) as OrderCancelInfo | null,
  };
}

export function toOrderCardDTO(
  row: ServiceOrder & {
    service: { title: string };
    _unreadCount?: number;
    _lastActivityAt?: Date;
  },
  viewerId: string,
): OrderCardDTO {
  const snap = row.packageSnapshot as unknown as OrderPackageSnapshot;
  const isBuyer = viewerId === row.buyerId;
  const counterpartyRole: OrderParticipantRole = isBuyer ? 'creator' : 'buyer';
  const counterpartyId = isBuyer ? row.creatorId : row.buyerId;
  return {
    id: row.id,
    serviceId: row.serviceId,
    serviceTitle: row.service.title,
    packageTier: snap.tier,
    status: row.status as OrderStatus,
    totalPrice: snap.price,
    currency: snap.currency,
    counterpartyId,
    counterpartyRole,
    lastActivityAt: (row._lastActivityAt ?? row.createdAt).toISOString(),
    unreadCount: row._unreadCount ?? 0,
  };
}
