"use client";

import { useState } from "react";
import { useAuthDialog } from "@/components/auth/auth-dialog-provider";
import Link from "next/link";
import { useCurrentUser } from "@/src/hooks/use-user";
import { useLocale, useTranslations } from "@/src/i18n/i18n";
import { localizePath } from "@/src/i18n/locale-url";
import type { Locale } from "@/src/i18n/config";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogBody,
} from "@/components/ui/dialog";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { useMyCrews } from "../_hooks/use-crew-list";
import { useCrewMembership } from "../_hooks/use-members";

export function CreateTaskEntryDialog(props: {
  mode?: "task" | "position";
  onSelectCrew?: (crewId: string) => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onNewCrew: () => void;
}) {
  const { user } = useCurrentUser();
  return props.open ? (
    <EntrySession key={user?.id ?? "guest"} {...props} signedIn={Boolean(user)} />
  ) : null;
}
function EntrySession({
  open,
  onOpenChange,
  onNewCrew,
  signedIn,
  mode = "task",
  onSelectCrew,
}: {
  mode?: "task" | "position";
  onSelectCrew?: (crewId: string) => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onNewCrew: () => void;
  signedIn: boolean;
}) {
  const t = useTranslations("taskEntry");
  const auth = useAuthDialog();
  const locale = useLocale() as Locale;
  const crews = useMyCrews(signedIn);
  const [selected, setSelected] = useState("");
  const membership = useCrewMembership(signedIn && selected ? selected : undefined);
  const items = [
    ...new Map(
      [...(crews.data?.founded ?? []), ...(crews.data?.joined ?? [])].map((crew) => [crew.id, crew])
    ).values(),
  ];
  const validSelection = !crews.isError && items.some((crew) => crew.id === selected);
  const allowed =
    validSelection &&
    !membership.isFetching &&
    !membership.isError &&
    membership.data?.permissions.includes(mode === "position" ? "openings.manage" : "tasks.manage");
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>{t(mode === "position" ? "positionTitle" : "title")}</DialogTitle>
        </DialogHeader>
        <DialogBody>
          <p className="text-sm text-muted-foreground">
            {t(mode === "position" ? "positionDescription" : "description")}
          </p>
          {signedIn && (
            <>
              {crews.isPending && <p role="status">{t("loading")}</p>}
              {crews.isError ? (
                <div role="alert" className="space-y-2">
                  <p>{crews.error.message}</p>
                  <Button variant="outline" onClick={() => void crews.refetch()}>
                    {t("retry")}
                  </Button>
                </div>
              ) : items.length > 0 ? (
                <label className="block space-y-2">
                  <span>{t("crew")}</span>
                  <NativeSelect
                    aria-label={t("crew")}
                    value={selected}
                    onChange={setSelected}
                    className="w-full"
                  >
                    <NativeSelectOption value="">{t("choose")}</NativeSelectOption>
                    {items.map((crew) => (
                      <NativeSelectOption key={crew.id} value={crew.id}>
                        {crew.name}
                      </NativeSelectOption>
                    ))}
                  </NativeSelect>
                </label>
              ) : (
                !crews.isPending && <p>{t("empty")}</p>
              )}
              {validSelection &&
                (membership.isError ? (
                  <div role="alert" className="space-y-2">
                    <p>{membership.error.message}</p>
                    <Button variant="outline" onClick={() => void membership.refetch()}>
                      {t("retry")}
                    </Button>
                  </div>
                ) : membership.isPending || membership.isFetching ? (
                  <p role="status">{t("loading")}</p>
                ) : (
                  !allowed && (
                    <p role="status">
                      {t(mode === "position" ? "cannotManagePositions" : "cannotManage")}
                    </p>
                  )
                ))}
              {allowed && mode === "position" ? (
                <Button className="w-full" onClick={() => onSelectCrew?.(selected)}>
                  {t("continuePosition")}
                </Button>
              ) : (
                allowed && (
                  <Button asChild className="w-full">
                    <Link
                      href={localizePath(
                        `/crews/${encodeURIComponent(selected)}/workspace?tab=tasks&createTask=1`,
                        locale
                      )}
                      onClick={() => onOpenChange(false)}
                    >
                      {t("continue")}
                    </Link>
                  </Button>
                )
              )}
            </>
          )}
          {signedIn ? (
            <Button className="w-full" variant="outline" onClick={onNewCrew}>
              {t("newCrew")}
            </Button>
          ) : (
            <Button
              className="w-full"
              onClick={() => {
                onOpenChange(false);
                auth.open({ onSuccess: () => onOpenChange(true) });
              }}
            >
              {t("signIn")}
            </Button>
          )}
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}
