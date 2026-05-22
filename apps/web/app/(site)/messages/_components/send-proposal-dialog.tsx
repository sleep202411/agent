"use client";

/**
 * SendProposalDialog — creator-side proposal composer. Opens from
 * the composer footer in `ConversationView` when:
 *
 *   - viewer is `creator`
 *   - conversation.contextType === 'service'
 *
 * (The button hides automatically once the conv has evolved to
 * `order`, because at that point an order already exists and the
 * proposal flow is done.)
 *
 * Fields mirror SendProposalSchema on the server: tier select +
 * currency + price + delivery days + revisions (unlimited toggle) +
 * scope bullets + leading note.
 *
 * On success: WS pushes the new message into the timeline cache;
 * dialog closes; the buyer sees the proposal card with Accept /
 * Decline buttons.
 */
import { useEffect, useMemo, useState } from "react";
import { IconLoader2, IconSparkles } from "@tabler/icons-react";
import { toast } from "sonner";
import { SERVICE_TIERS, UNLIMITED_REVISIONS, type ServiceTier } from "@repo/shared/creator-service";
import { ZERO_DECIMAL_CURRENCIES, type CurrencyCode } from "@repo/shared/crew";
import { useTranslations } from "@/src/i18n/i18n";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { env } from "@/src/env";
import { cn } from "@/lib/utils";
import {
  ConversationApiError,
  useSendProposal,
} from "@/app/(site)/creators/_hooks/use-conversations";

// Mirror of the server cell-aware whitelist. See create-service-dialog
// for the same constant — duplicated intentionally; promotion to a
// shared helper happens when a third caller arrives.
const COM_CURRENCIES: CurrencyCode[] = [
  "USD",
  "EUR",
  "GBP",
  "JPY",
  "HKD",
  "AUD",
  "CAD",
  "SGD",
  "CNY",
];
const CN_CURRENCIES: CurrencyCode[] = ["CNY"];

function defaultCurrencyForCell(): CurrencyCode {
  const banner = env.BANNER_BASE_URL ?? "";
  return /\.cn|\.aliyuncs\.com/.test(banner) ? "CNY" : "USD";
}

function allowedCurrenciesForCell(): CurrencyCode[] {
  return defaultCurrencyForCell() === "CNY" ? CN_CURRENCIES : COM_CURRENCIES;
}

interface SendProposalDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  conversationId: string;
}

export function SendProposalDialog({
  open,
  onOpenChange,
  conversationId,
}: SendProposalDialogProps) {
  const t = useTranslations("messages");
  const tc = useTranslations("common");
  const defaultCurrency = useMemo(() => defaultCurrencyForCell(), []);
  const allowedCurrencies = useMemo(() => allowedCurrenciesForCell(), []);

  const [tier, setTier] = useState<ServiceTier>("standard");
  const [currency, setCurrency] = useState<CurrencyCode>(defaultCurrency);
  const [priceText, setPriceText] = useState("");
  const [deliveryDays, setDeliveryDays] = useState(7);
  const [revisions, setRevisions] = useState<number>(1);
  const [scopeText, setScopeText] = useState("");
  const [note, setNote] = useState("");

  // Reset on open so a previous attempt doesn't leak in.
  // Intentional setState-in-effect — `open` false→true is the
  // trigger; key-prop remount would lose parent's hold.
  useEffect(() => {
    if (!open) return;
    /* eslint-disable react-hooks/set-state-in-effect */
    setTier("standard");
    setCurrency(defaultCurrency);
    setPriceText("");
    setDeliveryDays(7);
    setRevisions(1);
    setScopeText("");
    setNote("");
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [open, defaultCurrency]);

  const send = useSendProposal(conversationId);

  const isZero = ZERO_DECIMAL_CURRENCIES.has(currency);
  const priceStep = isZero ? "1" : "0.01";
  const unlimited = revisions === UNLIMITED_REVISIONS;

  const priceNumber = Number(priceText.trim());
  const priceValid = Number.isFinite(priceNumber) && priceNumber >= 0;

  const submit = async () => {
    if (!priceValid) {
      toast.error(t("proposalPriceInvalid"));
      return;
    }
    try {
      await send.mutateAsync({
        note: note.trim() || undefined,
        packageTier: tier,
        price: priceNumber,
        currency,
        deliveryDays: clamp(deliveryDays, 1, 365),
        revisions: unlimited ? UNLIMITED_REVISIONS : clamp(revisions, 0, 200),
        scope: scopeText
          .split("\n")
          .map((s) => s.trim())
          .filter(Boolean),
      });
      toast.success(t("proposalSentToast"));
      onOpenChange(false);
    } catch (err) {
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
        toast.error(err instanceof Error ? err.message : t("proposalSendFailed"));
      }
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[88vh] max-w-lg flex-col overflow-hidden p-0 sm:max-w-lg">
        <DialogHeader className="border-b-0 px-5 pb-2 pt-5">
          <DialogTitle className="flex items-center gap-2 font-heading text-base font-semibold">
            <IconSparkles className="size-4 text-primary" />
            {t("sendProposalTitle")}
          </DialogTitle>
          <DialogDescription>{t("sendProposalSubtitle")}</DialogDescription>
        </DialogHeader>

        <DialogBody className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-3">
          <Field>
            <FieldLabel required>{t("proposalTierLabel")}</FieldLabel>
            <NativeSelect value={tier} onChange={(v) => setTier(v as ServiceTier)}>
              {SERVICE_TIERS.map((t1) => (
                <NativeSelectOption key={t1} value={t1}>
                  {t(`proposalTier.${t1}`)}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </Field>

          <div className="grid gap-3 sm:grid-cols-3">
            <Field>
              <FieldLabel required>{t("proposalPrice")}</FieldLabel>
              <div className="flex items-stretch gap-2">
                <NativeSelect
                  value={currency}
                  onChange={(v) => setCurrency(v as CurrencyCode)}
                  className="w-20"
                >
                  {allowedCurrencies.map((c) => (
                    <NativeSelectOption key={c} value={c}>
                      {c}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
                <Input
                  type="number"
                  inputMode={isZero ? "numeric" : "decimal"}
                  step={priceStep}
                  min={0}
                  value={priceText}
                  onChange={(e) => setPriceText(e.target.value)}
                  placeholder="0"
                  className="flex-1"
                />
              </div>
            </Field>

            <Field>
              <FieldLabel required>{t("proposalDelivery")}</FieldLabel>
              <Input
                type="number"
                inputMode="numeric"
                min={1}
                max={365}
                value={deliveryDays}
                onChange={(e) => setDeliveryDays(clamp(Number(e.target.value) || 0, 1, 365))}
              />
            </Field>

            <Field>
              <FieldLabel required>{t("proposalRevisions")}</FieldLabel>
              <div className="flex items-center gap-2">
                <Input
                  type="number"
                  inputMode="numeric"
                  min={0}
                  max={200}
                  disabled={unlimited}
                  value={unlimited ? "" : revisions}
                  onChange={(e) => setRevisions(clamp(Number(e.target.value) || 0, 0, 200))}
                  placeholder={unlimited ? "∞" : "0"}
                  className="flex-1"
                />
                <label className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap text-[11px] text-muted-foreground">
                  <Checkbox
                    checked={unlimited}
                    onCheckedChange={(v) => setRevisions(v === true ? UNLIMITED_REVISIONS : 0)}
                    className="size-3.5"
                  />
                  {t("revisionsUnlimited")}
                </label>
              </div>
            </Field>
          </div>

          <Field>
            <FieldLabel>{t("proposalScope")}</FieldLabel>
            <Textarea
              value={scopeText}
              onChange={(e) => setScopeText(e.target.value)}
              placeholder={t("proposalScopePlaceholder")}
              rows={4}
              className={cn("max-h-40 overflow-y-auto")}
            />
            <FieldDescription>{t("proposalScopeHint")}</FieldDescription>
          </Field>

          <Field>
            <FieldLabel>{t("proposalNoteLabel")}</FieldLabel>
            <Textarea
              value={note}
              onChange={(e) => setNote(e.target.value.slice(0, 2000))}
              placeholder={t("proposalNotePlaceholder")}
              rows={3}
              maxLength={2000}
              className="max-h-32 overflow-y-auto"
            />
          </Field>
        </DialogBody>

        <DialogFooter className="shrink-0 border-t border-border bg-background/95 px-5 py-3">
          <Button
            type="button"
            variant="ghost"
            color="muted"
            onClick={() => onOpenChange(false)}
            disabled={send.isPending}
          >
            {tc("cancel")}
          </Button>
          <Button type="button" onClick={submit} disabled={send.isPending || !priceValid}>
            {send.isPending ? <IconLoader2 className="size-4 animate-spin" /> : null}
            {t("proposalSend")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}
