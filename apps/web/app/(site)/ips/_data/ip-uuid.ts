import { v5 as uuidv5 } from "uuid";

// Deterministic PG IP id derivation — mirrors the Java→PG migration
// (tmp/ip-migration): `Ip.id = uuidv5("ip:" + javaId, IP_NAMESPACE)`.
// Lets legacy links `/ips/{javaId}` (numeric Java id) resolve to the same UUID
// the migration assigned, so old URLs keep working.
export const IP_NAMESPACE = "2d3fb7fe-7d9a-50f1-b502-a7a87cf7f482";

export function computeIpUuid(javaId: string | number): string {
  return uuidv5(`ip:${javaId}`, IP_NAMESPACE);
}
