import { expect, it, vi } from "vitest";
import { sendServiceInquiry } from "./inquiry-api";
import { api } from "@/lib/api-client";
vi.mock("@/lib/api-client", () => ({ api: { post: vi.fn() } }));
it("sends service context and a stable message key, never a client-selected recipient", async () => {
  vi.mocked(api.post).mockResolvedValue({ conversation: { id: "conversation" } });
  expect(await sendServiceInquiry("service", " Hello ", "key")).toBe("conversation");
  expect(api.post).toHaveBeenCalledWith("/conversations", {
    service: "aurora",
    data: {
      contextType: "service",
      contextId: "service",
      firstMessage: "Hello",
      firstMessageClientKey: "key",
    },
  });
});
it.each(["", " ", "x".repeat(4001)])("rejects invalid message length", async (body) => {
  await expect(sendServiceInquiry("service", body, "key")).rejects.toThrow();
});
it("does not report success for a malformed response", async () => {
  vi.mocked(api.post).mockResolvedValue({});
  await expect(sendServiceInquiry("service", "Hi", "key")).rejects.toThrow(
    "Invalid conversation response"
  );
});
