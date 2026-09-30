import { z } from "zod";
import { api } from "@/lib/api-client";
import { getAuthGeneration } from "@/auth/auth-store";
import { agreement } from "./agreement-detail-api";
export const newAgreement = z
  .object({
    memberUserId: z.string().trim().min(1).max(64),
    signerName: z.string().trim().min(1).max(128),
    signerEmail: z.string().trim().email().max(320),
    title: z.string().trim().min(1).max(180),
  })
  .strict();
export type NewAgreement = z.infer<typeof newAgreement>;
export async function createAgreement(crewId: string, input: NewAgreement, generation: number) {
  z.string()
    .regex(/^[A-Za-z0-9_-]{1,64}$/)
    .parse(crewId);
  const data = newAgreement.parse(input);
  const current = () => {
    if (generation !== getAuthGeneration()) throw new Error("Account changed. Reopen agreements.");
  };
  current();
  const result = agreement.parse(
    await api.post(`/crews/${crewId}/agreements`, { service: "aurora", data })
  );
  current();
  if (
    result.crewId !== crewId ||
    result.memberUserId !== data.memberUserId ||
    result.signerName !== data.signerName ||
    result.signerEmail !== data.signerEmail.toLowerCase() ||
    result.title !== data.title
  )
    throw new Error(
      "Agreement receipt does not match. Refresh the list before creating another agreement."
    );
  return result;
}
