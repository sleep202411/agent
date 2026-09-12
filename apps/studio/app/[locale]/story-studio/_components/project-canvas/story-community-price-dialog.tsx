"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { IconCoins, IconLock } from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { storyApiErrorMessage } from "@/lib/story-projects-api";
import { cn } from "@/lib/utils";
import { parseStoryCommunityPointPrice } from "./story-community-price";

export function StoryCommunityPriceButton({
  title,
  price = 0,
  disabled,
  onSave,
}: {
  title: string;
  price?: number;
  disabled?: boolean;
  onSave: (price: number) => Promise<void>;
}) {
  const t = useTranslations("storyStudio.canvas.communityPrice");
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState(String(price));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const changeOpen = (next: boolean) => {
    if (saving) return;
    if (next) {
      setValue(String(price));
      setError(null);
    }
    setOpen(next);
  };
  return (
    <Dialog open={open} onOpenChange={changeOpen}>
      <DialogTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          aria-label={t("configure", { title })}
          title={t("configure", { title })}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => event.stopPropagation()}
          className={cn(
            "nodrag nopan inline-flex h-8 shrink-0 cursor-pointer items-center gap-1.5 rounded-lg bg-white/[0.14] px-2.5 text-xs font-semibold whitespace-nowrap transition-colors hover:bg-white/[0.22] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/35 disabled:cursor-default disabled:opacity-35",
            price > 0 ? "text-brand-yellow" : "text-white/90 hover:text-white"
          )}
        >
          {price > 0 ? (
            <IconLock className="size-4" aria-hidden />
          ) : (
            <IconCoins className="size-4" aria-hidden />
          )}
          {price > 0 ? t("amount", { count: price }) : t("free")}
        </button>
      </DialogTrigger>
      <DialogContent
        className="sm:max-w-sm gap-0 p-6"
        showCloseButton={!saving}
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mb-5 flex size-10 items-center justify-center rounded-xl bg-white/[0.06] text-white/70">
          <IconCoins className="size-5" />
        </div>
        <DialogTitle className="text-lg font-semibold">{t("title")}</DialogTitle>
        <p className="mt-2 truncate text-sm text-white/80" title={title}>
          {title}
        </p>
        <DialogDescription className="mt-2 leading-5">{t("nodeHint")}</DialogDescription>
        <form
          className="mt-6"
          onSubmit={async (event) => {
            event.preventDefault();
            event.stopPropagation();
            if (saving) return;
            const parsed = parseStoryCommunityPointPrice(value);
            if (parsed === null) {
              setError(t("invalid"));
              return;
            }
            setSaving(true);
            setError(null);
            try {
              await onSave(parsed);
              setOpen(false);
            } catch (cause) {
              setError(storyApiErrorMessage(cause, t("saveFailed")));
            } finally {
              setSaving(false);
            }
          }}
        >
          <Field label={t("price")} htmlFor="story-community-price" required dense>
            <div className="flex h-12 items-center gap-3 rounded-xl bg-white/[0.06] px-3.5 focus-within:ring-2 focus-within:ring-white/35">
              <input
                id="story-community-price"
                autoFocus
                aria-required
                aria-invalid={Boolean(error)}
                aria-describedby="story-community-price-hint story-community-price-error"
                inputMode="numeric"
                disabled={saving || disabled}
                value={value}
                onChange={(event) => {
                  setValue(event.target.value);
                  setError(null);
                }}
                className="min-w-0 flex-1 bg-transparent text-lg text-white tabular-nums outline-none"
              />
              <span className="shrink-0 text-xs text-white/50">{t("currency")}</span>
            </div>
          </Field>
          <p id="story-community-price-hint" className="mt-2.5 text-xs text-white/45">
            {t("freeHint")}
          </p>
          <p
            id="story-community-price-error"
            role="alert"
            className="mt-2 text-xs text-destructive"
          >
            {error}
          </p>
          <div className="mt-6 flex justify-end gap-2">
            <Button variant="secondary" disabled={saving} onClick={() => changeOpen(false)}>
              {t("cancel")}
            </Button>
            <Button type="submit" disabled={disabled} loading={saving}>
              {t(saving ? "saving" : "save")}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Read-only price inherited from the linked story node. */
export function StoryCommunityPriceLabel({ price = 0 }: { price?: number }) {
  const t = useTranslations("storyStudio.canvas.communityPrice");
  return (
    <span
      title={t("destinationHint")}
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap text-xs font-medium",
        price > 0 ? "text-brand-yellow" : "text-white/55"
      )}
    >
      {price > 0 ? (
        <IconLock className="size-3.5" aria-hidden />
      ) : (
        <IconCoins className="size-3.5" aria-hidden />
      )}
      {price > 0 ? t("amount", { count: price }) : t("free")}
    </span>
  );
}
