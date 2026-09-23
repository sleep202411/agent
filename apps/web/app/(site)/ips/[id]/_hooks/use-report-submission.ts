"use client";

import { useRef } from "react";
import { useBlockIpContent, useReportIpContent } from "@/src/lib/ip-commerce/hooks";
import type { CreateIpReportInput } from "@/src/lib/ip-commerce/api";

export function useReportSubmission(userId?: string) {
  const report = useReportIpContent();
  const block = useBlockIpContent();
  const accepted = useRef<string | null>(null);
  const busy = useRef(false);

  async function submit(input: { ipId: string; report: CreateIpReportInput; blockIp: boolean }) {
    if (!userId || busy.current) return false;
    busy.current = true;
    const identity = JSON.stringify([
      userId,
      input.ipId,
      input.report.targetType,
      input.report.targetId,
      input.report.reason,
      input.report.description ?? "",
      input.report.evidenceAssetId ?? null,
    ]);
    try {
      if (accepted.current !== identity) {
        await report.mutateAsync(input.report);
        // A block failure must not cause another already-accepted report on retry.
        accepted.current = identity;
      }
      if (input.blockIp) {
        await block.mutateAsync({
          targetType: "ip",
          targetId: input.ipId,
          reason: input.report.reason,
        });
      }
      accepted.current = null;
      return true;
    } finally {
      busy.current = false;
    }
  }

  return { submit, isPending: report.isPending || block.isPending };
}
