"use client";

/**
 * Forces a logged-in user to set a nickname before they can use the app.
 * Mounted once at the client root (`app/root-layout-client.tsx`) so it
 * covers every authenticated page without each route having to remember
 * to mount it. Renders nothing when:
 *
 *   - the session-user query hasn't resolved yet (no flash on first paint),
 *   - the viewer isn't logged in (`useUserInfo` returns no data),
 *   - or `nickName` is already a non-empty string.
 *
 * The dialog is intentionally non-dismissible — DialogContent already
 * `preventDefault()`s outside / escape closes, and we render no close
 * button. The only way out is to submit a valid nickname.
 *
 * Avatar isn't part of this prompt on purpose: missing avatar falls back
 * to the DiceBear SVG in `<UserAvatar>` (deterministic from the user id),
 * which is acceptable as a permanent default. No need to interrupt the
 * user for it.
 */

import { useEffect, useState } from "react";
import { IconLoader2 } from "@tabler/icons-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogContent, DialogFooter } from "@/components/ui/dialog";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { useTranslations } from "@/src/i18n/i18n";
import { useUserInfo, useUpdateUserInfo } from "@/src/hooks/use-user";
import { ApiRequestError } from "@/src/lib/api";

export function NicknameRequiredDialog() {
  const t = useTranslations("auth");
  const tc = useTranslations("common");
  const { data: userInfo, isFetched } = useUserInfo();
  const update = useUpdateUserInfo();

  const [nickname, setNickname] = useState("");

  // Trigger condition. Wait for `isFetched` so we don't flash the dialog
  // before the user-info query resolves on first paint. Treat both empty
  // string and whitespace-only as "missing".
  const hasUser = !!userInfo && userInfo.id !== undefined && userInfo.id !== null;
  const needsNickname = hasUser && !(userInfo?.nickName ?? "").trim();
  const open = isFetched && needsNickname;

  // Reset draft input each time the dialog opens so a previously typed
  // value from a different session doesn't linger.
  useEffect(() => {
    if (open) setNickname("");
  }, [open]);

  const submitting = update.isPending;
  const canSubmit = nickname.trim().length > 0 && !submitting;

  const handleSubmit = () => {
    if (!canSubmit) return;
    update.mutate(
      { nickName: nickname.trim() },
      {
        onSuccess: () => {
          toast.success(t("nicknameSaved"));
        },
        onError: (err) => {
          // Surface raw backend response — same pattern as the profile
          // edit dialog. A 422 / 409 (duplicate nickname?) is exactly
          // what the user needs to see to recover.
          if (err instanceof ApiRequestError) {
            const detail = err.responseBody?.slice(0, 800) || err.message;
            toast.error(`HTTP ${err.status}`, { description: detail, duration: 10000 });
          } else {
            toast.error(err instanceof Error ? err.message : t("nicknameSaveFailed"));
          }
        },
      }
    );
  };

  return (
    <Dialog open={open}>
      <DialogContent showCloseButton={false} className="sm:max-w-md">
        {/* Custom header — skipping `<DialogHeader>` because that always
            renders a close button, which would let users bypass the gate. */}
        <div className="border-b border-border p-4">
          <h2 className="text-base font-semibold text-foreground">{t("nicknameRequiredTitle")}</h2>
          <p className="mt-1 text-xs text-muted-foreground">{t("nicknameRequiredSubtitle")}</p>
        </div>

        <DialogBody>
          <FieldGroup>
            <Field>
              <FieldLabel required>{t("nicknameLabel")}</FieldLabel>
              <Input
                value={nickname}
                onChange={(e) => setNickname(e.target.value)}
                placeholder={t("nicknamePlaceholder")}
                maxLength={40}
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === "Enter" && canSubmit) handleSubmit();
                }}
              />
            </Field>
          </FieldGroup>
        </DialogBody>

        <DialogFooter>
          <Button type="button" onClick={handleSubmit} disabled={!canSubmit}>
            {submitting ? <IconLoader2 className="size-4 animate-spin" /> : null}
            {submitting ? tc("save") + "…" : tc("save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
