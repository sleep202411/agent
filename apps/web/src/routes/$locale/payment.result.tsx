import { createFileRoute } from "@tanstack/react-router";
import PaymentResultPage from "@/app/[locale]/payment/result/page";

export const Route = createFileRoute("/$locale/payment/result")({
  validateSearch: (search: Record<string, unknown>) => ({
    order_id: (search.order_id as string) ?? undefined,
    orderNo: (search.orderNo as string) ?? undefined,
  }),
  component: PaymentResultPage,
});
