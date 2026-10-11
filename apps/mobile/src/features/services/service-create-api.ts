import { z } from "zod";
import { api, ApiRequestError } from "@/lib/api-client";
import { serviceDetailsSchema } from "./service-edit-api";
export const serviceDraftSchema = serviceDetailsSchema.omit({ expectedVersion: true });
export async function createServiceDraft(
  input: z.input<typeof serviceDraftSchema>,
  clientRequestKey: string
) {
  const data = {
    ...serviceDraftSchema.parse(input),
    clientRequestKey: z.string().min(8).max(64).parse(clientRequestKey),
    packages: [],
    requirementQuestions: [],
  };
  try {
    return z
      .object({ id: z.string().min(1) })
      .parse(await api.post("/creator-services", { service: "aurora", data }));
  } catch (error) {
    // The server supplies this receipt only after matching the owner, creation
    // key and original payload. Open the edited service; never replay an update.
    if (error instanceof ApiRequestError && error.status === 409 && error.responseBody) {
      try {
        const receipt = z
          .object({ serviceId: z.string().min(1) })
          .parse(JSON.parse(error.responseBody));
        return { id: receipt.serviceId };
      } catch {
        // Unidentified conflicts (including archived creations) remain errors.
      }
    }
    throw error;
  }
}
