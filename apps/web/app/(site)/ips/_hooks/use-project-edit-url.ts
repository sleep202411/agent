"use client";

/**
 * Resolve the right URL for an "Edit IP" entry point.
 *
 * Resolve the current creator workbench URL. The legacy `/ips/[id]/edit`
 * route now redirects here so owner entry points share the same IP schema.
 */

export function useProjectEditUrl(projectId: string | number): string {
  return `/ip-studio/${projectId}`;
}
