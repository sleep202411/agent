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
 * Send-code button with built-in 60s cooldown. Uses stock shadcn
 * Button styling so it matches the form's visual rhythm.
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
      className="shrink-0"
    >
      {sending ? <IconLoader2 className="size-3 animate-spin" /> : null}
      {remaining > 0 ? t("sendCodeCountdown", { seconds: remaining }) : t("sendCode")}
    </Button>
  );
}
