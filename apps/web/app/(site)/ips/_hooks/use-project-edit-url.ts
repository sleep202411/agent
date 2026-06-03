"use client";

import { toCanonicalIpId } from "@/src/lib/ip-id";

/**
 * Resolve the right URL for an "Edit IP" entry point.
 *
 * Resolve the current creator workbench URL. The legacy `/ips/[id]/edit`
 * route now redirects here so owner entry points share the same IP schema.
 *
 * Callers still hand us the legacy Java numeric project id, but the workbench
 * keys IPs by their migrated PG UUID — so canonicalize here, producing a stable
 * `/ip-studio/<uuid>` link (UUIDs pass through unchanged).
 */

export function useProjectEditUrl(projectId: string | number): string {
  return `/ip-studio/${toCanonicalIpId(projectId)}`;
}
