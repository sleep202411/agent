"use client";

/**
 * ConfirmDialog — the standard confirmation gate for destructive / irreversible
 * admin actions. Replaces ad-hoc window.confirm() so confirmations match the
 * shadcn Dialog design language (focus trap, Escape, overlay) and can show a
 * pending state while the action runs.
 *
 * Two usage modes:
 *   1. Trigger-driven (uncontrolled): pass `trigger` and the dialog manages its
 *      own open state.
 *        <ConfirmDialog
 *          trigger={<Button variant="destructive" size="sm">重置 MFA</Button>}
 *          title="确认重置 MFA？"
 *          description="下次登录需要重新绑定。"
 *          confirmLabel="确认重置"
 *          destructive
 *          onConfirm={resetMfa}
 *        />
 *   2. Controlled: pass `open` + `onOpenChange` to drive it from parent state.
 *
 * `onConfirm` may be async. While it runs the confirm button shows a spinner and
 * both buttons disable. On success the dialog closes; if `onConfirm` throws, the
 * dialog stays open so the caller can surface the error.
 */

import * as React from "react";
import { IconLoader2 } from "@tabler/icons-react";

import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

export interface ConfirmDialogProps {
  title: string;
  description?: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Style the confirm button as destructive (red). */
  destructive?: boolean;
  /** Runs on confirm. May be async; the dialog closes on success. */
  onConfirm: () => void | Promise<void>;
  /** Uncontrolled mode: the element that opens the dialog. */
  trigger?: React.ReactNode;
  /** Controlled mode. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

export function ConfirmDialog({
  title,
  description,
  confirmLabel = "确认",
  cancelLabel = "取消",
  destructive = false,
  onConfirm,
  trigger,
  open: controlledOpen,
  onOpenChange,
}: ConfirmDialogProps) {
  const [uncontrolledOpen, setUncontrolledOpen] = React.useState(false);
  const [pending, setPending] = React.useState(false);
  const operationRef = React.useRef<object | null>(null);
  const activeRef = React.useRef(false);

  const isControlled = controlledOpen !== undefined;
  const open = isControlled ? controlledOpen : uncontrolledOpen;
  const [previousOpen, setPreviousOpen] = React.useState(open);
  if (previousOpen !== open) {
    setPreviousOpen(open);
    setPending(false);
  }
  React.useLayoutEffect(() => {
    activeRef.current = Boolean(open);
    return () => {
      activeRef.current = false;
      operationRef.current = null;
    };
  }, [open]);
  const setOpen = React.useCallback(
    (next: boolean) => {
      if (!isControlled) setUncontrolledOpen(next);
      onOpenChange?.(next);
    },
    [isControlled, onOpenChange]
  );

  async function handleConfirm() {
    if (!activeRef.current || operationRef.current) return;
    const operation = {};
    operationRef.current = operation;
    setPending(true);
    try {
      await onConfirm();
      if (activeRef.current && operationRef.current === operation) setOpen(false);
    } catch {
      // The caller owns error presentation. Keep its failed confirmation open.
    } finally {
      if (operationRef.current === operation) {
        operationRef.current = null;
        setPending(false);
      }
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        // Don't allow closing mid-action.
        if (operationRef.current) return;
        setOpen(next);
      }}
    >
      {trigger ? <DialogTrigger asChild>{trigger}</DialogTrigger> : null}
      <DialogContent showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description ? <DialogDescription>{description}</DialogDescription> : null}
        </DialogHeader>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline" disabled={pending}>
              {cancelLabel}
            </Button>
          </DialogClose>
          <Button
            variant={destructive ? "destructive" : "default"}
            onClick={handleConfirm}
            disabled={pending}
          >
            {pending ? <IconLoader2 className="size-4 animate-spin" /> : null}
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
