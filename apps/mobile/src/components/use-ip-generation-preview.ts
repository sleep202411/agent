import { useEffect, useMemo, useState } from "react";
import { useAuth } from "@/auth";
import { api } from "@/lib/api-client";

type CostPreview = { computePoints: number; isFree: boolean };

export function useIpGenerationPreview(input: {
  ipId: string;
  templateId: string | null;
  requiresReference: boolean;
  referenceId: string | null;
}) {
  const { generation } = useAuth();
  const { ipId, templateId, requiresReference, referenceId } = input;
  const scope = useMemo(
    () =>
      templateId && (!requiresReference || referenceId)
        ? { ipId, templateId, referenceId, generation }
        : null,
    [ipId, templateId, requiresReference, referenceId, generation]
  );
  const [result, setResult] = useState<{
    scope: NonNullable<typeof scope>;
    cost: CostPreview | null;
    error: boolean;
  } | null>(null);

  useEffect(() => {
    if (!scope) return;
    const controller = new AbortController();
    void api
      .post<{ cost: CostPreview }>(
        `/ip-commerce/ips/${encodeURIComponent(scope.ipId)}/generation-templates/${encodeURIComponent(scope.templateId)}/preview`,
        {
          service: "aurora",
          signal: controller.signal,
          data: { referenceImageAssetId: scope.referenceId || undefined },
        }
      )
      .then((response) => {
        if (!controller.signal.aborted) {
          setResult({ scope, cost: response.cost ?? null, error: !response.cost });
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) setResult({ scope, cost: null, error: true });
      });
    return () => controller.abort();
  }, [scope]);

  // Never expose the previous input/session's quote during the new render.
  const current = scope !== null && result?.scope === scope ? result : null;
  return {
    costPreview: current?.cost ?? null,
    previewLoading: scope !== null && current === null,
    previewError: current?.error ?? false,
  };
}
