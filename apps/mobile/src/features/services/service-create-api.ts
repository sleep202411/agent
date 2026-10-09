import { z } from "zod";
import { api } from "@/lib/api-client";
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
  return z
    .object({ id: z.string().min(1) })
    .parse(await api.post("/creator-services", { service: "aurora", data }));
}
