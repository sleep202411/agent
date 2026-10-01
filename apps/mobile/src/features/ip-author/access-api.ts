import { z } from "zod";
import { api, ApiRequestError } from "@/lib/api-client";
import { getAuthGeneration } from "@/auth/auth-store";
import { getLocale } from "@/i18n/locale-store";
import { durableRecord } from "@/lib/durable-record";
import { pendingRequest } from "@/lib/pending-request";
const userId = z.string().trim().min(1).max(64);
const profile = z.object({
  id: z.string().uuid(),
  title: z.string(),
  createdById: userId,
  contributors: z
    .array(z.object({ userId: userId.nullable(), displayName: z.string().nullable() }))
    .optional(),
  version: z.number().int().nonnegative(),
  viewerAccess: z.object({
    owner: z.boolean(),
    canEdit: z.boolean(),
    canManageAcl: z.boolean(),
    canTransferOwner: z.boolean(),
  }),
});
const grant = z.object({
  id: z.string().uuid(),
  ipId: z.string().uuid(),
  userId,
  permission: z.literal("edit"),
  grantedById: userId,
  revokedById: userId.nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  revokedAt: z.string().datetime().nullable(),
});
export type IpEditGrant = z.infer<typeof grant>;
export type IpAccess = { ip: z.infer<typeof profile>; grants: IpEditGrant[] };
export const accessCommand = z.discriminatedUnion("action", [
  z.object({ clientKey: z.string().uuid(), action: z.literal("grant"), toUserId: userId }),
  z.object({
    clientKey: z.string().uuid(),
    action: z.literal("revoke"),
    grantId: z.string().uuid(),
    toUserId: userId,
  }),
  z.object({
    clientKey: z.string().uuid(),
    action: z.literal("transfer"),
    toUserId: userId,
    removeOldOwner: z.boolean(),
    expectedVersion: z.number().int().nonnegative(),
  }),
]);
export type AccessCommand = z.infer<typeof accessCommand>;
function current(generation: number, signal: AbortSignal) {
  if (signal.aborted || generation !== getAuthGeneration())
    throw new Error("IP editing session expired.");
}
export function accessOutbox(ipId: string, viewerId: string, generation: number) {
  return pendingRequest(
    accessCommand,
    generation,
    durableRecord("ip-access-write", viewerId, z.string().uuid().parse(ipId))
  );
}
export async function fetchIpAccess(
  ipId: string,
  viewerId: string,
  generation: number,
  signal: AbortSignal
): Promise<IpAccess> {
  z.string().uuid().parse(ipId);
  userId.parse(viewerId);
  current(generation, signal);
  const ip = z.object({ ip: profile }).parse(
    await api.get(`/ip-commerce/me/ips/${ipId}`, {
      service: "aurora",
      signal,
      retry: false,
      params: { locale: getLocale() },
    })
  ).ip;
  current(generation, signal);
  if (ip.id !== ipId || ip.viewerAccess.owner !== (ip.createdById === viewerId))
    throw new Error("IP access identity mismatch.");
  if (
    !ip.viewerAccess.canEdit ||
    (!ip.viewerAccess.owner && (ip.viewerAccess.canManageAcl || ip.viewerAccess.canTransferOwner))
  )
    throw new ApiRequestError("IP_ACCESS_DENIED", "IP management access is unavailable.", 403);
  // Editors may view their own role, but must never call the owner's ACL endpoint.
  if (!ip.viewerAccess.canManageAcl) return { ip, grants: [] };
  const acl = z.object({ ownerUserId: userId, grants: z.array(grant) }).parse(
    await api.get(`/ip-commerce/me/ips/${ipId}/acl`, {
      service: "aurora",
      signal,
      retry: false,
    })
  );
  current(generation, signal);
  if (
    acl.ownerUserId !== viewerId ||
    acl.ownerUserId !== ip.createdById ||
    new Set(acl.grants.map((item) => item.id)).size !== acl.grants.length ||
    new Set(acl.grants.map((item) => item.userId)).size !== acl.grants.length ||
    acl.grants.some(
      (item) => item.ipId !== ipId || item.userId === viewerId || item.revokedAt !== null
    )
  )
    throw new Error("IP edit-grant identity mismatch.");
  return { ip, grants: acl.grants };
}
/** Match the desired CURRENT state; this is not an audit receipt for who changed it. */
export function accessMatches(value: IpAccess, command: AccessCommand) {
  if (command.action === "transfer")
    return (
      value.ip.createdById === command.toUserId &&
      value.ip.version > command.expectedVersion &&
      !value.ip.viewerAccess.owner &&
      !command.removeOldOwner &&
      value.ip.viewerAccess.canEdit
    );
  if (!value.ip.viewerAccess.canManageAcl) return false;
  return command.action === "grant"
    ? value.grants.some((item) => item.userId === command.toUserId)
    : !value.grants.some((item) => item.id === command.grantId);
}
export async function submitIpAccess(
  ipId: string,
  viewerId: string,
  generation: number,
  input: AccessCommand,
  signal: AbortSignal
) {
  const command = accessCommand.parse(input),
    outbox = accessOutbox(ipId, viewerId, generation);
  current(generation, signal);
  const pending = outbox.read();
  if (pending && JSON.stringify(pending) !== JSON.stringify(command))
    throw new Error("Another access change is pending. Check its result first.");
  const latest = await fetchIpAccess(ipId, viewerId, generation, signal);
  const afterRead = outbox.read();
  if ((!pending && afterRead) || (pending && JSON.stringify(afterRead) !== JSON.stringify(pending)))
    throw new Error("The pending access change changed. Reopen this page.");
  if (pending && accessMatches(latest, command)) {
    outbox.clear(command.clientKey);
    return { action: command.action, observed: true };
  }
  if (
    !latest.ip.viewerAccess.owner ||
    !latest.ip.viewerAccess.canManageAcl ||
    latest.ip.createdById !== viewerId
  )
    throw new ApiRequestError(
      "IP_OWNER_REQUIRED",
      "Only the IP owner can change editing access.",
      403
    );
  if (command.toUserId === viewerId)
    throw new ApiRequestError("IP_OWNER_IMPLICIT", "The owner already has full access.", 400);
  const target = latest.grants.find((item) => item.userId === command.toUserId);
  if (command.action === "grant" && target) return { action: command.action, observed: true };
  if (command.action === "revoke" && (!target || target.id !== command.grantId))
    throw new ApiRequestError(
      "IP_GRANT_CHANGED",
      "This edit grant changed. Refresh before removing access.",
      409
    );
  if (command.action === "transfer") {
    if (!latest.ip.viewerAccess.canTransferOwner)
      throw new ApiRequestError("IP_TRANSFER_DENIED", "Ownership transfer is unavailable.", 403);
    if (!target)
      throw new ApiRequestError(
        "IP_EDITOR_REQUIRED",
        "The new owner must already be an editor.",
        400
      );
    if (latest.ip.version !== command.expectedVersion)
      throw new ApiRequestError(
        "IP_VERSION_CONFLICT",
        "This IP changed. Refresh and review the transfer again.",
        409
      );
  }
  current(generation, signal);
  // A second command admitted during the preflight cannot replace the first one.
  const now = outbox.read();
  if ((!pending && now) || (pending && JSON.stringify(now) !== JSON.stringify(pending)))
    throw new Error("The pending access change changed. Reopen this page.");
  outbox.save(command);
  const path = `/ip-commerce/me/ips/${ipId}`;
  if (command.action === "transfer") {
    const receipt = z
      .object({
        ipId: z.string().uuid(),
        previousOwnerId: userId,
        newOwnerId: userId,
        oldOwnerKept: z.boolean(),
      })
      .parse(
        await api.post(`${path}/transfer-owner`, {
          service: "aurora",
          signal,
          retry: false,
          data: {
            toUserId: command.toUserId,
            removeOldOwner: command.removeOldOwner,
            expectedVersion: command.expectedVersion,
          },
        })
      );
    if (
      receipt.ipId !== ipId ||
      receipt.previousOwnerId !== viewerId ||
      receipt.newOwnerId !== command.toUserId ||
      receipt.oldOwnerKept !== !command.removeOldOwner
    )
      throw new Error("Ownership transfer receipt mismatch. Check the result before continuing.");
  } else {
    const options = { service: "aurora" as const, signal, retry: false as const };
    const response =
      command.action === "grant"
        ? await api.post(`${path}/acl`, {
            ...options,
            data: { userId: command.toUserId, permission: "edit" },
          })
        : await api.delete(`${path}/acl/${command.grantId}`, options);
    const receipt = z.object({ grant, revoked: z.boolean().optional() }).parse(response);
    if (
      receipt.grant.ipId !== ipId ||
      receipt.grant.userId !== command.toUserId ||
      (command.action === "grant"
        ? receipt.grant.revokedAt !== null || receipt.grant.grantedById !== viewerId
        : receipt.grant.id !== command.grantId ||
          receipt.revoked !== true ||
          receipt.grant.revokedAt === null ||
          receipt.grant.revokedById !== viewerId)
    )
      throw new Error("IP edit-grant receipt mismatch. Check the result before continuing.");
  }
  current(generation, signal);
  outbox.clear(command.clientKey);
  return { action: command.action, observed: false };
}
