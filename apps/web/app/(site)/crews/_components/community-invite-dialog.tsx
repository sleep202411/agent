"use client";

import { useEffect, useRef, useState } from "react";
import { IconCopy, IconLink, IconLoader2 } from "@tabler/icons-react";
import { toast } from "sonner";

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

interface CommunityInviteDialogProps {
  crewId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function CommunityInviteDialog({ crewId, open, onOpenChange }: CommunityInviteDialogProps) {
  const t = useTranslations("crewCommunityChat");
  const tc = useTranslations("common");
  const { mutateAsync: createLink } = useCreateCrewInviteLink(crewId);
  const requested = useRef(false);
  const requestVersion = useRef(0);
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const generate = async (clearError = false) => {
    const version = ++requestVersion.current;
    if (clearError) setError(null);
    try {
      const link = await createLink({ kind: "community", policyKeys: [] });
      if (version !== requestVersion.current) return;
      setUrl(crewInviteUrl(link.token));
    } catch (cause) {
      if (version !== requestVersion.current) return;
      setError(cause instanceof Error ? cause.message : t("createFailed"));
    }
  };

  useEffect(() => {
    if (!open || requested.current) return;
    requested.current = true;
    void generate();
    // `createLink` is stable for the lifetime of the mutation hook. The ref
    // fences React Strict Mode so one click never mints two bearer links.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const handleOpenChange = (next: boolean) => {
    if (!next) {
      requested.current = false;
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
      toast.success(t("linkCopied"));
    } catch {
      toast.message(t("copyFailed"));
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
