import { z } from "zod";
import { api } from "@/lib/api-client";
import { getAuthGeneration } from "@/auth/auth-store";

const identifier = z.string().trim().min(1).max(512);
const httpsUrl = z
  .string()
  .url()
  .refine((value) => {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password;
  }, "Expected a secure verification URL");
const receipt = z.object({ certifyId: identifier, certifyUrl: httpsUrl });
const status = z.object({ needAuth: z.boolean(), needRole: z.boolean().optional() });
export type KycReceipt = z.infer<typeof receipt>;
export type KycIdentity = {
  userName: string;
  certNo: string;
  userId: string;
  metaInfo: string;
  returnUrl: string;
};
function current(generation: number, signal: AbortSignal) {
  signal.throwIfAborted();
  if (generation !== getAuthGeneration()) throw Error("Verification session expired.");
}
export async function loadKycStatus(generation: number, signal: AbortSignal) {
  current(generation, signal);
  const value = await api.get("/user/needAuth", { signal, cache: "no-store", retry: false });
  current(generation, signal);
  return status.parse(value);
}
export async function startKyc(identity: KycIdentity, generation: number, signal: AbortSignal) {
  current(generation, signal);
  const data = z
    .object({
      userName: z.string().trim().min(1).max(100),
      certNo: z
        .string()
        .trim()
        .regex(/^\d{17}[\dXx]$/)
        .transform((value) => value.toUpperCase()),
      userId: identifier,
      metaInfo: z
        .string()
        .min(2)
        .refine((value) => {
          try {
            const parsed = JSON.parse(value);
            return !!parsed && typeof parsed === "object" && !Array.isArray(parsed);
          } catch {
            return false;
          }
        }, "Invalid verification device metadata"),
      returnUrl: httpsUrl,
    })
    .parse(identity);
  const value = await api.postForm("/user/certify/init/web", data, { signal, retry: false });
  current(generation, signal);
  return receipt.parse(value);
}
export async function confirmKyc(certifyId: string, generation: number, signal: AbortSignal) {
  current(generation, signal);
  const value = await api.postForm(
    "/user/certify/query",
    { certifyId: identifier.parse(certifyId) },
    { signal, retry: false }
  );
  current(generation, signal);
  // A successful HTTP/envelope response alone does not establish identity verification.
  return z.object({ status: z.string().min(1) }).parse(value).status === "T";
}
/** Only a callback for this exact browser session can trigger backend confirmation. */
export function readKycReturn(url: string, returnUrl: string, certifyId: string) {
  const target = new URL(returnUrl),
    incoming = new URL(url);
  if (incoming.origin !== target.origin || incoming.pathname !== target.pathname) return null;
  const raw = incoming.searchParams.get("response");
  if (!raw) return null;
  const value = z
    .object({
      code: z.string(),
      reason: z.string().optional(),
      extInfo: z.object({ certifyId: identifier }).optional(),
    })
    .parse(JSON.parse(raw.startsWith("{") ? raw : decodeURIComponent(raw)));
  if (value.code === "1000" && value.extInfo?.certifyId !== certifyId)
    throw Error("Verification response does not match the current attempt.");
  return value;
}
