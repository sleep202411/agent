import { v5 as uuidv5 } from "uuid";

/**
 * IP id resolution across the Java → Postgres migration boundary.
 *
 * The PG IP schema keys IPs by UUID, but legacy entry points (profile cards,
 * the plaza, "edit IP" buttons) still carry the original Java numeric project
 * id. The migration (`tmp/ip-migration/import.cjs`) derived every PG IP's UUID
 * deterministically as `uuidv5("ip:" + javaProjectId)` under a fixed namespace,
 * with NO java-id column kept on the row — so the same formula is the only
 * bridge back. `toCanonicalIpId` applies it: a numeric Java id resolves to its
 * migrated UUID, a UUID passes through unchanged, and anything else hashes to a
 * harmless non-existent UUID (a clean 404 in the UI, never a Zod 400).
 *
 * The namespace MUST stay identical to import.cjs's `NS`; changing it would
 * point every legacy link at the wrong (non-existent) IP.
 */
const IP_MIGRATION_NAMESPACE = "2d3fb7fe-7d9a-50f1-b502-a7a87cf7f482";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: string): boolean {
  return UUID_RE.test(value);
}

/**
 * Resolve any IP reference to its canonical PG UUID. Pass UUIDs through; map a
 * legacy Java numeric id via the migration's `uuidv5("ip:" + id)` formula.
 */
export function toCanonicalIpId(rawId: string | number): string {
  const id = String(rawId).trim();
  if (isUuid(id)) return id;
  return uuidv5(`ip:${id}`, IP_MIGRATION_NAMESPACE);
}
