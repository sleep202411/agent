/**
 * Crew listing hooks: plaza grid (`useQueryCrewList`) + the current
 * user's crews (`useMyCrews`).
 */

import { useQuery } from "@tanstack/react-query";
import { api } from "@/src/lib/api";
import { crewKeys, type QueryCrewListFilter } from "./shared";

/**
 * Wire shape for one row of `POST /project/crew/list` (queryCrewList).
 * Verified against live response 2026-05-10. Backend returns the
 * raw crew row only — no joined member / job / owner detail. If
 * the UI needs those it'll have to fan out additional calls.
 */
export interface QueryCrewListItem {
  id: number;
  name: string;
  description?: string;
  banner?: string;
  video?: string;
  /** Java owner / 管理员 user id. */
  adminUserId?: number;
  /** 0 = active, others reserved. */
  status?: number;
  createTime?: string | null;
  updateTime?: string | null;
}

/**
 * Wire envelope from `/project/crew/list`. Total count rides on a
 * top-level `sum` field — NOT nested in `data` — so we have to read
 * the raw envelope (`raw: true`) instead of letting api-client
 * auto-unwrap `data`.
 */
interface QueryCrewListEnvelope {
  code?: number;
  msg?: string;
  data?: QueryCrewListItem[];
  sum?: number;
}

interface QueryCrewListPage {
  list: QueryCrewListItem[];
  totalCount: number;
}

async function queryCrewList(filter: QueryCrewListFilter): Promise<QueryCrewListPage> {
  // Build body conditionally so optional filters that aren't set
  // don't leak through as empty / zero noise on the wire. `name` in
  // particular matters: backend treats `""` as a search predicate
  // and would otherwise filter out every crew that doesn't have an
  // empty-string name (none). Pagination + status always go through.
  // `ipId` is intentionally NOT sent — crews aren't bound to an IP
  // in the frontend's mental model per phase-1 spec.
  const body: Record<string, unknown> = {
    pageNum: filter.pageNum ?? 1,
    pageSize: filter.pageSize ?? 20,
    // status: filter.status ?? 0,
  };
  if (filter.name && filter.name.trim() !== "") body.name = filter.name.trim();

  const envelope = await api.post<QueryCrewListEnvelope>("/project/crew/list", {
    data: body,
    raw: true,
  });
  return {
    list: envelope?.data ?? [],
    totalCount: Number(envelope?.sum ?? 0),
  };
}

/**
 * Plaza-side crew list, one page at a time. Keep it simple — the
 * legacy `useProjectsByJob` infinite-list still drives the main grid;
 * this hook backs an additional section below it sourced from the
 * proper crew endpoint.
 */
export function useQueryCrewList(filter: QueryCrewListFilter = {}) {
  return useQuery({
    queryKey: crewKeys.queryList(filter),
    queryFn: () => queryCrewList(filter),
  });
}

/**
 * `POST /project/crew/mycrew` (queryMyCrew) — crews the current user
 * belongs to, owner or member alike. Backend returns the same row shape
 * as `/project/crew/list`; the caller decides ownership by comparing
 * `adminUserId` to the logged-in user.
 *
 * No request body — auth cookie does the filtering. Envelope is read
 * raw because some backend versions return the array directly and some
 * wrap it in `{ data: [...] }`; we accept both.
 */
async function fetchMyCrews(): Promise<QueryCrewListItem[]> {
  const envelope = await api.post<QueryCrewListEnvelope | QueryCrewListItem[] | null>(
    "/project/crew/mycrew",
    { raw: true }
  );
  if (!envelope) return [];
  if (Array.isArray(envelope)) return envelope;
  return envelope.data ?? [];
}

export function useMyCrews() {
  return useQuery({
    queryKey: crewKeys.mine,
    queryFn: fetchMyCrews,
  });
}
