"use client";

import { useState } from "react";
import { IconMail, IconCopy, IconCheck } from "@tabler/icons-react";
import { toast } from "sonner";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useTranslations } from "@/src/i18n/i18n";
import type { Creator } from "@/app/(site)/creators/_hooks/use-creator";

function formatJoined(value: string | null | undefined): string {
  if (!value || typeof value !== "string") return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString(undefined, { year: "numeric", month: "long" });
}

interface CreatorHeaderProps {
  creator: Creator;
}

/**
 * Read-only mirror of the profile page's header. Same banner / avatar /
 * name / chips layout as `app/(site)/profile/profile-header.tsx`, with
 * upload / edit / referral / kyc / availability controls stripped — a
 * creator detail page only displays public list-payload data. Kept as a
 * separate file (not shared with profile) so it can diverge later when
 * detail-only fields land.
 */
export function CreatorHeader({ creator }: CreatorHeaderProps) {
  const t = useTranslations("creator");
  const [contactOpen, setContactOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  const name = (creator.name || "").trim() || "Unknown";
  const initials = name.slice(0, 1).toUpperCase();
  const bio = (creator.bio || "").trim();
  const joined = formatJoined(creator.joinedAt);
  const levels = Array.isArray(creator.levels) ? creator.levels.filter((l) => !!l?.name) : [];
  const contact = (creator.contact || "").trim();

  const banner = (creator?.banner || "").trim();

  return (
    <div className="relative flex h-75 w-full items-end overflow-hidden">
      {banner ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={banner} alt="" className="absolute inset-0 h-full w-full object-cover" />
      ) : (
        <>
          <div className="absolute inset-0 bg-linear-to-br from-[#1a1a2e] via-[#16213e] to-[#0f3460]" />
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_left,rgba(229,34,39,0.2),transparent_50%)]" />
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_bottom_right,rgba(80,120,255,0.15),transparent_50%)]" />
        </>
      )}
      <div className="absolute inset-x-0 bottom-0 h-32 bg-linear-to-t from-black/40 to-transparent" />

      <div className="relative mx-auto flex w-full max-w-6xl items-end justify-between px-8 pb-6">
        <div className="flex max-w-3xl flex-col gap-3">
          <div className="flex items-center space-x-4">
            <div className="shrink-0">
              <Avatar className="size-24 border-3 border-white/20 text-3xl shadow-2xl">
                {creator.avatar ? <AvatarImage src={creator.avatar} alt={name} /> : null}
                <AvatarFallback className="bg-muted text-muted-foreground">
                  {initials}
                </AvatarFallback>
              </Avatar>
            </div>

            <div>
              <h1 className="text-2xl font-bold text-white">{name}</h1>
              <div className="mt-1 flex flex-wrap items-center gap-1.5">
                {levels.map((l) => (
                  <span
                    key={l.id}
                    title={l.description || l.name}
                    className="inline-flex items-center gap-1 rounded-full border border-amber-400/30 bg-amber-400/10 py-px pl-1 pr-2 text-[10px] font-medium text-amber-300"
                  >
                    {l.iconUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={l.iconUrl}
                        alt=""
                        className="size-3.5 shrink-0 rounded-full object-cover"
                      />
                    ) : null}
                    {l.name}
                  </span>
                ))}
                {joined && (
                  <span className="rounded-full border border-white/20 bg-white/5 px-2 py-px text-[10px] font-medium text-white/60">
                    {t("joinedAt", { date: joined })}
                  </span>
                )}
              </div>
              {bio && <p className="mt-3 text-[13px] leading-relaxed text-white/60">{bio}</p>}
            </div>
          </div>
        </div>

        <div className="hidden shrink-0 items-center gap-2 md:flex">
          {contact && (
            <Button
              variant="solid"
              size="sm"
              onClick={() => {
                setCopied(false);
                setContactOpen(true);
              }}
            >
              <IconMail className="size-4" />
              {t("contactButton")}
            </Button>
          )}
        </div>
      </div>

      <Dialog open={contactOpen} onOpenChange={setContactOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("contactTitle")}</DialogTitle>
            <DialogDescription>{t("contactDesc", { name })}</DialogDescription>
          </DialogHeader>
          <div className="flex items-center gap-2 p-4">
            <input
              readOnly
              value={contact}
              className="h-10 flex-1 rounded-lg border border-border bg-muted px-3 text-sm text-foreground"
              onFocus={(e) => e.target.select()}
            />
            <Button
              size="sm"
              variant={copied ? "outline" : "solid"}
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(contact);
                  setCopied(true);
                  toast.success(t("contactCopied"));
                } catch {
                  /* clipboard blocked — user can still select & copy manually */
                }
              }}
            >
              {copied ? <IconCheck className="size-4" /> : <IconCopy className="size-4" />}
              {copied ? t("contactCopied") : t("contactCopy")}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
