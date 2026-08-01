import { ZodError } from "zod";
import { describe, expect, it } from "vitest";

import { parseCancellationData, parseInvocationData } from "./routes.js";

describe("parseInvocationData", () => {
  it("accepts only the public invocation contract", async () => {
    await expect(
      parseInvocationData({
        json: async () => ({
          inputEventId: "event-1",
          sessionName: "agent:v1:conversation:0197f4a2-0800-7000-8000-000000000004",
          invocationId: "0197f4a2-0800-7000-8000-000000000010",
          attemptId: "0197f4a2-0800-7000-8000-000000000012",
          attemptOrdinal: 0,
          provisionalRunId: "0197f4a2-0800-7000-8000-000000000011",
        }),
      })
    ).resolves.toEqual({
      inputEventId: "event-1",
      sessionName: "agent:v1:conversation:0197f4a2-0800-7000-8000-000000000004",
      invocationId: "0197f4a2-0800-7000-8000-000000000010",
      attemptId: "0197f4a2-0800-7000-8000-000000000012",
      attemptOrdinal: 0,
      provisionalRunId: "0197f4a2-0800-7000-8000-000000000011",
    });

    await expect(
      parseInvocationData({
        json: async () => ({
          inputEventId: "event-1",
          sessionName: "agent:v1:conversation:0197f4a2-0800-7000-8000-000000000004",
          invocationId: "0197f4a2-0800-7000-8000-000000000010",
          attemptId: "0197f4a2-0800-7000-8000-000000000012",
          attemptOrdinal: 0,
          provisionalRunId: "0197f4a2-0800-7000-8000-000000000011",
          actorId: "untrusted-client-claim",
        }),
      })
    ).rejects.toBeInstanceOf(ZodError);
  });

  it("classifies malformed JSON as a request-contract violation", async () => {
    await expect(
      parseInvocationData({
        json: async () => {
          throw new SyntaxError("Unexpected end of JSON input");
        },
      })
    ).rejects.toBeInstanceOf(ZodError);
  });
});

describe("parseCancellationData", () => {
  it("accepts the durable invocation identity without requiring the input event", async () => {
    const invocationId = "db18bc4b-b371-4962-a154-3a3e0264d7bf";
    await expect(
      parseCancellationData({
        json: async () => ({
          invocationId,
          sessionName: "agent:v1:conversation:194e2d15-d9ef-46fa-972c-61130163d72c",
        }),
      })
    ).resolves.toEqual({
      invocationId,
      sessionName: "agent:v1:conversation:194e2d15-d9ef-46fa-972c-61130163d72c",
    });
  });

  it("rejects a client-supplied input event in place of an invocation id", async () => {
    await expect(
      parseCancellationData({
        json: async () => ({
          inputEventId: "event-1",
          sessionName: "agent:v1:conversation:194e2d15-d9ef-46fa-972c-61130163d72c",
        }),
      })
    ).rejects.toThrow();
  });
});
