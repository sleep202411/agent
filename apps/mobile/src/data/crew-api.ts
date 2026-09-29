/**
 * Crew browse API — Nest crews module (`@Controller('crews')`), reached via the
 * /aurora proxy. List + detail + positions are @Public (no auth). Member lists
 * are NOT public, so the detail member section stays empty.
 *
 * Region note: like ip-commerce, served on the global host (fizzdragon.com);
 * the CN host 404s these routes.
 */
import { appEnv, resolveAssetUrl } from "@/config";
import { PRESET_POSITIONS } from "@repo/shared/crew";
import { api } from "@/lib/api-client";

import type { IpReportReason } from "./ip-api";
import type { CrewDetail, CrewFeedPage, CrewRoleOpening, CrewStatus, CrewSummary } from "./types";

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

/** Keep custom titles intact; known role codes have a canonical English fallback. */
function prettyRole(code?: string | null): string {
  if (!code) return "Role";
  return PRESET_POSITIONS.find((position) => position.value === code)?.label ?? code;
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
    roleTags: dto.openPositionPreview ?? [],
    summary: dto.description ?? "",
    memberCount: dto.memberCount,
  };
}

async function fetchPositions(crewId: string): Promise<CrewRoleOpening[]> {
  try {
    const list: PositionDto[] = [];
    const cursors = new Set<string>();
    let cursor: string | undefined;
    do {
      const page = await api.get<{ items: PositionDto[]; nextCursor: string | null }>(
        `/crews/${crewId}/positions`,
        { ...AURORA, params: { cursor } }
      );
      list.push(...page.items);
      cursor = page.nextCursor ?? undefined;
      if (cursor && cursors.has(cursor)) throw new Error("Repeated crew positions cursor");
      if (cursor) cursors.add(cursor);
    } while (cursor);
    return list
      .filter((position) => position.status === "open")
      .map((position) => ({
        id: position.id,
        title: prettyRole(position.positionType),
        positionType: position.positionType ?? undefined,
        count: position.targetCount ?? 1,
        location: position.location ?? undefined,
        employmentType: position.employmentType ?? undefined,
      }));
  } catch {
    return [];
  }
}

/**
 * One page of the public crew feed (Nest `GET /aurora/crews`, cursor-based).
 * `nextCursor` is the last crew id when more remain, else null.
 *
 * The recruiting-first ordering is applied PER PAGE only (a stable sort that
 * keeps the backend's listedAt order within each group). Sorting across the
 * accumulated, growing list would re-order earlier items when a later page
 * arrives and make rows jump as the user scrolls, so we never do that —
 * pages are appended in fetch order with each page internally sorted.
 */
export async function fetchCrewFeedPage({
  cursor,
  limit = 30,
}: { cursor?: string | null; limit?: number } = {}): Promise<CrewFeedPage> {
  const res = await api.get<{ items?: CrewDto[]; nextCursor?: string | null }>("/crews", {
    ...AURORA,
    params: { cursor: cursor ?? undefined, limit },
  });
  const items = (res.items ?? [])
    .map(mapSummary)
    // Recruiting crews first within this page (openPositionCount is a computed
    // aggregate, not a column, so it can't be a DB orderBy).
    .sort((a, b) => Number(b.status === "recruiting") - Number(a.status === "recruiting"));
  return { items, nextCursor: res.nextCursor ?? null };
}

export async function fetchCrewFeed(): Promise<CrewSummary[]> {
  const page = await fetchCrewFeedPage({ limit: 30 });
  return page.items;
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
      { items?: CrewDto[]; founded?: CrewDto[]; joined?: CrewDto[] } | CrewDto[]
    >("/crews/my", { ...AURORA });
    const list = Array.isArray(res)
      ? res
      : (res.items ?? [...(res.founded ?? []), ...(res.joined ?? [])]);
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

/** Apply to a crew position (auth'd). Backend dedups one pending application
 *  per position/user and notifies the crew owner; approval creates a member. */
export async function applyToCrewPosition(crewId: string, positionId: string): Promise<void> {
  await api.post(`/crews/${crewId}/positions/${positionId}/apply`, { ...AURORA, data: {} });
}
