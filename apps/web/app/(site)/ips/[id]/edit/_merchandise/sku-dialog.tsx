"use client";

import { useEffect, useMemo, useState } from "react";
import { IconLoader2 } from "@tabler/icons-react";
import { toast } from "sonner";
import { useTranslations } from "@/src/i18n/i18n";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DEFAULT_COGS_BY_KIND,
  useCreateMerchandise,
  useUpdateMerchandise,
  type MerchandiseCurrency,
  type MerchandiseKind,
  type MerchandiseSku,
} from "@/app/(site)/ips/_hooks/use-merchandise";

interface SkuDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  ipId: string;
  /** When set, dialog runs in edit mode. */
  initial?: MerchandiseSku | null;
}

const KIND_OPTIONS: MerchandiseKind[] = [
  "digital",
  "physical",
  "custom_content",
  "creative_license",
  "media_license",
];

const CURRENCY_OPTIONS: MerchandiseCurrency[] = ["community_score", "CNY", "USD"];

export function SkuDialog({ open, onOpenChange, ipId, initial }: SkuDialogProps) {
  const t = useTranslations("ipEdit");
  const tc = useTranslations("common");

  const isEdit = !!initial;

  const [name, setName] = useState("");
  const [kind, setKind] = useState<MerchandiseKind>("digital");
  const [description, setDescription] = useState("");
  const [cover, setCover] = useState("");
  const [priceGross, setPriceGross] = useState<string>("0");
  const [currency, setCurrency] = useState<MerchandiseCurrency>("community_score");
  // `cogsRatio` is stored as a 0..100 integer string for editability,
  // converted back to a 0..1 float on submit.
  const [cogsPct, setCogsPct] = useState<string>("0");

  const create = useCreateMerchandise(ipId);
  const update = useUpdateMerchandise(ipId);
  const submitting = create.isPending || update.isPending;

  // Prefill on open / reset on close.
  useEffect(() => {
    if (!open) {
      setName("");
      setKind("digital");
      setDescription("");
      setCover("");
      setPriceGross("0");
      setCurrency("community_score");
      setCogsPct("0");
      return;
    }
    if (initial) {
      setName(initial.name);
      setKind(initial.kind);
      setDescription(initial.description ?? "");
      setCover(initial.cover ?? "");
      setPriceGross(String(initial.priceGross));
      setCurrency(initial.currency);
      setCogsPct(String(Math.round(initial.cogsRatio * 100)));
    } else {
      // New SKU — prefill cogs from the per-kind default so the form
      // never starts with an out-of-spec value.
      setCogsPct(String(Math.round(DEFAULT_COGS_BY_KIND.digital * 100)));
    }
  }, [open, initial]);

  // When kind changes during create, re-apply the per-kind default cogs.
  // In edit mode the user may have intentionally tuned it — don't reset.
  useEffect(() => {
    if (!open || isEdit) return;
    setCogsPct(String(Math.round(DEFAULT_COGS_BY_KIND[kind] * 100)));
  }, [kind, open, isEdit]);

  const parsedPrice = Number.parseFloat(priceGross);
  const parsedCogsPct = Number.parseFloat(cogsPct);

  const canSubmit = useMemo(() => {
    if (submitting) return false;
    if (!name.trim()) return false;
    if (!Number.isFinite(parsedPrice) || parsedPrice < 0) return false;
    if (!Number.isFinite(parsedCogsPct) || parsedCogsPct < 0 || parsedCogsPct > 100) return false;
    return true;
  }, [submitting, name, parsedPrice, parsedCogsPct]);

  const handleSubmit = () => {
    if (!canSubmit) return;
    const payload = {
      name: name.trim(),
      kind,
      description: description.trim() || undefined,
      cover: cover.trim() || undefined,
      priceGross: parsedPrice,
      currency,
      cogsRatio: parsedCogsPct / 100,
    };

    if (isEdit && initial) {
      update.mutate(
        { id: initial.id, patch: payload },
        {
          onSuccess: () => {
            toast.success(t("merchUpdateSuccess"));
            onOpenChange(false);
          },
          onError: (err) =>
            toast.error(err instanceof Error ? err.message : t("merchUpdateFailed")),
        }
      );
      return;
    }

    create.mutate(payload, {
      onSuccess: () => {
        toast.success(t("merchCreateSuccess"));
        onOpenChange(false);
      },
      onError: (err) => toast.error(err instanceof Error ? err.message : t("merchCreateFailed")),
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {isEdit ? t("merchEditDialogTitle") : t("merchCreateDialogTitle")}
          </DialogTitle>
        </DialogHeader>
        <DialogBody>
          <FieldGroup>
            <Field>
              <FieldLabel required>{t("merchKindLabel")}</FieldLabel>
              <Select value={kind} onValueChange={(v) => setKind(v as MerchandiseKind)}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {KIND_OPTIONS.map((k) => (
                    <SelectItem key={k} value={k}>
                      {t(KIND_I18N_KEY[k])}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>

            <Field>
              <FieldLabel required>{t("merchNameLabel")}</FieldLabel>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t("merchNamePlaceholder")}
                maxLength={120}
              />
            </Field>

            <Field>
              <FieldLabel>{t("merchDescriptionLabel")}</FieldLabel>
              <Textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder={t("merchDescriptionPlaceholder")}
                rows={3}
                maxLength={500}
              />
            </Field>

            <Field>
              <FieldLabel>{t("merchCoverLabel")}</FieldLabel>
              <Input
                value={cover}
                onChange={(e) => setCover(e.target.value)}
                placeholder={t("merchCoverPlaceholder")}
              />
            </Field>

            <div className="grid grid-cols-2 gap-3">
              <Field>
                <FieldLabel required>{t("merchPriceLabel")}</FieldLabel>
                <Input
                  type="number"
                  inputMode="decimal"
                  min={0}
                  step="0.01"
                  value={priceGross}
                  onChange={(e) => setPriceGross(e.target.value)}
                />
              </Field>
              <Field>
                <FieldLabel required>{t("merchCurrencyLabel")}</FieldLabel>
                <Select
                  value={currency}
                  onValueChange={(v) => setCurrency(v as MerchandiseCurrency)}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CURRENCY_OPTIONS.map((c) => (
                      <SelectItem key={c} value={c}>
                        {t(CURRENCY_I18N_KEY[c])}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            </div>

            <Field>
              <FieldLabel>{t("merchCogsLabelField")}</FieldLabel>
              <div className="flex items-center gap-2">
                <Input
                  type="number"
                  inputMode="numeric"
                  min={0}
                  max={100}
                  step={1}
                  value={cogsPct}
                  onChange={(e) => setCogsPct(e.target.value)}
                  className="w-24"
                />
                <span className="text-xs text-muted-foreground">%</span>
                <span className="ml-2 text-xs text-muted-foreground">{t("merchCogsHint")}</span>
              </div>
            </Field>
          </FieldGroup>
        </DialogBody>
        <DialogFooter>
          <Button
            variant="outline"
            color="muted"
            onClick={() => onOpenChange(false)}
            disabled={submitting}
          >
            {tc("cancel")}
          </Button>
          <Button onClick={handleSubmit} disabled={!canSubmit}>
            {submitting ? <IconLoader2 className="size-4 animate-spin" /> : null}
            {isEdit ? t("merchUpdateAction") : t("merchCreateAction")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── i18n key maps ─────────────────────────────────────

const KIND_I18N_KEY: Record<MerchandiseKind, string> = {
  digital: "merchKindDigital",
  physical: "merchKindPhysical",
  custom_content: "merchKindCustomContent",
  creative_license: "merchKindCreativeLicense",
  media_license: "merchKindMediaLicense",
};

const CURRENCY_I18N_KEY: Record<MerchandiseCurrency, string> = {
  community_score: "merchCurrencyScoreLong",
  CNY: "merchCurrencyCNY",
  USD: "merchCurrencyUSD",
};
