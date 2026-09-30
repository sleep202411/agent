import { z } from "zod";
import { api } from "@/lib/api-client";
import { getAuthGeneration } from "@/auth/auth-store";
import { agreement, type Agreement } from "./agreement-detail-api";
export type AgreementAction = "sync" | "send" | "archive";
export type ActionAgreement = Agreement & { canSync: boolean };
export function agreementActionChoices(record: ActionAgreement): AgreementAction[] {
  const actions: AgreementAction[] = [];
  if (record.canSync && record.providerDocumentId) actions.push("sync");
  if (
    record.delivery.canRetry &&
    record.delivery.status === "failed" &&
    !record.providerDocumentId &&
    ["draft", "failed"].includes(record.status)
  )
    actions.push("send");
  if (
    record.archive.canRetry &&
    record.archive.status === "failed" &&
    record.status === "signed" &&
    record.providerDocumentId
  )
    actions.push("archive");
  return actions;
}
export async function runAgreementAction(
  record: ActionAgreement,
  action: AgreementAction,
  generation: number
) {
  const snapshot = agreement.extend({ canSync: z.boolean() }).parse(record);
  z.enum(["sync", "send", "archive"]).parse(action);
  if (!agreementActionChoices(snapshot).includes(action))
    throw new Error("Agreement action is not currently available");
  if (generation !== getAuthGeneration()) throw new Error("Agreement action session expired");
  const path = action === "sync" ? "sync" : `${action}/retry`;
  const result = agreement.parse(
    await api.post(`/crew-agreements/${snapshot.id}/${path}`, { service: "aurora" })
  );
  if (generation !== getAuthGeneration()) throw new Error("Agreement action session expired");
  if (
    result.id !== snapshot.id ||
    result.crewId !== snapshot.crewId ||
    result.memberUserId !== snapshot.memberUserId ||
    result.signerName !== snapshot.signerName ||
    result.signerEmail !== snapshot.signerEmail ||
    result.title !== snapshot.title ||
    (action !== "send" && result.providerDocumentId !== snapshot.providerDocumentId)
  )
    throw new Error("Agreement response mismatch. Refresh before continuing.");
  return result;
}
