"use client";

/**
 * StartRequestDialog — buyer-side questionnaire-first order entry.
 * Opens from ServiceDetailDialog's "立即下单" button.
 *
 * Flow:
 *   1. Buyer picks a tier (with prices shown side-by-side).
 *   2. Buyer answers the service's requirement questions.
 *   3. Optional free-form note (becomes the first message in the
 *      spawned conversation).
 *   4. (Optional) FD bindings — IP / episode / crew. Shown as
 *      plain text inputs for Phase 1b; pickers ship later.
 *   5. Submit → POST /aurora/orders → route to /orders/[id].
 *
 * The resulting order is `pending_creator`; the creator must
 * accept or decline. The conversation is spawned in the same
 * transaction so the creator's inbox lights up immediately.
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { IconLoader2, IconUserPlus } from "@tabler/icons-react";
import { toast } from "sonner";
import {
  SERVICE_TIERS,
  UNLIMITED_REVISIONS,
  type CreatorServiceDTO,
  type ServicePackageDTO,
  type ServiceTier,
} from "@repo/shared/creator-service";
import { ZERO_DECIMAL_CURRENCIES } from "@repo/shared/crew";
import { useTranslations, useLocale } from "@/src/i18n/i18n";
import { localizePath } from "@/src/i18n/locale-url";
import type { Locale } from "@/src/i18n/config";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { OrderApiError, useSubmitOrder } from "@/app/(site)/creators/_hooks/use-orders";

import { useCurrentUser } from "@/src/hooks/use-user";

interface StartRequestDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Keep the draft mounted while the service access/terms are refreshed. */
  revalidating?: boolean;
  service: CreatorServiceDTO | null;
  /** Pre-select a specific tier (e.g. clicked from a tier card). */
  initialTier?: ServiceTier;
}

export function StartRequestDialog(props: StartRequestDialogProps) {
  const { user } = useCurrentUser();
  return (
    <StartRequestDialogContent
      key={JSON.stringify([
        props.service?.id,
        user?.id,
        props.open,
        props.initialTier,
        props.service?.packages[0]?.tier,
      ])}
      {...props}
    />
  );
}

function StartRequestDialogContent({
  open,
  onOpenChange,
  service,
  revalidating = false,
  initialTier,
}: StartRequestDialogProps) {
  const active = useRef(false);
  const admitted = useRef(false);
  useLayoutEffect(() => {
    active.current = open;
    return () => {
      active.current = false;
    };
  }, [open]);
  const t = useTranslations("creatorService");
  const tc = useTranslations("common");
  const router = useRouter();
  const locale = useLocale() as Locale;

  const offered = useMemo(
    () => new Set<ServiceTier>((service?.packages ?? []).map((p) => p.tier as ServiceTier)),
    [service]
  );
  const defaultTier: ServiceTier =
    initialTier && offered.has(initialTier) ? initialTier : (service?.packages[0]?.tier ?? "basic");

  const [tier, setTier] = useState<ServiceTier>(defaultTier);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [note, setNote] = useState("");
  // FD bindings UI removed for Phase 1b — raw id inputs would
  // create dirty references (server-side ownership check is also a
  // no-op). Schema columns + API surface stay; bindings ship in
  // Phase 1c with a real picker + permission validation.

  // Idempotency key — mint ONCE per dialog open. A retry / double-
  // click / weak-network duplicate all carry the same key, and the
  // server returns the original order rather than creating a
  // second one. Resets when the dialog re-opens so a deliberate
  // second submit (e.g. user closed + reopened) gets a fresh key.
  const [idempotencyKey, setIdempotencyKey] = useState<string>("");

  // Reset on open. Intentional setState-in-effect — `open`
  // false→true is the trigger. See contact-creator-dialog header.
  useEffect(() => {
    if (!open) return;
    /* eslint-disable react-hooks/set-state-in-effect */
    setTier(defaultTier);
    setAnswers({});
    setNote("");
    setIdempotencyKey(newClientUuid());
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [open, defaultTier]);

  const submit = useSubmitOrder();
  const selectedPkg = service?.packages.find((p) => p.tier === tier);

  // Required-question gate: every required question must have a
  // non-blank answer. Mirrors server validation, surfaces inline.
  const missingRequired = useMemo(() => {
    if (!service) return [];
    return service.requirementQuestions.filter((q) => q.required && !(answers[q.id] ?? "").trim());
  }, [service, answers]);

  const canSubmit =
    !revalidating &&
    !!service &&
    !!selectedPkg &&
    !!idempotencyKey &&
    missingRequired.length === 0 &&
    !submit.isPending;

  const handleSubmit = async () => {
    if (
      !active.current ||
      admitted.current ||
      submit.isPending ||
      revalidating ||
      !idempotencyKey ||
      !service ||
      !selectedPkg
    )
      return;
    if (missingRequired.length > 0) {
      toast.error(
        t("startRequestMissingRequired", {
          count: String(missingRequired.length),
        })
      );
      return;
    }
    admitted.current = true;
    try {
      const order = await submit.mutateAsync({
        serviceId: service.id,
        expectedServiceVersion: service.version,
        packageTier: tier,
        answers: service.requirementQuestions.map((q) => ({
          questionId: q.id,
          answer: (answers[q.id] ?? "").trim(),
        })),
        // bindings intentionally omitted in Phase 1b.
        note: note.trim() || undefined,
        idempotencyKey,
      });
      if (!active.current) return;
      toast.success(t("startRequestSubmittedToast"));
      onOpenChange(false);
      router.push(localizePath(`/orders/${order.id}`, locale));
    } catch (err) {
      if (!active.current) return;
      if (err instanceof OrderApiError) {
        const detail =
          typeof err.body === "object" && err.body && "message" in err.body
            ? String((err.body as { message: unknown }).message)
            : null;
        toast.error(`HTTP ${err.status}`, {
          description: detail ?? err.message,
          duration: 8000,
        });
      } else {
        toast.error(err instanceof Error ? err.message : t("startRequestFailed"));
      }
    } finally {
      admitted.current = false;
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[90vh] max-w-2xl flex-col overflow-hidden p-0 sm:max-w-2xl">
        <DialogHeader className="border-b-0 px-5 pb-2 pt-5">
          <DialogTitle className="flex items-center gap-2 font-heading text-base font-semibold">
            <IconUserPlus className="size-4 text-primary" />
            {t("startRequestTitle")}
          </DialogTitle>
          <DialogDescription>{t("startRequestSubtitle")}</DialogDescription>
        </DialogHeader>

        <DialogBody className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-3">
          {!service ? (
            <div className="flex h-32 items-center justify-center">
              <IconLoader2 className="size-5 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <>
              {/* Tier picker */}
              <section className="space-y-2">
                <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  {t("startRequestPickTier")}
                </h3>
                <div className="grid gap-2 md:grid-cols-3">
                  {SERVICE_TIERS.map((tx) => {
                    const pkg = service.packages.find((p) => p.tier === tx);
                    if (!pkg) {
                      return (
                        <div
                          key={tx}
                          className="flex flex-col items-center justify-center gap-0.5 rounded-xl bg-card/30 p-3 text-center text-xs text-muted-foreground/70"
                        >
                          <span className="text-[10px] font-semibold uppercase tracking-wider">
                            {t(`tier.${tx}`)}
                          </span>
                          <span>{t("detailTierNotOffered")}</span>
                        </div>
                      );
                    }
                    const selected = tx === tier;
                    return (
                      <button
                        key={tx}
                        type="button"
                        onClick={() => setTier(tx)}
                        className={cn(
                          "flex flex-col items-start gap-1 rounded-xl bg-card p-3 text-left transition-all",
                          selected
                            ? "ring-2 ring-primary"
                            : "ring-1 ring-transparent hover:ring-border"
                        )}
                      >
                        <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                          {t(`tier.${tx}`)}
                        </span>
                        <span className="line-clamp-1 text-sm font-semibold text-foreground">
                          {pkg.title || t(`tier.${tx}`)}
                        </span>
                        <span className="text-base font-bold tabular-nums text-foreground">
                          {formatPrice(pkg.price, pkg.currency)}
                        </span>
                        <TierMeta pkg={pkg} />
                      </button>
                    );
                  })}
                </div>
              </section>

              {/* Questionnaire */}
              {service.requirementQuestions.length > 0 ? (
                <section className="space-y-3">
                  <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                    {t("startRequestQuestionsHeading")}
                  </h3>
                  {service.requirementQuestions.map((q) => (
                    <Field key={q.id}>
                      <FieldLabel required={q.required}>{q.prompt}</FieldLabel>
                      <Textarea
                        value={answers[q.id] ?? ""}
                        onChange={(e) =>
                          setAnswers((a) => ({
                            ...a,
                            [q.id]: e.target.value.slice(0, 4000),
                          }))
                        }
                        placeholder={q.helpText || t("startRequestAnswerPlaceholder")}
                        rows={2}
                        maxLength={4000}
                        className="max-h-32 overflow-y-auto"
                      />
                      {q.helpText ? <FieldDescription>{q.helpText}</FieldDescription> : null}
                    </Field>
                  ))}
                </section>
              ) : (
                <section className="space-y-2">
                  <p className="text-xs text-muted-foreground">{t("startRequestNoQuestions")}</p>
                </section>
              )}

              {/* Buyer note */}
              <Field>
                <FieldLabel>{t("startRequestNoteLabel")}</FieldLabel>
                <Textarea
                  value={note}
                  onChange={(e) => setNote(e.target.value.slice(0, 2000))}
                  placeholder={t("startRequestNotePlaceholder")}
                  rows={3}
                  maxLength={2000}
                  className="max-h-32 overflow-y-auto"
                />
              </Field>

              {/* FD bindings UI removed for Phase 1b — see component
                  header. Schema columns + API path are preserved so
                  Phase 1c can add the picker without a migration. */}
            </>
          )}
        </DialogBody>

        <DialogFooter className="shrink-0 border-t border-border bg-background/95 px-5 py-3">
          <Button
            type="button"
            variant="ghost"
            color="muted"
            onClick={() => onOpenChange(false)}
            disabled={submit.isPending}
          >
            {tc("cancel")}
          </Button>
          <Button type="button" onClick={handleSubmit} disabled={!canSubmit}>
            {submit.isPending || revalidating ? (
              <IconLoader2 className="size-4 animate-spin" />
            ) : null}
            {t("startRequestSubmit")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Mint a UUID-ish client token for idempotency keys. Uses
 * `crypto.randomUUID` when available (every modern browser + Node
 * 16+), falls back to a Math.random-backed token. The fallback is
 * fine because the server side treats this purely as an opaque
 * dedup key — collision probability over an order-submit session
 * is astronomically low even with the fallback.
 */
function newClientUuid(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `c-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function TierMeta({ pkg }: { pkg: ServicePackageDTO }) {
  const t = useTranslations("creatorService");
  return (
    <span className="text-[10px] text-muted-foreground">
      {t("detailDeliveryDays", { days: String(pkg.deliveryDays) })} ·{" "}
      {pkg.revisions === UNLIMITED_REVISIONS
        ? t("detailRevisionsUnlimited")
        : t("detailRevisionsCount", { count: String(pkg.revisions) })}
    </span>
  );
}

function formatPrice(amount: number, currency: string): string {
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
