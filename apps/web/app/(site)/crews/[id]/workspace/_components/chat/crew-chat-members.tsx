"use client";

import { useState } from "react";
import { IconPlus, IconUsers, IconX } from "@tabler/icons-react";
import { UserAvatar } from "@/components/user-avatar";
import { useTranslations } from "@/src/i18n/i18n";
import type { CrewMemberDTO } from "@/app/(site)/crews/_hooks/types";
import { displayNameOf, useUserDisplays } from "@/app/(site)/crews/_hooks/use-users";

export function CrewChatMembers({
  members,
  crewName,
  onInvite,
  onManage,
}: {
  members: CrewMemberDTO[];
  crewName: string;
  onInvite?: () => void;
  onManage: () => void;
}) {
  const t = useTranslations("crewChatMembers");
  const [open, setOpen] = useState(true);
  const [query, setQuery] = useState("");
  const displays = useUserDisplays(members.map((member) => member.userId));
  if (!open)
    return (
      <button
        type="button"
        className="self-start rounded-lg p-3 hover:bg-white/5"
        aria-label={t("title")}
        onClick={() => setOpen(true)}
      >
        <IconUsers className="size-5" />
      </button>
    );
  return (
    <aside
      aria-label={t("title")}
      className="w-64 max-w-[45vw] shrink-0 overflow-y-auto border-l border-white/10 bg-[#0c0d0f] p-4"
    >
      <header className="mb-4 flex items-center justify-between gap-2">
        <h3 className="text-sm font-medium">
          {t("title")} · {members.length}
        </h3>
        <button type="button" aria-label={t("close")} onClick={() => setOpen(false)}>
          <IconX className="size-4" />
        </button>
      </header>
      <input
        type="search"
        aria-label={t("search")}
        placeholder={t("search")}
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        className="mb-4 w-full rounded-lg border border-white/15 bg-transparent px-3 py-2 text-xs"
      />
      <div className="grid grid-cols-3 gap-x-2 gap-y-4">
        {members
          .filter((member) =>
            displayNameOf(member.userId, displays)
              .toLocaleLowerCase()
              .includes(query.trim().toLocaleLowerCase())
          )
          .map((member) => (
            <div
              key={member.userId}
              className="min-w-0 text-center"
              title={displayNameOf(member.userId, displays)}
            >
              <UserAvatar
                src={displays.get(member.userId)?.avatar}
                name={displayNameOf(member.userId, displays)}
                seed={member.userId}
                size={40}
                className="mx-auto rounded-lg"
              />
              <p className="mt-1 truncate text-xs text-muted-foreground">
                {displayNameOf(member.userId, displays)}
              </p>
            </div>
          ))}
        {onInvite ? (
          <button
            type="button"
            onClick={onInvite}
            className="text-center text-xs text-muted-foreground"
          >
            <span className="mx-auto mb-1 flex size-10 items-center justify-center rounded-lg border border-dashed border-white/25">
              <IconPlus className="size-5" />
            </span>
            {t("add")}
          </button>
        ) : null}
      </div>
      <div className="mt-5 border-t border-white/10 pt-4">
        <p className="text-xs text-muted-foreground">{t("name")}</p>
        <p className="mt-2 break-words text-sm">{crewName}</p>
        <button type="button" className="mt-4 text-xs underline" onClick={onManage}>
          {t("manage")}
        </button>
      </div>
    </aside>
  );
}
