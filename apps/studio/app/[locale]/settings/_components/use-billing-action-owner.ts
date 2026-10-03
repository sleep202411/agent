"use client";
import { useLayoutEffect, useRef } from "react";
import { useAuth } from "@/app/_components/auth-provider";

/** Mounted account owns the request and every completion effect. */
export function useBillingActionOwner(userId: string | number) {
  const { isCurrentAccount } = useAuth();
  const owner = useRef<AbortController | null>(null);
  const pending = useRef(false);
  useLayoutEffect(() => {
    const controller = new AbortController();
    owner.current = controller;
    return () => controller.abort();
  }, []);
  const current = () =>
    Boolean(owner.current && !owner.current.signal.aborted && isCurrentAccount(userId));
  return {
    current,
    begin: () => {
      if (!current() || pending.current) return null;
      pending.current = true;
      return owner.current!.signal;
    },
    end: () => {
      pending.current = false;
    },
  };
}
