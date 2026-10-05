import { releaseLinks } from "./release-link-schema";
import { z } from "zod";
import { api, ApiRequestError } from "@/lib/api-client";
import { getAuthGeneration } from "@/auth/auth-store";
import { getLocale } from "@/i18n/locale-store";
import { durableRecord } from "@/lib/durable-record";
import { pendingRequest } from "@/lib/pending-request";
export const governanceKinds = ["disclosures", "links", "crew"] as const;
export type GovernanceKind = (typeof governanceKinds)[number];
const version = z.number().int().nonnegative();
const crewId = z.string().trim().min(1).max(100);
export { releaseLink, releaseLinks } from "./release-link-schema";
const disclosureFields = z.object({
  copyrightOwner: z
    .string()
    .trim()
    .max(160)
    .nullable()
    .transform((value) => value || null),
  rightsSummary: z.object({ statement: z.string().trim().max(1000) }),
  aiDisclosure: z.object({
    generatedVisuals: z.boolean(),
    generatedCopy: z.boolean(),
    statement: z.string().trim().max(1000),
  }),
});
const common = { clientKey: z.string().uuid(), expectedVersion: version };
export const governanceCommand = z.discriminatedUnion("kind", [
  z.object({ ...common, kind: z.literal("disclosures"), data: disclosureFields }),
  z.object({ ...common, kind: z.literal("links"), data: z.object({ links: releaseLinks }) }),
  z.object({ ...common, kind: z.literal("crew"), data: z.object({ crewId: crewId.nullable() }) }),
]);
export type GovernanceCommand = z.infer<typeof governanceCommand>;
export type GovernanceSnapshot =
  | { kind: "disclosures"; version: number; title: string; data: z.infer<typeof disclosureFields> }
  | { kind: "links"; version: number; data: { links: z.infer<typeof releaseLinks> } }
  | {
      kind: "crew";
      version: number;
      data: { crewId: string | null };
      choices: { id: string; name: string }[];
    };
function current(generation: number, signal?: AbortSignal) {
  if (signal?.aborted || getAuthGeneration() !== generation)
    throw new Error("IP editing session expired.");
}
function endpoint(ipId: string, kind: GovernanceKind) {
  z.string().uuid().parse(ipId);
  return `/ip-commerce/me/ips/${ipId}${kind === "links" ? "/release-links" : kind === "crew" ? "/crew" : ""}`;
}
export function governanceOutbox(
  ipId: string,
  userId: string,
  generation: number,
  kind: GovernanceKind
) {
  const storage = durableRecord(`ip-governance-${kind}`, userId, z.string().uuid().parse(ipId));
  const schema = governanceCommand.refine((command) => command.kind === kind, "IP form mismatch.");
  const outbox = pendingRequest(schema, generation, storage);
  return {
    ...outbox,
    // Explicitly reviewed conflict replacement is one atomic local write, never clear-then-save.
    rebase(input: GovernanceCommand, previousKey: string) {
      current(generation);
      const next = schema.parse(input),
        previous = outbox.read();
      if (
        !previous ||
        previous.clientKey !== previousKey ||
        next.clientKey === previousKey ||
        next.expectedVersion <= previous.expectedVersion ||
        !governanceMatches(previous, next)
      )
        throw new Error("The pending IP form changed. Refresh and review it again.");
      storage.write(JSON.stringify({ version: 1, intent: next }));
    },
  };
}
const rawRecord = z.record(z.string(), z.unknown()).nullable().optional();
function normalize(kind: GovernanceKind, ipId: string, value: unknown): GovernanceSnapshot {
  if (kind === "disclosures") {
    const ip = z
      .object({
        ip: z.object({
          id: z.string().uuid(),
          title: z.string(),
          version,
          copyrightOwner: z.string().nullable().optional(),
          rightsSummary: rawRecord,
          aiDisclosure: rawRecord,
        }),
      })
      .parse(value).ip;
    if (ip.id !== ipId) throw new Error("IP rights identity mismatch.");
    return {
      kind,
      version: ip.version,
      title: ip.title,
      data: {
        copyrightOwner: ip.copyrightOwner ?? null,
        rightsSummary: {
          statement:
            typeof ip.rightsSummary?.statement === "string" ? ip.rightsSummary.statement : "",
        },
        aiDisclosure: {
          generatedVisuals: ip.aiDisclosure?.generatedVisuals === true,
          generatedCopy: ip.aiDisclosure?.generatedCopy === true,
          statement:
            typeof ip.aiDisclosure?.statement === "string" ? ip.aiDisclosure.statement : "",
        },
      },
    };
  }
  if (kind === "links") {
    const result = z.object({ version, links: releaseLinks }).parse(value);
    return { kind, version: result.version, data: { links: result.links } };
  }
  const result = z
    .object({
      version,
      crewId: crewId.nullable(),
      choices: z.array(z.object({ id: crewId, name: z.string() })),
    })
    .parse(value);
  if (new Set(result.choices.map((item) => item.id)).size !== result.choices.length)
    throw new Error("Duplicate Crew choices.");
  return {
    kind,
    version: result.version,
    data: { crewId: result.crewId },
    choices: result.choices,
  };
}
export async function fetchGovernance(
  ipId: string,
  generation: number,
  kind: GovernanceKind,
  signal: AbortSignal
) {
  current(generation, signal);
  const result = normalize(
    kind,
    ipId,
    await api.get(endpoint(ipId, kind), {
      service: "aurora",
      signal,
      retry: false,
      ...(kind === "disclosures" ? { params: { locale: getLocale() } } : {}),
    })
  );
  current(generation, signal);
  return result;
}
export function governanceMatches(
  a: Pick<GovernanceCommand, "kind" | "data">,
  b: Pick<GovernanceCommand, "kind" | "data">
) {
  if (a.kind !== b.kind) return false;
  // Command parsing gives each supported field a stable order and canonical whitespace.
  const canonical = (value: typeof a) =>
    governanceCommand.safeParse({
      ...value,
      clientKey: "00000000-0000-4000-8000-000000000000",
      expectedVersion: 0,
    });
  const left = canonical(a),
    right = canonical(b);
  return (
    left.success &&
    right.success &&
    JSON.stringify(left.data.data) === JSON.stringify(right.data.data)
  );
}
export async function saveGovernance(
  ipId: string,
  generation: number,
  input: GovernanceCommand,
  signal: AbortSignal
) {
  const command = governanceCommand.parse(input);
  const latest = await fetchGovernance(ipId, generation, command.kind, signal);
  if (latest.version > command.expectedVersion && governanceMatches(latest, command)) return latest;
  if (latest.version !== command.expectedVersion)
    throw new ApiRequestError(
      "IP_VERSION_CONFLICT",
      "This IP changed. Refresh and review your changes before applying them.",
      409
    );
  if (
    command.kind === "crew" &&
    latest.kind === "crew" &&
    command.data.crewId !== null &&
    !latest.choices.some((item) => item.id === command.data.crewId)
  )
    throw new ApiRequestError(
      "CREW_PERMISSION_REQUIRED",
      "Choose a Crew where you can manage production.",
      403
    );
  current(generation, signal);
  const saved = normalize(
    command.kind,
    ipId,
    await api.put(endpoint(ipId, command.kind), {
      service: "aurora",
      signal,
      retry: false,
      data: { ...command.data, expectedVersion: command.expectedVersion },
    })
  );
  current(generation, signal);
  if (saved.version <= command.expectedVersion || !governanceMatches(saved, command))
    throw new Error("IP settings receipt mismatch. Retry to check the saved result.");
  return saved;
}
