/**
 * Project role catalog — backs the role select in the add-member dialog
 * and the role badge on member rows.
 *
 * Endpoint: `GET /project/role/list` (no params). Backend swagger is
 * vague about the shape (it lists `additionalProp1/2/3` placeholders),
 * so the mapper handles three plausible forms:
 *
 *   - `[{ id, name }]`           — straight array
 *   - `[{ roleId, roleName }]`   — legacy alias
 *   - `{ "0": "Member", ... }`   — id-keyed map (rare but seen)
 *
 * Anything else returns `[]` rather than throwing — the dialog falls
 * back to a single "Member" option so the flow doesn't deadlock if the
 * endpoint is misconfigured.
 */

import { useQuery } from "@tanstack/react-query";
import { acceptLanguage, bearerHeader } from "./shared";

export interface ProjectRole {
  id: number;
  name: string;
}

interface WireRoleObj {
  id?: number | string | null;
  roleId?: number | string | null;
  name?: string | null;
  roleName?: string | null;
  [key: string]: unknown;
}

function mapRow(raw: unknown): ProjectRole | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as WireRoleObj;
  const idRaw = obj.id ?? obj.roleId;
  const id = Number(idRaw);
  if (!Number.isFinite(id)) return null;
  const name = String(obj.name ?? obj.roleName ?? "").trim();
  if (!name) return null;
  return { id, name };
}

function parsePayload(data: unknown): ProjectRole[] {
  if (Array.isArray(data)) {
    return data.map(mapRow).filter((r): r is ProjectRole => r !== null);
  }
  if (data && typeof data === "object") {
    const out: ProjectRole[] = [];
    for (const [key, val] of Object.entries(data as Record<string, unknown>)) {
      const id = Number(key);
      if (!Number.isFinite(id)) continue;
      if (typeof val === "string") {
        if (val.trim()) out.push({ id, name: val.trim() });
      } else if (val && typeof val === "object") {
        const row = mapRow({ id, ...val });
        if (row) out.push(row);
      }
    }
    return out;
  }
  return [];
}

async function fetchProjectRoles(): Promise<ProjectRole[]> {
  const res = await fetch("/project/role/list", {
    credentials: "include",
    headers: {
      "accept-language": acceptLanguage(),
      Authorization: bearerHeader(),
    },
  });
  if (!res.ok) throw new Error(`Fetch roles failed: HTTP ${res.status}`);
  const json = (await res.json()) as { code?: number; msg?: string; data?: unknown };
  if (json.code !== 0 && json.code !== 200) {
    throw new Error(json.msg || "Fetch roles failed");
  }
  return parsePayload(json.data);
}

export function useProjectRoles(enabled: boolean = true) {
  return useQuery<ProjectRole[]>({
    queryKey: ["ip", "projectRoles"],
    queryFn: fetchProjectRoles,
    enabled,
    // Roles change rarely; keep them warm across dialog opens.
    staleTime: 1000 * 60 * 10,
  });
}
