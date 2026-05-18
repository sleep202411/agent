"use client";

import { useEffect, useMemo, useState } from "react";
import { IconCheck, IconEdit, IconLoader2, IconX } from "@tabler/icons-react";
import { toast } from "sonner";
import { useTranslations } from "@/src/i18n/i18n";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { allowedCurrenciesForCell, defaultCurrencyForCell } from "@/src/lib/region/cell";
import {
  useSetAssignmentRevenue,
  type EpisodeAssignment,
} from "@/app/(site)/crews/_hooks/use-episodes";
import { type CurrencyCode } from "@/app/(site)/crews/_hooks/use-crew";
import { CURRENCY_SYMBOLS, ZERO_DECIMAL_CURRENCIES } from "@repo/shared/crew";

interface RevenueCellProps {
  crewId: string;
  episodeId: string;
  assignment: EpisodeAssignment;
  /** Only finance can flip into edit mode. Others see the value read-only. */
  canEdit: boolean;
}

/**
 * Inline-editable revenue display with cell-aware currency picker.
 *
 * - Non-finance viewers see "—" or the formatted amount.
 * - Finance sees a pencil; click → numeric input + currency picker
 *   (hidden on cells with a single allowed currency like CN).
 * - JPY etc render whole numbers (zero-decimal); others render two
 *   decimal places. Server stores the smallest currency unit always.
 */
export function RevenueCell({ crewId, episodeId, assignment, canEdit }: RevenueCellProps) {
  const t = useTranslations("workspace");

  const allowedCurrencies = useMemo(() => allowedCurrenciesForCell(), []);
  const showCurrencyPicker = allowedCurrencies.length > 1;

  // Existing revenue dictates the editing currency; otherwise pick the
  // cell default. Storage is always the smallest unit; UI converts.
  const initialCurrency: CurrencyCode = assignment.revenue?.currency ?? defaultCurrencyForCell();
  const [currency, setCurrency] = useState<CurrencyCode>(initialCurrency);

  const isZeroDecimal = (c: CurrencyCode) => ZERO_DECIMAL_CURRENCIES.has(c);
  const toDisplay = (smallestUnit: number, c: CurrencyCode) =>
    isZeroDecimal(c) ? smallestUnit : smallestUnit / 100;
  const toStorage = (displayValue: number, c: CurrencyCode) =>
    isZeroDecimal(c) ? Math.round(displayValue) : Math.round(displayValue * 100);

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<string>(
    assignment.revenue
      ? toDisplay(assignment.revenue.amount, assignment.revenue.currency).toString()
      : ""
  );
  const setRevenue = useSetAssignmentRevenue(crewId, episodeId);

  // Reset draft + currency when assignment changes externally.
  useEffect(() => {
    const nextCurrency = assignment.revenue?.currency ?? defaultCurrencyForCell();
    setCurrency(nextCurrency);
    setDraft(
      assignment.revenue
        ? toDisplay(assignment.revenue.amount, assignment.revenue.currency).toString()
        : ""
    );
    // toDisplay is pure of state — safe to skip from deps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assignment.revenue]);

  const parsed = Number.parseFloat(draft);
  const canSubmit = !setRevenue.isPending && Number.isFinite(parsed) && parsed >= 0;

  const cancel = () => {
    setDraft(
      assignment.revenue
        ? toDisplay(assignment.revenue.amount, assignment.revenue.currency).toString()
        : ""
    );
    setCurrency(initialCurrency);
    setEditing(false);
  };

  const save = () => {
    if (!canSubmit) return;
    setRevenue.mutate(
      {
        assignmentId: assignment.id,
        amount: toStorage(parsed, currency),
        currency,
      },
      {
        onSuccess: () => {
          toast.success(t("revenueUpdated"));
          setEditing(false);
        },
        onError: (err) => {
          toast.error(err instanceof Error ? err.message : t("revenueUpdateFailed"));
        },
      }
    );
  };

  if (editing) {
    return (
      <div className="flex flex-wrap items-center gap-1">
        {showCurrencyPicker ? (
          <Select value={currency} onValueChange={(v) => setCurrency(v as CurrencyCode)}>
            <SelectTrigger className="h-7 w-[78px] text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {allowedCurrencies.map((c) => (
                <SelectItem key={c} value={c}>
                  {CURRENCY_SYMBOLS[c]} {c}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : null}
        <Input
          autoFocus
          type="number"
          inputMode="decimal"
          step={isZeroDecimal(currency) ? "1" : "0.01"}
          min="0"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") save();
            else if (e.key === "Escape") cancel();
          }}
          className="h-7 w-24 text-xs"
        />
        <Button
          variant="ghost"
          size="icon-xs"
          color="success"
          onClick={save}
          disabled={!canSubmit}
          aria-label={t("revenueSave")}
        >
          {setRevenue.isPending ? (
            <IconLoader2 className="size-3 animate-spin" />
          ) : (
            <IconCheck className="size-3" />
          )}
        </Button>
        <Button
          variant="ghost"
          size="icon-xs"
          onClick={cancel}
          disabled={setRevenue.isPending}
          aria-label={t("revenueCancel")}
        >
          <IconX className="size-3" />
        </Button>
      </div>
    );
  }

  const display = assignment.revenue
    ? formatRevenue(assignment.revenue.amount, assignment.revenue.currency)
    : t("revenueNotSet");

  return (
    <div className="flex items-center gap-1.5">
      <span
        className={
          assignment.revenue
            ? "text-xs font-semibold text-foreground"
            : "text-xs text-muted-foreground"
        }
      >
        {display}
      </span>
      {canEdit ? (
        <Button
          variant="ghost"
          size="icon-xs"
          onClick={() => setEditing(true)}
          aria-label={t("revenueEdit")}
        >
          <IconEdit className="size-3" />
        </Button>
      ) : null}
    </div>
  );
}

/**
 * Format a smallest-unit amount + currency to a human string,
 * respecting zero-decimal currencies (JPY) and using the locale's
 * thousands separator. Examples:
 *   (100000, "CNY") → "¥1,000.00"
 *   (10000, "JPY")  → "¥10,000"
 */
function formatRevenue(smallestUnit: number, currency: CurrencyCode): string {
  const isZeroDecimal = ZERO_DECIMAL_CURRENCIES.has(currency);
  const display = isZeroDecimal ? smallestUnit : smallestUnit / 100;
  const symbol = CURRENCY_SYMBOLS[currency] ?? "";
  const formatted =
    typeof Intl !== "undefined" && Intl.NumberFormat
      ? new Intl.NumberFormat(undefined, {
          minimumFractionDigits: isZeroDecimal ? 0 : 2,
          maximumFractionDigits: isZeroDecimal ? 0 : 2,
        }).format(display)
      : display.toFixed(isZeroDecimal ? 0 : 2);
  return `${symbol}${formatted}`;
}
