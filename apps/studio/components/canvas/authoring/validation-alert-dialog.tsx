"use client";

import { useTranslations } from "next-intl";
import type { ValidationIssue } from "@repo/shared";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { formatValidationIssue } from "@/lib/canvas-authoring/format-validation-issue";

type Translate = (key: string, values?: Record<string, string | number | Date>) => string;

/**
 * Blocking preflight UI for catalog validation (and plain error strings).
 * Uses shadcn Alert Dialog — not an inline banner.
 */
export function ValidationAlertDialog({
  open,
  onOpenChange,
  title,
  issues,
  message,
  formatIssue,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  issues?: readonly ValidationIssue[];
  /** Plain fallback when there are no structured issues. */
  message?: string | null;
  /** Namespace-bound translator for issue codes (canvasOps / generation). */
  formatIssue?: Translate;
}) {
  const tc = useTranslations("common");
  const tGen = useTranslations("generation");
  const translate = formatIssue ?? ((key, values) => tGen(key, values));
  const list = issues ?? [];

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div>
              {list.length > 0 ? (
                <ul className="list-disc space-y-1 pl-4 text-xs/relaxed text-muted-foreground">
                  {list.map((issue, index) => (
                    <li key={`${issue.code}-${issue.field ?? "root"}-${index}`}>
                      {formatValidationIssue(translate, issue)}
                    </li>
                  ))}
                </ul>
              ) : message ? (
                <p className="text-xs/relaxed text-muted-foreground">{message}</p>
              ) : null}
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogAction type="button">{tc("confirm")}</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
