/**
 * Story-node community-points unlock (H5 `/aurora/.../community-access` parity).
 * Paths omit `/aurora`; `api` resolves the aurora base URL.
 */

import type { ExperienceAccessRequirement } from "@repo/shared/experience-runtime";

import { api } from "@/lib/api-client";

const AURORA = { service: "aurora" as const };

export type StoryCommunityAccessQuote = {
  requirements: ExperienceAccessRequirement[];
  ownedKeys: string[];
  balance: string | null;
  authenticated: boolean;
};

function accessPath(projectId: string, buildId: string): string {
  return `/story-projects/${encodeURIComponent(projectId)}/builds/${encodeURIComponent(buildId)}/community-access`;
}

export async function fetchStoryCommunityAccessQuote(
  projectId: string,
  buildId: string
): Promise<StoryCommunityAccessQuote> {
  const res = await api.get<StoryCommunityAccessQuote>(accessPath(projectId, buildId), AURORA);
  return {
    requirements: res.requirements ?? [],
    ownedKeys: res.ownedKeys ?? [],
    balance: res.balance ?? null,
    authenticated: Boolean(res.authenticated),
  };
}

export async function purchaseStoryCommunityAccess(input: {
  projectId: string;
  buildId: string;
  key: string;
  expectedPrice: number;
}): Promise<void> {
  await api.post(accessPath(input.projectId, input.buildId), {
    ...AURORA,
    data: { key: input.key, expectedPrice: input.expectedPrice },
  });
}
