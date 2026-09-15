"use client";

import { createContext, useContext, useLayoutEffect, useState, type ReactNode } from "react";

function createRequestScope() {
  let active = true;
  const requests = new Set<AbortController>();
  return {
    activate() {
      active = true;
    },
    begin() {
      if (!active) return null;
      const controller = new AbortController();
      requests.add(controller);
      return {
        signal: controller.signal,
        current: () => active && requests.has(controller) && !controller.signal.aborted,
        release: () => {
          requests.delete(controller);
        },
        cancel: () => {
          controller.abort();
          requests.delete(controller);
        },
      };
    },
    close() {
      active = false;
      for (const controller of requests) controller.abort();
      requests.clear();
    },
  };
}
const Context = createContext<ReturnType<typeof createRequestScope> | null>(null);
function SessionScope({ children }: { children: ReactNode }) {
  const [scope] = useState(createRequestScope);
  useLayoutEffect(() => {
    scope.activate();
    return () => scope.close();
  }, [scope]);
  return <Context.Provider value={scope}>{children}</Context.Provider>;
}

/** Preserve same-session drafts; replace the entire shell for another identity. */
export function AdminSessionBoundary({
  scopeKey,
  children,
}: {
  scopeKey: string;
  children: ReactNode;
}) {
  return <SessionScope key={scopeKey}>{children}</SessionScope>;
}
export function useAdminSessionRequests() {
  const scope = useContext(Context);
  if (!scope) throw new Error("Administrator session boundary is required.");
  return scope;
}
