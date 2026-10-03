"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { IconCheck, IconLoader2, IconPlayerPlay, IconRotate, IconX } from "@tabler/icons-react";
import { toast } from "sonner";
import { canTransition, type OrderDTO } from "@repo/shared/order";
import { useTranslations } from "@/src/i18n/i18n";
import { useCurrentUser } from "@/src/hooks/use-user";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  useAcceptDelivery,
  useAcceptOrder,
  useCancelOrder,
  useDeclineOrder,
  useDeliverOrder,
  useRequestRevision,
} from "@/app/(site)/creators/_hooks/use-orders";

export function ActionFooter(props: { order: OrderDTO; role: "buyer" | "creator" }) {
  const { user } = useCurrentUser();
  return (
    <ActionFooterContent key={JSON.stringify([props.order.id, props.role, user?.id])} {...props} />
  );
}

function ActionFooterContent({ order, role }: { order: OrderDTO; role: "buyer" | "creator" }) {
  const t = useTranslations("orders");
  const active = useRef(false);
  const admitted = useRef(false);
  useLayoutEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);

  // Mutations — id passed at call time so the same hook instance
  // serves every action.
  const accept = useAcceptOrder();
  const decline = useDeclineOrder();
  const deliver = useDeliverOrder();
  const acceptDelivery = useAcceptDelivery();
  const requestRevision = useRequestRevision();
  const cancel = useCancelOrder();

  const busy =
    accept.isPending ||
    decline.isPending ||
    deliver.isPending ||
    acceptDelivery.isPending ||
    requestRevision.isPending ||
    cancel.isPending;

  // Confirmation/reason dialogs (cancel + decline + revision need text).
  const [reasonDialog, setReasonDialog] = useState<
    null | { kind: "decline" } | { kind: "cancel" } | { kind: "request_revision" }
  >(null);
  const [reasonText, setReasonText] = useState("");
  const reasonLimit = reasonDialog?.kind === "request_revision" ? 2000 : 500;

  const openReason = (kind: "decline" | "cancel" | "request_revision") => {
    if (!active.current || admitted.current || busy) return;
    setReasonText("");
    setReasonDialog({ kind });
  };
  const submitReason = async () => {
    if (!reasonDialog || !active.current || admitted.current || busy) return;
    const reason = reasonText.trim();
    if (!reason) {
      toast.error(t("reasonRequired"));
      return;
    }
    admitted.current = true;
    try {
      if (reasonDialog.kind === "decline") {
        await decline.mutateAsync({ id: order.id, reason });
        if (active.current) toast.success(t("action.declinedToast"));
      } else if (reasonDialog.kind === "cancel") {
        await cancel.mutateAsync({ id: order.id, reason });
        if (active.current) toast.success(t("action.cancelledToast"));
      } else {
        await requestRevision.mutateAsync({ id: order.id, reason });
        if (active.current) toast.success(t("action.revisionRequestedToast"));
      }
      if (active.current) setReasonDialog(null);
    } catch (err) {
      if (active.current) toast.error(err instanceof Error ? err.message : t("action.failed"));
    } finally {
      admitted.current = false;
    }
  };

  const run = async (fn: () => Promise<unknown>, successKey: string) => {
    if (!active.current || admitted.current || busy) return;
    admitted.current = true;
    try {
      await fn();
      if (active.current) toast.success(t(successKey));
    } catch (err) {
      if (active.current) toast.error(err instanceof Error ? err.message : t("action.failed"));
    } finally {
      admitted.current = false;
    }
  };

  const buttons: React.ReactNode[] = [];

  // Creator: pending_creator → accept | decline
  if (role === "creator" && canTransition(order.status, "accept")) {
    buttons.push(
      <Button
        key="accept"
        type="button"
        onClick={() => run(() => accept.mutateAsync({ id: order.id }), "action.acceptedToast")}
        disabled={busy}
      >
        <IconCheck className="size-4" />
        {t("action.accept")}
      </Button>
    );
  }
  if (role === "creator" && canTransition(order.status, "decline")) {
    buttons.push(
      <Button
        key="decline"
        type="button"
        variant="ghost"
        color="muted"
        onClick={() => openReason("decline")}
        disabled={busy}
      >
        <IconX className="size-4" />
        {t("action.decline")}
      </Button>
    );
  }
  // Creator: in_progress | revision_requested → deliver
  if (role === "creator" && canTransition(order.status, "deliver")) {
    buttons.push(
      <Button
        key="deliver"
        type="button"
        onClick={() => run(() => deliver.mutateAsync({ id: order.id }), "action.deliveredToast")}
        disabled={busy}
      >
        <IconPlayerPlay className="size-4" />
        {t("action.deliver")}
      </Button>
    );
  }
  // Buyer: delivered → accept_delivery | request_revision
  if (role === "buyer" && canTransition(order.status, "accept_delivery")) {
    buttons.push(
      <Button
        key="accept-delivery"
        type="button"
        onClick={() =>
          run(() => acceptDelivery.mutateAsync({ id: order.id }), "action.completedToast")
        }
        disabled={busy}
      >
        <IconCheck className="size-4" />
        {t("action.acceptDelivery")}
      </Button>
    );
  }
  if (role === "buyer" && canTransition(order.status, "request_revision")) {
    buttons.push(
      <Button
        key="request-revision"
        type="button"
        variant="outline"
        color="muted"
        onClick={() => openReason("request_revision")}
        disabled={busy}
      >
        <IconRotate className="size-4" />
        {t("action.requestRevision")}
      </Button>
    );
  }
  // Cancel — both sides, when non-terminal.
  if (canTransition(order.status, "cancel")) {
    buttons.push(
      <Button
        key="cancel"
        type="button"
        variant="ghost"
        color="muted"
        onClick={() => openReason("cancel")}
        disabled={busy}
      >
        {t("action.cancel")}
      </Button>
    );
  }

  if (buttons.length === 0 && !reasonDialog) return null;

  return (
    <>
      {buttons.length > 0 ? (
        <footer className="flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-border bg-background/95 px-5 py-3">
          {buttons}
        </footer>
      ) : null}

      <AlertDialog
        open={!!reasonDialog}
        onOpenChange={(o) => {
          if (!o) setReasonDialog(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {reasonDialog ? t(`reason.${reasonDialog.kind}.title`) : ""}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {reasonDialog ? t(`reason.${reasonDialog.kind}.body`) : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <Textarea
            autoFocus
            value={reasonText}
            onChange={(e) => setReasonText(e.target.value.slice(0, reasonLimit))}
            placeholder={t("reasonPlaceholder")}
            rows={4}
            className="my-2 max-h-40 overflow-y-auto"
            maxLength={reasonLimit}
          />
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>{t("reasonCancel")}</AlertDialogCancel>
            <AlertDialogAction
              color={
                reasonDialog?.kind === "decline" || reasonDialog?.kind === "cancel"
                  ? "destructive"
                  : "primary"
              }
              disabled={busy || reasonText.trim().length === 0}
              onClick={(e) => {
                e.preventDefault();
                void submitReason();
              }}
            >
              {busy ? <IconLoader2 className="size-4 animate-spin" /> : null}
              {reasonDialog ? t(`reason.${reasonDialog.kind}.confirm`) : ""}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
