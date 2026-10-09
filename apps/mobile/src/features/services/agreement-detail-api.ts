import { z } from "zod";
import { api } from "@/lib/api-client";
import { getAuthGeneration } from "@/auth/auth-store";
const id = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/),
  uuid = z.string().uuid();
const date = z.string().datetime({ offset: true });
export const agreementStatuses = [
  "draft",
  "sending",
  "sent",
  "signed",
  "declined",
  "expired",
  "failed",
  "voided",
] as const;
export const agreement = z.object({
  id: uuid,
  crewId: id,
  memberUserId: z.string().min(1),
  signerName: z.string(),
  signerEmail: z.string(),
  title: z.string(),
  provider: z.literal("boldsign"),
  providerStatus: z.string().nullable(),
  providerDocumentId: z.string().nullable(),
  status: z.enum(agreementStatuses),
  capabilities: z.object({ sign: z.boolean() }),
  delivery: z.object({
    status: z.enum(["pending", "processing", "completed", "failed"]),
    error: z.string().nullable(),
    attempt: z.number().int().nonnegative(),
    canRetry: z.boolean(),
  }),
  archive: z.object({
    status: z.enum(["not_applicable", "pending", "processing", "ready", "failed"]),
    canRetry: z.boolean(),
    signedDocumentUrl: z.string().nullable(),
    auditTrailUrl: z.string().nullable(),
  }),
  sentAt: date.nullable(),
  signedAt: date.nullable(),
  lastSyncedAt: date.nullable(),
  voidedAt: date.nullable(),
  createdAt: date,
  updatedAt: date,
});
export type Agreement = z.infer<typeof agreement>;
export async function fetchLinkedAgreement(
  crewId: string,
  agreementId: string,
  memberUserId: string,
  generation: number,
  signal: AbortSignal
) {
  id.parse(crewId);
  uuid.parse(agreementId);
  let cursor: string | null = null;
  const seenCursors = new Set<string>(),
    seenIds = new Set<string>();
  const current = () => {
    if (signal.aborted || generation !== getAuthGeneration())
      throw new Error("Agreement session expired");
  };
  for (;;) {
    current();
    const page: z.infer<ReturnType<typeof pageSchema>> = pageSchema().parse(
      await api.get(`/crews/${crewId}/agreements`, {
        service: "aurora",
        signal,
        params: { view: "all", limit: 100, ...(cursor ? { cursor } : {}) },
      })
    );
    current();
    for (const item of page.items) {
      if (item.crewId !== crewId || seenIds.has(item.id))
        throw new Error("Agreement scope or pagination changed. Refresh to reload.");
      seenIds.add(item.id);
    }
    const match = page.items.find((item) => item.id === agreementId);
    if (match) {
      if (match.memberUserId !== memberUserId) throw new Error("Agreement recipient mismatch");
      return { ...match, canSync: page.capabilities.sync };
    }
    if (!page.nextCursor) return null;
    if (page.nextCursor === cursor || seenCursors.has(page.nextCursor))
      throw new Error("Agreement pagination repeated. Refresh to reload.");
    seenCursors.add(page.nextCursor);
    cursor = page.nextCursor;
  }
}
function pageSchema() {
  return z.object({
    items: z.array(agreement),
    nextCursor: id.nullable(),
    capabilities: z.object({ sync: z.boolean() }),
  });
}
export function agreementMediaId(path: string | null): string | null {
  const match = path?.match(/^\/aurora\/media\/assets\/([0-9a-f-]{36})\/content$/i);
  return match && uuid.safeParse(match[1]).success ? match[1]! : null;
}
export async function openAgreementSigning(
  record: Agreement,
  userId: string,
  generation: number,
  signal: AbortSignal
) {
  const data = agreement.parse(record);
  const current = () => {
    if (signal.aborted || generation !== getAuthGeneration())
      throw new Error("Agreement session expired");
  };
  current();
  if (!data.capabilities.sign || data.memberUserId !== userId || data.status !== "sent")
    throw new Error("This agreement is not awaiting your signature");
  const session = z
    .object({ signLink: z.string().url(), expiresAt: date })
    .parse(
      await api.post(`/crew-agreements/${data.id}/signing-session`, { service: "aurora", signal })
    );
  current();
  const url = new URL(session.signLink);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    Date.parse(session.expiresAt) <= Date.now()
  )
    throw new Error("Invalid or expired agreement signing link");
  return url.href;
}
