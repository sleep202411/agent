"use client";

/**
 * ContactCreatorDialog — the first-message entry from a service
 * detail page.
 *
 * UX rationale (see project_conversations_design):
 *   - Pattern is "modal first-contact"; the service page stays
 *     under the modal so the buyer doesn't get yanked out of
 *     browsing context. Lower decision cost on cold inquiries.
 *   - Subsequent conversation lives in /messages — the modal only
 *     handles the first send.
 *   - If a conversation already exists for (me, creator, service)
 *     the server returns it via the same `open` endpoint; the
 *     dialog shows a "继续会话" affordance and a route link.
 *
 * Header pins a mini service card so the buyer always sees which
 * service their message is about (a structural property of our
 * context-scoped conversation model).
 */
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { IconLoader2, IconMessage } from "@tabler/icons-react";
import { toast } from "sonner";
import type { CreatorServiceCardDTO, CreatorServiceDTO } from "@repo/shared/creator-service";
import { ZERO_DECIMAL_CURRENCIES, type CurrencyCode } from "@repo/shared/crew";
import { useTranslations, useLocale } from "@/src/i18n/i18n";
import { localizePath } from "@/src/i18n/locale-url";
import type { Locale } from "@/src/i18n/config";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Field, FieldLabel } from "@/components/ui/field";
import { Textarea } from "@/components/ui/textarea";
import { env } from "@/src/env";
import { cn } from "@/lib/utils";
import {
  ConversationApiError,
  useOpenConversation,
} from "@/app/(site)/creators/_hooks/use-conversations";

/**
 * Accepts either the full DTO (when the parent already has it) or
 * the card projection (when opened from a service plaza card). The
 * dialog only needs id / title / cover / starting price.
 */
type ServiceLike =
  | Pick<CreatorServiceDTO, "id" | "title" | "coverPath" | "category">
  | Pick<
      CreatorServiceCardDTO,
      "id" | "title" | "coverPath" | "category" | "startingPrice" | "currency"
    >;

import { useCurrentUser } from "@/src/hooks/use-user";

interface ContactCreatorDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Keep the draft mounted while the service access/terms are refreshed. */
  revalidating?: boolean;
  service: ServiceLike | null;
  /**
   * Pre-filled message body (e.g. when entered as a quoted excerpt
   * from another surface). Optional; usually empty.
   */
  initialBody?: string;
}

const MAX_BODY = 4000;
const MIN_BODY = 1;

export function ContactCreatorDialog(props: ContactCreatorDialogProps) {
  const { user } = useCurrentUser();
  return (
    <ContactCreatorDialogContent
      key={JSON.stringify([props.service?.id, user?.id, props.open, props.initialBody])}
      {...props}
    />
  );
}

function ContactCreatorDialogContent({
  open,
  onOpenChange,
  service,
  revalidating = false,
  initialBody = "",
}: ContactCreatorDialogProps) {
  const active = useRef(false);
  const admitted = useRef(false);
  const messageIntent = useRef<{ body: string; key: string } | null>(null);
  useLayoutEffect(() => {
    active.current = open;
    return () => {
      active.current = false;
    };
  }, [open]);
  const t = useTranslations("creatorService");
  const tm = useTranslations("messages");
  const tc = useTranslations("common");
  const router = useRouter();
  const locale = useLocale() as Locale;

  const [body, setBody] = useState(initialBody);
  const [stayOpen, setStayOpen] = useState(false);
  const openConversation = useOpenConversation();

  // Reset on open so a previous attempt doesn't leak.
  // Intentional setState-in-effect: trigger is a prop transition
  // (false→true). See contact-creator-dialog header.
  useEffect(() => {
    if (open) {
      /* eslint-disable react-hooks/set-state-in-effect */
      setBody(initialBody);
      setStayOpen(false);
      /* eslint-enable react-hooks/set-state-in-effect */
    }
  }, [open, initialBody]);

  const trimmed = body.trim();
  const canSend =
    !revalidating && !!service && trimmed.length >= MIN_BODY && !openConversation.isPending;

  const handleSend = async () => {
    if (!service || !canSend || !active.current || admitted.current) return;
    admitted.current = true;
    try {
      if (messageIntent.current?.body !== trimmed) {
        messageIntent.current = {
          body: trimmed,
          key:
            typeof crypto !== "undefined" && "randomUUID" in crypto
              ? crypto.randomUUID()
              : `inq-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`,
        };
      }
      const { conversation } = await openConversation.mutateAsync({
        contextType: "service",
        contextId: service.id,
        firstMessage: trimmed,
        firstMessageClientKey: messageIntent.current.key,
      });
      if (!active.current) return;
      messageIntent.current = null;
      toast.success(tm("sentToast"), {
        action: {
          label: tm("openConversation"),
          onClick: () => router.push(localizePath(`/messages/${conversation.id}`, locale)),
        },
      });
      if (!stayOpen) {
        onOpenChange(false);
      } else {
        setBody("");
      }
    } catch (err) {
      if (!active.current) return;
      if (err instanceof ConversationApiError) {
        const detail =
          typeof err.body === "object" && err.body && "message" in err.body
            ? String((err.body as { message: unknown }).message)
            : null;
        toast.error(`HTTP ${err.status}`, {
          description: detail ?? err.message,
          duration: 8000,
        });
      } else {
        toast.error(err instanceof Error ? err.message : tm("sendFailed"));
      }
    } finally {
      admitted.current = false;
    }
  };

  const coverUrl = service?.coverPath
    ? service.coverPath.startsWith("http")
      ? service.coverPath
      : `${env.BANNER_BASE_URL}/${service.coverPath}`
    : "";

  const hasPrice = !!service && "startingPrice" in service && "currency" in service;
  const priceLabel = hasPrice
    ? formatStarting(
        (service as { startingPrice: number }).startingPrice,
        (service as { currency: CurrencyCode }).currency
      )
    : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[88vh] max-w-md flex-col overflow-hidden p-0 sm:max-w-md">
        <DialogHeader className="border-b-0 px-5 pb-2 pt-5">
          <DialogTitle className="font-heading text-base font-semibold">
            {tm("contactCreatorTitle")}
          </DialogTitle>
          <DialogDescription>{tm("contactCreatorSubtitle")}</DialogDescription>
        </DialogHeader>

        <DialogBody className="space-y-4 px-5 pb-3 pt-1">
          {/* Service context card — anchors which service this
              first message is about. */}
          {service ? (
            <div className="flex items-center gap-3 rounded-lg bg-card/80 px-3 py-2.5">
              <div className={cn("size-12 shrink-0 overflow-hidden rounded-md bg-secondary")}>
                {coverUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={coverUrl} alt="" className="size-full object-cover" />
                ) : (
                  <div className="flex size-full items-center justify-center text-[10px] text-muted-foreground">
                    {t(`category.${service.category}`)}
                  </div>
                )}
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
                  {tm("aboutService")}
                </p>
                <p className="line-clamp-1 text-sm font-medium text-foreground">{service.title}</p>
                {priceLabel ? (
                  <p className="text-xs text-muted-foreground">
                    {tm("startingAt", { price: priceLabel })}
                  </p>
                ) : null}
              </div>
            </div>
          ) : null}

          <Field>
            <FieldLabel required>{tm("firstMessageLabel")}</FieldLabel>
            <Textarea
              autoFocus
              value={body}
              onChange={(e) => setBody(e.target.value.slice(0, MAX_BODY))}
              placeholder={tm("firstMessagePlaceholder")}
              rows={6}
              maxLength={MAX_BODY}
              className="max-h-48 resize-none overflow-y-auto"
            />
            <p className="text-[11px] text-muted-foreground">
              {body.length} / {MAX_BODY}
            </p>
          </Field>

          <label className="inline-flex cursor-pointer items-center gap-2 text-[11px] text-muted-foreground">
            <Checkbox checked={stayOpen} onCheckedChange={(v) => setStayOpen(v === true)} />
            {tm("stayOpenAfterSend")}
          </label>
        </DialogBody>

        <DialogFooter className="shrink-0 border-t border-border bg-background/95 px-5 py-3">
          <Button
            type="button"
            variant="ghost"
            color="muted"
            onClick={() => onOpenChange(false)}
            disabled={openConversation.isPending}
          >
            {tc("cancel")}
          </Button>
          <Button type="button" onClick={handleSend} disabled={!canSend}>
            {openConversation.isPending || revalidating ? (
              <IconLoader2 className="size-4 animate-spin" />
            ) : (
              <IconMessage className="size-4" />
            )}
            {tm("send")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function formatStarting(amount: number, currency: string): string {
  const isZero = ZERO_DECIMAL_CURRENCIES.has(
    currency as Parameters<typeof ZERO_DECIMAL_CURRENCIES.has>[0]
  );
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency,
    minimumFractionDigits: 0,
    maximumFractionDigits: isZero ? 0 : 2,
  }).format(amount);
}
