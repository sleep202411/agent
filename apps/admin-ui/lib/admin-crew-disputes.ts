import { adminUiApiPath } from "./admin-api";
export type CaseRecord = {
  id: string;
  taskId: string;
  title: string;
  category?: "copyright" | "payment" | "violation" | "harassment" | "other" | null;
  desiredResolution?: "payment_allocation" | "warning" | "takedown" | null;
  status: "open" | "in_review" | "resolved" | "appealed";
  ownerAdminId: string | null;
  openedByUserId: string;
  respondentUserId: string;
  version: number;
  createdAt: string;
};
export type CaseEvent = {
  id: string;
  version: number;
  actorId: string;
  actorKind: string;
  action: string;
  message: string;
  submissionIds: string[];
  attachmentIds: string[];
  createdAt: string;
};
export type CaseDetail = CaseRecord & { events: CaseEvent[]; nextBeforeVersion: number | null };
export type CasePage = { items: CaseRecord[]; nextBeforeId: string | null };
export type CaseWrite = {
  requestKey: string;
  expectedVersion: number;
  action: "claim" | "message" | "resolve";
  message: string;
  submissionIds: string[];
};
export class CaseApiError extends Error {
  constructor(
    public status: number,
    message: string
  ) {
    super(message);
  }
}
export async function caseRequest<T>(
  path: string,
  signal: AbortSignal,
  body?: CaseWrite
): Promise<T> {
  const response = await fetch(adminUiApiPath(`/api/admin/crew-disputes${path}`), {
    signal,
    cache: "no-store",
    ...(body
      ? {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        }
      : {}),
  });
  const result = await response.json();
  if (!response.ok || (typeof result.code === "number" && result.code !== 200)) {
    throw new CaseApiError(
      response.ok ? result.code : response.status,
      result.message ?? result.msg ?? `Request failed (${response.status})`
    );
  }
  return (result.code === 200 ? result.data : result) as T;
}
