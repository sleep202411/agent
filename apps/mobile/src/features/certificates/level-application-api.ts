import { z } from "zod";
import { getAuthGeneration } from "@/auth/auth-store";
import { api } from "@/lib/api-client";
import { durableRecord } from "@/lib/durable-record";

const positiveId = z.number().int().positive().safe();
const levelOption = z.object({
  id: positiveId,
  name: z.string().min(1),
  description: z.string().nullish(),
  imagePath: z.string().nullish(),
  type: z.number().optional(),
  remark: z.string().nullish(),
});
const application = z.object({
  id: positiveId,
  levelId: positiveId,
  levelName: z.string().optional(),
  crewName: z.string(),
  crewLink: z.string(),
  ipName: z.string(),
  ipLink: z.string(),
  attachmentUrl: z.string().nullish(),
  extraInfo: z.string().nullish(),
  status: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]),
  adminRemark: z.string().nullish(),
  createTime: z.string().optional(),
  updateTime: z.string().optional(),
});
export type CertificationLevel = z.infer<typeof levelOption>;
export type LevelApplication = z.infer<typeof application>;
export const levelApplicationInput = z
  .object({
    levelId: positiveId,
    crewName: z.string().trim(),
    crewLink: z.string().trim(),
    ipName: z.string().trim(),
    ipLink: z.string().trim(),
    attachmentUrl: z.string().trim().min(1).optional(),
    extraInfo: z.string().trim().min(1).max(300).optional(),
  })
  .strict()
  .refine(
    (v) => Boolean(v.crewName) === Boolean(v.crewLink) && Boolean(v.ipName) === Boolean(v.ipLink),
    "Choose a complete Crew or IP association, or leave it empty."
  );
export type LevelApplicationInput = z.infer<typeof levelApplicationInput>;
const attempt = z.object({
  input: levelApplicationInput,
  startedAt: z.string().datetime(),
  acknowledged: z.boolean(),
});
export type LevelApplicationAttempt = z.infer<typeof attempt>;

function current(generation: number, signal?: AbortSignal) {
  if (generation !== getAuthGeneration() || signal?.aborted)
    throw new Error("Certification application session expired or request cancelled.");
}
function unique<T extends { id: number }>(rows: T[]) {
  if (new Set(rows.map((row) => row.id)).size !== rows.length)
    throw new Error("Duplicate certification records. Refresh before continuing.");
  return rows;
}

/** The official Java contract returns a list, not a paginated envelope. */
export async function fetchCertificationLevels(generation: number, signal: AbortSignal) {
  current(generation, signal);
  const rows = z
    .array(levelOption)
    .parse(await api.get("/user/levels/options", { service: "content", signal, retry: false }));
  current(generation, signal);
  return unique(rows);
}
export async function fetchLevelApplications(generation: number, signal: AbortSignal) {
  current(generation, signal);
  const rows = z
    .array(application)
    .parse(await api.get("/user/levels/apply/mine", { service: "content", signal, retry: false }));
  current(generation, signal);
  // A matching row is useful for manual recovery, never proof of a lost POST's outcome.
  return unique(rows);
}

export function levelApplicationPending(userId: string, generation: number) {
  z.string()
    .regex(/^[A-Za-z0-9_-]{1,64}$/)
    .parse(userId);
  const storage = durableRecord("level-application", userId, "submit");
  const read = () => {
    current(generation);
    const raw = storage.read();
    return raw && raw !== "null" ? attempt.parse(JSON.parse(raw)) : null;
  };
  return {
    read,
    save(input: LevelApplicationInput) {
      if (read()) throw new Error("Review the previous certification request before submitting.");
      storage.write(
        JSON.stringify(
          attempt.parse({
            input,
            startedAt: new Date().toISOString(),
            acknowledged: false,
          })
        )
      );
    },
    acknowledge() {
      const saved = read();
      if (!saved) throw new Error("Certification request record is missing.");
      storage.write(JSON.stringify({ ...saved, acknowledged: true }));
    },
    /** Only after the user reviews the saved request and current application list. */
    clear() {
      current(generation);
      storage.write("null");
    },
  };
}

function checkAssociation(link: string, kind: "crews" | "ip", region: "global" | "cn") {
  if (!link) return;
  const url = new URL(link);
  const origin = region === "cn" ? "https://fizzdragon.fizzspace.cn" : "https://fizzdragon.com";
  if (
    url.origin !== origin ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    link.includes("\\") ||
    !new RegExp(`^/(?:en-US/|zh-CN/|zh-HK/)?${kind}/[A-Za-z0-9_-]{1,64}/?$`).test(url.pathname)
  )
    throw new Error("Choose a Crew or IP from this app region.");
}

/** Explicitly confirmed submission only; no endpoint provides an idempotency key or receipt lookup. */
export async function submitLevelApplication(
  input: LevelApplicationInput,
  userId: string,
  generation: number,
  region: "global" | "cn",
  signal: AbortSignal
) {
  current(generation, signal);
  const data = levelApplicationInput.parse(input);
  checkAssociation(data.crewLink, "crews", region);
  checkAssociation(data.ipLink, "ip", region);
  const pending = levelApplicationPending(userId, generation);
  if (pending.read())
    throw new Error("Review the previous certification request before submitting.");
  const [levels, applications] = await Promise.all([
    fetchCertificationLevels(generation, signal),
    fetchLevelApplications(generation, signal),
  ]);
  current(generation, signal);
  if (!levels.some((row) => row.id === data.levelId))
    throw new Error("This certification level is no longer available.");
  if (applications.some((row) => row.levelId === data.levelId && row.status === 0))
    throw new Error("An application for this certification level is already pending.");
  // Synchronous durable save also prevents two confirmations racing through the fresh reads.
  pending.save(data);
  const receipt = await api.post("/user/levels/apply", {
    service: "content",
    data,
    signal,
    retry: false,
    raw: true,
  });
  current(generation, signal);
  // Java acknowledges submission with code 200. Do not treat arbitrary HTTP-200 JSON as success.
  z.object({ code: z.union([z.literal(200), z.literal("200")]) }).parse(receipt);
  pending.acknowledge();
}
