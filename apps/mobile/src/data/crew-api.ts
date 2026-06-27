/**
 * Crew browse API — Nest crews module (`@Controller('crews')`), reached via the
 * /aurora proxy. List + detail + positions are @Public (no auth). Member lists
 * are NOT public, so the detail member section stays empty.
 *
 * Region note: like ip-commerce, served on the global host (fizzdragon.com);
 * the CN host 404s these routes.
 */
import { appEnv, resolveAssetUrl } from "@/config";
import { api } from "@/lib/api-client";

import type { IpReportReason } from "./ip-api";
import type { CrewDetail, CrewRoleOpening, CrewStatus, CrewSummary } from "./types";

const AURORA = { service: "aurora" } as const;

type CrewDto = {
  id: string;
  name: string;
  description?: string | null;
  logo?: string | null;
  tagline?: string | null;
  openPositionCount?: number;
  openPositionPreview?: string[];
  memberCount?: number;
  listingStatus?: string;
};

type PositionDto = {
  id: string;
  positionType?: string | null;
  description?: string | null;
  targetCount?: number;
  location?: string | null;
  employmentType?: string | null;
  status?: string;
};

/** "art_director" / "editor" → "Art Director" / "Editor". */
function prettyRole(code?: string | null): string {
  if (!code) return "Role";
  return code.replace(/[_-]+/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
}

function logoUrl(logo?: string | null): string | undefined {
  // Crew logo is a relative key resolved against the banner OSS base (matches web).
  return logo ? resolveAssetUrl(logo, appEnv.assets.bannerBaseUrl) : undefined;
}

function crewStatus(dto: CrewDto): CrewStatus {
  return (dto.openPositionCount ?? 0) > 0 ? "recruiting" : "closed";
}

function mapSummary(dto: CrewDto): CrewSummary {
  return {
    id: dto.id,
    name: dto.name,
    tagline: dto.tagline ?? undefined,
    coverUrl: logoUrl(dto.logo),
    status: crewStatus(dto),
    openRoles: dto.openPositionCount ?? 0,
    roleTags: (dto.openPositionPreview ?? []).map(prettyRole),
    summary: dto.description ?? "",
    memberCount: dto.memberCount,
  };
}

async function fetchPositions(crewId: string): Promise<CrewRoleOpening[]> {
  try {
    const res = await api.get<PositionDto[]>(`/crews/${crewId}/positions`, { ...AURORA });
    const list = Array.isArray(res) ? res : [];
    return list
      .filter((position) => position.status !== "closed")
      .map((position) => ({
        id: position.id,
        title: prettyRole(position.positionType),
        count: position.targetCount ?? 1,
        note: [position.location, position.employmentType].filter(Boolean).join(" · ") || undefined,
      }));
  } catch {
    return [];
  }
}

export async function fetchCrewFeed(): Promise<CrewSummary[]> {
  const res = await api.get<{ items?: CrewDto[]; nextCursor?: string | null }>("/crews", {
    ...AURORA,
    params: { limit: 30 },
  });
  return (res.items ?? []).map(mapSummary);
}

/** A user's publicly LISTED crews (visitor profile tab; @Public by-user route). */
export async function fetchCrewsByUser(userId: string): Promise<CrewSummary[]> {
  try {
    const res = await api.get<{ items?: CrewDto[] } | CrewDto[]>(`/crews/by-user/${userId}`, {
      ...AURORA,
    });
    const list = Array.isArray(res) ? res : (res.items ?? []);
    return list.map(mapSummary);
  } catch {
    return [];
  }
}

export async function fetchCrewById(id: string): Promise<CrewDetail | undefined> {
  const [crew, roles] = await Promise.all([
    api.get<CrewDto>(`/crews/${id}`, { ...AURORA }).catch(() => undefined),
    fetchPositions(id),
  ]);
  if (!crew) return undefined;

  return {
    ...mapSummary(crew),
    description: crew.description ?? "",
    roles,
    // No public member-list endpoint; section hidden when empty.
    members: [],
  };
}

/** The signed-in user's crews — owned + joined (auth'd; `/aurora/crews/my`). */
export async function fetchMyCrews(): Promise<CrewSummary[]> {
  try {
    const res = await api.get<
      { items?: CrewDto[]; owned?: CrewDto[]; joined?: CrewDto[] } | CrewDto[]
    >("/crews/my", { ...AURORA });
    const list = Array.isArray(res)
      ? res
      : (res.items ?? [...(res.owned ?? []), ...(res.joined ?? [])]);
    // De-dupe (a crew can be both owned and joined).
    const seen = new Set<string>();
    return list.filter((dto) => dto?.id && !seen.has(dto.id) && seen.add(dto.id)).map(mapSummary);
  } catch {
    return [];
  }
}

/** File a content report against a crew (auth'd; same reason set as IPs). */
export async function reportCrew(crewId: string, reason: IpReportReason): Promise<void> {
  await api.post(`/crews/${crewId}/reports`, { ...AURORA, data: { reason } });
}

/** Hide a crew for the signed-in viewer (auth'd; lists/detail filter it server-side). */
export async function blockCrew(crewId: string): Promise<void> {
  await api.post(`/crews/${crewId}/blocks`, { ...AURORA });
}
