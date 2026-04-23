"use client";

import { Button } from "@/components/ui/button";
import { IconLoader2 } from "@tabler/icons-react";
import { useTranslations } from "@/src/i18n/i18n";
import { useSendCode } from "@/src/lib/auth/use-send-code";

interface Props {
  onSend: () => Promise<void>;
  /** Disable when the host form knows the identifier (email/phone) is blank or invalid. */
  disabled?: boolean;
}

/**
 * Send-code button with built-in 60s cooldown. Visually matches the
 * adjacent Input height so it reads as part of the same row.
 */
export function SendCodeButton({ onSend, disabled }: Props) {
  const t = useTranslations("auth");
  const { remaining, sending, trigger } = useSendCode({ send: onSend });
  const isBusy = sending || remaining > 0;
  return (
    <Button
      type="button"
      variant="outline"
      color="muted"
      disabled={disabled || isBusy}
      onClick={() => void trigger()}
      className="h-9 shrink-0"
    >
      {sending ? <IconLoader2 className="size-4 animate-spin" /> : null}
      {remaining > 0 ? t("sendCodeCountdown", { seconds: remaining }) : t("sendCode")}
    </Button>
  );
}
