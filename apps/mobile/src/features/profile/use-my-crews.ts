import { useEffect, useMemo, useState } from "react";
import { fetchMyCrews } from "@/data/crew-api";
import { useBrowseVersion } from "@/data/browse-refresh";
import type { CrewSummary } from "@/data/types";
import { useScreenActive } from "@/hooks/use-app-active";
import { useTranslations } from "@/i18n";

export function useMyCrews(owner?: string) {
  const active = useScreenActive(),
    version = useBrowseVersion(),
    t = useTranslations();
  const [revision, setRevision] = useState(0);
  const scope = useMemo(
    () => ({ owner, active, version, revision, t }),
    [owner, active, version, revision, t]
  );
  const [result, setResult] = useState<{
    scope: typeof scope;
    items?: CrewSummary[];
    error?: string;
  }>();
  useEffect(() => {
    if (!scope.owner || !scope.active) return;
    const controller = new AbortController();
    void fetchMyCrews(controller.signal).then(
      (items) => {
        if (!controller.signal.aborted) setResult({ scope, items });
      },
      (error) => {
        if (!controller.signal.aborted)
          setResult({
            scope,
            error:
              error instanceof Error && error.message.trim()
                ? error.message
                : scope.t("crews.loadErrorFallback"),
          });
      }
    );
    return () => controller.abort();
  }, [scope]);
  const visible = result?.scope === scope ? result : undefined;
  return {
    items: visible?.items,
    error: visible?.error,
    loading: !!owner && active && !visible,
    refresh: () => setRevision((value) => value + 1),
  };
}
