"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { useAuth } from "@/app/_components/auth-provider";
import { useProjectPayerWorkspace } from "@/app/[locale]/project/_components/project-context";

/** Own browser effects; dispatched jobs retain the feed's server recovery contract. */
export function useComposerSubmission() {
  const { user } = useAuth();
  const workspace = useProjectPayerWorkspace();
  const scope = JSON.stringify([user?.id ?? null, workspace?.id ?? null]);
  const activeScope = useRef<string | null>(null);
  const active = useRef<object | null>(null);
  const [submitting, setSubmitting] = useState(false);
  useLayoutEffect(() => {
    activeScope.current = scope;
    return () => {
      activeScope.current = null;
      active.current = null;
      setSubmitting(false);
    };
  }, [scope]);
  return {
    submitting,
    start() {
      if (activeScope.current !== scope || active.current) return null;
      const run = {};
      active.current = run;
      setSubmitting(true);
      return run;
    },
    isCurrent(run: object) {
      return active.current === run && activeScope.current === scope;
    },
    finish(run: object) {
      if (active.current !== run) return;
      active.current = null;
      setSubmitting(false);
    },
  };
}
