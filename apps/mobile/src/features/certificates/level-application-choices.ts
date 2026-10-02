import { z } from "zod";
import { api } from "@/lib/api-client";
import { getAuthGeneration } from "@/auth/auth-store";

const id = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);
const crew = z.object({ id, name: z.string().trim().min(1) });
const ip = z.object({ id, title: z.string().trim().min(1), roomNumber: id });
export type ApplicationCrewChoice = z.infer<typeof crew>;
export type ApplicationIpChoice = z.infer<typeof ip>;
function current(generation: number, signal: AbortSignal) {
  if (signal.aborted || generation !== getAuthGeneration())
    throw new Error("Certification application session expired or request cancelled.");
}
/** Preserve errors: an unavailable directory must not masquerade as an empty selector. */
export async function fetchApplicationCrews(generation: number, signal: AbortSignal) {
  current(generation, signal);
  const data = z
    .object({ founded: z.array(crew), joined: z.array(crew) })
    .parse(await api.get("/crews/my", { service: "aurora", signal, retry: false }));
  current(generation, signal);
  return [...new Map([...data.founded, ...data.joined].map((v) => [v.id, v])).values()].sort(
    (a, b) => a.name.localeCompare(b.name)
  );
}
/** Owner directory must include every page; public links use room numbers, never internal IDs. */
export async function fetchApplicationIps(locale: string, generation: number, signal: AbortSignal) {
  z.enum(["en-US", "zh-CN", "zh-HK"]).parse(locale);
  const rows = new Map<string, ApplicationIpChoice>();
  const cursors = new Set<string>();
  let cursor: string | undefined;
  do {
    current(generation, signal);
    const data = z.object({ items: z.array(ip), nextCursor: id.nullable() }).parse(
      await api.get("/ip-commerce/me/ips", {
        service: "aurora",
        signal,
        retry: false,
        params: { locale, limit: 50, cursor },
      })
    );
    current(generation, signal);
    for (const row of data.items) rows.set(row.id, row);
    cursor = data.nextCursor ?? undefined;
    if (cursor) {
      if (cursors.has(cursor) || !data.items.some((v) => v.id === cursor))
        throw new Error("Invalid owned IP cursor. Refresh before continuing.");
      cursors.add(cursor);
    }
  } while (cursor);
  return [...rows.values()].sort((a, b) => a.title.localeCompare(b.title));
}
export function applicationAssociationLink(
  kind: "crews" | "ip",
  identity: string,
  region: "global" | "cn",
  locale: string
) {
  id.parse(identity);
  z.enum(["en-US", "zh-CN", "zh-HK"]).parse(locale);
  return `${region === "cn" ? "https://fizzdragon.fizzspace.cn" : "https://fizzdragon.com"}/${locale}/${kind}/${identity}`;
}
