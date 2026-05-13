"use client";

import { useEffect, useState } from "react";
import { IconCheck, IconEdit, IconLoader2, IconX } from "@tabler/icons-react";
import { toast } from "sonner";
import { useTranslations } from "@/src/i18n/i18n";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  useSetAssignmentRevenue,
  type EpisodeAssignment,
} from "@/app/(site)/crews/_hooks/use-episodes";

interface RevenueCellProps {
  crewId: string;
  episodeId: number;
  assignment: EpisodeAssignment;
  /** Only finance can flip into edit mode. Others see the value read-only. */
  canEdit: boolean;
}

/**
 * Inline-editable revenue display.
 *
 * - Non-finance viewers see "—" or the formatted amount.
 * - Finance sees a pencil; click → numeric input with Save / Cancel.
 * - Empty submit blocked at the canSubmit guard; backend rejection
 *   surfaces through toast.
 */
export function RevenueCell({ crewId, episodeId, assignment, canEdit }: RevenueCellProps) {
  const t = useTranslations("workspace");
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<string>(
    assignment.revenue ? String(assignment.revenue.amount) : ""
  );
  const setRevenue = useSetAssignmentRevenue(crewId, episodeId);

  // Reset draft when assignment changes externally.
  useEffect(() => {
    setDraft(assignment.revenue ? String(assignment.revenue.amount) : "");
  }, [assignment.revenue]);

  const parsed = Number.parseFloat(draft);
  const canSubmit = !setRevenue.isPending && Number.isFinite(parsed) && parsed >= 0;

  const cancel = () => {
    setDraft(assignment.revenue ? String(assignment.revenue.amount) : "");
    setEditing(false);
  };

  const save = () => {
    if (!canSubmit) return;
    setRevenue.mutate(
      {
        assignmentId: assignment.id,
        amount: parsed,
        currency: assignment.revenue?.currency ?? "CNY",
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
      <div className="flex items-center gap-1">
        <Input
          autoFocus
          type="number"
          inputMode="decimal"
          step="0.01"
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
    ? `${assignment.revenue.currency} ${formatAmount(assignment.revenue.amount)}`
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

function formatAmount(n: number): string {
  // Lean on Intl when present; fall back to toFixed for SSR-safe values.
  if (typeof Intl !== "undefined" && Intl.NumberFormat) {
    return new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(n);
  }
  return n.toFixed(2);
}
