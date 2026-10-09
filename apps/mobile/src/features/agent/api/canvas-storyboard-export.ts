import { z } from "zod";
import { api, ApiRequestError } from "@/lib/api-client";
import { getAuthGeneration } from "@/auth/auth-store";
import { durableRecord, type DurableRecord } from "@/lib/durable-record";
import { pendingRequest } from "@/lib/pending-request";
import {
  readPlatformCanvasDocument,
  platformCanvasUpdatePending,
  type PlatformCanvasScope,
} from "./platform-canvas-document";
const job = z.object({
  id: z.string().uuid(),
  sequence: z.number().int(),
  width: z.number(),
  height: z.number(),
  status: z.enum(["queued", "running", "completed", "failed", "cancelled", "expired"]),
  error: z.string().nullable(),
  expiresAt: z.string(),
});
export type CanvasExportJob = z.infer<typeof job>;
const intent = z.object({
  clientKey: z.string().uuid(),
  documentId: z.string().uuid(),
  expectedSequence: z.number().int().nonnegative(),
  width: z.number().int().min(64).max(1920),
  height: z.number().int().min(64).max(1920),
});
export function canvasStoryboardExport(
  scope: PlatformCanvasScope,
  userId: string,
  storage: DurableRecord = durableRecord("canvas-storyboard-export", userId, scope.documentId)
) {
  const pending = pendingRequest(intent, scope.generation, storage);
  const check = (signal: AbortSignal) => {
    signal.throwIfAborted();
    if (getAuthGeneration() !== scope.generation) throw Error("Canvas session expired.");
  };
  const authorize = async (signal: AbortSignal) => {
    check(signal);
    await readPlatformCanvasDocument(scope, signal);
    check(signal);
  };
  return {
    read: pending.read,
    list: async (signal: AbortSignal) => {
      await authorize(signal);
      const result = await api.get("/storyboard-exports", {
        service: "aurora",
        signal,
        retry: false,
        params: { documentId: scope.documentId },
      });
      check(signal);
      return z.array(job).parse(result);
    },
    create: async (
      clientKey: string,
      sequence: number,
      signal: AbortSignal,
      format = "1280x720"
    ) => {
      await authorize(signal);
      if (platformCanvasUpdatePending(scope, userId).read())
        throw Error("Save pending canvas changes before exporting.");
      const [width, height] = z
        .enum(["1280x720", "1920x1080", "720x1280", "1080x1920"])
        .parse(format)
        .split("x")
        .map(Number);
      const value =
        pending.read() ??
        intent.parse({
          clientKey,
          documentId: scope.documentId,
          expectedSequence: sequence,
          width,
          height,
        });
      if (value.documentId !== scope.documentId) throw Error("Export document scope mismatch.");
      pending.save(value);
      try {
        const { clientKey: requestId, ...body } = value;
        const result = job.parse(
          await api.post("/storyboard-exports", {
            service: "aurora",
            signal,
            retry: false,
            data: { ...body, requestId },
          })
        );
        check(signal);
        if (
          result.sequence !== value.expectedSequence ||
          result.width !== value.width ||
          result.height !== value.height
        )
          throw Error("Storyboard export receipt mismatch.");
        pending.clear(value.clientKey);
        return result;
      } catch (e) {
        check(signal);
        if (e instanceof ApiRequestError && [400, 401, 403, 404, 409].includes(e.status))
          pending.clear(value.clientKey);
        throw e;
      }
    },
    cancel: async (id: string, signal: AbortSignal) => {
      await authorize(signal);
      await api.post(`/storyboard-exports/${z.string().uuid().parse(id)}/cancel`, {
        service: "aurora",
        signal,
        retry: false,
      });
      check(signal);
    },
    download: async (id: string, signal: AbortSignal) => {
      await authorize(signal);
      const result = z.object({ url: z.string().url(), expiresAt: z.string() }).parse(
        await api.post(`/storyboard-exports/${z.string().uuid().parse(id)}/download`, {
          service: "aurora",
          signal,
          retry: false,
        })
      );
      check(signal);
      const url = new URL(result.url);
      if (
        url.protocol !== "https:" ||
        url.username ||
        url.password ||
        !(Date.parse(result.expiresAt) > Date.now())
      )
        throw Error("Invalid storyboard download URL.");
      return url.href;
    },
  };
}
