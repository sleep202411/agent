"use client";
import { useEffect, useRef, useState } from "react";
import { z } from "zod";
import { api, ApiRequestError } from "@/src/lib/api";

const requestSchema = z.strictObject({
  requestId: z.uuid(),
  locale: z.enum(["en-US", "zh-CN", "zh-HK"]),
});
const receiptSchema = z.object({
  id: z.uuid(),
  status: z.enum(["cached", "succeeded", "dispatched", "uncertain"]),
  analysisVersion: z.string().min(1),
  sourceFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  createdAt: z.iso.datetime(),
  finishedAt: z.iso.datetime().nullable(),
});
type Request = z.infer<typeof requestSchema>;
type Receipt = z.infer<typeof receiptSchema>;

/** Caller keys this component by account, IP and locale. Only explicit actions
 * send requests; recovery reads a receipt and never resubmits paid work. */
export function useContentGpsAnalysis(
  ipId: string,
  userId: string,
  locale: string,
  onDenied: (error: unknown) => void,
  onReady: () => void
) {
  const path = `/aurora/ip-commerce/me/ips/${encodeURIComponent(ipId)}/content-gps`;
  const key = `content-gps-analysis:${userId}:${ipId}:${locale}`;
  const [request, setRequest] = useState<Request | null>(null);
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [storageReady, setStorageReady] = useState(false);
  const operation = useRef<AbortController | null>(null);
  useEffect(() => {
    let active = true;
    queueMicrotask(() => {
      if (!active) return;
      try {
        const stored = sessionStorage.getItem(key);
        if (stored) {
          const recovered = requestSchema.parse(JSON.parse(stored));
          if (recovered.locale !== locale) throw new Error("Analysis request locale mismatch.");
          setRequest(recovered);
        }
        setStorageReady(true);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause));
      }
      setBusy(false);
    });
    return () => {
      active = false;
      operation.current?.abort();
    };
    // The caller keys this hook's component by account/IP/locale.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  function failed(cause: unknown) {
    setError(cause instanceof Error ? cause.message : String(cause));
    if (cause instanceof ApiRequestError && [401, 403].includes(cause.status)) onDenied(cause);
  }
  async function readReceipt(input: Request, signal: AbortSignal) {
    try {
      const value = receiptSchema.parse(
        await api.get(`${path}/analysis/${input.requestId}`, { signal })
      );
      if (signal.aborted) return;
      if (value.id !== input.requestId) throw new Error("Analysis receipt does not match request.");
      setReceipt(value);
      setNotFound(false);
      if (["cached", "succeeded"].includes(value.status)) onReady();
    } catch (cause) {
      if (signal.aborted) return;
      // A missing receipt can mean dispatch was rejected before reservation.
      // It is not an ownership verdict and never triggers a POST automatically.
      if (cause instanceof ApiRequestError && cause.status === 404) setNotFound(true);
      failed(cause);
    }
  }
  async function check() {
    if (operation.current || !request) return;
    const controller = new AbortController();
    operation.current = controller;
    setBusy(true);
    setError(null);
    setNotFound(false);
    setReceipt(null);
    try {
      await readReceipt(request, controller.signal);
    } finally {
      operation.current = null;
      if (!controller.signal.aborted) setBusy(false);
    }
  }
  const complete = receipt?.status === "cached" || receipt?.status === "succeeded";
  async function analyze() {
    if (operation.current || !storageReady || (request && !complete && !notFound)) return;
    const controller = new AbortController();
    operation.current = controller;
    setBusy(true);
    setError(null);
    setNotFound(false);
    setReceipt(null);
    try {
      const input =
        request && !complete
          ? request
          : requestSchema.parse({
              requestId: crypto.randomUUID(),
              locale,
            });
      // Storage failure must not permit an unrecoverable dispatch.
      sessionStorage.setItem(key, JSON.stringify(input));
      setRequest(input);
      await api.post(`${path}/analyze`, {
        data: input,
        signal: controller.signal,
        timeout: 60_000,
      });
      if (!controller.signal.aborted) await readReceipt(input, controller.signal);
    } catch (cause) {
      if (!controller.signal.aborted) failed(cause);
    } finally {
      operation.current = null;
      if (!controller.signal.aborted) setBusy(false);
    }
  }
  return {
    request,
    receipt,
    notFound,
    busy,
    error,
    analyze,
    check,
    canAnalyze: storageReady && (!request || complete || notFound),
  };
}
