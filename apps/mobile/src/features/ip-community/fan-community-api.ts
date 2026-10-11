import { z } from "zod";
import { api } from "@/lib/api-client";
const crewId = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);
const origin = z.object({ crew: z.object({ id: crewId, name: z.string() }).nullable() });
export async function fetchIpFanCommunity(ipId: string, signal?: AbortSignal) {
  return origin.parse(
    await api.get(`/ip-commerce/ips/${encodeURIComponent(ipId)}/crew`, {
      service: "aurora",
      signal,
    })
  ).crew;
}
/** The official join operation is idempotent and does not toggle an IP like. */
export async function joinIpFanCommunity(id: string) {
  await api.post(`/crews/${encodeURIComponent(crewId.parse(id))}/fan-community`, {
    service: "aurora",
  });
}
