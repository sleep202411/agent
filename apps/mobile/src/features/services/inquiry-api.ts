import { api } from "@/lib/api-client";
export async function sendServiceInquiry(serviceId: string, text: string, clientKey: string) {
  const body = text.trim();
  if (!serviceId.trim() || !body || body.length > 4000 || !clientKey || clientKey.length > 64)
    throw new Error("Invalid inquiry");
  const response = await api.post<{ conversation?: { id?: unknown } }>("/conversations", {
    service: "aurora",
    data: {
      contextType: "service",
      contextId: serviceId,
      firstMessage: body,
      firstMessageClientKey: clientKey,
    },
  });
  if (typeof response?.conversation?.id !== "string" || !response.conversation.id.trim())
    throw new Error("Invalid conversation response");
  return response.conversation.id;
}
export function inquiryKey() {
  return typeof globalThis.crypto?.randomUUID === "function"
    ? globalThis.crypto.randomUUID()
    : `inq-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}
