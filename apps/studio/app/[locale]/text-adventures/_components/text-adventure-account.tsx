"use client";

import { Fragment, useLayoutEffect, useRef, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { useAuth } from "@/app/_components/auth-provider";
import { Button } from "@/components/ui/button";

export function TextAdventureAccount({ children }: { children: (userId: string) => ReactNode }) {
  const { user, loading, signIn } = useAuth();
  const common = useTranslations("common");
  const account = useTranslations("account");
  if (loading)
    return (
      <p className="p-6 text-sm text-muted-foreground" role="status">
        {common("loading")}
      </p>
    );
  if (!user)
    return (
      <div className="p-6">
        <Button onClick={signIn}>{account("signIn")}</Button>
      </div>
    );
  return <Fragment key={String(user.id)}>{children(String(user.id))}</Fragment>;
}

/** A departed editor must not start follow-up writes under a replacement session. */
export function useTextAdventureOwner(userId: string) {
  const { isCurrentAccount } = useAuth();
  const lifetime = useRef<AbortController | null>(null);
  useLayoutEffect(() => {
    const controller = new AbortController();
    lifetime.current = controller;
    return () => {
      controller.abort();
      lifetime.current = null;
    };
  }, [userId]);
  return {
    current: () =>
      Boolean(lifetime.current && !lifetime.current.signal.aborted && isCurrentAccount(userId)),
    begin() {
      const controller = lifetime.current;
      const current = () =>
        Boolean(controller && !controller.signal.aborted && isCurrentAccount(userId));
      const assert = () => {
        if (!current()) throw new DOMException("Editor session changed", "AbortError");
      };
      assert();
      return { signal: controller!.signal, current, assert };
    },
  };
}
