"use client";

import { useEffect, useRef, useState } from "react";
import { IconCopy, IconLink, IconLoader2 } from "@tabler/icons-react";
import { toast } from "sonner";
import Image from "next/image";

import { crewInviteUrl, useCreateCrewInviteLink } from "@/app/(site)/crews/_hooks/use-invite-links";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useTranslations } from "@/src/i18n/i18n";
import { useCurrentUser } from "@/src/hooks/use-user";

interface CommunityInviteDialogProps {
  crewId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function CommunityInviteDialog(props: CommunityInviteDialogProps) {
  const { user } = useCurrentUser();
  if (!props.open || !user) return null;
  return <CommunityInviteSession key={`${props.crewId}:${user.id}`} {...props} />;
}

function CommunityInviteSession({ crewId, open, onOpenChange }: CommunityInviteDialogProps) {
  const t = useTranslations("crewCommunityChat");
  const tc = useTranslations("common");
  const { mutateAsync: createLink } = useCreateCrewInviteLink(crewId);
  const requested = useRef(false);
  const requestVersion = useRef(0);
  const active = useRef(true);
  const pending = useRef(false);
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const generate = async (clearError = false) => {
    if (pending.current || !active.current) return;
    pending.current = true;
    const version = ++requestVersion.current;
    if (clearError) setError(null);
    try {
      const link = await createLink({ kind: "community", policyKeys: [] });
      if (!active.current || version !== requestVersion.current) return;
      setUrl(crewInviteUrl(link.token));
    } catch (cause) {
      if (!active.current || version !== requestVersion.current) return;
      setError(cause instanceof Error ? cause.message : t("createFailed"));
    } finally {
      pending.current = false;
    }
  };

  useEffect(() => {
    active.current = true;
    if (!requested.current) {
      requested.current = true;
      void generate();
    }
    return () => {
      active.current = false;
    };
    // Keep one request through Strict Mode effect replay. A new Crew/account
    // or reopening mounts a fresh keyed session with its own request state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleOpenChange = (next: boolean) => {
    if (!next) {
      active.current = false;
      requestVersion.current += 1;
      setUrl(null);
      setError(null);
    }
    onOpenChange(next);
  };

  const copy = async () => {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      if (active.current) toast.success(t("linkCopied"));
    } catch {
      if (active.current) toast.message(t("copyFailed"));
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <span className="mb-3 grid size-10 place-items-center rounded-lg bg-white/[0.06] text-foreground">
            <IconLink className="size-5" />
          </span>
          <DialogTitle>{t("inviteDialogTitle")}</DialogTitle>
          <p className="text-sm leading-6 text-foreground/75">{t("inviteDialogDescription")}</p>
        </DialogHeader>

        <DialogBody>
          {!url && !error ? (
            <div className="flex min-h-24 items-center justify-center gap-3 text-sm text-foreground/75">
              <IconLoader2 className="size-5 animate-spin" />
              {t("generatingLink")}
            </div>
          ) : null}

          {url ? (
            <div className="space-y-3">
              <p className="text-sm font-medium text-foreground">{t("linkReady")}</p>
              <CommunityInviteQr key={url} url={url} />
              <div className="flex items-center gap-2">
                <Input readOnly value={url} onFocus={(event) => event.currentTarget.select()} />
                <Button
                  type="button"
                  variant="outline"
                  color="muted"
                  onClick={() => void copy()}
                  aria-label={t("copyLink")}
                >
                  <IconCopy className="size-4" />
                </Button>
              </div>
            </div>
          ) : null}

          {error ? (
            <div className="space-y-3">
              <p className="text-sm leading-6 text-destructive">{error}</p>
              <Button
                type="button"
                variant="outline"
                color="muted"
                onClick={() => void generate(true)}
              >
                {tc("retry")}
              </Button>
            </div>
          ) : null}
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}

function CommunityInviteQr({ url }: { url: string }) {
  const t = useTranslations("crewCommunityChat");
  const tc = useTranslations("common");
  const qrFailed = t("qrFailed");
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<
    { dataUrl: string; error?: never } | { error: string; dataUrl?: never } | null
  >(null);

  useEffect(() => {
    let active = true;
    void import("qrcode")
      .then(({ default: qr }) =>
        active ? qr.toDataURL(url, { width: 512, margin: 4, errorCorrectionLevel: "M" }) : undefined
      )
      .then((dataUrl) => {
        if (active && dataUrl) setResult({ dataUrl });
      })
      .catch((cause: unknown) => {
        if (active) setResult({ error: cause instanceof Error ? cause.message : qrFailed });
      });
    return () => {
      active = false;
    };
  }, [url, attempt, qrFailed]);

  if (result?.error) {
    return (
      <div className="space-y-2" role="alert">
        <p className="text-sm text-destructive">{result.error}</p>
        <Button
          type="button"
          variant="outline"
          color="muted"
          onClick={() => {
            setResult(null);
            setAttempt((value) => value + 1);
          }}
        >
          {tc("retry")}
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center gap-2">
      {result?.dataUrl ? (
        <>
          <Image
            src={result.dataUrl}
            alt={t("qrAlt")}
            width={224}
            height={224}
            unoptimized
            className="rounded-lg"
          />
          <p className="text-center text-xs text-muted-foreground">{t("scanToJoin")}</p>
          <a
            href={result.dataUrl}
            download="crew-community-invitation.png"
            className="text-sm underline underline-offset-4"
          >
            {t("downloadQr")}
          </a>
        </>
      ) : (
        <div
          role="status"
          className="flex size-56 items-center justify-center gap-2 text-sm text-muted-foreground"
        >
          <IconLoader2 className="size-4 animate-spin" />
          {t("generatingQr")}
        </div>
      )}
    </div>
  );
}
