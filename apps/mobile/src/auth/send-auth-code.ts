import { t } from "@/i18n";
import type { NormalizedIdentifier } from "./auth-service";
import { capturePendingCodeRecorder, hydratePendingCode, type AuthCodeMode } from "./pending-code";
import {
  armResendDeadline,
  hydrateResendClock,
  RESEND_COOLDOWN_SECONDS,
  secondsUntilResend,
} from "./resend-clock";

let active: { key: string; promise: Promise<void> } | null = null;

/** One global send gate covers login/reset, including calls before UI state renders. */
export function sendAuthCode(
  identifier: NormalizedIdentifier,
  mode: AuthCodeMode,
  dispatch: () => Promise<unknown>
): Promise<void> {
  const key = JSON.stringify([identifier.kind, identifier.account, mode]);
  if (active)
    return active.key === key
      ? active.promise
      : Promise.reject(new Error(t("auth.errorResendCooldown")));
  const record = capturePendingCodeRecorder();
  const promise = (async () => {
    await Promise.all([hydrateResendClock(), hydratePendingCode()]);
    if (secondsUntilResend() > 0) throw new Error(t("auth.errorResendCooldown"));
    await dispatch();
    armResendDeadline(Date.now() + RESEND_COOLDOWN_SECONDS * 1000);
    record({ account: identifier, mode });
  })();
  const operation = { key, promise };
  active = operation;
  void promise
    .finally(() => {
      if (active === operation) active = null;
    })
    .catch(() => {});
  return promise;
}
