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
 * Avatar is optional: the slot defaults to the DiceBear fallback
 * (seeded by user id, so even brand-new accounts get a unique face).
 * Hovering reveals a camera overlay; clicking opens a file picker and
 * uploads via `useUploadAvatar`. The newly-uploaded path lives in local
 * state until Save, so the user can preview before committing — Save
 * bundles `avatar` into the same `updateUserInfo` call as `nickName`.
 */

import { useEffect, useRef, useState } from "react";
import { IconCamera, IconLoader2 } from "@tabler/icons-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogContent, DialogFooter } from "@/components/ui/dialog";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { UserAvatar } from "@/components/user-avatar";
import { useTranslations } from "@/src/i18n/i18n";
import { useUserInfo, useUpdateUserInfo, useUploadAvatar } from "@/src/hooks/use-user";
import { ApiRequestError } from "@/src/lib/api";

export function NicknameRequiredDialog() {
  const t = useTranslations("auth");
  const tc = useTranslations("common");
  const { data: userInfo, isFetched } = useUserInfo();
  const update = useUpdateUserInfo();
  const uploadAvatar = useUploadAvatar();

  const [nickname, setNickname] = useState("");
  const [description, setDescription] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Trigger condition. Wait for `isFetched` so we don't flash the dialog
  // before the user-info query resolves on first paint. Treat both empty
  // string and whitespace-only as "missing".
  const hasUser = !!userInfo && userInfo.id !== undefined && userInfo.id !== null;
  const needsNickname = hasUser && !(userInfo?.nickName ?? "").trim();
  const open = isFetched && needsNickname;

  // Reset draft state each time the dialog opens so values from a prior
  // session don't linger.
  useEffect(() => {
    if (open) {
      setNickname("");
      setDescription("");
    }
  }, [open]);

  const submitting = update.isPending;
  const uploading = uploadAvatar.isPending;
  // Save is gated only on nickname — avatar + description are optional.
  // Disable while an avatar upload is in flight so the freshly-uploaded
  // image has time to propagate via `useUploadAvatar`'s user-info
  // invalidation before Save fires.
  const canSubmit = nickname.trim().length > 0 && !submitting && !uploading;

  // Avatar upload commits directly to backend via /user/uploadAratar —
  // `useUploadAvatar` invalidates the user-info query on success, so
  // `userInfo.headImgUrl` updates and the preview re-renders without
  // any local "pending" state. We don't need to forward `avatar` in
  // the Save payload below.
  const handlePickAvatar = () => {
    if (uploading) return;
    fileInputRef.current?.click();
  };

  const handleAvatarFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast.error(t("avatarImageOnly"));
      return;
    }
    try {
      await uploadAvatar.mutateAsync(file);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "";
      toast.error(msg || t("avatarUploadFailed"));
    }
  };

  const handleSubmit = () => {
    if (!canSubmit) return;
    update.mutate(
      {
        nickName: nickname.trim(),
        // Description is optional — only forward when non-empty so we
        // don't overwrite any existing value with whitespace.
        ...(description.trim() ? { description: description.trim() } : {}),
      },
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
          {/* Avatar slot — hover reveals the camera overlay. Default
              state is the DiceBear face seeded by user id, so users
              who never upload still get a consistent identity. */}
          <div className="mb-4 flex justify-center">
            <button
              type="button"
              onClick={handlePickAvatar}
              disabled={uploading}
              className="group relative size-20 shrink-0 overflow-hidden rounded-full outline-none ring-1 ring-border transition-all hover:ring-primary/40 focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-wait"
              aria-label={t("avatarUpload")}
            >
              <UserAvatar
                src={userInfo?.headImgUrl}
                seed={userInfo?.id}
                name={userInfo?.nickName ?? userInfo?.userName}
                className="size-20"
              />
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/55 opacity-0 transition-opacity group-hover:opacity-100">
                {uploading ? (
                  <IconLoader2 className="size-6 animate-spin text-white" />
                ) : (
                  <IconCamera className="size-6 text-white" />
                )}
              </div>
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={handleAvatarFile}
            />
          </div>

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

            <Field>
              <FieldLabel>{t("descriptionLabel")}</FieldLabel>
              <Textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder={t("descriptionPlaceholder")}
                maxLength={200}
                rows={3}
                className="max-h-40 resize-none"
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
