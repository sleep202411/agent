"use client";
import { useLayoutEffect, useRef } from "react";
import { useAuth } from "@/app/_components/auth-provider";
import { createComputeCustomRecharge, type CreateComputeCustomRechargeInput } from "./billing";

const ALREADY_PENDING = new DOMException("Payment request already pending", "AbortError");

/** A mounted payer owns the request; failed retries reuse the same order key. */
export function useRechargeAttempt() {
  const { user, isCurrentAccount } = useAuth();
  const controller = useRef<AbortController | null>(null);
  const pending = useRef(false);
  const attempt = useRef<{ signature: string; key: string } | null>(null);
  useLayoutEffect(() => {
    const next = new AbortController();
    controller.current = next;
    return () => next.abort();
  }, []);
  const current = () =>
    Boolean(
      user?.id != null &&
      isCurrentAccount(user.id) &&
      controller.current &&
      !controller.current.signal.aborted
    );
  const assertCurrent = () => {
    if (!current()) throw new DOMException("Payment session changed", "AbortError");
  };
  return {
    current,
    assertCurrent,
    cancel: () => controller.current?.abort(),
    complete: () => {
      attempt.current = null;
    },
    finish: (error?: unknown) => {
      if (error !== ALREADY_PENDING) pending.current = false;
    },
    request: async (input: Omit<CreateComputeCustomRechargeInput, "idempotencyKey">) => {
      assertCurrent();
      if (pending.current) throw ALREADY_PENDING;
      pending.current = true;
      const signature = JSON.stringify(input);
      if (attempt.current?.signature !== signature)
        attempt.current = { signature, key: crypto.randomUUID() };
      const result = await createComputeCustomRecharge(
        { ...input, idempotencyKey: attempt.current.key },
        controller.current!.signal
      );
      assertCurrent();
      return { result, urls: { successUrl: input.successUrl, backUrl: input.backUrl } };
    },
  };
}
