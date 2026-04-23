/**
 * "发送验证码" button state hook — shared between register + forgot-
 * password flows. Holds a 60-second cooldown across re-renders and
 * cancels the interval on unmount.
 */
"use client";

import { useCallback, useEffect, useRef, useState } from "react";

const DEFAULT_COOLDOWN_SEC = 60;

export interface UseSendCodeOptions {
  cooldownSec?: number;
  /**
   * Called with the current email (or any identifier) when the user
   * taps "send". Return a promise — the hook won't start the cooldown
   * until it resolves successfully.
   */
  send: () => Promise<void>;
}

export function useSendCode({ cooldownSec = DEFAULT_COOLDOWN_SEC, send }: UseSendCodeOptions) {
  const [remaining, setRemaining] = useState(0);
  const [sending, setSending] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopTimer = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const startTimer = useCallback(() => {
    stopTimer();
    setRemaining(cooldownSec);
    timerRef.current = setInterval(() => {
      setRemaining((prev) => {
        if (prev <= 1) {
          stopTimer();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  }, [cooldownSec, stopTimer]);

  useEffect(() => stopTimer, [stopTimer]);

  const trigger = useCallback(async () => {
    if (sending || remaining > 0) return;
    setSending(true);
    try {
      await send();
      startTimer();
    } finally {
      setSending(false);
    }
  }, [sending, remaining, send, startTimer]);

  return {
    /** Seconds remaining before the button is tappable again. */
    remaining,
    /** In-flight flag while the send callback hasn't resolved yet. */
    sending,
    /** True whenever the button should be disabled. */
    disabled: sending || remaining > 0,
    /** Call this from an onClick / form submit. */
    trigger,
  };
}
