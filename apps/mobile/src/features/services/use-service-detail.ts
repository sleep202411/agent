import { useEffect, useState } from "react";
import { fetchCreatorServiceById } from "@/data/creator-service-api";
import type { CreatorServiceDetail } from "@/data/types";

export function useServiceDetail(id: string, generation: number, active = true) {
  const [revision, setRevision] = useState(0);
  const key = JSON.stringify([id, generation, revision, active]);
  const [result, setResult] = useState<{
    key: string;
    service?: CreatorServiceDetail;
    error?: string;
  }>();
  const [resultScope, setResultScope] = useState(key);
  if (resultScope !== key) {
    setResultScope(key);
    setResult(undefined);
  }
  useEffect(() => {
    if (!active) return;
    const controller = new AbortController();
    void fetchCreatorServiceById(id, controller.signal).then(
      (service) => {
        if (!controller.signal.aborted) setResult({ key, service });
      },
      (error: unknown) => {
        if (!controller.signal.aborted)
          setResult({ key, error: error instanceof Error ? error.message : String(error) });
      }
    );
    return () => controller.abort();
  }, [id, generation, key, active]);
  return {
    service: active && result?.key === key ? result.service : undefined,
    error: active && result?.key === key ? result.error : undefined,
    loading: active && result?.key !== key,
    retry: () => setRevision((value) => value + 1),
  };
}
